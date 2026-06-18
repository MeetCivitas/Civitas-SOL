/**
 * Civitas — Private payroll disbursement engine.
 *
 * Orchestrates the long-lived-delegation lifecycle for the `civitas_ephemeral`
 * program against MagicBlock's TEE-secured Ephemeral Rollups:
 *
 *   1. Ingress compliance check (OFAC + AML + jurisdiction + IP geofence)
 *   2. Compliance attestation on-chain (refreshes the treasury's freshness gate)
 *   3. Delegate EmployerTreasury PDA + treasury ATA to the validator
 *   4. Delegate each EmployeeShieldedAccount PDA + shielded ATA to the validator
 *   5. Build a randomized split schedule for `totalAmount` (split + jitter)
 *   6. Submit each `execute_private_transfer` to the ER under a TEE auth token
 *   7. On employee withdrawal: unshield_settlement (ER) -> withdraw_to_personal (base)
 *
 * STRICT ARCHITECTURE: this client uses ONLY native SDK delegation primitives
 * and the program's own instructions executed on the ER endpoint. No calls
 * to payments.magicblock.app — settlement is decoupled from execution and
 * driven by employee action.
 *
 * Endpoints (devnet defaults):
 *   - Base RPC:  https://api.devnet.solana.com
 *   - ER TEE:    https://devnet-tee.magicblock.app
 *   - Validator: MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo
 */

import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, BN, Program, Wallet, web3 } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  createDelegateInstruction,
  GetCommitmentSignature,
  getAuthToken,
  PERMISSION_PROGRAM_ID,
  DELEGATION_PROGRAM_ID,
  MAGIC_PROGRAM_ID,
  MAGIC_CONTEXT_ID,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import * as nacl from "tweetnacl";

import type { CivitasEphemeral } from "../target/types/civitas_ephemeral";

// ─── Constants ─────────────────────────────────────────────────────────────

const BASE_RPC = process.env.CIVITAS_BASE_RPC ?? "https://api.devnet.solana.com";
const TEE_RPC_HTTP = process.env.CIVITAS_TEE_RPC ?? "https://devnet-tee.magicblock.app";
const TEE_RPC_WS = TEE_RPC_HTTP.replace(/^http/, "ws");

/** Default MagicBlock private validator on devnet. */
const DEFAULT_VALIDATOR = new PublicKey(
  process.env.CIVITAS_VALIDATOR ?? "MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo",
);

const TREASURY_SEED = Buffer.from("civ_treasury");
const EMPLOYEE_SEED = Buffer.from("civ_employee");
const PERMISSION_SEED = Buffer.from("permission");

// ─── Compliance ────────────────────────────────────────────────────────────

export interface ComplianceResult {
  ofac: boolean;
  jurisdiction: string;
  jurisdictionCode: Uint8Array; // 4 bytes
  riskScore: number; // 0..100
  ipGeofence: "pass" | "fail";
  attestedAt: number;
}

export class ComplianceError extends Error {
  constructor(msg: string, public readonly subject: PublicKey) {
    super(`compliance: ${msg} (subject=${subject.toBase58()})`);
  }
}

/**
 * Calls a Chainalysis-style HTTP screener and returns the verdict.
 * Falls back to a permissive devnet result if `CIVITAS_COMPLIANCE_URL` is unset
 * — that lets local devnet runs proceed without a real screener wired up.
 */
