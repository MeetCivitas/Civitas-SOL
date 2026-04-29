/**
 * POST /api/payroll/confirm
 *
 * Called by the frontend after the employer has successfully signed and
 * broadcast all commit transactions. Updates the payroll run status in
 * NilDB to "committed" and stores the final transaction hash.
 *
 * Body: { runId: string; employerAddress: string; txHash: string }
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import {
  isNillionConfigured,
  updatePayrollRunStatus,
} from "@/lib/server/nillion-server";

export const runtime = "nodejs";

function addressToCompanyId(address: string): string {
  return crypto
    .createHash("sha256")
    .update(address.toLowerCase())
    .digest("hex")
    .slice(0, 20);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { runId, employerAddress, txHash } = body as {
      runId: string;
      employerAddress: string;
      txHash?: string;
    };

    if (!runId || !employerAddress) {
      return NextResponse.json(
        { error: "runId and employerAddress required" },
        { status: 400 }
      );
    }

    if (!isNillionConfigured()) {
      return NextResponse.json({
        success: true,
        message: "NilDB not configured — status update skipped",
      });
    }

    const companyId = addressToCompanyId(employerAddress);
    await updatePayrollRunStatus(companyId, runId, "committed", txHash);

    return NextResponse.json({ success: true, runId, status: "committed" });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[payroll/confirm]", message);
    return NextResponse.json(
      { error: message || "Failed to confirm payroll run" },
      { status: 500 }
    );
  }
}
