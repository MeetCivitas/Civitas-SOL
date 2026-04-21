#!/usr/bin/env npx tsx
// scripts/test-voucher-claim.ts
// End-to-end test of the Civitas voucher claiming data pipeline.
// Run with: npx tsx scripts/test-voucher-claim.ts

import {
    generateCredentialNonce,
    deriveEmployeeTag,
    computeCommitment,
    computeNullifier,
    computeRecipientHash,
} from "../lib/identity";
import { MerkleTree, TREE_DEPTH } from "../lib/merkle-tree";
import {
    bn128Poseidon1,
    bn128Poseidon2,
    bn128Poseidon3,
    bn128Poseidon4,
    toFieldElement,
    BN254_PRIME,
} from "../lib/bn128-poseidon";

// ── Helpers ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
    if (condition) {
        console.log(`  ✅ ${message}`);
        passed++;
    } else {
        console.error(`  ❌ FAIL: ${message}`);
        failed++;
    }
}

function section(name: string) {
    console.log(`\n${"═".repeat(60)}`);
    console.log(`  ${name}`);
    console.log(`${"═".repeat(60)}`);
}

// ── Test Parameters ─────────────────────────────────────────────────────

const EMPLOYEE_COUNT = 3;
const EPOCH = BigInt(202602);
const RECIPIENT_ADDRESS = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";

// ── Test 1: Credential Generation ───────────────────────────────────────

section("1. Credential Generation");

const credentials = Array.from({ length: EMPLOYEE_COUNT }, () => {
    const nonce = generateCredentialNonce();
    const tag = deriveEmployeeTag(nonce);
    return { nonce, tag };
});

for (let i = 0; i < EMPLOYEE_COUNT; i++) {
    const { nonce, tag } = credentials[i];
    assert(nonce.length === 64, `Credential ${i}: nonce is 64 hex chars (${nonce.length})`);
    assert(tag.length > 0, `Credential ${i}: employee_tag is non-empty`);
    assert(tag === deriveEmployeeTag(nonce), `Credential ${i}: tag is deterministic`);
    console.log(`    nonce: ${nonce.slice(0, 16)}...  tag: ${tag.slice(0, 20)}...`);
}

// ── Test 2: Commitment Computation (StarkNet Poseidon) ──────────────────

section("2. Commitment Computation (StarkNet Poseidon — on-chain)");

const salaries = [BigInt(1000), BigInt(2500), BigInt(750)];
const voucherNonces = [BigInt(1), BigInt(2), BigInt(3)];

const commitments: string[] = [];
for (let i = 0; i < EMPLOYEE_COUNT; i++) {
    const commitment = computeCommitment(
        credentials[i].tag,
        salaries[i],
        EPOCH,
        voucherNonces[i]
    );
    commitments.push(commitment);
    assert(BigInt(commitment) > BigInt(0), `Commitment ${i}: non-zero value`);
    console.log(`    commitment[${i}]: ${commitment.slice(0, 30)}...`);
}

// Verify determinism
const commitCheck = computeCommitment(
    credentials[0].tag,
    salaries[0],
    EPOCH,
    voucherNonces[0]
);
assert(commitCheck === commitments[0], "Commitment computation is deterministic");

// ── Test 3: Nullifier Computation ───────────────────────────────────────

section("3. Nullifier Computation (StarkNet Poseidon — on-chain)");

const nullifiers: string[] = [];
for (let i = 0; i < EMPLOYEE_COUNT; i++) {
    const nullifier = computeNullifier(
        credentials[i].nonce,
        EPOCH,
        voucherNonces[i]
    );
    nullifiers.push(nullifier);
    assert(BigInt(nullifier) > BigInt(0), `Nullifier ${i}: non-zero value`);
    console.log(`    nullifier[${i}]: ${nullifier.slice(0, 30)}...`);
}

