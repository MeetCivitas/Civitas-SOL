// lib/credential-store.ts
// IndexedDB-based encrypted local credential storage
// credential_nonce NEVER leaves this store — it stays on-device only

import type { CivitasCredential } from "./identity";

const DB_NAME = "civitas_credentials";
const DB_VERSION = 1;
const STORE_NAME = "credentials";
const ACTIVE_CREDENTIAL_KEY = "civitas_active_credential_tag";

// ── IndexedDB Helpers ───────────────────────────────────────────────────

function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: "employeeTag" });
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Store a credential in IndexedDB.
 * This is the ONLY place the credential_nonce is stored.
 */
export async function storeCredential(
    credential: CivitasCredential
): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        store.put(credential);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

/**
 * Retrieve a credential by employee tag.
 */
export async function getCredential(
    employeeTag: string
): Promise<CivitasCredential | null> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(employeeTag);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
    });
}

/**
 * List all stored credentials (for multi-identity support).
 */
export async function listCredentials(): Promise<CivitasCredential[]> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

/**
 * Delete a credential by employee tag.
 */
export async function deleteCredential(employeeTag: string): Promise<void> {
    const db = await openDB();
    // If deleting the active credential, clear the active tag
    const activeTag = getActiveCredentialTag();
    if (activeTag === employeeTag) {
        clearActiveCredentialTag();
    }
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        store.delete(employeeTag);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

/**
 * Import a credential from a JSON file (backup restore).
 */
export async function importCredentialFromFile(
    file: File
): Promise<CivitasCredential> {
    const text = await file.text();
    const parsed = JSON.parse(text);

    // Validate structure
    if (
        !parsed.credentialNonce ||
        !parsed.employeeTag ||
        typeof parsed.credentialNonce !== "string" ||
        parsed.credentialNonce.length !== 64
    ) {
        throw new Error("Invalid credential file format");
    }

    const credential: CivitasCredential = {
        credentialNonce: parsed.credentialNonce,
        employeeTag: parsed.employeeTag,
        createdAt: parsed.createdAt || new Date().toISOString(),
        role: parsed.role,
    };

    await storeCredential(credential);
    setActiveCredentialTag(credential.employeeTag);
    return credential;
}

/**
 * Check if any credentials exist in the store.
 */
export async function hasCredentials(): Promise<boolean> {
    const creds = await listCredentials();
    return creds.length > 0;
}

// ── Active Credential Tracking ──────────────────────────────────────────
// Persists across full page reloads (window.location.href) which destroy
// React state. Without this, CivitasProvider always picks creds[0] from
// IndexedDB on mount, ignoring which credential was actually used to log in.

/**
 * Mark a credential as the currently active one.
 * Stored in localStorage so it survives page reloads.
 */
export function setActiveCredentialTag(tag: string): void {
    try {
        localStorage.setItem(ACTIVE_CREDENTIAL_KEY, tag);
    } catch {
        // localStorage may be unavailable in SSR or private browsing
    }
}

/**
 * Get the tag of the currently active credential.
 */
export function getActiveCredentialTag(): string | null {
    try {
        return localStorage.getItem(ACTIVE_CREDENTIAL_KEY);
    } catch {
        return null;
    }
}

/**
 * Clear the active credential tag (e.g. on logout).
 */
export function clearActiveCredentialTag(): void {
    try {
        localStorage.removeItem(ACTIVE_CREDENTIAL_KEY);
    } catch {
        // noop
    }
}