export async function runIngressCompliance(
  employer: PublicKey,
  employees: PublicKey[],
  apiUrl = process.env.CIVITAS_COMPLIANCE_URL,
): Promise<ComplianceResult> {
  if (!apiUrl) {
    return {
      ofac: false,
      jurisdiction: "DEVNET",
      jurisdictionCode: new Uint8Array([0x44, 0x45, 0x56, 0x4e]), // "DEVN"
      riskScore: 0,
      ipGeofence: "pass",
      attestedAt: Math.floor(Date.now() / 1000),
    };
  }

  const res = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      employer: employer.toBase58(),
      employees: employees.map((p) => p.toBase58()),
    }),
  });
  if (!res.ok) {
    throw new ComplianceError(`screener returned ${res.status}`, employer);
  }
  const body = (await res.json()) as {
    ofac: boolean;
    jurisdiction: string;
    riskScore: number;
    ipGeofence: "pass" | "fail";
  };
  if (body.ofac) throw new ComplianceError("OFAC hit", employer);
  if (body.ipGeofence === "fail") throw new ComplianceError("geofence denied", employer);
  if (body.riskScore > 75) throw new ComplianceError(`risk score ${body.riskScore}`, employer);

  const code = new TextEncoder().encode(body.jurisdiction.slice(0, 4).padEnd(4, "?"));
  return {
    ofac: false,
    jurisdiction: body.jurisdiction,
    jurisdictionCode: code,
    riskScore: body.riskScore,
    ipGeofence: body.ipGeofence,
    attestedAt: Math.floor(Date.now() / 1000),
  };
}

// ─── PDA derivation ────────────────────────────────────────────────────────

export function deriveTreasury(programId: PublicKey, authority: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [TREASURY_SEED, authority.toBuffer()],
    programId,
  );
}

export function deriveEmployee(
  programId: PublicKey,
  treasury: PublicKey,
  employee: PublicKey,
) {
  return PublicKey.findProgramAddressSync(
    [EMPLOYEE_SEED, treasury.toBuffer(), employee.toBuffer()],
    programId,
  );
}

export function derivePermission(permissionedAccount: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [PERMISSION_SEED, permissionedAccount.toBuffer()],
    PERMISSION_PROGRAM_ID,
  );
}

// ─── Connection / providers ────────────────────────────────────────────────

export interface CivitasProviders {
  base: AnchorProvider;
  ephemeral: AnchorProvider;
  authExpiresAt: number;
}

export async function buildProviders(wallet: Wallet): Promise<CivitasProviders> {
  const baseConn = new Connection(BASE_RPC, "confirmed");
  const base = new AnchorProvider(baseConn, wallet, { commitment: "confirmed" });

  const auth = await getAuthToken(
    TEE_RPC_HTTP,
    wallet.publicKey,
    (message: Uint8Array) => Promise.resolve(nacl.sign.detached(message, wallet.payer.secretKey)),
  );

  const ephemeralConn = new Connection(`${TEE_RPC_HTTP}?token=${auth.token}`, {
    wsEndpoint: `${TEE_RPC_WS}?token=${auth.token}`,
    commitment: "confirmed",
  });
  const ephemeral = new AnchorProvider(ephemeralConn, wallet, { commitment: "confirmed" });

  return { base, ephemeral, authExpiresAt: auth.expiresAt };
}

// ─── Delegation: program PDA paths ─────────────────────────────────────────

/** Builds the delegate_treasury instruction using #[delegate]-derived accounts. */
export async function delegateTreasury(
  program: Program<CivitasEphemeral>,
  authority: PublicKey,
): Promise<TransactionInstruction> {
  const [treasury] = deriveTreasury(program.programId, authority);
  const [permission] = derivePermission(treasury);

  return program.methods
    .delegateTreasury(null)
    .accountsPartial({
      authority,
      treasury,
      permission,
      permissionProgram: PERMISSION_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      validator: DEFAULT_VALIDATOR,
    })
    .instruction();
}

/** Builds the delegate_employee instruction. */
export async function delegateEmployee(
  program: Program<CivitasEphemeral>,
  payer: PublicKey,
  treasury: PublicKey,
  employeeWallet: PublicKey,
): Promise<TransactionInstruction> {
  const [employeeState] = deriveEmployee(program.programId, treasury, employeeWallet);
  const [permission] = derivePermission(employeeState);

  return program.methods
    .delegateEmployee(null)
    .accountsPartial({
      payer,
      treasury,
      employeeWallet,
      employeeState,
      permission,
      permissionProgram: PERMISSION_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      validator: DEFAULT_VALIDATOR,
    })
    .instruction();
}

