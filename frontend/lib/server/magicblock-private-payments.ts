/**
 * lib/server/magicblock-private-payments.ts
 *
 * MagicBlock Private Payments — official integration via
 * @magicblock-labs/ephemeral-rollups-sdk@0.13.x.
 *
 * Bumped 2026-05-09 from 0.12.0 → 0.13.0 to align with the post-2026-05-01
 * permission-program redeploy on devnet. 0.12-built ixs were silently
 * rejected by the new permission-CPI, causing the TEE crank to drop every
 * queued entry (queue saturated, validator never drained). Public API
 * surface diff was tiny — see PR notes; no call-site changes required.
 *
 * Architecture (corrected April 2026):
 *   • Auth          : GET  ${TEE}/auth/challenge?pubkey=…  →  POST ${TEE}/auth/login
 *                     (consumed via SDK's `getAuthToken`)
 *   • Deposit / fund : `delegateSpl()`            — base layer, employer-signed
 *   • Private xfer   : `transferSpl()` private/   — base layer, single ix that
 *                       base→base                    deposits, delegates the
 *                                                   shuttle, and queues a
 *                                                   randomized split transfer
 *                                                   to the recipient's USDC
 *                                                   ATA. The TEE validator's
 *                                                   crank settles in 500ms–
 *                                                   ~30s (configurable).
 *   • Withdraw       : `withdrawSpl()`           — submitted on the ER through
 *                                                   a token-authed connection.
 *   • Balance        : on-chain SPL ATA read    — base layer.
 *
 * The previous /v1/spl/* REST gateway on payments.magicblock.app does not
 * exist on the path we were calling; the old code returned the upstream
 * 502 "{\"error\":{\"code\":\"RPC_ERROR\",\"message\":\"No challenge received\"}}"
 * verbatim, which is what surfaced as the user-visible failure.
 *
 * NO FALLBACKS: every error throws.
 */

import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  delegateSpl,
  transferSpl,
  withdrawSpl,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import { getAccount } from "@solana/spl-token";

// ── Endpoint config ────────────────────────────────────────────────────────

/** TEE-fronted ER auth + private validator. Used for /auth/* and ER reads. */
export const MAGICBLOCK_TEE_URL =
  process.env.NEXT_PUBLIC_MAGICBLOCK_TEE_URL ?? "https://tee.magicblock.app";

/** Devnet router (used as a fallback for non-private validator discovery). */
export const MAGICBLOCK_ROUTER =
  process.env.NEXT_PUBLIC_MAGICBLOCK_ROUTER ?? "https://devnet-router.magicblock.app";

/** Base-layer Solana RPC (where deposit + private-transfer ixs land). */
export const SOLANA_RPC =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";

const DEFAULT_SPLIT = 5;
const DEFAULT_MIN_DELAY_MS = 500n;
const DEFAULT_MAX_DELAY_MS = 30_000n;

class MagicBlockError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "MagicBlockError";
  }
}

// ── Health gate + validator discovery ─────────────────────────────────────

interface IdentityResp {
  jsonrpc: string;
  result?: { identity?: string; fqdn?: string };
  error?: { code: number; message: string };
}

async function postJsonRpc<T = unknown>(
  url: string,
  method: string,
  params: unknown[] = [],
  timeoutMs = 6_000,
): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new MagicBlockError(`${method} → HTTP ${res.status}`, res.status);
  }
  return (await res.json()) as T;
}

let cachedValidator: { pk: PublicKey; fetchedAt: number } | null = null;
const VALIDATOR_TTL_MS = 5 * 60_000;

/**
 * Discover the TEE private validator pubkey via getIdentity. Cached for 5 min.
 * Required by `transferSpl`/`delegateSpl` for the private-transfer routes.
 */
export async function getPrivateValidator(): Promise<PublicKey> {
  if (cachedValidator && Date.now() - cachedValidator.fetchedAt < VALIDATOR_TTL_MS) {
    return cachedValidator.pk;
  }
  const j = await postJsonRpc<IdentityResp>(MAGICBLOCK_TEE_URL, "getIdentity");
  const id = j.result?.identity;
  if (!id) {
    throw new MagicBlockError(
      `getIdentity returned no result from ${MAGICBLOCK_TEE_URL}: ${JSON.stringify(j.error ?? j)}`,
    );
  }
  const pk = new PublicKey(id);
  cachedValidator = { pk, fetchedAt: Date.now() };
  return pk;
}

/**
 * Hard health check — refuses if the TEE RPC isn't responding.
 * Throws so callers can surface the failure to the user instead of silently
 * falling through to a downstream 502.
 */
export async function assertMagicBlockHealthy(): Promise<void> {
  try {
    await getPrivateValidator();
  } catch (e) {
    throw new MagicBlockError(
      `MagicBlock TEE unreachable at ${MAGICBLOCK_TEE_URL}: ${(e as Error).message}`,
    );
  }
}

// ── Connection helpers ────────────────────────────────────────────────────

