/**
 * /api/payroll/register-crank
 *
 * Submits `ensureTransferQueueCrankIx` (EphemeralSplToken disc 17) for the
 * current (mint, validator) transfer queue, sent on the ER with the
 * employer's TEE auth token.
 *
 * This is the step that registers the queue with MagicBlock's task
 * scheduler — without it, deposited entries persist forever because the
 * validator's crank loop has no task referencing the queue.
 *
 * `ensureTransferQueueReady` now calls this automatically on init. This
 * endpoint exists for retroactively registering queues created by older
 * code paths that didn't include the registration step.
 *
 *   GET  → returns the queue PDA + magicFeeVault that POST would target.
 *          Useful for verifying the call before triggering it.
 *   POST → submits the registration ix. Idempotent — if the queue is
 *          already registered, the program's error is caught and the
 *          response reports it without failing.
 */

import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import {
  deriveTransferQueue,
  magicFeeVaultPdaFromValidator,
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import {
  registerQueueCrank,
  getEmployerKeypair,
} from "@/lib/server/magicblock-auth";
import {
  assertMagicBlockHealthy,
  getPrivateValidator,
} from "@/lib/server/magicblock-private-payments";

export const runtime = "nodejs";

const DEFAULT_MINT =
  process.env.NEXT_PUBLIC_MAGICBLOCK_USDC_MINT ||
  process.env.NEXT_PUBLIC_USDC_MINT ||
  "";

function err(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function resolveMint(raw: string | null): string | null {
  const v = (raw && raw.trim()) || DEFAULT_MINT;
  if (!v) return null;
  try {
    new PublicKey(v);
    return v;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const mint = resolveMint(url.searchParams.get("mint"));
  if (!mint) return err("mint query param required (or set NEXT_PUBLIC_MAGICBLOCK_USDC_MINT)");

  try {
    await assertMagicBlockHealthy();
  } catch (e) {
    return err(`MagicBlock unhealthy: ${(e as Error).message}`, 503);
  }

  const validator = await getPrivateValidator();
  const mintPk = new PublicKey(mint);
  const [queue] = deriveTransferQueue(mintPk, validator);
  const magicFeeVault = magicFeeVaultPdaFromValidator(validator);

  return NextResponse.json({
    mint,
    validator: validator.toBase58(),
    queue: queue.toBase58(),
    magicFeeVault: magicFeeVault.toBase58(),
    magicContext: MAGIC_CONTEXT_ID.toBase58(),
    magicProgram: MAGIC_PROGRAM_ID.toBase58(),
    note:
      "POST to this endpoint to submit ensureTransferQueueCrankIx on the ER. " +
      "Idempotent — the program treats double-registration as a harmless no-op " +
      "and we surface its error without failing the response.",
  });
}

interface RegisterBody {
  /** Optional override; defaults to NEXT_PUBLIC_MAGICBLOCK_USDC_MINT. */
  mint?: string;
}

export async function POST(req: NextRequest) {
  let body: RegisterBody = {};
  try {
    body = await req.json();
  } catch {
    // Empty body is fine — we'll fall through to the default mint.
  }

  const mint = resolveMint(body.mint ?? null);
  if (!mint) return err("mint required (or set NEXT_PUBLIC_MAGICBLOCK_USDC_MINT)");

  try {
    await assertMagicBlockHealthy();
  } catch (e) {
    return err(`MagicBlock unhealthy: ${(e as Error).message}`, 503);
  }

  const validator = await getPrivateValidator();
  const mintPk = new PublicKey(mint);
  const [queue] = deriveTransferQueue(mintPk, validator);
  const payer = getEmployerKeypair().publicKey;

  const result = await registerQueueCrank(queue, validator, payer);

  return NextResponse.json({
    ok: result.ok,
    queue: queue.toBase58(),
    validator: validator.toBase58(),
    mint,
    signature: result.signature,
    error: result.error,
    note: result.ok
      ? "Crank registration submitted on the ER. Re-check /api/payroll/queue-state — " +
        "if the validator's crank service is healthy, queued entries should drain " +
        "within ~30s and the recipient ATA balance will increase."
      : "Registration failed. If the error indicates the queue is already registered, " +
        "this is harmless and means a prior call already wired the task. Otherwise " +
        "the error is the actual server-side reason the validator isn't draining.",
  });
}
