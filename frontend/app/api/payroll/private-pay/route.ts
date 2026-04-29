/**
 * /api/payroll/private-pay
 * MagicBlock Private Payments — server-side API façade.
 *
 * All transaction-building calls return UNSIGNED base64 VersionedTransactions.
 * The frontend/wallet is responsible for signing and submitting them to Solana.
 *
 * GET  ?action=challenge&pubkey=X            — fetch auth challenge
 * POST action=auth        pubkey,challenge,signature → Bearer token
 * POST action=deposit     owner,amount[,mint]        → unsigned deposit tx
 * POST action=transfer    from,to,amount,token[,mint,split,minDelayMs,maxDelayMs] → unsigned private transfer tx
 * POST action=withdraw    owner,amount,mint          → unsigned withdraw tx
 * POST action=balance     address,mint[,token]       → balance info
 *
 * Privacy model (MagicBlock Frontier track):
 *   Employer deposits USDC into MagicBlock ER during payroll commit.
 *   Each employee claim triggers a private transfer (visibility=private, split=5)
 *   from employer ephemeral → employee ephemeral.
 *   Employee withdraws with scheduling delay — amount is never in the L1 tx log.
 *
 * Token-2022 Confidential Transfers is DISABLED on devnet/mainnet (April 2026 audit).
 * MagicBlock Private Payments is the production-ready alternative.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getAuthChallenge,
  loginWithSignature,
  buildDepositTx,
  buildPrivateTransferTx,
  buildWithdrawTx,
  getPublicBalance,
  getPrivateBalance,
  checkPaymentsHealth,
  makeDemoDepositTx,
  makeDemoTransferTx,
  makeDemoWithdrawTx,
  type PrivateTransferOptions,
} from "@/lib/server/magicblock-private-payments";

export const runtime = "nodejs";

// ── GET: challenge / health ───────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get("action");

  if (action === "challenge") {
    const pubkey = searchParams.get("pubkey");
    if (!pubkey) {
      return NextResponse.json({ error: "pubkey required" }, { status: 400 });
    }
    try {
      const challenge = await getAuthChallenge(pubkey);
      return NextResponse.json({ challenge });
    } catch (err: any) {
      console.error("[private-pay] challenge error:", err.message);
      // Devnet might not have auth endpoint — return demo challenge so flow can continue
      return NextResponse.json({
        challenge: `civitas-demo-challenge-${Date.now()}`,
        isDemo: true,
      });
    }
  }

  if (action === "health") {
    const ok = await checkPaymentsHealth();
    return NextResponse.json({ ok, endpoint: "payments.magicblock.app" });
  }

  return NextResponse.json(
    { error: "Unknown GET action. Use action=challenge or action=health" },
    { status: 400 },
  );
}

// ── POST: auth / deposit / transfer / withdraw / balance ──────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body as { action: string };

    if (!action) {
      return NextResponse.json({ error: "action required" }, { status: 400 });
    }

    switch (action) {
      // ── auth: challenge + signature → Bearer token ────────────────────
      case "auth": {
        const { pubkey, challenge, signature, cluster } = body as {
          pubkey: string;
          challenge: string;
          signature: string;
          cluster?: string;
        };
        if (!pubkey || !challenge || !signature) {
          return NextResponse.json(
            { error: "pubkey, challenge, and signature required" },
            { status: 400 },
          );
        }

        // Demo challenge (offline / devnet without auth endpoint)
        if (challenge.startsWith("civitas-demo-challenge-")) {
          const demoToken = `demo_token_${pubkey.slice(0, 12)}_${Date.now()}`;
          return NextResponse.json({ success: true, token: demoToken, isDemo: true });
        }

        try {
          const token = await loginWithSignature(pubkey, challenge, signature, cluster);
          return NextResponse.json({ success: true, token, isDemo: false });
        } catch (err: any) {
          console.warn("[private-pay] auth failed, using demo token:", err.message);
          const demoToken = `demo_token_${pubkey.slice(0, 12)}_${Date.now()}`;
          return NextResponse.json({ success: true, token: demoToken, isDemo: true });
        }
      }

      // ── deposit: base wallet → MagicBlock ephemeral ───────────────────
      case "deposit": {
        const { owner, amount, mint, cluster } = body as {
          owner: string;
          amount: string;
          mint?: string;
          cluster?: string;
        };
        if (!owner || !amount) {
          return NextResponse.json({ error: "owner and amount required" }, { status: 400 });
        }

        let result;
        try {
          result = await buildDepositTx(owner, BigInt(amount), mint, cluster);
        } catch (err: any) {
          console.warn("[private-pay] deposit build failed, returning demo tx:", err.message);
          result = makeDemoDepositTx(owner, BigInt(amount));
        }

        return NextResponse.json({
          success: true,
          ...result,
          privacyNote: result.isDemo
            ? "Demo mode — set MAGICBLOCK_PAYMENTS_URL for live deposits"
            : "USDC deposited into MagicBlock Permissioned Ephemeral Rollup",
        });
      }

      // ── transfer: employer ephemeral → employee ephemeral (private) ───
      case "transfer": {
        const {
          from,
          to,
          amount,
          token: authToken,
          mint,
          split,
          minDelayMs,
          maxDelayMs,
          cluster,
          memo,
        } = body as {
          from: string;
          to: string;
          amount: string;
          token?: string;
          mint?: string;
          split?: number;
          minDelayMs?: number;
          maxDelayMs?: number;
          cluster?: string;
          memo?: string;
        };

        if (!from || !to || !amount) {
          return NextResponse.json(
            { error: "from, to, and amount required" },
            { status: 400 },
          );
        }

        const opts: PrivateTransferOptions = {
          split: split ?? 5,
          minDelayMs: minDelayMs ?? 500,
          maxDelayMs: maxDelayMs ?? 30_000,
          cluster,
          memo,
        };

        // No token or demo token → use demo fallback
        const isDemoToken = !authToken || authToken.startsWith("demo_token_");
        let result;
        if (isDemoToken) {
          console.log("[private-pay] Demo transfer:", { from: from.slice(0, 8), to: to.slice(0, 8), amount });
          result = makeDemoTransferTx(from, to, BigInt(amount));
        } else {
          try {
            result = await buildPrivateTransferTx(from, to, BigInt(amount), authToken!, mint, opts);
          } catch (err: any) {
            console.warn("[private-pay] private transfer build failed, returning demo tx:", err.message);
            result = makeDemoTransferTx(from, to, BigInt(amount));
          }
        }

        return NextResponse.json({
          success: true,
          ...result,
          privacyNote: result.isDemo
            ? "Demo mode — private transfer routes through MagicBlock ephemeral in production"
            : `Amount sealed across ${opts.split} ephemeral queue entries — not visible in Solana tx log`,
        });
      }

      // ── withdraw: ephemeral → base wallet ────────────────────────────
      case "withdraw": {
        const { owner, amount, mint, cluster } = body as {
          owner: string;
          amount: string;
          mint: string;
          cluster?: string;
        };
        if (!owner || !amount || !mint) {
          return NextResponse.json(
            { error: "owner, amount, and mint required" },
            { status: 400 },
          );
        }

        let result;
        try {
          result = await buildWithdrawTx(owner, BigInt(amount), mint, cluster);
        } catch (err: any) {
          console.warn("[private-pay] withdraw build failed, returning demo tx:", err.message);
          result = makeDemoWithdrawTx(owner, BigInt(amount));
        }

        return NextResponse.json({
          success: true,
          ...result,
          privacyNote: result.isDemo
            ? "Demo mode — withdrawal from MagicBlock ER in production"
            : "USDC withdrawn from MagicBlock ephemeral to base wallet",
        });
      }

      // ── balance ───────────────────────────────────────────────────────
      case "balance": {
        const { address, mint, token: authToken, cluster } = body as {
          address: string;
          mint: string;
          token?: string;
          cluster?: string;
        };
        if (!address || !mint) {
          return NextResponse.json({ error: "address and mint required" }, { status: 400 });
        }

        try {
          const balance =
            authToken && !authToken.startsWith("demo_token_")
              ? await getPrivateBalance(address, mint, authToken, cluster)
              : await getPublicBalance(address, mint, cluster);
          return NextResponse.json({ success: true, ...balance });
        } catch (err: any) {
          return NextResponse.json({ error: err.message }, { status: 502 });
        }
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}. Valid: auth, deposit, transfer, withdraw, balance` },
          { status: 400 },
        );
    }
  } catch (err: any) {
    console.error("[private-pay]", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
