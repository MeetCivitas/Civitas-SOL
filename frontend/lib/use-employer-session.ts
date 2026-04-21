/**
 * lib/use-employer-session.ts
 *
 * Gasless Sign-In With Solana (SIWS) session management for employers.
 *
 * Flow:
 *  1. buildMessage(address) → human-readable UTF-8 string
 *  2. signIn(address, signMessageFn) → signs the message, stores session
 *  3. verifySession(address) → checks sessionStorage; returns true if valid (< 24h, same address)
 *  4. clearSession() → logout
 */

"use client";

const SESSION_KEY = "civitas:employer_session";
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const DOMAIN =
  typeof window !== "undefined"
    ? window.location.host
    : "app.civitas.finance";

export interface EmployerSession {
  address: string;
  signature: string; // hex
  issuedAt: string;  // ISO timestamp
  domain: string;
}

/** Build the human-readable SIWS message the employer signs. */
export function buildSignInMessage(address: string): string {
  const issuedAt = new Date().toISOString();
  return [
    `${DOMAIN} wants you to sign in with your Solana account:`,
    address,
    "",
    "Statement: I authorize access to Civitas Protocol as an Employer.",
    "",
    `Domain: ${DOMAIN}`,
    `Issued At: ${issuedAt}`,
  ].join("\n");
}

/** Encode message string as UTF-8 bytes for wallet.signMessage(). */
export function encodeMessage(message: string): Uint8Array {
  return new TextEncoder().encode(message);
}

/**
 * Sign in with wallet — stores session in sessionStorage.
 * @param address     Connected wallet address (base58)
 * @param signMessage Wallet fn that takes Uint8Array and returns signature Uint8Array
 */
export async function signEmployerIn(
  address: string,
  signMessage: (bytes: Uint8Array) => Promise<Uint8Array>
): Promise<EmployerSession> {
  const message = buildSignInMessage(address);
  const messageBytes = encodeMessage(message);

  const signatureBytes = await signMessage(messageBytes);
  const signatureHex = Buffer.from(signatureBytes).toString("hex");

  const session: EmployerSession = {
    address,
    signature: signatureHex,
    issuedAt: new Date().toISOString(),
    domain: DOMAIN,
  };

  if (typeof window !== "undefined") {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }

  return session;
}

/**
 * Check if a valid employer session exists for the given address.
 * Returns the session if valid, null otherwise.
 */
export function getEmployerSession(address: string): EmployerSession | null {
  if (typeof window === "undefined") return null;

  const raw = sessionStorage.getItem(SESSION_KEY);
  if (!raw) return null;

  try {
    const session: EmployerSession = JSON.parse(raw);

    // Must match the currently connected wallet
    if (session.address !== address) return null;

    // Must be less than 24 hours old
    const age = Date.now() - new Date(session.issuedAt).getTime();
    if (age > SESSION_TTL_MS) {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }

    return session;
  } catch {
    return null;
  }
}

/** Clear the employer session (logout). */
export function clearEmployerSession(): void {
  if (typeof window !== "undefined") {
    sessionStorage.removeItem(SESSION_KEY);
  }
}
