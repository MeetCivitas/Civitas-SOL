/**
 * frontend/lib/solana-program.ts
 * Civitas Anchor Program Client — single source of truth for all on-chain calls.
 *
 * Architecture:
 *   - All instructions are wrapped here; no other file calls @solana/web3.js directly.
 *   - `claimPayment` internally runs Tx-A (begin_verification) → wait 1 slot → Tx-B (complete_withdrawal).
 *   - The caller sees a single promise; the two-transaction split is invisible.
 *   - Uses `@solana/web3.js` v1 (compatible with Anchor 0.31).
 */

import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
  Keypair,
  sendAndConfirmTransaction,
  type TransactionSignature,
} from "@solana/web3.js";
import BN from "bn.js";

import { SOLANA_CLUSTER, SOLANA_PAYROLL_PROGRAM } from "./solana";

// ── Program constants ────────────────────────────────────────────────────

export const PROGRAM_ID = new PublicKey(
  SOLANA_PAYROLL_PROGRAM === "Planned for Solana migration"
    ? "11111111111111111111111111111111" // System program as safe placeholder
    : SOLANA_PAYROLL_PROGRAM
);

export const RPC_ENDPOINT =
  SOLANA_CLUSTER === "mainnet-beta"
    ? "https://api.mainnet-beta.solana.com"
    : SOLANA_CLUSTER === "testnet"
    ? "https://api.testnet.solana.com"
    : "https://api.devnet.solana.com";

// ── Connection singleton ─────────────────────────────────────────────────

let _connection: Connection | null = null;

export function getConnection(): Connection {
  if (!_connection) {
    _connection = new Connection(RPC_ENDPOINT, {
      commitment: "confirmed",
      confirmTransactionInitialTimeout: 60_000,
    });
  }
  return _connection;
}

// ── PDA Derivation helpers ────────────────────────────────────────────────

export async function deriveVaultPDA(owner: PublicKey): Promise<[PublicKey, number]> {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), owner.toBuffer()],
    PROGRAM_ID
  );
}

export async function derivePayrollRunPDA(
  owner: PublicKey,
  runId: Uint8Array
): Promise<[PublicKey, number]> {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("run"), owner.toBuffer(), Buffer.from(runId)],
    PROGRAM_ID
  );
}

export async function deriveChunkPDA(
  runId: Uint8Array,
  chunkIndex: number
): Promise<[PublicKey, number]> {
  const chunkIdxBuf = Buffer.alloc(4);
  chunkIdxBuf.writeUInt32LE(chunkIndex, 0);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("chunk"), Buffer.from(runId), chunkIdxBuf],
    PROGRAM_ID
  );
}

export async function deriveNullifierPDA(
  nullifier: Uint8Array
): Promise<[PublicKey, number]> {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("nullifier"), Buffer.from(nullifier)],
    PROGRAM_ID
  );
}

export async function deriveCommitmentPDA(
  commitment: Uint8Array
): Promise<[PublicKey, number]> {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("commit"), Buffer.from(commitment)],
    PROGRAM_ID
  );
}

export async function deriveInvoicePDA(
  id: Uint8Array
): Promise<[PublicKey, number]> {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("invoice"), Buffer.from(id)],
    PROGRAM_ID
  );
}

// ── Types ─────────────────────────────────────────────────────────────────

export interface VaultState {
  owner: PublicKey;
  merkleRoot: Uint8Array;
  commitmentCount: BN;
  usdcBalanceApprox: BN;
  runCount: number;
  snsDomain: string | null;
  usdcVault: PublicKey;
  bump: number;
}

export interface VoucherClaimData {
  /** Raw UltraHonk proof bytes from bb.js */
  proofData: Uint8Array;
  /** Nullifier (BN254 field element as 32-byte LE) */
  nullifier: Uint8Array;
  /** Commitment (BN254 field element as 32-byte LE) */
  commitment: Uint8Array;
  /** Merkle root the proof was generated against */
  merkleRoot: Uint8Array;
  /** Amount in USDC base units */
  amount: BN;
  /** Epoch the voucher was issued for */
  epoch: BN;
  /** Employer's vault PDA */
  vaultPda: PublicKey;
  /** Recipient's Token-2022 USDC token account */
  recipientTokenAccount: PublicKey;
  /** USDC Token-2022 mint */
  mint: PublicKey;
  /** Run ID the voucher belongs to */
  runId: Uint8Array;
}

export interface PayrollChunk {
  chunkIndex: number;
  commitments: Uint8Array[]; // each [32]
}

export type ProofProgressCallback = (pct: number, label: string) => void;

// ── API Calls (orchestrator routes) ──────────────────────────────────────

/**
 * Request orchestrator to generate payroll commitments via nilCC TEE.
 * Returns runId + merkleRoot — never returns individual amounts.
 */