// ─── Delegation: token accounts ────────────────────────────────────────────

/**
 * Delegates a raw SPL token account directly via the SDK so the ER's shadow
 * SPL processor can act on it during private transfers. Token accounts are
 * NOT delegated by the program — they're delegated by the wallet that holds
 * authority over them.
 */
export function delegateTokenAccountIx(
  payer: PublicKey,
  tokenAccount: PublicKey,
): TransactionInstruction {
  return createDelegateInstruction(
    {
      payer,
      delegatedAccount: tokenAccount,
      ownerProgram: TOKEN_PROGRAM_ID,
      validator: DEFAULT_VALIDATOR,
    },
    {
      validator: DEFAULT_VALIDATOR,
      commitFrequencyMs: 60_000,
    },
  );
}

// ─── End-to-end onboarding ─────────────────────────────────────────────────

export interface OnboardingArgs {
  program: Program<CivitasEphemeral>;
  base: AnchorProvider;
  authority: Keypair;
  attestor: Keypair;
  mint: PublicKey;
  perEmployeeLimit: BN;
  dailyLimit: BN;
  employees: PublicKey[];
}

/**
 * One-shot bootstrap: initializes the treasury, registers all employees,
 * attests compliance, and delegates every long-lived account to the ER.
 * After this completes, `disbursePrivatePayroll` can run private transfers
 * indefinitely against the warm delegation set.
 */