// Different employees → different nullifiers
assert(nullifiers[0] !== nullifiers[1], "Different credentials produce different nullifiers");

// Same credential, different voucher_nonce → different nullifier
const nullCheck = computeNullifier(credentials[0].nonce, EPOCH, BigInt(999));
assert(nullCheck !== nullifiers[0], "Different voucher_nonce produces different nullifier");

// ── Test 4: Recipient Hash ──────────────────────────────────────────────

section("4. Recipient Hash");

const recipientHash = computeRecipientHash(RECIPIENT_ADDRESS);
assert(BigInt(recipientHash) > BigInt(0), "Recipient hash is non-zero");
assert(
    recipientHash === computeRecipientHash(RECIPIENT_ADDRESS),
    "Recipient hash is deterministic"
);
console.log(`    recipient_hash: ${recipientHash.slice(0, 30)}...`);

// ── Test 5: Merkle Tree (StarkNet Poseidon — on-chain) ──────────────────

section("5. Merkle Tree (StarkNet Poseidon — on-chain)");

const merkleTree = new MerkleTree(commitments.map((c) => BigInt(c)));

assert(merkleTree.size === EMPLOYEE_COUNT, `Tree has ${EMPLOYEE_COUNT} leaves`);
assert(merkleTree.root !== BigInt(0), "Root is non-zero");
console.log(`    root: ${merkleTree.root.toString().slice(0, 30)}...`);
console.log(`    depth: ${TREE_DEPTH}`);

// Verify each leaf's Merkle proof
for (let i = 0; i < EMPLOYEE_COUNT; i++) {
    const { path, indices } = merkleTree.getProof(i);
    assert(path.length === TREE_DEPTH, `Proof[${i}]: path has ${TREE_DEPTH} elements`);
    assert(indices.length === TREE_DEPTH, `Proof[${i}]: indices has ${TREE_DEPTH} elements`);

    const verified = merkleTree.verifyProof(BigInt(commitments[i]), path, indices);
    assert(verified, `Proof[${i}]: Merkle proof verifies correctly`);
}

// ── Test 6: BN128 Poseidon (for ZK circuit) ─────────────────────────────

section("6. BN128 Poseidon (circom circuit field)");

const nonceBigInt = toFieldElement(BigInt("0x" + credentials[0].nonce));
assert(nonceBigInt < BN254_PRIME, "Credential nonce fits in BN128 field");

const bn128Tag = bn128Poseidon1(nonceBigInt);
assert(bn128Tag > BigInt(0), "BN128 employee_tag is non-zero");
assert(bn128Tag < BN254_PRIME, "BN128 employee_tag is within field");
console.log(`    BN128 tag:     ${bn128Tag.toString().slice(0, 30)}...`);
console.log(`    StarkNet tag:  ${credentials[0].tag.slice(0, 30)}...`);
assert(
    bn128Tag.toString() !== credentials[0].tag,
    "BN128 and StarkNet Poseidon produce different tags (expected — different fields)"
);

const bn128Commitment = bn128Poseidon4(
    bn128Tag,
    salaries[0],
    EPOCH,
    voucherNonces[0]
);
assert(bn128Commitment > BigInt(0), "BN128 commitment is non-zero");
console.log(`    BN128 commitment: ${bn128Commitment.toString().slice(0, 30)}...`);

const bn128Nullifier = bn128Poseidon3(nonceBigInt, EPOCH, voucherNonces[0]);
assert(bn128Nullifier > BigInt(0), "BN128 nullifier is non-zero");
console.log(`    BN128 nullifier:  ${bn128Nullifier.toString().slice(0, 30)}...`);

// ── Test 7: BN128 Merkle Tree (for ZK circuit) ─────────────────────────

section("7. BN128 Merkle Tree (for ZK circuit)");

