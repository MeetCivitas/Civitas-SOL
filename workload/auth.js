// workload/auth.js
// Ed25519 request authentication for the Civitas workload.
//
// The orchestrator (Civitas Next.js server) holds a private key and signs
// every POST /run/* body. The workload holds the matching public key in
// CIVITAS_REQUEST_PUBKEY (raw 32-byte hex) and verifies the signature
// before parsing or computing anything.
//
// Dev mode: if CIVITAS_REQUEST_PUBKEY is unset, auth is bypassed and a loud
// warning is logged at boot. The Step 6 provisioner generates the keypair
// and injects the public key into the workload env on /workloads/create.

"use strict";

const crypto = require("crypto");

const PUBKEY_HEX = (process.env.CIVITAS_REQUEST_PUBKEY || "").trim();

// Ed25519 SPKI DER prefix — wraps a raw 32-byte pubkey so Node's
// crypto.createPublicKey will accept it. Same prefix every time:
// SEQUENCE { SEQUENCE { OID 1.3.101.112 } BIT STRING { ... } }
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

let cachedPubKey = null;

function loadPubKey() {
  if (cachedPubKey) return cachedPubKey;
  if (!PUBKEY_HEX) return null;
  const raw = Buffer.from(PUBKEY_HEX, "hex");
  if (raw.length !== 32) {
    throw new Error(
      `CIVITAS_REQUEST_PUBKEY must be 32 raw bytes hex-encoded (got ${raw.length} bytes)`,
    );
  }
  const der = Buffer.concat([ED25519_SPKI_PREFIX, raw]);
  cachedPubKey = crypto.createPublicKey({ key: der, format: "der", type: "spki" });
  return cachedPubKey;
}

/**
 * Verify an Ed25519 signature over the exact request body bytes.
 * @param {Buffer} rawBody  raw HTTP request body bytes
 * @param {string|undefined} sigB64  base64-encoded 64-byte signature from x-civitas-sig header
 * @returns {{ok: boolean, status?: number, reason?: string}}
 */
function verifyRequestSignature(rawBody, sigB64) {
  const pk = loadPubKey();
  if (!pk) {
    // Dev mode — auth disabled. Caller already logged a warning at boot.
    return { ok: true };
  }
  if (!sigB64) {
    return { ok: false, status: 401, reason: "missing x-civitas-sig header" };
  }
  let sig;
  try {
    sig = Buffer.from(sigB64, "base64");
  } catch {
    return { ok: false, status: 400, reason: "invalid x-civitas-sig encoding" };
  }
  if (sig.length !== 64) {
    return { ok: false, status: 400, reason: `signature must be 64 bytes (got ${sig.length})` };
  }
  let ok = false;
  try {
    ok = crypto.verify(null, rawBody, pk, sig);
  } catch (err) {
    return { ok: false, status: 400, reason: `verify error: ${err && err.message}` };
  }
  if (!ok) return { ok: false, status: 403, reason: "signature does not verify" };
  return { ok: true };
}

function isAuthEnabled() {
  return !!PUBKEY_HEX;
}

module.exports = { verifyRequestSignature, isAuthEnabled };
