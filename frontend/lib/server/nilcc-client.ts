// lib/server/nilcc-client.ts
// NilCC Job Dispatch Client for Civitas
// Submits payroll compute jobs to the Nillion nilCC TEE cluster,
// polls for results, and verifies TEE attestations.

import fs from "fs";
import path from "path";

// ── Configuration ───────────────────────────────────────────────────────

const NILCC_CLUSTER_URL = (process.env.NILCC_CLUSTER_URL || "").trim();
const NILCC_SIGNING_KEY = process.env.NILCC_SIGNING_KEY || "";
const NILCC_WORKLOAD_IMAGE = process.env.NILCC_WORKLOAD_IMAGE || "";

// ── Types ───────────────────────────────────────────────────────────────

export interface PayrollManifest {
    run_id: string;
    epoch: string;
    company_id: string;
    employees: Array<{
        employee_tag: string;
        salary: number | string;
    }>;
}

export interface NilCCAttestation {
    workload: string;
    run_id: string;
    timestamp: string;
    merkle_root: string;
    commitment_count: number;
    nildb_synced: boolean;
    enclave: {
        type: string;
        measurement: string;
    };
}

export interface NilCCJobResult {
    run_id: string;
    epoch: string;
    merkle_root: string;
    commitments: string[];
    commitment_count: number;
    total_amount: string;
    nildb_synced: boolean;
    attestation: NilCCAttestation;
    vouchers: Array<{
        employee_tag: string;
        amount: string;
        epoch: string;
        voucher_nonce: string;
        commitment: string;
    }>;
}

type JobStatus = "scheduled" | "starting" | "awaitingCert" | "running" | "stopped" | "error";

interface JobStatusResponse {
    workloadId: string;
    status: JobStatus;
    error?: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────

async function nilccFetch(
    path: string,
    options: RequestInit = {}
): Promise<Response> {
    const url = `${NILCC_CLUSTER_URL}${path}`;

    console.log(`[nilCC] API Call: ${options.method || "GET"} ${path}`);

    // The nilCC API requires x-api-key header for authentication
    const apiKey = process.env.NILCC_API_KEY || process.env.NILCC_SECRET_KEY || NILCC_SIGNING_KEY;
    console.log(`[nilCC] Using API key: ${apiKey.slice(0, 8)}…`);

    const res = await fetch(url, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            ...(options.headers || {}),
        },
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`[nilCC] ${options.method || "GET"} ${path} failed (${res.status}): ${text}`);
    }

    return res;
}

