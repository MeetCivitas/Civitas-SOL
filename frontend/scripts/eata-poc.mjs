#!/usr/bin/env node
/**
 * eata-poc.mjs — verify the MagicBlock Private Payments REST API path.
 *
 * The canonical flow (matching mirage CLI's `transfer` command):
 *   1. POST /v1/spl/transfer to https://payments.magicblock.app
 *      — server picks the right validator for the cluster, queues encrypted
 *        recipient + split/delay policy, and returns a base64 unsigned tx.
 *   2. Local: deserialize, sign with employer keypair, submit to devnet RPC.
 *   3. The TEE-side crank decrypts the queued item and settles to the
 *      recipient on base over the requested delay/split window.
 *
 * No manual queue init, allocation, or delegation — the API handles all
 * of that server-side. No TEE auth token needed.
 */

import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";

const RPC_BASE = "https://api.devnet.solana.com";
const PAYMENTS_API = "https://payments.magicblock.app";
const MINT = new PublicKey("5y6RpteZg3vbUzzwxPRtAQY1Br6tatvfXANQZP7Sg5FJ");
const DISBURSE_AMOUNT = 1_000_000n;
const POLL_TIMEOUT_MS = 180_000;
const POLL_INTERVAL_MS = 3_000;

const employer = Keypair.fromSecretKey(
  Uint8Array.from(
    JSON.parse(readFileSync(`${homedir()}/.config/solana/id.json`, "utf-8")),
  ),
);

const EMP_FILE = new URL("./eata-poc-employee.json", import.meta.url).pathname;
let employee;
if (existsSync(EMP_FILE)) {
  employee = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(EMP_FILE, "utf-8"))),
  );
} else {
  employee = Keypair.generate();
  writeFileSync(EMP_FILE, JSON.stringify(Array.from(employee.secretKey)));
}

console.log("employer:", employer.publicKey.toBase58());
console.log("employee:", employee.publicKey.toBase58());

const base = new Connection(RPC_BASE, "confirmed");

async function ataBal(pk) {
  try {
    return (await base.getTokenAccountBalance(pk)).value.amount;
  } catch {
    return "—";
  }
}

async function showState(label) {
  const employerAta = getAssociatedTokenAddressSync(MINT, employer.publicKey);
  const employeeAta = getAssociatedTokenAddressSync(MINT, employee.publicKey);
  console.log(`\n=== ${label} ===`);
  console.log("  employer ATA:", await ataBal(employerAta));
  console.log("  employee ATA:", await ataBal(employeeAta));
}

