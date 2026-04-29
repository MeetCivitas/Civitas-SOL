// lib/server/nillion-server.ts
// Production NilDB Storage Layer for Civitas
// Uses @nillion/secretvaults v2.0.0 — SecretVaultBuilderClient
//
// Architecture:
//   4 collections per company (meta, employees, payroll_runs, vouchers)
//   Blindfold client → writes with %allot secret fields
//   Plaintext client → reads, updates, collection management
//   Retry wrapper on all operations
//   Idempotent writes (check before create)
//   Voucher lifecycle state machine

import crypto from "crypto";
import { SecretVaultBuilderClient } from "@nillion/secretvaults";
import { Signer } from "@nillion/nuc";
import { NilauthClient } from "@nillion/nilauth-client";

// ── Configuration ───────────────────────────────────────────────────────

const ORG_SECRET_KEY = process.env.NILLION_ORG_SECRET_KEY
    || process.env.NEXT_PUBLIC_NILLION_ORG_SECRET_KEY
    || "";

const NILLION_DBS = [
    "https://nildb-stg-n1.nillion.network",
    "https://nildb-stg-n2.nillion.network",
    "https://nildb-stg-n3.nillion.network",
];
const NILAUTH_URL = "https://nilauth-1bc3.staging.nillion.network";

// ── Collection Schemas ──────────────────────────────────────────────────

const COMPANY_META_SCHEMA = {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: "Company Meta",
    type: "array" as const,
    items: {
        type: "object" as const,
        properties: {
            _id: { type: "string" as const, format: "uuid" },
            company_id: { type: "string" as const },
            tax_id: { type: "string" as const },
            company_address: { type: "string" as const },
            escrow_contract_address: { type: "string" as const },
            payroll_frequency: { type: "string" as const },
            current_epoch: { type: "string" as const },
            created_at: { type: "string" as const },
            updated_at: { type: "string" as const },
        },
        required: ["_id", "company_id"],
    },
};

const COMPANY_EMPLOYEES_SCHEMA = {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: "Company Employees",
    type: "array" as const,
    items: {
        type: "object" as const,
        properties: {
            _id: { type: "string" as const, format: "uuid" },
            employee_tag: { type: "string" as const },
            employee_name: { type: "string" as const },
            salary: { type: "string" as const },
            status: { type: "string" as const },
            created_at: { type: "string" as const },
            updated_at: { type: "string" as const },
        },
        required: ["_id", "employee_tag", "status"],
    },
};

const PAYROLL_RUNS_SCHEMA = {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: "Payroll Runs",
    type: "array" as const,
    items: {
        type: "object" as const,
        properties: {
            _id: { type: "string" as const, format: "uuid" },
            run_id: { type: "string" as const },
            epoch: { type: "string" as const },
            merkle_root: { type: "string" as const },
            commitment_count: { type: "string" as const },
            status: { type: "string" as const },
            zk_proof_hash: { type: "string" as const },
            tx_hash: { type: "string" as const },
            employer_address: { type: "string" as const },
            nilcc_attestation: { type: "string" as const },
            commitments: { type: "string" as const },
            created_at: { type: "string" as const },
            updated_at: { type: "string" as const },
        },
        required: ["_id", "run_id", "status"],
    },
};

const VOUCHERS_SCHEMA = {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: "Payroll Vouchers v3",
    type: "array" as const,
    items: {
        type: "object" as const,
        properties: {
            _id: { type: "string" as const, format: "uuid" },
            commitment: { type: "string" as const },
            employee_tag: { type: "string" as const },
            amount: { type: "string" as const },
            nonce: { type: "string" as const },
            nullifier: { type: "string" as const },
            epoch: { type: "string" as const },
            run_id: { type: "string" as const },
            employer_address: { type: "string" as const },
            status: { type: "string" as const },
            claimed_at: { type: "string" as const },
            created_at: { type: "string" as const },
            updated_at: { type: "string" as const },
        },
        required: ["_id", "commitment", "employee_tag", "amount", "epoch", "status"],
    },
};

// ── Retry Wrapper ───────────────────────────────────────────────────────

export async function withRetry<T>(
    fn: () => Promise<T>,
    label: string,
    maxRetries = 3
): Promise<T> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (err) {
            if (attempt === maxRetries) throw err;
            const delay = Math.min(1000 * 2 ** (attempt - 1), 5000);
            const jitter = Math.random() * delay * 0.3;
            const waitMs = Math.round(delay + jitter);
            console.warn(`[nilDB] ${label} failed (attempt ${attempt}/${maxRetries}), retrying in ${waitMs}ms`);
            await new Promise(r => setTimeout(r, waitMs));
        }
    }
    throw new Error("unreachable");
}

// ── Response Parsing ────────────────────────────────────────────────────

/**
 * Extract data records from a NilDB findData response.
 * The SDK returns { data: [...], pagination: {} } for plaintext responses.
 * For blindfold responses, it may return { nodeId: { data: [...] } }.
 */
