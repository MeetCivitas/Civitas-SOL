#!/usr/bin/env node
// scripts/provision-nilcc.mjs
//
// One-off provisioner for the Civitas warm nilCC workload (V4).
//
// What this does:
//   1. Generates an Ed25519 keypair (orchestrator → workload request signing).
//   2. POSTs /api/v1/workloads/create with our long-running V4 image, baking
//      the public key into the workload's env so it can verify /run/* sigs.
//   3. Polls until the workload reaches "running".
//   4. Optionally fetches GET /attestation on the new workload and pulls out
//      a golden measurement value to pin in NILCC_GOLDEN_MEASUREMENT.
//   5. Prints the env vars you should paste into .env.local.
//
// Run once before your demo. To rotate keys or swap images, run again — the
// old workload should be deleted via the nilCC dashboard or the legacy
// deleteWorkload helper.
//
// Required env (read from process or .env.local):
//   NILCC_CLUSTER_URL          e.g. https://api.nilcc.nillion.network
//   NILCC_API_KEY              your nilCC API key
//   NILCC_WORKLOAD_IMAGE       e.g. rythmerrn/civitas-nilcc:v4
//   NILLION_ORG_SECRET_KEY     for the workload's nilDB writes (onboarding)
// Optional:
//   NILLCC_ACCOUNT_ID          if your account requires it as a header
//   NILCC_WORKLOAD_NAME        defaults to civitas-warm-<timestamp>

"use strict";

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// ── env loading ────────────────────────────────────────────────────────

function loadDotEnvLocal() {
  const candidates = [
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), "frontend/.env.local"),
    path.resolve(import.meta.dirname || ".", "../.env.local"),
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    const text = fs.readFileSync(p, "utf8");
    for (const line of text.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let val = m[2];
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[m[1]]) process.env[m[1]] = val;
    }
    console.log(`[provision] loaded env from ${p}`);
    return;
  }
}

loadDotEnvLocal();

const NILCC_CLUSTER_URL = (process.env.NILCC_CLUSTER_URL || "").trim();
const NILCC_API_KEY = (
  process.env.NILCC_API_KEY ||
  process.env.NILCC_SECRET_KEY ||
  process.env.NILCC_SIGNING_KEY ||
  ""
).trim();
const NILLCC_ACCOUNT_ID = (process.env.NILLCC_ACCOUNT_ID || "").trim();
const NILCC_WORKLOAD_IMAGE = (process.env.NILCC_WORKLOAD_IMAGE || "").trim();
const NILLION_ORG_KEY = (
  process.env.NILLION_ORG_SECRET_KEY ||
  process.env.NEXT_PUBLIC_NILLION_ORG_SECRET_KEY ||
  ""
).trim();
const WORKLOAD_NAME = (process.env.NILCC_WORKLOAD_NAME || `civitas-warm-${Date.now()}`).trim();

function requireEnv(name, value) {
  if (!value) {
    console.error(`[provision] FATAL: ${name} not set`);
    process.exit(1);
  }
}

requireEnv("NILCC_CLUSTER_URL", NILCC_CLUSTER_URL);
requireEnv("NILCC_API_KEY (or NILCC_SECRET_KEY)", NILCC_API_KEY);
requireEnv("NILCC_WORKLOAD_IMAGE", NILCC_WORKLOAD_IMAGE);

// ── helpers ────────────────────────────────────────────────────────────

async function nilccFetch(p, init = {}) {
  const url = `${NILCC_CLUSTER_URL}${p}`;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${NILCC_API_KEY}`,
    "x-api-key": NILCC_API_KEY,
    ...(NILLCC_ACCOUNT_ID ? { "x-account-id": NILLCC_ACCOUNT_ID } : {}),
    ...(init.headers || {}),
  };
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${init.method || "GET"} ${p} → ${res.status}: ${text.slice(0, 300)}`);
  }
  return res;
}

function generateEd25519Keypair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const privDer = privateKey.export({ format: "der", type: "pkcs8" });
  const pubDer = publicKey.export({ format: "der", type: "spki" });
  // PKCS8 Ed25519 ends with the 32-byte raw key
  const rawPriv = Buffer.from(privDer.subarray(privDer.length - 32));
  // SPKI Ed25519 ends with the 32-byte raw key
  const rawPub = Buffer.from(pubDer.subarray(pubDer.length - 32));
  return { privHex: rawPriv.toString("hex"), pubHex: rawPub.toString("hex") };
}

function buildComposeYaml(pubHex) {
  // YAML emitted as a single string. Mind the indentation — nilCC parses this.
  // No manifest baked in: V4 receives manifests over POST /run/{kind}.
  // restart: unless-stopped so the workload survives transient OOM/SIGSEGV.
  return [
    "services:",
    "  civitas-workload:",
    `    image: ${NILCC_WORKLOAD_IMAGE}`,
    "    environment:",
    `      CIVITAS_REQUEST_PUBKEY: '${pubHex}'`,
    `      NILLION_ORG_SECRET_KEY: '${NILLION_ORG_KEY.replace(/'/g, "''")}'`,
    "      PORT: '80'",
    "    restart: unless-stopped",
    "",
  ].join("\n");
}

