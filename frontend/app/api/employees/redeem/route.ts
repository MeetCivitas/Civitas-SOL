import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * POST /api/employees/redeem
 *
 * Two actions:
 *   action="claim"  — proof generated; marks voucher "prepared" in NilDB
 *   action="settle" — on-chain settlement confirmed; marks voucher "claimed" in NilDB
 *
 * NilDB update is done by scanning all employer collections (employee side
 * does not know the companyId).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      employee_tag,
      commitment,
      amount,
      epoch,
      voucher_nonce,
      nullifier,
      tx_signature,
      action = "claim",
    } = body as {
      employee_tag: string;
      commitment: string;
      amount?: string;
      epoch?: string;
      voucher_nonce?: string;
      nullifier?: string;
      tx_signature?: string;
      action?: "claim" | "settle";
    };

    if (!employee_tag || !commitment) {
      return NextResponse.json(
        { error: "employee_tag and commitment required" },
        { status: 400 }
      );
    }

    const newStatus = action === "settle" ? "claimed" : "prepared";
    const reference = tx_signature ?? `redeem-${Date.now()}`;

    console.log(`[Redeem] action=${action} commitment=${commitment.slice(0, 12)}… → ${newStatus}`);

    // Always persist to NilDB — scan all employer collections
    try {
      const { updateVoucherStatusByCommitment } = await import("@/lib/server/nillion-server");
      const updated = await updateVoucherStatusByCommitment(commitment, newStatus, reference);
      if (!updated) {
        console.warn("[Redeem] Voucher not found in NilDB — may not have been committed yet");
      }
    } catch (nilErr) {
      console.error("[Redeem] NilDB update failed:", nilErr instanceof Error ? nilErr.message : nilErr);
      // Non-fatal for claim; fatal for settle
      if (action === "settle") {
        return NextResponse.json({ error: "Failed to record settlement in vault database" }, { status: 500 });
      }
    }

    return NextResponse.json({
      success: true,
      status: newStatus,
      redemption: {
        employee_tag,
        commitment,
        amount,
        epoch,
        voucher_nonce,
        nullifier,
        reference,
        settled_at: action === "settle" ? new Date().toISOString() : undefined,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[Redeem]", message);
    return NextResponse.json({ error: message || "Redemption failed" }, { status: 500 });
  }
}
