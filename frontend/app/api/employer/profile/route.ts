import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import {
    getPlaintextClient,
    withRetry,
    extractRecords,
    isNillionConfigured,
    ensureCompanyCollections,
    nameToUUID,
} from "@/lib/server/nillion-server";

export const runtime = "nodejs";

function addressToCompanyId(address: string): string {
    return crypto
        .createHash("sha256")
        .update(address.toLowerCase())
        .digest("hex")
        .slice(0, 20);
}

const PROFILE_COLLECTION_NAME = "civitas_employer_profiles";

const PROFILE_SCHEMA = {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: "Employer Profiles",
    type: "array" as const,
    items: {
        type: "object" as const,
        properties: {
            _id: { type: "string" as const, format: "uuid" },
            owner_address: { type: "string" as const },
            company_id: { type: "string" as const },
            employer_name: { type: "string" as const },
            position: { type: "string" as const },
            company_name: { type: "string" as const },
            industry: { type: "string" as const },
            employee_count_range: { type: "string" as const },
            escrow_contract: { type: "string" as const },
            created_at: { type: "string" as const },
            updated_at: { type: "string" as const },
        },
        required: ["_id", "owner_address", "company_id", "company_name"],
    },
};

let _profileCollectionId: string | null = null;

async function ensureProfileCollection(): Promise<string> {
    if (_profileCollectionId) return _profileCollectionId;

    const id = nameToUUID(PROFILE_COLLECTION_NAME);
    const client = await getPlaintextClient();

    try {
        await withRetry(
            () => client.createCollection({
                _id: id,
                name: PROFILE_COLLECTION_NAME,
                schema: PROFILE_SCHEMA as any,
                type: "standard",
            }),
            "createProfileCollection"
        );
        console.log(`[profile] Created collection "${PROFILE_COLLECTION_NAME}" (${id})`);
    } catch (e: any) {
        const msg = typeof e === "string" ? e : e?.message || JSON.stringify(e);
        if (msg.includes("already exists") || msg.includes("duplicate")) {
            console.log(`[profile] Collection "${PROFILE_COLLECTION_NAME}" already exists (${id})`);
        } else {
            console.error("[profile] createCollection failed:", msg);
            throw e;
        }
    }

    _profileCollectionId = id;
    return id;
}

// ── GET /api/employer/profile?address=0x... ─────────────────────────────
export async function GET(req: NextRequest) {
    const address = req.nextUrl.searchParams.get("address");
    if (!address) {
        return NextResponse.json({ error: "address required" }, { status: 400 });
    }

    if (!isNillionConfigured()) {
        return NextResponse.json({ exists: false, backendConfigured: false });
    }

    try {
        const collectionId = await ensureProfileCollection();
        const client = await getPlaintextClient();

        const result = await withRetry(
            () => client.findData({
                collection: collectionId,
                filter: { owner_address: address.toLowerCase() },
            }),
            "getEmployerProfile"
        );
        const records = extractRecords(result);
        if (records.length === 0) {
            return NextResponse.json({ exists: false });
        }

        const p = records[0];
        return NextResponse.json({
            exists: true,
            profile: {
                companyId: p.company_id,
                employerName: p.employer_name || "",
                position: p.position || "",
                name: p.company_name,
                industry: p.industry || "",
                employeeCountRange: p.employee_count_range || "",
                escrowContract: p.escrow_contract || "",
                ownerAddress: p.owner_address,
            },
        });
    } catch (err: any) {
        console.error("[profile GET] error:", err);
        return NextResponse.json({ error: err.message || "Failed" }, { status: 500 });
    }
}

// ── POST /api/employer/profile ──────────────────────────────────────────
export async function POST(req: NextRequest) {
    const body = await req.json();
    const {
        ownerAddress,
        employerName,
        position,
        companyName,
        industry,
        employeeCountRange,
        escrowContract,
    } = body;

    if (!ownerAddress || !companyName) {
        return NextResponse.json({ error: "ownerAddress and companyName required" }, { status: 400 });
    }

    const companyId = addressToCompanyId(ownerAddress);
    const now = new Date().toISOString();

    const profilePayload = {
        companyId,
        employerName: employerName || "",
        position: position || "",
        name: companyName,
        industry: industry || "",
        employeeCountRange: employeeCountRange || "",
        escrowContract: escrowContract || "",
        ownerAddress,
    };

    if (!isNillionConfigured()) {
        // Allow the profile to be "created" without NilDB — in-memory only for the session
        return NextResponse.json({
            success: true,
            profile: profilePayload,
            _note: "NilDB not configured. Profile stored client-side only.",
        });
    }

    try {
        const collectionId = await ensureProfileCollection();
        const client = await getPlaintextClient();

        // Check existing
        const existing = await withRetry(
            () => client.findData({
                collection: collectionId,
                filter: { owner_address: ownerAddress.toLowerCase() },
            }),
            "checkExistingProfile"
        );
        const existingRecords = extractRecords(existing);

        if (existingRecords.length > 0) {
            await withRetry(
                () => client.updateData({
                    collection: collectionId,
                    filter: { owner_address: ownerAddress.toLowerCase() },
                    update: {
                        $set: {
                            employer_name: employerName || "",
                            position: position || "",
                            company_name: companyName,
                            industry: industry || "",
                            employee_count_range: employeeCountRange || "",
                            escrow_contract: escrowContract || "",
                            updated_at: now,
                        },
                    },
                }),
                "updateProfile"
            );
        } else {
            await withRetry(
                () => (client as any).createStandardData({
                    collection: collectionId,
                    data: [{
                        _id: crypto.randomUUID(),
                        owner_address: ownerAddress.toLowerCase(),
                        company_id: companyId,
                        employer_name: employerName || "",
                        position: position || "",
                        company_name: companyName,
                        industry: industry || "",
                        employee_count_range: employeeCountRange || "",
                        escrow_contract: escrowContract || "",
                        created_at: now,
                        updated_at: now,
                    }],
                }),
                "createProfile"
            );
        }

        // Ensure per-company NilDB collections exist
        await ensureCompanyCollections(companyId).catch(err =>
            console.warn("[profile POST] ensureCompanyCollections:", err?.message)
        );

        return NextResponse.json({ success: true, profile: profilePayload });
    } catch (err: any) {
        console.error("[profile POST] error:", err);
        return NextResponse.json({ error: err.message || "Failed" }, { status: 500 });
    }
}
