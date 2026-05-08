// workload/onboard_employee.js
// Civitas nilCC Workload — Blind Employee Onboarding (Solana build)
// Runs inside Nillion's SEV-SNP enclave via nilCC.
//
// V4 lifecycle: pure compute function. The HTTP server lives in server.js
// and calls runOnboard(manifest) per request. credential_nonces are generated
// inside the TEE, secret-split to nilDB, and the function returns only public
// employee_tags. Raw nonces never leave the enclave.
//
// Hashing: BN254 Poseidon (poseidon-lite) — matches identity.ts / Noir circuit.

"use strict";

const crypto = require("crypto");

const BN254_PRIME = BigInt(
  "21888242871839275222246405745257275088548364400416034343698204186575808495617",
);

let _poseidon1;

async function loadPoseidon() {
  if (_poseidon1) return;
  const mod = await import("poseidon-lite");
  _poseidon1 = mod.poseidon1;
  if (typeof _poseidon1 !== "function") {
    throw new Error("poseidon-lite is missing poseidon1 — version mismatch");
  }
}

function deriveEmployeeTag(credentialNonceHex) {
  const nonceBigInt = BigInt("0x" + credentialNonceHex);
  const field = ((nonceBigInt % BN254_PRIME) + BN254_PRIME) % BN254_PRIME;
  return _poseidon1([field]).toString();
}

async function writeToNilDB(orgKey, companyId, credentialRecords) {
  if (!orgKey) return false;
  try {
    const { SecretVaultBuilderClient } = require("@nillion/secretvaults");
    const { Signer } = require("@nillion/nuc");
    const { NilauthClient } = require("@nillion/nilauth-client");

    const signer = Signer.fromPrivateKey(orgKey);
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
    const data = credentialRecords.map((r) => ({
      _id: crypto.randomUUID(),
      employee_tag: r.employeeTag,
      credential_nonce: { "%share": r.credentialNonce },
      company_id: companyId,
      hash_function: "bn254_poseidon",
      created_in_tee: true,
      enclave_type: "SEV-SNP",
      status: "active",
      created_at: new Date().toISOString(),
    }));

    await client.createData({ collection: collectionId, data });
    return true;
  } catch (err) {
    console.warn("[nilCC-onboard] nilDB write failed:", err && err.message ? err.message : err);
    return false;
  }
}

/**
 * Generate credential nonces inside the TEE, secret-split to nilDB, and
 * return only the public employee_tags. Pure function: takes a manifest,
 * returns the result. credential_nonces never appear in the return value.
 *
 * @param {{employees: Array<{name: string, salary?: string|number}>, company_id?: string}} manifest
 * @param {{nillionOrgKey?: string}} env
 * @returns {Promise<object>} onboard output (company_id, employees[{employee_tag,name,status}], …)
 */
async function runOnboard(manifest, env) {
  await loadPoseidon();

  const { employees, company_id } = manifest;
  if (!Array.isArray(employees)) throw new Error("manifest.employees must be an array");
  const companyId = company_id || "default";

  const credentialRecords = [];
  const publicResults = [];

  for (const emp of employees) {
    const credentialNonce = crypto.randomBytes(32).toString("hex");
    const employeeTag = deriveEmployeeTag(credentialNonce);

    credentialRecords.push({
      employeeTag,
      credentialNonce,
      name: emp.name,
      salary: emp.salary,
    });

    publicResults.push({
      employee_tag: employeeTag,
      name: emp.name,
      status: "active",
    });
  }

  const orgKey = (env && env.nillionOrgKey) || "";
  const nildbWritten = await writeToNilDB(orgKey, companyId, credentialRecords);

  // Best-effort zeroize the credentialRecords array so nonces are not
  // sitting in V8 heap longer than necessary. GC will reclaim, but we
  // overwrite the strings first to reduce the residency window.
  for (const r of credentialRecords) {
    if (r.credentialNonce) r.credentialNonce = "0".repeat(r.credentialNonce.length);
  }
  credentialRecords.length = 0;

  return {
    company_id: companyId,
    employees: publicResults,
    employee_count: publicResults.length,
    hash_function: "bn254_poseidon",
    nildb_synced: nildbWritten,
    tee_onboarded: true,
    processed_at: new Date().toISOString(),
    attestation: {
      workload: "civitas-onboard-v4",
      enclave: { type: "SEV-SNP" },
      note: "BN254 Poseidon used — nonces generated + secret-split inside TEE",
    },
  };
}

module.exports = { runOnboard };
