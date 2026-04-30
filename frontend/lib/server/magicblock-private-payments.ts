/**
 * lib/server/magicblock-private-payments.ts
 * MagicBlock Private Payments — production integration (no fallbacks).
 *
 * Base URL: https://payments.magicblock.app
 * API ref:  https://docs.magicblock.gg/pages/private-ephemeral-rollups-pers/api-reference/per/introduction
 *
 * Privacy model:
 *   Token-2022 ZK ElGamal / Confidential Transfers is DISABLED on Solana
 *   (April 2026 audit). MagicBlock Private Payments provides equivalent
 *   payment-amount privacy via Permissioned Ephemeral Rollup sessions.
 *
 *   Flow:
 *     1. Employer deposits USDC → MagicBlock ephemeral (during payroll commit)
 *     2. Private transfer: employer ephemeral → employee ephemeral
 *        visibility=private, split=5, randomized delay 500–30000ms
 *     3. Employee withdraws privately
 *
 *   On-chain observers see deposits + withdrawals, not the internal links.
 *
 * NO FALLBACKS: every error throws. Callers must surface the failure to the
 * user — there are no demo / silent paths.
 */

export const MAGICBLOCK_PAYMENTS_BASE =
  process.env.NEXT_PUBLIC_MAGICBLOCK_PAYMENTS_URL ?? "https://payments.magicblock.app";

export const MAGICBLOCK_ER_ROUTER =
  process.env.NEXT_PUBLIC_MAGICBLOCK_ROUTER ?? "https://devnet-router.magicblock.app";

const DEFAULT_CLUSTER = "devnet";

class MagicBlockError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "MagicBlockError";
  }
}

async function readBody(res: Response): Promise<string> {
  try { return (await res.text()).slice(0, 400); } catch { return "<no body>"; }
}

// ── Health gate ───────────────────────────────────────────────────────────

/**
 * Hard health check — throws if either MagicBlock endpoint is unreachable.
 * Call this from the server-side entry of any flow that depends on PER.
 */
export async function assertMagicBlockHealthy(): Promise<void> {
  const checks = [
    fetch(`${MAGICBLOCK_PAYMENTS_BASE}/health`, { signal: AbortSignal.timeout(4_000) })
      .then(async (r) => ({ url: MAGICBLOCK_PAYMENTS_BASE, ok: r.ok, body: r.ok ? null : await readBody(r) }))
      .catch((e) => ({ url: MAGICBLOCK_PAYMENTS_BASE, ok: false, body: e.message })),
    fetch(`${MAGICBLOCK_ER_ROUTER}`, { signal: AbortSignal.timeout(4_000) })
      .then((r) => ({ url: MAGICBLOCK_ER_ROUTER, ok: r.status < 500, body: null }))
      .catch((e) => ({ url: MAGICBLOCK_ER_ROUTER, ok: false, body: e.message })),
  ];
  const results = await Promise.all(checks);
  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    throw new MagicBlockError(
      `MagicBlock unreachable: ${failed.map((f) => `${f.url} (${f.body ?? "no response"})`).join("; ")}`,
    );
  }
}

// ── Auth ──────────────────────────────────────────────────────────────────

/**
 * GET /v1/spl/challenge?pubkey=...&cluster=...
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
    throw new MagicBlockError(
      `challenge fetch failed: ${await readBody(res)}`,
      res.status,
    );
  }

  const { challenge } = await res.json();
  if (!challenge || typeof challenge !== "string") {
    throw new MagicBlockError("challenge response missing 'challenge' field");
  }
  return challenge;
}

/**
 * POST /v1/spl/login — exchange a signed challenge for a Bearer token.
 * Signature must be the wallet's signMessage(challenge) output, base58-encoded.
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
    throw new MagicBlockError("signature verification failed; wallet must re-sign", 403);
  }
  if (!res.ok) {
    throw new MagicBlockError(`login failed: ${await readBody(res)}`, res.status);
  }

  const { token } = await res.json();
  if (!token || typeof token !== "string") {
    throw new MagicBlockError("login response missing 'token' field");
  }
  return token;
}

// ── Unsigned transaction builders ─────────────────────────────────────────
// Every builder returns an unsigned base64-encoded VersionedTransaction.
// The frontend wallet signs and submits.

export interface UnsignedTxResponse {
  transactionBase64: string;
  sendTo: "base" | "ephemeral";
  recentBlockhash: string;
  lastValidBlockHeight: number;
  requiredSigners: string[];
}

/**
 * POST /v1/spl/deposit — owner USDC base wallet → MagicBlock ER escrow.
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
    throw new MagicBlockError(`deposit build failed: ${await readBody(res)}`, res.status);
  }

  const data = await res.json();
  if (!data.transactionBase64) {
    throw new MagicBlockError("deposit response missing transactionBase64");
  }
  return {
    transactionBase64: data.transactionBase64,
    sendTo: data.sendTo ?? "base",
    recentBlockhash: data.recentBlockhash ?? "",
    lastValidBlockHeight: data.lastValidBlockHeight ?? 0,
    requiredSigners: data.requiredSigners ?? [owner],
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
 * POST /v1/spl/transfer — private employer ER → employee ER transfer.
 * Requires a Bearer auth token from loginWithSignature.
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

  if (!res.ok) {
    throw new MagicBlockError(`private transfer failed: ${await readBody(res)}`, res.status);
  }

  const data = await res.json();
  if (!data.transactionBase64) {
    throw new MagicBlockError("transfer response missing transactionBase64");
  }
  return {
    transactionBase64: data.transactionBase64,
    sendTo: data.sendTo ?? "ephemeral",
    recentBlockhash: data.recentBlockhash ?? "",
    lastValidBlockHeight: data.lastValidBlockHeight ?? 0,
    requiredSigners: data.requiredSigners ?? [from],
  };
}

/**
 * POST /v1/spl/withdraw — employee ER → employee base wallet.
 */
export async function buildWithdrawTx(
  owner: string,
  amountUsdc: bigint,
  mint: string,
  cluster = DEFAULT_CLUSTER,
): Promise<UnsignedTxResponse> {
  const res = await fetch(`${MAGICBLOCK_PAYMENTS_BASE}/v1/spl/withdraw`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      owner,
      mint,
      amount: Number(amountUsdc),
      cluster,
      initIfMissing: true,
      initAtasIfMissing: true,
      idempotent: false,
    }),
    signal: AbortSignal.timeout(12_000),
  });

  if (!res.ok) {
    throw new MagicBlockError(`withdraw build failed: ${await readBody(res)}`, res.status);
  }

  const data = await res.json();
  if (!data.transactionBase64) {
    throw new MagicBlockError("withdraw response missing transactionBase64");
  }
  return {
    transactionBase64: data.transactionBase64,
    sendTo: data.sendTo ?? "base",
    recentBlockhash: data.recentBlockhash ?? "",
    lastValidBlockHeight: data.lastValidBlockHeight ?? 0,
    requiredSigners: data.requiredSigners ?? [owner],
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

/** Public (base) USDC balance. No auth needed. */
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
  if (!res.ok) throw new MagicBlockError(`balance failed: ${await readBody(res)}`, res.status);
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
  if (!res.ok) {
    throw new MagicBlockError(`private-balance failed: ${await readBody(res)}`, res.status);
  }
  return res.json();
}

export { MagicBlockError };
