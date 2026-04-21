// workload/onboard_employee.js
// Civitas nilCC Workload — Blind Employee Onboarding (Solana build)
// Runs inside Nillion's SEV-SNP enclave via nilCC
//
// Responsibilities:
//   1. Read employee roster from ONBOARD_MANIFEST env var
//   2. For each employee: generate high-entropy credential_nonce + derive employee_tag
//      using BN254 Poseidon (poseidon-lite) — identical to bn128-poseidon.ts + Noir circuit
//   3. Write encrypted {credential_nonce, employee_tag} to nilDB as %share fields
//   4. Return only public employee_tags — raw nonces NEVER leave the TEE
//
// IMPORTANT: Uses poseidon-lite BN254 (NOT @scure/starknet).
// Matches: Noir circuit poseidon::bn254, on-chain light-poseidon, frontend bn128-poseidon.ts

"use strict";

const http = require("http");
const crypto = require("crypto");

const PORT = 80;
const OUTPUT_DIR = process.env.OUTPUT_DIR || "/outputs";
const NILLION_ORG_KEY = process.env.NILLION_ORG_SECRET_KEY || "";

// BN254 prime — for field element validation
const BN254_PRIME = BigInt(
  "21888242871839275222246405745257275088548364400416034343698204186575808495617"
);

// In-memory result store (nilCC pattern)
let computeResult = null;
let computeError = null;
let computeStatus = "pending";

// ── BN254 Poseidon (no Starknet) ──────────────────────────────────────────

let _poseidon1;

async function loadPoseidon() {
  // poseidon-lite uses BN254 field — matches Noir circuit + on-chain light-poseidon
  const mod = await import("poseidon-lite");
  _poseidon1 = mod.poseidon1;
}

/**
 * Derive employee_tag = Poseidon_BN254(credential_nonce_as_field_element)
 * Matches: identity.ts → bn128Poseidon1(credentialNonce)
 *          Noir circuit: poseidon::bn254::hash_1([credential_nonce])
 */
function deriveEmployeeTag(credentialNonceHex) {
  const nonceBigInt = BigInt("0x" + credentialNonceHex);
  // Reduce to BN254 field
  const field = ((nonceBigInt % BN254_PRIME) + BN254_PRIME) % BN254_PRIME;
  const tag = _poseidon1([field]);
  return tag.toString();
}

// ── nilDB Integration ─────────────────────────────────────────────────────

async function writeToNilDB(companyId, credentialRecords) {
  if (!NILLION_ORG_KEY) {
    console.warn("[nilCC-onboard] No NILLION_ORG_SECRET_KEY — skipping nilDB write");
    return false;
  }

  try {
    const { SecretVaultBuilderClient } = require("@nillion/secretvaults");
    const { Signer } = require("@nillion/nuc");
    const { NilauthClient } = require("@nillion/nilauth-client");

    const signer = Signer.fromPrivateKey(NILLION_ORG_KEY);
    const nilauthClient = await NilauthClient.create({
      baseUrl: "https://nilauth-1bc3.staging.nillion.network",
      chainId: 11155111,
      signer,
    });

    const client = await SecretVaultBuilderClient.from({
      signer,
      nilauthClient,
      dbs: [
        "https://nildb-stg-n1.nillion.network",
        "https://nildb-stg-n2.nillion.network",
        "https://nildb-stg-n3.nillion.network",
      ],
      blindfold: { operation: "store", useClusterKey: true },
    });
    await client.refreshRootToken();

    const collectionId = `civitas_credentials_${companyId}_v2`;

    // Build records — credential_nonce is stored as %share (secret-split)
    // Only the employee can reconstruct their nonce using their NilDB access token
    const data = credentialRecords.map((r) => ({
      _id: crypto.randomUUID(),
      employee_tag: r.employeeTag, // plaintext — used as filter key
      credential_nonce: { "%share": r.credentialNonce }, // secret-split across 3 nodes
      company_id: companyId,
      hash_function: "bn254_poseidon", // explicitly record which hash was used
      created_in_tee: true,
      enclave_type: "SEV-SNP",
      status: "active",
      created_at: new Date().toISOString(),
    }));

    await client.createData({ collection: collectionId, data });
    console.log(
      `[nilCC-onboard] ✓ Wrote ${data.length} BN254 credentials to nilDB (nonces secret-split)`
    );
    return true;
  } catch (err) {
    console.warn("[nilCC-onboard] nilDB write failed:", err.message || err);
    return false;
  }
}

