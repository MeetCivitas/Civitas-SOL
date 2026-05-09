/**
 * lib/server/magicblock-auth.ts
 *
 * Server-side MagicBlock auth + tx submission for the dispatcher (employer
 * keypair). Uses the official SDK auth flow against tee.magicblock.app:
 *
 *   1. GET  ${TEE}/auth/challenge?pubkey=…   — fetch challenge string
 *   2. ed25519-sign UTF-8 bytes locally with tweetnacl
 *   3. POST ${TEE}/auth/login                — exchange for Bearer token
 *
 * The dispatcher signs locally — never via the browser. Tokens are cached
 * for 25 minutes (the API issues 30-day tokens, but we refresh early).
 *
 * High-level operations:
 *   • employerDeposit              — `delegateSpl` on base layer
 *   • employerPrivateTransfer      — `transferSpl` private base→base
 *   • employeeWithdrawAsServer     — `withdrawSpl` on the ER (rare; the
 *                                     normal flow has the employee sign
 *                                     their own withdraw client-side)
 */

import fs from "node:fs";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  Commitment,
} from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58 from "bs58";
import {
  delegateSpl,
  transferSpl,
  withdrawSpl,
  deriveTransferQueue,
  initTransferQueueIx,
  DELEGATION_PROGRAM_ID,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import {
  MAGICBLOCK_TEE_URL,
  SOLANA_RPC,
  getAuthChallenge,
  loginWithSignature,
  getBaseConnection,
  getErConnection,
  getPrivateValidator,
  type PrivateTransferOptions,
} from "./magicblock-private-payments";

const KEYPAIR_PATH = process.env.CIVITAS_DEPLOYER_KEYPAIR_PATH || "";
const KEYPAIR_JSON = process.env.CIVITAS_DEPLOYER_KEYPAIR_JSON || "";

let cachedKeypair: Keypair | null = null;
function loadEmployerKeypair(): Keypair {
  if (cachedKeypair) return cachedKeypair;

  // Prefer inline JSON env var (works in any sandbox/serverless env).
  let arr: number[] | undefined;
  if (KEYPAIR_JSON) {
    try {
      arr = JSON.parse(KEYPAIR_JSON);
    } catch (e: any) {
      throw new Error(
        `CIVITAS_DEPLOYER_KEYPAIR_JSON is set but not valid JSON: ${e.message}`,
      );
    }
  } else if (KEYPAIR_PATH) {
    try {
      const raw = fs.readFileSync(KEYPAIR_PATH, "utf8");
      arr = JSON.parse(raw);
    } catch (e: any) {
      const code = e?.code ? ` (${e.code})` : "";
      throw new Error(
        `Failed to read deployer keypair at ${KEYPAIR_PATH}${code}: ${e.message}. ` +
          `If the file exists but the dev server can't see it (common on macOS when launched from an IDE-sandboxed terminal), ` +
          `paste the keypair array into CIVITAS_DEPLOYER_KEYPAIR_JSON in .env.local instead.`,
      );
    }
  } else {
    throw new Error(
      "Set CIVITAS_DEPLOYER_KEYPAIR_PATH (file path) or CIVITAS_DEPLOYER_KEYPAIR_JSON (inline array) in .env.local",
    );
  }

  if (!Array.isArray(arr)) {
    throw new Error("Deployer keypair did not parse to a number array");
  }
  cachedKeypair = Keypair.fromSecretKey(Uint8Array.from(arr));
  return cachedKeypair;
}

export function getEmployerPubkey(): string {
  return loadEmployerKeypair().publicKey.toBase58();
}

export function getEmployerKeypair(): Keypair {
  return loadEmployerKeypair();
}

// ── Queue health probe ────────────────────────────────────────────────────

/**
 * Best-effort decode of the per-(mint, validator) transfer queue PDA.
 *
 * The SDK doesn't expose a layout decoder for the queue, so we use the same
 * heuristic as /api/payroll/queue-state:
 *   • capacity = floor((data.length - 64) / 150)
 *     — header is ~64 B; each transfer slot is ~150 B
 *   • occupied = slots whose first 32 B contain any non-zero byte
 *   • latestWriteMs = max u64 LE in [2024-01-01, +5y] found anywhere in the
 *     buffer (proxy for "validator's last write timestamp")
 *
 * Returns null-ish when the queue doesn't exist yet (capacity = 0,
 * latestWriteAgeSec = null). employerPrivateTransfer treats that as a
 * fresh-init signal, not a refusal.
 */
function probeQueueHealth(data: Buffer | null): {
  capacity: number;
  occupied: number;
  bitmap: string;
  latestWriteMs: number | null;
  latestWriteAgeSec: number | null;
} {
  const APPROX_HEADER_BYTES = 64;
  const APPROX_BYTES_PER_SLOT = 150;

  if (!data || data.length <= APPROX_HEADER_BYTES) {
    return { capacity: 0, occupied: 0, bitmap: "", latestWriteMs: null, latestWriteAgeSec: null };
  }

  const slotRegion = data.subarray(APPROX_HEADER_BYTES);
  const capacity = Math.max(1, Math.floor(slotRegion.length / APPROX_BYTES_PER_SLOT));
  let occupied = 0;
  let bitmap = "";
  for (let i = 0; i < capacity; i++) {
    const start = i * APPROX_BYTES_PER_SLOT;
    const end = Math.min(start + 32, slotRegion.length);
    const slotHead = slotRegion.subarray(start, end);
    const isOccupied = slotHead.some((b) => b !== 0);
    if (isOccupied) occupied++;
    bitmap += isOccupied ? "█" : "·";
  }

  const FLOOR = new Date("2024-01-01").getTime();
  const CEIL = Date.now() + 5 * 365 * 86400 * 1000;
  let latestWriteMs: number | null = null;
  for (let i = 0; i + 8 <= data.length; i += 8) {
    let v = 0;
    for (let j = 7; j >= 0; j--) v = v * 256 + data[i + j];
    if (v >= FLOOR && v <= CEIL && (latestWriteMs === null || v > latestWriteMs)) {
      latestWriteMs = v;
    }
  }
  const latestWriteAgeSec =
    latestWriteMs !== null ? Math.round((Date.now() - latestWriteMs) / 1000) : null;

  return { capacity, occupied, bitmap, latestWriteMs, latestWriteAgeSec };
}

// ── Bearer token cache ────────────────────────────────────────────────────

interface CachedToken {
  token: string;
  /** ms epoch — refresh ~5 min before expiry. */
  refreshAt: number;
}

const tokenCache = new Map<string, CachedToken>();

/**
 * Get a Bearer token for the employer keypair. Signs the TEE challenge
 * locally with tweetnacl. Tokens are cached for 25 min.
 *
 * Retries 4× with exponential backoff on transient 5xx — the auth service
 * is occasionally degraded during devnet rollouts.
 */
export async function getEmployerAuthToken(): Promise<string> {
  const keypair = loadEmployerKeypair();
  const pubkey = keypair.publicKey.toBase58();
  const cacheKey = pubkey;

  const cached = tokenCache.get(cacheKey);
  if (cached && Date.now() < cached.refreshAt) {
    return cached.token;
  }

  const delays = [0, 500, 1000, 2500, 5000];
  let lastErr: unknown;
  for (let i = 0; i < delays.length; i++) {
    if (delays[i] > 0) await new Promise((r) => setTimeout(r, delays[i]));
    try {
      const challenge = await getAuthChallenge(pubkey);
      const challengeBytes = new TextEncoder().encode(challenge);
      const sig = nacl.sign.detached(challengeBytes, keypair.secretKey);
      const sigB58 = bs58.encode(sig);
      const { token, expiresAt } = await loginWithSignature(pubkey, challenge, sigB58);
      const refreshAt = Math.min(
        expiresAt - 5 * 60_000,
        Date.now() + 25 * 60_000,
      );
      tokenCache.set(cacheKey, { token, refreshAt });
      return token;
    } catch (e) {
      lastErr = e;
      const msg = (e as Error).message || "";
      if (!/5\d\d|RPC_ERROR|No challenge received|challenge fetch failed|fetch failed/i.test(msg)) {
        throw e;
      }
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error("MagicBlock auth failed after retries");
}

// ── Tx submission helpers ─────────────────────────────────────────────────

async function signAndSubmitOnBase(
  ixs: TransactionInstruction[],
  commitment: Commitment = "confirmed",
): Promise<string> {
  const keypair = loadEmployerKeypair();
  const conn = getBaseConnection();
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
  const tx = new Transaction();
  tx.feePayer = keypair.publicKey;
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  for (const ix of ixs) tx.add(ix);
  tx.partialSign(keypair);
  const sig = await conn.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    maxRetries: 5,
  });
  await conn.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    commitment,
  );
  return sig;
}

