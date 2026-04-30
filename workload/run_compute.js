// workload/run_compute.js
// Civitas nilCC Workload — Confidential Payroll Computation v3 (Solana build)
// Runs inside Nillion's SEV-SNP enclave via nilCC
//
// IMPORTANT: Now uses BN254 Poseidon (poseidon-lite) to match the Noir circuit
// and Solana on-chain Anchor program. All commitments, nullifiers, and the
// Merkle root are BN254 field elements — NOT Starknet felt252.
//
// Output fields added/changed for Solana:
//   - run_id, epoch, merkle_root (bytes32 hex), commitment_count
//   - vouchers[]: commitment, employee_tag, epoch, voucher_nonce, run_id, status
//   - total_amount: bigint (for employer treasury check only — not in events)
//   - attestation: { workload, run_id, merkle_root, commitment_count, enclave }

"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = 80;
const CVM_FILES_DIR = "/media/cvm-agent-entrypoint/files";
const FILES_DIR = process.env.FILES_DIR || CVM_FILES_DIR;
const INPUT_DIR = process.env.INPUT_DIR || FILES_DIR;
const OUTPUT_DIR = process.env.OUTPUT_DIR || "/outputs";
const TREE_DEPTH = 20;

// nilDB configuration (optional — falls back to file I/O in tests)
const NILLION_ORG_KEY = process.env.NILLION_ORG_SECRET_KEY || "";

// In-memory result store
let computeResult = null;
let computeError = null;
let computeStatus = "pending"; // pending | computing | done | error

// ── BN254 Poseidon (matches Noir circuit + on-chain solana-poseidon syscall
// + frontend lib/bn128-poseidon.ts). MUST use the per-arity functions:
// poseidon-lite v0.3+ removed the generic `poseidon(inputs)` dispatcher,
// and using a missing function silently produces wrong hashes.

let poseidon1Fn, poseidon2Fn, poseidon3Fn, poseidon4Fn;

