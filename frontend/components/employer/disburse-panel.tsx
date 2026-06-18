/**
 * frontend/components/employer/disburse-panel.tsx
 *
 * Production disbursement UI. Drives the end-to-end flow:
 *
 *   1. Compliance (Nillion/Chainalysis) is fresh — re-attest if stale.
 *   2. POST /api/payroll/prepare-atas   (one-time per mint+employee)
 *   3. POST /api/payroll/disburse       → unsigned tx (authorize_disburse +
 *                                          MagicBlock encrypted-queue ix)
 *   4. Wallet signs once, submits to base RPC.
 *   5. Record pending receipt to NilDB.
 *   6. Poll employee wallet ATA for settlement (≤ ~30s).
 *   7. PATCH receipt → settled.
 *
 * No session keypair, no TEE auth, no ER endpoint. The whole thing is one
 * wallet prompt + automatic settlement via MagicBlock's TEE crank.
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { PublicKey } from "@solana/web3.js";
import {
  Send,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Lock,
  Shield,
  Sparkles,
} from "lucide-react";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

import { useSolanaWallet, waitForSignature } from "@/lib/solana-wallet";
import { useCivitas } from "@/lib/civitas-provider";
import { getConnection } from "@/lib/solana-program";
import {
  CIVITAS_ER_MINT,
  fetchEmployerTreasury,
  type EmployerTreasury,
} from "@/lib/civitas-ephemeral-client";

type Phase =
  | "idle"
  | "preparing"
  | "signing"
  | "submitting"
  | "recording"
  | "settling"
  | "done"
  | "error";

interface DisburseResponse {
  success?: boolean;
  receiptId: string;
  transactionBase64: string;
  recentBlockhash: string;
  lastValidBlockHeight: number;
  requiredSigners: string[];
  queueValidator: string;
  ixCount: number;
  txBytes: number;
  error?: string;
}

interface PrepareResponse {
  success: boolean;
  mintInitTxBase64: string | null;
  ataTxBase64: string | null;
  queueValidator: string | null;
  employerAta: string;
  employeeAta: string;
  mintAlreadyInitialized: boolean;
  employerAtaExists: boolean;
  employeeAtaExists: boolean;
  error?: string;
}

const SETTLEMENT_POLL_MS = 2_000;
const SETTLEMENT_TIMEOUT_MS = 90_000;

export function DisbursePanel({ companyId }: { companyId?: string }) {
  const wallet = useSolanaWallet();
  const civitas = useCivitas();
  const userAddress = wallet.address ?? civitas.walletAddress;
  const baseConnection = useMemo(() => getConnection(), []);

  const [employeeAddress, setEmployeeAddress] = useState(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem("civitas_last_employee") ?? "";
  });
  const [amountStr, setAmountStr] = useState("10");
  const [split, setSplit] = useState(5);
  const [phase, setPhase] = useState<Phase>("idle");
  const [authorizeSig, setAuthorizeSig] = useState<string | null>(null);
  const [settlementSig, setSettlementSig] = useState<string | null>(null);
  const [employeeStartBal, setEmployeeStartBal] = useState<bigint>(0n);
  const [error, setError] = useState<string | null>(null);
  const [treasury, setTreasury] = useState<EmployerTreasury | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (employeeAddress) localStorage.setItem("civitas_last_employee", employeeAddress);
  }, [employeeAddress]);

  const loadTreasury = useCallback(async () => {
    if (!userAddress) return;
    try {
      const t = await fetchEmployerTreasury(baseConnection, new PublicKey(userAddress));
      setTreasury(t);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }, [baseConnection, userAddress]);

  useEffect(() => {
    loadTreasury();
  }, [loadTreasury]);

  // ─── Helpers ──────────────────────────────────────────────────────────────

  async function getEmployeeAtaBalance(employee: PublicKey): Promise<bigint> {
    const ata = getAssociatedTokenAddressSync(CIVITAS_ER_MINT, employee);
    try {
      const r = await baseConnection.getTokenAccountBalance(ata);
      return BigInt(r.value.amount);
    } catch {
      return 0n;
    }
  }

  async function signAndSubmit(b64: string): Promise<string> {
    if (!wallet.signTransactionOnly) {
      throw new Error("wallet.signTransactionOnly is not available");
    }
    // The disburse endpoint returns a legacy Transaction (employer is the
    // only signer). Sign locally then send via the base RPC. The wallet
    // returns raw signed bytes (Uint8Array), not base64.
    const signedBytes = await wallet.signTransactionOnly(b64);
    const sig = await baseConnection.sendRawTransaction(signedBytes, {
      skipPreflight: false,
      maxRetries: 5,
    });
    await waitForSignature(baseConnection, sig);
    return sig;
  }

  // ─── Disburse flow ────────────────────────────────────────────────────────

  const handleDisburse = useCallback(async () => {
    if (!userAddress) {
      setError("connect wallet first");
      return;
    }
    if (!treasury || treasury.complianceAttestedAt.eqn(0)) {
      setError("Run compliance + attestation in the Session panel first.");
      return;
    }
    const ageSecs =
      Math.floor(Date.now() / 1000) - treasury.complianceAttestedAt.toNumber();
    if (ageSecs > 86_400) {
      setError(`Compliance attestation is stale (${ageSecs}s old). Re-attest before disbursing.`);
      return;
    }

    let employee: PublicKey;
    try {
      employee = new PublicKey(employeeAddress.trim());
    } catch {
      setError("invalid employee pubkey");
      return;
    }

    const amount = BigInt(Math.floor(Number(amountStr) * 1_000_000));
    if (amount <= 0n) {
      setError("amount must be > 0");
      return;
    }
    const remaining = BigInt(
      treasury.totalShielded.sub(treasury.totalDisbursed).toString(),
    );
    if (remaining < amount) {
      setError(
        `Insufficient shielded balance: ${remaining} < ${amount}. Shield more funds first.`,
      );
      return;
    }

    setError(null);
    setAuthorizeSig(null);
    setSettlementSig(null);
    setPhase("preparing");
    try {
      const employer = new PublicKey(userAddress);
      const employerAta = getAssociatedTokenAddressSync(CIVITAS_ER_MINT, employer);
      const employeeAta = getAssociatedTokenAddressSync(CIVITAS_ER_MINT, employee);

      // ── Step 1: prepare (mint-init + ATA creation if needed) ──────────────
      const prepResp = await fetch("/api/payroll/prepare-atas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employer: employer.toBase58(),
          employee: employee.toBase58(),
        }),
      });
      const prep = (await prepResp.json()) as PrepareResponse;
      if (!prepResp.ok || prep.error) {
        throw new Error(prep.error ?? `prepare-atas ${prepResp.status}`);
      }

      // ATA creation tx (if any) — quick, one wallet prompt.
      if (prep.ataTxBase64) {
        setPhase("signing");
        const sig = await signAndSubmit(prep.ataTxBase64);
        console.log("[disburse] ATAs created:", sig);
      }
      // Mint init (one-time per mint).
      if (prep.mintInitTxBase64) {
        setPhase("signing");
        const sig = await signAndSubmit(prep.mintInitTxBase64);
        console.log("[disburse] mint initialized for private payments:", sig);
      }

      // Snapshot employee balance now so we can detect the settlement delta.
      const startBal = await getEmployeeAtaBalance(employee);
      setEmployeeStartBal(startBal);

      // ── Step 2: build the combined authorize + queue tx ───────────────────
      setPhase("preparing");
      const disburseResp = await fetch("/api/payroll/disburse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employer: employer.toBase58(),
          employee: employee.toBase58(),
          amount: amount.toString(),
          mint: CIVITAS_ER_MINT.toBase58(),
          split,
          minDelayMs: 500,
          maxDelayMs: 12_000,
        }),
      });
      const disburse = (await disburseResp.json()) as DisburseResponse;
      if (!disburseResp.ok || disburse.error) {
        throw new Error(disburse.error ?? `disburse ${disburseResp.status}`);
      }
      console.log(
        `[disburse] combined tx: ${disburse.ixCount} ixs, ${disburse.txBytes}B`,
      );

      // ── Step 3: wallet signs + submit ─────────────────────────────────────
      setPhase("signing");
      const txSig = await signAndSubmit(disburse.transactionBase64);
      setAuthorizeSig(txSig);

      // ── Step 4: record pending receipt to NilDB ───────────────────────────
      setPhase("recording");
      if (companyId) {
        try {
          await fetch("/api/payroll/receipts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              employer: employer.toBase58(),
              employee: employee.toBase58(),
              amount: amount.toString(),
              employerCompanyId: companyId,
              authorizeTxSig: txSig,
              receiptId: disburse.receiptId,
            }),
          });
        } catch (e) {
          console.warn("[disburse] receipt POST failed (non-fatal):", e);
        }
      }

      // ── Step 5: poll for settlement ───────────────────────────────────────
      setPhase("settling");
      const start = Date.now();
      let lastBal = startBal;
      while (Date.now() - start < SETTLEMENT_TIMEOUT_MS) {
        const cur = await getEmployeeAtaBalance(employee);
        if (cur > lastBal) {
          lastBal = cur;
          if (cur - startBal >= amount) {
            // Fully settled — try to find the credit tx (best-effort).
            try {
              const sigs = await baseConnection.getSignaturesForAddress(
                employeeAta,
                { limit: 5 },
                "confirmed",
              );
              if (sigs.length > 0) setSettlementSig(sigs[0].signature);
            } catch {}
            break;
          }
        }
        await new Promise((r) => setTimeout(r, SETTLEMENT_POLL_MS));
      }
      if (lastBal - startBal < amount) {
        console.warn("[disburse] settlement still incomplete after timeout");
      }

      // ── Step 6: PATCH receipt to settled ──────────────────────────────────
      if (companyId) {
        try {
          await fetch("/api/payroll/receipts", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              receiptId: disburse.receiptId,
              employerCompanyId: companyId,
              settlementTxSig: settlementSig ?? "",
            }),
          });
        } catch {}
      }

      setPhase("done");
      await loadTreasury();
    } catch (e: any) {
      console.error("[disburse]", e);
      setError(e?.message ?? String(e));
      setPhase("error");
    }
  }, [
    amountStr,
    baseConnection,
    companyId,
    employeeAddress,
    loadTreasury,
    settlementSig,
    split,
    treasury,
    userAddress,
    wallet,
  ]);

  // ─── Render ───────────────────────────────────────────────────────────────

  if (!userAddress) return null;

  const formatU64 = (b: bigint | string) => Number(b.toString()) / 1_000_000;
  const remaining = treasury
    ? BigInt(treasury.totalShielded.toString()) -
      BigInt(treasury.totalDisbursed.toString())
    : 0n;
  const complianceAge = treasury?.complianceAttestedAt
    ? Math.floor(Date.now() / 1000) - treasury.complianceAttestedAt.toNumber()
    : null;
  const complianceFresh = complianceAge !== null && complianceAge <= 86_400;

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
      className="rounded-2xl border border-white/[0.08] bg-white/[0.02] backdrop-blur-md p-5 space-y-4"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Send className="h-4 w-4 text-white/70" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/80">
            Private Disbursement
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-white/40">
          <Sparkles className="h-3.5 w-3.5" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em]">
            MagicBlock Encrypted Queue
          </span>
        </div>
      </div>

      {treasury && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
          <Stat label="Shielded" value={`${formatU64(treasury.totalShielded.toString()).toLocaleString()} USDC`} />
          <Stat label="Remaining" value={`${formatU64(remaining).toLocaleString()} USDC`} accent={remaining === 0n ? "amber" : undefined} />
          <Stat label="Today's spend" value={`${formatU64(treasury.dailyDisbursed.toString()).toLocaleString()} / ${formatU64(treasury.dailyLimit.toString()).toLocaleString()}`} />
          <Stat
            label="Compliance"
            value={
              complianceAge === null
                ? "—"
                : complianceFresh
                  ? `${Math.floor(complianceAge / 60)}m ago ✓`
                  : `${Math.floor(complianceAge / 3600)}h ago ✗`
            }
            accent={complianceFresh ? "emerald" : "amber"}
          />
        </div>
      )}

      <div className="grid sm:grid-cols-3 gap-3">
        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="text-[9px] uppercase tracking-[0.22em] text-white/40">
            Employee Wallet
          </span>
          <input
            value={employeeAddress}
            onChange={(e) => setEmployeeAddress(e.target.value.trim())}
            placeholder="Public key…"
            className="rounded-xl border border-white/[0.10] bg-white/[0.04] px-3 py-2 text-xs text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-white/30 font-mono"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[9px] uppercase tracking-[0.22em] text-white/40">
            Amount (USDC)
          </span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
            className="rounded-xl border border-white/[0.10] bg-white/[0.04] px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-white/30 tabular-nums"
          />
        </label>
      </div>

      <div className="flex items-center gap-3 text-[10px] text-white/40">
        <Lock className="h-3 w-3" />
        <span>
          On-chain authorization → encrypted queue → crank settles in 3-30s with{" "}
          <select
            value={split}
            onChange={(e) => setSplit(Number(e.target.value))}
            className="bg-transparent border-b border-white/20 text-white/70 focus:outline-none px-1"
          >
            {[1, 3, 5, 7, 10].map((n) => (
              <option key={n} value={n} className="bg-black">
                {n}
              </option>
            ))}
          </select>{" "}
          fragments
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={handleDisburse}
          disabled={phase !== "idle" && phase !== "done" && phase !== "error"}
          className="inline-flex items-center gap-2 rounded-full bg-white text-black px-5 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] hover:bg-white/90 disabled:opacity-40"
        >
          {phase === "idle" || phase === "done" || phase === "error" ? (
            <>
              <Send className="h-3.5 w-3.5" />
              Disburse Privately
            </>
          ) : (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {phaseLabel(phase)}
            </>
          )}
        </button>
        {phase === "settling" && (
          <span className="text-[10px] text-cyan-300/85 uppercase tracking-[0.18em] animate-pulse">
            Awaiting crank…
          </span>
        )}
      </div>

      {/* Status timeline */}
      {(authorizeSig || settlementSig || phase === "settling") && (
        <div className="space-y-1.5 rounded-xl border border-white/[0.06] bg-black/20 p-3">
          <TimelineRow
            done={!!authorizeSig}
            active={phase === "signing" || phase === "submitting" || phase === "recording"}
            icon={<Shield className="h-3 w-3" />}
            label="On-chain authorization + queue submission"
            sig={authorizeSig}
          />
          <TimelineRow
            done={!!settlementSig || phase === "done"}
            active={phase === "settling"}
            icon={<CheckCircle2 className="h-3 w-3" />}
            label="Private settlement to employee"
            sig={settlementSig}
          />
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/[0.04] p-3 text-[11px] text-red-300/90">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </motion.div>
  );
}