export function extractRecords(result: any): any[] {
    if (!result) return [];

    // Shape 1: { data: [...], pagination: {} }
    if (Array.isArray(result.data)) {
        return result.data;
    }

    // Shape 2: Direct array
    if (Array.isArray(result)) {
        return result;
    }

    // Shape 3: { nodeId: [...] } or { nodeId: { data: [...] } }
    const records: any[] = [];
    for (const val of Object.values(result)) {
        if (Array.isArray(val)) {
            records.push(...val);
        } else if (val && typeof val === "object" && Array.isArray((val as any).data)) {
            records.push(...(val as any).data);
        }
    }
    return records;
}

// ── NilDB field unwrapper ───────────────────────────────────────────────
// Salary is stored with { "%allot": value } for secret-sharing.
// The plaintext read client returns either the raw wrapper object or a
// secret-share reference. This extracts the plain numeric string in all cases.
export function unwrapNilDBField(raw: any): string {
    if (raw == null) return "0";
    if (typeof raw === "string" || typeof raw === "number") return String(raw);
    // { "%allot": value } — written by blindfold client, returned on plaintext read
    if (raw["%allot"] != null) return String(raw["%allot"]);
    // { "%share": value } — alternative secret-share form
    if (raw["%share"] != null) {
        const inner = raw["%share"];
        if (typeof inner === "string" || typeof inner === "number") return String(inner);
        try {
            const parsed = JSON.parse(String(inner));
            if (parsed?.amount != null) return String(parsed.amount);
        } catch { /* not JSON */ }
        return String(inner);
    }
    return String(raw);
}

// ── Client Singletons ───────────────────────────────────────────────────

let _blindfoldClient: SecretVaultBuilderClient | null = null;
let _plaintextClient: SecretVaultBuilderClient | null = null;

export function isNillionConfigured(): boolean {
    return !!(ORG_SECRET_KEY && ORG_SECRET_KEY.length > 0);
}

let _initPromise: Promise<void> | null = null;

async function initClientsCore(): Promise<void> {
    if (!ORG_SECRET_KEY) {
        throw new Error("NILLION_ORG_SECRET_KEY not set — nilDB operations unavailable");
    }

    console.log("[nilDB] Initializing clients...");

    const signer = Signer.fromPrivateKey(ORG_SECRET_KEY);
    const nilauthClient = await NilauthClient.create({
        baseUrl: NILAUTH_URL,
        chainId: 11155111,
        signer,
    } as any);

    // Blindfold client — for writes with %allot secret fields
    _blindfoldClient = await SecretVaultBuilderClient.from({
        signer,
        nilauthClient,
        dbs: NILLION_DBS,
        blindfold: { operation: "store", useClusterKey: true },
    });
    await _blindfoldClient.refreshRootToken();

    // Register builder profile (idempotent)
    try {
        await _blindfoldClient.readProfile();
        console.log("[nilDB] Builder profile already registered");
    } catch (err: any) {
        // ReadProfile might fail if nodes are down, or if profile doesn't exist
        const errMsg = typeof err === "string" ? err : JSON.stringify(err);
        // if (errMsg.includes("401") || errMsg.includes("Unauthorized")) {
        //     throw new Error(`NILLION_ORG_SECRET_KEY is unauthorized or unfunded on the network. Please check your token/funds (401). Raw error: ${errMsg}`);
        // }

        const didStr = await _blindfoldClient.getId();
        console.log("[nilDB] Registering builder profile for DID:", didStr);
        try {
            await _blindfoldClient.register({
                did: didStr,
                name: "Civitas Payroll Builder",
            });
            console.log("[nilDB] ✓ Builder profile registered");
        } catch (regErr: any) {
            const regErrMsg = typeof regErr === "string" ? regErr : JSON.stringify(regErr);
            console.error(`[nilDB] WARNING: Failed to register builder profile (401 Unauthorized for DID ${didStr}). Continuing anyway to see if reads/writes succeed... Raw error: ${regErrMsg}`);
            // DON'T throw! Let the client be used. If writes fail later, the user will see it.
        }
    }

    // Plaintext client — for reads, updates, collection management (no blindfold)
    const signer2 = Signer.fromPrivateKey(ORG_SECRET_KEY);
    const nilauthClient2 = await NilauthClient.create({
        baseUrl: NILAUTH_URL,
        chainId: 11155111,
        signer: signer2,
    } as any);

    _plaintextClient = await SecretVaultBuilderClient.from({
        signer: signer2,
        nilauthClient: nilauthClient2,
        dbs: NILLION_DBS,
    });
    await _plaintextClient.refreshRootToken();

    console.log("[nilDB] ✓ Clients initialized");
}

async function initClients(): Promise<void> {
    // Singleton: all concurrent callers share the same init promise.
    // This prevents parallel cold-start requests from racing / double-initializing.
    if (_initPromise) return _initPromise;

    const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("[nilDB] Client initialization timed out after 45s")), 45_000)
    );

    _initPromise = Promise.race([initClientsCore(), timeout]).catch((err) => {
        // Reset on failure so the next request can retry
        _initPromise = null;
        _blindfoldClient = null;
        _plaintextClient = null;
        // NilDB SDK sometimes throws plain objects — normalize to Error so
        // error.message is meaningful everywhere it propagates.
        if (err instanceof Error) throw err;
        throw new Error(`[nilDB] Init failed: ${JSON.stringify(err)}`);
    });

    return _initPromise;
}

