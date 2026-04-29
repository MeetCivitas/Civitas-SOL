/**
 * lib/server/magicblock-private-payments.ts
 * MagicBlock Private Payments — real API integration.
 *
 * Base URL: https://payments.magicblock.app
 * API ref:  https://docs.magicblock.gg/pages/private-ephemeral-rollups-pers/api-reference/per/introduction
 *
 * Privacy model:
 *   Token-2022 ZK ElGamal / Confidential Transfers is DISABLED on devnet and mainnet
 *   (Solana security audit, April 2026). MagicBlock Private Payments provides
 *   equivalent payment amount privacy via Permissioned Ephemeral Rollup sessions.
 *
 *   Flow:
 *     1. Employer deposits USDC → MagicBlock ephemeral (during payroll commit)
 *        POST /v1/spl/deposit → unsigned tx → employer wallet signs
 *     2. Private transfer: employer ephemeral → employee ephemeral
 *        POST /v1/spl/transfer  visibility=private, split, delays → unsigned tx
 *        (requires auth token from challenge-response flow)
 *     3. Employee withdraws privately
 *        POST /v1/spl/withdraw → unsigned tx → employee wallet signs
 *
 *   Amount privacy: split=5 distributes across multiple ephemeral queue entries;
 *   minDelayMs/maxDelayMs schedules execution at a random future time.
 *   On-chain observers see transfer occurred but cannot correlate amount or timing
 *   to the original payroll run.
 */

export const MAGICBLOCK_PAYMENTS_BASE =
  process.env.NEXT_PUBLIC_MAGICBLOCK_PAYMENTS_URL ?? "https://payments.magicblock.app";

export const MAGICBLOCK_ER_ROUTER =
  process.env.NEXT_PUBLIC_MAGICBLOCK_ROUTER ?? "https://devnet-router.magicblock.app";

const DEFAULT_CLUSTER = "devnet";

// ── Auth ──────────────────────────────────────────────────────────────────

/**
 * Step 1 of auth: get a challenge string for the wallet to sign.
 * GET /v1/spl/challenge?pubkey={pubkey}&cluster={cluster}
 */
export async function getAuthChallenge(
  pubkey: string,
  cluster = DEFAULT_CLUSTER,
): Promise<string> {
  const url = new URL(`${MAGICBLOCK_PAYMENTS_BASE}/v1/spl/challenge`);
  url.searchParams.set("pubkey", pubkey);
  url.searchParams.set("cluster", cluster);

  const res = await fetch(url.toString(), {
    method: "GET",
    signal: AbortSignal.timeout(8_000),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`MagicBlock challenge fetch failed (${res.status}): ${body.slice(0, 200)}`);
  }

  const { challenge } = await res.json();
  if (!challenge || typeof challenge !== "string") {
    throw new Error("MagicBlock challenge: unexpected response format");
  }
  return challenge;
}

/**
 * Step 2 of auth: exchange challenge + wallet signature for a Bearer token.
 * POST /v1/spl/login
 *
 * The signature is produced by: wallet.signMessage(Buffer.from(challenge))
 * and base58-encoded by the caller.
 */
