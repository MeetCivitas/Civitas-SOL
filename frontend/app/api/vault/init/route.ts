/**
 * app/api/vault/init/route.ts
 *
 * Builds the `initialize_vault` Anchor instruction and returns a serialised
 * transaction for the client to sign with their connected wallet.
 *
 * POST body:  { ownerAddress: string, snsDomain?: string | null }
 * Response:   { serializedTransaction: string (base64), vaultPda: string }
 */

import { NextResponse } from "next/server";
import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";

const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_CIVITAS_PROGRAM_ID ?? "CQW3TnN4X6iG2potguVv2hCKfk4f9tf8PMG7dTV6e24y"
);

const RPC =
  process.env.NEXT_PUBLIC_SOLANA_CLUSTER === "mainnet-beta"
    ? "https://api.mainnet-beta.solana.com"
    : "https://api.devnet.solana.com";

/** 8-byte Anchor discriminator for initialize_vault instruction */
function getDiscriminator(name: string): Buffer {
  // Anchor sighash = sha256("global:<name>")[0..8]
  const { createHash } = require("crypto");
  const hash = createHash("sha256").update(`global:${name}`).digest();
  return Buffer.from(hash.slice(0, 8));
}

export async function POST(request: Request) {
  try {
    const { ownerAddress, snsDomain } = await request.json();

    if (!ownerAddress) {
      return NextResponse.json({ error: "ownerAddress is required" }, { status: 400 });
    }

    const owner = new PublicKey(ownerAddress);
    const connection = new Connection(RPC, "confirmed");

    // Derive VaultState PDA
    const [vaultPda, vaultBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), owner.toBuffer()],
      PROGRAM_ID
    );

    // Check if vault already exists — avoid unnecessary transaction
    const vaultInfo = await connection.getAccountInfo(vaultPda);
    if (vaultInfo && vaultInfo.data.length > 8) {
      return NextResponse.json(
        { error: "Vault already initialized", vaultPda: vaultPda.toBase58(), alreadyExists: true },
        { status: 409 }
      );
    }

    // Derive USDC vault ATA (Token-2022 associated token account for the vault PDA)
    // For the serialised tx we include the owner as the fee payer; the
    // client's wallet signs and the instruction creates the accounts.
    const USDC_MINT = new PublicKey(
      process.env.NEXT_PUBLIC_USDC_MINT ?? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
    );

    // Build the initialize_vault instruction data (Borsh-encoded)
    // Layout: discriminator(8) | sns_domain: Option<String>
    const disc = getDiscriminator("initialize_vault");

    let snsDomainBytes: Buffer;
    if (snsDomain && snsDomain.trim().length > 0) {
      const domainStr = snsDomain.trim();
      const strBuf = Buffer.from(domainStr, "utf8");
      const lenBuf = Buffer.alloc(4);
      lenBuf.writeUInt32LE(strBuf.length, 0);
      snsDomainBytes = Buffer.concat([Buffer.from([1]), lenBuf, strBuf]); // Some(string)
    } else {
      snsDomainBytes = Buffer.from([0]); // None
    }

    const instructionData = Buffer.concat([disc, snsDomainBytes]);

    // Accounts required by initialize_vault context in Anchor:
    // [signer, vault_state (init), usdc_vault (init), mint, system_program, token_program, ...]
    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: owner, isSigner: true, isWritable: true },          // owner / payer
        { pubkey: vaultPda, isSigner: false, isWritable: true },      // vault_state (PDA, init)
        { pubkey: USDC_MINT, isSigner: false, isWritable: false },    // usdc mint
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: instructionData,
    });

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    const tx = new Transaction({
      feePayer: owner,
      blockhash,
      lastValidBlockHeight,
    });
    tx.add(ix);

    const serializedTransaction = tx.serialize({ requireAllSignatures: false }).toString("base64");

    return NextResponse.json({
      serializedTransaction,
      vaultPda: vaultPda.toBase58(),
    });
  } catch (error: any) {
    console.error("[vault/init]", error);
    return NextResponse.json(
      { error: error?.message ?? "Internal server error" },
      { status: 500 }
    );
  }
}
