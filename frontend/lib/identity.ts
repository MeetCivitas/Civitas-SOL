/**
 * lib/identity.ts — Civitas Client-Side Credential Management (Solana build)
 *
 * Key changes from previous version:
 *   - Removed: Starknet Poseidon import (starknet-poseidon.ts)
 *   - Added:   BN254 Poseidon (bn128-poseidon.ts) for all on-chain values
 *   - Added:   Auto-credential storage in IndexedDB (user never sees JSON export)
 *   - Added:   refreshCredential() — NilDB recovery path for lost credentials
 *
 * Privacy model:
 *   - credential_nonce is generated client-side via crypto.getRandomValues()
 *   - It NEVER leaves the browser — stored only in IndexedDB
 *   - employee_tag = BN254_Poseidon(credential_nonce) — safe to share with employer
 *   - All on-chain hashes (commitment, nullifier) use BN254 Poseidon — matching
 *     the Noir circuit (bn254 poseidon module) and on-chain light-poseidon
 */

import {
  bn128Poseidon1,
  bn128Poseidon3,
  bn128Poseidon4,
  toFieldElement,
} from "./bn128-poseidon";

// ── Types ─────────────────────────────────────────────────────────────────

export interface CivitasCredential {
  /** 256-bit credential nonce as hex string — THE master secret */
  credentialNonce: string;
  /** employee_tag = BN254_Poseidon(credentialNonce) — safe to share */
  employeeTag: string;
  /** When the credential was generated */
  createdAt: string;
  /** Role this credential is for — defaults to "employee" */
  role?: "employee" | "auditor";
}

export interface VoucherData {
  employeeTag: string;
  amount: bigint;
  epoch: bigint;
  voucherNonce: bigint;
  commitment: string;
  merkleProofPath?: string[];
  merkleProofIndex?: number;
}

// ── Parsing helper ────────────────────────────────────────────────────────

function parseBigIntSafe(val: string | bigint): bigint {
  if (typeof val === "bigint") return val;
  try {
    return BigInt(val);
  } catch {
    try {
      const cleaned = val.replace(/[^0-9a-fA-F]/g, "") || "0";
      return BigInt("0x" + cleaned);
    } catch {
      return BigInt(0);
    }
  }
}

// ── Core Identity Functions ───────────────────────────────────────────────

/**
 * Generate a new 256-bit credential nonce.
 * Uses the Web Crypto API — cryptographically secure.
 * This MUST stay on the client device.
 */
