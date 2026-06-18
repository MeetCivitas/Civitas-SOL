/**
 * frontend/lib/civitas-ephemeral-client.ts
 *
 * Raw web3.js client for the `civitas_ephemeral` v2 program. Uses manual
 * Anchor discriminators + Borsh encoding so we don't need @coral-xyz/anchor
 * or a generated IDL in the frontend bundle.
 *
 * Deployed program: BW2wwxbsSjixSfXNGoD9ajoUq8394ZkB2Fn9PusXjJfs (devnet)
 *
 * Instructions:
 *   1. initialize_payroll_pool — create treasury PDA + ATA
 *   2. attest_compliance       — record fresh compliance verdict
 *   3. shield_funds            — employer ATA -> treasury ATA
 *   4. authorize_disburse      — compliance + limits gate; PDA-signed SPL
 *                                release from treasury ATA into employer's
 *                                working ATA, where MagicBlock's encrypted
 *                                queue ix picks it up in the SAME tx
 *   5. emergency_unshield      — admin reclaim from treasury back to wallet
 */

import {
  Connection,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import BN from "bn.js";

// ─── Constants ──────────────────────────────────────────────────────────────

export const CIVITAS_EPHEMERAL_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_CIVITAS_EPHEMERAL_PROGRAM_ID ??
    "BW2wwxbsSjixSfXNGoD9ajoUq8394ZkB2Fn9PusXjJfs",
);

/** Default mint Civitas treats as "USDC" on devnet. */
export const CIVITAS_ER_MINT = new PublicKey(
  process.env.NEXT_PUBLIC_CIVITAS_ER_MINT ??
    "ZYyofZ4gtjJqHZN7dKMeX8CyuzELq4mj266JCooTm3A",
);

export const TREASURY_SEED = Buffer.from("civ_treasury");

// ─── Discriminators (sha256("global:<method>")[0..8]) ───────────────────────

let _discriminators: Record<string, Uint8Array> | null = null;

async function ensureDiscriminators() {
  if (_discriminators) return _discriminators;
  const names = [
    "initialize_payroll_pool",
    "attest_compliance",
    "shield_funds",
    "authorize_disburse",
    "emergency_unshield",
  ];
  // WebCrypto is in every modern browser and Node 19+. We avoid `node:crypto`
  // because Turbopack doesn't resolve node: URIs in client bundles.
  const subtle = (globalThis as any).crypto?.subtle as SubtleCrypto;
  if (!subtle) throw new Error("WebCrypto unavailable — browser is too old");
  const out: Record<string, Uint8Array> = {};
  for (const n of names) {
    const buf = await subtle.digest("SHA-256", new TextEncoder().encode(`global:${n}`));
    out[n] = new Uint8Array(buf).slice(0, 8);
  }
  _discriminators = out;
  return out;
}

// ─── Borsh primitives ───────────────────────────────────────────────────────

