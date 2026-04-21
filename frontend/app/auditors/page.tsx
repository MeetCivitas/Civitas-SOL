"use client";

import { useCivitas } from "@/lib/civitas-provider";
import { WalletButton } from "@/components/wallet-button";

export default function AuditorsPage() {
  const { auditors, payrollRuns, merkleRoot, commitmentCount } = useCivitas();

  return (
    <main className="min-h-screen bg-black px-4 py-8 text-white">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm uppercase tracking-[0.2em] text-white/45">Auditor Workspace</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">Batch review and attestation shell</h1>
            <p className="mt-3 max-w-2xl text-sm text-white/65">
              This route keeps the audit workflow available while Solana program verification and explorer wiring are finalized.
            </p>
          </div>
          <WalletButton />
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <article className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <p className="text-sm text-white/55">Active auditors</p>
            <p className="mt-2 text-3xl font-semibold tabular-nums">{auditors.length}</p>
          </article>
          <article className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <p className="text-sm text-white/55">Prepared commitments</p>
            <p className="mt-2 text-3xl font-semibold tabular-nums">{commitmentCount}</p>
          </article>
          <article className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <p className="text-sm text-white/55">Latest root</p>
            <p className="mt-2 break-all font-mono text-sm text-white/80">{merkleRoot}</p>
          </article>
        </div>

        <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
          <h2 className="text-xl font-semibold">Prepared payroll runs</h2>
          <div className="mt-4 space-y-3">
            {payrollRuns.length ? (
              payrollRuns.map((run) => (
                <div key={run.runId} className="rounded-2xl border border-white/10 bg-black/25 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-medium">{run.runId}</p>
                      <p className="text-xs text-white/45">{run.employeeCount} contributors</p>
                    </div>
                    <p className="text-sm capitalize text-white/65">{run.status}</p>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 p-6 text-sm text-white/55">
                No prepared payroll runs yet.
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
