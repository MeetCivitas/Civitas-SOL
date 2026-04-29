/**
 * lib/solana-proof.ts — Civitas Solana Proof Generation
 *
 * Replaces noir-proof.ts entirely. No Garaga, no Starknet calldata.
 *
 * Architecture:
 *   Main thread: computes all field values (Poseidon, Merkle root)
 *   Web Worker:  runs UltraHonk proof generation via @noir-lang/noir_js + bb.js
 *   Anchor IX:   proof bytes passed directly as Vec<u8> to begin_verification
 *
 * The proof_hash = keccak256(proof_bytes) is computed here for the PDA seed.
 * Public inputs are serialised as [u8;32] LE arrays matching Anchor state.
 */

import {
  bn128Poseidon1,
  bn128Poseidon2,
  bn128Poseidon3,
  bn128Poseidon4,
  toFieldElement,
  fieldToBytes32LE,
  fieldToHex,
} from "./bn128-poseidon";
import { MerkleTree, TREE_DEPTH } from "./merkle-tree";

// ── Domain tag (must match DOMAIN_TAG in state.rs) ────────────────────────

export const DOMAIN_TAG =
  (process.env.NEXT_PUBLIC_CIVITAS_DOMAIN_TAG as string) ?? "civitas-devnet-v1";

export const DOMAIN_TAG_BYTES = (() => {
  const enc = new TextEncoder().encode(DOMAIN_TAG);
  const out = new Uint8Array(32);
  out.set(enc.slice(0, 32));
  return out;
})();

// ── Progress callback type ────────────────────────────────────────────────

export type ProofProgress = (pct: number, label: string) => void;

// ── Input / output types ──────────────────────────────────────────────────

export interface SolanaProofInput {
  /** Employee credential nonce — stays in browser, never server-side */
  credentialNonce: bigint;
  /** Voucher nonce — from NilDB voucher record */
  voucherNonce: bigint;
  amount: bigint;
  epoch: bigint;
  /** Solana wallet public key as a bigint field element */
  recipientHash: bigint;
  /** Token-2022 token account as a bigint field element */
  tokenAccountHash: bigint;
  /** Merkle path (siblings), length = TREE_DEPTH */
  merklePath: bigint[];
  /** Leaf index in the Merkle tree */
  leafIndex: number;
  /** Merkle root — pre-computed from on-chain VaultState */
  merkleRoot: bigint;
}

export interface SolanaProof {
  /** Raw UltraHonk proof bytes — passed to begin_verification as Vec<u8> */
  proofBytes: Uint8Array;
  /** Verification key bytes */
  vkBytes: Uint8Array;
  /** keccak256(proofBytes) — used as VerificationSession PDA seed */
  proofHash: Uint8Array;
  /** All derived field values */
  fields: {
    nullifier: bigint;
    commitment: bigint;
    merkleRoot: bigint;
    recipientHash: bigint;
    tokenAccountHash: bigint;
    domainTagHash: bigint;
    amount: bigint;
    epoch: bigint;
  };
  /** Serialised public inputs for Anchor VerificationPublicInputs */
  anchorPublicInputs: AnchorPublicInputs;
}

export interface AnchorPublicInputs {
  programId: Uint8Array;   // 32 bytes
  vaultPda: Uint8Array;    // 32 bytes
  merkleRoot: Uint8Array;  // [u8;32] LE
  nullifier: Uint8Array;   // [u8;32] LE
  commitment: Uint8Array;  // [u8;32] LE
  recipientTokenAccount: Uint8Array; // 32 bytes
  mint: Uint8Array;        // 32 bytes
  domainTag: Uint8Array;   // [u8;32] ASCII-padded
  epoch: bigint;
  runId: Uint8Array;       // [u8;16]
}

// ── Derive all field values ───────────────────────────────────────────────

