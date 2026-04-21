/**
 * frontend/lib/sns.ts
 * Solana Name Service (SNS / Bonfida) integration for Civitas.
 *
 * Usage:
 *   • Employer "Add Contributor" form: type "dev.sol" → resolves to PublicKey
 *   • All display names: address → "company.sol" (or shortened address fallback)
 *   • Invoice share page: contractor's .sol name as the page title
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { getConnection } from "./solana-program";

// ── SNS SDK (lazy-loaded to avoid SSR issues) ───────────────────────────

type SNSModule = typeof import("@bonfida/spl-name-service");
let _snsModule: SNSModule | null = null;

async function getSNSModule(): Promise<SNSModule> {
  if (!_snsModule) {
    _snsModule = await import("@bonfida/spl-name-service");
  }
  return _snsModule;
}

// ── In-memory cache (avoid repeated RPC calls for the same names) ────────

const resolveCache = new Map<string, PublicKey | null>();
const lookupCache = new Map<string, string | null>();
const CACHE_TTL_MS = 5 * 60 * 1_000; // 5 minutes

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const resolveStore = new Map<string, CacheEntry<PublicKey | null>>();
const lookupStore = new Map<string, CacheEntry<string | null>>();

function cacheGet<T>(map: Map<string, CacheEntry<T>>, key: string): T | undefined {
  const entry = map.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    map.delete(key);
    return undefined;
  }
  return entry.value;
}

function cacheSet<T>(map: Map<string, CacheEntry<T>>, key: string, value: T): void {
  map.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ── Core Functions ───────────────────────────────────────────────────────

/**
 * Resolve a .sol domain name to its owner's PublicKey.
 * Returns null if the name is not registered.
 *
 * @example
 * const pk = await resolveSNS("devteam.sol");
 */
export async function resolveSNS(name: string): Promise<PublicKey | null> {
  const normalised = name.toLowerCase().replace(/\.sol$/, "");
  const cacheKey = normalised;

  const cached = cacheGet(resolveStore, cacheKey);
  if (cached !== undefined) return cached;

  try {
    const { resolve } = await getSNSModule();
    const connection = getConnection();
    const pubkey = await resolve(connection, normalised);
    cacheSet(resolveStore, cacheKey, pubkey);
    return pubkey;
  } catch (err: unknown) {
    // Domain not registered or RPC error
    cacheSet(resolveStore, cacheKey, null);
    return null;
  }
}

/**
 * Look up the .sol domain name registered to a PublicKey.
 * Returns null if no name is registered for this address.
 *
 * @example
 * const name = await lookupSNS(wallet.publicKey); // → "devteam.sol"
 */
export async function lookupSNS(pubkey: PublicKey): Promise<string | null> {
  const cacheKey = pubkey.toBase58();
  const cached = cacheGet(lookupStore, cacheKey);
  if (cached !== undefined) return cached;

  try {
    const { getPrimaryDomain } = await getSNSModule();
    const connection = getConnection();
    const { reverse, stale } = await getPrimaryDomain(connection, pubkey);
    const name = reverse ? `${reverse}.sol` : null;
    cacheSet(lookupStore, cacheKey, name);
    return name;
  } catch {
    cacheSet(lookupStore, cacheKey, null);
    return null;
  }
}

/**
 * Format a wallet address for display — shows .sol name if available,
 * otherwise shows shortened base58 address.
 *
 * @example
 * displayName("7xKXtg...") → "devteam.sol"  OR  "7xKX...tg2f"
 */
export async function formatDisplayName(
  pubkey: PublicKey,
  chars = 4
): Promise<string> {
  const name = await lookupSNS(pubkey);
  if (name) return name;
  const addr = pubkey.toBase58();
  return `${addr.slice(0, chars)}...${addr.slice(-chars)}`;
}

/**
 * Try to resolve a user-input string that might be either a .sol name
 * or a raw base58 address.
 *
 * @returns PublicKey on success, null if the input is invalid or unresolvable.
 */
export async function resolveRecipient(input: string): Promise<PublicKey | null> {
  const trimmed = input.trim();

  // Try as .sol name first
  if (trimmed.endsWith(".sol") || !trimmed.includes("1")) {
    const resolved = await resolveSNS(trimmed);
    if (resolved) return resolved;
  }

  // Try as raw base58 address
  try {
    return new PublicKey(trimmed);
  } catch {
    return null;
  }
}

/**
 * Validate that a .sol domain name has valid syntax.
 * Does NOT check whether it is registered on-chain.
 */
export function isValidSNSDomain(name: string): boolean {
  const clean = name.toLowerCase().replace(/\.sol$/, "");
  return /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/.test(clean) || /^[a-z0-9]$/.test(clean);
}
