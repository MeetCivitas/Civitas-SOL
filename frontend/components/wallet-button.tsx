"use client";

import { useState } from "react";
import { Copy, ExternalLink, LogOut, Wallet } from "lucide-react";
import { useSolanaWallet } from "@/lib/solana-wallet";
import { buildExplorerUrl, shortenAddress } from "@/lib/solana";

export function WalletButton() {
  const { address, connected, connecting, available, providerName, connect, disconnect } = useSolanaWallet();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  if (!connected) {
    return (
      <button
        type="button"
        onClick={() => void connect()}
        disabled={connecting}
        className="inline-flex min-h-10 items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:opacity-60"
      >
        <Wallet className="h-4 w-4" aria-hidden="true" />
        {connecting ? "Connecting..." : available ? "Connect Solana Wallet" : "Install Phantom"}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm text-white">
      <span className="inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" aria-hidden="true" />
      <span className="font-mono tabular-nums">{shortenAddress(address)}</span>
      {providerName ? <span className="hidden text-xs text-white/50 sm:inline">{providerName}</span> : null}
      <button
        type="button"
        onClick={() => void handleCopy()}
        aria-label="Copy wallet address"
        className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-full text-white/70 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
      >
        <Copy className="h-4 w-4" aria-hidden="true" />
      </button>
      <a
        href={address ? buildExplorerUrl("address", address) : "#"}
        target="_blank"
        rel="noreferrer"
        aria-label="View wallet in explorer"
        className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-full text-white/70 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
      >
        <ExternalLink className="h-4 w-4" aria-hidden="true" />
      </a>
      <button
        type="button"
        onClick={() => void disconnect()}
        aria-label="Disconnect wallet"
        className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-full text-white/70 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
      >
        <LogOut className="h-4 w-4" aria-hidden="true" />
      </button>
      {copied ? <span className="hidden text-xs text-emerald-300 sm:inline">Copied</span> : null}
    </div>
  );
}
