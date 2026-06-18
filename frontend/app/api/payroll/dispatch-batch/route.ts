/**
 * /api/payroll/dispatch-batch
 *
 * Wizard-time bulk MagicBlock dispatcher. Replaces the legacy per-employee
 * claim ceremony for runs that want immediate auto-settlement.
 *
 * For each entry in the run, fires a server-signed MagicBlock private
 * transfer from the deployer keypair to the employee's wallet ATA via the
 * official Payments REST gateway (`payments.magicblock.app/v1/spl/transfer`,
 * base→base shuttle path — the same one verified working in
 * `frontend/scripts/eata-poc.mjs`). The TEE-side crank decrypts and
 * delivers in jittered fragments within ~3-30s. No employee action.
 *
 * Returns one settlement entry per employee:
 *   { employee, amount, signature, queuedSplits, error? }
 *
 * Non-fatal: if any single employee fails (e.g. invalid wallet, queue
 * full), we record the error and continue. The caller decides whether to
 * mark the run as fully or partially settled.
 *
 * POST body:
 *   {
 *     runId,
 *     employerAddress,           // for receipt audit trail
 *     companyId,                 // for NilDB voucher status updates
 *     entries: [
 *       { employeeWallet, amountBaseUnits, voucherId? }
 *     ],
 *     mint?,                      // defaults to MAGICBLOCK_USDC_MINT
 *     split?,
 *   }
 */

import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import {
  privateTransferViaRest,
  getEmployerPubkey,
} from "@/lib/server/magicblock-rest-dispatch";

export const runtime = "nodejs";

const USDC_MINT_DEFAULT =
  process.env.NEXT_PUBLIC_MAGICBLOCK_USDC_MINT ??
  process.env.NEXT_PUBLIC_USDC_MINT ??
  "";

interface BatchEntry {
  employeeWallet: string;
  amountBaseUnits: string;
  voucherId?: string;
}

interface BatchBody {
  runId: string;
  employerAddress: string;
  companyId?: string;
  entries: BatchEntry[];
  mint?: string;
  split?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
}

interface SettlementResult {
  employee: string;
  amount: string;
  voucherId?: string;
  signature?: string;
  queuedSplits?: number;
  error?: string;
  recipientAtaCreated?: boolean;
}

function err(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(req: NextRequest) {
  let body: BatchBody;
  try {
    body = (await req.json()) as BatchBody;
  } catch {
    return err("invalid JSON body");
  }
  if (!body.runId || !body.employerAddress || !Array.isArray(body.entries)) {
    return err("required: runId, employerAddress, entries[]");
  }
  if (body.entries.length === 0) {
    return err("entries[] is empty — nothing to dispatch");
  }

  const mintStr = body.mint ?? USDC_MINT_DEFAULT;
  if (!mintStr) return err("mint not provided and no default configured");

  const mintPk = new PublicKey(mintStr);
  const results: SettlementResult[] = [];

  for (const entry of body.entries) {
    const result: SettlementResult = {
      employee: entry.employeeWallet,
      amount: entry.amountBaseUnits,
      voucherId: entry.voucherId,
    };
    try {
      // Validate the recipient pubkey before we ask the gateway.
      // privateTransferViaRest will throw if mint isn't initialised
      // (one-time) and create the recipient ATA on demand.
      new PublicKey(entry.employeeWallet);
      const amount = BigInt(entry.amountBaseUnits);
      if (amount <= 0n) throw new Error("amount must be > 0");

      // Fire the MagicBlock private transfer through the REST gateway —
      // this is the verified-working path from `frontend/scripts/eata-poc.mjs`.
      // base→base shuttle ix path; settles in ~3-30s via the TEE crank.
      const transfer = await privateTransferViaRest(
        entry.employeeWallet,
        amount,
        mintPk.toBase58(),
        {
          split: body.split ?? 4,
          minDelayMs: body.minDelayMs ?? 500,
          maxDelayMs: body.maxDelayMs ?? 4_000,
          clientRefId: `civitas-batch:${body.runId}:${entry.voucherId ?? "-"}`,
        },
      );
      result.signature = transfer.signature;
      result.queuedSplits = body.split ?? 4;
      result.recipientAtaCreated = transfer.recipientAtaCreated ?? false;

      // 3) Best-effort update of the NilDB voucher status to "settled".
      if (body.companyId && entry.voucherId) {
        try {
          const { updateVoucherStatus } = await import("@/lib/server/nillion-server");
          await updateVoucherStatus(
            body.companyId,
            entry.voucherId,
            "settled",
            transfer.signature,
          );
        } catch (nilErr) {
          console.warn(
            `[dispatch-batch] NilDB update failed for ${entry.voucherId}:`,
            (nilErr as Error).message,
          );
        }
      }
    } catch (e) {
      result.error = (e as Error).message;
      console.warn(
        `[dispatch-batch] failed for ${entry.employeeWallet}:`,
        result.error,
      );
    }
    results.push(result);
  }

  const ok = results.filter((r) => r.signature && !r.error).length;
  const failed = results.length - ok;

  return NextResponse.json({
    ok: failed === 0,
    runId: body.runId,
    employer: body.employerAddress,
    deployerPool: getEmployerPubkey(),
    dispatchedCount: ok,
    failedCount: failed,
    results,
    note:
      "Settlements ride the MagicBlock encrypted queue (validator-side crank). " +
      "Funds will appear in recipient ATAs within ~3–30s, randomized + split.",
  });
}