async function signAndSubmitOnEr(
  ixs: TransactionInstruction[],
  authToken: string,
): Promise<string> {
  const keypair = loadEmployerKeypair();
  const conn = getErConnection(authToken);
  const { blockhash } = await conn.getLatestBlockhash();
  const tx = new Transaction();
  tx.feePayer = keypair.publicKey;
  tx.recentBlockhash = blockhash;
  for (const ix of ixs) tx.add(ix);
  tx.partialSign(keypair);
  // ER expects skipPreflight=true so the ER itself does the validation.
  const sig = await conn.sendRawTransaction(tx.serialize(), {
    skipPreflight: true,
    maxRetries: 3,
  });
  await conn.confirmTransaction(sig, "confirmed");
  return sig;
}

// ── High-level operations ─────────────────────────────────────────────────

/**
 * Deposit + delegate the employer's USDC into their ephemeral ATA on the
 * TEE-backed ER. One-time setup that makes future ephemeral→ephemeral
 * transfers cheaper. Optional — base→base private transfers work without
 * pre-funding.
 */
export async function employerDeposit(
  amountUsdc: bigint,
  mint: string,
): Promise<{ signature: string }> {
  const keypair = loadEmployerKeypair();
  const mintPk = new PublicKey(mint);
  const validator = await getPrivateValidator();

  const ixs = await delegateSpl(keypair.publicKey, mintPk, amountUsdc, {
    payer: keypair.publicKey,
    validator,
    initIfMissing: true,
    initVaultIfMissing: true,
    initAtasIfMissing: true,
    private: true,
  });

  const signature = await signAndSubmitOnBase(ixs);
  return { signature };
}

