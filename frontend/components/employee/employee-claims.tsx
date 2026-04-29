"use client";

export function EmployeeClaims() {
  return (
    <section className="rounded-3xl border border-white/10 bg-white/5 p-6 text-white">
      <h2 className="text-xl font-semibold">Claim routing</h2>
      <p className="mt-2 text-sm text-white/60">
        All payroll claims are settled natively on Solana. Your USDC lands directly in your SPL token account after the ZK proof is verified on-chain.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <div className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/30 bg-white/10 px-4 py-2 text-sm text-white">
          <span className="font-mono text-xs">SOL</span>
          Solana
        </div>
      </div>
    </section>
  );
}