export async function loginWithSignature(
  pubkey: string,
  challenge: string,
  signature: string,
  cluster = DEFAULT_CLUSTER,
): Promise<string> {
  const res = await fetch(`${MAGICBLOCK_PAYMENTS_BASE}/v1/spl/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pubkey, challenge, signature, cluster }),
    signal: AbortSignal.timeout(8_000),
  });

  if (res.status === 403) {
    throw new Error("MagicBlock auth: signature verification failed. Re-sign the challenge.");
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`MagicBlock login failed (${res.status}): ${body.slice(0, 200)}`);
  }

  const { token } = await res.json();
  if (!token || typeof token !== "string") {
    throw new Error("MagicBlock login: no token in response");
  }
  return token;
}

// ── Unsigned transaction builders ─────────────────────────────────────────
// All builders return unsigned VersionedTransactions (base64).
// The frontend/wallet is responsible for signing and submitting.

export interface UnsignedTxResponse {
  transactionBase64: string;
  sendTo: "base" | "ephemeral";
  recentBlockhash: string;
  lastValidBlockHeight: number;
  requiredSigners: string[];
  isDemo: boolean;
}

/**
 * Build a deposit transaction: move USDC from owner's base wallet → MagicBlock ER.
 * No auth required. Owner signs the returned transaction.
 * POST /v1/spl/deposit
 */
export async function buildDepositTx(
  owner: string,
  amountUsdc: bigint,
  mint?: string,
  cluster = DEFAULT_CLUSTER,
): Promise<UnsignedTxResponse> {
  const body: Record<string, unknown> = {
    owner,
    amount: Number(amountUsdc),
    cluster,
    initIfMissing: true,
    initVaultIfMissing: true,
    initAtasIfMissing: true,
    idempotent: false,
  };
  if (mint) body.mint = mint;

  const res = await fetch(`${MAGICBLOCK_PAYMENTS_BASE}/v1/spl/deposit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12_000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`MagicBlock deposit build failed (${res.status}): ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  return {
    transactionBase64: data.transactionBase64,
    sendTo: data.sendTo ?? "base",
    recentBlockhash: data.recentBlockhash ?? "",
    lastValidBlockHeight: data.lastValidBlockHeight ?? 0,
    requiredSigners: data.requiredSigners ?? [owner],
    isDemo: false,
  };
}

export interface PrivateTransferOptions {
  /** Number of ephemeral queue entries to split the amount across (1–15). Default 5. */
  split?: number;
  /** Minimum scheduling delay in ms (for timing privacy). Default 500ms. */
  minDelayMs?: number;
  /** Maximum scheduling delay in ms. Default 30000ms. */
  maxDelayMs?: number;
  cluster?: string;
  memo?: string;
}

/**
 * Build a PRIVATE transfer transaction: employer ephemeral → employee ephemeral.
 * Requires a valid Bearer auth token (from loginWithSignature).
 * Amount is split across multiple queue entries — not visible in a single L1 tx.
 * POST /v1/spl/transfer  visibility="private"
 */
export async function buildPrivateTransferTx(
  from: string,
  to: string,
  amountUsdc: bigint,
  authToken: string,
  mint?: string,
  options: PrivateTransferOptions = {},
): Promise<UnsignedTxResponse> {
  const {
    split = 5,
    minDelayMs = 500,
    maxDelayMs = 30_000,
    cluster = DEFAULT_CLUSTER,
    memo,
  } = options;

  const body: Record<string, unknown> = {
    from,
    to,
    amount: Number(amountUsdc),
    visibility: "private",
    fromBalance: "ephemeral",
    toBalance: "ephemeral",
    split,
    minDelayMs,
    maxDelayMs,
    cluster,
    initIfMissing: true,
    initAtasIfMissing: true,
    initVaultIfMissing: true,
    gasless: false,
  };
  if (mint) body.mint = mint;
  if (memo) body.memo = memo;

  const res = await fetch(`${MAGICBLOCK_PAYMENTS_BASE}/v1/spl/transfer`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${authToken}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12_000),
  });

  if (res.status === 400) {
    const err = await res.text();
    // Could be "unsupported route" (e.g. ephemeral→ephemeral not yet live on devnet)
    throw new Error(`MagicBlock private transfer rejected (400): ${err.slice(0, 200)}`);
  }
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`MagicBlock private transfer failed (${res.status}): ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  return {
    transactionBase64: data.transactionBase64,
    sendTo: data.sendTo ?? "ephemeral",
    recentBlockhash: data.recentBlockhash ?? "",
    lastValidBlockHeight: data.lastValidBlockHeight ?? 0,
    requiredSigners: data.requiredSigners ?? [from],
    isDemo: false,
  };
}

/**
 * Build a withdrawal transaction: employee ephemeral → employee base wallet.
 * No auth required. Owner signs the returned transaction.
 * POST /v1/spl/withdraw
 */
export async function buildWithdrawTx(
  owner: string,
  amountUsdc: bigint,
  mint?: string,
  cluster = DEFAULT_CLUSTER,
): Promise<UnsignedTxResponse> {
  if (!mint) throw new Error("buildWithdrawTx: mint is required");

  const body: Record<string, unknown> = {
    owner,
    mint,
    amount: Number(amountUsdc),
    cluster,
    initIfMissing: true,
    initAtasIfMissing: true,
    idempotent: false,
  };

  const res = await fetch(`${MAGICBLOCK_PAYMENTS_BASE}/v1/spl/withdraw`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12_000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`MagicBlock withdraw build failed (${res.status}): ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  return {
    transactionBase64: data.transactionBase64,
    sendTo: data.sendTo ?? "base",
    recentBlockhash: data.recentBlockhash ?? "",
    lastValidBlockHeight: data.lastValidBlockHeight ?? 0,
    requiredSigners: data.requiredSigners ?? [owner],
    isDemo: false,
  };
}

// ── Balance queries ───────────────────────────────────────────────────────

export interface BalanceResponse {
  address: string;
  mint: string;
  ata: string;
  location: "base" | "ephemeral";
  balance: string;
}

/** Public (base) USDC balance on MagicBlock ER. No auth needed. */
export async function getPublicBalance(
  address: string,
  mint: string,
  cluster = DEFAULT_CLUSTER,
): Promise<BalanceResponse> {
  const url = new URL(`${MAGICBLOCK_PAYMENTS_BASE}/v1/spl/balance`);
  url.searchParams.set("address", address);
  url.searchParams.set("mint", mint);
  url.searchParams.set("cluster", cluster);

  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(6_000) });
  if (!res.ok) throw new Error(`MagicBlock balance failed (${res.status})`);
  return res.json();
}

/** Private (ephemeral) USDC balance. Requires auth token. */
export async function getPrivateBalance(
  address: string,
  mint: string,
  authToken: string,
  cluster = DEFAULT_CLUSTER,
): Promise<BalanceResponse> {
  const url = new URL(`${MAGICBLOCK_PAYMENTS_BASE}/v1/spl/private-balance`);
  url.searchParams.set("address", address);
  url.searchParams.set("mint", mint);
  url.searchParams.set("cluster", cluster);

  const res = await fetch(url.toString(), {
    headers: { "Authorization": `Bearer ${authToken}` },
    signal: AbortSignal.timeout(6_000),
  });
  if (!res.ok) throw new Error(`MagicBlock private-balance failed (${res.status})`);
  return res.json();
}

// ── Health ────────────────────────────────────────────────────────────────

export async function checkPaymentsHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${MAGICBLOCK_PAYMENTS_BASE}/health`, {
      signal: AbortSignal.timeout(4_000),
    });
    const data = await res.json();
    return data?.status === "ok";
  } catch {
    return false;
  }
}