/**
 * Private base→base transfer:
 *   employer USDC base ATA → employee USDC base ATA
 *
 * One self-contained ix on the base layer that:
 *   1. Pulls `amount` from the employer's base ATA into a one-shot shuttle.
 *   2. Delegates the shuttle to the TEE private validator.
 *   3. Schedules `split` queue transfers, each delayed randomly within
 *      [minDelayMs, maxDelayMs], settling at the employee's base ATA.
 *
 * Observers see the deposit + the eventual settlements, but not the link
 * from one to the other or the per-transfer amounts. Settlement typically
 * completes within `maxDelayMs` after the cranks fire.
 *
 * PREREQUISITE: `employerDeposit()` (i.e. /api/payroll/fund-magicblock)
 * must have been called once per mint to set up:
 *   • the global vault PDA + vault ATA + delegated vault ephemeral ATA
 *   • the employer's base USDC ATA
 *   • the employer's ephemeral ATA + permission record + delegation
 * Including those init ixs on every claim would make the tx exceed
 * Solana's 1232-byte limit. They're idempotent in concept but the
 * underlying `initVaultIx` / `initEphemeralAtaIx` are NOT — the program
 * errors if they're already initialised — so they must remain off here.
 * If a claim hits "Account does not exist", run the prefund button.
 */
