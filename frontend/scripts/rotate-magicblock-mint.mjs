#!/usr/bin/env node
/**
 * Rotate NEXT_PUBLIC_MAGICBLOCK_USDC_MINT by minting a fresh legacy SPL
 * token, funding the deployer's ATA, and printing the new env value.
 *
 * Usage: from project root,
 *   node scripts/rotate-magicblock-mint.mjs
 *
 * Requires:
 *   - CIVITAS_DEPLOYER_KEYPAIR_PATH set in env or hard-coded below
 *   - solana CLI's default RPC reachable on devnet
 *   - deployer keypair has ≥0.1 SOL on devnet
 *
 * After this finishes, paste the printed line into frontend/.env.local
 * (replacing the old NEXT_PUBLIC_MAGICBLOCK_USDC_MINT) and restart the
 * dev server. Then click the "Pre-fund MagicBlock ER" button on /employer
 * — that runs delegateSpl against the new mint, and ensureTransferQueueReady
 * will init the (new) queue PDA at minimal size and delegate it cleanly.
 */

import {
  Connection,
  Keypair,
  Transaction,
  SystemProgram,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  MINT_SIZE,
  createInitializeMint2Instruction,
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  getMinimumBalanceForRentExemptMint,
} from "@solana/spl-token";
import fs from "node:fs";

const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";
const KP_PATH =
  process.env.CIVITAS_DEPLOYER_KEYPAIR_PATH ||
  `${process.env.HOME}/.config/solana/id.json`;
const DECIMALS = 6;
const INITIAL_SUPPLY = 1_000_000_000_000n; // 1,000,000.000000 USDC

if (!fs.existsSync(KP_PATH)) {
  console.error(`✗ deployer keypair not found at ${KP_PATH}`);
  console.error("  set CIVITAS_DEPLOYER_KEYPAIR_PATH to override");
  process.exit(1);
}

const deployer = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(KP_PATH, "utf8"))),
);
const mintKp = Keypair.generate();

console.log("deployer:", deployer.publicKey.toBase58());
console.log("new mint:", mintKp.publicKey.toBase58());
console.log("RPC:     ", RPC);

const conn = new Connection(RPC, "confirmed");

const lamportsForMint = await getMinimumBalanceForRentExemptMint(conn);
const deployerAta = getAssociatedTokenAddressSync(
  mintKp.publicKey,
  deployer.publicKey,
  false,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
);

const tx = new Transaction()
  .add(
    SystemProgram.createAccount({
      fromPubkey: deployer.publicKey,
      newAccountPubkey: mintKp.publicKey,
      space: MINT_SIZE,
      lamports: lamportsForMint,
      programId: TOKEN_PROGRAM_ID,
    }),
  )
  .add(
    createInitializeMint2Instruction(
      mintKp.publicKey,
      DECIMALS,
      deployer.publicKey,
      deployer.publicKey,
      TOKEN_PROGRAM_ID,
    ),
  )
  .add(
    createAssociatedTokenAccountIdempotentInstruction(
      deployer.publicKey,
      deployerAta,
      deployer.publicKey,
      mintKp.publicKey,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    ),
  )
  .add(
    createMintToInstruction(
      mintKp.publicKey,
      deployerAta,
      deployer.publicKey,
      INITIAL_SUPPLY,
      [],
      TOKEN_PROGRAM_ID,
    ),
  );

tx.feePayer = deployer.publicKey;
tx.recentBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;
tx.partialSign(deployer, mintKp);

const sig = await conn.sendRawTransaction(tx.serialize(), {
  skipPreflight: false,
  maxRetries: 5,
});
await conn.confirmTransaction(sig, "confirmed");

console.log("\n✓ Mint created + funded");
console.log("  tx:    ", sig);
console.log("  ATA:   ", deployerAta.toBase58());
console.log("  supply:", INITIAL_SUPPLY.toString(), "base units (=", Number(INITIAL_SUPPLY) / 10 ** DECIMALS, "USDC)");
console.log("\nUpdate frontend/.env.local — replace the line:");
console.log(`  NEXT_PUBLIC_MAGICBLOCK_USDC_MINT=${mintKp.publicKey.toBase58()}`);
console.log("\nThen restart `npm run dev` and click 'Pre-fund MagicBlock ER' on /employer.");
