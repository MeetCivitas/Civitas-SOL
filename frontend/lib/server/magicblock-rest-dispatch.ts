/**
 * lib/server/magicblock-rest-dispatch.ts
 *
 * Server-side MagicBlock Private Payments dispatcher — REST API path.
 *
 * This is a 1:1 port of the verified-working PoC at
 * `frontend/scripts/eata-poc.mjs`. It hits the official MagicBlock REST
 * gateway at `payments.magicblock.app/v1/spl/transfer` (the same endpoint
 * the mirage CLI uses), signs the returned unsigned tx with the deployer
 * keypair, and submits to devnet base. Settlement lands in the recipient's
 * wallet ATA within ~3-30s via the TEE-side crank.
 *
 * Why this exists separately from `magicblock-auth.ts`:
 *   - `magicblock-auth.ts` uses the SDK's `transferSpl({ fromBalance:
 *     "ephemeral", toBalance: "base" })` route which emits
 *     `depositAndQueueTransferIx`. That route requires the sender's eATA
 *     to be pre-funded inside the ER and silently no-ops when the queue
 *     is saturated (see the comments in that file). On devnet we've
 *     observed it accepting txs that never actually settle.
 *   - The REST API uses the shuttle path
 *     (`depositAndDelegateShuttleEphemeralAtaWithMergeAndPrivateTransfer`)
 *     which is the canonical Private Payments ix that the mirage CLI ships
 *     against. It works against an unfunded eATA — the shuttle is created
 *     fresh per tx — and the PoC verified it settles consistently.
 *
 * Auth model: the REST gateway doesn't require any TEE bearer token for
 * base→base private transfers (we verified this empirically). The
 * deployer keypair is the only signer.
 */

