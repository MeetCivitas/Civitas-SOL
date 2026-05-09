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

  // Probe the actual queue size and clamp `split` to its capacity. Each
  // queue slot is ~150 bytes; the on-chain shuttle ix rejects with
  // InvalidInstructionData if split > available slots. We compute a
  // conservative slot count from data.length and floor the requested
  // split at that.
  const conn = getBaseConnection();
  const [queuePda] = deriveTransferQueue(mintPk, validator);
  const queueInfo = await conn.getAccountInfo(queuePda, "confirmed");
  const queueBytes = queueInfo?.data.length ?? 0;
  const APPROX_BYTES_PER_SLOT = 150;
  const APPROX_HEADER_BYTES = 64;
  const queueCapacity = Math.max(
    1,
    Math.floor((queueBytes - APPROX_HEADER_BYTES) / APPROX_BYTES_PER_SLOT),
  );
  const requestedSplit = options.split ?? 4;
  const split = Math.min(requestedSplit, queueCapacity);
  if (split !== requestedSplit) {
    console.log(
      `[employerPrivateTransfer] clamped split ${requestedSplit} → ${split} ` +
      `(queue ${queueBytes}B ⇒ ~${queueCapacity} slots)`,
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