async function postTransfer(body) {
  const r = await fetch(`${PAYMENTS_API}/v1/spl/transfer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`API non-JSON response (${r.status}): ${text.slice(0, 200)}`);
  }
  if (!r.ok || json.error) {
    throw new Error(`API error ${r.status}: ${JSON.stringify(json.error ?? json)}`);
  }
  return json;
}

async function signAndSendV0(unsignedB64, signers) {
  // The API returns a VersionedTransaction (v0). Deserialize, sign, submit.
  const buf = Buffer.from(unsignedB64, "base64");
  const vtx = VersionedTransaction.deserialize(buf);
  vtx.sign(signers);
  const sig = await base.sendRawTransaction(vtx.serialize(), {
    skipPreflight: false,
  });
  await base.confirmTransaction(sig, "confirmed");
  return sig;
}

(async () => {
  // ── Fund employee SOL ────────────────────────────────────────────────────
  const empSol = await base.getBalance(employee.publicKey);
  if (empSol < 0.005 * 1e9) {
    console.log("funding employee with 0.02 SOL…");
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: employer.publicKey,
        toPubkey: employee.publicKey,
        lamports: Math.floor(0.02 * 1e9),
      }),
    );
    const sig = await sendAndConfirmTransaction(base, tx, [employer]);
    console.log("  fund sig:", sig);
  }

  await showState("PRE");

  // ── Ensure employee ATA exists on base (crank settles into it) ──────────
  const employeeAtaPk = getAssociatedTokenAddressSync(MINT, employee.publicKey);
  const empAtaInfo = await base.getAccountInfo(employeeAtaPk);
  if (!empAtaInfo) {
    console.log("creating employee ATA on base…");
    const tx = new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(
        employer.publicKey,
        employeeAtaPk,
        employee.publicKey,
        MINT,
      ),
    );
    const sig = await sendAndConfirmTransaction(base, tx, [employer]);
    console.log("  create-ATA sig:", sig);
  }

  // ── One-time mint initialization (creates queue + rent PDA) ──────────────
  // This is the missing setup step. Per (mint, validator), this only needs
  // to happen once. Idempotent if already initialized.
  console.log("\n--- checking mint initialization ---");
  const checkR = await fetch(
    `${PAYMENTS_API}/v1/spl/is-mint-initialized?mint=${MINT.toBase58()}&cluster=devnet`,
  );
  const checkJson = await checkR.json();
  console.log("  is-mint-initialized:", JSON.stringify(checkJson));

  if (!checkJson.initialized) {
    console.log("  -> initializing mint for private payments…");
    const initR = await fetch(`${PAYMENTS_API}/v1/spl/initialize-mint`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        payer: employer.publicKey.toBase58(),
        mint: MINT.toBase58(),
        cluster: "devnet",
      }),
    });
    const initJson = await initR.json();
    if (!initR.ok || initJson.error) {
      throw new Error(`initialize-mint failed: ${JSON.stringify(initJson)}`);
    }
    console.log("  initialize-mint response:");
    console.log("    validator:    ", initJson.validator);
    console.log("    transferQueue:", initJson.transferQueue);
    console.log("    rentPda:      ", initJson.rentPda);
    console.log("    ix count:     ", initJson.instructionCount);
    const initSig = await signAndSendV0(initJson.transactionBase64, [employer]);
    console.log("  init-mint sig:", initSig);
  }

  // ── Build init transaction(s) if anything is missing ─────────────────────
  // The API errors if too many ixs end up in one tx, so first call with
  // init flags ON and amount=1 (small) — the API will tell us if there's
  // anything to init. If the only response is the actual transfer, we
  // proceed directly.
  console.log("\n--- preparing transfer via REST API ---");

  // Call 1: with init flags on, to handle any one-time setup.
  let unsigned;
  try {
    const resp = await postTransfer({
      from: employer.publicKey.toBase58(),
      to: employee.publicKey.toBase58(),
      cluster: "devnet",
      mint: MINT.toBase58(),
      amount: Number(DISBURSE_AMOUNT),
      visibility: "private",
      fromBalance: "base",
      toBalance: "base",
      initAtasIfMissing: true,
      initVaultIfMissing: true,
      initIfMissing: true,
      minDelayMs: "500",
      maxDelayMs: "4000",
    });
    unsigned = resp;
  } catch (e) {
    console.log("  init-on attempt failed:", e.message);
    console.log("  retrying with init flags off…");
    unsigned = await postTransfer({
      from: employer.publicKey.toBase58(),
      to: employee.publicKey.toBase58(),
      cluster: "devnet",
      mint: MINT.toBase58(),
      amount: Number(DISBURSE_AMOUNT),
      visibility: "private",
      fromBalance: "base",
      toBalance: "base",
      initAtasIfMissing: false,
      initVaultIfMissing: false,
      initIfMissing: false,
      minDelayMs: "500",
      maxDelayMs: "4000",
    });
  }

  console.log("  API resolved validator:", unsigned.validator);
  console.log("  ix count:", unsigned.instructionCount);
  console.log("  required signers:", unsigned.requiredSigners);
  console.log("  send-to:", unsigned.sendTo);

  // ── Sign + submit ────────────────────────────────────────────────────────
  const sig = await signAndSendV0(unsigned.transactionBase64, [employer]);
  console.log("\n  disburse sig:", sig);

  const r = await base.getTransaction(sig, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  console.log("  tx err:", r?.meta?.err ?? "none");
  console.log("  tx logs (first 30):");
  for (const l of (r?.meta?.logMessages ?? []).slice(0, 30)) console.log("    ", l);

  // ── Poll for settlement ─────────────────────────────────────────────────
  const employeeAta = getAssociatedTokenAddressSync(MINT, employee.publicKey);
  const startBal = BigInt(await ataBal(employeeAta).then((s) => s === "—" ? "0" : s));
  console.log(`\n=== POLLING (start employee balance: ${startBal}) ===`);

  const start = Date.now();
  let lastBal = startBal;
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    const cur = BigInt(await ataBal(employeeAta).then((s) => s === "—" ? "0" : s));
    if (cur !== lastBal) {
      console.log(
        `  t+${Math.round((Date.now() - start) / 1000)}s: employee ATA = ${cur} (Δ +${cur - lastBal})`,
      );
      lastBal = cur;
    }
    if (cur - startBal >= DISBURSE_AMOUNT) {
      console.log("  fully settled ✓");
      break;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  await showState("POST");
  console.log("\n--- DONE ---");
})().catch((e) => {
  console.error("PoC failed:", e);
  if (e.logs) for (const l of e.logs) console.error("   ", l);
  process.exitCode = 1;
});