// ── Demo-mode fallbacks ───────────────────────────────────────────────────
// Used when the payments endpoint is unreachable (local dev, CI, offline demo).

const DEMO_TX_PREFIX = "CIVITAS_DEMO_TX_";

export function isDemoTx(tx: string): boolean {
  return tx.startsWith(DEMO_TX_PREFIX);
}

export function makeDemoDepositTx(owner: string, amount: bigint): UnsignedTxResponse {
  return {
    transactionBase64: `${DEMO_TX_PREFIX}DEPOSIT_${owner.slice(0, 8)}_${amount}`,
    sendTo: "base",
    recentBlockhash: "11111111111111111111111111111111",
    lastValidBlockHeight: 0,
    requiredSigners: [owner],
    isDemo: true,
  };
}

export function makeDemoTransferTx(from: string, to: string, amount: bigint): UnsignedTxResponse {
  return {
    transactionBase64: `${DEMO_TX_PREFIX}TRANSFER_${from.slice(0, 8)}_${to.slice(0, 8)}_${amount}`,
    sendTo: "ephemeral",
    recentBlockhash: "11111111111111111111111111111111",
    lastValidBlockHeight: 0,
    requiredSigners: [from],
    isDemo: true,
  };
}

export function makeDemoWithdrawTx(owner: string, amount: bigint): UnsignedTxResponse {
  return {
    transactionBase64: `${DEMO_TX_PREFIX}WITHDRAW_${owner.slice(0, 8)}_${amount}`,
    sendTo: "base",
    recentBlockhash: "11111111111111111111111111111111",
    lastValidBlockHeight: 0,
    requiredSigners: [owner],
    isDemo: true,
  };
}