function u64LE(n: bigint | number | BN): Buffer {
  // Manual little-endian — browser Buffer polyfill lacks writeBigUInt64LE.
  let v = typeof n === "bigint" ? n : BN.isBN(n) ? BigInt(n.toString()) : BigInt(n);
  if (v < 0n) throw new Error("u64LE: value must be non-negative");
  if (v > 0xffffffffffffffffn) throw new Error("u64LE: value exceeds u64 max");
  const buf = Buffer.alloc(8);
  for (let i = 0; i < 8; i++) {
    buf[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return buf;
}

function i64LE(n: bigint | number | BN): Buffer {
  // For now we don't need negative; assume non-negative i64.
  return u64LE(n);
}

function concat(...parts: (Buffer | Uint8Array)[]): Buffer {
  return Buffer.concat(parts.map((p) => (Buffer.isBuffer(p) ? p : Buffer.from(p))));
}

// ─── PDA derivation ─────────────────────────────────────────────────────────

export function deriveTreasury(authority: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [TREASURY_SEED, authority.toBuffer()],
    CIVITAS_EPHEMERAL_PROGRAM_ID,
  );
}

export function deriveTreasuryAta(authority: PublicKey, mint = CIVITAS_ER_MINT): PublicKey {
  const [treasury] = deriveTreasury(authority);
  return getAssociatedTokenAddressSync(mint, treasury, true);
}

// ─── Instruction builders ───────────────────────────────────────────────────

export interface InitializePayrollPoolArgs {
  authority: PublicKey;
  mint?: PublicKey;
  perEmployeeLimit: bigint;
  dailyLimit: bigint;
  complianceAttestor: PublicKey;
}

export async function buildInitializePayrollPool(
  args: InitializePayrollPoolArgs,
): Promise<TransactionInstruction> {
  const mint = args.mint ?? CIVITAS_ER_MINT;
  const [treasury] = deriveTreasury(args.authority);
  const treasuryAta = getAssociatedTokenAddressSync(mint, treasury, true);
  const discs = await ensureDiscriminators();
  const data = concat(
    discs["initialize_payroll_pool"],
    u64LE(args.perEmployeeLimit),
    u64LE(args.dailyLimit),
    args.complianceAttestor.toBuffer(),
  );
  return new TransactionInstruction({
    programId: CIVITAS_EPHEMERAL_PROGRAM_ID,
    keys: [
      { pubkey: args.authority,              isSigner: true,  isWritable: true  },
      { pubkey: mint,                        isSigner: false, isWritable: false },
      { pubkey: treasury,                    isSigner: false, isWritable: true  },
      { pubkey: treasuryAta,                 isSigner: false, isWritable: true  },
      { pubkey: TOKEN_PROGRAM_ID,            isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId,     isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY,          isSigner: false, isWritable: false },
    ],
    data,
  });
}

export interface AttestComplianceArgs {
  attestor: PublicKey;
  treasury: PublicKey;
  passed: boolean;
  jurisdictionCode: Uint8Array; // exactly 4 bytes
}

export async function buildAttestCompliance(
  args: AttestComplianceArgs,
): Promise<TransactionInstruction> {
  if (args.jurisdictionCode.length !== 4) {
    throw new Error("jurisdictionCode must be exactly 4 bytes");
  }
  const discs = await ensureDiscriminators();
  const data = concat(
    discs["attest_compliance"],
    Buffer.from([args.passed ? 1 : 0]),
    Buffer.from(args.jurisdictionCode),
  );
  return new TransactionInstruction({
    programId: CIVITAS_EPHEMERAL_PROGRAM_ID,
    keys: [
      { pubkey: args.attestor, isSigner: true,  isWritable: false },
      { pubkey: args.treasury, isSigner: false, isWritable: true  },
    ],
    data,
  });
}

export interface ShieldFundsArgs {
  authority: PublicKey;
  sourceTokenAccount: PublicKey;
  amount: bigint;
  mint?: PublicKey;
}

export async function buildShieldFunds(
  args: ShieldFundsArgs,
): Promise<TransactionInstruction> {
  const mint = args.mint ?? CIVITAS_ER_MINT;
  const [treasury] = deriveTreasury(args.authority);
  const treasuryAta = getAssociatedTokenAddressSync(mint, treasury, true);
  const discs = await ensureDiscriminators();
  return new TransactionInstruction({
    programId: CIVITAS_EPHEMERAL_PROGRAM_ID,
    keys: [
      { pubkey: args.authority,          isSigner: true,  isWritable: true  },
      { pubkey: treasury,                isSigner: false, isWritable: true  },
      { pubkey: args.sourceTokenAccount, isSigner: false, isWritable: true  },
      { pubkey: treasuryAta,             isSigner: false, isWritable: true  },
      { pubkey: TOKEN_PROGRAM_ID,        isSigner: false, isWritable: false },
    ],
    data: concat(discs["shield_funds"], u64LE(args.amount)),
  });
}

export interface AuthorizeDisburseArgs {
  authority: PublicKey;
  recipient: PublicKey;
  amount: bigint;
  mint?: PublicKey;
}

/**
 * Builds the on-chain compliance + limits gate. Must be prepended to the
 * MagicBlock encrypted-queue ix in the same transaction; the queue ix
 * consumes the funds released into the employer's working ATA by this ix.
 */
export async function buildAuthorizeDisburse(
  args: AuthorizeDisburseArgs,
): Promise<TransactionInstruction> {
  const mint = args.mint ?? CIVITAS_ER_MINT;
  const [treasury] = deriveTreasury(args.authority);
  const treasuryAta = getAssociatedTokenAddressSync(mint, treasury, true);
  const authorityAta = getAssociatedTokenAddressSync(mint, args.authority);
  const discs = await ensureDiscriminators();
  const data = concat(
    discs["authorize_disburse"],
    u64LE(args.amount),
    args.recipient.toBuffer(),
  );
  return new TransactionInstruction({
    programId: CIVITAS_EPHEMERAL_PROGRAM_ID,
    keys: [
      { pubkey: args.authority,   isSigner: true,  isWritable: true  },
      { pubkey: treasury,         isSigner: false, isWritable: true  },
      { pubkey: treasuryAta,      isSigner: false, isWritable: true  },
      { pubkey: authorityAta,     isSigner: false, isWritable: true  },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });
}

export interface EmergencyUnshieldArgs {
  authority: PublicKey;
  amount: bigint;
  mint?: PublicKey;
}

export async function buildEmergencyUnshield(
  args: EmergencyUnshieldArgs,
): Promise<TransactionInstruction> {
  const mint = args.mint ?? CIVITAS_ER_MINT;
  const [treasury] = deriveTreasury(args.authority);
  const treasuryAta = getAssociatedTokenAddressSync(mint, treasury, true);
  const authorityAta = getAssociatedTokenAddressSync(mint, args.authority);
  const discs = await ensureDiscriminators();
  return new TransactionInstruction({
    programId: CIVITAS_EPHEMERAL_PROGRAM_ID,
    keys: [
      { pubkey: args.authority,   isSigner: true,  isWritable: true  },
      { pubkey: treasury,         isSigner: false, isWritable: true  },
      { pubkey: treasuryAta,      isSigner: false, isWritable: true  },
      { pubkey: authorityAta,     isSigner: false, isWritable: true  },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: concat(discs["emergency_unshield"], u64LE(args.amount)),
  });
}

// ─── Account decoders ───────────────────────────────────────────────────────

export interface EmployerTreasury {
  authority: PublicKey;
  mint: PublicKey;
  treasuryTokenAccount: PublicKey;
  totalShielded: BN;
  totalDisbursed: BN;
  perEmployeeLimit: BN;
  dailyLimit: BN;
  dailyDisbursed: BN;
  dailyCapDay: BN;
  complianceAttestor: PublicKey;
  complianceAttestedAt: BN;
  jurisdictionCode: Uint8Array;
  bump: number;
}

export async function fetchEmployerTreasury(
  connection: Connection,
  authority: PublicKey,
): Promise<EmployerTreasury | null> {
  const [treasury] = deriveTreasury(authority);
  const info = await connection.getAccountInfo(treasury);
  if (!info) return null;
  // Sanity: program-owned and at least the minimum size.
  if (!info.owner.equals(CIVITAS_EPHEMERAL_PROGRAM_ID)) return null;
  const data = info.data;
  // 8 disc + 3 pubkeys (96) + 6 u64 (48) + 1 pubkey (32) + 1 i64 (8)
  // + 4 jurisdiction + 1 bump + 1 i64 (daily_cap_day) = 198 bytes
  if (data.length < 198) return null;
  let o = 8;
  const readPk = (): PublicKey => {
    const pk = new PublicKey(data.subarray(o, o + 32));
    o += 32;
    return pk;
  };
  const readBN = (bytes: number): BN => {
    const v = new BN(data.subarray(o, o + bytes), "le");
    o += bytes;
    return v;
  };
  const authorityPk = readPk();
  const mint = readPk();
  const ata = readPk();
  const totalShielded = readBN(8);
  const totalDisbursed = readBN(8);
  const perEmployeeLimit = readBN(8);
  const dailyLimit = readBN(8);
  const dailyDisbursed = readBN(8);
  const dailyCapDay = readBN(8);
  const complianceAttestor = readPk();
  const complianceAttestedAt = readBN(8);
  const jurisdictionCode = Uint8Array.from(data.subarray(o, o + 4));
  o += 4;
  const bump = data[o];
  return {
    authority: authorityPk,
    mint,
    treasuryTokenAccount: ata,
    totalShielded,
    totalDisbursed,
    perEmployeeLimit,
    dailyLimit,
    dailyDisbursed,
    dailyCapDay,
    complianceAttestor,
    complianceAttestedAt,
    jurisdictionCode,
    bump,
  };
}