async function loadBN254Poseidon() {
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

function bn254Hash1(a) {
  return poseidon1Fn([BigInt(a)]);
}

function bn254Hash2(a, b) {
  return poseidon2Fn([BigInt(a), BigInt(b)]);
}

function bn254Hash3(a, b, c) {
  return poseidon3Fn([BigInt(a), BigInt(b), BigInt(c)]);
}

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

// ── Commitments & Nullifiers ────────────────────────────────────────────────

/**
 * Compute a voucher commitment matching the Noir circuit.
 * commitment = BN254_Poseidon(employee_tag, amount, epoch, voucher_nonce)
 */
function computeCommitment(employeeTag, amount, epoch, voucherNonce) {
  return bn254Hash4(
    parseBigIntSafe(employeeTag),
    BigInt(amount),
    BigInt(epoch),
    BigInt(voucherNonce)
  );
}

/**
 * Derive employee_tag from credential_nonce.
 * employee_tag = BN254_Poseidon(credential_nonce)
 * NOTE: In the TEE we only have employee_tag (safe to expose), not the nonce.
 */
function deriveTag(credentialNonce) {
  return bn254Hash1(parseBigIntSafe(credentialNonce));
}

// ── Merkle Tree (BN254 Poseidon) ─────────────────────────────────────────────

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

/** Get Merkle proof (path + indices) for leaf at `index`. */
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

// ── bytes32 helper ───────────────────────────────────────────────────────────

function toBytes32Hex(bigintVal) {
  return "0x" + bigintVal.toString(16).padStart(64, "0");
}

// ── nilDB Integration ────────────────────────────────────────────────────────
// V3: NilDB writes happen exclusively in the orchestrator (after fetching
// /result), not from within the TEE workload. This keeps the workload
// dependency-light, fast to build, and version-pinned to the orchestrator's
// @nillion/secretvaults version. The TEE attestation still covers the
// computation (Merkle tree + commitments), which is what matters
// cryptographically. No NilDB write from inside the enclave.

async function writeToNilDB(_companyId, _vouchers, _runId, _epoch, _merkleRoot, _totalAmount) {
  return false;
}

// ── Main Computation ─────────────────────────────────────────────────────────

async function runComputation() {
  computeStatus = "computing";
  console.log("[nilCC] Civitas payroll workload v3 (Solana) starting");
  console.log("[nilCC] Poseidon: poseidon-lite BN254 (matches Noir + light-poseidon on-chain)");

  await loadBN254Poseidon();

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Load manifest from env or file
  let manifest;
  if (process.env.PAYROLL_MANIFEST) {
    manifest = JSON.parse(process.env.PAYROLL_MANIFEST);
  } else {
    const possiblePaths = [
      path.join(CVM_FILES_DIR, "manifest.json"),
      path.join(INPUT_DIR, "manifest.json"),
      "/files/manifest.json",
      "/inputs/manifest.json",
    ];
    let manifestPath = null;
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) { manifestPath = p; break; }
    }
    if (!manifestPath) {
      throw new Error(`manifest.json not found. Searched: ${possiblePaths.join(", ")}`);
    }
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  }

  const { run_id, epoch, employees, company_id } = manifest;
  const companyId = company_id || "default";

  console.log(`[nilCC] Run ID: ${run_id}`);
  console.log(`[nilCC] Epoch: ${epoch}`);
  console.log(`[nilCC] Employees: ${employees.length}`);

  const zeroHashes = computeZeroHashes();

  // ── Per-employee commitment generation ──────────────────────────────────
  const commitments = [];
  const vouchers = [];
  let totalAmount = BigInt(0);

  for (const emp of employees) {
    // employee_tag is pre-hashed before entering TEE (nonce stays in browser)
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

    console.log(`[nilCC] ✓ Processed employee tag: ${employeeTag.toString().slice(0, 16)}...`);
  }

  // ── Build Merkle tree ────────────────────────────────────────────────────
  console.log("[nilCC] Building BN254 Poseidon Merkle tree...");
  const tree = buildMerkleTree(commitments, zeroHashes);
  const merkleRoot = tree.root.toString();
  const merkleRootHex = toBytes32Hex(tree.root);

  console.log(`[nilCC] Merkle root (field): ${merkleRoot.slice(0, 32)}...`);
  console.log(`[nilCC] Merkle root (hex):   ${merkleRootHex.slice(0, 34)}...`);

  // Annotate vouchers with their Merkle proofs
  for (const v of vouchers) {
    const proofData = getMerkleProof(tree.layers, v.leaf_index, zeroHashes);
    v.merkle_proof = proofData;
  }

  // ── Write to nilDB (Solana schema) ───────────────────────────────────────
  const nildbWritten = await writeToNilDB(
    companyId,
    vouchers,
    run_id,
    epoch,
    merkleRootHex,
    totalAmount
  );

  // ── Build result ─────────────────────────────────────────────────────────
  const output = {
    run_id,
    epoch: epoch.toString(),
    merkle_root: merkleRootHex,         // bytes32 hex for Anchor program
    merkle_root_field: merkleRoot,      // decimal field string for Noir circuit
    commitments: commitments.map((c) => c.toString()),
    commitment_count: commitments.length,
    total_amount: totalAmount.toString(), // employer treasury view only — never emitted
    nildb_synced: nildbWritten,
    processed_at: new Date().toISOString(),
    vouchers,
    attestation: {
      workload: "civitas-payroll-v3",
      run_id,
      timestamp: new Date().toISOString(),
      merkle_root: merkleRootHex,
      commitment_count: commitments.length,
      nildb_synced: nildbWritten,
      enclave: {
        type: "SEV-SNP",
        measurement: crypto
          .createHash("sha256")
          .update(
            JSON.stringify({
              run_id,
              merkle_root: merkleRootHex,
              commitment_count: commitments.length,
            })
          )
          .digest("hex"),
      },
    },
  };

  // Write outputs for recovery
  fs.writeFileSync(path.join(OUTPUT_DIR, "payroll_output.json"), JSON.stringify(output, null, 2));
  fs.writeFileSync(path.join(OUTPUT_DIR, "vouchers.json"), JSON.stringify(vouchers, null, 2));

  console.log("[nilCC] ✓ Computation complete");
  return output;
}

// ── HTTP Server ──────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === "/" || req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ service: "civitas-payroll-v3", status: computeStatus }));
    return;
  }

  if (req.url === "/result" || req.url === "/api/result") {
    res.writeHead(200, { "Content-Type": "application/json" });
    if (computeStatus === "done" && computeResult) {
      res.end(JSON.stringify({ status: "done", data: computeResult }));
    } else if (computeStatus === "error") {
      res.end(JSON.stringify({ status: "error", error: computeError }));
    } else {
      res.end(JSON.stringify({ status: computeStatus }));
    }
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[nilCC] HTTP server listening on port ${PORT}`);
  runComputation()
    .then((result) => {
      computeResult = result;
      computeStatus = "done";
      console.log("[nilCC] ✓ Result available at GET /result");
    })
    .catch((err) => {
      computeError = err.message;
      computeStatus = "error";
      console.error("[nilCC] Computation failed:", err);
    });
});
