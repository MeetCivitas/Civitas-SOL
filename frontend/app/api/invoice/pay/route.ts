/**
 * POST /api/invoice/pay
 * Employer pays a contractor invoice via the chunked payroll pipeline.
 *
 * Returns serialised transactions for wallet signing:
 *   deposit + start_run + append_chunk + finalize_root
 */

import { NextRequest, NextResponse } from "next/server";
import {
  Connection,
  PublicKey,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { RPC_ENDPOINT, PROGRAM_ID } from "@/lib/solana-program";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { invoiceId, payerAddress } = body as {
      invoiceId: string;
      payerAddress: string;
    };

    if (!invoiceId || !payerAddress) {
      return NextResponse.json({ error: "Missing invoiceId or payerAddress" }, { status: 400 });
    }

    const connection = new Connection(RPC_ENDPOINT, "confirmed");
    const payer = new PublicKey(payerAddress);

    // Fetch invoice from NilDB
    const { getNillionServerClient } = await import("@/lib/server/nillion-server");
    const nillionClient = await getNillionServerClient();
    const invoice = await nillionClient.getInvoice(invoiceId);

    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }
    if (invoice.status !== "pending") {
      return NextResponse.json({ error: "Invoice is not in pending state" }, { status: 400 });
    }

    // Derive PDAs
    const invoiceIdBytes = Buffer.from(invoiceId.replace(/-/g, ""), "hex");
    const [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), payer.toBuffer()],
      PROGRAM_ID
    );
    const [invoicePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("invoice"), invoiceIdBytes],
      PROGRAM_ID
    );
    const [runPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("run"), payer.toBuffer(), invoiceIdBytes],
      PROGRAM_ID
    );
    const chunkIdxBuf = Buffer.alloc(4);
    chunkIdxBuf.writeUInt32LE(0, 0);
    const [chunkPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("chunk"), invoiceIdBytes, chunkIdxBuf],
      PROGRAM_ID
    );

    const { blockhash } = await connection.getLatestBlockhash();

    // Build pay_invoice instruction
    const crypto = await import("crypto");
    const discriminator = crypto.createHash("sha256")
      .update("global:pay_invoice")
      .digest()
      .slice(0, 8);

    const data = Buffer.alloc(8 + 16);
    Buffer.from(discriminator).copy(data, 0);
    invoiceIdBytes.copy(data, 8);

    const { TransactionInstruction } = await import("@solana/web3.js");
    const payInvoiceIx = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: payer, isSigner: true, isWritable: true },
        { pubkey: vaultPda, isSigner: false, isWritable: true },
        { pubkey: invoicePda, isSigner: false, isWritable: true },
        { pubkey: runPda, isSigner: false, isWritable: true },
        { pubkey: chunkPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
      ],
      data,
    });

    const tx = new VersionedTransaction(
      new TransactionMessage({
        payerKey: payer,
        recentBlockhash: blockhash,
        instructions: [payInvoiceIx],
      }).compileToV0Message()
    );

    return NextResponse.json({
      invoiceId,
      serializedTransaction: Buffer.from(tx.serialize()).toString("base64"),
    });
  } catch (err: unknown) {
    console.error("[invoice/pay]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Invoice payment build failed" }, { status: 500 });
  }
}