export async function employerPrivateTransfer(
  toPubkey: string,
  amountUsdc: bigint,
  mint: string,
  options: PrivateTransferOptions = {},
): Promise<{ signature: string; queuedTransfers: number }> {
  const keypair = loadEmployerKeypair();
  const fromPk = keypair.publicKey;
  const toPk = new PublicKey(toPubkey);
  const mintPk = new PublicKey(mint);
  const validator = await getPrivateValidator();

  const minDelayMs = BigInt(options.minDelayMs ?? 500);
  const maxDelayMs = BigInt(options.maxDelayMs ?? 30_000);

  // Ensure the per-(mint, validator) transfer queue exists and is
  // SPL-owned (undelegated). depositAndQueueTransferIx requires that
  // ownership state — see ensureTransferQueueReady comment for the
  // ownership-vs-instruction-path matrix.
  await ensureTransferQueueReady(mintPk, validator, fromPk);

  // Probe the actual queue size + occupancy + freshness *before* the tx.
  //
  // Why pre-flight (vs. log-scan post-confirm): depositAndQueueTransferIx
  // is one tx but two effects — it deposits USDC into the employer's ER
  // vault AND inserts a transfer-intent into the queue PDA. If the queue
  // is full the program logs "Queue is full" and SILENTLY succeeds: the
  // deposit lands but no queue entry is created. Our post-confirm scan
  // (further down) catches this and throws, but the deposit already
  // happened — funds get stuck in the vault and require employerWithdraw
  // to recover. The fix is to refuse before the tx fires.
  //
  // Two refusal signals:
  //   • saturated: occupied >= capacity → no slot to write to anyway
  //   • stalled:   queue has occupied slots but no recent timestamp in
  //                its data, meaning the TEE crank hasn't drained it.
  //                Threshold is conservative (10 min) so the gate doesn't
  //                trip on healthy queues that just got a flurry of
  //                writes followed by a quiet patch.
  const conn = getBaseConnection();
  const [queuePda] = deriveTransferQueue(mintPk, validator);
  const queueInfo = await conn.getAccountInfo(queuePda, "confirmed");
  const queueBytes = queueInfo?.data.length ?? 0;
  const probe = probeQueueHealth(queueInfo?.data ?? null);

  if (probe.occupied >= probe.capacity && probe.capacity > 0) {
    throw new Error(
      `MagicBlock queue ${queuePda.toBase58()} is saturated ` +
        `(${probe.occupied}/${probe.capacity} slots, ${probe.bitmap}). ` +
        `Refusing to deposit because depositAndQueueTransferIx would land the ` +
        `deposit but silently drop the queue insert. ` +
        (probe.latestWriteAgeSec !== null
          ? `Last detectable write: ${Math.round(probe.latestWriteAgeSec / 60)}m ago. `
          : "") +
        `If the validator has cranked recently, retry; otherwise rotate the ` +
        `MagicBlock USDC mint (frontend/scripts/rotate-magicblock-mint.mjs) ` +
        `to spawn a fresh queue PDA.`,
    );
  }

  const MAX_STALL_SEC = 600;
  if (
    probe.occupied > 0 &&
    probe.latestWriteAgeSec !== null &&
    probe.latestWriteAgeSec > MAX_STALL_SEC
  ) {
    throw new Error(
      `MagicBlock queue ${queuePda.toBase58()} appears stalled — ` +
        `${probe.occupied}/${probe.capacity} occupied, last write ` +
        `${Math.round(probe.latestWriteAgeSec / 60)}m ago. The TEE validator ` +
        `(${validator.toBase58()}) hasn't drained pending entries within ` +
        `${MAX_STALL_SEC / 60}m. Refusing to deposit until the crank resumes ` +
        `or the mint is rotated. (See /api/payroll/queue-state for live state.)`,
    );
  }

  const requestedSplit = options.split ?? 4;
  const freeSlots = Math.max(1, probe.capacity - probe.occupied);
  const split = Math.min(requestedSplit, freeSlots);
  if (split !== requestedSplit) {
    console.log(
      `[employerPrivateTransfer] clamped split ${requestedSplit} → ${split} ` +
      `(queue ${queueBytes}B, ${probe.occupied}/${probe.capacity} occupied, ` +
      `${freeSlots} free)`,
    );
  }

  // Use the ephemeral→base private route. It emits `depositAndQueueTransferIx`
  // — a single, simple ix that pushes funds from the employer's base ATA
  // into the vault and queues a TEE-encrypted private transfer to the
  // recipient's base ATA. The SDK's base→base route uses a more complex
  // shuttle/delegation ix (`depositAndDelegateShuttleEphemeralAtaWithMerge…`)
  // that the devnet program rejects with InvalidInstructionData — likely
  // a program/SDK version skew. The ephemeral→base path is the supported
  // one for real-world dispatchers (the prefund step already created the
  // employer's delegated ephemeral ATA + vault, which this path requires).
  const ixs = await transferSpl(fromPk, toPk, mintPk, amountUsdc, {
    visibility: "private",
    fromBalance: "ephemeral",
    toBalance: "base",
    validator,
    payer: fromPk,
    initIfMissing: false,
    initAtasIfMissing: false,
    initVaultIfMissing: false,
    privateTransfer: {
      split,
      minDelayMs,
      maxDelayMs,
      clientRefId: options.clientRefId,
    },
  });

  const signature = await signAndSubmitOnBase(ixs);

  // Post-confirmation soft-failure check.
  //
  // `depositAndQueueTransfer` is a single atomic ix that (1) deposits USDC
  // into the employer's ER vault and (2) inserts a transfer-intent into
  // the per-(mint, validator) queue PDA. If step 2 finds no free slots,
  // the program logs "Queue is full" and RETURNS SUCCESS without inserting.
  // The deposit still happened, but the TEE validator has nothing to
  // crank — so the recipient's ATA will never receive the USDC.
  //
  // Treat this as a hard failure here so /api/payroll/dispatch-claim
  // bubbles a real error instead of letting the frontend mark the
  // voucher "Settled" for a transfer that will never arrive.
  try {
    const txInfo = await conn.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    const logs = txInfo?.meta?.logMessages ?? [];
    const queueFull = logs.some((l) => /Queue is full/i.test(l));
    if (queueFull) {
      throw new Error(
        `MagicBlock queue is full (sig ${signature}). ` +
          `The employer's transfer queue has no free slots — the TEE validator hasn't ` +
          `cranked existing entries. Your USDC was deposited into the employer's ER ` +
          `vault but NO SPL transfer was queued, so it will not arrive at your ATA. ` +
          `Have the employer wait for the validator to drain the queue, or contact ` +
          `MagicBlock if the crank service has stalled.`,
      );
    }
    // Optional secondary signal: some program versions log
    // "Slot 0/N full, falling through" — same outcome.
    const fallthrough = logs.some((l) => /falling through|no free slots|skipped queue/i.test(l));
    if (fallthrough) {
      throw new Error(
        `MagicBlock queue insert was skipped (sig ${signature}). Logs: ` +
          logs.filter((l) => /queue|slot|fall|skip/i.test(l)).join(" | ").slice(0, 200),
      );
    }
  } catch (err: any) {
    // Re-throw our own constructed errors; swallow only RPC fetch failures
    // (we'd rather assume success than spuriously fail on transient RPC).
    if (err?.message?.includes("queue") || err?.message?.includes("Queue")) throw err;
    console.warn(`[employerPrivateTransfer] post-confirm log probe failed (non-fatal): ${err?.message}`);
  }

  return { signature, queuedTransfers: split };
}

