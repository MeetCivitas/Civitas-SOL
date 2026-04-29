import { NextRequest, NextResponse } from "next/server";
import { isNillionConfigured, listPayrollRuns, extractRecords } from "@/lib/server/nillion-server";

export const runtime = "nodejs";

/**
 * GET /api/payroll/runs?companyId=...
 *
 * Fetches all past payroll runs for a company from NilDB.
 */
export async function GET(req: NextRequest) {
    try {
        if (!isNillionConfigured()) {
            return NextResponse.json({ success: false, error: "NilDB not configured" }, { status: 503 });
        }

        const { searchParams } = new URL(req.url);
        const companyId = searchParams.get("companyId");

        if (!companyId) {
            return NextResponse.json({ success: false, error: "Missing companyId parameter" }, { status: 400 });
        }

        const response = await listPayrollRuns(companyId);
        const records = extractRecords(response);

        // Map NilDB plain records back to frontend PayrollRun interfaces
        const runs = records.map((r: any) => ({
            runId: r.run_id,
            orgId: companyId,
            createdBy: "employer",
            createdAt: r.created_at || new Date().toISOString(),
            status: r.status,
            employeeCount: parseInt(r.commitment_count || "0", 10),
            // We don't store totalAmount in the plain record directly right now,
            // but if we need it, we can calculate it or store it during generate
            // For now, fallback to 0 or derive if possible
            declaredTotal: "0",
            currency: "USDC",
            payrollRoot: r.merkle_root || "",
            proofHash: r.zk_proof_hash || "",
            notes: [],
            events: [{ ts: r.created_at, text: `Payroll run ${r.status}` }],
            commitments: r.commitments ? JSON.parse(r.commitments) : [],
            epoch: r.epoch || "",
            txHash: r.tx_hash || "",
        }));

        return NextResponse.json({ success: true, runs });
    } catch (error: any) {
        console.error("[GET /api/payroll/runs] error:", error);
        return NextResponse.json(
            { success: false, error: error.message || "Failed to fetch payroll runs" },
            { status: 500 }
        );
    }
}