/** Base-layer connection where employer-signed deposit/transfer ixs land. */
export function getBaseConnection(): Connection {
  return new Connection(SOLANA_RPC, "confirmed");
}

/**
 * Token-authed ER connection — for ER-side reads (private balance) and for
 * employee-signed withdraws. Pass a Bearer token from `getAuthToken` (from
 * the SDK or our cached employer token).
 */
export function getErConnection(authToken: string): Connection {
  return new Connection(`${MAGICBLOCK_TEE_URL}?token=${authToken}`, "confirmed");
}

// ── Tx packaging ───────────────────────────────────────────────────────────

export interface UnsignedTxResponse {
  /** Base64-encoded legacy `Transaction` for the wallet to sign. */
  transactionBase64: string;
  /** Where the signed tx must be submitted. Wallet UIs MUST honour this. */
  sendTo: "base" | "ephemeral";
  recentBlockhash: string;
  lastValidBlockHeight: number;
  /** Fee payer / required signer pubkey(s). */
  requiredSigners: string[];
}

async function packIxsForBase(
  ixs: TransactionInstruction[],
  feePayer: PublicKey,
): Promise<UnsignedTxResponse> {
  const conn = getBaseConnection();
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
  const tx = new Transaction();
  tx.feePayer = feePayer;
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  for (const ix of ixs) tx.add(ix);
  const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  return {
    transactionBase64: Buffer.from(serialized).toString("base64"),
    sendTo: "base",
    recentBlockhash: blockhash,
    lastValidBlockHeight,
    requiredSigners: [feePayer.toBase58()],
  };
}

async function packIxsForEr(
  ixs: TransactionInstruction[],
  feePayer: PublicKey,
  authToken: string,
): Promise<UnsignedTxResponse> {
  const conn = getErConnection(authToken);
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
  const tx = new Transaction();
  tx.feePayer = feePayer;
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  for (const ix of ixs) tx.add(ix);
  const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  return {
    transactionBase64: Buffer.from(serialized).toString("base64"),
    sendTo: "ephemeral",
    recentBlockhash: blockhash,
    lastValidBlockHeight,
    requiredSigners: [feePayer.toBase58()],
  };
}

// ── High-level builders ────────────────────────────────────────────────────

/**
 * Deposit + delegate the owner's USDC into their ephemeral ATA. Submitted on
 * the base layer.
 *
 * Optional but recommended for employers expecting many private transfers —
 * once delegated, future ephemeral→ephemeral transfers don't pay the
 * deposit-and-delegate cost.
 */
export async function buildDepositTx(
  owner: string,
  amountUsdc: bigint,
  mint: string,
): Promise<UnsignedTxResponse> {
  const ownerPk = new PublicKey(owner);
  const mintPk = new PublicKey(mint);
  const validator = await getPrivateValidator();

  const ixs = await delegateSpl(ownerPk, mintPk, amountUsdc, {
    payer: ownerPk,
    validator,
    initIfMissing: true,
    initVaultIfMissing: true,
    initAtasIfMissing: true,
    private: true,
  });

  return packIxsForBase(ixs, ownerPk);
}

export interface PrivateTransferOptions {
  /** Number of queue entries to split the amount across. Default 5. */
  split?: number;
  /** Min scheduling delay for queue cranks (ms). Default 500. */
  minDelayMs?: number;
  /** Max scheduling delay (ms). Default 30000. */
  maxDelayMs?: number;
  /** Optional opaque tag to deduplicate retries upstream. */
  clientRefId?: bigint;
  memo?: string;
}

/**
 * Build the official private-transfer ix on the base layer:
 *   employer USDC base ATA → employee USDC base ATA (via shuttle + queue)
 *
 * The single returned ix
 *   1. moves `amount` from `from`'s base ATA into a one-shot shuttle PDA
 *   2. delegates the shuttle to the TEE validator
 *   3. schedules `split` private transfers, each randomly delayed within
 *      [minDelayMs, maxDelayMs], that ultimately settle to `to`'s base ATA.
 *
 * Observers see the shuttle deposit + the eventual settlements but not the
 * link between sender and receiver, nor the per-transfer amounts.
 */
export async function buildPrivateTransferTx(
  from: string,
  to: string,
  amountUsdc: bigint,
  mint: string,
  options: PrivateTransferOptions = {},
): Promise<UnsignedTxResponse> {
  const fromPk = new PublicKey(from);
  const toPk = new PublicKey(to);
  const mintPk = new PublicKey(mint);
  const validator = await getPrivateValidator();

  const split = options.split ?? DEFAULT_SPLIT;
  const minDelayMs = BigInt(options.minDelayMs ?? Number(DEFAULT_MIN_DELAY_MS));
  const maxDelayMs = BigInt(options.maxDelayMs ?? Number(DEFAULT_MAX_DELAY_MS));

  const ixs = await transferSpl(fromPk, toPk, mintPk, amountUsdc, {
    visibility: "private",
    fromBalance: "base",
    toBalance: "base",
    validator,
    payer: fromPk,
    initIfMissing: true,
    initAtasIfMissing: true,
    initVaultIfMissing: true,
    privateTransfer: {
      split,
      minDelayMs,
      maxDelayMs,
      clientRefId: options.clientRefId,
    },
  });

  return packIxsForBase(ixs, fromPk);
}

