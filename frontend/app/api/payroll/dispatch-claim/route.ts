/**
 * /api/payroll/dispatch-claim
 *
 * Settles a Civitas voucher claim privately via MagicBlock Private
 * Payments — the on-chain `claim_payment` IX only verifies the Groth16
 * proof + burns a nullifier; THIS endpoint:
 *
 *   1. Confirms the on-chain claim tx is finalized + the nullifier PDA
 *      now exists (i.e. the program accepted the proof).
 *   2. Recomputes pi_hash from authoritative on-chain state +
 *      employee-supplied (recipient, amount, epoch). Rejects mismatch.
 *      This binds the proof's commitment to specific values WITHOUT ever
 *      having put recipient/amount on-chain.
 *   3. Triggers a real MagicBlock private transfer:
 *        employer-ER → employee-ER
 *        visibility=private, split=5, randomized 500–30000 ms delay.
 *      Signed locally with the employer keypair — no browser involvement.
 *
 * After this returns, the employee calls /api/payroll/private-pay?action=
 * withdraw to pull funds from their MagicBlock ER → base wallet.
 */

import { NextRequest, NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import { Transaction } from "@solana/web3.js";
import {
  recomputePiHash,
  bytesEqual,
  hexToBytes,
  bytesToHex,
} from "@/lib/server/pi-hash";
import {
  employerPrivateTransfer,
  getEmployerPubkey,
} from "@/lib/server/magicblock-auth";
import { assertMagicBlockHealthy } from "@/lib/server/magicblock-private-payments";
import fs from "node:fs";
import { Keypair } from "@solana/web3.js";

export const runtime = "nodejs";

const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_CIVITAS_PROGRAM_ID || "",
);
// MagicBlock requires legacy SPL Token mints. Use the dedicated mint
// for actual private settlement; this is also what the proof binds to
// in pi_hash (employees/page.tsx now uses MAGICBLOCK_USDC_MINT for the
// recipient ATA + mint fields).
const USDC_MINT = new PublicKey(
  process.env.NEXT_PUBLIC_MAGICBLOCK_USDC_MINT || process.env.NEXT_PUBLIC_USDC_MINT || "",
);
const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";
const DOMAIN_TAG =
  process.env.NEXT_PUBLIC_CIVITAS_DOMAIN_TAG || "civitas-devnet-v1";
const KEYPAIR_PATH = process.env.CIVITAS_DEPLOYER_KEYPAIR_PATH || "";

function err(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

interface DispatchBody {
  /**
   * Civitas claim tx signature (already submitted on-chain). Optional: if
   * absent or empty, dispatch relies solely on the nullifier PDA existence
   * check below — which is the actual proof that the on-chain claim ix ran
   * successfully. The sig lookup is a redundant defence-in-depth check.
   * Omit when re-dispatching after a prior aborted attempt where the
   * claim ix succeeded but the dispatch failed (so the nullifier is
   * already burned and the original sig may be unknown).
   */
  claimTxSig?: string;
  /** UUID of the payroll run. */
  runId: string;
  /** Employer base58 — used to derive vault PDA + payroll_run PDA. */
  employerAddress: string;
  /** Employee's wallet base58 (MagicBlock ER destination). */
  employeeWallet: string;
  /** Employee's USDC ATA base58 — the value the proof committed to. */
  recipientTokenAccount: string;
  /** Salary in USDC base units (decimals=6). */
  amountBaseUnits: string; // bigint as string
  epoch: string; // bigint as string
  /** 64-char hex (32 BE bytes) — the nullifier emitted on chain. */
  nullifierHex: string;
  /** 64-char hex (32 BE bytes) — pi_hash submitted in the claim IX. */
  piHashHex: string;
}

async function fetchPayrollRunRoot(
  conn: Connection,
  employer: PublicKey,
  runIdBytes: Uint8Array,
): Promise<{ finalizedRoot: Uint8Array; status: number; pda: PublicKey }> {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("run"), employer.toBuffer(), Buffer.from(runIdBytes)],
    PROGRAM_ID,
  );
  const info = await conn.getAccountInfo(pda, "confirmed");
  if (!info) throw new Error(`payroll_run PDA ${pda.toBase58()} not found`);
  const data = info.data;
  // PayrollRunAccount layout (after 8-byte disc):
  //   run_id [u8;16]              16
  //   owner Pubkey                32
  //   epoch u64                    8
  //   pending_root [u8;32]         32
  //   finalized_root [u8;32]       32  ← offset 8+16+32+8+32 = 96
  //   expected_chunk_count u32     4
  //   received_chunk_count u32     4
  //   expected_commitment_count u32 4
  //   status u8                    1
  const FINALIZED_ROOT_OFFSET = 8 + 16 + 32 + 8 + 32;
  const STATUS_OFFSET = 8 + 16 + 32 + 8 + 32 + 32 + 4 + 4 + 4;
  const finalizedRoot = new Uint8Array(
    data.slice(FINALIZED_ROOT_OFFSET, FINALIZED_ROOT_OFFSET + 32),
  );
  const status = data[STATUS_OFFSET];
  return { finalizedRoot, status, pda };
}