/**
 * Slots to request when initialising a fresh transfer queue.
 *
 * Two competing constraints:
 *   • Upper bound: `delegateTransferQueueIx` CPIs to the delegation program,
 *     which `realloc`s a `delegateBuffer` PDA up to `queue.data.length` to
 *     clone its contents. Solana caps `set_data_length()` increases at
 *     MAX_PERMITTED_DATA_INCREASE = 10 240 bytes per call — so the queue
 *     MUST end up ≤ ~10 KB at delegate time.
 *   • Lower bound: each private transfer with split=N needs ≥N free slots
 *     in the queue. If the queue is too small, the shuttle ix rejects the
 *     transfer as InvalidInstructionData.
 *
 * 8 slots × ~150 bytes/slot + headers ≈ 1.5 KB total — well under the
 * 10 KB realloc cap, and enough for split values up to 8.
 */
const QUEUE_REQUESTED_ITEMS = 8;

/**
 * One-time setup for the transfer queue used by private ephemeral→base
 * transfers (`depositAndQueueTransferIx`, discriminator 16).
 *
 * That ix has an explicit `require!(queue_info.owned_by(&crate::ID))` —
 * the queue MUST stay owned by the SPL Token Program (NOT delegated to
 * DELEGATION_PROGRAM_ID). Setup is therefore JUST init.
 *
 * Crank registration: the SDK has `ensureTransferQueueCrankIx` (discriminator
 * 17) which is supposed to wire the queue up to MagicBlock's task scheduler.
 * On the current devnet program version it returns "Unsupported program id"
 * — the entrypoint isn't exposed there. The TEE validator processes queues
 * autonomously on this devnet build (when its crank service is up); we
 * rely on that and don't call ensureCrank ourselves.
 *
 * If the queue is already delegated from a prior wrong-flow attempt, we
 * surface an actionable rotate-mint error — there's no SDK undelegate.
 */