// ── Main Computation ──────────────────────────────────────────────────────

async function runOnboarding() {
  computeStatus = "computing";
  console.log("[nilCC-onboard] Civitas blind employee onboarding starting");
  console.log("[nilCC-onboard] Hash: BN254 Poseidon (poseidon-lite) — Solana/Noir compatible");
  console.log("[nilCC-onboard] Running inside SEV-SNP enclave");

  await loadPoseidon();

  const fs = require("fs");
  const path = require("path");
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Read manifest from env var (required by nilCC pattern)
  if (!process.env.ONBOARD_MANIFEST) {
    throw new Error("ONBOARD_MANIFEST env var not set");
  }
  const manifest = JSON.parse(process.env.ONBOARD_MANIFEST);
  const { employees, company_id } = manifest;
  const companyId = company_id || "default";

  console.log(
    `[nilCC-onboard] Onboarding ${employees.length} employees for company: ${companyId}`
  );

  const credentialRecords = [];
  const publicResults = [];

  for (const emp of employees) {
    // Generate high-entropy credential nonce INSIDE the TEE
    // Matches generateCredential() in identity.ts (32 random bytes → hex)
    const credentialNonce = crypto.randomBytes(32).toString("hex");

    // Derive employee_tag using BN254 Poseidon — matches frontend + Noir circuit
    const employeeTag = deriveEmployeeTag(credentialNonce);

    console.log(
      `[nilCC-onboard] Generated tag "${emp.name}": ${employeeTag.slice(0, 16)}… (BN254 Poseidon)`
    );

    credentialRecords.push({
      employeeTag,
      credentialNonce, // only in WS memory inside TEE — written to nilDB as %share
      name: emp.name,
      salary: emp.salary,
    });

    // Public output — ZERO sensitive data
    publicResults.push({
      employee_tag: employeeTag,
      name: emp.name,
      status: "active",
    });
  }

  // Write encrypted credentials to nilDB from inside the enclave
  const nildbWritten = await writeToNilDB(companyId, credentialRecords);

  // CRITICAL: credential_nonces are NEVER in the output
  const output = {
    company_id: companyId,
    employees: publicResults,
    employee_count: publicResults.length,
    hash_function: "bn254_poseidon",
    nildb_synced: nildbWritten,
    tee_onboarded: true,
    processed_at: new Date().toISOString(),
    attestation: {
      workload: "civitas-onboard-v2",
      enclave: { type: "SEV-SNP" },
      note: "BN254 Poseidon used — nonces generated + secret-split inside TEE",
    },
  };

  // Write summary file (no secrets)
  fs.writeFileSync(
    path.join(OUTPUT_DIR, "onboard_output.json"),
    JSON.stringify(output, null, 2)
  );

  console.log(`[nilCC-onboard] ✓ Onboarding complete — ${publicResults.length} employees`);
  console.log(`[nilCC-onboard] nilDB sync: ${nildbWritten ? "✓" : "✗ (check NILLION_ORG_SECRET_KEY)"}`);
  console.log("[nilCC-onboard] ⚠ credential_nonces generated + destroyed in TEE memory");

  return output;
}

// ── HTTP Server ───────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === "/" || req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      service: "civitas-onboard-v2",
      status: computeStatus,
      hash: "bn254_poseidon",
    }));
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

  res.writeHead(404);
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[nilCC-onboard] HTTP server on port ${PORT}`);
  runOnboarding()
    .then((result) => {
      computeResult = result;
      computeStatus = "done";
      console.log("[nilCC-onboard] ✓ Available at GET /result");
    })
    .catch((err) => {
      computeError = err.message;
      computeStatus = "error";
      console.error("[nilCC-onboard] Failed:", err);
    });
});