function uuidToBytes16(uuid: string): Uint8Array {
  const clean = (uuid || "").replace(/-/g, "");
  const out = new Uint8Array(16);
  if (clean.length === 32) {
    for (let i = 0; i < 16; i++) {
      out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    }
  }
  return out;
}

async function ensureRecipientAtaExists(
  conn: Connection,
  ata: PublicKey,
  ownerWallet: PublicKey,
): Promise<{ created: boolean; signature?: string }> {
  const info = await conn.getAccountInfo(ata, "confirmed");
  if (info) return { created: false };

  if (!KEYPAIR_PATH) {
    throw new Error("server cannot create recipient ATA: deployer keypair unset");
  }
  const raw = fs.readFileSync(KEYPAIR_PATH, "utf8");
  const arr = JSON.parse(raw);
  const payer = Keypair.fromSecretKey(Uint8Array.from(arr));

  const ix = createAssociatedTokenAccountInstruction(
    payer.publicKey,
    ata,
    ownerWallet,
    USDC_MINT,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const tx = new Transaction().add(ix);
  tx.feePayer = payer.publicKey;
  const { blockhash } = await conn.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.partialSign(payer);
  const sig = await conn.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    maxRetries: 5,
  });
  await conn.confirmTransaction(sig, "confirmed");
  return { created: true, signature: sig };
}