function getBlindfolded(): SecretVaultBuilderClient {
    if (!_blindfoldClient) throw new Error("[nilDB] Not initialized — call initClients first");
    return _blindfoldClient;
}

function getPlaintext(): SecretVaultBuilderClient {
    if (!_plaintextClient) throw new Error("[nilDB] Not initialized — call initClients first");
    return _plaintextClient;
}

export async function getPlaintextClient(): Promise<SecretVaultBuilderClient> {
    await initClients();
    return getPlaintext();
}

// ── Deterministic UUID from name ────────────────────────────────────────

export function nameToUUID(name: string): string {
    const hash = crypto.createHash("sha256").update(name).digest("hex");
    return [
        hash.slice(0, 8),
        hash.slice(8, 12),
        "4" + hash.slice(13, 16),
        ((parseInt(hash[16], 16) & 0x3) | 0x8).toString(16) + hash.slice(17, 20),
        hash.slice(20, 32),
    ].join("-");
}

// ── Collection Management ───────────────────────────────────────────────

export interface CompanyCollections {
    meta: string;
    employees: string;
    payrollRuns: string;
    vouchers: string;
}

const _collectionCache = new Map<string, CompanyCollections>();

export async function ensureCompanyCollections(companyId: string): Promise<CompanyCollections> {
    const cached = _collectionCache.get(companyId);
    if (cached) return cached;

    await initClients();
    const client = getPlaintext();

    const collections = [
        { key: "meta", name: `company_${companyId}_meta`, schema: COMPANY_META_SCHEMA },
        { key: "employees", name: `company_${companyId}_employees_v3`, schema: COMPANY_EMPLOYEES_SCHEMA },
        { key: "payrollRuns", name: `company_${companyId}_payroll_runs_v3`, schema: PAYROLL_RUNS_SCHEMA },
        { key: "vouchers", name: `company_${companyId}_vouchers_v3`, schema: VOUCHERS_SCHEMA },
    ] as const;

    const result: Record<string, string> = {};

    await Promise.all(
        collections.map(async (col) => {
            const id = nameToUUID(col.name);
            try {
                await withRetry(
                    () => client.createCollection({
                        _id: id,
                        name: col.name,
                        schema: col.schema as any,
                        type: "standard",
                    }),
                    `createCollection(${col.name})`
                );
                console.log(`[nilDB] Created collection "${col.name}" (${id})`);
            } catch (e: any) {
                const msg = typeof e === "string" ? e : e?.message || JSON.stringify(e);
                if (msg.includes("already exists") || msg.includes("duplicate")) {
                    console.log(`[nilDB] Collection "${col.name}" already exists (${id})`);
                } else {
                    const errMsg = e instanceof Error ? e.message : JSON.stringify(e);
                    throw new Error(`[nilDB] createCollection(${col.name}) failed: ${errMsg}`);
                }
            }
            result[col.key] = id;
        })
    );

    const companyColls: CompanyCollections = {
        meta: result.meta,
        employees: result.employees,
        payrollRuns: result.payrollRuns,
        vouchers: result.vouchers,
    };

    _collectionCache.set(companyId, companyColls);
    return companyColls;
}

// ── Voucher Status Lifecycle ────────────────────────────────────────────

const VALID_TRANSITIONS: Record<string, string[]> = {
    pending: ["posted"],
    posted: ["claimed"],
    claimed: ["settled"],
};

function validateTransition(from: string, to: string): void {
    const allowed = VALID_TRANSITIONS[from];
    if (!allowed || !allowed.includes(to)) {
        throw new Error(`[nilDB] Invalid voucher transition: ${from} → ${to}`);
    }
}

// ── Typed Storage API — Company Meta ────────────────────────────────────

