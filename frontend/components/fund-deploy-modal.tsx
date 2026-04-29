"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Copy, ExternalLink, Wallet } from "lucide-react";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { useSolanaWallet } from "@/lib/solana-wallet";
import { getConnection } from "@/lib/solana-program";
import {
  buildExplorerUrl,
  SOLANA_CLUSTER,
  SOLANA_CLUSTER_LABEL,
  shortenAddress,
} from "@/lib/solana";

const AIRDROP_AMOUNT_SOL = 2;

export function FundDeployModal() {
  const { address, connected, providerName } = useSolanaWallet();
  const [dismissed, setDismissed] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "done">("idle");
  const [airdropState, setAirdropState] = useState<"idle" | "pending" | "success" | "error">("idle");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const shouldShow = connected && Boolean(address) && SOLANA_CLUSTER !== "mainnet-beta" && !dismissed;

  const faucetUrl = useMemo(() => {
    if (SOLANA_CLUSTER === "testnet") {
      return "https://faucet.solana.com/";
    }
    return "https://faucet.solana.com/";
  }, []);

  const handleCopy = async () => {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    setCopyState("done");
    window.setTimeout(() => setCopyState("idle"), 1500);
  };

  const handleAirdrop = async () => {
    if (!address) return;

    setAirdropState("pending");
    setStatusMessage(`Requesting ${AIRDROP_AMOUNT_SOL} SOL from the ${SOLANA_CLUSTER_LABEL.toLowerCase()} faucet...`);

    try {
      const connection = getConnection();
      const signature = await connection.requestAirdrop(
        new PublicKey(address),
        AIRDROP_AMOUNT_SOL * LAMPORTS_PER_SOL,
      );
      const latestBlockhash = await connection.getLatestBlockhash("confirmed");

      await connection.confirmTransaction(
        {
          signature,
          blockhash: latestBlockhash.blockhash,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        },
        "confirmed",
      );

      setAirdropState("success");
      setStatusMessage(`Airdrop confirmed. Explorer: ${signature}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Airdrop failed";
      setAirdropState("error");
      setStatusMessage(message);
    }
  };

  if (!shouldShow) {
    return null;
  }

  return (
    <AnimatePresence>
      <motion.div
        key="solana-faucet-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[220] flex items-center justify-center bg-black/72 p-4 backdrop-blur-md"
      >
        <motion.div
          key="solana-faucet-panel"
          initial={{ opacity: 0, scale: 0.94, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.94, y: 20 }}
          transition={{ type: "spring", damping: 22, stiffness: 260 }}
          className="w-full max-w-lg overflow-hidden rounded-[28px] border border-white/10 bg-[#08080f] text-white shadow-[0_0_80px_rgba(40,120,255,0.16)]"
        >
          <div className="border-b border-white/8 bg-[linear-gradient(135deg,rgba(20,83,255,0.22),rgba(15,23,42,0.12),rgba(16,185,129,0.08))] px-6 py-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-blue-400/20 bg-blue-500/15">
                  <Wallet className="h-5 w-5 text-blue-200" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-white/45">Wallet Setup</p>
                  <h2 className="mt-1 text-lg font-semibold tracking-tight">Fund your Solana workspace</h2>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDismissed(true)}
                className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/60 transition hover:bg-white/5 hover:text-white"
              >
                Dismiss
              </button>
            </div>
          </div>

          <div className="space-y-5 px-6 py-6">
            <p className="text-sm leading-6 text-white/62">
              Civitas-Sol is currently wired for <span className="font-medium text-white">{SOLANA_CLUSTER_LABEL}</span>. Fund
              the connected wallet before running employer onboarding, payroll batch commits, or employee-side claim tests.
            </p>

            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/40">Connected Wallet</p>
              <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/30 px-4 py-3">
                <div>
                  <p className="font-mono text-sm text-white">{shortenAddress(address, 6)}</p>
                  {providerName ? <p className="mt-1 text-xs text-white/45">{providerName}</p> : null}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleCopy()}
                    className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-full border border-white/10 text-white/70 transition hover:bg-white/8 hover:text-white"
                    aria-label="Copy address"
                  >
                    <Copy className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <a
                    href={address ? buildExplorerUrl("address", address) : "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-full border border-white/10 text-white/70 transition hover:bg-white/8 hover:text-white"
                    aria-label="Open explorer"
                  >
                    <ExternalLink className="h-4 w-4" aria-hidden="true" />
                  </a>
                </div>
              </div>
              {copyState === "done" ? <p className="mt-2 text-xs text-emerald-300">Address copied.</p> : null}
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <button
                type="button"
                onClick={() => void handleAirdrop()}
                disabled={airdropState === "pending"}
                className="rounded-2xl border border-blue-400/20 bg-blue-500/15 px-4 py-4 text-left transition hover:bg-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <p className="text-sm font-semibold">Request {AIRDROP_AMOUNT_SOL} SOL</p>
                <p className="mt-1 text-xs text-white/55">Uses the current RPC endpoint directly.</p>
              </button>

              <a
                href={faucetUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-2xl border border-emerald-400/20 bg-emerald-500/12 px-4 py-4 text-left transition hover:bg-emerald-500/18"
              >
                <p className="text-sm font-semibold">Open Solana Faucet</p>
                <p className="mt-1 text-xs text-white/55">Fallback if the RPC airdrop quota is exhausted.</p>
              </a>
            </div>

            {statusMessage ? (
              <div
                className={`rounded-2xl border px-4 py-3 text-sm ${
                  airdropState === "error"
                    ? "border-red-500/20 bg-red-500/10 text-red-200"
                    : airdropState === "success"
                      ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-200"
                      : "border-white/10 bg-white/[0.04] text-white/70"
                }`}
              >
                {statusMessage}
              </div>
            ) : null}

            <div className="rounded-2xl border border-white/8 bg-black/25 px-4 py-3 text-xs leading-5 text-white/45">
              The faucet helper is intentionally hidden on mainnet. Production treasury funding should go through your
              custody and fiat off-ramp flow, not an RPC airdrop.
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