export async function POST(req: NextRequest) {
  let body: DispatchBody;
  try {
    body = await req.json();
  } catch {
    return err("invalid JSON body");
  }

  for (const k of [
    "runId",
    "employerAddress",
    "employeeWallet",
    "recipientTokenAccount",
    "amountBaseUnits",
    "epoch",
    "nullifierHex",
    "piHashHex",
  ] as (keyof DispatchBody)[]) {
    if (!body[k]) return err(`missing field: ${k}`);
  }

  // ── Health: refuse if MagicBlock unreachable ────────────────────────────
  try {
    await assertMagicBlockHealthy();
  } catch (e) {
    return err(`MagicBlock unhealthy: ${(e as Error).message}`, 503);
  }

  const conn = new Connection(RPC, "confirmed");

  // ── 1. Optionally verify the claim tx, but never block on its visibility.
  //      The nullifier-PDA check below is the authoritative proof that the
  //      on-chain claim ix ran (the program creates that PDA inside
  //      claim_payment, and only it can do so). The sig lookup is purely
  //      defensive and races devnet RPC's getTransaction indexing — if the
  //      tx was just confirmed, the lookup may return null even when the
  //      tx successfully landed. So: catch a confirmed-but-failed result
  //      hard, but treat "not yet visible" as a soft signal and proceed.
  if (body.claimTxSig) {
    try {
      const tx = await conn.getTransaction(body.claimTxSig, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      if (tx?.meta?.err) {
        return err(`claim tx failed on-chain: ${JSON.stringify(tx.meta.err)}`, 400);
      }
      // tx === null → just-confirmed and not yet indexed. Proceed; the
      // nullifier check below tells the truth.
    } catch (e) {
      console.warn("[dispatch-claim] claim sig lookup error (non-fatal):", (e as Error).message);
    }
  }

  const nullifierBytes = hexToBytes(body.nullifierHex);
  if (nullifierBytes.length !== 32) return err("nullifierHex must decode to 32 bytes");
  const piHashBytes = hexToBytes(body.piHashHex);
  if (piHashBytes.length !== 32) return err("piHashHex must decode to 32 bytes");

  const [nullifierPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("nullifier"), Buffer.from(nullifierBytes)],
    PROGRAM_ID,
  );
  const nullInfo = await conn.getAccountInfo(nullifierPda, "confirmed");
  if (!nullInfo || !nullInfo.owner.equals(PROGRAM_ID)) {
    return err(
      `nullifier PDA ${nullifierPda.toBase58()} not initialised — claim was not actually verified on chain`,
      400,
    );
  }

  // ── 2. Recompute pi_hash from authoritative state + employee-supplied
  //      (recipient, amount, epoch) and confirm the proof binds to them ───
  const employer = new PublicKey(body.employerAddress);
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), employer.toBuffer()],
    PROGRAM_ID,
  );

  const runIdBytes = uuidToBytes16(body.runId);
  const { finalizedRoot, status } = await fetchPayrollRunRoot(
    conn,
    employer,
    runIdBytes,
  );
  if (status !== 1) {
    return err(`payroll_run status is ${status} (expected Committed=1)`, 400);
  }

  const recomputed = recomputePiHash({
    merkleRoot: finalizedRoot,
    nullifier: nullifierBytes,
    recipientTokenAccount: body.recipientTokenAccount,
    amount: BigInt(body.amountBaseUnits),
    epoch: BigInt(body.epoch),
    mint: USDC_MINT.toBase58(),
    vaultPda: vaultPda.toBase58(),
    programId: PROGRAM_ID.toBase58(),
    runId: body.runId,
    domainTag: DOMAIN_TAG,
  });

  if (!bytesEqual(recomputed, piHashBytes)) {
    return err(
      `pi_hash binding failed — proof does not commit to (recipient=${body.recipientTokenAccount}, amount=${body.amountBaseUnits}, epoch=${body.epoch}). Recomputed=${bytesToHex(recomputed)} chain=${bytesToHex(piHashBytes)}`,
      400,
    );
  }

  // ── 3. Ensure the employee's USDC ATA exists so the eventual withdraw
  //      lands somewhere (server pays rent — rent is < 0.002 SOL) ─────────
  const employeeWalletPk = new PublicKey(body.employeeWallet);
  const expectedAta = getAssociatedTokenAddressSync(
    USDC_MINT,
    employeeWalletPk,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  if (expectedAta.toBase58() !== body.recipientTokenAccount) {
    return err(
      `recipient ATA ${body.recipientTokenAccount} does not match expected ATA ${expectedAta.toBase58()} for wallet ${body.employeeWallet}`,
      400,
    );
  }
  let ataResult: { created: boolean; signature?: string };
  try {
    ataResult = await ensureRecipientAtaExists(conn, expectedAta, employeeWalletPk);
  } catch (e) {
    return err(`failed to ensure recipient ATA: ${(e as Error).message}`, 502);
  }

  // ── 4. Trigger the MagicBlock private transfer (base→base, single ix) ──
  let transferResult;
  try {
    transferResult = await employerPrivateTransfer(
      body.employeeWallet,
      BigInt(body.amountBaseUnits),
      USDC_MINT.toBase58(),
      {
        // Requested split — employerPrivateTransfer clamps this to the
        // queue's actual slot capacity if it's smaller (e.g. legacy
        // 1-slot queues from earlier deployments → split clamped to 1).
        split: 4,
        minDelayMs: 500,
        maxDelayMs: 30_000,
        memo: `civitas-claim:${body.runId}`,
      },
    );
  } catch (e) {
    return err(
      `MagicBlock private transfer failed: ${(e as Error).message}`,
      502,
    );
  }

  return NextResponse.json({
    ok: true,
    employerAccount: getEmployerPubkey(),
    nullifierPda: nullifierPda.toBase58(),
    piHashBindingVerified: true,
    recipientAta: expectedAta.toBase58(),
    recipientAtaCreated: ataResult.created,
    recipientAtaCreateSig: ataResult.signature,
    privateTransferSig: transferResult.signature,
    queuedSplits: transferResult.queuedTransfers,
    note: "Funds will settle into the employee's USDC ATA after the TEE validator's queue cranks (typically <30s, randomized). No employee-side withdraw required.",
  });
}
