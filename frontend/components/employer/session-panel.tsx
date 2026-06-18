/**
 * frontend/components/employer/session-panel.tsx
 *
 * Setup wizard for the Civitas payroll treasury:
 *
 *   1. initialize_payroll_pool   → creates treasury PDA + ATA
 *   2. /api/compliance + attest_compliance
 *        (Nillion/Chainalysis screen + on-chain attestation; gates disburse)
 *   3. shield_funds              → moves USDC from employer wallet into the
 *                                  PDA-custody'd treasury ATA
 *
 * Pairs with `DisbursePanel` — that component reads treasury state to gate
 * the disburse button on compliance freshness + remaining shielded balance.
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { PublicKey, Transaction } from "@solana/web3.js";
import BN from "bn.js";
import {
  Shield,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Network,
  Coins,
} from "lucide-react";

import { useSolanaWallet, waitForSignature } from "@/lib/solana-wallet";
import { useCivitas } from "@/lib/civitas-provider";
import { getConnection } from "@/lib/solana-program";
import {
  CIVITAS_EPHEMERAL_PROGRAM_ID,
  CIVITAS_ER_MINT,
  buildAttestCompliance,
  buildInitializePayrollPool,
  buildShieldFunds,
  deriveTreasury,
  fetchEmployerTreasury,
  type EmployerTreasury,
} from "@/lib/civitas-ephemeral-client";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

type Phase = "loading" | "no-treasury" | "attesting" | "active" | "error";

interface ComplianceVerdict {
  ofac: boolean;
  jurisdiction: string;
  jurisdictionCode: number[];
  riskScore: number;
  ipGeofence: "pass" | "fail";
  attestedAt: number;
}

const PER_EMPLOYEE_LIMIT_DEFAULT = 5_000_000_000n; // 5000 USDC
const DAILY_LIMIT_DEFAULT = 100_000_000_000n; // 100k USDC

async function runCompliance(
  employer: PublicKey,
  employees: PublicKey[],
): Promise<ComplianceVerdict> {
  const res = await fetch(process.env.NEXT_PUBLIC_CIVITAS_COMPLIANCE_URL ?? "/api/compliance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      employer: employer.toBase58(),
      employees: employees.map((e) => e.toBase58()),
    }),
  });
  const body = (await res.json()) as ComplianceVerdict & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `compliance ${res.status}`);
  return body;
}

export function SessionPanel() {
  const wallet = useSolanaWallet();
  const civitas = useCivitas();
  const userAddress = wallet.address ?? civitas.walletAddress;
  const [phase, setPhase] = useState<Phase>("loading");
  const [treasury, setTreasury] = useState<EmployerTreasury | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<ComplianceVerdict | null>(null);
  const [lastSig, setLastSig] = useState<string | null>(null);
  const [shieldAmount, setShieldAmount] = useState("1000");

  const connection = useMemo(() => getConnection(), []);

  const refresh = useCallback(async () => {
    if (!userAddress) {
      setPhase("loading");
      return;
    }
    try {
      const authority = new PublicKey(userAddress);
      const t = await fetchEmployerTreasury(connection, authority);
      setTreasury(t);
      if (!t) {
        setPhase("no-treasury");
      } else if (t.complianceAttestedAt.gtn(0)) {
        setPhase("active");
      } else {
        setPhase("attesting");
      }
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setPhase("error");
    }
  }, [connection, userAddress]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // ─── Step 1: initialize_payroll_pool ──────────────────────────────────────
  const handleInitialize = useCallback(async () => {
    if (!userAddress || !wallet.signAndSendTransaction) return;
    setBusy("Initializing payroll pool…");
    setError(null);
    try {
      const authority = new PublicKey(userAddress);
      const ix = await buildInitializePayrollPool({
        authority,
        perEmployeeLimit: PER_EMPLOYEE_LIMIT_DEFAULT,
        dailyLimit: DAILY_LIMIT_DEFAULT,
        // Self-attest on devnet; replace with Civitas oracle key for prod.
        complianceAttestor: authority,
      });
      const tx = new Transaction().add(ix);
      tx.feePayer = authority;
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      const sig = await wallet.signAndSendTransaction(
        Buffer.from(tx.serialize({ requireAllSignatures: false })).toString("base64"),
      );
      await waitForSignature(connection, sig);
      setLastSig(sig);
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(null);
    }
  }, [wallet, connection, refresh, userAddress]);

  // ─── Step 2: compliance + attest_compliance ───────────────────────────────
  const handleAttest = useCallback(async () => {
    if (!userAddress || !wallet.signAndSendTransaction) return;
    setBusy("Running Nillion compliance check…");
    setError(null);
    try {
      const authority = new PublicKey(userAddress);
      const v = await runCompliance(authority, []);
      setVerdict(v);
      setBusy("Attesting on-chain…");
      const [treasuryPda] = deriveTreasury(authority);
      const ix = await buildAttestCompliance({
        attestor: authority,
        treasury: treasuryPda,
        passed: true,
        jurisdictionCode: Uint8Array.from(v.jurisdictionCode),
      });
      const tx = new Transaction().add(ix);
      tx.feePayer = authority;
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      const sig = await wallet.signAndSendTransaction(
        Buffer.from(tx.serialize({ requireAllSignatures: false })).toString("base64"),
      );
      await waitForSignature(connection, sig);
      setLastSig(sig);
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(null);
    }
  }, [wallet, connection, refresh, userAddress]);

  // ─── Step 3: shield funds ─────────────────────────────────────────────────
  const handleShield = useCallback(async () => {
    if (!userAddress || !wallet.signAndSendTransaction) return;
    const amount = BigInt(Math.floor(Number(shieldAmount) * 1_000_000));
    if (amount <= 0n) {
      setError("amount must be > 0");
      return;
    }
    setBusy(`Shielding ${shieldAmount} USDC into treasury…`);
    setError(null);
    try {
      const authority = new PublicKey(userAddress);
      const sourceAta = getAssociatedTokenAddressSync(CIVITAS_ER_MINT, authority);
      const ix = await buildShieldFunds({
        authority,
        sourceTokenAccount: sourceAta,
        amount,
      });
      const tx = new Transaction().add(ix);
      tx.feePayer = authority;
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      const sig = await wallet.signAndSendTransaction(
        Buffer.from(tx.serialize({ requireAllSignatures: false })).toString("base64"),
      );
      await waitForSignature(connection, sig);
      setLastSig(sig);
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(null);
    }
  }, [wallet, connection, refresh, userAddress, shieldAmount]);

  if (!userAddress) return null;

  const formatU64 = (b: BN | undefined) =>
    b ? Number(b.toString()) / 1_000_000 : 0;

  const statusBadge = (() => {
    switch (phase) {
      case "loading":
        return { label: "Loading…", color: "text-white/40", icon: Loader2 };
      case "no-treasury":
        return { label: "Not initialized", color: "text-amber-300/85", icon: AlertCircle };
      case "attesting":
        return { label: "Awaiting compliance attestation", color: "text-amber-300/85", icon: Shield };
      case "active":
        return { label: "Ready to disburse", color: "text-emerald-300/85", icon: CheckCircle2 };
      case "error":
        return { label: "Error", color: "text-red-400/85", icon: AlertCircle };
    }
  })();
  const StatusIcon = statusBadge.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.08 }}
      className="rounded-2xl border border-white/[0.08] bg-white/[0.02] backdrop-blur-md p-5"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Network className="h-4 w-4 text-white/70" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/80">
            Treasury &amp; Compliance
          </span>
        </div>
        <div className={`flex items-center gap-1.5 ${statusBadge.color}`}>
          <StatusIcon
            className={`h-3.5 w-3.5 ${phase === "loading" || busy ? "animate-spin" : ""}`}
          />
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em]">
            {busy ?? statusBadge.label}
          </span>
        </div>
      </div>

      {treasury && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <Stat
            label="Shielded"
            value={`${formatU64(treasury.totalShielded).toLocaleString()} USDC`}
          />
          <Stat
            label="Disbursed"
            value={`${formatU64(treasury.totalDisbursed).toLocaleString()} USDC`}
          />
          <Stat
            label="Per-employee"
            value={`${formatU64(treasury.perEmployeeLimit).toLocaleString()} USDC`}
          />
          <Stat
            label="Attested"
            value={
              treasury.complianceAttestedAt.gtn(0)
                ? new Date(treasury.complianceAttestedAt.toNumber() * 1000).toLocaleTimeString()
                : "—"
            }
          />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {phase === "no-treasury" && (
          <Button onClick={handleInitialize} disabled={!!busy}>
            Initialize Payroll Pool
          </Button>
        )}
        {phase === "attesting" && (
          <Button onClick={handleAttest} disabled={!!busy} primary>
            Run Compliance + Attest
          </Button>
        )}
        {phase === "active" && (
          <Button onClick={handleAttest} disabled={!!busy}>
            Refresh Attestation
          </Button>
        )}
      </div>

      {treasury && (
        <div className="flex flex-wrap items-center gap-2 pt-3 mt-3 border-t border-white/[0.06]">
          <Coins className="h-3 w-3 text-white/40" />
          <span className="text-[9px] uppercase tracking-[0.22em] text-white/40">
            Shield Funds
          </span>
          <input
            type="number"
            min="0"
            step="1"
            value={shieldAmount}
            onChange={(e) => setShieldAmount(e.target.value)}
            className="w-28 rounded-lg border border-white/[0.10] bg-white/[0.04] px-2 py-1 text-xs text-white focus:outline-none focus:ring-2 focus:ring-white/30 tabular-nums"
          />
          <Button onClick={handleShield} disabled={!!busy}>
            Shield
          </Button>
          <span className="text-[10px] text-white/30">
            (wallet ATA → treasury PDA custody)
          </span>
        </div>
      )}

      {verdict && (
        <div className="mt-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-[11px] text-white/65 flex flex-wrap gap-x-4 gap-y-1">
          <span>
            <span className="text-white/40">OFAC:</span>{" "}
            {verdict.ofac ? "FAIL" : "OK"}
          </span>
          <span>
            <span className="text-white/40">Risk:</span> {verdict.riskScore}/100
          </span>
          <span>
            <span className="text-white/40">Jurisdiction:</span>{" "}
            {verdict.jurisdiction}
          </span>
          <span>
            <span className="text-white/40">Geofence:</span> {verdict.ipGeofence}
          </span>
        </div>
      )}

      {lastSig && (
        <a
          href={`https://explorer.solana.com/tx/${lastSig}?cluster=devnet`}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-block text-[10px] uppercase tracking-[0.18em] text-cyan-300/85 hover:text-cyan-200"
        >
          Last tx: {lastSig.slice(0, 12)}… ↗
        </a>
      )}

      {error && (
        <div className="mt-3 text-[11px] text-red-400/85">{error}</div>
      )}

      <p className="mt-4 text-[10px] uppercase tracking-[0.2em] text-white/30">
        Program: {CIVITAS_EPHEMERAL_PROGRAM_ID.toBase58().slice(0, 6)}… · Mint:{" "}
        {CIVITAS_ER_MINT.toBase58().slice(0, 6)}…
      </p>
    </motion.div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] uppercase tracking-[0.22em] text-white/40">
        {label}
      </span>
      <span className="text-sm text-white/90 tabular-nums">{value}</span>
    </div>
  );
}

function Button({
  children,
  onClick,
  disabled,
  primary,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-full px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] transition-colors disabled:opacity-40 ${
        primary
          ? "bg-white text-black hover:bg-white/90"
          : "border border-white/[0.10] bg-white/[0.04] text-white/85 hover:bg-white/[0.08] hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}