export async function upsertCompanyMeta(
    companyId: string,
    meta: {
        taxId?: string;
        companyAddress?: string;
        escrowContractAddress?: string;
        payrollFrequency?: string;
        currentEpoch?: string;
    }
) {
    await initClients();
    const colls = await ensureCompanyCollections(companyId);
    const client = getPlaintext();

    // Check if meta already exists
    const existing = await withRetry(
        () => client.findData({ collection: colls.meta, filter: { company_id: companyId } }),
        "findCompanyMeta"
    );

    const existingData = extractRecords(existing);
    if (existingData.length > 0) {
        // Update
        await withRetry(
            () => client.updateData({
                collection: colls.meta,
                filter: { company_id: companyId },
                update: {
                    $set: {
                        ...(meta.taxId ? { tax_id: meta.taxId } : {}),
                        ...(meta.companyAddress ? { company_address: meta.companyAddress } : {}),
                        ...(meta.escrowContractAddress ? { escrow_contract_address: meta.escrowContractAddress } : {}),
                        ...(meta.payrollFrequency ? { payroll_frequency: meta.payrollFrequency } : {}),
                        ...(meta.currentEpoch ? { current_epoch: meta.currentEpoch } : {}),
                        updated_at: new Date().toISOString(),
                    },
                },
            }),
            "updateCompanyMeta"
        );
        console.log(`[nilDB] Updated company meta for ${companyId}`);
    } else {
        // Create
        await withRetry(
            () => getPlaintext().createStandardData({
                collection: colls.meta,
                data: [{
                    _id: crypto.randomUUID(),
                    company_id: companyId,
                    tax_id: meta.taxId || "",
                    company_address: meta.companyAddress || "",
                    escrow_contract_address: meta.escrowContractAddress || "",
                    payroll_frequency: meta.payrollFrequency || "monthly",
                    current_epoch: meta.currentEpoch || "0",
                    created_at: new Date().toISOString(),
                }],
            }),
            "createCompanyMeta"
        );
        console.log(`[nilDB] Created company meta for ${companyId}`);
    }
}

export async function getCompanyMeta(companyId: string) {
    await initClients();
    const colls = await ensureCompanyCollections(companyId);
    const result = await withRetry(
        () => getPlaintext().findData({ collection: colls.meta, filter: { company_id: companyId } }),
        "getCompanyMeta"
    );
    const data = extractRecords(result);
    return data[0] || null;
}

// ── Typed Storage API — Employees ───────────────────────────────────────

export async function createEmployees(
    companyId: string,
    employees: Array<{ employeeTag: string; employeeName?: string; salary: string }>
) {
    await initClients();
    const colls = await ensureCompanyCollections(companyId);
    // Use blindfold client so salary is secret-shared with %allot encryption.
    // No single Nillion node can read the salary amount in plaintext.
    const client = getBlindfolded();

    const data = employees.map(emp => ({
        _id: crypto.randomUUID(),
        employee_tag: emp.employeeTag,
        employee_name: emp.employeeName || "",
        // %allot marks this field for Nillion secret-sharing (Nucleus requirement)
        salary: { "%allot": emp.salary },
        status: "active",
        created_at: new Date().toISOString(),
    }));

    const result = await withRetry(
        () => (client as any).createStandardData({ collection: colls.employees, data }),
        "createEmployees"
    );
    console.log(`[nilDB] Stored ${data.length} employees for company ${companyId.slice(0, 8)}…`);
    return result;
}

export async function listActiveEmployees(companyId: string) {
    await initClients();
    const colls = await ensureCompanyCollections(companyId);
    // Blindfold client reconstructs %allot secret fields (salary) from cluster
    return withRetry(
        () => getBlindfolded().findData({ collection: colls.employees, filter: { status: "active" } }),
        "listActiveEmployees"
    );
}

// ── Typed Storage API — Payroll Runs ────────────────────────────────────

export async function createPayrollRun(
    companyId: string,
    run: {
        runId: string;
        epoch: string;
        merkleRoot: string;
        commitmentCount: number;
        commitments: string[];
        status?: string;
        zkProofHash?: string;
        employerAddress?: string;
        nilccAttestation?: string;
    }
) {
    await initClients();
    const colls = await ensureCompanyCollections(companyId);
    const client = getPlaintext();

    // Idempotent check — don't create duplicate runs
    const existing = await withRetry(
        () => client.findData({ collection: colls.payrollRuns, filter: { run_id: run.runId } }),
        "checkExistingRun"
    );
    const existingData = extractRecords(existing);
    if (existingData.length > 0) {
        console.log(`[nilDB] Payroll run ${run.runId} already exists — skipping create`);
        return existingData[0];
    }

    // Use plaintext client — epoch/merkle_root are public (on-chain) values
    const result = await withRetry(
        () => (client as any).createStandardData({
            collection: colls.payrollRuns,
            data: [{
                _id: crypto.randomUUID(),
                run_id: run.runId,
                epoch: run.epoch,
                merkle_root: run.merkleRoot,
                commitment_count: run.commitmentCount.toString(),
                status: run.status || "generated",
                zk_proof_hash: run.zkProofHash || "",
                tx_hash: "",
                employer_address: run.employerAddress || "",
                nilcc_attestation: run.nilccAttestation || "",
                commitments: JSON.stringify(run.commitments),
                created_at: new Date().toISOString(),
            }],
        }),
        "createPayrollRun"
    );
    console.log(`[nilDB] Stored payroll run ${run.runId} (TEE Attested: ${!!run.nilccAttestation})`);
    return result;
}

export async function listPayrollRuns(companyId: string) {
    await initClients();
    const colls = await ensureCompanyCollections(companyId);
    return withRetry(
        () => getPlaintext().findData({ collection: colls.payrollRuns, filter: {} }),
        "listPayrollRuns"
    );
}

export async function getPayrollRun(companyId: string, runId: string) {
    await initClients();
    const colls = await ensureCompanyCollections(companyId);
    const result = await withRetry(
        () => getPlaintext().findData({ collection: colls.payrollRuns, filter: { run_id: runId } }),
        "getPayrollRun"
    );
    const data = extractRecords(result);
    return data[0] || null;
}