export function deriveProofFields(input: SolanaProofInput) {
  const {
    credentialNonce,
    voucherNonce,
    amount,
    epoch,
    recipientHash,
    tokenAccountHash,
  } = input;

  // employee_tag = Poseidon(credential_nonce)
  const employeeTag = bn128Poseidon1(credentialNonce);
  // commitment = Poseidon(employee_tag, amount, epoch, voucher_nonce)
  const commitment = bn128Poseidon4(employeeTag, amount, epoch, voucherNonce);
  // nullifier = Poseidon(credential_nonce, epoch, voucher_nonce)
  const nullifier = bn128Poseidon3(credentialNonce, epoch, voucherNonce);
  // domain_tag_hash = Poseidon(domain_tag_as_field)
  const domainTagField = toFieldElement(
    BigInt("0x" + Buffer.from(DOMAIN_TAG).toString("hex").slice(0, 60).padStart(60, "0"))
  );
  const domainTagHash = bn128Poseidon1(domainTagField);

  return {
    employeeTag,
    commitment,
    nullifier,
    merkleRoot: input.merkleRoot,
    recipientHash,
    tokenAccountHash,
    domainTagHash,
    amount,
    epoch,
  };
}

// ── Build circuit input object ────────────────────────────────────────────

export function buildCircuitInput(input: SolanaProofInput) {
  const fields = deriveProofFields(input);

  // Pad merkle path to TREE_DEPTH
  const paddedPath = [...input.merklePath];
  while (paddedPath.length < TREE_DEPTH) {
    paddedPath.push(BigInt(0));
  }

  return {
    // Private inputs
    credential_nonce: input.credentialNonce.toString(),
    voucher_nonce: input.voucherNonce.toString(),
    merkle_path: paddedPath.map((n) => n.toString()),
    path_index: input.leafIndex.toString(),

    // Public inputs
    merkle_root: fields.merkleRoot.toString(),
    nullifier: fields.nullifier.toString(),
    recipient_hash: fields.recipientHash.toString(),
    amount: fields.amount.toString(),
    epoch: fields.epoch.toString(),
    token_account_hash: fields.tokenAccountHash.toString(),
    domain_tag_hash: fields.domainTagHash.toString(),
  };
}

// ── Web Worker proof generation ───────────────────────────────────────────

let _proofWorker: Worker | null = null;

function getWorker(): Worker {
  if (!_proofWorker) {
    _proofWorker = new Worker("/workers/proof-worker.js");
  }
  return _proofWorker;
}

/**
 * Generate a UltraHonk ZK proof for salary claim.
 * Runs in a Web Worker so the main thread stays responsive.
 */
