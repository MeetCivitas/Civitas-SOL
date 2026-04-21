import crypto from "crypto";
import { SecretVaultBuilderClient } from '@nillion/secretvaults';
import { NilauthClient } from '@nillion/nilauth-client';
import { Signer } from '@nillion/nuc';

// Using the secret key verified in your subscription screenshot
const ORG_SECRET_KEY = process.env.NEXT_PUBLIC_NILLION_ORG_SECRET_KEY || "c34db89dc5d843c2a61232602b443e6e4cddde6910e43a8c0be8567ae7fba394";

// Updated for Feb 2026 Migration
const NILLION_DBS = [
    "https://nildb-stg-n1.nillion.network",
    "https://nildb-stg-n2.nillion.network",
    "https://nildb-stg-n3.nillion.network",
];

// New staging Nilauth endpoint
const NILAUTH_URL = "https://nilauth-1bc3.staging.nillion.network";

// Deterministic UUID from a name (same helper as nillion-server.ts)
function nameToUUID(name: string): string {
    const hash = crypto.createHash("sha256").update(name).digest("hex");
    return [
        hash.slice(0, 8),
        hash.slice(8, 12),
        "4" + hash.slice(13, 16),
        ((parseInt(hash[16], 16) & 0x3) | 0x8).toString(16) + hash.slice(17, 20),
        hash.slice(20, 32),
    ].join("-");
}

// Test schema — simple key-value with one secret-shared field
const TEST_SCHEMA = {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: "Nillion Test Collection",
    type: "array" as const,
    items: {
        type: "object" as const,
        properties: {
            _id: { type: "string" as const, format: "uuid" },
            label: { type: "string" as const },
            secret_value: {
                type: "object" as const,
                properties: { "%share": { type: "string" as const } },
            },
            created_at: { type: "string" as const },
        },
        required: ["_id", "label", "secret_value"],
    },
};

async function main() {
    console.log("🚀 Starting Nillion Connection Test...\n");

    try {
        // 1. Initialize the Signer
        const signer = Signer.fromPrivateKey(ORG_SECRET_KEY);
        console.log("🔑 Signer Initialized");

        // 2. Initialize NilauthClient
        console.log("🔌 Connecting to Nilauth Service...");
        const nilauthClient = await NilauthClient.create({
            baseUrl: NILAUTH_URL,
            chainId: 11155111,
            signer,
        } as any);

        // 3. Initialize SecretVaultBuilderClient with blindfold
        console.log("🔌 Connecting to Nillion Nodes...");
        const client = await SecretVaultBuilderClient.from({
            signer,
            nilauthClient,
            dbs: NILLION_DBS,
            blindfold: { operation: "store" },
        });
        console.log("  ↳ Connected successfully.");

        // 4. Refresh Root Token
        console.log("\n🔄 Refreshing Root Token...");
        await client.refreshRootToken();
        console.log("  ↳ Token refreshed successfully.");

        // 5. Verify Subscription Status
        console.log("\n🔍 Checking Subscription Status...");
        const status = await client.subscriptionStatus();

        if (status.subscribed) {
            console.log("  ↳ ✅ Subscribed: Yes");
            if (status.details) {
                const expiryDate = new Date(Number(status.details.expiresAt));
                console.log(`  ↳ Expires At: ${expiryDate.toLocaleString()}`);
            }
        } else {
            console.log("  ↳ ❌ Subscribed: No");
            console.log("  ↳ Hint: Ensure the DID above matches the one in your nilPay portal.");
            return; // Can't proceed without subscription
        }

        // 6. Test Collection Creation with proper UUID
        console.log("\n📦 Testing Collection Creation...");
        const collectionName = "civitas_test_collection";
        const collectionId = nameToUUID(collectionName);
        console.log(`  ↳ Name: ${collectionName}`);
        console.log(`  ↳ UUID: ${collectionId}`);

        try {
            const createResult = await client.createCollection({
                _id: collectionId,
                name: collectionName,
                schema: TEST_SCHEMA as any,
                type: "standard",
            });
            console.log("  ↳ ✅ Collection created:", createResult);
        } catch (e: any) {
            const msg = e?.message || JSON.stringify(e);
            if (msg.includes("already exists") || msg.includes("duplicate")) {
                console.log("  ↳ ℹ️  Collection already exists, continuing...");
            } else {
                throw e;
            }
        }

        // 7. Test Writing Data via createStandardData
        console.log("\n📝 Testing Data Write (createStandardData)...");
        const testDoc = {
            _id: crypto.randomUUID(),
            label: "test_entry_" + Date.now(),
            secret_value: { "%share": "42" },
            created_at: new Date().toISOString(),
        };
        console.log(`  ↳ Writing doc: ${testDoc._id}`);

        const writeResult = await client.createStandardData({
            collection: collectionId,
            data: [testDoc],
        });
        console.log("  ↳ ✅ Write result:", JSON.stringify(writeResult, null, 2));

        // 8. Test Reading Data via findData
        console.log("\n📖 Testing Data Read (findData)...");
        const readResult = await client.findData({
            collection: collectionId,
            filter: { label: testDoc.label },
        });
        console.log("  ↳ ✅ Read result:", JSON.stringify(readResult, null, 2));

        console.log("\n✅ All tests passed! NilDB integration is working correctly.");

    } catch (error: any) {
        console.error("\n❌ Error during Nillion operations:");
        console.error(error.message || error);
        if (error.cause) console.error("Cause:", error.cause);
    }
}

main();