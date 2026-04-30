/**
 * lib/server/magicblock-auth.ts
 *
 * Server-side MagicBlock auth + tx submission for the employer/dispatcher.
 *
 * The dispatcher pre-funds a MagicBlock ER from the deployer keypair (which
 * acts as the employer treasury for the demo), then drains it via private
 * transfers each time a claim is dispatched. All signing is local — we
 * never expose the keypair to the browser.
 */

import fs from "node:fs";
import {
  Keypair,
  VersionedTransaction,
  Connection,
  Commitment,
  Transaction,
} from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58 from "bs58";
import {
  getAuthChallenge,
  loginWithSignature,
  buildDepositTx,
  buildPrivateTransferTx,
  buildWithdrawTx,
  type PrivateTransferOptions,
} from "./magicblock-private-payments";

const KEYPAIR_PATH = process.env.CIVITAS_DEPLOYER_KEYPAIR_PATH || "";
const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";

let cachedKeypair: Keypair | null = null;
function loadEmployerKeypair(): Keypair {
  if (cachedKeypair) return cachedKeypair;
  if (!KEYPAIR_PATH) {
    throw new Error("CIVITAS_DEPLOYER_KEYPAIR_PATH not configured");
  }
  const raw = fs.readFileSync(KEYPAIR_PATH, "utf8");
  const arr = JSON.parse(raw);
  cachedKeypair = Keypair.fromSecretKey(Uint8Array.from(arr));
  return cachedKeypair;
}

export function getEmployerPubkey(): string {
  return loadEmployerKeypair().publicKey.toBase58();
}

// ── Bearer token cache (keyed by employer pubkey) ─────────────────────────

interface CachedToken {
  token: string;
  /** ms epoch when we should refresh — refresh ~5 min before any plausible expiry. */
  refreshAt: number;
}

const tokenCache = new Map<string, CachedToken>();

/**
 * Get a Bearer token for the employer keypair. Signs the MagicBlock
 * challenge locally with tweetnacl — no browser involvement.
 *
 * Re-uses tokens for 25 min (MagicBlock tokens are typically ~1h; 25 min
 * gives generous headroom).
 *
 * Retries with exponential backoff on 5xx — the upstream challenge
 * service is occasionally degraded (HTTP 502 "No challenge received")
 * even when deposit + balance endpoints work. Total wait ≤ ~12s before
 * giving up; downstream callers surface the failure to the user.
 */
export async function getEmployerAuthToken(cluster = "devnet"): Promise<string> {
  const keypair = loadEmployerKeypair();
  const pubkey = keypair.publicKey.toBase58();
  const cacheKey = `${cluster}:${pubkey}`;

  const cached = tokenCache.get(cacheKey);
  if (cached && Date.now() < cached.refreshAt) {
    return cached.token;
  }

  const delays = [0, 500, 1000, 2500, 5000]; // ~9s total
  let lastErr: unknown;
  for (let i = 0; i < delays.length; i++) {
    if (delays[i] > 0) await new Promise((r) => setTimeout(r, delays[i]));
    try {
      const challenge = await getAuthChallenge(pubkey, cluster);
      const challengeBytes = new TextEncoder().encode(challenge);
      const sig = nacl.sign.detached(challengeBytes, keypair.secretKey);
      const sigB58 = bs58.encode(sig);
      const token = await loginWithSignature(pubkey, challenge, sigB58, cluster);
      tokenCache.set(cacheKey, {
        token,
        refreshAt: Date.now() + 25 * 60 * 1000,
      });
      return token;
    } catch (e) {
      lastErr = e;
      const msg = (e as Error).message || "";
      // Retry only on transient infra errors (5xx upstream).
      if (!/5\d\d|RPC_ERROR|No challenge received|challenge fetch failed/i.test(msg)) {
        throw e;
      }
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error("MagicBlock auth failed after retries");
}

// ── Tx submission helpers ─────────────────────────────────────────────────

const ROUTER_URL =
  process.env.NEXT_PUBLIC_MAGICBLOCK_ROUTER ?? "https://devnet-router.magicblock.app";

/** Pick the correct RPC for a MagicBlock unsigned tx response. */
function rpcFor(sendTo: "base" | "ephemeral"): Connection {
  return sendTo === "ephemeral"
    ? new Connection(ROUTER_URL, "confirmed")
    : new Connection(RPC, "confirmed");
}

/**
 * Decode → sign → submit a base64 unsigned tx returned by a MagicBlock
 * builder endpoint. Handles both legacy and versioned tx formats.
 */
async function signAndSubmit(
  base64: string,
  sendTo: "base" | "ephemeral",
  commitment: Commitment = "confirmed",
): Promise<string> {
  const keypair = loadEmployerKeypair();
  const txBytes = Buffer.from(base64, "base64");

  // Try versioned first; fall back to legacy.
  let signature: string;
  const conn = rpcFor(sendTo);
  try {
    const vtx = VersionedTransaction.deserialize(txBytes);
    vtx.sign([keypair]);
    signature = await conn.sendRawTransaction(vtx.serialize(), {
      skipPreflight: false,
      maxRetries: 5,
    });
  } catch {
    const legacy = Transaction.from(txBytes);
    legacy.partialSign(keypair);
    signature = await conn.sendRawTransaction(legacy.serialize(), {
      skipPreflight: false,
      maxRetries: 5,
    });
  }

  await conn.confirmTransaction(signature, commitment);
  return signature;
}

// ── High-level operations ─────────────────────────────────────────────────

export async function employerDeposit(
  amountUsdc: bigint,
  mint?: string,
  cluster = "devnet",
): Promise<{ signature: string; sendTo: string }> {
  const owner = getEmployerPubkey();
  const tx = await buildDepositTx(owner, amountUsdc, mint, cluster);
  const sig = await signAndSubmit(tx.transactionBase64, tx.sendTo);
  return { signature: sig, sendTo: tx.sendTo };
}

export async function employerWithdraw(
  amountUsdc: bigint,
  mint: string,
  cluster = "devnet",
): Promise<{ signature: string; sendTo: string }> {
  const owner = getEmployerPubkey();
  const tx = await buildWithdrawTx(owner, amountUsdc, mint, cluster);
  const sig = await signAndSubmit(tx.transactionBase64, tx.sendTo);
  return { signature: sig, sendTo: tx.sendTo };
}

/**
 * Private transfer: employer-ER → employee-ER, signed by the employer
 * keypair. Visibility=private, split, randomized timing — observers can't
 * link this to any specific on-chain claim.
 */
export async function employerPrivateTransfer(
  toPubkey: string,
  amountUsdc: bigint,
  mint?: string,
  options: PrivateTransferOptions = {},
  cluster = "devnet",
): Promise<{ signature: string; sendTo: string; queuedTransfers: number }> {
  const fromPubkey = getEmployerPubkey();
  const token = await getEmployerAuthToken(cluster);
  const tx = await buildPrivateTransferTx(
    fromPubkey,
    toPubkey,
    amountUsdc,
    token,
    mint,
    { split: 5, minDelayMs: 500, maxDelayMs: 30_000, ...options, cluster },
  );
  const sig = await signAndSubmit(tx.transactionBase64, tx.sendTo);
  return {
    signature: sig,
    sendTo: tx.sendTo,
    queuedTransfers: options.split ?? 5,
  };
}
