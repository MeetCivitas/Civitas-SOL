/**
 * lib/borsh-encode.ts
 * Borsh encoding helpers for Civitas Anchor program instructions.
 * Matches the layout defined in programs/civitas-payroll/src/state.rs
 */

import { PublicKey } from "@solana/web3.js";

/**
 * Encode a BN254 field element (BigInt) as a 32-byte little-endian buffer.
 * Matches the [u8;32] representation used throughout the Anchor program.
 */
export function fieldToBytesLE(value: bigint): Buffer {
  const buf = Buffer.alloc(32);
  let tmp = ((value % BN254_PRIME) + BN254_PRIME) % BN254_PRIME;
  for (let i = 0; i < 32; i++) {
    buf[i] = Number(tmp & BigInt(0xff));
    tmp >>= BigInt(8);
  }
  return buf;
}

const BN254_PRIME = BigInt(
  "21888242871839275222246405745257275088548364400416034343698204186575808495617"
);

/**
 * Encode a u64 as 8-byte little-endian.
 * Uses manual bit decomposition — writeBigUInt64LE is not available in browser Buffer polyfills.
 */
export function u64LE(value: bigint | number): Buffer {
  const buf = Buffer.alloc(8);
  let v = BigInt(value) & BigInt("0xffffffffffffffff");
  for (let i = 0; i < 8; i++) {
    buf[i] = Number(v & BigInt(0xff));
    v >>= BigInt(8);
  }
  return buf;
}

/**
 * Encode a UUID string (with or without dashes) as 16 bytes.
 */
export function uuidToBytes(uuid: string): Buffer {
  const buf = Buffer.alloc(16);
  const clean = uuid.replace(/-/g, "");
  if (clean.length === 32) {
    Buffer.from(clean, "hex").copy(buf);
  }
  return buf;
}

/**
 * Borsh-encode ClaimPublicInputs matching state.rs layout:
 *   amount:                  u64  (8 bytes LE)
 *   epoch:                   u64  (8 bytes LE)
 *   run_id:                  [u8; 16]
 *   recipient_token_account: Pubkey (32 bytes)
 *
 * Total: 64 bytes.
 */
export function encodeClaimPublicInputs(params: {
  amount: bigint | string;
  epoch: bigint | string;
  runId: string;
  recipientTokenAccount: string;
}): Buffer {
  return Buffer.concat([
    u64LE(BigInt(params.amount)),
    u64LE(BigInt(params.epoch)),
    uuidToBytes(params.runId),
    new PublicKey(params.recipientTokenAccount).toBuffer(),
  ]);
}

/**
 * Encode the full claim_payment instruction data:
 *   discriminator (8) | proof_bytes: Vec<u8> (4 LE len + 256 B) |
 *   pi_hash: [u8;32]  | public_inputs: ClaimPublicInputs (64 B) |
 *   nullifier: [u8;32]
 */
export function encodeClaimPaymentArgs(params: {
  discriminator: Buffer;
  proofBytes: Uint8Array;
  piHash: Uint8Array;
  publicInputs: Buffer;
  nullifier: Uint8Array;
}): Buffer {
  if (params.proofBytes.length !== 256) {
    throw new Error(`proof must be 256 bytes, got ${params.proofBytes.length}`);
  }
  if (params.piHash.length !== 32) throw new Error("piHash must be 32 bytes");
  if (params.nullifier.length !== 32) throw new Error("nullifier must be 32 bytes");

  const proofLenBuf = Buffer.alloc(4);
  proofLenBuf.writeUInt32LE(params.proofBytes.length, 0);

  return Buffer.concat([
    params.discriminator,
    proofLenBuf,
    Buffer.from(params.proofBytes),
    Buffer.from(params.piHash),
    params.publicInputs,
    Buffer.from(params.nullifier),
  ]);
}
