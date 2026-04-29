/**
 * lib/cloak.ts — Civitas Cloak Privacy Integration (Layer 4)
 *
 * Layer 1: Nillion nilDB — encrypted salary storage
 * Layer 2: Nillion nilCC TEE — private payroll computation
 * Layer 3: Noir UltraHonk — anonymous on-chain claiming
 * Layer 4: Cloak shielded pool — post-claim settlement privacy
 *
 * Program: zh1eLd6rSphLejbFfJEneUwzHRfMKxgzrgkfwA6qRkW (devnet)
 */

import type { Connection } from "@solana/web3.js";

export const CLOAK_PROGRAM = "zh1eLd6rSphLejbFfJEneUwzHRfMKxgzrgkfwA6qRkW";

const CLOAK_NETWORK = (
  process.env.NEXT_PUBLIC_SOLANA_CLUSTER === "mainnet-beta" ? "mainnet" : "devnet"
) as "devnet" | "mainnet";

export interface CloakWalletAdapter {
  publicKey: import("@solana/web3.js").PublicKey | null;
  signTransaction?: <T>(tx: T) => Promise<T>;
  signAllTransactions?: <T>(txs: T[]) => Promise<T[]>;
}

/**
 * Generate a Cloak keypair and return the viewing key hex for auditor access.
 * CloakKeyPair.view contains the viewing key used for compliance scanning.
 */
export async function generateCloakViewingKey(): Promise<{
  viewingKeyHex: string;
  spendKeyHex: string;
  masterKeyHex: string;
}> {
  const { generateCloakKeys } = await import("@cloak.dev/sdk");
  const keys = generateCloakKeys();
  const toHex = (b: Uint8Array | { toBytes?(): Uint8Array } | undefined) => {
    if (!b) return "";
    if (b instanceof Uint8Array) return Buffer.from(b).toString("hex");
    if (typeof (b as any).toBytes === "function") return Buffer.from((b as any).toBytes()).toString("hex");
    // Handle object with numeric keys (serialized Uint8Array)
    try { return Buffer.from(Object.values(b as any) as number[]).toString("hex"); } catch { return ""; }
  };
  return {
    viewingKeyHex: toHex((keys.view as any)?.vk ?? (keys.view as any)),
    spendKeyHex: toHex((keys.spend as any)?.sk ?? (keys.spend as any)),
    masterKeyHex: toHex((keys.master as any)?.seed ?? (keys.master as any)),
  };
}

/**
 * Deposit SOL into the Cloak shielded pool after a successful vault claim.
 *
 * NOTE: Cloak's shielded pool uses SOL as the base asset (Groth16 UTXOs).
 * USDC payroll funds are converted SOL→Cloak pool. Withdrawal is private.
 * The `onNoteGenerated` callback fires BEFORE the transaction — save the note.
 */
export async function shieldPayoutWithCloak(
  connection: Connection,
  wallet: CloakWalletAdapter,
  amountLamports: number,
  onNoteGenerated: (noteJson: string) => void
): Promise<{ txSignature: string; noteJson: string }> {
  const { CloakSDK } = await import("@cloak.dev/sdk");

  const sdk = new CloakSDK({
    wallet: wallet as any,
    network: CLOAK_NETWORK,
  });

  let capturedNote: any = null;

  const result = await sdk.deposit(connection, amountLamports, {
    onNoteGenerated: (note) => {
      capturedNote = note;
      onNoteGenerated(JSON.stringify(note));
    },
  });

  return {
    txSignature: result.signature ?? "",
    noteJson: JSON.stringify(result.note ?? capturedNote),
  };
}

/**
 * Check whether the Cloak SDK is available in this bundle.
 */
export async function isCloakAvailable(): Promise<boolean> {
  try {
    await import("@cloak.dev/sdk");
    return true;
  } catch {
    return false;
  }
}
