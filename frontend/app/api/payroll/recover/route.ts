/**
 * /api/payroll/recover
 *
 * Recovery endpoint for USDC stuck in a MagicBlock ER vault when its
 * (mint, validator) transfer queue was rendered un-crankable — e.g. by a
 * permission-program redeploy that broke the SDK version those entries
 * were built with, leaving deposits in the vault but their queue inserts
 * no-ops.
 *
 * `withdrawSpl` runs against the ER (not via the queue), so funds are
 * reclaimable as long as the TEE auth + ER are reachable, even when the
 * crank loop is broken.
 *
 *   GET  ?mint=<base58>          → employer's private (ER) balance for mint
 *                                  + public (base) balance, so you can
 *                                  decide how much to withdraw.
 *   POST { amountBaseUnits,      → calls employerWithdraw(amount, mint).
 *          mint }                  Returns the ER tx signature.
 *
 * `mint` defaults to NEXT_PUBLIC_MAGICBLOCK_USDC_MINT for convenience,
 * but the typical recovery flow passes the OLD mint explicitly (the one
 * whose queue stalled) so you can pull funds out before rotating.
 */

import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import {
  employerWithdraw,
  getEmployerPubkey,
  getEmployerAuthToken,
} from "@/lib/server/magicblock-auth";
import {
  assertMagicBlockHealthy,
  getPublicBalance,
  getPrivateBalance,
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

  const employer = getEmployerPubkey();

  let publicBal: unknown;
  let privateBal: unknown;
  try {
    publicBal = await getPublicBalance(employer, mint);
  } catch (e) {
    publicBal = { error: (e as Error).message };
  }
  try {
    const token = await getEmployerAuthToken();
    privateBal = await getPrivateBalance(employer, mint, token);
  } catch (e) {
    privateBal = { error: (e as Error).message };
  }

  return NextResponse.json({
    employer,
    mint,
    magicBlockPublic: publicBal,
    magicBlockPrivate: privateBal,
    note:
      "The 'magicBlockPrivate.balance' is the recoverable amount sitting in " +
      "the employer's ER vault (ephemeral ATA). POST { amountBaseUnits, mint } " +
      "to withdraw it back to the base USDC ATA.",
  });
}

interface RecoverBody {
  /** Amount to withdraw, in base units. Must be ≤ private balance. */
  amountBaseUnits: string;
  /** Optional. Defaults to NEXT_PUBLIC_MAGICBLOCK_USDC_MINT. */
  mint?: string;
}

export async function POST(req: NextRequest) {
  let body: RecoverBody;
  try {
    body = await req.json();
  } catch {
    return err("invalid JSON body");
  }
  if (!body.amountBaseUnits) return err("amountBaseUnits required");

  let amount: bigint;
  try {
    amount = BigInt(body.amountBaseUnits);
  } catch {
    return err("amountBaseUnits must be a stringified integer");
  }
  if (amount <= 0n) return err("amount must be positive");

  const mint = resolveMint(body.mint ?? null);
  if (!mint) return err("mint required (or set NEXT_PUBLIC_MAGICBLOCK_USDC_MINT)");

  try {
    await assertMagicBlockHealthy();
  } catch (e) {
    return err(`MagicBlock unhealthy: ${(e as Error).message}`, 503);
  }

  let signature: string;
  try {
    const result = await employerWithdraw(amount, mint);
    signature = result.signature;
  } catch (e) {
    return err(`withdraw failed: ${(e as Error).message}`, 502);
  }

  return NextResponse.json({
    ok: true,
    employer: getEmployerPubkey(),
    mint,
    withdrawnBaseUnits: amount.toString(),
    signature,
    note:
      "Withdraw was submitted on the ER. The base-layer USDC balance update " +
      "lands once the ER commits — usually within a few seconds. Re-GET to " +
      "verify the public balance increased and the private balance dropped.",
  });
}
