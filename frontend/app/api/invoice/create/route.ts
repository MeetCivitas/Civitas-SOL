/**
 * POST /api/invoice/create
 * Contractor creates a shareable private invoice.
 *
 * Flow:
 *   1. Generate a voucher commitment for the invoice amount (server-side)
 *   2. Store encrypted invoice in NilDB
 *   3. Return: { invoiceId, shareLink, commitment }
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { contractorTag, amount, dueDate, description, contractorAddress } = body as {
      contractorTag: string;
      amount: string;
      dueDate: string;
      description?: string;
      contractorAddress: string;
    };

    if (!contractorTag || !amount || !dueDate) {
      return NextResponse.json(
        { error: "Missing contractorTag, amount, or dueDate" },
        { status: 400 }
      );
    }

    const amountBig = BigInt(amount);
    if (amountBig <= BigInt(0)) {
      return NextResponse.json({ error: "Amount must be positive" }, { status: 400 });
    }

    const invoiceId = uuidv4();
    const epoch = Math.floor(Date.now() / 1000);

    // Generate a random voucher nonce for this invoice
    const { randomBytes } = await import("crypto");
    const voucherNonce = BigInt("0x" + randomBytes(16).toString("hex"));

    // Compute BN254 Poseidon commitment (matches nilCC + circuit)
    // employee_tag = contractor_tag here; same commitment formula
    // commitment = Poseidon(contractor_tag, amount, epoch, voucher_nonce)
    const { poseidon4 } = await import("poseidon-lite");
    const commitment = poseidon4([
      BigInt(contractorTag),
      amountBig,
      BigInt(epoch),
      voucherNonce,
    ]);

    const commitmentHex = "0x" + commitment.toString(16).padStart(64, "0");

    // Store in NilDB with encrypted amount
    const { getNillionServerClient } = await import("@/lib/server/nillion-server");
    const nillionClient = await getNillionServerClient();

    await nillionClient.createInvoice({
      invoiceId,
      contractorTag,
      contractorAddress,
      commitment: commitmentHex,
      amount, // encrypted in NilDB via %share
      epoch: epoch.toString(),
      voucherNonce: voucherNonce.toString(),
      dueDate,
      description: description ?? "",
      status: "pending",
    });

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://civitas.finance";
    const shareLink = `${baseUrl}/invoice/${invoiceId}`;

    return NextResponse.json({
      invoiceId,
      shareLink,
      commitment: commitmentHex,
    });
  } catch (err: unknown) {
    console.error("[invoice/create]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Invoice creation failed" }, { status: 500 });
  }
}
