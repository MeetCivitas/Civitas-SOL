// workload/run_compute.js
// Civitas nilCC Workload — Confidential Payroll Computation v3 (Solana build)
// Runs inside Nillion's SEV-SNP enclave via nilCC.
//
// V4 lifecycle: pure compute function. The HTTP server lives in server.js
// and calls computePayroll(manifest) per request. No env reads, no boot-time
// auto-run, no in-module state — manifest is passed in, result is returned.
//
// Hashing: BN254 Poseidon (poseidon-lite) — matches Noir circuit + on-chain
// solana-poseidon syscall + frontend lib/bn128-poseidon.ts.

"use strict";

const crypto = require("crypto");

const TREE_DEPTH = 20;

let poseidon1Fn, poseidon2Fn, poseidon3Fn, poseidon4Fn;

async function loadBN254Poseidon() {
  if (poseidon1Fn && poseidon2Fn && poseidon3Fn && poseidon4Fn) return;
  const mod = await import("poseidon-lite");
  poseidon1Fn = mod.poseidon1;
  poseidon2Fn = mod.poseidon2;
  poseidon3Fn = mod.poseidon3;
  poseidon4Fn = mod.poseidon4;
  for (const [name, fn] of Object.entries({
    poseidon1: poseidon1Fn,
    poseidon2: poseidon2Fn,
    poseidon3: poseidon3Fn,
    poseidon4: poseidon4Fn,
  })) {
    if (typeof fn !== "function") {
      throw new Error(
        `poseidon-lite is missing ${name} — workload would compute mismatched ` +
        `hashes vs the frontend prover. Bump poseidon-lite to a version that ` +
        `exports poseidon1/2/3/4.`,
      );
    }
  }
}

function bn254Hash1(a) { return poseidon1Fn([BigInt(a)]); }
function bn254Hash2(a, b) { return poseidon2Fn([BigInt(a), BigInt(b)]); }
function bn254Hash4(a, b, c, d) {
  return poseidon4Fn([BigInt(a), BigInt(b), BigInt(c), BigInt(d)]);
}

function parseBigIntSafe(val) {
  if (typeof val === "bigint") return val;
  try {
    const s = String(val);
    return BigInt(s.startsWith("0x") ? s : s);
  } catch {
    try {
      const cleaned = String(val).replace(/[^0-9a-fA-F]/g, "") || "0";
      return BigInt("0x" + cleaned);
    } catch {
      return BigInt(0);
    }
  }
}

function computeCommitment(employeeTag, amount, epoch, voucherNonce) {
  return bn254Hash4(
    parseBigIntSafe(employeeTag),
    BigInt(amount),
    BigInt(epoch),
    BigInt(voucherNonce),
  );
}

function computeZeroHashes() {
  const zeros = [BigInt(0)];
  for (let i = 0; i < TREE_DEPTH; i++) {
    zeros.push(bn254Hash2(zeros[i], zeros[i]));
  }
  return zeros;
}

function buildMerkleTree(leaves, zeroHashes) {
  const layers = [[...leaves.map((l) => BigInt(l))]];
  for (let level = 0; level < TREE_DEPTH; level++) {
    const currentLayer = layers[level];
    const nextLayer = [];
    for (let i = 0; i < currentLayer.length; i += 2) {
      const left = currentLayer[i];
      const right =
        i + 1 < currentLayer.length ? currentLayer[i + 1] : zeroHashes[level];
      nextLayer.push(bn254Hash2(left, right));
    }
    if (nextLayer.length === 0) nextLayer.push(zeroHashes[level + 1]);
    layers.push(nextLayer);
  }
  return { root: layers[layers.length - 1][0], layers };
}

function getMerkleProof(layers, index, zeroHashes) {
  const path = [];
  const indices = [];
  let currentIndex = index;
  for (let level = 0; level < TREE_DEPTH; level++) {
    const layerSize = layers[level]?.length || 0;
    const isRight = currentIndex % 2 === 1;
    const siblingIndex = isRight ? currentIndex - 1 : currentIndex + 1;
    if (siblingIndex < layerSize) {
      path.push(layers[level][siblingIndex].toString());
    } else {
      path.push(zeroHashes[level].toString());
    }
    indices.push(isRight ? 1 : 0);
    currentIndex = Math.floor(currentIndex / 2);
  }
  return { path, indices };
}

function toBytes32Hex(bigintVal) {
  return "0x" + bigintVal.toString(16).padStart(64, "0");
}

/**
 * Compute payroll commitments + Merkle tree from a manifest.
 * Pure function: takes a manifest, returns the result. No I/O outside the
 * call — caller is responsible for persisting to nilDB.
 *
 * Buffers holding salaries / nonces are local to this function's scope and
 * become eligible for GC the moment the call returns; server.js additionally
 * zeroizes the response object's sensitive fields before discarding.
 *
 * @param {{run_id: string, epoch: string|number, employees: Array<{employee_tag: string, salary: string|number}>, company_id?: string}} manifest
 * @returns {Promise<object>} payroll output (run_id, merkle_root, commitments, vouchers, attestation, …)
 */
async function computePayroll(manifest) {
  await loadBN254Poseidon();

  const { run_id, epoch, employees, company_id } = manifest;
  if (!run_id) throw new Error("manifest.run_id required");
  if (epoch === undefined || epoch === null) throw new Error("manifest.epoch required");
  if (!Array.isArray(employees)) throw new Error("manifest.employees must be an array");

  const companyId = company_id || "default";

  const zeroHashes = computeZeroHashes();
  const commitments = [];
  const vouchers = [];
  let totalAmount = BigInt(0);

  for (const emp of employees) {
    const employeeTag = parseBigIntSafe(emp.employee_tag);
    const salary = BigInt(emp.salary);
    const voucherNonce = BigInt("0x" + crypto.randomBytes(16).toString("hex"));

    const commitment = computeCommitment(employeeTag, salary, epoch, voucherNonce);
    commitments.push(commitment);
    totalAmount += salary;

    vouchers.push({
      employee_tag: employeeTag.toString(),
      amount: salary.toString(),
      epoch: epoch.toString(),
      voucher_nonce: voucherNonce.toString(),
      commitment: commitment.toString(),
      leaf_index: vouchers.length,
      run_id,
    });
  }

  const tree = buildMerkleTree(commitments, zeroHashes);
  const merkleRoot = tree.root.toString();
  const merkleRootHex = toBytes32Hex(tree.root);

  for (const v of vouchers) {
    v.merkle_proof = getMerkleProof(tree.layers, v.leaf_index, zeroHashes);
  }

  return {
    run_id,
    epoch: epoch.toString(),
    company_id: companyId,
    merkle_root: merkleRootHex,
    merkle_root_field: merkleRoot,
    commitments: commitments.map((c) => c.toString()),
    commitment_count: commitments.length,
    total_amount: totalAmount.toString(),
    nildb_synced: false, // V3+: orchestrator persists, not the TEE
    processed_at: new Date().toISOString(),
    vouchers,
    attestation: {
      workload: "civitas-payroll-v4",
      run_id,
      timestamp: new Date().toISOString(),
      merkle_root: merkleRootHex,
      commitment_count: commitments.length,
      enclave: { type: "SEV-SNP" },
      // Per-request fresh attestation report is added by server.js
      // (GET /attestation?nonce=…) so this stub stays unsigned.
    },
  };
}

module.exports = { computePayroll };