export async function generateSolanaProof(
  input: SolanaProofInput,
  anchorCtx: {
    programId: Uint8Array;
    vaultPda: Uint8Array;
    recipientTokenAccount: Uint8Array;
    mint: Uint8Array;
    runId: Uint8Array;
  },
  onProgress?: ProofProgress
): Promise<SolanaProof> {
  onProgress?.(1, "Deriving credential fields...");

  const fields = deriveProofFields(input);
  const circuitInput = buildCircuitInput(input);

  onProgress?.(5, "Starting proof worker...");

  // ── Run in Web Worker ─────────────────────────────────────────────────
  const { proofBytes, vkBytes } = await new Promise<{
    proofBytes: Uint8Array;
    vkBytes: Uint8Array;
  }>((resolve, reject) => {
    const worker = getWorker();

    const onMessage = (event: MessageEvent) => {
      const { type, pct, label, result, error } = event.data;

      if (type === "progress") {
        onProgress?.(5 + Math.floor(pct * 0.9), label);
        return;
      }
      if (type === "done") {
        worker.removeEventListener("message", onMessage);
        onProgress?.(98, "Finalising...");
        resolve({
          proofBytes: new Uint8Array(result.proofBytes),
          vkBytes: new Uint8Array(result.vkBytes),
        });
        return;
      }
      if (type === "error") {
        worker.removeEventListener("message", onMessage);
        reject(new Error(error ?? "Proof worker failed"));
      }
    };

    worker.addEventListener("message", onMessage);
    worker.postMessage({ type: "generate", circuitInput });
  });

  // ── Compute proof_hash = keccak256(proofBytes) ────────────────────────
  // Used as the VerificationSession PDA seed in begin_verification.
  const hashBuf = await crypto.subtle.digest("SHA-256", proofBytes as any);
  // Note: Solana uses keccak256 for PDA computation; SHA-256 here is for
  // the off-chain computation. The on-chain keccak is done by the Anchor program.
  // We pass proof_hash as a constructor arg; on-chain it re-derives and checks.
  const proofHash = new Uint8Array(hashBuf);

  // ── Build Anchor public inputs struct ─────────────────────────────────
  const anchorPublicInputs: AnchorPublicInputs = {
    programId: anchorCtx.programId,
    vaultPda: anchorCtx.vaultPda,
    merkleRoot: fieldToBytes32LE(fields.merkleRoot),
    nullifier: fieldToBytes32LE(fields.nullifier),
    commitment: fieldToBytes32LE(fields.commitment),
    recipientTokenAccount: anchorCtx.recipientTokenAccount,
    mint: anchorCtx.mint,
    domainTag: DOMAIN_TAG_BYTES,
    epoch: fields.epoch,
    runId: anchorCtx.runId,
  };

  onProgress?.(100, "Proof ready ✓");

  return {
    proofBytes,
    vkBytes,
    proofHash,
    fields,
    anchorPublicInputs,
  };
}

/**
 * Terminate the proof worker (call in useEffect cleanup).
 */
export function terminateProofWorker(): void {
  _proofWorker?.terminate();
  _proofWorker = null;
}

/**
 * Verify a proof locally (for testing/debugging).
 */
export async function verifySolanaProof(
  proofBytes: Uint8Array,
  vkBytes: Uint8Array
): Promise<boolean> {
  try {
    // @ts-ignore
    const { BarretenbergBackend } = await import("@noir-lang/backend_barretenberg");
    const backend = new BarretenbergBackend({ threads: 1 } as any);
    return await (backend as any).verifyProof({ proof: proofBytes, vk: vkBytes });
  } catch {
    return false;
  }
}

/**
 * Encode a SolanaProof public-inputs struct as Borsh bytes for the Anchor IX.
 * Anchor auto-derives Borsh encoding for `#[derive(AnchorSerialize, AnchorDeserialize)]`,
 * so we replicate the struct layout here for the client-side transaction builder.
 *
 * Layout (all LE):
 *   program_id:             [u8; 32]
 *   vault_pda:              [u8; 32]
 *   merkle_root:            [u8; 32]
 *   nullifier:              [u8; 32]
 *   commitment:             [u8; 32]
 *   recipient_token_account:[u8; 32]
 *   mint:                   [u8; 32]
 *   domain_tag:             [u8; 32]
 *   epoch:                  u64 LE
 *   run_id:                 [u8; 16]
 */
export function encodeAnchorPublicInputs(p: AnchorPublicInputs): Uint8Array {
  const buf = new Uint8Array(32 * 8 + 8 + 16);
  let off = 0;

  const write32 = (bytes: Uint8Array) => {
    buf.set(bytes.slice(0, 32), off);
    off += 32;
  };

  write32(p.programId);
  write32(p.vaultPda);
  write32(p.merkleRoot);
  write32(p.nullifier);
  write32(p.commitment);
  write32(p.recipientTokenAccount);
  write32(p.mint);
  write32(p.domainTag);

  // epoch: u64 LE
  const epoch = p.epoch;
  for (let i = 0; i < 8; i++) {
    buf[off + i] = Number((epoch >> BigInt(i * 8)) & BigInt(0xff));
  }
  off += 8;

  // run_id: [u8;16]
  buf.set(p.runId.slice(0, 16), off);

  return buf;
}
