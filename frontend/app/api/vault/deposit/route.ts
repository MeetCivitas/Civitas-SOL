import { NextResponse } from "next/server";
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";

const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_SOLANA_PAYROLL_PROGRAM ??
  process.env.NEXT_PUBLIC_CIVITAS_PROGRAM_ID ??
  "CQW3TnN4X6iG2potguVv2hCKfk4f9tf8PMG7dTV6e24y"
);

const RPC =
  process.env.NEXT_PUBLIC_SOLANA_CLUSTER === "mainnet-beta"
    ? "https://api.mainnet-beta.solana.com"
    : "https://api.devnet.solana.com";

const DEPOSIT_USDC_DISCRIMINATOR = Buffer.from([184, 148, 250, 169, 224, 213, 34, 126]);

function encodeDepositAmount(amount: bigint) {
  const data = Buffer.alloc(16);
  DEPOSIT_USDC_DISCRIMINATOR.copy(data, 0);
  data.writeBigUInt64LE(amount, 8);
  return data;
}

export async function POST(request: Request) {
  try {
    const { ownerAddress, amount } = await request.json();

    if (!ownerAddress) {
      return NextResponse.json({ error: "ownerAddress is required" }, { status: 400 });
    }

    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return NextResponse.json({ error: "amount must be greater than 0" }, { status: 400 });
    }

    const owner = new PublicKey(ownerAddress);
    const connection = new Connection(RPC, "confirmed");
    const mint = new PublicKey(
      process.env.NEXT_PUBLIC_USDC_MINT ?? "9pan9bMn5HatX4EJdBwg9VgCa7Uz5HL8N1m5D3NdXejP"
    );

    const mintInfo = await connection.getParsedAccountInfo(mint);
    const rawMintInfo = mintInfo.value;
    if (!rawMintInfo) {
      return NextResponse.json({ error: `Configured Token-2022 mint does not exist: ${mint.toBase58()}` }, { status: 400 });
    }
    if (!rawMintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)) {
      return NextResponse.json(
        { error: `Configured mint must be Token-2022. Current owner: ${rawMintInfo.owner.toBase58()}` },
        { status: 400 }
      );
    }

    const decimals =
      "parsed" in rawMintInfo.data
        ? Number((rawMintInfo.data.parsed as any)?.info?.decimals ?? 6)
        : 6;
    const baseUnits = BigInt(Math.round(numericAmount * 10 ** decimals));

    const [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), owner.toBuffer()],
      PROGRAM_ID
    );
    const vaultInfo = await connection.getAccountInfo(vaultPda);
    if (!vaultInfo || vaultInfo.data.length < 8) {
      return NextResponse.json({ error: "Vault is not initialized yet" }, { status: 400 });
    }

    const ownerUsdc = getAssociatedTokenAddressSync(
      mint,
      owner,
      false,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const ownerUsdcInfo = await connection.getAccountInfo(ownerUsdc);

    const vaultUsdc = getAssociatedTokenAddressSync(
      mint,
      vaultPda,
      true,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    // Build the instruction list — prepend an ATA creation if the owner doesn't have one yet
    const instructions: TransactionInstruction[] = [];
    if (!ownerUsdcInfo) {
      console.log(`[vault/deposit] Owner ATA missing — prepending createAssociatedTokenAccount ix`);
      instructions.push(
        createAssociatedTokenAccountInstruction(
          owner,                       // payer
          ownerUsdc,                   // associated token account to create
          owner,                       // owner of the new account
          mint,                        // mint
          TOKEN_2022_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      );
    }

    instructions.push(
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: owner, isSigner: true, isWritable: true },
          { pubkey: vaultPda, isSigner: false, isWritable: true },
          { pubkey: mint, isSigner: false, isWritable: false },
          { pubkey: ownerUsdc, isSigner: false, isWritable: true },
          { pubkey: vaultUsdc, isSigner: false, isWritable: true },
          { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: encodeDepositAmount(baseUnits),
      })
    );

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    const tx = new Transaction({ feePayer: owner, blockhash, lastValidBlockHeight });
    instructions.forEach((i) => tx.add(i));

    return NextResponse.json({
      serializedTransaction: tx.serialize({ requireAllSignatures: false }).toString("base64"),
      vaultPda: vaultPda.toBase58(),
      ownerTokenAccount: ownerUsdc.toBase58(),
      vaultTokenAccount: vaultUsdc.toBase58(),
      amount: baseUnits.toString(),
      decimals,
    });
  } catch (error: any) {
    console.error("[vault/deposit]", error);
    return NextResponse.json({ error: error?.message ?? "Failed to build deposit transaction" }, { status: 500 });
  }
}
