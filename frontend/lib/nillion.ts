// lib/nillion.ts
// Nillion SecretVaults integration for Civitas
// Stores encrypted payroll data with secret-shared sensitive fields

import { SecretVaultBuilderClient } from "@nillion/secretvaults";
import { Signer } from "@nillion/nuc";
import { NilauthClient } from "@nillion/nilauth-client";

// ── Configuration ───────────────────────────────────────────────────────

const PRIVATE_KEY = process.env.NEXT_PUBLIC_NILLION_ORG_SECRET_KEY as string;

const NILLION_DBS = [
    "https://nildb-stg-n1.nillion.network",
    "https://nildb-stg-n2.nillion.network",
    "https://nildb-stg-n3.nillion.network",
];
const NILAUTH_URL = "https://nilauth-1bc3.staging.nillion.network";

// ── Schema Definitions ──────────────────────────────────────────────────

/** Employee registry — stores employee_tag and salary policy */
const EMPLOYEE_REGISTRY_SCHEMA = {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: "Employee Registry",
    type: "array",
    items: {
        type: "object",
        properties: {
            _id: { type: "string", format: "uuid" },
            employee_tag: { type: "string" },
            company_id: { type: "string" },
            salary_amount: {
                type: "object",
                properties: { "%share": { type: "string" } },
            },
            salary_currency: { type: "string" },
            status: { type: "string" },
            created_at: { type: "string" },
        },
        required: ["_id", "employee_tag", "company_id", "salary_amount"],
    },
};

/** Voucher store — stores encrypted voucher data for employees */
const VOUCHER_STORE_SCHEMA = {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: "Voucher Store",
    type: "array",
    items: {
        type: "object",
        properties: {
            _id: { type: "string", format: "uuid" },
            employee_tag: { type: "string" },
            amount: {
                type: "object",
                properties: { "%share": { type: "string" } },
            },
            epoch: { type: "string" },
            voucher_nonce: {
                type: "object",
                properties: { "%share": { type: "string" } },
            },
            commitment: { type: "string" },
            company_id: { type: "string" },
            status: { type: "string" },
            created_at: { type: "string" },
        },
        required: ["_id", "employee_tag", "amount", "epoch", "voucher_nonce", "commitment"],
    },
};

/** Company registry */
const COMPANY_REGISTRY_SCHEMA = {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: "Company Registry",
    type: "array",
    items: {
        type: "object",
        properties: {
            _id: { type: "string", format: "uuid" },
            company_id: { type: "string" },
            name: { type: "string" },
            owner_address: { type: "string" },
            escrow_contract: { type: "string" },
            created_at: { type: "string" },
        },
        required: ["_id", "company_id", "name", "owner_address"],
    },
};

// ── Client Initialization ───────────────────────────────────────────────

let _client: SecretVaultBuilderClient | null = null;

export async function getNillionClient(): Promise<SecretVaultBuilderClient> {
    if (_client) return _client;

    if (!PRIVATE_KEY) {
        throw new Error("NEXT_PUBLIC_NILLION_ORG_SECRET_KEY not set");
    }

    const signer = Signer.fromPrivateKey(PRIVATE_KEY);
    const nilauthClient = await NilauthClient.create({
        baseUrl: NILAUTH_URL,
        chainId: 11155111,
        signer,
    } as any);

    _client = await SecretVaultBuilderClient.from({
        signer,
        nilauthClient,
        dbs: NILLION_DBS,
        blindfold: { operation: "store" },
    });

    await _client.refreshRootToken();
    return _client;
}

// ── Collection Management ───────────────────────────────────────────────

export async function createEmployeeCollection(companyId: string) {
    const client = await getNillionClient() as any;
    const name = `civitas_employees_${companyId}`;
    const collection = await client.createCollection({
        _id: name,
        name,
        schema: EMPLOYEE_REGISTRY_SCHEMA,
        type: "owned",
    });
    return collection._id;
}

export async function createVoucherCollection(companyId: string, epoch: string) {
    const client = await getNillionClient() as any;
    const name = `civitas_vouchers_${companyId}_${epoch}`;
    const collection = await client.createCollection({
        _id: name,
        name,
        schema: VOUCHER_STORE_SCHEMA,
        type: "owned",
    });
    return collection._id;
}

export async function createCompanyCollection() {
    const client = await getNillionClient() as any;
    const name = "civitas_companies";
    const collection = await client.createCollection({
        _id: name,
        name,
        schema: COMPANY_REGISTRY_SCHEMA,
        type: "owned",
    });
    return collection._id;
}

// ── Data Operations ─────────────────────────────────────────────────────

export async function storeEmployee(
    collectionId: string,
    data: {
        employeeTag: string;
        companyId: string;
        salaryAmount: string;
        salaryCurrency: string;
    }
) {
    const client = await getNillionClient() as any;
    const result = await client.writeToCollection({
        collectionId,
        data: [
            {
                employee_tag: data.employeeTag,
                company_id: data.companyId,
                salary_amount: { "%share": data.salaryAmount },
                salary_currency: data.salaryCurrency,
                status: "active",
                created_at: new Date().toISOString(),
            },
        ],
    });
    return result.createdIds[0];
}

export async function storeVoucher(
    collectionId: string,
    data: {
        employeeTag: string;
        amount: string;
        epoch: string;
        voucherNonce: string;
        commitment: string;
        companyId: string;
    }
) {
    const client = await getNillionClient() as any;
    const result = await client.writeToCollection({
        collectionId,
        data: [
            {
                employee_tag: data.employeeTag,
                amount: { "%share": data.amount },
                epoch: data.epoch,
                voucher_nonce: { "%share": data.voucherNonce },
                commitment: data.commitment,
                company_id: data.companyId,
                status: "pending",
                created_at: new Date().toISOString(),
            },
        ],
    });
    return result.createdIds[0];
}

export async function storeCompany(
    collectionId: string,
    data: {
        companyId: string;
        name: string;
        ownerAddress: string;
        escrowContract: string;
    }
) {
    const client = await getNillionClient() as any;
    const result = await client.writeToCollection({
        collectionId,
        data: [
            {
                company_id: data.companyId,
                name: data.name,
                owner_address: data.ownerAddress,
                escrow_contract: data.escrowContract,
                created_at: new Date().toISOString(),
            },
        ],
    });
    return result.createdIds[0];
}
