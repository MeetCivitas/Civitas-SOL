import { NextRequest, NextResponse } from "next/server";
import { redeemCredentialVoucher } from "@/lib/server/employee-store";

interface RouteContext {
  params: Promise<{ token: string }>;
}

export const runtime = "nodejs";

export async function GET(_: NextRequest, context: RouteContext) {
  try {
    const { token } = await context.params;
    const redeemed = await redeemCredentialVoucher(token);
    if (!redeemed) {
      return NextResponse.json({ error: "Voucher invalid or expired" }, { status: 404 });
    }
    const { employee, credential } = redeemed;
    return NextResponse.json({
      employee_id: employee.employee_id,
      employee_tag: employee.employee_tag,
      credential,
    });
  } catch (error: any) {
    console.error("Credential download failed:", error);
    return NextResponse.json({ error: error.message || "Download failed" }, { status: 500 });
  }
}

