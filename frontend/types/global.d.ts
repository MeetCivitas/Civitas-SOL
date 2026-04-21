import { MetaMaskInpageProvider } from '@metamask/providers';

declare global {
  interface SolanaWalletLike {
    isPhantom?: boolean;
    isSolflare?: boolean;
    publicKey?: { toString(): string };
    connect: (options?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: { toString(): string } }>;
    disconnect?: () => Promise<void>;
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
