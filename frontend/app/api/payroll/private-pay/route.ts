/**
 * /api/payroll/private-pay
 * MagicBlock Private Payments — server-side façade.
 *
 * Builders return UNSIGNED base64 legacy `Transaction`s. The frontend wallet
 * signs and submits — to the URL indicated by `sendTo`:
 *   sendTo=base       → standard Solana RPC (deposit, private transfer)
 *   sendTo=ephemeral  → ER connection at MAGICBLOCK_TEE_URL?token=...
 *
 * GET  ?action=challenge&pubkey=X            — fetch TEE auth challenge
 * GET  ?action=health                        — verify TEE reachability
 * POST action=auth        pubkey,challenge,signature → Bearer token
 * POST action=deposit     owner,amount,mint          → unsigned deposit tx (base)
 * POST action=transfer    from,to,amount,mint
 *                         [,split,minDelayMs,maxDelayMs] → unsigned private xfer (base)
 * POST action=withdraw    owner,amount,mint,token    → unsigned withdraw tx (ER)
 * POST action=balance     address,mint[,token]       → balance info
 *
 * Note: action=auth is a thin proxy over the SDK's official endpoint
 *   POST https://tee.magicblock.app/auth/login
 * exposed here so wallet-side flows can route through Next without leaking
 * the keypair. action=transfer no longer requires a Bearer token (private
 * base→base transfers are pure on-chain ixs that the wallet signs).
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

/**
 * Coerce a request body amount field to bigint base units. Rejects decimals
 * with a clear message — the caller needs to convert display USDC to base
 * units (× 10^6) before calling this API.
 */
function asBaseUnits(value: unknown, field: string): bigint {
  if (typeof value === "bigint") return value;
  const s = typeof value === "string" ? value : String(value ?? "");
  if (!/^\d+$/.test(s)) {
    throw new MagicBlockError(
      `${field} must be an integer string of USDC base units (decimals=6); got ${JSON.stringify(value)}`,
      400,
    );
  }
  return BigInt(s);
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
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return err("invalid JSON body");
  }
  const action = body.action as string | undefined;
  if (!action) return err("action required");

  try {
    switch (action) {
      case "auth": {
        const pubkey = body.pubkey as string | undefined;
        const challenge = body.challenge as string | undefined;
        const signature = body.signature as string | undefined;
        if (!pubkey || !challenge || !signature) {
          return err("pubkey, challenge, and signature required");
        }
        const { token, expiresAt } = await loginWithSignature(pubkey, challenge, signature);
        return NextResponse.json({ success: true, token, expiresAt });
      }

      case "deposit": {
        const owner = body.owner as string | undefined;
        const mint = body.mint as string | undefined;
        if (!owner || body.amount == null || !mint) return err("owner, amount, and mint required");
        const amt = asBaseUnits(body.amount, "amount");
        const result = await buildDepositTx(owner, amt, mint);
        return NextResponse.json({ success: true, ...result });
      }

      case "transfer": {
        const from = body.from as string | undefined;
        const to = body.to as string | undefined;
        const mint = body.mint as string | undefined;
        if (!from || !to || body.amount == null || !mint) {
          return err("from, to, amount, and mint required");
        }
        const amt = asBaseUnits(body.amount, "amount");
        const opts: PrivateTransferOptions = {
          split: body.split as number | undefined,
          minDelayMs: body.minDelayMs as number | undefined,
          maxDelayMs: body.maxDelayMs as number | undefined,
          memo: body.memo as string | undefined,
        };
        const result = await buildPrivateTransferTx(from, to, amt, mint, opts);
        return NextResponse.json({
          success: true,
          ...result,
          split: opts.split ?? 5,
        });
      }

      case "withdraw": {
        const owner = body.owner as string | undefined;
        const mint = body.mint as string | undefined;
        const authToken = body.token as string | undefined;
        if (!owner || body.amount == null || !mint) return err("owner, amount, and mint required");
        if (!authToken) return err("Bearer token required for withdraw (action=auth first)");
        const amt = asBaseUnits(body.amount, "amount");
        const result = await buildWithdrawTx(owner, amt, mint, authToken);
        return NextResponse.json({ success: true, ...result });
      }

      case "balance": {
        const address = body.address as string | undefined;
        const mint = body.mint as string | undefined;
        const authToken = body.token as string | undefined;
        if (!address || !mint) return err("address and mint required");
        const balance = authToken
          ? await getPrivateBalance(address, mint, authToken)
          : await getPublicBalance(address, mint);
        return NextResponse.json({ success: true, ...balance });
      }

      default:
        return err(
          `Unknown action: ${action}. Valid: auth, deposit, transfer, withdraw, balance`,
        );
    }
  } catch (e) {
    return fail(e);
  }
}
