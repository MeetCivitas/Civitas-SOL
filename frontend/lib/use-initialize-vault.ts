/**
 * lib/use-initialize-vault.ts
 *
 * React hook that manages Treasury Vault initialization for employer onboarding.
 *
 * Behaviour:
 *  - On mount (once wallet address is known), checks if vault already exists
 *  - If it exists → returns the PDA immediately, skips init step
 *  - If not       → exposes an `initialize(snsDomain?)` fn the UI calls
 *  - The initialize fn routes through /api/vault/init which builds + returns
 *    a serialised transaction that the wallet signs client-side
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { getVaultState, deriveVaultPDA, PROGRAM_ID, getConnection } from "./solana-program";

export type VaultInitStatus =
  | "idle"
  | "checking"
  | "exists"       // vault already on-chain — skip init
  | "ready"        // no vault found — user can call initialize()
  | "pending"      // waiting for wallet to sign + confirm
  | "success"      // vault just initialized
  | "error";

export interface UseInitializeVaultResult {
  status: VaultInitStatus;
  vaultPda: string | null;
  error: string | null;
  /** Call this to build + send the initialize_vault transaction */
  initialize: (snsDomain?: string) => Promise<void>;
}

/**
 * @param address   Connected wallet address (base58) or null
 * @param signAndSend  Wallet adapter fn — receives a base64 serialised TX, signs, sends, returns sig
 */
export function useInitializeVault(
  address: string | null,
  signAndSend: ((serializedTx: string) => Promise<string>) | null
): UseInitializeVaultResult {
  const [status, setStatus] = useState<VaultInitStatus>("idle");
  const [vaultPda, setVaultPda] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── Check on-chain vault existence when address changes ─────────────────
  useEffect(() => {
    if (!address) {
      setStatus("idle");
      setVaultPda(null);
      setError(null);
      return;
    }

    let cancelled = false;

    const check = async () => {
      setStatus("checking");
      setError(null);
      try {
        const owner = new PublicKey(address);
        const [pda] = PublicKey.findProgramAddressSync(
          [Buffer.from("vault"), owner.toBuffer()],
          PROGRAM_ID
        );
        const pdaStr = pda.toBase58();

        const vaultState = await getVaultState(owner);
        if (cancelled) return;

        if (vaultState) {
          // Vault already exists — tell the UI to skip init
          setVaultPda(pdaStr);
          setStatus("exists");
        } else {
          setVaultPda(pdaStr); // pre-compute PDA so UI can show it
          setStatus("ready");
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message ?? "Failed to check vault state");
          setStatus("error");
        }
      }
    };

    check();
    return () => { cancelled = true; };
  }, [address]);

  // ── Initialize vault ────────────────────────────────────────────────────
  const initialize = useCallback(async (snsDomain?: string) => {
    if (!address || !signAndSend) {
      setError("Wallet not connected.");
      return;
    }
    if (status === "exists" || status === "success") return; // already done

    setStatus("pending");
    setError(null);

    try {
      // Request orchestrator to build the initialize_vault transaction
      const resp = await fetch("/api/vault/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerAddress: address,
          snsDomain: snsDomain?.trim() || null,
        }),
      });

      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body?.error ?? `Server error: ${resp.status}`);
      }

      const { serializedTransaction, vaultPda: returnedPda } = await resp.json();

      // Wallet signs + sends
      await signAndSend(serializedTransaction);

      setVaultPda(returnedPda ?? vaultPda);
      setStatus("success");
    } catch (e: any) {
      setError(e?.message ?? "Vault initialization failed");
      setStatus("error");
    }
  }, [address, signAndSend, status, vaultPda]);

  return { status, vaultPda, error, initialize };
}
