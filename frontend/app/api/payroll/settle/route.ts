/**
 * POST /api/payroll/settle
 * Called by the employee's browser after a successful claim transaction.
 *
 * Flow:
 *   1. Verify the txSignature is finalized on Solana (not just confirmed)
 *   2. Mark the voucher as "settled" in NilDB
 *   3. Update employer run stats (total settled — employer private view only)
 *
 * Security:
 *   - Only accepts finalized transactions (not just confirmed/processed)
 *   - Nullifier is verified against the on-chain NullifierAccount
 *   - Amount is NOT stored in any publicly visible field
 */

import { NextRequest, NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import { RPC_ENDPOINT, PROGRAM_ID } from "@/lib/solana-program";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { nullifier, txSignature, employeeTag } = body as {
      nullifier: string;
      txSignature: string;
      employeeTag: string;
    };

    if (!nullifier || !txSignature || !employeeTag) {
      return NextResponse.json(
        { error: "Missing nullifier, txSignature, or employeeTag" },
        { status: 400 }
      );
    }

    // ── 1. Verify finality on Solana ──────────────────────────────────────
    const connection = new Connection(RPC_ENDPOINT, "finalized");
    const txInfo = await connection.getTransaction(txSignature, {
      commitment: "finalized",
      maxSupportedTransactionVersion: 0,
    });

    if (!txInfo) {
      return NextResponse.json(
        { error: "Transaction not found or not finalized yet" },
        { status: 404 }
      );
    }

    if (txInfo.meta?.err) {
      return NextResponse.json(
        { error: "Transaction failed on-chain" },
        { status: 400 }
      );
    }

    // ── 2. Verify nullifier account exists on-chain ───────────────────────
    const nullifierBytes = Buffer.from(nullifier.replace(/^0x/, "").padStart(64, "0"), "hex");
    const [nullifierPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("nullifier"), nullifierBytes],
      PROGRAM_ID
    );

    const nullifierAccount = await connection.getAccountInfo(nullifierPda);
    if (!nullifierAccount) {
      return NextResponse.json(
        { error: "Nullifier account not found. Settlement may not be complete." },
        { status: 400 }
      );
    }

    // ── 3. Mark voucher settled in NilDB ──────────────────────────────────
    const { getNillionServerClient } = await import("@/lib/server/nillion-server");
    const nillionClient = await getNillionServerClient();

    await nillionClient.settleVoucher({
      employeeTag,
      nullifier,
      txSignature,
      settledAt: new Date().toISOString(),
    });

    return NextResponse.json({ success: true, nullifier, txSignature });
  } catch (err: unknown) {
    console.error("[payroll/settle]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Settlement recording failed" }, { status: 500 });
  }
}
