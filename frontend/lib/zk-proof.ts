/**
 * lib/zk-proof.ts — Civitas Client-Side ZK Proof Generation (Solana / UltraHonk build)
 *
 * Key changes from v1 (Groth16 / circom):
 *   - Backend: @aztec/bb.js UltraHonk (replaces snarkjs Groth16)
 *   - Execution: Web Worker so the main thread never freezes during proof gen
 *   - Progress: onProgress(pct, label) callback drives a UI progress bar
 *   - Public inputs: extended with token_account_hash + domain_tag_hash
 *   - Poseidon: bn128-poseidon.ts (BN254 field, matches Noir bb.js + on-chain)
 *
 * Architecture:
 *   This file is the MAIN THREAD API. The actual proof computation runs in
 *   `/public/workers/proof-worker.js` via Web Worker to keep the UI responsive.
 *   Progress messages are sent from the worker to this file via postMessage.
 */

import {
  bn128Poseidon1,
  bn128Poseidon2,
  bn128Poseidon3,
  bn128Poseidon4,
  toFieldElement,
} from "./bn128-poseidon";
import { computeRecipientHash, computeTokenAccountHash } from "./identity";

// ── Deployment domain tag (must match Noir circuit + Anchor program) ─────

const DOMAIN_TAG =
  process.env.NEXT_PUBLIC_CIVITAS_DOMAIN_TAG ?? "civitas-devnet-v1";

// ── Types ─────────────────────────────────────────────────────────────────

export type ProofProgressCallback = (pct: number, label: string) => void;

export interface UltraHonkProof {
  /** Raw proof bytes from bb.js UltraHonk */
  proofBytes: Uint8Array;
  /** Verification key bytes */
  vkBytes: Uint8Array;
  /** All public signals (as decimal strings for ABI encoding) */
  publicSignals: string[];
  /** Specific extracted fields for Anchor IX */
  nullifier: string;
  commitment: string;
  merkleRoot: string;
  amount: string;
  epoch: string;
  recipientHash: string;
  tokenAccountHash: string;
  domainTagHash: string;
}

export interface RedemptionInput {
  /** Hex credential nonce — the master secret, stays in browser */
  credentialNonce: string;
  amount: bigint;
  epoch: bigint;
  voucherNonce: bigint;
  /** Solana base58 recipient wallet address (for recipient_hash) */
  recipientAddress: string;
  /** Solana base58 recipient Token-2022 token account (for token_account_hash) */
  recipientTokenAccount: string;
  /** Merkle path siblings (BN254 field strings) */
  merklePath: string[];
  /** Leaf index in the Merkle tree */
  leafIndex: number;
}

// ── BN254 Merkle tree (matches nilCC workload + on-chain tree) ─────────────

const ZK_TREE_DEPTH = 20;
const ZK_EMPTY_LEAF = BigInt(0);

function computeZkZeroHashes(): bigint[] {
  const zeros: bigint[] = [ZK_EMPTY_LEAF];
  for (let i = 0; i < ZK_TREE_DEPTH; i++) {
    zeros.push(bn128Poseidon2(zeros[i], zeros[i]));
  }
  return zeros;
}

const ZK_ZERO_HASHES = computeZkZeroHashes();

// ── Web Worker – Main Thread Wrapper ────────────────────────────────────────

let _worker: Worker | null = null;

function getProofWorker(): Worker {
  if (!_worker) {
    // The worker file is served from /public/workers/
    _worker = new Worker("/workers/proof-worker.js");
  }
  return _worker;
}

/**
 * Generate a UltraHonk ZK proof for voucher redemption.
 *
 * Runs in a Web Worker — the main thread is never blocked.
 * The caller receives progress updates via onProgress callback.
 *
 * @param input     Voucher redemption inputs (private nonce + public fields)
 * @param onProgress Optional callback — pct in [0..100], label is human-readable
 * @returns         UltraHonkProof with raw bytes ready for Anchor IX
 */
