import { NextRequest, NextResponse } from "next/server";
import { getPayrollRun } from "@/lib/server/nillion-server";

export const runtime = "nodejs";

/**
 * GET /api/payroll/attestation?run_id=<id>&company_id=<id>
 *
 * Returns the TEE attestation for a specific payroll run.
 * Used by the employee claim UI to display the "Verified by Nillion" badge.
 */
export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const runId = searchParams.get("run_id");
        const companyId = searchParams.get("company_id") || "default";

        if (!runId) {
            return NextResponse.json({ error: "run_id is required" }, { status: 400 });
        }

        const run = await getPayrollRun(companyId, runId);

        if (!run) {
            return NextResponse.json({ error: "Payroll run not found" }, { status: 404 });
        }

        // Return only the attestation-relevant fields (no salary data)
        return NextResponse.json({
            run_id: run.run_id,
            epoch: run.epoch,
            merkle_root: run.merkle_root,
            commitment_count: run.commitment_count,
            nildb_synced: true,
            attestation: run.attestation || null,
            verified: !!(run.attestation?.enclave?.type === "SEV-SNP"),
            enclave_type: run.attestation?.enclave?.type || null,
            enclave_measurement: run.attestation?.enclave?.measurement || null,
            processed_at: run.created_at,
        });
    } catch (err: any) {
        console.error("[attestation] Error:", err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
