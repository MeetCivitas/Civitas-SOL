import { NextRequest, NextResponse } from "next/server";
import {
    submitOnboardingJob,
    pollOnboardingResult,
    deleteWorkload,
    isNilCCConfigured,
} from "@/lib/server/nilcc-client";
import { registerEmployeeByTag } from "@/lib/server/employee-store";

export const runtime = "nodejs";

/**
 * POST /api/employer/employees/onboard-tee
 *
 * Blind employee onboarding via nilCC TEE.
 * Sends employee names + salaries to the Nillion enclave.
 * The enclave generates credential_nonce + employee_tag for each employee.
 * Raw nonces never touch this server.
 *
 * Body: { employees: [{name, salary}], company_id? }
 */
export async function POST(req: NextRequest) {
    if (!isNilCCConfigured()) {
        return NextResponse.json(
            { error: "nilCC is not configured. Set NILCC_CLUSTER_URL, NILCC_SIGNING_KEY, and NILCC_ONBOARD_IMAGE." },
            { status: 503 }
        );
    }

    let jobId: string | null = null;

    try {
        const body = await req.json();
        const { employees, company_id } = body;

        if (!employees || !Array.isArray(employees) || employees.length === 0) {
            return NextResponse.json({ error: "employees array is required" }, { status: 400 });
        }

        const companyId = company_id || "default";

        console.log(`[TEE-onboard] Onboarding ${employees.length} employees via nilCC for company: ${companyId}`);

        // Submit onboarding job to TEE
        jobId = await submitOnboardingJob({ company_id: companyId, employees });

        try {
            // Poll until TEE generates the credentials
            const result = await pollOnboardingResult(jobId);

            console.log(`[TEE-onboard] ✓ TEE generated ${result.employee_count} tags`);

            // Register each employee by their TEE-generated tag
            const registered = [];
            for (const emp of result.employees) {
                try {
                    const record = await registerEmployeeByTag(
                        emp.employee_tag,
                        emp.name,
                        Number(emp.salary),
                        companyId
                    );
                    registered.push({
                        employee_id: record.employee_id,
                        employee_tag: emp.employee_tag,
                        name: emp.name,
                        salary: emp.salary,
                        status: "active",
                        tee_onboarded: true,
                    });
                } catch (e: any) {
                    console.warn(`[TEE-onboard] Failed to register ${emp.name}: ${e.message}`);
                }
            }

            return NextResponse.json({
                success: true,
                message: `${registered.length} employees onboarded via Nillion TEE`,
                employees: registered,
                nildb_synced: result.nildb_synced,
                tee_attestation: {
                    enclave_type: "SEV-SNP",
                    note: "credential_nonces generated inside TEE — not accessible by employer",
                },
            });
        } finally {
            // Always clean up the workload
            if (jobId) await deleteWorkload(jobId);
        }
    } catch (err: any) {
        console.error("[TEE-onboard] Error:", err);
        return NextResponse.json(
            { error: err.message || "TEE onboarding failed" },
            { status: 500 }
        );
    }
}