import {
  Connection,
  PublicKey,
  Transaction,
  VersionedTransaction,
  Keypair,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

import { getEmployerKeypair, getEmployerPubkey } from "./magicblock-auth";

// ─── Config ────────────────────────────────────────────────────────────────

const PAYMENTS_API =
  process.env.NEXT_PUBLIC_MAGICBLOCK_PAYMENTS_API ??
  "https://payments.magicblock.app";
const SOLANA_RPC =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const CLUSTER = "devnet";

// ─── Shared HTTP helpers ───────────────────────────────────────────────────

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${PAYMENTS_API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${path}: non-JSON response (${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok || parsed.error) {
    const detail = parsed.error?.message ?? parsed.error ?? `HTTP ${res.status}`;
    throw new Error(`${path}: ${detail}`);
  }
  return parsed as T;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${PAYMENTS_API}${path}`, {
    signal: AbortSignal.timeout(10_000),
  });
  const text = await res.text();
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${path}: non-JSON response (${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok || parsed.error) {
    throw new Error(`${path}: ${parsed.error?.message ?? `HTTP ${res.status}`}`);
  }
  return parsed as T;
}

// ─── Tx signing ────────────────────────────────────────────────────────────

interface UnsignedTxResp {
  kind: string;
  version: "legacy" | "v0";
  transactionBase64: string;
  recentBlockhash: string;
  lastValidBlockHeight: number;
  validator?: string;
}

async function signAndSendUnsigned(
  conn: Connection,
  payer: Keypair,
  unsignedB64: string,
  version: "legacy" | "v0",
): Promise<string> {
  const buf = Buffer.from(unsignedB64, "base64");
  if (version === "v0") {
    const vtx = VersionedTransaction.deserialize(buf);
    vtx.sign([payer]);
    const sig = await conn.sendRawTransaction(vtx.serialize(), {
      skipPreflight: false,
      maxRetries: 5,
    });
    await conn.confirmTransaction(sig, "confirmed");
    return sig;
  }
  // Legacy fallback (the REST API returns v0 by default).
  const tx = Transaction.from(buf);
  tx.partialSign(payer);
  const sig = await conn.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    maxRetries: 5,
  });
  await conn.confirmTransaction(sig, "confirmed");
  return sig;
}

// ─── One-time mint setup ───────────────────────────────────────────────────

/**
 * Ensure the (mint, validator) tuple has a transfer queue + rent PDA set
 * up on MagicBlock's side. The gateway returns an unsigned tx if it needs
 * to be initialised; we sign with the deployer and submit. Idempotent —
 * subsequent calls return `{mintAlreadyInitialized: true}` without a tx.
 */
export async function ensureMintInitialized(
  mintBase58: string,
): Promise<{ alreadyInitialized: boolean; signature?: string; validator: string }> {
  const probe = await getJson<{ initialized: boolean; validator?: string }>(
    `/v1/spl/is-mint-initialized?mint=${mintBase58}&cluster=${CLUSTER}`,
  );
  if (probe.initialized) {
    return { alreadyInitialized: true, validator: probe.validator ?? "" };
  }
  const employer = getEmployerKeypair();
  const resp = await postJson<UnsignedTxResp & { validator: string }>(
    `/v1/spl/initialize-mint`,
    { payer: employer.publicKey.toBase58(), mint: mintBase58, cluster: CLUSTER },
  );
  const conn = new Connection(SOLANA_RPC, "confirmed");
  const signature = await signAndSendUnsigned(
    conn,
    employer,
    resp.transactionBase64,
    resp.version,
  );
  return { alreadyInitialized: false, signature, validator: resp.validator };
}

// ─── Private transfer (the actual settlement path) ────────────────────────

export interface RestPrivateTransferOptions {
  split?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
  /**
   * Optional gateway-side correlation id. MUST be a non-negative bigint
   * string (the gateway rejects anything else). Pass undefined to omit it
   * — Civitas correlates settlements via the returned base-tx signature
   * and the off-chain NilDB voucher record, so this field is unused in
   * practice.
   */
  clientRefId?: string;
}

export interface RestPrivateTransferResult {
  signature: string;
  mintInitSig?: string;
  recipientAtaCreated?: boolean;
  recipientAtaCreateSig?: string;
  recipientAta: string;
  validator: string;
}

/**
 * Issue a MagicBlock private base→base transfer from the deployer keypair
 * to `recipient`. This is the canonical PoC-verified path.
 *
 * Side-effects, atomic to the caller:
 *   1. Mint initialised for private payments if needed (one-time).
 *   2. Recipient's ATA created on base if needed (rent paid by deployer).
 *   3. Encrypted-queue ix signed + submitted; tx finalised on base.
 *
 * Settlement (the crank decrypting + delivering to the recipient ATA in
 * fragments) is async — happens after this returns, within ~3-30s.
 */
export async function privateTransferViaRest(
  recipient: string,
  amountBaseUnits: bigint,
  mintBase58: string,
  options: RestPrivateTransferOptions = {},
): Promise<RestPrivateTransferResult> {
  if (amountBaseUnits <= 0n) {
    throw new Error("amountBaseUnits must be > 0");
  }
  const employer = getEmployerKeypair();
  const conn = new Connection(SOLANA_RPC, "confirmed");
  const mintPk = new PublicKey(mintBase58);
  const recipientPk = new PublicKey(recipient);

  // ── 1. One-time mint init ─────────────────────────────────────────────
  const mintInit = await ensureMintInitialized(mintBase58);

  // ── 2. Pre-create recipient ATA (the crank can't create it itself) ─────
  const recipientAta = getAssociatedTokenAddressSync(
    mintPk,
    recipientPk,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const ataInfo = await conn.getAccountInfo(recipientAta, "confirmed");
  let recipientAtaCreated = false;
  let recipientAtaCreateSig: string | undefined;
  if (!ataInfo) {
    const ix = createAssociatedTokenAccountIdempotentInstruction(
      employer.publicKey,
      recipientAta,
      recipientPk,
      mintPk,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    const tx = new Transaction().add(ix);
    tx.feePayer = employer.publicKey;
    tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
    tx.partialSign(employer);
    recipientAtaCreateSig = await conn.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      maxRetries: 5,
    });
    await conn.confirmTransaction(recipientAtaCreateSig, "confirmed");
    recipientAtaCreated = true;
  }

  // ── 3. Ask the gateway for the private-transfer tx ────────────────────
  //
  // Same payload the PoC verified working. `init*IfMissing: false` because
  // the gateway then returns ≤2 ixs (queue refill + deposit-and-delegate)
  // which fit comfortably under the 1232-byte tx limit. With init flags on
  // the response can exceed the limit (we observed 1308B "TRANSACTION_TOO_LARGE"
  // in the PoC); mint init was already done in step 1, ATAs in step 2.
  const split = Math.min(15, Math.max(1, options.split ?? 4));
  // The gateway validates clientRefId as a non-negative bigint string. Pass
  // it through only if the caller's value matches that shape; otherwise omit.
  const validClientRefId =
    typeof options.clientRefId === "string" && /^\d+$/.test(options.clientRefId)
      ? options.clientRefId
      : undefined;
  const transferBody: Record<string, unknown> = {
    from: employer.publicKey.toBase58(),
    to: recipientPk.toBase58(),
    cluster: CLUSTER,
    mint: mintBase58,
    amount: Number(amountBaseUnits), // gateway accepts an integer
    visibility: "private",
    fromBalance: "base",
    toBalance: "base",
    initAtasIfMissing: false,
    initVaultIfMissing: false,
    initIfMissing: false,
    minDelayMs: String(options.minDelayMs ?? 500),
    maxDelayMs: String(options.maxDelayMs ?? 4_000),
    split,
  };
  if (validClientRefId) transferBody.clientRefId = validClientRefId;
  const resp = await postJson<UnsignedTxResp & { validator: string }>(
    `/v1/spl/transfer`,
    transferBody,
  );

  // ── 4. Sign + submit ──────────────────────────────────────────────────
  const signature = await signAndSendUnsigned(
    conn,
    employer,
    resp.transactionBase64,
    resp.version,
  );

  return {
    signature,
    mintInitSig: mintInit.alreadyInitialized ? undefined : mintInit.signature,
    recipientAtaCreated,
    recipientAtaCreateSig,
    recipientAta: recipientAta.toBase58(),
    validator: resp.validator,
  };
}

export { getEmployerPubkey };
