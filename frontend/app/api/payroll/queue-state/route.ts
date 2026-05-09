/**
 * GET /api/payroll/queue-state
 *
 * Diagnostic endpoint for MagicBlock's per-(mint, validator) transfer queue
 * PDA. Resolves the queue address from the configured legacy USDC mint and
 * the active TEE-fronted validator, fetches the on-chain account, and
 * returns:
 *
 *   • whether the account exists
 *   • who owns it (should be EphemeralSplToken / SPL Token Program; if it's
 *     the delegation program, the queue is delegated and depositAndQueueIx
 *     will reject every dispatch)
 *   • account size + estimated slot capacity (matches the heuristic
 *     `(data.length - HEADER) / SLOT_BYTES` used by employerPrivateTransfer)
 *   • a best-effort scan of slot bytes — non-zero slot regions are likely
 *     occupied; all-zero slot regions are likely free
 *   • the most recent millisecond-epoch timestamp found anywhere in the
 *     queue data (rough proxy for "when did the validator last write to
 *     this queue" — if it's hours/days old, the crank is stalled)
 *
 * The endpoint does not modify state. It exists purely so we can answer the
 * "is the validator alive?" question without going through MagicBlock support.
 */
import { NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import { deriveTransferQueue } from "@magicblock-labs/ephemeral-rollups-sdk";
import {
  getPrivateValidator,
  SOLANA_RPC,
  MAGICBLOCK_TEE_URL,
} from "@/lib/server/magicblock-private-payments";

export const runtime = "nodejs";

const MAGICBLOCK_USDC_MINT =
  process.env.NEXT_PUBLIC_MAGICBLOCK_USDC_MINT ||
  process.env.NEXT_PUBLIC_USDC_MINT ||
  "";

// Same constants employerPrivateTransfer uses to clamp split.
const APPROX_HEADER_BYTES = 64;
const APPROX_BYTES_PER_SLOT = 150;

/**
 * Scans an account's bytes for plausible millisecond-epoch timestamps
 * (u64 little-endian). Returns the largest finite value within the
 * sane range [2024-01-01, +5y]. This is a heuristic proxy for the
 * queue's freshest write — if nothing recent shows up, the validator
 * hasn't touched the queue lately.
 */
function findLatestMsTimestamp(data: Buffer): number | null {
  const FLOOR = new Date("2024-01-01").getTime(); // ms
  const CEIL = Date.now() + 5 * 365 * 86400 * 1000;
  let best: number | null = null;
  for (let i = 0; i + 8 <= data.length; i += 8) {
    // Read u64 little-endian as Number — safe up to 2^53 (year 287396).
    let v = 0;
    for (let j = 7; j >= 0; j--) {
      v = v * 256 + data[i + j];
    }
    if (v >= FLOOR && v <= CEIL) {
      if (best === null || v > best) best = v;
    }
  }
  return best;
}

/**
 * Walks the slot region in fixed-size strides and reports a non-zero/zero
 * occupancy bitmap. Best-effort — the SDK doesn't expose a layout decoder,
 * so we treat any slot whose first 32 bytes contain a non-zero byte as
 * "occupied". Headers (first APPROX_HEADER_BYTES) are skipped.
 */
function estimateOccupancy(data: Buffer): {
  capacity: number;
  occupied: number;
  bitmap: string;
} {
  if (data.length <= APPROX_HEADER_BYTES) {
    return { capacity: 0, occupied: 0, bitmap: "" };
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
  return { capacity, occupied, bitmap };
}

export async function GET() {
  if (!MAGICBLOCK_USDC_MINT) {
    return NextResponse.json(
      {
        error:
          "NEXT_PUBLIC_MAGICBLOCK_USDC_MINT not set. The diagnostic needs to know which legacy USDC mint to derive the queue from.",
      },
      { status: 500 },
    );
  }

  let validatorPk: PublicKey;
  try {
    validatorPk = await getPrivateValidator();
  } catch (e) {
    return NextResponse.json(
      {
        error: `Cannot resolve private validator from ${MAGICBLOCK_TEE_URL}: ${(e as Error).message}`,
        hint: "If this fails, MagicBlock's TEE auth endpoint is unreachable from your env. The dispatch route would 503 with the same error.",
      },
      { status: 503 },
    );
  }

  const mintPk = new PublicKey(MAGICBLOCK_USDC_MINT);
  const [queuePda] = deriveTransferQueue(mintPk, validatorPk);

  const conn = new Connection(SOLANA_RPC, "confirmed");
  const info = await conn.getAccountInfo(queuePda, "confirmed");

  if (!info) {
    return NextResponse.json({
      ok: true,
      mint: mintPk.toBase58(),
      validator: validatorPk.toBase58(),
      queuePda: queuePda.toBase58(),
      exists: false,
      hint:
        "Queue PDA does not exist on-chain. The first private dispatch would auto-create it via initTransferQueueIx (8 slots). If you're seeing 'Queue is full' despite this, the (mint, validator) pair the dispatch is using differs from this one — check NEXT_PUBLIC_MAGICBLOCK_USDC_MINT and NEXT_PUBLIC_MAGICBLOCK_TEE_URL.",
    });
  }

  const data = info.data;
  const occ = estimateOccupancy(data);
  const latestMs = findLatestMsTimestamp(data);
  const ageMs = latestMs ? Date.now() - latestMs : null;

  // Heuristic verdict so the caller doesn't have to interpret the numbers.
  let verdict: "healthy" | "stalled" | "saturated" | "unknown" = "unknown";
  let why = "Unable to determine. Inspect the raw bitmap.";
  if (occ.capacity === 0) {
    verdict = "unknown";
    why = "Queue is smaller than one slot — this account isn't a queue, or the layout assumption (header=64, slot=150) is wrong for this version.";
  } else if (occ.occupied === 0) {
    verdict = "healthy";
    why = "All slots appear empty. Next dispatch should succeed.";
  } else if (occ.occupied < occ.capacity) {
    if (ageMs !== null && ageMs < 5 * 60 * 1000) {
      verdict = "healthy";
      why = `${occ.occupied}/${occ.capacity} slots occupied; last write ${Math.round(ageMs / 1000)}s ago — validator is actively cranking.`;
    } else {
      verdict = "stalled";
      why = `${occ.occupied}/${occ.capacity} slots occupied; last detectable write ${ageMs ? `${Math.round(ageMs / 60000)}m ago` : "unknown age"}. Validator hasn't drained pending entries — likely crank-stalled.`;
    }
  } else {
    verdict = "saturated";
    why = `All ${occ.capacity} slots appear occupied. New dispatches will hit "Queue is full" until the validator drains them.${ageMs ? ` Oldest detectable write age: ${Math.round(ageMs / 60000)}m.` : ""}`;
  }

  return NextResponse.json({
    ok: true,
    mint: mintPk.toBase58(),
    validator: validatorPk.toBase58(),
    queuePda: queuePda.toBase58(),
    exists: true,
    owner: info.owner.toBase58(),
    rentEpoch: info.rentEpoch ?? null,
    lamports: info.lamports,
    dataBytes: data.length,
    capacityEstimate: occ.capacity,
    occupiedEstimate: occ.occupied,
    occupancyBitmap: occ.bitmap,
    latestWriteMs: latestMs,
    latestWriteAgeSec: ageMs ? Math.round(ageMs / 1000) : null,
    verdict,
    why,
    nextSteps:
      verdict === "saturated"
        ? "Wait for the TEE validator to crank the queue, or contact MagicBlock support with this queuePda. If you control the validator, restart its crank service."
        : verdict === "stalled"
          ? "Validator hasn't written to this queue recently. Either it's offline or your dispatcher is talking to a different validator than the one that owns this queue. Confirm getPrivateValidator() resolves to the same pubkey the validator is actually running under."
          : verdict === "healthy"
            ? "Queue looks fine. If dispatches still fail, the issue is upstream of the queue (auth, mint mismatch, or a different (mint, validator) pair than the one shown here)."
            : "Treat the bitmap as authoritative. The non-zero count is the real occupancy.",
  });
}
