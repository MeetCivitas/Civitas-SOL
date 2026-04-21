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
  /** Gasless: signs an arbitrary message with the wallet. Returns raw signature bytes. */
  signMessage: (message: Uint8Array) => Promise<Uint8Array>;
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
    }),
    [address, available, connect, connecting, disconnect, providerName, signMessage],
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
