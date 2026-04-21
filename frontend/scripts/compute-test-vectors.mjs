#!/usr/bin/env node
/**
 * scripts/compute-test-vectors.mjs
 * Compute accurate BN254 Poseidon test vectors for Prover.toml.
 *
 * Run with: node scripts/compute-test-vectors.mjs
 * Requires: poseidon-lite (already in frontend/package.json)
 *
 * Outputs:
 *   - The exact Prover.toml values for the test credential
 *   - merkle_root (single-leaf tree with depth 20, index 0)
 *   - nullifier and commitment field values
 */

import { poseidon1, poseidon2, poseidon3, poseidon4 } from "poseidon-lite";

const TREE_DEPTH = 20;

// Test vectors (matching the existing Prover.toml placeholders)
const CREDENTIAL_NONCE = 12345n;
const VOUCHER_NONCE = 67890n;
const AMOUNT = 1_000_000n;
const EPOCH = 1_745_000_000n;
const RECIPIENT_HASH = 11_259_375n; // 0xABCDEF
const TOKEN_ACCOUNT_HASH = 19_088_743n; // 0x123456789... truncated
const DOMAIN_TAG_HASH = 3_735_928_559n; // 0xDEADBEEF

// Step 1: employee_tag = Poseidon(credential_nonce)
const employeeTag = poseidon1([CREDENTIAL_NONCE]);
console.log("\n=== BN254 Poseidon Test Vectors for Prover.toml ===\n");
console.log("employee_tag (private):", employeeTag.toString());

// Step 2: commitment = Poseidon(employee_tag, amount, epoch, voucher_nonce)
const commitment = poseidon4([employeeTag, AMOUNT, EPOCH, VOUCHER_NONCE]);
console.log("commitment (leaf):", commitment.toString());

// Step 3: nullifier = Poseidon(credential_nonce, epoch, voucher_nonce)
const nullifier = poseidon3([CREDENTIAL_NONCE, EPOCH, VOUCHER_NONCE]);
console.log("nullifier:", nullifier.toString());

// Step 4: Build depth-20 Merkle tree (leaf at index 0, all siblings are zero hashes)
const zeroHashes = [0n];
for (let i = 0; i < TREE_DEPTH; i++) {
  zeroHashes.push(poseidon2([zeroHashes[i], zeroHashes[i]]));
}

let current = commitment;
let index = 0;
for (let i = 0; i < TREE_DEPTH; i++) {
  const isRight = (index & 1) === 1;
  current = isRight
    ? poseidon2([zeroHashes[i], current])
    : poseidon2([current, zeroHashes[i]]);
  index >>= 1;
}
const merkleRoot = current;
console.log("merkle_root:", merkleRoot.toString());

// Step 5: Print Prover.toml
console.log("\n=== Paste this into circuits/voucher_noir/Prover.toml ===\n");
console.log(`# Private inputs`);
console.log(`credential_nonce = "${CREDENTIAL_NONCE}"`);
console.log(`voucher_nonce = "${VOUCHER_NONCE}"`);
console.log(`path_index = "0"`);
console.log(`merkle_path = [`);
for (let i = 0; i < TREE_DEPTH; i++) {
  console.log(`  "${zeroHashes[i]}"${i < TREE_DEPTH - 1 ? "," : ""}`);
}
console.log(`]`);
console.log(`\n# Public inputs`);
console.log(`merkle_root = "${merkleRoot}"`);
console.log(`nullifier = "${nullifier}"`);
console.log(`recipient_hash = "${RECIPIENT_HASH}"`);
console.log(`amount = "${AMOUNT}"`);
console.log(`epoch = "${EPOCH}"`);
console.log(`token_account_hash = "${TOKEN_ACCOUNT_HASH}"`);
console.log(`domain_tag_hash = "${DOMAIN_TAG_HASH}"`);

console.log("\n=== Done! ===\n");