// Build BN128 commitments for all employees
const bn128Commitments: bigint[] = [];
for (let i = 0; i < EMPLOYEE_COUNT; i++) {
    const ni = toFieldElement(BigInt("0x" + credentials[i].nonce));
    const ti = bn128Poseidon1(ni);
    const ci = bn128Poseidon4(ti, salaries[i], EPOCH, voucherNonces[i]);
    bn128Commitments.push(ci);
}

// Build BN128 Merkle tree manually (mirrors zk-proof.ts logic)
const ZK_EMPTY = BigInt(0);
function computeZkZeros(): bigint[] {
    const z = [ZK_EMPTY];
    for (let i = 0; i < TREE_DEPTH; i++) z.push(bn128Poseidon2(z[i], z[i]));
    return z;
}
const zkZeros = computeZkZeros();

function buildBn128Tree(leaves: bigint[]): { root: bigint; layers: bigint[][] } {
    const layers: bigint[][] = [[...leaves]];
    for (let level = 0; level < TREE_DEPTH; level++) {
        const cur = layers[level];
        const next: bigint[] = [];
        for (let j = 0; j < cur.length; j += 2) {
            const left = cur[j];
            const right = j + 1 < cur.length ? cur[j + 1] : zkZeros[level];
            next.push(bn128Poseidon2(left, right));
        }
        if (next.length === 0 && level < TREE_DEPTH - 1) next.push(zkZeros[level + 1]);
        layers.push(next);
    }
    return { root: layers[TREE_DEPTH]?.[0] || zkZeros[TREE_DEPTH], layers };
}

const bn128Tree = buildBn128Tree(bn128Commitments);
assert(bn128Tree.root > BigInt(0), "BN128 Merkle root is non-zero");
assert(bn128Tree.root < BN254_PRIME, "BN128 Merkle root is within field");
console.log(`    BN128 root: ${bn128Tree.root.toString().slice(0, 30)}...`);

// Verify BN128 Merkle proof for first leaf
function getBn128Proof(layers: bigint[][], index: number) {
    const path: bigint[] = [];
    const indices: bigint[] = [];
    let ci = index;
    for (let level = 0; level < TREE_DEPTH; level++) {
        const lSize = layers[level]?.length || 0;
        const isR = ci % 2 === 1;
        const sib = isR ? ci - 1 : ci + 1;
        path.push(sib < lSize ? layers[level][sib] : zkZeros[level]);
        indices.push(isR ? BigInt(1) : BigInt(0));
        ci = Math.floor(ci / 2);
    }
    return { path, indices };
}

const bn128Proof = getBn128Proof(bn128Tree.layers, 0);
// Manually verify: walk up the tree
let current = bn128Commitments[0];
for (let i = 0; i < TREE_DEPTH; i++) {
    if (bn128Proof.indices[i] === BigInt(0)) {
        current = bn128Poseidon2(current, bn128Proof.path[i]);
    } else {
        current = bn128Poseidon2(bn128Proof.path[i], current);
    }
}
assert(current === bn128Tree.root, "BN128 Merkle proof verifies for leaf 0");

// ── Test 8: Full Claim Data Pipeline ────────────────────────────────────

section("8. Full Claim Data Pipeline");

console.log("  Simulating employee 0 claiming voucher...");
const claimEmployee = 0;

// On-chain values (StarkNet Poseidon)
const onchainNullifier = nullifiers[claimEmployee];
const onchainCommitment = commitments[claimEmployee];
const { path: onchainPath, indices: onchainIndices } = merkleTree.getProof(claimEmployee);
const onchainAmount = salaries[claimEmployee] * BigInt(10 ** 18);

assert(
    onchainPath.every((p) => typeof p === "bigint"),
    "On-chain Merkle path elements are bigints"
);
assert(
    onchainIndices.every((i) => i === BigInt(0) || i === BigInt(1)),
    "On-chain Merkle indices are binary"
);

