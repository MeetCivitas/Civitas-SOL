/**
 * frontend/components/employees/receipts-viewer.tsx
 *
 * Read-only inbox of private-payment receipts for the connected employee.
 * Replaces the old ER 3-step claim panel — the MagicBlock encrypted-queue
 * crank settles funds directly into the employee's wallet ATA, so there's
 * nothing for the employee to "claim." Their receipts table just shows
 * what arrived, when, and from whom (encrypted in NilDB; visible to them).
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { CheckCircle2, Clock, Inbox, RefreshCw } from "lucide-react";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

import { useSolanaWallet } from "@/lib/solana-wallet";
import { useCivitas } from "@/lib/civitas-provider";
import { getConnection } from "@/lib/solana-program";
import { CIVITAS_ER_MINT } from "@/lib/civitas-ephemeral-client";

interface Receipt {
  _id?: string;
  commitment?: string;
  amount?: string;
  employer_address?: string;
  employee_tag?: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
  nonce?: string;
  tx_hash?: string;
}

interface ReceiptsResponse {
  receipts: Receipt[];
  note?: string;
  error?: string;
}

export function ReceiptsViewer({ companyId }: { companyId?: string }) {
  const wallet = useSolanaWallet();
  const civitas = useCivitas();
  const userAddress = wallet.address ?? civitas.walletAddress;
  const baseConnection = useMemo(() => getConnection(), []);

  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [walletBalance, setWalletBalance] = useState<bigint>(0n);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userAddress) return;
    setLoading(true);
    setError(null);
    try {
      // Receipts come from NilDB. We need a companyId to scope; if absent
      // (employees without a company affiliation), surface a soft notice.
      if (!companyId) {
        setReceipts([]);
        setError("No company configured for this employee account.");
        return;
      }
      const url = `/api/payroll/receipts?companyId=${companyId}&employee=${userAddress}`;
      const r = await fetch(url);
      const body = (await r.json()) as ReceiptsResponse;
      if (!r.ok || body.error) throw new Error(body.error ?? `receipts ${r.status}`);
      setReceipts(body.receipts ?? []);

      // Update wallet balance for the live counter.
      try {
        const ata = getAssociatedTokenAddressSync(CIVITAS_ER_MINT, new PublicKey(userAddress));
        const r2 = await baseConnection.getTokenAccountBalance(ata);
        setWalletBalance(BigInt(r2.value.amount));
      } catch {
        setWalletBalance(0n);
      }
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [baseConnection, companyId, userAddress]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!userAddress) return null;

  const formatUsdc = (raw: string | undefined) => {
    if (!raw) return "0.00";
    try {
      const v = BigInt(raw);
      const whole = v / 1_000_000n;
      const frac = v % 1_000_000n;
      return `${whole}.${frac.toString().padStart(6, "0").slice(0, 2)}`;
    } catch {
      return raw;
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-white/[0.08] bg-white/[0.02] backdrop-blur-md p-5 space-y-4"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Inbox className="h-4 w-4 text-white/70" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/80">
            Private Payment Receipts
          </span>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.10] bg-white/[0.04] px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-white/65 hover:bg-white/[0.08] disabled:opacity-40"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 text-[11px]">
        <div className="rounded-xl border border-emerald-500/15 bg-emerald-500/[0.04] p-3">
          <p className="text-[9px] uppercase tracking-[0.22em] text-white/40">
            Wallet Balance
          </p>
          <p className="mt-1 text-xl text-emerald-300/90 tabular-nums">
            {formatUsdc(walletBalance.toString())} <span className="text-[10px] text-white/40">USDC</span>
          </p>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
          <p className="text-[9px] uppercase tracking-[0.22em] text-white/40">
            Total Received
          </p>
          <p className="mt-1 text-xl text-white/90 tabular-nums">
            {receipts.length}{" "}
            <span className="text-[10px] text-white/40">
              {receipts.length === 1 ? "payment" : "payments"}
            </span>
          </p>
        </div>
      </div>

      {error && (
        <div className="text-[11px] text-amber-300/85 rounded-xl border border-amber-500/15 bg-amber-500/[0.04] p-3">
          {error}
        </div>
      )}

      <div className="space-y-1.5">
        {receipts.length === 0 && !loading ? (
          <div className="rounded-xl border border-dashed border-white/[0.06] bg-white/[0.01] p-6 text-center">
            <Inbox className="h-5 w-5 text-white/30 mx-auto mb-2" />
            <p className="text-[11px] text-white/40">
              No private payments yet. They'll appear here as soon as your employer disburses.
            </p>
          </div>
        ) : (
          receipts.map((r) => (
            <ReceiptRow key={r._id ?? r.commitment ?? Math.random()} r={r} formatUsdc={formatUsdc} />
          ))
        )}
      </div>

      <p className="text-[10px] uppercase tracking-[0.18em] text-white/30">
        Settled by MagicBlock TEE crank · receipts stored encrypted in Nillion
      </p>
    </motion.div>
  );
}

function ReceiptRow({
  r,
  formatUsdc,
}: {
  r: Receipt;
  formatUsdc: (raw: string | undefined) => string;
}) {
  const settled = r.status === "settled" || r.status === "claimed";
  const time = r.updated_at ?? r.created_at;
  const employerShort = r.employer_address
    ? `${r.employer_address.slice(0, 6)}…${r.employer_address.slice(-4)}`
    : "—";
  return (
    <div
      className={`flex items-center justify-between rounded-xl border bg-white/[0.02] px-3 py-2 text-[11px] ${
        settled
          ? "border-emerald-500/15 text-emerald-200/85"
          : "border-cyan-500/15 text-cyan-200/85"
      }`}
    >
      <div className="flex items-center gap-2.5">
        {settled ? (
          <CheckCircle2 className="h-3.5 w-3.5" />
        ) : (
          <Clock className="h-3.5 w-3.5 animate-pulse" />
        )}
        <div className="space-y-0.5">
          <div className="font-mono tabular-nums">
            +{formatUsdc(r.amount)} USDC
          </div>
          <div className="text-[10px] text-white/40 font-mono">
            from {employerShort} · {time ? new Date(time).toLocaleString() : "—"}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[9px] uppercase tracking-[0.18em] text-white/40">
          {settled ? "Settled" : "Pending"}
        </span>
        {r.tx_hash && (
          <a
            href={`https://explorer.solana.com/tx/${r.tx_hash}?cluster=devnet`}
            target="_blank"
            rel="noreferrer"
            className="text-[10px] underline-offset-2 hover:underline"
          >
            tx ↗
          </a>
        )}
      </div>
    </div>
  );
}
