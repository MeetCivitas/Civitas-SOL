import { NextResponse } from 'next/server';
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

export async function GET() {
  try {
    if (!ORG_SECRET_KEY) {
      return NextResponse.json({ error: "Server missing NEXT_PUBLIC_NILLION_ORG_SECRET_KEY" }, { status: 500 });
    }

    // 1. Initialize Signer
    const signer = Signer.fromPrivateKey(ORG_SECRET_KEY);

    // 2. Init Client
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

    // 3. Check Subscription Status
    console.log("📝 Checking subscription status...");
    const subStatus = await builder.subscriptionStatus();
    console.log("✅ Subscription status:", subStatus);

    // 4. Refresh Token
    console.log("🔄 Attempting to refresh root token...");
    await builder.refreshRootToken();
    console.log("✅ Root token refreshed successfully!");

    const did = await builder.getId();
    console.log("🔑 DID:", did);

    return NextResponse.json({
      success: true,
      did,
      subscribed: subStatus.subscribed,
      message: "Wallet is subscribed and ready!"
    });

  } catch (error: any) {
    console.error("❌ Error:", error.message);

    return NextResponse.json({
      success: false,
      error: error.message,
      instruction: "Ensure your wallet is funded and subscribed via the nilPay portal."
    }, { status: 500 });
  }
}