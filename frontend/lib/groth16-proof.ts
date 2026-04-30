/**
 * lib/groth16-proof.ts — Civitas client-side Groth16 prover.
 *
 * Uses snarkjs to generate a 256-byte Groth16 proof for the voucher redemption
 * circuit (circuits/voucher_circom/voucher.circom).
 *
 * Outputs:
 *   - 256 B proof bytes (A: G1, B: G2, C: G1) in the EIP-197 layout the
 *     on-chain verifier expects.
 *   - 32 B  pi_hash — Poseidon sponge over the 10 binding fields. The
 *     on-chain handler recomputes pi_hash from authoritative state and
 *     reverts if it doesn't match.
 *   - All derived voucher fields (commitment, nullifier, etc.) for the
 *     callsite to use in the IX accounts list.
 *
 * Inputs that match voucher.circom signal names exactly. Order of the
 * SpongePoseidon inputs is binding — see the on-chain compute_pi_hash().
 */

import {
  bn128Poseidon1,
  bn128Poseidon3,
  bn128Poseidon4,
  toFieldElement,
} from "./bn128-poseidon";

// ── Domain tag (must match DOMAIN_TAG in programs/.../state.rs) ───────────

export const DOMAIN_TAG =
  process.env.NEXT_PUBLIC_CIVITAS_DOMAIN_TAG ?? "civitas-devnet-v1";

// ── Types ─────────────────────────────────────────────────────────────────

export type ProofProgress = (pct: number, label: string) => void;

export interface VoucherProofInput {
  /** Employee credential nonce — stays in browser */
  credentialNonce: bigint;
  /** Voucher nonce — from NilDB voucher record */
  voucherNonce: bigint;
  amount: bigint;
  epoch: bigint;
  /** UUID v4 bytes — 16 bytes */
  runId: Uint8Array;
  /** Recipient's Token-2022 ATA — 32 bytes */
  recipientTokenAccount: Uint8Array;
  /** USDC Token-2022 mint — 32 bytes */
  mint: Uint8Array;
  /** Vault PDA — 32 bytes */
  vaultPda: Uint8Array;
  /** Civitas program ID — 32 bytes */
  programId: Uint8Array;
  /** Merkle path siblings as decimal strings (BN254 field elements) */
  merklePath: string[];
  /** Leaf index in the Merkle tree */
  leafIndex: number;
  /** Vault's current finalized merkle root — 32 BE bytes */
  merkleRoot: Uint8Array;
}

