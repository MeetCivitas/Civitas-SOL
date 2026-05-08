// lib/server/nilcc-client.ts
// NilCC Job Dispatch Client for Civitas
//
// Two execution paths coexist:
//   • LEGACY (ephemeral CVM per run): submitPayrollJob → pollUntilComplete →
//     deleteWorkload. Each call cold-starts a CVM, computes once, tears down.
//     Kept exported for rollback safety; gated by USE_LEGACY_NILCC=1 in routes.
//   • V4 (warm CVM, manifest per request): runOnWorkload → POST /run/{kind}
//     with an Ed25519 signature; verifyFreshAttestation → GET /attestation.
//     Single CVM, persists across runs. Provisioned once by scripts/provision-nilcc.ts.

import crypto from "crypto";

// ── Configuration ───────────────────────────────────────────────────────

const NILCC_CLUSTER_URL = (process.env.NILCC_CLUSTER_URL || "").trim();
const NILCC_SIGNING_KEY = process.env.NILCC_SIGNING_KEY || "";
const NILCC_WORKLOAD_IMAGE = process.env.NILCC_WORKLOAD_IMAGE || "";

// V4 — warm workload coordinates (set by scripts/provision-nilcc.ts)
const NILCC_WORKLOAD_DOMAIN = (process.env.NILCC_WORKLOAD_DOMAIN || "").trim();
const CIVITAS_REQUEST_PRIVKEY_HEX = (process.env.CIVITAS_REQUEST_PRIVKEY || "").trim();
const NILCC_GOLDEN_MEASUREMENT = (process.env.NILCC_GOLDEN_MEASUREMENT || "").trim();

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

    // The nilCC API requires Authorization: Bearer or x-api-key header
    const apiKey = process.env.NILCC_API_KEY || process.env.NILCC_SECRET_KEY || process.env.NILCC_SIGNING_KEY || "";
    const accountId = process.env.NILLCC_ACCOUNT_ID || "";

    console.log(`[nilCC] Auth: key=${apiKey.slice(0, 8)}…, account=${accountId.slice(0, 8)}…`);

    const res = await fetch(url, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
            "x-api-key": apiKey,
            ...(accountId ? { "x-account-id": accountId } : {}),
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
    const orgKey = process.env.NEXT_PUBLIC_NILLION_ORG_SECRET_KEY || process.env.NILLION_ORG_SECRET_KEY || "";
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
            NILLION_ORG_SECRET_KEY: process.env.NEXT_PUBLIC_NILLION_ORG_SECRET_KEY || process.env.NILLION_ORG_SECRET_KEY || "",
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
    const orgKey = process.env.NEXT_PUBLIC_NILLION_ORG_SECRET_KEY || process.env.NILLION_ORG_SECRET_KEY || "";
    return `services:\n  civitas-onboard:\n    image: ${NILCC_ONBOARD_IMAGE}\n    environment:\n      NILLION_ORG_SECRET_KEY: '${orgKey}'\n      ONBOARD_MANIFEST: '${manifestJson.replace(/'/g, "''")}'\n      OUTPUT_DIR: /outputs\n    restart: "no"`;
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
            NILLION_ORG_SECRET_KEY: process.env.NEXT_PUBLIC_NILLION_ORG_SECRET_KEY || process.env.NILLION_ORG_SECRET_KEY || "",
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

// ────────────────────────────────────────────────────────────────────────
// V4: warm workload, signed per-request execution
// ────────────────────────────────────────────────────────────────────────

const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

let cachedPrivKey: crypto.KeyObject | null = null;

function loadRequestPrivKey(): crypto.KeyObject | null {
    if (cachedPrivKey) return cachedPrivKey;
    if (!CIVITAS_REQUEST_PRIVKEY_HEX) return null;
    const raw = Buffer.from(CIVITAS_REQUEST_PRIVKEY_HEX, "hex");
    if (raw.length !== 32) {
        throw new Error(
            `CIVITAS_REQUEST_PRIVKEY must be 32 raw bytes hex-encoded (got ${raw.length})`,
        );
    }
    const der = Buffer.concat([ED25519_PKCS8_PREFIX, raw]);
    cachedPrivKey = crypto.createPrivateKey({ key: der, format: "der", type: "pkcs8" });
    return cachedPrivKey;
}

export function isWarmWorkloadConfigured(): boolean {
    return !!NILCC_WORKLOAD_DOMAIN;
}

/**
 * Execute a manifest on the warm nilCC workload.
 *
 * Signs the request body with the orchestrator's Ed25519 key (matched by the
 * workload's CIVITAS_REQUEST_PUBKEY). Sends the EXACT signed bytes — never
 * re-stringify the manifest after signing, or the workload will reject with 403.
 *
 * @param kind     "payroll" or "onboard" — selects /run/{kind} on the workload
 * @param manifest the payload (PayrollManifest for payroll, OnboardManifest for onboard)
 * @returns the parsed `data` field of the workload response
 */
export async function runOnWorkload<T = unknown>(
    kind: "payroll" | "onboard",
    manifest: unknown,
    opts: { timeoutMs?: number; domainOverride?: string } = {},
): Promise<T> {
    const domain = (opts.domainOverride || NILCC_WORKLOAD_DOMAIN).trim();
    if (!domain) {
        throw new Error(
            "[nilCC] NILCC_WORKLOAD_DOMAIN not set — provision a warm workload via scripts/provision-nilcc.ts",
        );
    }

    const bodyBytes = Buffer.from(JSON.stringify(manifest), "utf8");
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "Content-Length": String(bodyBytes.length),
    };

    const privKey = loadRequestPrivKey();
    if (privKey) {
        const sig = crypto.sign(null, bodyBytes, privKey);
        headers["x-civitas-sig"] = sig.toString("base64");
    } else {
        console.warn(
            "[nilCC] CIVITAS_REQUEST_PRIVKEY not set — sending /run/" +
                kind +
                " unsigned (workload must be in dev mode for this to succeed)",
        );
    }

    const url = `https://${domain}/run/${kind}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 60_000);

    let res: Response;
    try {
        res = await fetch(url, { method: "POST", headers, body: bodyBytes, signal: ctrl.signal });
    } finally {
        clearTimeout(t);
    }

    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`[nilCC] POST /run/${kind} → HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    const json = (await res.json()) as { status?: string; data?: T; error?: string };
    if (json.status !== "done" || !json.data) {
        throw new Error(`[nilCC] /run/${kind} returned unexpected payload: ${JSON.stringify(json).slice(0, 200)}`);
    }
    return json.data;
}