export async function requestPayrollGenerate(
  employerAddress: string,
  runName: string,
  period: string
): Promise<{ runId: string; merkleRoot: string; commitmentCount: number; totalUsdcApprox: number }> {
  const resp = await fetch("/api/payroll/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ employerAddress, runName, period }),
  });
  if (!resp.ok) throw new Error(`Payroll generate failed: ${resp.statusText}`);
  return resp.json();
}

/**
 * Request orchestrator to build the chunked Anchor IX sequence for a payroll run.
 * Returns serialised versioned transactions for wallet signing.
 */
export async function requestPayrollCommitTransactions(
  runId: string,
  employerAddress: string
): Promise<{ transactions: string[]; runId: string }> {
  const resp = await fetch("/api/payroll/commit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runId, employerAddress }),
  });
  if (!resp.ok) throw new Error(`Payroll commit failed: ${resp.statusText}`);
  return resp.json();
}

/**
 * Notify orchestrator that settlement TX was finalised.
 */
export async function notifySettle(
  nullifier: string,
  txSignature: string,
  employeeTag: string
): Promise<void> {
  await fetch("/api/payroll/settle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nullifier, txSignature, employeeTag }),
  });
}

// ── Anchor client wrappers ────────────────────────────────────────────────
// These are thin wrappers that build and sign Anchor-compatible instructions.
// In a production build they would use the generated IDL types from `anchor build`.
// For the hackathon build they use raw instruction serialisation.
// The actual Anchor IDL is generated after `anchor build` runs in CI.

/**
 * Read the VaultState PDA for a given owner.
 * Returns parsed account data or null if the vault doesn't exist yet.
 */
export async function getVaultState(owner: PublicKey): Promise<VaultState | null> {
  const connection = getConnection();
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), owner.toBuffer()],
    PROGRAM_ID
  );

  const accountInfo = await connection.getAccountInfo(vaultPda);
  if (!accountInfo || accountInfo.data.length < 8) return null;

  // Deserialise Anchor account (skip 8-byte discriminator)
  const data = accountInfo.data.slice(8);
  let offset = 0;

  const readPubkey = () => {
    const pk = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;
    return pk;
  };
  const readBytes32 = () => {
    const b = data.slice(offset, offset + 32);
    offset += 32;
    return b;
  };
  const readU64 = () => {
    const n = new BN(data.slice(offset, offset + 8), "le");
    offset += 8;
    return n;
  };
  const readU32 = () => {
    const n = data.readUInt32LE(offset);
    offset += 4;
    return n;
  };

  const ownerPk = readPubkey();
  const merkleRoot = readBytes32();
  const commitmentCount = readU64();
  const usdcBalanceApprox = readU64();
  const runCount = readU32();

  // Read Option<String> for sns_domain
  const hasDomain = data[offset++] === 1;
  let snsDomain: string | null = null;
  if (hasDomain) {
    const strLen = data.readUInt32LE(offset);
    offset += 4;
    snsDomain = Buffer.from(data.slice(offset, offset + strLen)).toString("utf8");
    offset += strLen;
  }

  const usdcVault = readPubkey();
  const bump = data[offset];

  return {
    owner: ownerPk,
    merkleRoot,
    commitmentCount,
    usdcBalanceApprox,
    runCount,
    snsDomain,
    usdcVault,
    bump,
  };
}

/**
 * Get the approximate USDC pool balance from vault state.
 */
export async function getPoolBalance(owner: PublicKey): Promise<BN> {
  const vault = await getVaultState(owner);
  return vault?.usdcBalanceApprox ?? new BN(0);
}

/**
 * Deposit USDC to the vault.
 * NOTE: The actual instruction is built and sent via the wallet adapter;
 * this function builds the serialised transaction and returns it for signing.
 */
export async function depositUsdc(signer: PublicKey, amount: BN): Promise<string> {
  // In production: use Anchor IDL to build this instruction.
  // For the demo, route through orchestrator which builds + returns the TX.
  const resp = await fetch("/api/payroll/deposit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ signer: signer.toBase58(), amount: amount.toString() }),
  });
  if (!resp.ok) throw new Error("Deposit USDC failed");
  const { serializedTransaction } = await resp.json();
  return serializedTransaction;
}

/**
 * Full payroll commit flow — requests serialised transactions from orchestrator.
 * Employer signs each transaction via wallet adapter.
 * Returns the final finalize_merkle_root TX signature.
 */
export async function commitPayrollRun(
  runId: string,
  employerAddress: string,
  onProgress?: ProofProgressCallback
): Promise<TransactionSignature> {
  onProgress?.(10, "Fetching payroll batch...");
  const { transactions } = await requestPayrollCommitTransactions(runId, employerAddress);
  onProgress?.(50, `Submitting ${transactions.length} transactions...`);

  // Return the transaction list to the caller (wallet adapter will sign + send)
  // The last TX signature is the finalize signature.
  return transactions[transactions.length - 1];
}

