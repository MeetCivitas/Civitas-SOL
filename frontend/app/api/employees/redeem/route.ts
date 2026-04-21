import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * POST /api/employees/redeem
 *
 * Records a voucher redemption request for the Solana migration shell.
 * The actual settlement program call is still pending implementation, so this
 * route returns the structured payload needed by the frontend.
 */
export async function POST(req: NextRequest) {
  try {
    const {
      employee_tag,
      voucher_id,
      commitment,
      amount,
      epoch,
      voucher_nonce,
    } = await req.json();

    if (!employee_tag || !commitment) {
      return NextResponse.json(
        { error: "employee_tag and commitment required" },
        { status: 400 }
      );
    }

    console.log("[Redeem] Redemption request", {
      employee_tag: employee_tag.slice(0, 12) + "…",
      commitment: commitment.slice(0, 12) + "…",
      amount,
    });

    return NextResponse.json({
      success: true,
      message: "Redemption prepared. Final Solana settlement wiring is still pending.",
      redemption: {
        employee_tag,
        voucher_id,
        commitment,
        amount,
        epoch,
        voucher_nonce,
        contract: process.env.NEXT_PUBLIC_SOLANA_PAYROLL_PROGRAM || "planned-solana-program",
        explorer_base: "https://explorer.solana.com",
        reference: `redeem-${Date.now()}`,
      },
    });
  } catch (error: any) {
    console.error("Redeem error:", error);
    return NextResponse.json(
      { error: error.message || "Redemption failed" },
      { status: 500 }
    );
  }
}
