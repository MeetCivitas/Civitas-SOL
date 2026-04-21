"use client";

import type { PayrollRun } from "@/lib/civitas-provider";

export function PayrollDetail({ run }: { run: PayrollRun }) {
  return (
    <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
      <h2 className="text-xl font-semibold text-white">Payroll batch detail</h2>
      <div className="mt-4 space-y-3 text-sm text-white/70">
        <p>Run id: <span className="font-mono text-white">{run.runId}</span></p>
        <p>Status: <span className="capitalize text-white">{run.status}</span></p>
        <p>Contributors: <span className="text-white">{run.employeeCount}</span></p>
        <p>Merkle root: <span className="break-all font-mono text-white">{run.merkleRoot ?? "Pending"}</span></p>
      </div>
    </section>
  );
}
