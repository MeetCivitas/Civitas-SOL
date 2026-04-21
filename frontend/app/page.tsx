"use client";

import Link from "next/link";
import { ArrowRight, Lock, ShieldCheck, Wallet } from "lucide-react";
import { WalletButton } from "@/components/wallet-button";
import { SOLANA_CLUSTER_LABEL } from "@/lib/solana";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-black px-4 py-12 text-white">
      <section className="mx-auto max-w-6xl rounded-[2rem] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.08),transparent_32%),linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] p-8 md:p-12">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm uppercase tracking-[0.22em] text-white/50">Civitas-Sol</p>
            <h1 className="mt-4 max-w-4xl text-4xl font-semibold tracking-tight md:text-6xl">
              Private payroll operations for Solana-native teams
            </h1>
            <p className="mt-5 max-w-2xl text-base text-white/65 md:text-lg">
              Use Solana wallets for treasury control, keep private computation in nilCC, and prepare payroll batches without exposing contributor compensation in the UI.
            </p>
          </div>
          <WalletButton />
        </div>

        <div className="mt-10 flex flex-wrap gap-3">
          <Link
            href="/login"
            className="inline-flex min-h-11 items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-medium text-black transition hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          >
            Open portal
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
          <Link
            href="/employer"
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/15 px-5 py-3 text-sm font-medium text-white transition hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          >
            Employer workspace
          </Link>
        </div>

        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {[
            {
              title: "Wallet-native treasury",
              body: `Run the coordinator layer on ${SOLANA_CLUSTER_LABEL} and leave final settlement under Solana wallet control.`,
              icon: Wallet,
            },
            {
              title: "Private computation",
              body: "Reuse nilCC for salary bands, approval policy, and payout attestations without rebuilding the privacy core.",
              icon: Lock,
            },
            {
              title: "Auditable batches",
              body: "Prepare contributor payout batches with transparent state transitions for auditors and operations teams.",
              icon: ShieldCheck,
            },
          ].map(({ title, body, icon: Icon }) => (
            <article key={title} className="rounded-3xl border border-white/10 bg-black/25 p-6">
              <Icon className="h-5 w-5 text-white/75" aria-hidden="true" />
              <h2 className="mt-4 text-lg font-semibold">{title}</h2>
              <p className="mt-2 text-sm text-white/60">{body}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
