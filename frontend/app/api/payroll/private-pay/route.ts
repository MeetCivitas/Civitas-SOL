/**
 * /api/payroll/private-pay
 * MagicBlock Private Payments — server-side façade.
 *
 * Builders return UNSIGNED base64 VersionedTransactions. The frontend wallet
 * signs and submits. Failures are real failures — there is no demo path.
 *
 * GET  ?action=challenge&pubkey=X            — fetch auth challenge
 * GET  ?action=health                        — gate before any flow
 * POST action=auth        pubkey,challenge,signature → Bearer token
 * POST action=deposit     owner,amount[,mint]        → unsigned deposit tx
 * POST action=transfer    from,to,amount,token[,mint,split,minDelayMs,maxDelayMs] → unsigned private transfer tx
 * POST action=withdraw    owner,amount,mint          → unsigned withdraw tx
 * POST action=balance     address,mint[,token]       → balance info
 *
 * Privacy model (MagicBlock Frontier track):
 *   Employer deposits USDC into MagicBlock ER during payroll commit.
 *   Each employee claim triggers a private transfer (visibility=private,
 *   split=5) from employer ephemeral → employee ephemeral. Withdraw timing is
 *   randomized so amount + linkability are not visible in any L1 tx.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  assertMagicBlockHealthy,
  getAuthChallenge,
  loginWithSignature,
  buildDepositTx,
  buildPrivateTransferTx,
  buildWithdrawTx,
  getPublicBalance,
  getPrivateBalance,
  type PrivateTransferOptions,
  MagicBlockError,
} from "@/lib/server/magicblock-private-payments";

export const runtime = "nodejs";

function err(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function fail(e: unknown) {
  if (e instanceof MagicBlockError) {
    return err(e.message, e.status ?? 502);
  }
  const m = e instanceof Error ? e.message : String(e);
  console.error("[private-pay]", m);
  return err(m, 500);
}

// ── GET: challenge / health ───────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get("action");

  if (action === "challenge") {
    const pubkey = searchParams.get("pubkey");
    if (!pubkey) return err("pubkey required");
    try {
      const challenge = await getAuthChallenge(pubkey);
      return NextResponse.json({ challenge });
    } catch (e) {
      return fail(e);
    }
  }

  if (action === "health") {
    try {
      await assertMagicBlockHealthy();
      return NextResponse.json({ ok: true });
    } catch (e) {
      return fail(e);
    }
  }

  return err("Unknown GET action. Use action=challenge or action=health");
}

// ── POST: auth / deposit / transfer / withdraw / balance ──────────────────

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return err("invalid JSON body");
  }
  const { action } = body as { action: string };
  if (!action) return err("action required");

  try {
    switch (action) {
      case "auth": {
        const { pubkey, challenge, signature, cluster } = body;
        if (!pubkey || !challenge || !signature) {
          return err("pubkey, challenge, and signature required");
        }
        const token = await loginWithSignature(pubkey, challenge, signature, cluster);
        return NextResponse.json({ success: true, token });
      }

      case "deposit": {
        const { owner, amount, mint, cluster } = body;
        if (!owner || !amount) return err("owner and amount required");
        const result = await buildDepositTx(owner, BigInt(amount), mint, cluster);
        return NextResponse.json({ success: true, ...result });
      }

      case "transfer": {
        const { from, to, amount, token: authToken, mint, split, minDelayMs, maxDelayMs, cluster, memo } = body;
        if (!from || !to || !amount) return err("from, to, and amount required");
        if (!authToken) return err("Bearer token required for private transfer");
        const opts: PrivateTransferOptions = {
          split: split ?? 5,
          minDelayMs: minDelayMs ?? 500,
          maxDelayMs: maxDelayMs ?? 30_000,
          cluster,
          memo,
        };
        const result = await buildPrivateTransferTx(from, to, BigInt(amount), authToken, mint, opts);
        return NextResponse.json({ success: true, ...result, split: opts.split });
      }

      case "withdraw": {
        const { owner, amount, mint, cluster } = body;
        if (!owner || !amount || !mint) return err("owner, amount, and mint required");
        const result = await buildWithdrawTx(owner, BigInt(amount), mint, cluster);
        return NextResponse.json({ success: true, ...result });
      }

      case "balance": {
        const { address, mint, token: authToken, cluster } = body;
        if (!address || !mint) return err("address and mint required");
        const balance = authToken
          ? await getPrivateBalance(address, mint, authToken, cluster)
          : await getPublicBalance(address, mint, cluster);
        return NextResponse.json({ success: true, ...balance });
      }

      default:
        return err(`Unknown action: ${action}. Valid: auth, deposit, transfer, withdraw, balance`);
    }
  } catch (e) {
    return fail(e);
  }
}