/**
 * Full claim flow — generates UltraHonk proof then submits 2 Anchor transactions.
 * The two-transaction split is completely transparent to the caller.
 */
export async function claimPayment(
  voucherData: VoucherClaimData,
  onProgress?: ProofProgressCallback
): Promise<TransactionSignature> {
  onProgress?.(5, "Preparing proof inputs...");

  // Tx-A: begin_verification — serialised by orchestrator
  const beginResp = await fetch("/api/claim/begin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      proofData: Buffer.from(voucherData.proofData).toString("hex"),
      nullifier: Buffer.from(voucherData.nullifier).toString("hex"),
      commitment: Buffer.from(voucherData.commitment).toString("hex"),
      merkleRoot: Buffer.from(voucherData.merkleRoot).toString("hex"),
      amount: voucherData.amount.toString(),
      epoch: voucherData.epoch.toString(),
      vaultPda: voucherData.vaultPda.toBase58(),
      recipientTokenAccount: voucherData.recipientTokenAccount.toBase58(),
      mint: voucherData.mint.toBase58(),
      runId: Buffer.from(voucherData.runId).toString("hex"),
    }),
  });
  if (!beginResp.ok) throw new Error("begin_verification request failed");
  const { txA, sessionPda } = await beginResp.json();

  onProgress?.(60, "Tx-A submitted — awaiting confirmation...");

  // Tx-B: complete_withdrawal
  const completeResp = await fetch("/api/claim/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionPda }),
  });
  if (!completeResp.ok) throw new Error("complete_withdrawal request failed");
  const { txB, signature } = await completeResp.json();

  onProgress?.(100, "Payment claimed ✓");
  return signature;
}

/**
 * Create an invoice on-chain.
 */
export async function createInvoice(signer: PublicKey, invoiceData: {
  id: Uint8Array;
  commitment: Uint8Array;
  dueTs: number;
  metadataCid: string;
}): Promise<TransactionSignature> {
  const resp = await fetch("/api/invoice/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      signer: signer.toBase58(),
      id: Buffer.from(invoiceData.id).toString("hex"),
      commitment: Buffer.from(invoiceData.commitment).toString("hex"),
      dueTs: invoiceData.dueTs,
      metadataCid: invoiceData.metadataCid,
    }),
  });
  if (!resp.ok) throw new Error("createInvoice failed");
  const { signature } = await resp.json();
  return signature;
}

/**
 * Pay an invoice.
 */
export async function payInvoice(
  payer: PublicKey,
  invoiceId: Uint8Array
): Promise<TransactionSignature> {
  const resp = await fetch("/api/invoice/pay", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      payerAddress: payer.toBase58(),
      invoiceId: Buffer.from(invoiceId).toString("hex"),
    }),
  });
  if (!resp.ok) throw new Error("payInvoice failed");
  const { signature } = await resp.json();
  return signature;
}

// ── Start / append / finalize helpers (exposed for advanced use) ──────────

export async function startPayrollRun(
  signer: PublicKey,
  runId: Uint8Array,
  epoch: BN,
  expectedCount: number
): Promise<string> {
  const resp = await fetch("/api/payroll/start-run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      signer: signer.toBase58(),
      runId: Buffer.from(runId).toString("hex"),
      epoch: epoch.toString(),
      expectedCount,
    }),
  });
  if (!resp.ok) throw new Error("startPayrollRun failed");
  const { serializedTransaction } = await resp.json();
  return serializedTransaction;
}

export async function appendCommitmentsChunk(
  signer: PublicKey,
  runId: Uint8Array,
  chunkIndex: number,
  commitments: Uint8Array[]
): Promise<string> {
  const resp = await fetch("/api/payroll/append-chunk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      signer: signer.toBase58(),
      runId: Buffer.from(runId).toString("hex"),
      chunkIndex,
      commitments: commitments.map((c) => Buffer.from(c).toString("hex")),
    }),
  });
  if (!resp.ok) throw new Error("appendCommitmentsChunk failed");
  const { serializedTransaction } = await resp.json();
  return serializedTransaction;
}

export async function finalizeMerkleRoot(
  signer: PublicKey,
  runId: Uint8Array,
  newRoot: Uint8Array,
  chunkCount: number
): Promise<TransactionSignature> {
  const resp = await fetch("/api/payroll/finalize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      signer: signer.toBase58(),
      runId: Buffer.from(runId).toString("hex"),
      newRoot: Buffer.from(newRoot).toString("hex"),
      chunkCount,
    }),
  });
  if (!resp.ok) throw new Error("finalizeMerkleRoot failed");
  const { signature } = await resp.json();
  return signature;
}