export async function generateRedemptionProof(
  input: RedemptionInput,
  onProgress?: ProofProgressCallback
): Promise<UltraHonkProof> {
  const {
    credentialNonce,
    amount,
    epoch,
    voucherNonce,
    recipientAddress,
    recipientTokenAccount,
    merklePath,
    leafIndex,
  } = input;

  // ── Compute all field values on main thread (fast, <1ms) ───────────────

  onProgress?.(2, "Computing credential fields...");

  const nonceBigInt = toFieldElement(BigInt("0x" + credentialNonce));
  const employeeTag = bn128Poseidon1(nonceBigInt);
  const nullifierBig = bn128Poseidon3(nonceBigInt, epoch, voucherNonce);
  const commitmentBig = bn128Poseidon4(employeeTag, amount, epoch, voucherNonce);

  // recipient_hash uses the wallet address as a field element
  const recipientHashBig = bn128Poseidon1(toFieldElement(BigInt(recipientAddress.slice(0, 16) + "0".repeat(16))));

  // token_account_hash binds to the Token-2022 token account
  const tokenAccountHashBig = bn128Poseidon1(toFieldElement(BigInt(recipientTokenAccount.slice(0, 16) + "0".repeat(16))));

  // domain_tag_hash = Poseidon(keccak256(DOMAIN_TAG) as field)
  const domainTagBytes = new TextEncoder().encode(DOMAIN_TAG);
  const domainTagHashBig = bn128Poseidon1(toFieldElement(
    BigInt("0x" + Array.from(domainTagBytes).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 60))
  ));

  // ── Build circuit inputs ───────────────────────────────────────────────

  const circuitInput = {
    // Private inputs
    credential_nonce: nonceBigInt.toString(),
    voucher_nonce: voucherNonce.toString(),
    merkle_path: merklePath.length > 0
      ? merklePath
      : Array(20).fill("0"),
    path_index: leafIndex.toString(),

    // Public inputs
    merkle_root: "0", // Will be filled by the Merkle tree computation below
    nullifier: nullifierBig.toString(),
    recipient_hash: recipientHashBig.toString(),
    amount: amount.toString(),
    epoch: epoch.toString(),
    token_account_hash: tokenAccountHashBig.toString(),
    domain_tag_hash: domainTagHashBig.toString(),
  };

  // Compute the Merkle root from the provided path
  let current = commitmentBig;
  let currentIndex = leafIndex;
  for (let i = 0; i < ZK_TREE_DEPTH; i++) {
    const sibling = merklePath.length > i
      ? BigInt(merklePath[i])
      : ZK_ZERO_HASHES[i];

    const isRight = (currentIndex & 1) === 1;
    current = isRight
      ? bn128Poseidon2(sibling, current)
      : bn128Poseidon2(current, sibling);
    currentIndex >>= 1;
  }
  circuitInput.merkle_root = current.toString();

  onProgress?.(5, "Starting proof generation (this takes 30–60s)...");

  // ── Dispatch to Web Worker ─────────────────────────────────────────────

  return new Promise<UltraHonkProof>((resolve, reject) => {
    const worker = getProofWorker();

    const handleMessage = (event: MessageEvent) => {
      const { type, pct, label, result, error } = event.data;

      if (type === "progress") {
        onProgress?.(Math.min(5 + Math.floor(pct * 0.9), 95), label);
        return;
      }

      if (type === "done") {
        worker.removeEventListener("message", handleMessage);
        onProgress?.(100, "Proof generated ✓");
        resolve({
          proofBytes: new Uint8Array(result.proofBytes),
          vkBytes: new Uint8Array(result.vkBytes),
          publicSignals: result.publicSignals,
          nullifier: nullifierBig.toString(),
          commitment: commitmentBig.toString(),
          merkleRoot: circuitInput.merkle_root,
          amount: amount.toString(),
          epoch: epoch.toString(),
          recipientHash: recipientHashBig.toString(),
          tokenAccountHash: tokenAccountHashBig.toString(),
          domainTagHash: domainTagHashBig.toString(),
        });
        return;
      }

      if (type === "error") {
        worker.removeEventListener("message", handleMessage);
        reject(new Error(error ?? "Proof generation failed in worker"));
      }
    };

    worker.addEventListener("message", handleMessage);
    worker.postMessage({ type: "generate", circuitInput });
  });
}

/**
 * Verify a UltraHonk proof locally (client-side, for debugging).
 * Uses the bundled bb.js backend.
 */
export async function verifyRedemptionProof(
  proofBytes: Uint8Array,
  vkBytes: Uint8Array
): Promise<boolean> {
  try {
    // @ts-ignore — bb.js types may lag behind the nightly build
    const { UltraHonkBackend } = await import("@aztec/bb.js");
    const backend = new UltraHonkBackend(vkBytes as any, { threads: 1 });
    // @ts-ignore
    return await backend.verifyProof({ proof: proofBytes });
  } catch {
    return false;
  }
}

/**
 * Terminate the proof worker when the component unmounts.
 * Call this in useEffect cleanup.
 */
export function terminateProofWorker(): void {
  _worker?.terminate();
  _worker = null;
}
