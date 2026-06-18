/**
 * /api/payroll/disburse
 *
 * Production disbursement orchestrator. Chains:
 *   1. Compliance verdict (Nillion/Chainalysis) — already attested on-chain
 *      via /api/payroll/attest before this is called; we re-verify the
 *      attestation timestamp is fresh.
 *   2. civitas_ephemeral::authorize_disburse — atomic compliance + limits
 *      gate + PDA-signed SPL release from treasury ATA into the employer's
 *      working ATA. This and step 3 ride in ONE base-layer tx.
 *   3. MagicBlock /v1/spl/transfer — encrypted-queue private payment from
 *      the employer's working ATA into the queue. The TEE-side crank
 *      decrypts the recipient + jitter/split policy and settles to the
 *      employee's wallet ATA in seconds.
 *
 * The combined tx is returned as an unsigned base64 blob. The employer's
 * wallet signs once and submits to the base RPC. Atomicity guarantees that
 * if the encrypted-queue ix fails for any reason, the on-chain authorization
 * reverts and the funds stay shielded.
 *
 * POST body:
 *   {
 *     employer:  string  (base58 pubkey)
 *     employee:  string  (base58 pubkey — settles to their wallet ATA)
 *     amount:    string  (integer base units; for 6-decimal mint, 1 USDC = "1000000")
 *     mint?:     string  (defaults to CIVITAS_ER_MINT)
 *     split?:    number  (queue fragmentation, default 5)
 *     minDelayMs?: number (default 500)
 *     maxDelayMs?: number (default 30000)
 *     clientRefId?: string (idempotency hint for the crank)
 *   }
 *
 * Returns:
 *   {
 *     transactionBase64: string   (unsigned, includes BOTH ixs)
 *     recentBlockhash:   string
 *     lastValidBlockHeight: number
 *     requiredSigners:   string[]
 *     queueValidator:    string
 *     receiptId:         string   (pre-allocated; client passes this to
 *                                  /api/payroll/receipts on submit-success)
 *   }
 */

import { NextRequest, NextResponse } from "next/server";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { randomUUID } from "node:crypto";

import {
  buildAuthorizeDisburse,
  CIVITAS_ER_MINT,
  CIVITAS_EPHEMERAL_PROGRAM_ID,
  fetchEmployerTreasury,
} from "@/lib/civitas-ephemeral-client";
import {
  buildPrivateTransferTx,
  getPrivateValidator,
  SOLANA_RPC,
  MagicBlockError,
} from "@/lib/server/magicblock-private-payments";

export const runtime = "nodejs";

function err(message: string, status = 400, extras?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extras }, { status });
}

function asBigInt(value: unknown, field: string): bigint {
  if (typeof value === "bigint") return value;
  const s = typeof value === "string" ? value : String(value ?? "");
  if (!/^\d+$/.test(s)) {
    throw new Error(`${field} must be an integer base-units string; got ${JSON.stringify(value)}`);
  }
  return BigInt(s);
}

interface DisburseBody {
  employer: string;
  employee: string;
  amount: string | number;
  mint?: string;
  split?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
  clientRefId?: string;
}