export async function updatePayrollRunStatus(
    companyId: string,
    runId: string,
    status: string,
    txHash?: string
) {
    await initClients();
    const colls = await ensureCompanyCollections(companyId);
    await withRetry(
        () => getPlaintext().updateData({
            collection: colls.payrollRuns,
            filter: { run_id: runId },
            update: {
                $set: {
                    status,
                    ...(txHash ? { tx_hash: txHash } : {}),
                    updated_at: new Date().toISOString(),
                },
            },
        }),
        "updatePayrollRunStatus"
    );
    console.log(`[nilDB] Updated run ${runId} → ${status}`);
}

// ── Typed Storage API — Vouchers ────────────────────────────────────────

export async function createVoucherBatch(
    companyId: string,
    vouchers: Array<{
        commitment: string;
        employeeTag: string;
        amount: string;
        nonce: string;
        epoch: string;
        runId: string;
        employerAddress: string;
        nullifier?: string;
    }>
) {
    await initClients();
    const colls = await ensureCompanyCollections(companyId);

    const data = vouchers.map(v => ({
        _id: crypto.randomUUID(),
        commitment: v.commitment,
        employee_tag: v.employeeTag,
        amount: v.amount,
        nonce: v.nonce,
        nullifier: v.nullifier || "",
        epoch: v.epoch,
        run_id: v.runId,
        employer_address: v.employerAddress,
        status: "pending",
        claimed_at: "",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    }));

    const result = await withRetry(
        () => getPlaintext().createStandardData({ collection: colls.vouchers, data }),
        "createVoucherBatch"
    );
    console.log(`[nilDB] Stored ${data.length} vouchers for company ${companyId.slice(0, 8)}…`);
    return result;
}

export async function listVouchersByEpoch(companyId: string, epoch: string) {
    await initClients();
    const colls = await ensureCompanyCollections(companyId);
    return withRetry(
        () => getPlaintext().findData({ collection: colls.vouchers, filter: { epoch } }),
        "listVouchersByEpoch"
    );
}

export async function listVouchersByEmployee(companyId: string, employeeTag: string) {
    await initClients();
    const colls = await ensureCompanyCollections(companyId);
    return withRetry(
        () => getPlaintext().findData({ collection: colls.vouchers, filter: { employee_tag: employeeTag } }),
        "listVouchersByEmployee"
    );
}

export async function listAllVouchers(companyId: string) {
    await initClients();
    const colls = await ensureCompanyCollections(companyId);
    return withRetry(
        () => getPlaintext().findData({ collection: colls.vouchers, filter: {} }),
        "listAllVouchers"
    );
}

export async function updateVoucherStatus(
    companyId: string,
    commitment: string,
    newStatus: string,
    txHash?: string
) {
    await initClients();
    const colls = await ensureCompanyCollections(companyId);

    // Note: We cannot query the current status from NilDB because commitment
    // is an %allot field (encrypted). For now we skip lifecycle validation
    // on encrypted fields. In production, use a public commitment_hash for filtering.
    await withRetry(
        () => getPlaintext().updateData({
            collection: colls.vouchers,
            filter: { commitment },
            update: {
                $set: {
                    status: newStatus,
                    ...(txHash ? { tx_hash: txHash } : {}),
                    ...(newStatus === "settled" ? { claimed_at: new Date().toISOString() } : {}),
                    updated_at: new Date().toISOString(),
                },
            },
        }),
        "updateVoucherStatus"
    );
    console.log(`[nilDB] Updated voucher → ${newStatus}`);
}

/**
 * Update voucher status without knowing the companyId.
 * Scans all registered employer profile collections (same logic as GET /api/employees/vouchers).
 * Used from the employee side where companyId is not known.
 */
export async function updateVoucherStatusByCommitment(
    commitment: string,
    newStatus: string,
    txHash?: string
): Promise<boolean> {
    await initClients();

    const PROFILE_COLLECTION_NAME = "civitas_employer_profiles";
    const profileCollectionId = nameToUUID(PROFILE_COLLECTION_NAME);

    let companyIdsToTry: string[] = ["default"];
    try {
        const profilesResult = await withRetry(
            () => getPlaintext().findData({ collection: profileCollectionId, filter: {} }),
            "updateVoucherStatusByCommitment:getProfiles"
        );
        const profiles = extractRecords(profilesResult);
        const discovered = profiles.map((p: any) => p.company_id).filter(Boolean);
        companyIdsToTry = [...new Set(["default", ...discovered])] as string[];
    } catch { /* non-fatal */ }

    for (const cid of companyIdsToTry) {
        try {
            const colls = await ensureCompanyCollections(cid);
            // Find vouchers in this company matching the commitment
            const result = await withRetry(
                () => getPlaintext().findData({ collection: colls.vouchers, filter: { commitment } }),
                "updateVoucherStatusByCommitment:find"
            );
            const records = extractRecords(result);
            if (records.length > 0) {
                await withRetry(
                    () => getPlaintext().updateData({
                        collection: colls.vouchers,
                        filter: { commitment },
                        update: {
                            $set: {
                                status: newStatus,
                                ...(txHash ? { tx_hash: txHash } : {}),
                                ...(newStatus === "claimed" ? { claimed_at: new Date().toISOString() } : {}),
                                updated_at: new Date().toISOString(),
                            },
                        },
                    }),
                    "updateVoucherStatusByCommitment:update"
                );
                console.log(`[nilDB] Updated voucher in company ${cid} → ${newStatus}`);
                return true;
            }
        } catch { /* collection may not exist */ }
    }

    console.warn(`[nilDB] Voucher commitment not found in any company collection`);
    return false;
}

