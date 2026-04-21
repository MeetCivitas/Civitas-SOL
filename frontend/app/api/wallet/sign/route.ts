// app/api/wallet/sign/route.ts
// Legacy helper kept for backward compatibility while Privy-based utility
// signing is phased out of the Solana migration shell.

import { NextRequest, NextResponse } from "next/server";
import { PrivyClient } from "@privy-io/node";

let _privy: PrivyClient | null = null;
function getPrivy(): PrivyClient {
    if (!_privy) {
        _privy = new PrivyClient({
            appId: process.env.NEXT_PUBLIC_PRIVY_APP_ID!,
            appSecret: process.env.PRIVY_APP_SECRET!,
        });
    }
    return _privy;
}

export async function POST(req: NextRequest) {
    if (!process.env.NEXT_PUBLIC_PRIVY_APP_ID || !process.env.PRIVY_APP_SECRET) {
        return NextResponse.json({ error: "Privy not configured" }, { status: 503 });
    }

    // ── 1. Verify the caller's Privy access token ─────────────────────────
    const authHeader = req.headers.get("authorization") ?? "";
    const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();

    if (!accessToken) {
        return NextResponse.json({ error: "Missing Privy access token" }, { status: 401 });
    }

    try {
        const privy = getPrivy();
        await privy.utils().auth().verifyAccessToken(accessToken);
    } catch (err: any) {
        console.error("[Wallet/Sign] Token verification failed:", err?.message);
        return NextResponse.json({ error: "Invalid or expired Privy token" }, { status: 401 });
    }

    // ── 2. Sign the hash ──────────────────────────────────────────────────
    try {
        const { walletId, hash } = await req.json() as { walletId: string; hash: string };

        if (!walletId || !hash) {
            return NextResponse.json({ error: "walletId and hash are required" }, { status: 400 });
        }

        const privy = getPrivy();
        const result = await privy.wallets().rawSign(walletId, {
            params: { hash },
        });

        return NextResponse.json({ signature: result.signature });
    } catch (err: any) {
        console.error("[Wallet/Sign] Error:", err?.message ?? err);
        const status = err?.status ?? 500;
        return NextResponse.json(
            { error: err?.message ?? "Signing failed" },
            { status: status >= 400 && status < 600 ? status : 500 }
        );
    }
}
