/**
 * POST /api/vault/close
 * Devnet utility — builds an unsigned close_vault transaction.
 * Closes the vault PDA + its token ATA, returning rent to the owner.
 * The vault owner's wallet must sign. Use this when the vault was initialized
 * with the wrong mint (e.g. the Token-2022 native mint) and needs to be reset.
 *
 * Body:     { ownerAddress: string }
 * Response: { serializedTransaction: string (base64), vaultPda: string, vaultUsdcAccount: string }
 */

import { NextRequest, NextResponse } from "next/server";
import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { createHash } from "crypto";

export const runtime = "nodejs";

const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_CIVITAS_PROGRAM_ID ?? "CQW3TnN4X6iG2potguVv2hCKfk4f9tf8PMG7dTV6e24y"
);

const RPC =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";

function getDiscriminator(name: string): Buffer {
  const hash = createHash("sha256").update(`global:${name}`).digest();
  return Buffer.from(hash.slice(0, 8));
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { ownerAddress } = body as { ownerAddress: string };

    if (!ownerAddress) {
      return NextResponse.json({ error: "ownerAddress required" }, { status: 400 });
    }

    const owner = new PublicKey(ownerAddress);
    const connection = new Connection(RPC, "confirmed");

    // Derive vault PDA
    const [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), owner.toBuffer()],
      PROGRAM_ID
    );

    // Fetch vault state to get the stored usdc_vault address and current mint
    const vaultInfo = await connection.getAccountInfo(vaultPda);
    if (!vaultInfo || vaultInfo.data.length <= 8) {
      return NextResponse.json({ error: "Vault does not exist" }, { status: 404 });
    }

    // Decode vault_state.usdc_vault (Pubkey at offset 93 in the Borsh layout):
    // 8 discriminator + 32 owner + 32 merkle_root + 8 commitment_count
    // + 8 usdc_balance_approx + 4 run_count + 1 sns_domain None = offset 93
    const vaultUsdcFromState = new PublicKey(vaultInfo.data.slice(93, 125));

    // Fetch the vault token account to get its mint
    const vaultUsdcInfo = await connection.getAccountInfo(vaultUsdcFromState);
    if (!vaultUsdcInfo || vaultUsdcInfo.data.length < 32) {
      return NextResponse.json({ error: "Vault USDC account not found" }, { status: 404 });
    }
    // Mint is at offset 0 in a token account
    const mintFromVault = new PublicKey(vaultUsdcInfo.data.slice(0, 32));

    console.log("[vault/close] vaultPda:", vaultPda.toBase58(),
      "usdc_vault:", vaultUsdcFromState.toBase58(),
      "mint:", mintFromVault.toBase58());

    // Build close_vault instruction
    // Accounts: owner, vault_state, usdc_mint, vault_usdc, token_program, system_program
    const disc = getDiscriminator("close_vault");
    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: owner, isSigner: true, isWritable: true },
        { pubkey: vaultPda, isSigner: false, isWritable: true },
        { pubkey: mintFromVault, isSigner: false, isWritable: false },
        { pubkey: vaultUsdcFromState, isSigner: false, isWritable: true },
        { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: disc,
    });

    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    const tx = new Transaction({ feePayer: owner, recentBlockhash: blockhash });
    tx.add(ix);

    const serializedTransaction = tx
      .serialize({ requireAllSignatures: false })
      .toString("base64");

    return NextResponse.json({
      success: true,
      serializedTransaction,
      vaultPda: vaultPda.toBase58(),
      vaultUsdcAccount: vaultUsdcFromState.toBase58(),
      currentMint: mintFromVault.toBase58(),
    });
  } catch (err: any) {
    console.error("[vault/close] error:", err.message, err.stack?.split("\n").slice(0, 4));
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