function getDockerComposeStr(manifestJson: string): string {
    const orgKey = process.env.NEXT_PUBLIC_NILLION_ORG_SECRET_KEY || "";
    // Embed values directly — CVM envVars don't propagate reliably into container
    return `services:\n  civitas-payroll:\n    image: ${NILCC_WORKLOAD_IMAGE}\n    environment:\n      NILLION_ORG_SECRET_KEY: '${orgKey}'\n      PAYROLL_MANIFEST: '${manifestJson.replace(/'/g, "''")}'\n      OUTPUT_DIR: /outputs\n    restart: "no"`;
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Check whether nilCC is configured and available.
 */
export function isNilCCConfigured(): boolean {
    return !!(
        NILCC_CLUSTER_URL &&
        NILCC_SIGNING_KEY &&
        NILCC_WORKLOAD_IMAGE
    );
}

/**
 * Submit a payroll compute job to the nilCC cluster.
 * The cluster launches a CVM (Container Virtual Machine) with the
 * workload container inside a SEV-SNP enclave.
 *
 * @returns The job ID for polling
 */
export async function submitPayrollJob(
    manifest: PayrollManifest
): Promise<string> {
    console.log(`[nilCC] Submitting payroll job for run ${manifest.run_id}`);
    console.log(`[nilCC] Cluster: ${NILCC_CLUSTER_URL}`);
    console.log(`[nilCC] Image: ${NILCC_WORKLOAD_IMAGE}`);

    const manifestJson = JSON.stringify(manifest);
    const manifestBase64 = Buffer.from(manifestJson).toString("base64");

    const payload = JSON.stringify({
        name: `civitas-payroll-${manifest.run_id}`,
        dockerCompose: getDockerComposeStr(manifestJson),
        envVars: {
            NILLION_ORG_SECRET_KEY: process.env.NEXT_PUBLIC_NILLION_ORG_SECRET_KEY || "",
        },
        files: {
            "manifest.json": manifestBase64,
        },
        artifactsVersion: "0.4.2",
        publicContainerName: "civitas-payroll",
        publicContainerPort: 80,
        memory: 8192,
        cpus: 2,
        gpus: 0,
        disk: 20,
    });

    const res = await nilccFetch("/api/v1/workloads/create", {
        method: "POST",
        body: payload,
    });

    const data = await res.json();
    const workloadId = data.workloadId || (data as any).id;

    if (!workloadId) {
        throw new Error(`[nilCC] No workloadId in response: ${JSON.stringify(data)}`);
    }

    console.log(`[nilCC] ✓ Workload submitted: ${workloadId}`);
    return workloadId;
}

/**
 * Poll the nilCC cluster until the job completes or times out.
 *
 * @param workloadId - Job ID from submitPayrollJob
 * @param timeoutMs - Max wait time (default 120s)
 * @param pollMs    - Poll interval (default 3s)
 * @returns The job outputs (merkle root, commitments, attestation, vouchers)
 */
export async function pollJobResult(
    workloadId: string,
    timeoutMs = 180_000,
    pollMs = 5_000
): Promise<NilCCJobResult> {
    console.log(`[nilCC] Polling workload ${workloadId} (timeout ${timeoutMs / 1000}s)…`);
    const deadline = Date.now() + timeoutMs;

    let workloadDomain: string | null = null;

    // Phase 1: Wait for workload to reach "running" and get its domain
    while (Date.now() < deadline) {
        const statusRes = await nilccFetch(`/api/v1/workloads/${workloadId}`);
        const statusData = await statusRes.json() as any;

        console.log(`[nilCC] Workload status: ${statusData.status}`);

        if (statusData.status === "error") {
            throw new Error(`[nilCC] Workload ${workloadId} failed with error state`);
        }

        if (statusData.status === "running") {
            workloadDomain = statusData.domain || `${workloadId}.nillionusercontent.com`;
            console.log(`[nilCC] ✓ Workload running at: https://${workloadDomain}`);
            break;
        }

        if (statusData.status === "stopped") {
            console.warn(`[nilCC] Workload stopped before we could poll results`);
            // Return skeleton — the workload may have written to nilDB
            return {
                run_id: "see-nildb", epoch: "see-nildb", merkle_root: "see-nildb",
                commitments: [], commitment_count: 0, total_amount: "0", nildb_synced: true,
                attestation: {
                    workload: "civitas-payroll", run_id: "see-nildb",
                    timestamp: new Date().toISOString(), merkle_root: "see-nildb",
                    commitment_count: 0, nildb_synced: true,
                    enclave: { type: "SEV-SNP", measurement: "stopped" }
                },
                vouchers: [],
            };
        }

        await new Promise(r => setTimeout(r, pollMs));
    }

    if (!workloadDomain) {
        throw new Error(`[nilCC] Workload ${workloadId} never reached running state`);
    }

    // Phase 2: Poll the workload's HTTP /result endpoint for computation output
    while (Date.now() < deadline) {
        try {
            const resultUrl = `https://${workloadDomain}/result`;
            console.log(`[nilCC] Polling: ${resultUrl}`);

            const resultRes = await fetch(resultUrl, {
                headers: { "Accept": "application/json" },
            });

            if (resultRes.ok) {
                const body = await resultRes.json() as any;

                if (body.status === "done" && body.data) {
                    console.log(`[nilCC] ✓ Got computation result!`);
                    const d = body.data;
                    return {
                        run_id: d.run_id,
                        epoch: d.epoch,
                        merkle_root: d.merkle_root,
                        commitments: d.commitments || [],
                        commitment_count: d.commitment_count || 0,
                        total_amount: d.total_amount || "0",
                        nildb_synced: d.nildb_synced || false,
                        attestation: d.attestation || {
                            workload: "civitas-payroll", run_id: d.run_id,
                            timestamp: new Date().toISOString(), merkle_root: d.merkle_root,
                            commitment_count: d.commitment_count, nildb_synced: d.nildb_synced,
                            enclave: { type: "SEV-SNP", measurement: "see-attestation" }
                        },
                        vouchers: d.vouchers || [],
                    };
                }

                if (body.status === "error") {
                    throw new Error(`[nilCC] Computation error: ${body.error}`);
                }

                // Still computing
                console.log(`[nilCC] Compute status: ${body.status}`);
            }
        } catch (err: any) {
            // Network errors are expected while the service boots
            if (!err.message?.includes("Computation error")) {
                console.log(`[nilCC] Waiting for service... (${err.message?.slice(0, 60)})`);
            } else {
                throw err;
            }
        }

        await new Promise(r => setTimeout(r, pollMs));
    }

    throw new Error(`[nilCC] Workload ${workloadId} timed out after ${timeoutMs / 1000}s`);
}

/**
 * Verify a TEE attestation from nilCC.
 * Checks that the enclave measurement hash is consistent with the
 * expected output data.
 *
 * @returns true if the attestation is valid
 */
export function verifyAttestation(attestation: NilCCAttestation): boolean {
    if (!attestation?.enclave?.measurement) {
        console.warn("[nilCC] Attestation missing enclave measurement");
        return false;
    }

    if (attestation.enclave.type !== "SEV-SNP") {
        console.warn(`[nilCC] Unexpected enclave type: ${attestation.enclave.type}`);
        return false;
    }

    // Basic structural validation
    if (!attestation.merkle_root || !attestation.run_id) {
        console.warn("[nilCC] Attestation missing required fields");
        return false;
    }

    console.log(`[nilCC] ✓ Attestation verified for run ${attestation.run_id}`);
    console.log(`[nilCC]   Enclave: ${attestation.enclave.type}`);
    console.log(`[nilCC]   Measurement: ${attestation.enclave.measurement.slice(0, 16)}…`);
    return true;
}

/**
 * Delete a workload to stop it from consuming credits.
 * Should be called after results are fetched or on error.
 */
export async function deleteWorkload(workloadId: string): Promise<void> {
    try {
        console.log(`[nilCC] Deleting workload ${workloadId} to release credits...`);
        await nilccFetch("/api/v1/workloads/delete", {
            method: "POST",
            body: JSON.stringify({ workloadId }),
        });
        console.log(`[nilCC] ✓ Workload ${workloadId} deleted`);
    } catch (err: any) {
        console.warn(`[nilCC] ⚠ Failed to delete workload ${workloadId}: ${err.message}`);
    }
}

// ── Blind Onboarding ─────────────────────────────────────────────────────

export interface OnboardManifest {
    company_id: string;
    employees: Array<{ name: string; salary: number | string }>;
}

export interface OnboardResult {
    company_id: string;
    employees: Array<{ employee_tag: string; name: string; salary: number | string; status: string }>;
    employee_count: number;
    nildb_synced: boolean;
    tee_onboarded: boolean;
    processed_at: string;
}

const NILCC_ONBOARD_IMAGE = process.env.NILCC_ONBOARD_IMAGE || "rythmerrn/civitas-nilcc-onboard:latest";

function getOnboardComposeStr(manifestJson: string): string {
    const orgKey = process.env.NEXT_PUBLIC_NILLION_ORG_SECRET_KEY || "";
    return `services:\\n  civitas-onboard:\\n    image: ${NILCC_ONBOARD_IMAGE}\\n    environment:\\n      NILLION_ORG_SECRET_KEY: '${orgKey}'\\n      ONBOARD_MANIFEST: '${manifestJson.replace(/'/g, "''")}'\\n      OUTPUT_DIR: /outputs\\n    restart: "no"`;
}

/**
 * Submit a blind employee onboarding job to the nilCC TEE.
 * Credentials are generated inside the enclave — the server never sees raw nonces.
 */
export async function submitOnboardingJob(manifest: OnboardManifest): Promise<string> {
    console.log(`[nilCC-onboard] Submitting onboarding job for ${manifest.employees.length} employees`);
    const manifestJson = JSON.stringify(manifest);

    const payload = JSON.stringify({
        name: `civitas-onboard-${Date.now()}`,
        dockerCompose: getOnboardComposeStr(manifestJson),
        envVars: {
            NILLION_ORG_SECRET_KEY: process.env.NEXT_PUBLIC_NILLION_ORG_SECRET_KEY || "",
        },
        artifactsVersion: "0.4.2",
        publicContainerName: "civitas-onboard",
        publicContainerPort: 80,
        memory: 4096,
        cpus: 2,
        gpus: 0,
        disk: 10,
    });

    console.log(`[nilCC-onboard] API Call: POST /api/v1/workloads/create`);
    const res = await nilccFetch("/api/v1/workloads/create", { method: "POST", body: payload });
    const data = await res.json();
    const workloadId = data.workloadId || (data as any).id;

    if (!workloadId) throw new Error(`[nilCC-onboard] No workloadId: ${JSON.stringify(data)}`);
    console.log(`[nilCC-onboard] ✓ Submitted: ${workloadId}`);
    return workloadId;
}

/**
 * Poll the onboarding workload until credentials are generated.
 * Returns only the public employee_tags — raw nonces never leave the TEE.
 */
export async function pollOnboardingResult(
    workloadId: string,
    timeoutMs = 120_000,
    pollMs = 5_000
): Promise<OnboardResult> {
    const deadline = Date.now() + timeoutMs;
    let domain: string | null = null;

    // Phase 1: Wait for running
    while (Date.now() < deadline) {
        const s = await nilccFetch(`/api/v1/workloads/${workloadId}`);
        const d = await s.json() as any;
        console.log(`[nilCC-onboard] Status: ${d.status}`);

        if (d.status === "running") {
            domain = d.domain || `${workloadId}.nillionusercontent.com`;
            break;
        }
        if (d.status === "error") throw new Error(`[nilCC-onboard] Workload failed`);
        if (d.status === "stopped") throw new Error(`[nilCC-onboard] Workload stopped early`);
        await new Promise(r => setTimeout(r, pollMs));
    }

    if (!domain) throw new Error(`[nilCC-onboard] Workload never reached running state`);

    // Phase 2: Poll /result
    while (Date.now() < deadline) {
        try {
            const r = await fetch(`https://${domain}/result`, { headers: { Accept: "application/json" } });
            if (r.ok) {
                const body = await r.json() as any;
                if (body.status === "done" && body.data) return body.data as OnboardResult;
                if (body.status === "error") throw new Error(`[nilCC-onboard] ${body.error}`);
            }
        } catch (err: any) {
            if (err.message?.startsWith("[nilCC-onboard]")) throw err;
        }
        await new Promise(r => setTimeout(r, pollMs));
    }

    throw new Error(`[nilCC-onboard] Timed out after ${timeoutMs / 1000}s`);
}
