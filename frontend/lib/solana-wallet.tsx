"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type WalletProvider = {
  isPhantom?: boolean;
  isSolflare?: boolean;
  publicKey?: { toString(): string };
  connect: (
    options?: { onlyIfTrusted?: boolean },
  ) => Promise<{ publicKey?: { toString(): string } } | undefined>;
  disconnect?: () => Promise<void>;
  signMessage?: (message: Uint8Array, encoding?: string) => Promise<{ signature: Uint8Array } | Uint8Array>;
  signAndSendTransaction?: (
    transaction: Uint8Array | unknown,
    options?: { skipPreflight?: boolean; preflightCommitment?: string },
  ) => Promise<{ signature: string }>;
  /** Sign one transaction without sending — returns signed bytes */
  signTransaction?: (transaction: unknown) => Promise<unknown>;
  /** Sign multiple transactions in one wallet prompt — returns signed array */
  signAllTransactions?: (transactions: unknown[]) => Promise<unknown[]>;
  on?: (event: string, handler: (...args: any[]) => void) => void;
  off?: (event: string, handler: (...args: any[]) => void) => void;
};

type SolanaWalletContextValue = {
  address: string | null;
  connected: boolean;
  connecting: boolean;
  available: boolean;
  providerName: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  signMessage: (message: Uint8Array) => Promise<Uint8Array>;
  signAndSendTransaction: (serializedTx: string) => Promise<string>;
  /**
   * Sign all transactions in a single wallet prompt (Phantom/Solflare support this).
   * Returns the signed serialized transactions as base64 strings ready to send.
   * Falls back to sequential signAndSendTransaction if signAllTransactions unavailable.
   */
  signAllAndSend: (serializedTxs: string[], connection: import("@solana/web3.js").Connection) => Promise<string[]>;
};

const SolanaWalletContext = createContext<SolanaWalletContextValue | undefined>(undefined);

function getProvider(): WalletProvider | null {
  if (typeof window === "undefined") return null;
  // Prioritize Solflare, then fall back to window.solana (Phantom or others)
  return (window as any).solflare || window.solana || null;
}

export function SolanaWalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [available, setAvailable] = useState(false);
  const [providerName, setProviderName] = useState<string | null>(null);

  const syncProvider = useCallback(() => {
    const provider = getProvider();
    setAvailable(Boolean(provider));
    setProviderName(provider?.isPhantom ? "Phantom" : provider?.isSolflare ? "Solflare" : provider ? "Solana Wallet" : null);
    setAddress(provider?.publicKey?.toString() ?? null);
  }, []);

  useEffect(() => {
    syncProvider();
    const provider = getProvider();
    if (!provider?.on) return;

    const handleConnect = (publicKey?: { toString(): string }) => {
      setAddress(publicKey?.toString() ?? provider.publicKey?.toString() ?? null);
    };
    const handleDisconnect = () => setAddress(null);
    const handleAccountChanged = (publicKey?: { toString(): string } | null) => {
      setAddress(publicKey?.toString() ?? null);
    };

    provider.on("connect", handleConnect);
    provider.on("disconnect", handleDisconnect);
    provider.on("accountChanged", handleAccountChanged);

    return () => {
      provider.off?.("connect", handleConnect);
      provider.off?.("disconnect", handleDisconnect);
      provider.off?.("accountChanged", handleAccountChanged);
    };
  }, [syncProvider]);

  const connect = useCallback(async () => {
    const provider = getProvider();
    if (!provider) {
      window.open("https://solflare.com/", "_blank", "noopener,noreferrer");
      return;
    }
    setConnecting(true);
    try {
      const response = await provider.connect();
      const publicKey = response?.publicKey ?? provider.publicKey;
      setAddress(publicKey?.toString() ?? null);
      setAvailable(true);
      setProviderName(provider.isPhantom ? "Phantom" : provider.isSolflare ? "Solflare" : "Solana Wallet");
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    const provider = getProvider();
    try {
      await provider?.disconnect?.();
    } finally {
      setAddress(null);
    }
  }, []);

  const signMessage = useCallback(async (message: Uint8Array): Promise<Uint8Array> => {
    const provider = getProvider();
    if (!provider?.signMessage) throw new Error("Wallet does not support signMessage");
    const result = await provider.signMessage(message, "bytes");
    // Solflare returns { signature } while Phantom returns the raw bytes
    if (result instanceof Uint8Array) return result;
    return (result as { signature: Uint8Array }).signature;
  }, []);

  const signAndSendTransaction = useCallback(async (serializedTx: string): Promise<string> => {
    const provider = getProvider();
    if (!provider?.signAndSendTransaction) {
      throw new Error("Wallet does not support signAndSendTransaction");
    }

    const binary = Uint8Array.from(atob(serializedTx), (char) => char.charCodeAt(0));
    const { Transaction, VersionedTransaction } = await import("@solana/web3.js");
    let transaction: unknown;

    try {
      transaction = Transaction.from(binary);
    } catch {
      transaction = VersionedTransaction.deserialize(binary);
    }

    const result = await provider.signAndSendTransaction(transaction, {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });

    return typeof result === "string" ? result : result.signature;
  }, []);

  /**
   * Sign all transactions at once (one wallet prompt), then send each through `connection`.
   * Routes through MagicBlock ER router when connection is a ConnectionMagicRouter.
   */
  const signAllAndSend = useCallback(
    async (serializedTxs: string[], connection: import("@solana/web3.js").Connection): Promise<string[]> => {
      const provider = getProvider();
      const { Transaction, VersionedTransaction } = await import("@solana/web3.js");

      const deserialize = (b64: string) => {
        const binary = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        try {
          return Transaction.from(binary);
        } catch {
          return VersionedTransaction.deserialize(binary);
        }
      };

      const txs = serializedTxs.map(deserialize);

      // Use signAllTransactions if available (one popup for all)
      if (provider?.signAllTransactions) {
        const signed = await provider.signAllTransactions(txs) as (typeof txs[0])[];
        const sigs: string[] = [];
        for (const stx of signed) {
          // sendRawTransaction works for both Transaction and VersionedTransaction
          const rawBytes = stx instanceof VersionedTransaction
            ? stx.serialize()
            : (stx as InstanceType<typeof Transaction>).serialize();
          const sig = await connection.sendRawTransaction(rawBytes, { skipPreflight: false });
          await connection.confirmTransaction(sig, "confirmed");
          sigs.push(sig);
        }
        return sigs;
      }

      // Fallback: sequential signAndSendTransaction
      const sigs: string[] = [];
      for (const b64 of serializedTxs) {
        sigs.push(await signAndSendTransaction(b64));
      }
      return sigs;
    },
    [signAndSendTransaction]
  );

  const value = useMemo<SolanaWalletContextValue>(
    () => ({
      address,
      connected: Boolean(address),
      connecting,
      available,
      providerName,
      connect,
      disconnect,
      signMessage,
      signAndSendTransaction,
      signAllAndSend,
    }),
    [address, available, connect, connecting, disconnect, providerName, signAndSendTransaction, signMessage, signAllAndSend],
  );

  return <SolanaWalletContext.Provider value={value}>{children}</SolanaWalletContext.Provider>;
}

export function useSolanaWallet() {
  const context = useContext(SolanaWalletContext);
  if (!context) {
    throw new Error("useSolanaWallet must be used within SolanaWalletProvider");
  }
  return context;
}