export async function POST(req: NextRequest) {
  let body: DisburseBody;
  try {
    body = (await req.json()) as DisburseBody;
  } catch {
    return err("invalid JSON body");
  }
  if (!body.employer || !body.employee || body.amount == null) {
    return err("required: employer, employee, amount");
  }

  let employer: PublicKey;
  let employee: PublicKey;
  let amount: bigint;
  let mintPk: PublicKey;
  try {
    employer = new PublicKey(body.employer);
    employee = new PublicKey(body.employee);
    amount = asBigInt(body.amount, "amount");
    mintPk = body.mint ? new PublicKey(body.mint) : CIVITAS_ER_MINT;
  } catch (e) {
    return err((e as Error).message);
  }

  const conn = new Connection(SOLANA_RPC, "confirmed");

  // ── 1. Verify treasury exists + compliance is fresh ─────────────────────
  // The on-chain `authorize_disburse` enforces this too, but a server-side
  // pre-check gives the user a clean error before they spend signature.
  const treasury = await fetchEmployerTreasury(conn, employer);
  if (!treasury) {
    return err("Treasury not initialized for this employer. Run /employer setup first.", 409);
  }
  if (!treasury.mint.equals(mintPk)) {
    return err(
      `Treasury was initialized for mint ${treasury.mint.toBase58()} but disburse asked for ${mintPk.toBase58()}`,
      400,
    );
  }
  const attestedAt = treasury.complianceAttestedAt.toNumber();
  const ageSecs = Math.floor(Date.now() / 1000) - attestedAt;
  const MAX_AGE = 86_400; // mirrors the on-chain constant
  if (attestedAt === 0) {
    return err("Compliance not attested yet — run /api/compliance + attest_compliance first.", 409);
  }
  if (ageSecs > MAX_AGE) {
    return err(
      `Compliance attestation stale (${ageSecs}s old, max ${MAX_AGE}s). Re-attest before disbursing.`,
      409,
      { ageSecs, maxAgeSecs: MAX_AGE },
    );
  }

  // Per-employee + daily-cap also pre-checked server-side for nicer errors.
  if (amount > BigInt(treasury.perEmployeeLimit.toString())) {
    return err(
      `Amount ${amount} exceeds per-employee limit ${treasury.perEmployeeLimit.toString()}`,
      400,
    );
  }
  const todayIdx = Math.floor(Date.now() / 1000 / 86_400);
  const dailyAlready =
    treasury.dailyCapDay.toNumber() === todayIdx
      ? BigInt(treasury.dailyDisbursed.toString())
      : 0n;
  if (dailyAlready + amount > BigInt(treasury.dailyLimit.toString())) {
    return err(
      `Daily cap would be exceeded: ${dailyAlready + amount} > ${treasury.dailyLimit.toString()}`,
      400,
    );
  }

  // ── 2. Build the on-chain authorization ix ──────────────────────────────
  let authorizeIx;
  try {
    authorizeIx = await buildAuthorizeDisburse({
      authority: employer,
      recipient: employee,
      amount,
      mint: mintPk,
    });
  } catch (e) {
    return err(`failed to build authorize ix: ${(e as Error).message}`, 500);
  }

  // ── 3. Build the MagicBlock encrypted-queue ix(s) ───────────────────────
  // The employer signs as `from`. After authorize_disburse runs in the same
  // tx, the employer's working ATA holds `amount`; the queue ix takes it.
  let queueIxs;
  let validator: PublicKey;
  try {
    validator = await getPrivateValidator();
    const queueTx = await buildPrivateTransferTx(
      employer.toBase58(),
      employee.toBase58(),
      amount,
      mintPk.toBase58(),
      {
        split: body.split ?? 5,
        minDelayMs: body.minDelayMs ?? 500,
        maxDelayMs: body.maxDelayMs ?? 30_000,
        clientRefId: body.clientRefId ? BigInt(body.clientRefId) : undefined,
      },
    );
    // buildPrivateTransferTx packs ixs into a Transaction blob, but here we
    // need the raw ixs to combine with our authorize ix. Reuse the SDK call
    // it does internally by extracting from a re-deserialized tx.
    const { transferSpl } = await import("@magicblock-labs/ephemeral-rollups-sdk");
    queueIxs = await transferSpl(employer, employee, mintPk, amount, {
      visibility: "private",
      fromBalance: "base",
      toBalance: "base",
      validator,
      payer: employer,
      initIfMissing: false,
      // Both ATAs MUST exist before the crank can settle. We don't init in
      // the disburse tx (size limit); a separate /api/payroll/prepare-atas
      // endpoint creates them off the hot path.
      initAtasIfMissing: false,
      initVaultIfMissing: false,
      privateTransfer: {
        split: body.split ?? 5,
        minDelayMs: BigInt(body.minDelayMs ?? 500),
        maxDelayMs: BigInt(body.maxDelayMs ?? 30_000),
        clientRefId: body.clientRefId ? BigInt(body.clientRefId) : undefined,
      },
    });
  } catch (e) {
    if (e instanceof MagicBlockError) {
      return err(`MagicBlock: ${e.message}`, e.status ?? 502);
    }
    return err(`failed to build queue ix: ${(e as Error).message}`, 500);
  }

  // ── 4. Combine into a single base-layer tx ──────────────────────────────
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
  const tx = new Transaction();
  tx.feePayer = employer;
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  // authorize_disburse MUST be first — it releases SPL into the working ATA
  // that the next ix(s) consume.
  tx.add(authorizeIx);
  for (const ix of queueIxs) tx.add(ix);

  // Tx-size sanity. The base→base private transfer queue produces 2 ixs
  // (~210 bytes payload) when init flags are false; plus our authorize_disburse
  // ix (~145 bytes). Combined sits comfortably under the 1232 limit.
  const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  if (serialized.length > 1232) {
    return err(
      `combined tx exceeds size limit (${serialized.length} > 1232). ` +
        `Reduce split count, or skip init flags by pre-warming vault/ATAs.`,
      500,
    );
  }

  // Pre-allocate a receipt id so the client can record metadata immediately
  // after wallet submits the tx — we don't want races on settlement polling.
  const receiptId = randomUUID();

  return NextResponse.json({
    success: true,
    receiptId,
    transactionBase64: Buffer.from(serialized).toString("base64"),
    recentBlockhash: blockhash,
    lastValidBlockHeight,
    requiredSigners: [employer.toBase58()],
    queueValidator: validator.toBase58(),
    program: CIVITAS_EPHEMERAL_PROGRAM_ID.toBase58(),
    ixCount: tx.instructions.length,
    txBytes: serialized.length,
  });
}

export async function GET() {
  return NextResponse.json({
    name: "civitas-disburse",
    description:
      "POST { employer, employee, amount, [mint, split, minDelayMs, maxDelayMs] } " +
      "→ unsigned tx combining on-chain authorize_disburse + MagicBlock encrypted-queue ix.",
  });
}
