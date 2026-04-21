// lib/bn128-poseidon.ts
// BN254 (BN128 / alt-bn128) Poseidon hashing — Solana / Noir build
//
// Uses poseidon-lite with BN254 field (same as circomlib, Aztec bb.js, nilCC).
// CRITICAL: NO Starknet modulo reduction — outputs are native BN254 field elements,
// matching the Noir circuit (bn254::poseidon module) and on-chain light-poseidon.

import { poseidon1, poseidon2, poseidon3, poseidon4 } from "poseidon-lite";

// BN254 field prime
export const BN254_PRIME = BigInt(
    "21888242871839275222246405745257275088548364400416034343698204186575808495617"
);

/** Reduce a bigint to BN254 scalar field range. */
export function toFieldElement(val: bigint): bigint {
    return ((val % BN254_PRIME) + BN254_PRIME) % BN254_PRIME;
}

/**
 * Poseidon(a) — BN254 field.
 * Used for: employee_tag = Poseidon(credential_nonce)
 */
export function bn128Poseidon1(a: bigint): bigint {
    return poseidon1([a]);
}

/**
 * Poseidon(a, b) — BN254 field.
 * Used for: Merkle tree node hashing
 */
export function bn128Poseidon2(a: bigint, b: bigint): bigint {
    return poseidon2([a, b]);
}

/**
 * Poseidon(a, b, c) — BN254 field.
 * Used for: nullifier = Poseidon(credential_nonce, epoch, voucher_nonce)
 */
export function bn128Poseidon3(a: bigint, b: bigint, c: bigint): bigint {
    return poseidon3([a, b, c]);
}

/**
 * Poseidon(a, b, c, d) — BN254 field.
 * Used for: commitment = Poseidon(employee_tag, amount, epoch, voucher_nonce)
 */
export function bn128Poseidon4(a: bigint, b: bigint, c: bigint, d: bigint): bigint {
    return poseidon4([a, b, c, d]);
}

// ── Encoding helpers for Anchor program interface ─────────────────────────

/**
 * Encode a BN254 field element as a little-endian 32-byte Uint8Array.
 * Matches the [u8; 32] representation used by the Anchor program state.
 */
export function fieldToBytes32LE(n: bigint): Uint8Array {
    const bytes = new Uint8Array(32);
    let tmp = toFieldElement(n);
    for (let i = 0; i < 32; i++) {
        bytes[i] = Number(tmp & BigInt(0xff));
        tmp >>= BigInt(8);
    }
    return bytes;
}

/**
 * Decode a 32-byte LE Uint8Array back to a BN254 field element bigint.
 */
export function bytes32LEToField(bytes: Uint8Array): bigint {
    let n = BigInt(0);
    for (let i = 31; i >= 0; i--) {
        n = (n << BigInt(8)) | BigInt(bytes[i]);
    }
    return n;
}

/** Convert a hex string to BN254 field element. */
export function hexToField(hex: string): bigint {
    const clean = hex.replace(/^0x/, "");
    return toFieldElement(BigInt("0x" + (clean || "0")));
}

/** Convert a field element to a 0x-prefixed 64-char hex string. */
export function fieldToHex(n: bigint): string {
    return "0x" + toFieldElement(n).toString(16).padStart(64, "0");
}