function phaseLabel(phase: Phase): string {
  switch (phase) {
    case "preparing":
      return "Preparing…";
    case "signing":
      return "Signing…";
    case "submitting":
      return "Submitting…";
    case "recording":
      return "Recording receipt…";
    case "settling":
      return "Settling…";
    default:
      return "…";
  }
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "emerald" | "amber";
}) {
  const color =
    accent === "emerald"
      ? "text-emerald-300/90"
      : accent === "amber"
        ? "text-amber-300/90"
        : "text-white/90";
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] uppercase tracking-[0.22em] text-white/40">{label}</span>
      <span className={`text-xs tabular-nums ${color}`}>{value}</span>
    </div>
  );
}

function TimelineRow({
  done,
  active,
  icon,
  label,
  sig,
}: {
  done: boolean;
  active: boolean;
  icon: React.ReactNode;
  label: string;
  sig: string | null;
}) {
  const color = done
    ? "text-emerald-300/90"
    : active
      ? "text-cyan-300/90"
      : "text-white/30";
  return (
    <div className={`flex items-center gap-2 text-[11px] ${color}`}>
      {active ? <Loader2 className="h-3 w-3 animate-spin" /> : icon}
      <span>{label}</span>
      {sig && (
        <a
          href={`https://explorer.solana.com/tx/${sig}?cluster=devnet`}
          target="_blank"
          rel="noreferrer"
          className="ml-auto font-mono text-[10px] underline-offset-2 hover:underline"
        >
          {sig.slice(0, 10)}… ↗
        </a>
      )}
    </div>
  );
}