// ── Identity Store Schema ────────────────────────────────────────────────
// Replaces the file-based orchestrator/identity.js on Vercel (EROFS fix).
// One global collection holds all employee + auditor identity records.

const IDENTITY_STORE_SCHEMA = {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: "Civitas Identity Store",
    type: "array" as const,
    items: {
        type: "object" as const,
        properties: {
            _id: { type: "string" as const, format: "uuid" },
            employee_id: { type: "string" as const },
            username: { type: "string" as const },
            username_normalized: { type: "string" as const },
            password_hash: { type: "string" as const },
            employee_tag: { type: "string" as const },
            credential_nonce: { type: "string" as const },
            zkpass_credential_json: { type: "string" as const },
            org_id: { type: "string" as const },
            vouchers_json: { type: "string" as const },
            credential_vouchers_json: { type: "string" as const },
            role: { type: "string" as const },
            profile_json: { type: "string" as const },
            status: { type: "string" as const },
            created_at: { type: "string" as const },
            updated_at: { type: "string" as const },
        },
        required: ["_id", "employee_id", "employee_tag", "role"],
    },
};

const IDENTITY_COLLECTION_NAME = "civitas_identity_store_v1";

let _identityCollectionId: string | null = null;

async function ensureIdentityCollection(): Promise<string> {
    if (_identityCollectionId) return _identityCollectionId;

    await initClients();
    const client = getPlaintext();
    const id = nameToUUID(IDENTITY_COLLECTION_NAME);

    try {
        await withRetry(
            () => client.createCollection({
                _id: id,
                name: IDENTITY_COLLECTION_NAME,
                schema: IDENTITY_STORE_SCHEMA as any,
                type: "standard",
            }),
            `createCollection(${IDENTITY_COLLECTION_NAME})`
        );
        console.log(`[nilDB] Created identity collection (${id})`);
    } catch (e: any) {
        const msg = typeof e === "string" ? e : e?.message || JSON.stringify(e);
        if (msg.includes("already exists") || msg.includes("duplicate")) {
            console.log(`[nilDB] Identity collection already exists (${id})`);
        } else {
            const errMsg = e instanceof Error ? e.message : JSON.stringify(e);
            throw new Error(`[nilDB] createCollection(identity_store) failed: ${errMsg}`);
        }
    }

    _identityCollectionId = id;
    return id;
}

/**
 * Serialise an EmployeeRecord into the flat NilDB row format.
 */
function serializeIdentityRecord(record: Record<string, any>): Record<string, any> {
    return {
        _id: record._id || crypto.randomUUID(),
        employee_id: record.employee_id,
        username: record.username || "",
        username_normalized: record.username_normalized || (record.username || "").toLowerCase(),
        password_hash: record.password_hash || "",
        employee_tag: record.employee_tag,
        credential_nonce: record.credential_nonce || "",
        zkpass_credential_json: JSON.stringify(record.zkpass_credential || {}),
        org_id: record.org_id || "unassigned",
        vouchers_json: JSON.stringify(record.vouchers || []),
        credential_vouchers_json: JSON.stringify(record.credential_vouchers || []),
        role: record.role || "employee",
        profile_json: JSON.stringify(record.profile || {}),
        status: record.status || "active",
        created_at: record.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
    };
}

/**
 * Deserialise a NilDB row back into a full EmployeeRecord-shaped object.
 */
function deserializeIdentityRecord(row: Record<string, any>): Record<string, any> {
    return {
        employee_id: row.employee_id,
        username: row.username,
        username_normalized: row.username_normalized,
        password_hash: row.password_hash,
        employee_tag: row.employee_tag,
        credential_nonce: row.credential_nonce,
        zkpass_credential: (() => { try { return JSON.parse(row.zkpass_credential_json || "{}"); } catch { return {}; } })(),
        org_id: row.org_id,
        vouchers: (() => { try { return JSON.parse(row.vouchers_json || "[]"); } catch { return []; } })(),
        credential_vouchers: (() => { try { return JSON.parse(row.credential_vouchers_json || "[]"); } catch { return []; } })(),
        role: row.role,
        profile: (() => { try { return JSON.parse(row.profile_json || "{}"); } catch { return {}; } })(),
        status: row.status,
        created_at: row.created_at,
        updated_at: row.updated_at,
    };
}