export async function onboardPayrollPool(args: OnboardingArgs): Promise<{
  treasury: PublicKey;
  treasuryAta: PublicKey;
  employees: Array<{
    employee: PublicKey;
    employeeState: PublicKey;
    shieldedAta: PublicKey;
  }>;
}> {
  const { program, base, authority, attestor, mint, employees } = args;

  // 1. Pre-flight compliance.
  const compliance = await runIngressCompliance(authority.publicKey, employees);

  // 2. Initialize the treasury pool.
  const [treasury] = deriveTreasury(program.programId, authority.publicKey);
  const treasuryAta = getAssociatedTokenAddressSync(mint, treasury, true);

  const initIx = await program.methods
    .initializePayrollPool(
      args.perEmployeeLimit,
      args.dailyLimit,
      attestor.publicKey,
    )
    .accountsPartial({
      authority: authority.publicKey,
      mint,
      treasury,
      treasuryTokenAccount: treasuryAta,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .instruction();

  const attestIx = await program.methods
    .attestCompliance(true, Array.from(compliance.jurisdictionCode))
    .accountsPartial({
      attestor: attestor.publicKey,
      treasury,
    })
    .instruction();

  const initTx = new Transaction().add(initIx, attestIx);
  await base.sendAndConfirm(initTx, [authority, attestor]);

  // 3. Register each employee.
  const registered: Array<{
    employee: PublicKey;
    employeeState: PublicKey;
    shieldedAta: PublicKey;
  }> = [];

  for (const employee of employees) {
    const [employeeState] = deriveEmployee(program.programId, treasury, employee);
    const shieldedAta = getAssociatedTokenAddressSync(mint, employeeState, true);

    const ix = await program.methods
      .registerEmployee()
      .accountsPartial({
        payer: authority.publicKey,
        authority: authority.publicKey,
        employeeWallet: employee,
        mint,
        treasury,
        employeeState,
        employeeShieldedAta: shieldedAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .instruction();

    await base.sendAndConfirm(new Transaction().add(ix), [authority]);
    registered.push({ employee, employeeState, shieldedAta });
  }

  // 4. Delegate treasury PDA + treasury ATA.
  const delegateTreasuryIx = await delegateTreasury(program, authority.publicKey);
  const delegateTreasuryAtaIx = delegateTokenAccountIx(authority.publicKey, treasuryAta);
  await base.sendAndConfirm(
    new Transaction().add(delegateTreasuryIx, delegateTreasuryAtaIx),
    [authority],
    { skipPreflight: true },
  );

  // 5. Delegate each employee PDA + shielded ATA.
  for (const reg of registered) {
    const delegateEmpIx = await delegateEmployee(
      program,
      authority.publicKey,
      treasury,
      reg.employee,
    );
    const delegateEmpAtaIx = delegateTokenAccountIx(authority.publicKey, reg.shieldedAta);
    await base.sendAndConfirm(
      new Transaction().add(delegateEmpIx, delegateEmpAtaIx),
      [authority],
      { skipPreflight: true },
    );
  }

  return { treasury, treasuryAta, employees: registered };
}

// ─── Multi-split + jitter ──────────────────────────────────────────────────

export interface SplitPolicy {
  /** Minimum number of fragments to split into. */
  minSplits: number;
  /** Maximum number of fragments to split into. */
  maxSplits: number;
  /** Minimum jitter delay (ms) between fragments. */
  minDelayMs: number;
  /** Maximum jitter delay (ms) between fragments. */
  maxDelayMs: number;
}

export const DEFAULT_SPLIT_POLICY: SplitPolicy = {
  minSplits: 3,
  maxSplits: 7,
  minDelayMs: 50,
  maxDelayMs: 350,
};

/** Crypto-safe integer in [lo, hi]. */
function randInt(lo: number, hi: number): number {
  if (hi < lo) throw new Error("randInt: hi < lo");
  const range = hi - lo + 1;
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return lo + (buf[0] % range);
}

/**
 * Splits `totalAmount` into a random number of fragments in [min, max].
 * The fragments sum exactly to `totalAmount` and are shuffled so order is
 * not correlated with size. Every fragment is at least 1 base unit; if
 * `totalAmount < minSplits`, falls back to `totalAmount` × 1-unit fragments.
 */
export function buildSplitSchedule(
  totalAmount: BN,
  policy: SplitPolicy = DEFAULT_SPLIT_POLICY,
): BN[] {
  if (totalAmount.lten(0)) throw new Error("totalAmount must be > 0");

  const total = BigInt(totalAmount.toString());
  const upperBoundSplits = total < BigInt(policy.minSplits)
    ? Number(total)
    : randInt(policy.minSplits, policy.maxSplits);
  const splitCount = Math.max(1, upperBoundSplits);

  // Sample (splitCount - 1) cut points in [1, total - 1] using stars-and-bars,
  // then take the differences. Each fragment is at least 1.
  const cuts: bigint[] = [];
  while (cuts.length < splitCount - 1) {
    const buf = new BigUint64Array(1);
    globalThis.crypto.getRandomValues(buf);
    const c = (buf[0] % (total - 1n)) + 1n;
    if (!cuts.includes(c)) cuts.push(c);
  }
  cuts.sort((a, b) => (a < b ? -1 : 1));
  cuts.unshift(0n);
  cuts.push(total);

  const fragments: bigint[] = [];
  for (let i = 1; i < cuts.length; i++) fragments.push(cuts[i] - cuts[i - 1]);

  // Fisher-Yates shuffle so fragment order doesn't reveal sort.
  for (let i = fragments.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [fragments[i], fragments[j]] = [fragments[j], fragments[i]];
  }

  return fragments.map((f) => new BN(f.toString()));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Disbursement engine ───────────────────────────────────────────────────

export interface DisburseArgs {
  program: Program<CivitasEphemeral>;
  ephemeral: AnchorProvider;
  authoritySigner: Keypair;
  treasury: PublicKey;
  treasuryAta: PublicKey;
  employee: PublicKey;
  employeeState: PublicKey;
  employeeShieldedAta: PublicKey;
  totalAmount: BN;
  policy?: SplitPolicy;
}

export interface DisburseResult {
  fragments: BN[];
  signatures: string[];
}

/**
 * Disburses `totalAmount` to a single employee inside the Ephemeral Rollup
 * as multiple randomly-sized fragments separated by jitter delays. Each
 * fragment is a separate `execute_private_transfer` instruction submitted
 * to the TEE-secured ER endpoint.
 *
 * The base-layer ledger sees nothing — only the eventual commit at
 * `unshield_settlement`-time shows the netted result.
 */
export async function disbursePrivatePayroll(
  args: DisburseArgs,
): Promise<DisburseResult> {
  const policy = args.policy ?? DEFAULT_SPLIT_POLICY;
  const fragments = buildSplitSchedule(args.totalAmount, policy);
  const signatures: string[] = [];

  for (let i = 0; i < fragments.length; i++) {
    const amount = fragments[i];

    const ix = await args.program.methods
      .executePrivateTransfer(amount)
      .accountsPartial({
        payer: args.authoritySigner.publicKey,
        treasury: args.treasury,
        employeeState: args.employeeState,
        treasuryTokenAccount: args.treasuryAta,
        employeeShieldedAta: args.employeeShieldedAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();

    const tx = new Transaction().add(ix);
    tx.feePayer = args.authoritySigner.publicKey;
    tx.recentBlockhash = (
      await args.ephemeral.connection.getLatestBlockhash()
    ).blockhash;
    tx.sign(args.authoritySigner);

    const sig = await args.ephemeral.connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
      maxRetries: 5,
    });
    await args.ephemeral.connection.confirmTransaction(sig, "confirmed");
    signatures.push(sig);

    if (i < fragments.length - 1) {
      const delay = randInt(policy.minDelayMs, policy.maxDelayMs);
      await sleep(delay);
    }
  }

  return { fragments, signatures };
}

// ─── Unshielding / settlement ──────────────────────────────────────────────

export interface UnshieldArgs {
  program: Program<CivitasEphemeral>;
  base: AnchorProvider;
  ephemeral: AnchorProvider;
  employeeSigner: Keypair;
  treasury: PublicKey;
  employeeState: PublicKey;
  employeeShieldedAta: PublicKey;
  employeePersonalAta: PublicKey;
  amount: BN;
}

/**
 * Two-step settlement:
 *   1. On the ER, call `unshield_settlement(amount)` which records the
 *      pending withdrawal and commits + undelegates the employee state PDA.
 *   2. After the commit lands on base, call `withdraw_to_personal` which
 *      moves `amount` from the shielded ATA into the employee's personal ATA.
 *
 * The shielded ATA also needs to be undelegated for the base-layer transfer
 * to succeed — the caller should pair this with a separate token-account
 * undelegation tx (typically committed and undelegated in the same ER tx).
 */
export async function unshieldEmployeeBalance(
  args: UnshieldArgs,
): Promise<{ erSig: string; commitSig: string; baseSig: string }> {
  // Step 1: ER instruction — schedules unshield + commits + undelegates PDA.
  const [permission] = derivePermission(args.employeeState);

  const erIx = await args.program.methods
    .unshieldSettlement(args.amount)
    .accountsPartial({
      employeeSigner: args.employeeSigner.publicKey,
      employeeState: args.employeeState,
      permission,
      permissionProgram: PERMISSION_PROGRAM_ID,
      magicContext: MAGIC_CONTEXT_ID,
      magicProgram: MAGIC_PROGRAM_ID,
    })
    .instruction();

  const erTx = new Transaction().add(erIx);
  erTx.feePayer = args.employeeSigner.publicKey;
  erTx.recentBlockhash = (
    await args.ephemeral.connection.getLatestBlockhash()
  ).blockhash;
  erTx.sign(args.employeeSigner);

  const erSig = await args.ephemeral.connection.sendRawTransaction(erTx.serialize(), {
    skipPreflight: true,
  });
  await args.ephemeral.connection.confirmTransaction(erSig, "confirmed");

  // Step 2: wait for commit to land on base layer.
  const commitSig = await GetCommitmentSignature(erSig, args.ephemeral.connection);
  await args.base.connection.confirmTransaction(commitSig, "confirmed");

  // Step 3: base-layer withdrawal from shielded ATA -> personal ATA.
  const baseIx = await args.program.methods
    .withdrawToPersonal()
    .accountsPartial({
      employeeSigner: args.employeeSigner.publicKey,
      employeeState: args.employeeState,
      employeeShieldedAta: args.employeeShieldedAta,
      employeePersonalAta: args.employeePersonalAta,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();

  const baseSig = await args.base.sendAndConfirm(
    new Transaction().add(baseIx),
    [args.employeeSigner],
  );

  return { erSig, commitSig, baseSig };
}

// ─── Treasury session close ────────────────────────────────────────────────

export async function closeTreasurySession(
  program: Program<CivitasEphemeral>,
  ephemeral: AnchorProvider,
  authority: Keypair,
): Promise<string> {
  const [treasury] = deriveTreasury(program.programId, authority.publicKey);
  const [permission] = derivePermission(treasury);

  const ix = await program.methods
    .closeTreasurySession()
    .accountsPartial({
      authority: authority.publicKey,
      treasury,
      permission,
      permissionProgram: PERMISSION_PROGRAM_ID,
      magicContext: MAGIC_CONTEXT_ID,
      magicProgram: MAGIC_PROGRAM_ID,
    })
    .instruction();

  const tx = new Transaction().add(ix);
  tx.feePayer = authority.publicKey;
  tx.recentBlockhash = (await ephemeral.connection.getLatestBlockhash()).blockhash;
  tx.sign(authority);

  const sig = await ephemeral.connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: true,
  });
  await ephemeral.connection.confirmTransaction(sig, "confirmed");
  return sig;
}

// ─── Top-level entry: full payroll cycle ───────────────────────────────────

/**
 * Reference end-to-end run. Loads the program from the workspace, onboards
 * the pool if needed, and disburses to every employee in parallel.
 *
 * Run with:
 *   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
 *   ANCHOR_WALLET=~/.config/solana/id.json \
 *   ts-node client/civitas-disburse.ts
 */
export async function runPayrollCycle(opts: {
  mint: PublicKey;
  attestor: Keypair;
  employeesWithAmounts: Array<{ wallet: PublicKey; amount: BN }>;
  perEmployeeLimit: BN;
  dailyLimit: BN;
}): Promise<void> {
  const base = AnchorProvider.env();
  anchor.setProvider(base);
  const program = anchor.workspace.civitasEphemeral as Program<CivitasEphemeral>;
  const wallet = base.wallet as Wallet;
  const authority = wallet.payer;

  const { ephemeral } = await buildProviders(wallet);

  const employees = opts.employeesWithAmounts.map((e) => e.wallet);
  const { treasury, treasuryAta, employees: registered } = await onboardPayrollPool({
    program,
    base,
    authority,
    attestor: opts.attestor,
    mint: opts.mint,
    perEmployeeLimit: opts.perEmployeeLimit,
    dailyLimit: opts.dailyLimit,
    employees,
  });

  // Disburse to each employee in parallel — each fragment series is independent,
  // and the validator linearizes ordering inside the ER.
  await Promise.all(
    registered.map((reg, i) =>
      disbursePrivatePayroll({
        program,
        ephemeral,
        authoritySigner: authority,
        treasury,
        treasuryAta,
        employee: reg.employee,
        employeeState: reg.employeeState,
        employeeShieldedAta: reg.shieldedAta,
        totalAmount: opts.employeesWithAmounts[i].amount,
      }),
    ),
  );
}

if (require.main === module) {
  const mintStr = process.env.CIVITAS_MINT;
  const attestorPath = process.env.CIVITAS_ATTESTOR_KEYPAIR;
  if (!mintStr || !attestorPath) {
    console.error(
      "Set CIVITAS_MINT and CIVITAS_ATTESTOR_KEYPAIR before running this entrypoint.",
    );
    process.exit(1);
  }
  const fs = require("fs") as typeof import("fs");
  const attestor = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(attestorPath, "utf-8"))),
  );
  const mint = new PublicKey(mintStr);

  runPayrollCycle({
    mint,
    attestor,
    perEmployeeLimit: new BN(5_000_000_000), // 5000 USDC at 6 decimals
    dailyLimit: new BN(100_000_000_000),
    employeesWithAmounts: [],
  })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