// ── main ───────────────────────────────────────────────────────────────

async function main() {
  console.log("[provision] generating Ed25519 keypair…");
  const { privHex, pubHex } = generateEd25519Keypair();

  console.log(`[provision] creating workload "${WORKLOAD_NAME}"`);
  console.log(`[provision]   image: ${NILCC_WORKLOAD_IMAGE}`);
  console.log(`[provision]   cluster: ${NILCC_CLUSTER_URL}`);

  const composeYaml = buildComposeYaml(pubHex);
  const createPayload = {
    name: WORKLOAD_NAME,
    dockerCompose: composeYaml,
    envVars: {
      CIVITAS_REQUEST_PUBKEY: pubHex,
      NILLION_ORG_SECRET_KEY: NILLION_ORG_KEY,
    },
    artifactsVersion: "0.4.2",
    publicContainerName: "civitas-workload",
    publicContainerPort: 80,
    // Tier matches the legacy submitPayrollJob spec — known-valid on the
    // nilCC cluster's tier table. Smaller tiers (4GB/2CPU/10GB) are rejected
    // with INVALID_WORKLOAD_TIER on the public cluster.
    memory: 8192,
    cpus: 2,
    gpus: 0,
    disk: 20,
  };

  const createRes = await nilccFetch("/api/v1/workloads/create", {
    method: "POST",
    body: JSON.stringify(createPayload),
  });
  const created = await createRes.json();
  const workloadId = created.workloadId || created.id;
  if (!workloadId) {
    console.error("[provision] FATAL: no workloadId in response:", created);
    process.exit(1);
  }
  console.log(`[provision] ✓ workloadId: ${workloadId}`);

  // Poll until running
  console.log("[provision] polling for status=running (up to 5 min)…");
  const deadline = Date.now() + 5 * 60_000;
  let domain = null;
  while (Date.now() < deadline) {
    const r = await nilccFetch(`/api/v1/workloads/${workloadId}`);
    const d = await r.json();
    process.stdout.write(`\r[provision]   status: ${d.status}      `);
    if (d.status === "running") {
      domain = d.domain || `${workloadId}.nillionusercontent.com`;
      break;
    }
    if (d.status === "error") {
      console.error(`\n[provision] FATAL: workload entered error state`);
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  if (!domain) {
    console.error("\n[provision] FATAL: workload did not reach running state in 5 min");
    process.exit(1);
  }
  console.log(`\n[provision] ✓ workload running at https://${domain}`);

  // Best-effort attestation probe
  let goldenMeasurement = "";
  try {
    const attUrl = `https://${domain}/attestation?nonce=${crypto.randomBytes(8).toString("hex")}`;
    const attRes = await fetch(attUrl, { signal: AbortSignal.timeout(5000) });
    if (attRes.ok) {
      const att = await attRes.json();
      console.log(`[provision] /attestation kind: ${att.kind}`);
      if (att.kind === "real") {
        // Try to extract a measurement string from the report. Format depends
        // on nilcc-attester version — pull anything that looks like 64-128 hex.
        const reportStr = JSON.stringify(att.report || "");
        const match = reportStr.match(/[0-9a-f]{64,128}/i);
        if (match) goldenMeasurement = match[0];
      }
    } else {
      console.warn(`[provision] /attestation returned HTTP ${attRes.status}`);
    }
  } catch (err) {
    console.warn(`[provision] /attestation probe failed: ${err.message}`);
  }

  // Smoke test /healthz
  try {
    const h = await fetch(`https://${domain}/healthz`, { signal: AbortSignal.timeout(5000) });
    const hbody = await h.text();
    console.log(`[provision] /healthz: HTTP ${h.status} — ${hbody.slice(0, 80)}`);
  } catch (err) {
    console.warn(`[provision] /healthz probe failed: ${err.message}`);
  }

  // ── output ───────────────────────────────────────────────────────────
  console.log("\n──────────────────────────────────────────────────────────────");
  console.log("Paste these into frontend/.env.local (and restart the dev server):");
  console.log("──────────────────────────────────────────────────────────────");
  console.log(`NILCC_WORKLOAD_ID=${workloadId}`);
  console.log(`NILCC_WORKLOAD_DOMAIN=${domain}`);
  console.log(`CIVITAS_REQUEST_PRIVKEY=${privHex}`);
  console.log(`CIVITAS_REQUEST_PUBKEY=${pubHex}`);
  if (goldenMeasurement) {
    console.log(`NILCC_GOLDEN_MEASUREMENT=${goldenMeasurement}`);
  } else {
    console.log("# NILCC_GOLDEN_MEASUREMENT — could not auto-detect; set after first /attestation call");
  }
  console.log("──────────────────────────────────────────────────────────────");
  console.log(
    `\n[provision] Done. The Civitas server can now use V4 by setting USE_LEGACY_NILCC=0 (default).`,
  );
  console.log(`[provision] To tear down later, hit the nilCC dashboard or call deleteWorkload("${workloadId}").`);
}

main().catch((err) => {
  console.error("\n[provision] FATAL:", err && err.message ? err.message : err);
  process.exit(1);
});
