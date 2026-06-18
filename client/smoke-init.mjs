// Civitas Ephemeral smoke test — initialize_payroll_pool on devnet.
// Uses raw @solana/web3.js (no IDL needed) by computing the Anchor
// discriminator + manual Borsh encoding.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

const PROGRAM_ID = new PublicKey("BW2wwxbsSjixSfXNGoD9ajoUq8394ZkB2Fn9PusXjJfs");
const MINT = new PublicKey("ZYyofZ4gtjJqHZN7dKMeX8CyuzELq4mj266JCooTm3A");
const RPC = "https://api.devnet.solana.com";
const TREASURY_SEED = Buffer.from("civ_treasury");

const wallet = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(`${homedir()}/.config/solana/id.json`, "utf-8"))),
);

// Anchor discriminator = sha256("global:<snake_case_method>")[0..8]
function anchorDiscriminator(method) {
  const h = createHash("sha256").update(`global:${method}`).digest();
  return h.subarray(0, 8);
}

function encodeU64LE(n) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(n));
  return buf;
}

function encodeInitializePayrollPool({ perEmployeeLimit, dailyLimit, complianceAttestor }) {
  const disc = anchorDiscriminator("initialize_payroll_pool");
  const a = encodeU64LE(perEmployeeLimit);
  const b = encodeU64LE(dailyLimit);
  const c = complianceAttestor.toBuffer();
  return Buffer.concat([disc, a, b, c]);
}

async function main() {
  const conn = new Connection(RPC, "confirmed");
  console.log("authority:", wallet.publicKey.toBase58());
  const balance = await conn.getBalance(wallet.publicKey);
  console.log("balance:", balance / 1e9, "SOL");

  const [treasury, treasuryBump] = PublicKey.findProgramAddressSync(
    [TREASURY_SEED, wallet.publicKey.toBuffer()],
    PROGRAM_ID,
  );
  const treasuryAta = getAssociatedTokenAddressSync(MINT, treasury, true);

  console.log("treasury PDA:", treasury.toBase58(), `(bump ${treasuryBump})`);
  console.log("treasury ATA:", treasuryAta.toBase58());

  // Use wallet as its own compliance attestor for the smoke test.
  const data = encodeInitializePayrollPool({
    perEmployeeLimit: 5_000_000_000n,   // 5000 units (6-decimal mint)
    dailyLimit: 100_000_000_000n,       // 100k units
    complianceAttestor: wallet.publicKey,
  });

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: wallet.publicKey,           isSigner: true,  isWritable: true  }, // authority
      { pubkey: MINT,                       isSigner: false, isWritable: false }, // mint
      { pubkey: treasury,                   isSigner: false, isWritable: true  }, // treasury
      { pubkey: treasuryAta,                isSigner: false, isWritable: true  }, // treasury_token_account
      { pubkey: TOKEN_PROGRAM_ID,           isSigner: false, isWritable: false }, // token_program
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID,isSigner: false, isWritable: false }, // associated_token_program
      { pubkey: SystemProgram.programId,    isSigner: false, isWritable: false }, // system_program
      { pubkey: SYSVAR_RENT_PUBKEY,         isSigner: false, isWritable: false }, // rent
    ],
    data,
  });

  const tx = new Transaction().add(ix);
  console.log("submitting initialize_payroll_pool…");
  const sig = await sendAndConfirmTransaction(conn, tx, [wallet], {
    commitment: "confirmed",
    skipPreflight: false,
  });
  console.log("signature:", sig);
  console.log("explorer:", `https://explorer.solana.com/tx/${sig}?cluster=devnet`);

  const treasuryAccount = await conn.getAccountInfo(treasury);
  if (!treasuryAccount) throw new Error("treasury PDA not created");
  console.log("treasury PDA on-chain:", {
    owner: treasuryAccount.owner.toBase58(),
    dataLen: treasuryAccount.data.length,
    lamports: treasuryAccount.lamports / 1e9,
  });
  const ataAccount = await conn.getAccountInfo(treasuryAta);
  if (!ataAccount) throw new Error("treasury ATA not created");
  console.log("treasury ATA on-chain:", {
    owner: ataAccount.owner.toBase58(),
    lamports: ataAccount.lamports / 1e9,
  });
  console.log("\n✅ initialize_payroll_pool succeeded end-to-end on devnet.");
}

main().catch((e) => {
  console.error("FAILED:", e);
  if (e?.logs) console.error("logs:", e.logs);
  process.exit(1);
});