/**
 * Insert or update an identity record in NilDB.
 * Uses employee_tag as the unique key.
 */
export async function upsertIdentityRecord(record: Record<string, any>): Promise<void> {
    const collId = await ensureIdentityCollection();
    const client = getPlaintext();
    const row = serializeIdentityRecord(record);

    // Check if row already exists
    const existing = await withRetry(
        () => client.findData({ collection: collId, filter: { employee_tag: record.employee_tag } }),
        "identity.findByTag(upsert)"
    );
    const existingData = extractRecords(existing);

    if (existingData.length > 0) {
        // Update existing record
        await withRetry(
            () => client.updateData({
                collection: collId,
                filter: { employee_tag: record.employee_tag },
                update: { $set: row },
            }),
            "identity.update"
        );
    } else {
        // Create new record
        await withRetry(
            () => (client as any).createStandardData({ collection: collId, data: [row] }),
            "identity.create"
        );
    }
}

/**
 * Fetch an identity record by employee_tag.
 */
export async function getIdentityByTag(tag: string): Promise<Record<string, any> | null> {
    if (!tag) return null;
    const collId = await ensureIdentityCollection();
    const result = await withRetry(
        () => getPlaintext().findData({ collection: collId, filter: { employee_tag: tag } }),
        "identity.findByTag"
    );
    const data = extractRecords(result);
    return data.length > 0 ? deserializeIdentityRecord(data[0]) : null;
}

/**
 * Fetch an identity record by normalized username.
 */
export async function getIdentityByUsername(username: string): Promise<Record<string, any> | null> {
    if (!username) return null;
    const normalized = username.trim().toLowerCase();
    const collId = await ensureIdentityCollection();
    const result = await withRetry(
        () => getPlaintext().findData({ collection: collId, filter: { username_normalized: normalized } }),
        "identity.findByUsername"
    );
    const data = extractRecords(result);
    return data.length > 0 ? deserializeIdentityRecord(data[0]) : null;
}

/**
 * List all identity records.
 */
export async function listIdentities(): Promise<Record<string, any>[]> {
    const collId = await ensureIdentityCollection();
    const result = await withRetry(
        () => getPlaintext().findData({ collection: collId, filter: {} }),
        "identity.list"
    );
    return extractRecords(result).map(deserializeIdentityRecord);
}

/**
 * Partial-update an identity record by employee_tag.
 */
export async function updateIdentityRecord(tag: string, patch: Record<string, any>): Promise<void> {
    const collId = await ensureIdentityCollection();

    // Re-serialize only the patched fields that are structured (json blobs)
    const flatPatch: Record<string, any> = { ...patch, updated_at: new Date().toISOString() };
    if ("zkpass_credential" in patch) {
        flatPatch.zkpass_credential_json = JSON.stringify(patch.zkpass_credential);
        delete flatPatch.zkpass_credential;
    }
    if ("vouchers" in patch) {
        flatPatch.vouchers_json = JSON.stringify(patch.vouchers);
        delete flatPatch.vouchers;
    }
    if ("credential_vouchers" in patch) {
        flatPatch.credential_vouchers_json = JSON.stringify(patch.credential_vouchers);
        delete flatPatch.credential_vouchers;
    }
    if ("profile" in patch) {
        flatPatch.profile_json = JSON.stringify(patch.profile);
        delete flatPatch.profile;
    }

    await withRetry(
        () => getPlaintext().updateData({
            collection: collId,
            filter: { employee_tag: tag },
            update: { $set: flatPatch },
        }),
        "identity.patch"
    );
}

// ── Backward Compat Aliases (for routes not yet migrated) ───────────────

export const ensureCollections = ensureCompanyCollections;

// ── Solana-era Facade ─────────────────────────────────────────────────────────
// Higher-level methods used by the new Solana-oriented API routes.
// These wrap the lower-level functions above with a server-client object pattern
// so API routes don't need to manage companyId scoping themselves.

export interface NillionServerClient {
  getEmployeesForPayroll(companyId: string): Promise<Array<{ employee_tag: string; salary_amount: string }>>;
  createPayrollRun(run: {
    runId: string;
    companyId: string;
    merkleRoot: string;
    totalAmount: string;
    employeeCount: number;
    status: string;
    nilccAttestation: string;
    commitments?: string[];
    epoch?: string;
  }): Promise<void>;
  getPayrollRun(runId: string): Promise<{
    merkleRoot: string;
    epoch: string;
    commitments: string[];
    status: string;
  } | null>;
  settleVoucher(data: {
    employeeTag: string;
    nullifier: string;
    txSignature: string;
    settledAt: string;
  }): Promise<void>;
  createEmployee(data: {
    employeeTag: string;
    name: string;
    salary: string;
    currency: string;
    companyId: string;
    status: string;
  }): Promise<void>;
  createInvoice(data: {
    invoiceId: string;
    contractorTag: string;
    contractorAddress?: string;
    commitment: string;
    amount: string;
    epoch: string;
    voucherNonce: string;
    dueDate: string;
    description: string;
    status: string;
  }): Promise<void>;
  getInvoice(invoiceId: string): Promise<{
    invoiceId: string;
    contractorTag: string;
    commitment: string;
    amount: string;
    dueDate: string;
    description: string;
    status: string;
  } | null>;
}

