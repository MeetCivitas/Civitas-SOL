"use client";

import Link from "next/link";
import { use } from "react";
import { useCivitas } from "@/lib/civitas-provider";

type SettlementPageProps = {
  params: Promise<{ id: string }>;
};

export default function SettlementPage({ params }: SettlementPageProps) {
  const resolved = use(params);
  const runId = decodeURIComponent(resolved.id);
  const { payrollRuns } = useCivitas();
  const run = payrollRuns.find((entry) => entry.runId === runId);

  return (
    <main className="min-h-screen bg-black px-4 py-8 text-white">
      <div className="mx-auto max-w-4xl space-y-6">
        <Link
          href="/employer"
          className="inline-flex min-h-10 items-center rounded-full border border-white/15 px-4 py-2 text-sm text-white/70 transition hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
        >
          Back to employer workspace
        </Link>

        <section className="rounded-3xl border border-white/10 bg-white/5 p-8">
          <p className="text-sm uppercase tracking-[0.2em] text-white/45">Settlement</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">{runId}</h1>
          {run ? (
            <div className="mt-6 space-y-4 text-sm text-white/70">
              <p>Status: <span className="capitalize text-white">{run.status}</span></p>
              <p>Contributors: <span className="text-white">{run.employeeCount}</span></p>
              <p>Total amount: <span className="text-white">{run.totalAmount ?? "Pending"} USDC</span></p>
              <p>Merkle root: <span className="break-all font-mono text-white">{run.merkleRoot ?? "Pending"}</span></p>
              <p>
                The Solana program transaction is not wired yet. This page now acts as the canonical batch summary for the migration shell.
              </p>
            </div>
          ) : (
            <p className="mt-6 text-sm text-white/60">No local payroll batch with that id was found.</p>
          )}
        </section>
      </div>
    </main>
  );
}
