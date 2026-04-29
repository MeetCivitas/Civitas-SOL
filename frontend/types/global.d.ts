import { MetaMaskInpageProvider } from '@metamask/providers';

declare global {
  interface SolanaWalletLike {
    isPhantom?: boolean;
    isSolflare?: boolean;
    publicKey?: { toString(): string };
    connect: (options?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: { toString(): string } }>;
    disconnect?: () => Promise<void>;
    signMessage?: (message: Uint8Array, encoding?: string) => Promise<{ signature: Uint8Array } | Uint8Array>;
    signTransaction?: (transaction: Uint8Array | unknown) => Promise<Uint8Array | unknown>;
    signAndSendTransaction?: (
      transaction: Uint8Array | unknown,
      options?: { skipPreflight?: boolean; preflightCommitment?: string }
    ) => Promise<{ signature: string }>;
    on?: (event: string, handler: (...args: unknown[]) => void) => void;
    off?: (event: string, handler: (...args: unknown[]) => void) => void;
  }

  interface Window {
    ethereum?: MetaMaskInpageProvider;
    solana?: SolanaWalletLike;
  }
}

export type JsonRpcRequest = {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: unknown[] | Record<string, unknown>;
};

// Re-export types from @bitgo/utxo-lib module for convenience
export type UtxoLib = typeof import('@bitgo/utxo-lib');

declare module "snarkjs";

export {};
