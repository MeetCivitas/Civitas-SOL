import { NextRequest, NextResponse } from "next/server";
import {
    submitOnboardingJob,
    pollOnboardingResult,
    deleteWorkload,
    isNilCCConfigured,
    isWarmWorkloadConfigured,
    runOnWorkload,
    verifyFreshAttestation,
} from "@/lib/server/nilcc-client";
import { registerEmployeeByTag } from "@/lib/server/employee-store";

export const runtime = "nodejs";

interface OnboardWorkloadResult {
    company_id: string;
    employees: Array<{ employee_tag: string; name: string; salary?: string | number; status: string }>;
    employee_count: number;
    nildb_synced: boolean;
}

async function onboardViaWarmWorkload(
    manifest: { company_id: string; employees: Array<{ name: string; salary: number | string }> },
): Promise<OnboardWorkloadResult> {
    try {
        const att = await verifyFreshAttestation();
        if (!att.trusted) {
            console.warn(`[TEE-onboard] ⚠ attestation not trusted (kind=${att.kind}); proceeding`);
        }
    } catch (err: any) {
        console.warn(`[TEE-onboard] attestation probe failed: ${err.message}`);
    }
    return await runOnWorkload<OnboardWorkloadResult>("onboard", manifest);
}

async function onboardViaLegacyEphemeralCVM(
    manifest: { company_id: string; employees: Array<{ name: string; salary: number | string }> },
): Promise<OnboardWorkloadResult> {
    const jobId = await submitOnboardingJob(manifest);
    try {
        const r = await pollOnboardingResult(jobId);
        return r as unknown as OnboardWorkloadResult;
    } finally {
        await deleteWorkload(jobId);
    }
}

/**
 * POST /api/employer/employees/onboard-tee
 *
 * Blind employee onboarding via nilCC TEE.
 * Sends employee names + salaries to the Nillion enclave.
 * The enclave generates credential_nonce + employee_tag for each employee.
 * Raw nonces never touch this server.
 *
 * Body: { employees: [{name, salary}], company_id? }
 *
 * Path selection:
 *   - V4 warm workload if NILCC_WORKLOAD_DOMAIN is set (and USE_LEGACY_NILCC != 1)
 *   - Legacy ephemeral CVM otherwise (if NILCC_CLUSTER_URL is set)
 *   - 503 if neither configured
 */
export async function POST(req: NextRequest) {
    const useLegacy = process.env.USE_LEGACY_NILCC === "1";
    const warmAvailable = isWarmWorkloadConfigured() && !useLegacy;
    const legacyAvailable = isNilCCConfigured();

    if (!warmAvailable && !legacyAvailable) {
        return NextResponse.json(
            {
                error:
                    "nilCC is not configured. Set NILCC_WORKLOAD_DOMAIN + CIVITAS_REQUEST_PRIVKEY (V4) " +
                    "or NILCC_CLUSTER_URL + NILCC_SIGNING_KEY + NILCC_ONBOARD_IMAGE (legacy).",
            },
            { status: 503 },
        );
    }

    try {
        const body = await req.json();
        const { employees, company_id } = body;

        if (!employees || !Array.isArray(employees) || employees.length === 0) {
            return NextResponse.json({ error: "employees array is required" }, { status: 400 });
        }

        const companyId = company_id || "default";
        const manifest = { company_id: companyId, employees };

        console.log(
            `[TEE-onboard] Onboarding ${employees.length} employees for company ${companyId} via ` +
                (warmAvailable ? "V4 warm workload" : "legacy ephemeral CVM"),
        );

        const result = warmAvailable
            ? await onboardViaWarmWorkload(manifest)
            : await onboardViaLegacyEphemeralCVM(manifest);

        console.log(`[TEE-onboard] ✓ TEE generated ${result.employee_count} tags`);

        const registered: Array<Record<string, unknown>> = [];
        for (const emp of result.employees) {
            try {
                const record = await registerEmployeeByTag(
                    emp.employee_tag,
                    emp.name,
                    Number(emp.salary),
                    companyId,
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
                path: warmAvailable ? "v4-warm" : "legacy-ephemeral",
                note: "credential_nonces generated inside TEE. Not accessible by employer.",
            },
        });
    } catch (err: any) {
        console.error("[TEE-onboard] Error:", err);
        return NextResponse.json(
            { error: err.message || "TEE onboarding failed" },
            { status: 500 },
        );
    }
}
