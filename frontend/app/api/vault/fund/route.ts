/**
 * POST /api/vault/fund
 * Devnet-only helper — mints test USDC directly to the employer's vault token
 * account, signed server-side by the mint authority keypair.
 *
 * The USDC mint (NEXT_PUBLIC_USDC_MINT) must NOT be the Token-2022 native mint
 * (9pan9bMn...). Use a custom test mint with the deployer wallet as mint authority.
 * The deployer keypair path is read from CIVITAS_DEPLOYER_KEYPAIR_PATH.
 *
 * Body:     { ownerAddress: string, amountUsdc?: number }
 * Response: { success: true, signature: string, vaultUsdcAccount: string, amountUsdc: number }
 */

import { NextRequest, NextResponse } from "next/server";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import {
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import fs from "fs";

export const runtime = "nodejs";

const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_CIVITAS_PROGRAM_ID ?? "CQW3TnN4X6iG2potguVv2hCKfk4f9tf8PMG7dTV6e24y"
);

const USDC_MINT = new PublicKey(
  process.env.NEXT_PUBLIC_USDC_MINT ?? "Eknzs89o8LuQBeA6cidC7EA85iJas9scNxsJ1oDYNm98"
);

const RPC =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";

const USDC_DECIMALS = 6;

function loadDeployerKeypair(): Keypair {
  const path = process.env.CIVITAS_DEPLOYER_KEYPAIR_PATH;
  if (path) {
    try {
      const raw = JSON.parse(fs.readFileSync(path, "utf-8"));
      return Keypair.fromSecretKey(Uint8Array.from(raw));
    } catch (e: any) {
      throw new Error(`Cannot read deployer keypair from ${path}: ${e.message}`);
    }
  }
  throw new Error(
    "CIVITAS_DEPLOYER_KEYPAIR_PATH not set. " +
    "Add it to .env.local pointing to the mint authority keypair file."
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { ownerAddress, amountUsdc = 100_000 } = body as {
      ownerAddress: string;
      amountUsdc?: number;
    };

    if (!ownerAddress) {
      return NextResponse.json({ error: "ownerAddress required" }, { status: 400 });
    }

    // Refuse to operate if someone accidentally kept the native mint
    if (USDC_MINT.toBase58() === "9pan9bMn5HatX4EJdBwg9VgCa7Uz5HL8N1m5D3NdXejP") {
      return NextResponse.json(
        { error: "NEXT_PUBLIC_USDC_MINT is still the Token-2022 native mint. Update it to your custom test USDC mint." },
        { status: 400 }
      );
    }

    const deployer = loadDeployerKeypair();
    const owner = new PublicKey(ownerAddress);
    const connection = new Connection(RPC, "confirmed");

    // Derive vault PDA
    const [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), owner.toBuffer()],
      PROGRAM_ID
    );

    // Vault's Token-2022 USDC ATA
    const vaultUsdcAta = getAssociatedTokenAddressSync(
      USDC_MINT,
      vaultPda,
      true,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const amountRaw = BigInt(Math.round(amountUsdc * 10 ** USDC_DECIMALS));

    const tx = new Transaction();
    tx.add(
      createAssociatedTokenAccountIdempotentInstruction(
        deployer.publicKey, // payer
        vaultUsdcAta,
        vaultPda,           // owner of the ATA (vault PDA)
        USDC_MINT,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );
    tx.add(
      createMintToInstruction(
        USDC_MINT,
        vaultUsdcAta,
        deployer.publicKey, // mint authority = deployer
        amountRaw,
        [],
        TOKEN_2022_PROGRAM_ID
      )
    );

    tx.feePayer = deployer.publicKey;
    const { blockhash } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;

    // Sign server-side — no client signature required
    tx.sign(deployer);
    const raw = tx.serialize();
    const signature = await connection.sendRawTransaction(raw, { skipPreflight: false });
    await connection.confirmTransaction(signature, "confirmed");

    console.log("[vault/fund] minted", amountUsdc, "USDC to vault", vaultUsdcAta.toBase58(), "sig:", signature);

    return NextResponse.json({
      success: true,
      signature,
      vaultUsdcAccount: vaultUsdcAta.toBase58(),
      vaultPda: vaultPda.toBase58(),
      amountRaw: amountRaw.toString(),
      amountUsdc,
    });
  } catch (err: any) {
    console.error("[vault/fund] error:", err.message, err.stack?.split("\n").slice(0, 5));
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
