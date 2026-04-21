"use client";

import { useState } from "react";

const CHAINS = [
  { id: "solana", name: "Solana", icon: "SOL" },
  { id: "ethereum", name: "Ethereum", icon: "ETH" },
  { id: "arbitrum", name: "Arbitrum", icon: "ARB" },
];

export function EmployeeClaims() {
  const [selectedChain, setSelectedChain] = useState("solana");

  return (
    <section className="rounded-3xl border border-white/10 bg-white/5 p-6 text-white">
      <h2 className="text-xl font-semibold">Claim routing</h2>
      <p className="mt-2 text-sm text-white/60">
        Solana is the default payout rail for the migration shell. Additional chains remain roadmap options only.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        {CHAINS.map((chain) => (
          <button
            key={chain.id}
            type="button"
            onClick={() => setSelectedChain(chain.id)}
            className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 py-2 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black ${
              selectedChain === chain.id ? "border-white/30 bg-white/10 text-white" : "border-white/10 text-white/65 hover:bg-white/5"
            }`}
          >
            <span className="font-mono text-xs">{chain.icon}</span>
            {chain.name}
          </button>
        ))}
      </div>
    </section>
  );
}