// ZK proof values (BN128 Poseidon)
const zkNullifier = bn128Poseidon3(
    toFieldElement(BigInt("0x" + credentials[claimEmployee].nonce)),
    EPOCH,
    voucherNonces[claimEmployee]
);
const zkCommitment = bn128Commitments[claimEmployee];
const zkMerkleRoot = bn128Tree.root;
const zkRecipientHash = bn128Poseidon1(toFieldElement(BigInt(RECIPIENT_ADDRESS)));

assert(zkNullifier > BigInt(0), "ZK nullifier computed");
assert(zkCommitment > BigInt(0), "ZK commitment computed");
assert(zkMerkleRoot > BigInt(0), "ZK Merkle root computed");
assert(zkRecipientHash > BigInt(0), "ZK recipient hash computed");

console.log("\n  Contract call parameters (StarkNet Poseidon):");
console.log(`    nullifier:     ${onchainNullifier.slice(0, 30)}...`);
console.log(`    commitment:    ${onchainCommitment.slice(0, 30)}...`);
console.log(`    amount (wei):  ${onchainAmount}`);
console.log(`    merkle_path:   [${onchainPath.length} elements]`);

console.log("\n  ZK proof inputs (BN128 Poseidon):");
console.log(`    nullifier:     ${zkNullifier.toString().slice(0, 30)}...`);
console.log(`    commitment:    ${zkCommitment.toString().slice(0, 30)}...`);
console.log(`    merkle_root:   ${zkMerkleRoot.toString().slice(0, 30)}...`);
console.log(`    recipient_hash: ${zkRecipientHash.toString().slice(0, 30)}...`);

// All values should be within BN128 field
assert(zkNullifier < BN254_PRIME, "ZK nullifier within BN128 field");
assert(zkCommitment < BN254_PRIME, "ZK commitment within BN128 field");
assert(zkMerkleRoot < BN254_PRIME, "ZK Merkle root within BN128 field");
assert(zkRecipientHash < BN254_PRIME, "ZK recipient hash within BN128 field");

// Circuit input shape check
const circuitInput = {
    nullifier: zkNullifier.toString(),
    merkle_root: zkMerkleRoot.toString(),
    commitment: zkCommitment.toString(),
    amount: salaries[claimEmployee].toString(),
    recipient_hash: zkRecipientHash.toString(),
    credential_nonce: toFieldElement(BigInt("0x" + credentials[claimEmployee].nonce)).toString(),
    epoch: EPOCH.toString(),
    voucher_nonce: voucherNonces[claimEmployee].toString(),
    merkle_path: bn128Proof.path.map((p) => p.toString()),
    merkle_indices: bn128Proof.indices.map((i) => i.toString()),
};

assert(typeof circuitInput.nullifier === "string", "Circuit input nullifier is string");
assert(typeof circuitInput.merkle_root === "string", "Circuit input merkle_root is string");
assert(typeof circuitInput.commitment === "string", "Circuit input commitment is string");
assert(typeof circuitInput.amount === "string", "Circuit input amount is string");
assert(typeof circuitInput.recipient_hash === "string", "Circuit input recipient_hash is string");
assert(typeof circuitInput.credential_nonce === "string", "Circuit input credential_nonce is string");
assert(typeof circuitInput.epoch === "string", "Circuit input epoch is string");
assert(typeof circuitInput.voucher_nonce === "string", "Circuit input voucher_nonce is string");
assert(circuitInput.merkle_path.length === TREE_DEPTH, `Circuit input merkle_path has ${TREE_DEPTH} elements`);
assert(circuitInput.merkle_indices.length === TREE_DEPTH, `Circuit input merkle_indices has ${TREE_DEPTH} elements`);

// ── Summary ─────────────────────────────────────────────────────────────

section("Summary");
console.log(`  ✅ Passed: ${passed}`);
if (failed > 0) {
    console.log(`  ❌ Failed: ${failed}`);
    process.exit(1);
} else {
    console.log(`  🎉 All tests passed!`);
    process.exit(0);
}
