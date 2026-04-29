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

// Yield to the browser event loop so React can flush progress state updates
// between the heavy async steps.
async function yieldAndUpdate(pct: number, label: string, onProgress?: ProofProgressCallback) {
  onProgress?.(pct, label);
  await new Promise<void>((r) => setTimeout(r, 0));
}

/**
 * Generate a UltraHonk ZK proof for voucher redemption.
 *
 * Runs on the main thread using webpack-bundled dynamic imports — no static
 * worker file needed, so @noir-lang packages resolve correctly.
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

  // ── Compute all field values (fast, <1ms) ─────────────────────────────

  await yieldAndUpdate(2, "Computing credential fields...", onProgress);

  const nonceBigInt = toFieldElement(BigInt("0x" + credentialNonce));
  const employeeTag = bn128Poseidon1(nonceBigInt);
  const nullifierBig = bn128Poseidon3(nonceBigInt, epoch, voucherNonce);
  const commitmentBig = bn128Poseidon4(employeeTag, amount, epoch, voucherNonce);

  const recipientHashBig = BigInt(computeRecipientHash(recipientAddress));
  const tokenAccountHashBig = BigInt(computeTokenAccountHash(recipientTokenAccount));

  const domainTagBytes = new TextEncoder().encode(DOMAIN_TAG);
  let domainTagNum = BigInt(0);
  for (const b of domainTagBytes) domainTagNum = (domainTagNum * BigInt(256) + BigInt(b));
  const domainTagHashBig = bn128Poseidon1(toFieldElement(domainTagNum));

  // ── Build circuit inputs ───────────────────────────────────────────────

  const circuitInput: Record<string, unknown> = {
    credential_nonce: nonceBigInt.toString(),
    voucher_nonce: voucherNonce.toString(),
    merkle_path: merklePath.length > 0 ? merklePath : Array(20).fill("0"),
    path_index: leafIndex.toString(),
    merkle_root: "0",
    nullifier: nullifierBig.toString(),
    recipient_hash: recipientHashBig.toString(),
    amount: amount.toString(),
    epoch: epoch.toString(),
    token_account_hash: tokenAccountHashBig.toString(),
    domain_tag_hash: domainTagHashBig.toString(),
  };

  // Compute Merkle root from the sibling path
  let current = commitmentBig;
  let currentIndex = leafIndex;
  for (let i = 0; i < ZK_TREE_DEPTH; i++) {
    const sibling = merklePath.length > i ? BigInt(merklePath[i]) : ZK_ZERO_HASHES[i];
    const isRight = (currentIndex & 1) === 1;
    current = isRight ? bn128Poseidon2(sibling, current) : bn128Poseidon2(current, sibling);
    currentIndex >>= 1;
  }
  circuitInput.merkle_root = current.toString();

  // ── Load circuit artifact ──────────────────────────────────────────────

  await yieldAndUpdate(8, "Loading Noir circuit artifact...", onProgress);

  const circuitResp = await fetch("/circuits/voucher_noir/target/voucher.json");
  if (!circuitResp.ok) {
    throw new Error("Circuit artifact not found at /circuits/voucher_noir/target/voucher.json");
  }
  const circuitArtifact = await circuitResp.json();

  // ── Load Noir runtime (webpack-bundled, bare specifier resolves) ───────

  await yieldAndUpdate(18, "Initialising Noir runtime...", onProgress);
  const { Noir } = await import("@noir-lang/noir_js");

  await yieldAndUpdate(28, "Initialising UltraHonk backend...", onProgress);
  // Use @aztec/bb.js directly — @noir-lang/backend_barretenberg@0.36.0 bundles
  // an incompatible @aztec/bb.js@0.58.0 that cannot prove ACIR from Nargo 1.0.0-beta.16.
  const { UltraHonkBackend } = await import("@aztec/bb.js");

  await yieldAndUpdate(35, "Compiling proving key (one-time, ~15s)...", onProgress);
  // New API: takes bytecode string (base64+gzip ACIR), not the full artifact object.
  const backend = new UltraHonkBackend(circuitArtifact.bytecode, {
    threads: typeof navigator !== "undefined" ? (navigator.hardwareConcurrency ?? 4) : 4,
  });
  const noir = new Noir(circuitArtifact);

  // ── Generate witness ───────────────────────────────────────────────────

  await yieldAndUpdate(45, "Generating witness...", onProgress);
  const { witness } = await noir.execute(circuitInput as Parameters<typeof noir.execute>[0]);

  // ── Generate UltraHonk proof ───────────────────────────────────────────

  await yieldAndUpdate(55, "Generating UltraHonk proof (~30–60s)...", onProgress);
  const proofData = await backend.generateProof(witness);

  await yieldAndUpdate(88, "Exporting verification key...", onProgress);
  const vk = await backend.getVerificationKey();

  await yieldAndUpdate(95, "Finalising...", onProgress);

  const publicSignals = [
    circuitInput.merkle_root,
    circuitInput.nullifier,
    circuitInput.recipient_hash,
    circuitInput.amount,
    circuitInput.epoch,
    circuitInput.token_account_hash,
    circuitInput.domain_tag_hash,
  ].map(String);

  onProgress?.(100, "Proof generated ✓");

  return {
    proofBytes: new Uint8Array(proofData.proof),
    vkBytes: new Uint8Array(vk),
    publicSignals,
    nullifier: nullifierBig.toString(),
    commitment: commitmentBig.toString(),
    merkleRoot: String(circuitInput.merkle_root),
    amount: amount.toString(),
    epoch: epoch.toString(),
    recipientHash: recipientHashBig.toString(),
    tokenAccountHash: tokenAccountHashBig.toString(),
    domainTagHash: domainTagHashBig.toString(),
  };
}

/**
 * No-op — proof now runs on the main thread, no worker to terminate.
 * Kept for API compatibility with the useEffect cleanup in employees/page.tsx.
 */
export function terminateProofWorker(): void {
  // no-op
}
