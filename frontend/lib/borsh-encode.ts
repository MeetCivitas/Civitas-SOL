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
 * Borsh-encode VerificationPublicInputs matching state.rs layout:
 *   merkle_root:            [u8; 32]
 *   amount:                 u64  (8 bytes LE)
 *   epoch:                  u64  (8 bytes LE)
 *   recipient_token_account: Pubkey (32 bytes)
 *   program_id:             Pubkey (32 bytes)
 *   vault_pda:              Pubkey (32 bytes)
 *   mint:                   Pubkey (32 bytes)
 *   run_id:                 [u8; 16]
 *   domain_tag:             Vec<u8> (4-byte length prefix + UTF-8 bytes)
 *
 * Total fixed portion: 32+8+8+32+32+32+32+16 = 192 bytes
 * Plus domain_tag len prefix (4) + tag bytes (variable, typically 17).
 */
export function encodeVerificationPublicInputs(params: {
  /** 32-byte Uint8Array from on-chain vault (preferred) OR bigint/hex string */
  merkleRoot: Uint8Array | bigint | string;
  amount: bigint | string;
  epoch: bigint | string;
  recipientTokenAccount: string;
  programId: string;
  vaultPda: string;
  mint: string;
  runId: string;
  domainTag?: string;
}): Buffer {
  const domainTag = params.domainTag ?? "civitas-devnet-v1";
  const domainTagBytes = Buffer.from(domainTag, "utf8");
  const domainTagLenBuf = Buffer.alloc(4);
  domainTagLenBuf.writeUInt32LE(domainTagBytes.length);

  // merkleRoot: if raw bytes provided use them directly (on-chain LE bytes, no BigInt round-trip).
  // BigInt conversion would misinterpret LE bytes as big-endian, producing wrong values.
  const merkleRootBuf =
    params.merkleRoot instanceof Uint8Array
      ? Buffer.from(params.merkleRoot).subarray(0, 32)
      : fieldToBytesLE(BigInt(params.merkleRoot));

  return Buffer.concat([
    merkleRootBuf,
    u64LE(BigInt(params.amount)),
    u64LE(BigInt(params.epoch)),
    new PublicKey(params.recipientTokenAccount).toBuffer(),
    new PublicKey(params.programId).toBuffer(),
    new PublicKey(params.vaultPda).toBuffer(),
    new PublicKey(params.mint).toBuffer(),
    uuidToBytes(params.runId),
    domainTagLenBuf,
    domainTagBytes,
  ]);
}
