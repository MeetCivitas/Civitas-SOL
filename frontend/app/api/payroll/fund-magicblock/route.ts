/**
 * /api/payroll/fund-magicblock
 *
 * Employer-side pre-funding: deposits USDC from the deployer/employer
 * keypair into the MagicBlock Ephemeral Rollup so future claim
 * dispatches have a private balance to draw from.
 *
 * GET  → returns deployer pubkey + current public + private USDC balances.
 * POST → mints USDC to the deployer (devnet only — deployer is mint
 *        authority for the test mint), then deposits `amount` into the
 *        MagicBlock ER.
 *
 * For mainnet you'd remove the mintTo step and require the employer to
 * pre-fund their wallet with real USDC via any normal channel.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  getAccount,
} from "@solana/spl-token";
import fs from "node:fs";
import {
  employerDeposit,
  getEmployerPubkey,
  getEmployerAuthToken,
} from "@/lib/server/magicblock-auth";
import {
  assertMagicBlockHealthy,
  getPublicBalance,
  getPrivateBalance,
} from "@/lib/server/magicblock-private-payments";

export const runtime = "nodejs";

const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";
const USDC_MINT = new PublicKey(
  process.env.NEXT_PUBLIC_MAGICBLOCK_USDC_MINT || process.env.NEXT_PUBLIC_USDC_MINT || "",
);
const KEYPAIR_PATH = process.env.CIVITAS_DEPLOYER_KEYPAIR_PATH || "";

function loadKeypair(): Keypair {
  if (!KEYPAIR_PATH) throw new Error("CIVITAS_DEPLOYER_KEYPAIR_PATH not configured");
  const raw = fs.readFileSync(KEYPAIR_PATH, "utf8");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
}

function err(m: string, status = 400) {
  return NextResponse.json({ error: m }, { status });
}

export async function GET(_req: NextRequest) {
  try {
    const employer = getEmployerPubkey();
    const conn = new Connection(RPC, "confirmed");
    const ata = getAssociatedTokenAddressSync(
      USDC_MINT,
      new PublicKey(employer),
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    let walletUsdc = "0";
    try {
      const acct = await getAccount(conn, ata, "confirmed", TOKEN_PROGRAM_ID);
      walletUsdc = acct.amount.toString();
    } catch {
      // ATA may not exist — that's fine, balance is 0.
    }

    let publicBal = null;
    let privateBal = null;
    try {
      publicBal = await getPublicBalance(employer, USDC_MINT.toBase58(), "devnet");
    } catch (e) {
      publicBal = { error: (e as Error).message };
    }
    try {
      const token = await getEmployerAuthToken("devnet");
      privateBal = await getPrivateBalance(employer, USDC_MINT.toBase58(), token, "devnet");
    } catch (e) {
      privateBal = { error: (e as Error).message };
    }

    return NextResponse.json({
      employer,
      mint: USDC_MINT.toBase58(),
      walletUsdcBaseUnits: walletUsdc,
      magicBlockPublic: publicBal,
      magicBlockPrivate: privateBal,
    });
  } catch (e) {
    return err((e as Error).message, 500);
  }
}

interface FundBody {
  /** Amount in USDC base units (decimals=6). */
  amountBaseUnits: string;
  /** If true, mint USDC to the deployer first (devnet test only). */
  mintFirst?: boolean;
}

export async function POST(req: NextRequest) {
  let body: FundBody;
  try {
    body = await req.json();
  } catch {
    return err("invalid JSON");
  }
  if (!body.amountBaseUnits) return err("amountBaseUnits required");
  const amount = BigInt(body.amountBaseUnits);
  if (amount <= 0n) return err("amount must be positive");

  try {
    await assertMagicBlockHealthy();
  } catch (e) {
    return err(`MagicBlock unhealthy: ${(e as Error).message}`, 503);
  }

  const conn = new Connection(RPC, "confirmed");
  const payer = loadKeypair();

  // ── (Optional) mint USDC to deployer (devnet only) ──────────────────────
  let mintSig: string | null = null;
  if (body.mintFirst) {
    const ata = getAssociatedTokenAddressSync(
      USDC_MINT,
      payer.publicKey,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    const tx = new Transaction()
      .add(
        createAssociatedTokenAccountIdempotentInstruction(
          payer.publicKey,
          ata,
          payer.publicKey,
          USDC_MINT,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID,
        ),
      )
      .add(
        createMintToInstruction(
          USDC_MINT,
          ata,
          payer.publicKey,
          amount,
          [],
          TOKEN_PROGRAM_ID,
        ),
      );
    tx.feePayer = payer.publicKey;
    tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
    tx.partialSign(payer);
    try {
      mintSig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
      await conn.confirmTransaction(mintSig, "confirmed");
    } catch (e) {
      return err(`mintTo failed: ${(e as Error).message}`, 502);
    }
  }

  // ── Deposit into MagicBlock ER ──────────────────────────────────────────
  let depositSig: string;
  try {
    const result = await employerDeposit(amount, USDC_MINT.toBase58(), "devnet");
    depositSig = result.signature;
  } catch (e) {
    return err(`MagicBlock deposit failed: ${(e as Error).message}`, 502);
  }

  return NextResponse.json({
    ok: true,
    employer: getEmployerPubkey(),
    mintSig,
    depositSig,
    depositedBaseUnits: amount.toString(),
  });
}