export interface VoucherProofOutput {
  /** 256-byte Groth16 proof in EIP-197 layout (A || B || C). */
  proofBytes: Uint8Array;
  /** 32-byte pi_hash (BE) — must match on-chain recomputation. */
  piHash: Uint8Array;
  /** Computed nullifier (BN254 field element, decimal string). */
  nullifier: string;
  /** Computed commitment. */
  commitment: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────

/** Convert BE bytes (≤32) to a BN254 field element (BigInt mod p). */
function beBytesToField(bytes: Uint8Array): bigint {
  let n = 0n;
  for (let i = 0; i < bytes.length; i++) {
    n = (n << 8n) | BigInt(bytes[i]);
  }
  return toFieldElement(n);
}

/** Convert a BigInt field element to 32-byte BE buffer. */
function fieldToBE32(n: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let x = n;
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  if (x !== 0n) throw new Error("field element doesn't fit in 32 bytes");
  return out;
}

/** Convert a snarkjs G1 point [x, y, "1"] to 64 BE bytes. */
function g1ToBytes(p: string[]): Uint8Array {
  return concat(fieldToBE32(BigInt(p[0])), fieldToBE32(BigInt(p[1])));
}

/** Convert a snarkjs G2 point [[x_c0, x_c1], [y_c0, y_c1], ["1","0"]] to 128 BE bytes
 *  in EIP-197 order (x_c1 || x_c0 || y_c1 || y_c0). */
function g2ToBytes(p: string[][]): Uint8Array {
  return concat(
    fieldToBE32(BigInt(p[0][1])),
    fieldToBE32(BigInt(p[0][0])),
    fieldToBE32(BigInt(p[1][1])),
    fieldToBE32(BigInt(p[1][0])),
  );
}

function concat(...arrs: Uint8Array[]): Uint8Array {
  const len = arrs.reduce((a, b) => a + b.length, 0);
  const out = new Uint8Array(len);
  let off = 0;
  for (const a of arrs) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

// ── Domain tag → field element (must match on-chain DOMAIN_TAG handling) ──
//
// On-chain (claim_payment.rs::compute_pi_hash):
//   let mut dom_be = [0u8; 32];
//   let dlen = domain_tag.len().min(32);
//   dom_be[32 - dlen..].copy_from_slice(&domain_tag[..dlen]);
// i.e. right-aligned, big-endian — same as `beBytesToField(right_aligned)`.

function domainTagField(tag: string): bigint {
  const enc = new TextEncoder().encode(tag).slice(0, 32);
  const padded = new Uint8Array(32);
  padded.set(enc, 32 - enc.length);
  return beBytesToField(padded);
}

function u64ToField(x: bigint): bigint {
  return toFieldElement(x);
}

function bytesToField(bytes: Uint8Array): bigint {
  // Right-align to 32 bytes if shorter; reject if longer.
  if (bytes.length > 32) throw new Error("field bytes too long");
  if (bytes.length === 32) return beBytesToField(bytes);
  const padded = new Uint8Array(32);
  padded.set(bytes, 32 - bytes.length);
  return beBytesToField(padded);
}

// ── Sponge Poseidon (matches voucher.circom SpongePoseidon(10)) ───────────

async function spongePoseidon(inputs: bigint[]): Promise<bigint> {
  // Use the two-input Poseidon helper from bn128-poseidon.ts iteratively.
  // bn128Poseidon2 imports the same circomlib parameters as the on-chain
  // sol_poseidon syscall (Bn254X5), so the chain matches exactly.
  const { bn128Poseidon2 } = await import("./bn128-poseidon");
  let state = 0n;
  for (const x of inputs) {
    state = bn128Poseidon2(state, x);
  }
  return state;
}

// ── Main entry point ──────────────────────────────────────────────────────

export async function generateVoucherProof(
  input: VoucherProofInput,
  onProgress?: ProofProgress,
): Promise<VoucherProofOutput> {
  onProgress?.(2, "Deriving voucher fields...");

  const employeeTag = bn128Poseidon1(input.credentialNonce);
  const commitment = bn128Poseidon4(employeeTag, input.amount, input.epoch, input.voucherNonce);
  const nullifier = bn128Poseidon3(input.credentialNonce, input.epoch, input.voucherNonce);

  // Convert all binding fields → BN254 field elements (matches on-chain
  // hashv invocation order in compute_pi_hash).
  const merkleRootField = bytesToField(input.merkleRoot);
  const recipientField = bytesToField(input.recipientTokenAccount);
  const mintField = bytesToField(input.mint);
  const vaultField = bytesToField(input.vaultPda);
  const programIdField = bytesToField(input.programId);
  const runIdField = bytesToField(input.runId);
  const domainField = domainTagField(DOMAIN_TAG);
  const amountField = u64ToField(input.amount);
  const epochField = u64ToField(input.epoch);

  onProgress?.(8, "Computing pi_hash...");
  const piHashBig = await spongePoseidon([
    merkleRootField,
    nullifier,
    recipientField,
    amountField,
    epochField,
    mintField,
    vaultField,
    programIdField,
    runIdField,
    domainField,
  ]);

  // ── Build circuit input ────────────────────────────────────────────────
  const circuitInput: Record<string, string | string[]> = {
    credential_nonce: input.credentialNonce.toString(),
    voucher_nonce: input.voucherNonce.toString(),
    merkle_path:
      input.merklePath.length === 20
        ? input.merklePath
        : [...input.merklePath, ...Array(20 - input.merklePath.length).fill("0")],
    path_index: input.leafIndex.toString(),
    merkle_root: merkleRootField.toString(),
    nullifier: nullifier.toString(),
    recipient_token_account: recipientField.toString(),
    amount: amountField.toString(),
    epoch: epochField.toString(),
    mint: mintField.toString(),
    vault_pda: vaultField.toString(),
    program_id: programIdField.toString(),
    run_id: runIdField.toString(),
    domain_tag: domainField.toString(),
    pi_hash: piHashBig.toString(),
  };

  // ── Generate proof via snarkjs ─────────────────────────────────────────
  onProgress?.(20, "Loading proving key (one-time, ~5s)...");
  const snarkjs: any = await import("snarkjs");

  onProgress?.(30, "Generating witness + proof (~10–30s)...");
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    circuitInput,
    "/zk/voucher.wasm",
    "/zk/voucher_final.zkey",
  );

  onProgress?.(90, "Encoding proof for on-chain...");

  // snarkjs proof format → 256-byte EIP-197 layout
  const proofBytes = concat(
    g1ToBytes(proof.pi_a),
    g2ToBytes(proof.pi_b),
    g1ToBytes(proof.pi_c),
  );
  if (proofBytes.length !== 256) {
    throw new Error(`proof length ${proofBytes.length} != 256`);
  }

  // Sanity: snarkjs publicSignals[0] should equal piHashBig.
  if (BigInt(publicSignals[0]) !== piHashBig) {
    throw new Error(
      `pi_hash mismatch: snarkjs=${publicSignals[0]} expected=${piHashBig.toString()}`,
    );
  }

  onProgress?.(100, "Proof ready ✓");

  return {
    proofBytes,
    piHash: fieldToBE32(piHashBig),
    nullifier: nullifier.toString(),
    commitment: commitment.toString(),
  };
}
