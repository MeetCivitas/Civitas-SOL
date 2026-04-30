/**
 * lib/server/pi-hash.ts
 *
 * Off-chain SpongePoseidon pi_hash recomputation — used by the MagicBlock
 * dispatcher to bind employee-supplied (recipient, amount, epoch) to the
 * on-chain pi_hash committed by a Groth16 proof, BEFORE actually moving
 * USDC privately on the employer's behalf.
 *
 * MUST stay byte-identical to:
 *   - The circuit's SpongePoseidon(10) (circuits/voucher_circom/voucher.circom)
 *   - The client-side `spongePoseidon` in `lib/groth16-proof.ts`
 *
 * Field order is binding — DO NOT reorder.
 */

import { poseidon2 } from "poseidon-lite";
import { PublicKey } from "@solana/web3.js";

const BN254_PRIME = BigInt(
  "21888242871839275222246405745257275088548364400416034343698204186575808495617"
);

const toField = (n: bigint): bigint => ((n % BN254_PRIME) + BN254_PRIME) % BN254_PRIME;

const beBytesToBig = (bytes: Uint8Array): bigint => {
  let n = 0n;
  for (let i = 0; i < bytes.length; i++) n = (n << 8n) | BigInt(bytes[i]);
  return n;
};

const bytesToField = (bytes: Uint8Array): bigint => {
  if (bytes.length > 32) throw new Error("field bytes too long");
  if (bytes.length === 32) return toField(beBytesToBig(bytes));
  const padded = new Uint8Array(32);
  padded.set(bytes, 32 - bytes.length);
  return toField(beBytesToBig(padded));
};

const u64ToField = (x: bigint): bigint => toField(x);

const domainTagField = (tag: string): bigint => {
  const enc = new TextEncoder().encode(tag).slice(0, 32);
  const padded = new Uint8Array(32);
  padded.set(enc, 32 - enc.length);
  return toField(beBytesToBig(padded));
};

/** 32-byte BE encoding of a BN254 field element. */
export function fieldToBE32(n: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let x = toField(n);
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}

/** UUID string → 16 bytes. Matches `uuidToBytes` in lib/borsh-encode.ts. */
export function uuidToBytes16(uuid: string): Uint8Array {
  const clean = (uuid || "").replace(/-/g, "");
  const out = new Uint8Array(16);
  if (clean.length === 32) {
    for (let i = 0; i < 16; i++) {
      out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    }
  }
  return out;
}

export interface PiHashInputs {
  /** 32 BE bytes — `payroll_run.finalized_root` from chain. */
  merkleRoot: Uint8Array;
  /** 32 BE bytes — Poseidon nullifier the proof committed to. */
  nullifier: Uint8Array;
  /** Pubkey base58 — employee's USDC ATA the proof committed to. */
  recipientTokenAccount: string;
  amount: bigint;
  epoch: bigint;
  /** Pubkey base58 — Token-2022 USDC mint. */
  mint: string;
  /** Pubkey base58 — Civitas vault PDA derived from employer. */
  vaultPda: string;
  /** Pubkey base58 — Civitas program ID. */
  programId: string;
  /** UUID string. */
  runId: string;
  /** Domain tag (e.g. "civitas-devnet-v1"). */
  domainTag: string;
}

/**
 * Recompute pi_hash exactly the way the circom circuit does — sponge
 * Poseidon(2) over the 10 binding fields, state initialised to 0.
 *
 * Returns 32 BE bytes ready for byte-equality comparison with the on-chain
 * pi_hash that was submitted in the claim_payment IX.
 */
export function recomputePiHash(inputs: PiHashInputs): Uint8Array {
  const fields: bigint[] = [
    bytesToField(inputs.merkleRoot),
    bytesToField(inputs.nullifier),
    bytesToField(new PublicKey(inputs.recipientTokenAccount).toBytes()),
    u64ToField(inputs.amount),
    u64ToField(inputs.epoch),
    bytesToField(new PublicKey(inputs.mint).toBytes()),
    bytesToField(new PublicKey(inputs.vaultPda).toBytes()),
    bytesToField(new PublicKey(inputs.programId).toBytes()),
    bytesToField(uuidToBytes16(inputs.runId)),
    domainTagField(inputs.domainTag),
  ];

  let state = 0n;
  for (const f of fields) {
    state = poseidon2([state, f]);
  }
  return fieldToBE32(state);
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error("invalid hex length");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