async function ensureTransferQueueReady(
  mintPk: PublicKey,
  validator: PublicKey,
  payer: PublicKey,
): Promise<void> {
  const conn = getBaseConnection();
  const [queue] = deriveTransferQueue(mintPk, validator);

  const info = await conn.getAccountInfo(queue, "confirmed");

  if (info != null && info.owner.equals(DELEGATION_PROGRAM_ID)) {
    throw new Error(
      `Transfer queue ${queue.toBase58()} is delegated to DELEGATION_PROGRAM_ID, ` +
      `but our private-transfer path (depositAndQueueTransferIx) requires the queue ` +
      `to be SPL-owned (undelegated). The SDK provides no undelegate helper, so this ` +
      `queue PDA is unusable. Rotate NEXT_PUBLIC_MAGICBLOCK_USDC_MINT to a fresh legacy ` +
      `SPL token mint (run frontend/scripts/rotate-magicblock-mint.mjs), then re-run ` +
      `/api/payroll/fund-magicblock. The new queue will be created in the correct state.`,
    );
  }

  if (info != null) return; // SPL-owned — ready

  console.log(
    `[ensureTransferQueueReady] init queue ${queue.toBase58().slice(0, 8)}… ` +
    `(requestedItems=${QUEUE_REQUESTED_ITEMS}, leaving SPL-owned)`,
  );
  await signAndSubmitOnBase([
    initTransferQueueIx(payer, queue, mintPk, validator, QUEUE_REQUESTED_ITEMS),
  ]);
  await new Promise((r) => setTimeout(r, 1_500));
}

/**
 * Withdraw from the employer's ephemeral ATA back to base USDC. Submitted
 * on the ER with the employer's auth token. (For employees, the equivalent
 * call is made client-side from their wallet — see `/api/payroll/private-pay`
 * action=withdraw.)
 */
export async function employerWithdraw(
  amountUsdc: bigint,
  mint: string,
): Promise<{ signature: string }> {
  const keypair = loadEmployerKeypair();
  const mintPk = new PublicKey(mint);
  const token = await getEmployerAuthToken();

  const ixs = await withdrawSpl(keypair.publicKey, mintPk, amountUsdc, {
    payer: keypair.publicKey,
    initAtasIfMissing: true,
  });

  const signature = await signAndSubmitOnEr(ixs, token);
  return { signature };
}

// ── Misc helpers re-exported for routes that previously imported them ─────

export { MAGICBLOCK_TEE_URL, SOLANA_RPC };

/** For diagnostics: a connection pointed at the base RPC. */
export function baseConnection(): Connection {
  return new Connection(SOLANA_RPC, "confirmed");
}