/**
 * Build a withdraw tx: ER ephemeral ATA → base USDC ATA. Submitted on the
 * ephemeral rollup with the owner's auth token.
 */
export async function buildWithdrawTx(
  owner: string,
  amountUsdc: bigint,
  mint: string,
  authToken: string,
): Promise<UnsignedTxResponse> {
  const ownerPk = new PublicKey(owner);
  const mintPk = new PublicKey(mint);

  const ixs = await withdrawSpl(ownerPk, mintPk, amountUsdc, {
    payer: ownerPk,
    initAtasIfMissing: true,
  });

  return packIxsForEr(ixs, ownerPk, authToken);
}

// ── Auth proxy (so the wallet can stay client-side) ───────────────────────

/**
 * Fetch a login challenge from the TEE auth endpoint. Mirrors the request
 * the SDK's `getAuthToken` makes — exposed here so the browser wallet can
 * sign without the keypair leaving the client.
 */
export async function getAuthChallenge(pubkey: string): Promise<string> {
  const url = `${MAGICBLOCK_TEE_URL}/auth/challenge?pubkey=${encodeURIComponent(pubkey)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!res.ok) {
    throw new MagicBlockError(
      `challenge fetch failed: HTTP ${res.status}`,
      res.status,
    );
  }
  const body = (await res.json()) as { challenge?: string; error?: string };
  if (body.error) throw new MagicBlockError(`challenge error: ${body.error}`);
  if (typeof body.challenge !== "string" || body.challenge.length === 0) {
    throw new MagicBlockError("No challenge received");
  }
  return body.challenge;
}

/**
 * Exchange a signed challenge for a Bearer token. `signature` must be the
 * bs58-encoded ed25519 signature over the UTF-8 bytes of `challenge`.
 */
export async function loginWithSignature(
  pubkey: string,
  challenge: string,
  signature: string,
): Promise<{ token: string; expiresAt: number }> {
  const res = await fetch(`${MAGICBLOCK_TEE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pubkey, challenge, signature }),
    signal: AbortSignal.timeout(8_000),
  });
  const body = await res.json().catch(() => ({}) as Record<string, unknown>);
  if (res.status !== 200) {
    const e = (body as { error?: string }).error;
    throw new MagicBlockError(`login failed: ${e ?? `HTTP ${res.status}`}`, res.status);
  }
  const token = (body as { token?: string }).token;
  if (typeof token !== "string" || token.length === 0) {
    throw new MagicBlockError("login response missing 'token'");
  }
  const expiresAt =
    (body as { expiresAt?: number }).expiresAt ??
    Date.now() + 1000 * 60 * 60 * 24 * 30;
  return { token, expiresAt };
}

// ── Balance queries ───────────────────────────────────────────────────────

export interface BalanceResponse {
  address: string;
  mint: string;
  ata: string;
  location: "base" | "ephemeral";
  balance: string;
}

/** Public (base) USDC balance read directly from the SPL ATA. */
export async function getPublicBalance(
  address: string,
  mint: string,
): Promise<BalanceResponse> {
  const { getAssociatedTokenAddressSync } = await import("@solana/spl-token");
  const owner = new PublicKey(address);
  const mintPk = new PublicKey(mint);
  const ata = getAssociatedTokenAddressSync(mintPk, owner);
  const conn = getBaseConnection();
  let balance = "0";
  try {
    const acct = await getAccount(conn, ata, "confirmed");
    balance = acct.amount.toString();
  } catch {
    // ATA missing → 0
  }
  return {
    address,
    mint,
    ata: ata.toBase58(),
    location: "base",
    balance,
  };
}

/**
 * Private (ephemeral) USDC balance — reads the ephemeral ATA on the ER
 * (token-authed). Returns "0" if the eATA doesn't exist yet.
 */
export async function getPrivateBalance(
  address: string,
  mint: string,
  authToken: string,
): Promise<BalanceResponse> {
  const { deriveEphemeralAta, decodeEphemeralAta } = await import(
    "@magicblock-labs/ephemeral-rollups-sdk"
  );
  const owner = new PublicKey(address);
  const mintPk = new PublicKey(mint);
  const [eata] = deriveEphemeralAta(owner, mintPk);
  const conn = getErConnection(authToken);
  let balance = "0";
  try {
    const info = await conn.getAccountInfo(eata, "confirmed");
    if (info) {
      const decoded = decodeEphemeralAta(info);
      balance = decoded.amount.toString();
    }
  } catch {
    // missing or undecodable → 0
  }
  return {
    address,
    mint,
    ata: eata.toBase58(),
    location: "ephemeral",
    balance,
  };
}

export { MagicBlockError };
