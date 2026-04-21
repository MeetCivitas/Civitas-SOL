import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { Signer } from '@nillion/nuc';
import { NilauthClient } from '@nillion/nilauth-client';
import { SecretVaultBuilderClient } from '@nillion/secretvaults';

const ORG_SECRET_KEY = process.env.NEXT_PUBLIC_NILLION_ORG_SECRET_KEY || "";

const NILLION_DBS = [
  'https://nildb-stg-n1.nillion.network',
  'https://nildb-stg-n2.nillion.network',
  'https://nildb-stg-n3.nillion.network',
];
const NILAUTH_URL = "https://nilauth-1bc3.staging.nillion.network";

export async function POST(request: Request) {
  try {
    const { runId, orgId } = await request.json();

    if (!runId || !orgId) {
      return NextResponse.json(
        { success: false, error: "Invalid payload: runId and orgId are required" },
        { status: 400 }
      );
    }

    if (!ORG_SECRET_KEY) {
      return NextResponse.json(
        { success: false, error: "NEXT_PUBLIC_NILLION_ORG_SECRET_KEY not set" },
        { status: 500 }
      );
    }

    // 1. Initialize Builder Client
    const signer = Signer.fromPrivateKey(ORG_SECRET_KEY);
    const nilauthClient = await NilauthClient.create({
      baseUrl: NILAUTH_URL,
      chainId: 11155111,
      signer,
    } as any);

    const builder = await SecretVaultBuilderClient.from({
      signer,
      nilauthClient,
      dbs: NILLION_DBS,
      blindfold: { operation: 'store' },
    });

    // 2. Refresh token
    await builder.refreshRootToken();

    // 3. Register builder profile (idempotent — safe to run every time)
    try {
      await builder.readProfile();
    } catch {
      const didStr = await builder.getId();
      await builder.register({
        did: didStr,
        name: "zkPayroll Builder",
      });
      console.log("Builder profile registered");
    }

    // 4. Create Collection with proper UUID
    const collectionId = randomUUID();
    const collectionName = `zkPayroll_Run_${runId}`;

    console.log(`Creating collection: ${collectionName}`);

    await builder.createCollection({
      _id: collectionId,
      type: 'standard',
      name: collectionName,
      schema: {
        type: "array",
        items: {
          type: "object",
          properties: {
            _id: { type: "string" },
            decryption_key: { type: "string" },
            encrypted_payload: { type: "string" },
            iv: { type: "string" },
            employee_tag: { type: "string" },
            org_id: { type: "string" },
          },
          required: ["_id", "decryption_key", "encrypted_payload", "iv", "employee_tag", "org_id"],
        },
      },
    });

    console.log("Collection created:", collectionId);

    return NextResponse.json({
      success: true,
      data: {
        run_id: runId,
        collection_id: collectionId,
        name: collectionName
      },
    });

  } catch (error: any) {
    console.error("Collection creation failed:", error);

    if (Array.isArray(error)) {
      error.forEach((e: any, i: number) => {
        const nodeId = e.node;
        const msg = e.error?.message || e;
        const body = e.error?.body;
        console.error(`Node ${i} (${nodeId}): ${msg}`);
        if (body) {
          console.error('Body details:', JSON.stringify(body, null, 2));
        }
      });
    } else {
      console.error('Single error:', error.message);
    }

    return NextResponse.json(
      { success: false, error: error.message || "Collection creation failed" },
      { status: 500 }
    );
  }
}