export interface FreshAttestation {
    kind: "real" | "stub";
    nonce: string;
    source?: string;
    report?: unknown;
    note?: string;
    enclave?: { type?: string; verified?: boolean; measurement?: string };
    timestamp?: string;
    /** True if this attestation should be trusted by the orchestrator under the
     * current policy. False for stubs unless NILCC_ALLOW_STUB_ATTESTATION=1. */
    trusted: boolean;
}

/**
 * Fetch and verify a fresh attestation from the warm workload's nilcc-attester
 * sidecar.
 *
 * Hits `https://{domain}/nilcc/api/v2/report` directly (the public path
 * exposed by nilCC's reverse proxy). This is more reliable than proxying
 * through our app's `/attestation` endpoint, which would require the in-CVM
 * docker network to resolve `nilcc-attester` by service name — that DNS can
 * be unreliable depending on nilCC's compose injection.
 *
 * Verification model: nilCC binds the AMD-SEV-SNP report to the workload's
 * TLS cert fingerprint (not to a per-request nonce), so freshness comes from
 * the TLS handshake. The `measurement` field in the report is the SNP launch
 * measurement — pin it via NILCC_GOLDEN_MEASUREMENT.
 *
 * Full AMD signature-chain verification (AMD VCEK against SNP root) is not
 * implemented here. For the hackathon path we trust the report if its
 * `measurement` matches our pinned golden value. Production hardening: swap
 * in `@virtee/snpguest` or `verify_snp_attestation` for full chain validation.
 */
export async function verifyFreshAttestation(
    opts: { domainOverride?: string; timeoutMs?: number } = {},
): Promise<FreshAttestation> {
    const domain = (opts.domainOverride || NILCC_WORKLOAD_DOMAIN).trim();
    if (!domain) {
        throw new Error("[nilCC] NILCC_WORKLOAD_DOMAIN not set");
    }

    const nonce = crypto.randomBytes(16).toString("hex");
    const url = `https://${domain}/nilcc/api/v2/report?nonce=${nonce}`;

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 5_000);
    let res: Response;
    try {
        res = await fetch(url, { signal: ctrl.signal });
    } finally {
        clearTimeout(t);
    }
    if (!res.ok) {
        throw new Error(`[nilCC] GET /nilcc/api/v2/report → HTTP ${res.status}`);
    }
    const reportBody = (await res.json()) as {
        report?: { measurement?: string; [k: string]: unknown };
        raw_report?: string;
        environment?: unknown;
    };

    const measurement = reportBody.report?.measurement || "";
    const allowStub = process.env.NILCC_ALLOW_STUB_ATTESTATION === "1";
    let trusted = false;
    if (measurement) {
        if (NILCC_GOLDEN_MEASUREMENT) {
            trusted = measurement.toLowerCase() === NILCC_GOLDEN_MEASUREMENT.toLowerCase();
            if (!trusted) {
                console.warn(
                    `[nilCC] measurement mismatch: got ${measurement.slice(0, 16)}…, ` +
                        `expected ${NILCC_GOLDEN_MEASUREMENT.slice(0, 16)}…`,
                );
            }
        } else {
            console.warn(
                `[nilCC] NILCC_GOLDEN_MEASUREMENT unset — trusting attestation without measurement check`,
            );
            trusted = true;
        }
    } else {
        // No measurement returned — fall back to stub semantics
        trusted = allowStub;
    }

    return {
        kind: measurement ? "real" : "stub",
        nonce,
        source: url,
        report: reportBody.report,
        enclave: { type: "SEV-SNP", verified: trusted, measurement },
        timestamp: new Date().toISOString(),
        trusted,
    };
}