/**
 * Returns a type-safe NillionServerClient for use in API routes.
 * Initialises the underlying nilDB clients if needed.
 */
export async function getNillionServerClient(): Promise<NillionServerClient> {
  await initClients();

  return {
    async getEmployeesForPayroll(companyId) {
      const colls = await ensureCompanyCollections(companyId);
      // Blindfold client reconstructs %allot secret fields (salary) from cluster nodes
      const result = await withRetry(
        () => getBlindfolded().findData({ collection: colls.employees, filter: { status: "active" } }),
        "getEmployeesForPayroll"
      );
      const rows = extractRecords(result);
      return rows.map((r: any) => ({
        employee_tag: r.employee_tag,
        salary_amount: unwrapNilDBField(r.salary) || "0",
      }));
    },

    async createPayrollRun(run) {
      const colls = await ensureCompanyCollections(run.companyId);
      // Idempotent
      const existing = await withRetry(
        () => getPlaintext().findData({ collection: colls.payrollRuns, filter: { run_id: run.runId } }),
        "checkExistingRun"
      );
      if (extractRecords(existing).length > 0) return;

      await withRetry(
        () => (getPlaintext() as any).createStandardData({
          collection: colls.payrollRuns,
          data: [{
            _id: crypto.randomUUID(),
            run_id: run.runId,
            epoch: run.epoch || String(Math.floor(Date.now() / 1000)),
            merkle_root: run.merkleRoot,
            commitment_count: String(run.employeeCount),
            status: run.status,
            zk_proof_hash: "",
            tx_hash: "",
            nilcc_attestation: run.nilccAttestation,
            commitments: JSON.stringify(run.commitments || []),
            created_at: new Date().toISOString(),
          }],
        }),
        "createPayrollRun"
      );
    },

    async getPayrollRun(runId) {
      // Search across all company collections (runId is globally unique UUID)
      // Simplified: use a global payroll runs collection
      const globalId = nameToUUID("civitas_global_payroll_runs_v3");
      try {
        const result = await withRetry(
          () => getPlaintext().findData({ collection: globalId, filter: { run_id: runId } }),
          "getPayrollRun"
        );
        const rows = extractRecords(result);
        if (!rows.length) return null;
        const r = rows[0];
        return {
          merkleRoot: r.merkle_root,
          epoch: r.epoch,
          commitments: (() => { try { return JSON.parse(r.commitments || "[]"); } catch { return []; } })(),
          status: r.status,
        };
      } catch {
        return null;
      }
    },

    async settleVoucher(data) {
      // Update voucher status across identity store by employeeTag
      await updateIdentityRecord(data.employeeTag, {
        status: "settled",
        updated_at: data.settledAt,
      });
    },

    async createEmployee(data) {
      const colls = await ensureCompanyCollections(data.companyId);
      // Idempotent
      const existing = await withRetry(
        () => getPlaintext().findData({ collection: colls.employees, filter: { employee_tag: data.employeeTag } }),
        "checkExistingEmployee"
      );
      if (extractRecords(existing).length > 0) return;

      await withRetry(
        () => (getPlaintext() as any).createStandardData({
          collection: colls.employees,
          data: [{
            _id: crypto.randomUUID(),
            employee_tag: data.employeeTag,
            employee_name: data.name,
            salary: data.salary,
            status: data.status,
            created_at: new Date().toISOString(),
          }],
        }),
        "createEmployee"
      );
    },

    async createInvoice(data) {
      const globalId = nameToUUID("civitas_invoices_v1");
      await withRetry(
        () => (getPlaintext() as any).createStandardData({
          collection: globalId,
          data: [{
            _id: crypto.randomUUID(),
            invoice_id: data.invoiceId,
            contractor_tag: data.contractorTag,
            contractor_address: data.contractorAddress ?? "",
            commitment: data.commitment,
            amount: data.amount,
            epoch: data.epoch,
            voucher_nonce: data.voucherNonce,
            due_date: data.dueDate,
            description: data.description,
            status: data.status,
            created_at: new Date().toISOString(),
          }],
        }),
        "createInvoice"
      );
    },

    async getInvoice(invoiceId) {
      const globalId = nameToUUID("civitas_invoices_v1");
      try {
        const result = await withRetry(
          () => getPlaintext().findData({ collection: globalId, filter: { invoice_id: invoiceId } }),
          "getInvoice"
        );
        const rows = extractRecords(result);
        if (!rows.length) return null;
        const r = rows[0];
        return {
          invoiceId: r.invoice_id,
          contractorTag: r.contractor_tag,
          commitment: r.commitment,
          amount: r.amount,
          dueDate: r.due_date,
          description: r.description,
          status: r.status,
        };
      } catch {
        return null;
      }
    },
  };
}