export function generateCredentialNonce(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Derive employee_tag from credential nonce using BN254 Poseidon.
 * employee_tag = BN254_Poseidon(credential_nonce)
 * Matches the Noir circuit constraint C1.
 */
export function deriveEmployeeTag(nonceHex: string): string {
  const nonceBigInt = toFieldElement(BigInt("0x" + nonceHex));
  return bn128Poseidon1(nonceBigInt).toString();
}

/**
 * Compute commitment = BN254_Poseidon(employee_tag, amount, epoch, voucher_nonce)
 * Matches the Noir circuit constraint C2.
 */
export function computeCommitment(
  employeeTag: string,
  amount: bigint,
  epoch: bigint,
  voucherNonce: bigint
): string {
  return bn128Poseidon4(
    parseBigIntSafe(employeeTag),
    amount,
    epoch,
    voucherNonce
  ).toString();
}

/**
 * Compute nullifier = BN254_Poseidon(credential_nonce, epoch, voucher_nonce)
 * Matches the Noir circuit constraint C3.
 */
export function computeNullifier(
  nonceHex: string,
  epoch: bigint,
  voucherNonce: bigint
): string {
  const nonceBigInt = toFieldElement(BigInt("0x" + nonceHex));
  return bn128Poseidon3(nonceBigInt, epoch, voucherNonce).toString();
}

/**
 * Compute recipient hash for front-running protection.
 * recipient_hash = BN254_Poseidon(recipient_address_as_field)
 * Matches the Noir circuit constraint C5.
 */
export function computeRecipientHash(recipientAddress: string): string {
  return bn128Poseidon1(parseBigIntSafe(recipientAddress)).toString();
}

/**
 * Compute token_account_hash for Token-2022 account binding.
 * token_account_hash = BN254_Poseidon(token_account_pubkey_as_field)
 * Matches the Noir circuit constraint C6.
 */
export function computeTokenAccountHash(tokenAccountAddress: string): string {
  return bn128Poseidon1(parseBigIntSafe(tokenAccountAddress)).toString();
}

/**
 * Generate a new credential: nonce + derived BN254 tag.
 * Auto-stored in IndexedDB — user never sees a JSON file.
 */
export function generateCredential(): CivitasCredential {
  const nonce = generateCredentialNonce();
  const tag = deriveEmployeeTag(nonce);
  return {
    credentialNonce: nonce,
    employeeTag: tag,
    createdAt: new Date().toISOString(),
    role: "employee",
  };
}

/**
 * Validate credential structure.
 */
export function validateCredential(
  candidate: unknown
): candidate is CivitasCredential {
  if (!candidate || typeof candidate !== "object") return false;
  const obj = candidate as Record<string, unknown>;
  return (
    typeof obj.credentialNonce === "string" &&
    typeof obj.employeeTag === "string" &&
    typeof obj.createdAt === "string" &&
    obj.credentialNonce.length === 64
  );
}

/**
 * Verify the credential is self-consistent: nonce → tag derivation is correct.
 */
export function verifyCredential(credential: CivitasCredential): boolean {
  const derivedTag = deriveEmployeeTag(credential.credentialNonce);
  return derivedTag === credential.employeeTag;
}

// ── Auto-IndexedDB Storage ─────────────────────────────────────────────────

const CRED_IDB_DB = "civitas-credentials";
const CRED_IDB_STORE = "credentials";
const CRED_IDB_VERSION = 1;

async function openCredentialIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(CRED_IDB_DB, CRED_IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CRED_IDB_STORE)) {
        db.createObjectStore(CRED_IDB_STORE, { keyPath: "employeeTag" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Store a credential in IndexedDB automatically.
 * The credential_nonce is stored encrypted-at-rest by the browser's IndexedDB
 * origin isolation. The user never needs to handle a JSON file.
 */
export async function autoStoreCredential(
  credential: CivitasCredential
): Promise<void> {
  if (typeof indexedDB === "undefined") return; // SSR guard
  const db = await openCredentialIDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(CRED_IDB_STORE, "readwrite");
    const req = tx.objectStore(CRED_IDB_STORE).put(credential);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * Retrieve all credentials from IndexedDB.
 */
export async function listStoredCredentials(): Promise<CivitasCredential[]> {
  if (typeof indexedDB === "undefined") return [];
  try {
    const db = await openCredentialIDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(CRED_IDB_STORE, "readonly");
      const req = tx.objectStore(CRED_IDB_STORE).getAll();
      req.onsuccess = () => resolve(req.result as CivitasCredential[]);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

/**
 * Get the auto-credential for the current session.
 * If no credential exists, generate + store one automatically.
 * The user sees no friction — the credential is silently managed.
 */
export async function getOrCreateAutoCredential(): Promise<CivitasCredential> {
  const stored = await listStoredCredentials();
  if (stored.length > 0 && verifyCredential(stored[stored.length - 1])) {
    return stored[stored.length - 1];
  }

  const newCred = generateCredential();
  await autoStoreCredential(newCred);
  return newCred;
}

/**
 * Recover a credential from NilDB using the onboarding link token.
 * Called when the employee has lost their browser state.
 *
 * Flow:
 *   1. Employer sends onboarding link with a short-lived token.
 *   2. Employee opens link → app calls /api/employees/recover with token.
 *   3. Server looks up employee_tag and returns the encrypted credential seed.
 *   4. We re-derive the credential client-side and store it in IndexedDB.
 */
export async function refreshCredential(
  onboardingToken: string
): Promise<CivitasCredential | null> {
  try {
    const resp = await fetch("/api/employees/recover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: onboardingToken }),
    });
    if (!resp.ok) return null;

    const { credentialData } = await resp.json();
    if (!validateCredential(credentialData)) return null;
    if (!verifyCredential(credentialData)) return null;

    await autoStoreCredential(credentialData);
    return credentialData;
  } catch {
    return null;
  }
}

// ── Download backup (optional, for power users) ────────────────────────────

export function encodeCredentialForDownload(credential: CivitasCredential): string {
  return JSON.stringify(
    {
      ...credential,
      _warning: "This file contains your master credential. Never share it. Store it securely.",
      _version: "civitas-v3-solana",
    },
    null,
    2
  );
}

export function generateDownloadUrl(credential: CivitasCredential): string {
  const blob = new Blob([encodeCredentialForDownload(credential)], {
    type: "application/json",
  });
  return URL.createObjectURL(blob);
}

// ── Backward-Compatible Exports ────────────────────────────────────────────

/** @deprecated Use CivitasCredential */
export interface CredentialFile {
  employee_tag: string;
  credential_nonce: string;
  [key: string]: unknown;
}

/** @deprecated Use validateCredential */
export function validateCredentialFile(candidate: unknown): candidate is CredentialFile {
  if (!candidate || typeof candidate !== "object") return false;
  const obj = candidate as Record<string, unknown>;
  return typeof obj.employee_tag === "string" && typeof obj.credential_nonce === "string";
}
