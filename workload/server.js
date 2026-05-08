// workload/server.js
// Civitas nilCC Workload — long-running HTTP entrypoint (V4)
//
// Replaces the V3 boot-once-then-serve-cached pattern. Now:
//   POST /run/payroll  → manifest in body → returns commitments + Merkle root
//   POST /run/onboard  → manifest in body → returns employee_tags
//   GET  /healthz      → liveness
//   GET  /attestation?nonce=<hex>  → fresh enclave report (Step 3 — stub for now)
//
// Auth (Step 2 — not yet wired): every POST /run/* will require an Ed25519
// signature in the x-civitas-sig header verified against CIVITAS_REQUEST_PUBKEY.
//
// State: none persists between requests. All compute buffers are local to the
// per-request scope and are eligible for GC the moment the response is sent.

"use strict";

const http = require("http");

const { computePayroll } = require("./run_compute");
const { runOnboard } = require("./onboard_employee");
const { verifyRequestSignature, isAuthEnabled } = require("./auth");

const PORT = parseInt(process.env.PORT || "80", 10);
const NILLION_ORG_KEY =
  process.env.NILLION_ORG_SECRET_KEY ||
  process.env.NEXT_PUBLIC_NILLION_ORG_SECRET_KEY ||
  "";

// ── Helpers ──────────────────────────────────────────────────────────────

function readRawBody(req, maxBytes = 16 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// Read raw bytes, verify the Ed25519 signature in x-civitas-sig against
// those exact bytes, and only then parse JSON. Order matters: parsing
// before verifying would mean we compute on unauthenticated input.
async function readSignedJsonBody(req) {
  const raw = await readRawBody(req);
  const sigB64 = req.headers["x-civitas-sig"];
  const verdict = verifyRequestSignature(raw, sigB64);
  if (!verdict.ok) {
    const err = new Error(verdict.reason || "unauthorized");
    err.statusCode = verdict.status || 401;
    throw err;
  }
  if (raw.length === 0) return {};
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch (err) {
    const wrapped = new Error(`invalid JSON body: ${err && err.message}`);
    wrapped.statusCode = 400;
    throw wrapped;
  }
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-civitas-sig");
}

// ── Route handlers ───────────────────────────────────────────────────────

async function handlePayroll(req, res) {
  const manifest = await readSignedJsonBody(req);
  const result = await computePayroll(manifest);
  sendJson(res, 200, { status: "done", data: result });
}

async function handleOnboard(req, res) {
  const manifest = await readSignedJsonBody(req);
  const result = await runOnboard(manifest, { nillionOrgKey: NILLION_ORG_KEY });
  sendJson(res, 200, { status: "done", data: result });
}

// nilCC's CVM compose includes an `nilcc-attester` sidecar that exposes
// `/nilcc/api/v2/report` (per docs.nillion.com / NillionNetwork/nilcc README).
// The report binds the AMD-SEV-SNP measurement to the workload's TLS cert
// fingerprint — not to a per-request nonce. Verification model:
//   1. Caller fetches the report.
//   2. Caller validates AMD signature chain + measurement against golden.
//   3. Caller confirms the TLS cert fingerprint in the report matches the
//      one its HTTPS handshake just used.
// Per-request freshness comes from the TLS handshake, not the report itself.
//
// Possible URLs (in priority order — the first that responds wins):
//   - http://nilcc-attester:80/nilcc/api/v2/report  (compose service name)
//   - http://127.0.0.1:80/nilcc/api/v2/report       (Caddy reverse-proxies it)
const ATTESTER_URLS = [
  process.env.NILCC_ATTESTER_URL,
  "http://nilcc-attester:80/nilcc/api/v2/report",
  "http://127.0.0.1:80/nilcc/api/v2/report",
].filter(Boolean);

async function fetchAttesterReport() {
  for (const u of ATTESTER_URLS) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 1500);
      const r = await fetch(u, { signal: ctrl.signal });
      clearTimeout(t);
      if (!r.ok) continue;
      const body = await r.text();
      let parsed;
      try { parsed = JSON.parse(body); } catch { parsed = { raw: body }; }
      return { source: u, report: parsed };
    } catch {
      // try next
    }
  }
  return null;
}

async function handleAttestation(req, res, url) {
  const nonce = url.searchParams.get("nonce") || "";
  const fetched = await fetchAttesterReport();
  if (fetched) {
    sendJson(res, 200, {
      kind: "real",
      nonce, // advisory — nilCC binds to TLS fingerprint, not nonce
      source: fetched.source,
      report: fetched.report,
      timestamp: new Date().toISOString(),
    });
    return;
  }
  // Local Docker / dev — no attester sidecar reachable. Flag clearly so the
  // orchestrator's verifier can decide whether to accept.
  sendJson(res, 200, {
    kind: "stub",
    nonce,
    note: "nilcc-attester sidecar not reachable; running outside SEV-SNP CVM",
    enclave: { type: "SEV-SNP", verified: false },
    timestamp: new Date().toISOString(),
  });
}

// ── Server ───────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  } catch {
    sendJson(res, 400, { error: "invalid url" });
    return;
  }

  try {
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/healthz" || url.pathname === "/health")) {
      sendJson(res, 200, { service: "civitas-workload-v4", status: "ready" });
      return;
    }

    if (req.method === "GET" && url.pathname === "/attestation") {
      await handleAttestation(req, res, url);
      return;
    }

    if (req.method === "POST" && url.pathname === "/run/payroll") {
      await handlePayroll(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/run/onboard") {
      await handleOnboard(req, res);
      return;
    }

    sendJson(res, 404, { error: "not found" });
  } catch (err) {
    const status = err && err.statusCode ? err.statusCode : 500;
    const message = err && err.message ? err.message : String(err);
    if (status >= 500) {
      console.error(`[nilCC] ${req.method} ${url.pathname} failed:`, message);
    }
    sendJson(res, status, { error: message });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[nilCC] Civitas workload v4 listening on :${PORT}`);
  console.log(`[nilCC] Routes: GET /healthz, GET /attestation, POST /run/payroll, POST /run/onboard`);
  if (isAuthEnabled()) {
    console.log(`[nilCC] Auth: Ed25519 signature required on /run/* (x-civitas-sig header)`);
  } else {
    console.warn(`[nilCC] ⚠ AUTH DISABLED — CIVITAS_REQUEST_PUBKEY not set. /run/* accepts unsigned requests. Dev mode only.`);
  }
});

// Graceful shutdown so nilCC can stop the workload cleanly.
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    console.log(`[nilCC] received ${sig}, closing server`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  });
}
