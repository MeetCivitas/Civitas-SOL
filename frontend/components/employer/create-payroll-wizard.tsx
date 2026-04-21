"use client";

import { useState } from "react";
import type { RegisteredEmployee } from "@/lib/civitas-provider";

export function CreatePayrollWizard({
  employees,
  onPrepare,
}: {
  employees: RegisteredEmployee[];
  onPrepare: (epochLabel: string) => void;
}) {
  const [epochLabel, setEpochLabel] = useState("");

  return (
    <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
      <h2 className="text-xl font-semibold text-white">Prepare payroll batch</h2>
      <p className="mt-2 text-sm text-white/60">
        Draft a batch against the current roster. Final Solana program submission is intentionally left for the next migration step.
      </p>
      <label className="mt-5 block">
        <span className="mb-2 block text-sm text-white/70">Epoch label</span>
        <input
          value={epochLabel}
          onChange={(event) => setEpochLabel(event.target.value)}
          className="min-h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none transition focus:border-white/30 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          placeholder="April 2026 payroll"
        />
      </label>
      <button
        type="button"
        onClick={() => onPrepare(epochLabel || `batch-${employees.length}`)}
        className="mt-4 inline-flex min-h-11 items-center rounded-full bg-white px-5 py-3 text-sm font-medium text-black transition hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
      >
        Prepare batch
      </button>
    </section>
  );
}
