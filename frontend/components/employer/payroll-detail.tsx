"use client"

import { useState, useEffect, useCallback } from "react"
import { useCivitas } from "@/lib/civitas-provider"
import { useSolanaWallet } from "@/lib/solana-wallet"
import { buildExplorerUrl, SOLANA_CLUSTER_LABEL } from "@/lib/solana"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/ui/status-badge"
import {
  ArrowLeft, Copy, RefreshCw, CheckCircle2, Clock, ExternalLink, Send,
  AlertCircle, Layers,
} from "lucide-react"
import Link from "next/link"
import { motion } from "framer-motion"
import confetti from "canvas-confetti"

interface PayrollRun {
  runId: string
  orgId?: string
  createdBy?: string
  createdAt: string
  status: string
  employeeCount: number
  declaredTotal?: string
  currency?: string
  payrollRoot?: string
  merkleRoot?: string
  proofHash?: string
  commitments?: string[]
  epoch?: string
  txHash?: string
  events?: Array<{ ts: string; text: string }>
}

export function PayrollDetail({ runId }: { runId: string }) {
  const { walletAddress, payrollRuns, updatePayrollRun } = useCivitas()
  const { address: connectedAddress, signAndSendTransaction } = useSolanaWallet()
  const ownerAddress = connectedAddress || walletAddress

  const [run, setRun] = useState<PayrollRun | null>(null)
  const [loading, setLoading] = useState(true)
  const [commitStatus, setCommitStatus] = useState<"idle" | "loading" | "success" | "error">("idle")
  const [commitError, setCommitError] = useState("")
  const [commitTx, setCommitTx] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const contextRun = payrollRuns.find((r) => r.runId === runId)
    if (contextRun) {
      setRun({
        runId: contextRun.runId,
        createdAt: contextRun.createdAt || new Date().toISOString(),
        status: contextRun.status || "draft",
        employeeCount: contextRun.employeeCount || 0,
        declaredTotal: contextRun.totalAmount || "0",
        currency: "USDC",
        payrollRoot: contextRun.merkleRoot || "",
        merkleRoot: contextRun.merkleRoot || "",
        commitments: contextRun.commitments || [],
        epoch: contextRun.epoch || "",
        txHash: contextRun.txHash || "",
        events: [
          { ts: contextRun.createdAt || new Date().toISOString(), text: "Payroll run created" },
          ...(contextRun.txHash ? [{ ts: new Date().toISOString(), text: "Committed on-chain" }] : []),
        ],
      })
      setLoading(false)
      return
    }

    if (!ownerAddress) { setLoading(false); return; }

    fetch(`/api/employer/payrolls?address=${encodeURIComponent(ownerAddress)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success && Array.isArray(data.payrollRuns)) {
          const found = data.payrollRuns.find((r: PayrollRun) => r.runId === runId)
          setRun(found || null)
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [runId, payrollRuns, ownerAddress])

  const handleCopyRoot = async () => {
    const root = run?.payrollRoot || run?.merkleRoot || ""
    if (!root) return
    await navigator.clipboard.writeText(root)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const handleCommit = useCallback(async () => {
    if (!run || !ownerAddress) {
      setCommitError("Wallet not connected")
      return
    }
    if (run.status?.toLowerCase() === "committed") {
      setCommitError("This run is already committed on-chain")
      return
    }

    setCommitStatus("loading")
    setCommitError("")
    setCommitTx(null)

    try {
      const res = await fetch("/api/payroll/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId: run.runId,
          employerAddress: ownerAddress,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Commit failed (${res.status})`)

      let lastSig = data.txHash || ""
      if (Array.isArray(data.transactions) && data.transactions.length > 0) {
        for (const serializedTx of data.transactions) {
          lastSig = await signAndSendTransaction(serializedTx)
        }
      }

      setCommitTx(lastSig || "pending")
      setCommitStatus("success")
      updatePayrollRun(run.runId, { status: "committed", txHash: lastSig })

      fetch("/api/payroll/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId: run.runId,
          employerAddress: ownerAddress,
          txHash: lastSig,
        }),
      }).catch((e) => console.warn("[PayrollDetail] confirm status update failed:", e))

      confetti({
        particleCount: 110,
        spread: 70,
        origin: { y: 0.6 },
        colors: ["#ffffff", "#cccccc", "#888888"],
      })
    } catch (err: any) {
      setCommitStatus("error")
      setCommitError(err.message || "Commit failed")
    }
  }, [run, ownerAddress, signAndSendTransaction, updatePayrollRun])

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="h-9 w-9 animate-spin rounded-full border-2 border-white/15 border-t-white" />
        <p className="mt-4 text-sm text-white/40">Loading payroll run…</p>
      </div>
    )
  }

  if (!run) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Layers className="h-12 w-12 text-white/20 mb-4" />
        <p className="text-lg text-white/55 mb-2">Payroll run not found</p>
        <p className="text-sm text-white/30 mb-6">Run ID: <code className="font-mono">{runId}</code></p>
        <Link href="/employer">
          <Button variant="outline" className="bg-white/[0.04] border-white/[0.10] text-white hover:bg-white/[0.08]">
            Back to Dashboard
          </Button>
        </Link>
      </div>
    )
  }

  const root = run.payrollRoot || run.merkleRoot || ""
  const isCommitted = run.status?.toLowerCase() === "committed" || run.txHash
  const events = run.events || [{ ts: run.createdAt, text: "Payroll run created" }]

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
    >
      <Link
        href="/employer"
        className="mb-6 inline-flex items-center gap-2 text-[12px] text-white/45 hover:text-white transition-colors uppercase tracking-[0.18em]"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Dashboard
      </Link>

      {/* ── Header ─────────────────────────────────── */}
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[10px] font-semibold tracking-[0.28em] uppercase text-white/40 mb-2">Payroll Engine</p>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-3xl font-light tracking-[-0.03em] text-white">Payroll Run</h1>
            <StatusBadge status={run.status} />
          </div>
          <p className="mt-1.5 text-sm text-white/45">
            Created {new Date(run.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
          </p>
          <code className="mt-2 inline-block font-mono text-[11px] text-white/35 bg-white/[0.03] border border-white/[0.06] rounded-md px-2 py-1">
            {run.runId}
          </code>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="gap-2 bg-white/[0.04] border-white/[0.10] text-white/70 hover:bg-white/[0.08] hover:text-white"
            onClick={() => window.location.reload()}
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* ── Left column ─────────────────────────── */}
        <div className="space-y-5">
          {/* Summary */}
          <div className="surface rounded-2xl p-5 backdrop-blur-xl">
            <h2 className="mb-4 text-[10px] font-semibold uppercase tracking-[0.22em] text-white/45">Summary</h2>
            <dl className="space-y-3">
              {[
                { label: "Employees", value: <span className="num text-white">{run.employeeCount}</span> },
                { label: "Total",     value: <span className="num text-white/85">*** USDC</span> },
                { label: "Epoch",     value: <span className="font-mono text-[11px] text-white/55">{run.epoch || "N/A"}</span> },
                { label: "Network",   value: <span className="text-sm font-semibold text-white">{SOLANA_CLUSTER_LABEL}</span> },
              ].map(row => (
                <div key={row.label} className="flex justify-between items-center">
                  <dt className="text-[12px] text-white/50">{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          </div>

          {/* ZK Proof */}
          <div className="surface rounded-2xl p-5 backdrop-blur-xl">
            <h2 className="mb-4 text-[10px] font-semibold uppercase tracking-[0.22em] text-white/45">ZK Proof Data</h2>
            <div className="space-y-3">
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[11px] text-white/45">Merkle Root</span>
                  <button
                    onClick={handleCopyRoot}
                    className="flex items-center gap-1 text-[10px] text-white/45 hover:text-white transition-colors"
                  >
                    <Copy className="h-3 w-3" />
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
                <code className="block break-all rounded-lg bg-black/40 p-3 text-[10px] font-mono text-white/80 border border-white/[0.06]">
                  {root || "pending"}
                </code>
              </div>
              <div>
                <span className="text-[11px] text-white/45">Commitments</span>
                <div className="mt-1.5 rounded-lg bg-black/30 p-3 border border-white/[0.06] flex items-baseline gap-2">
                  <span className="num text-base font-semibold text-white">{run.commitments?.length ?? 0}</span>
                  <span className="text-[10px] uppercase tracking-[0.22em] text-white/35">sealed</span>
                </div>
              </div>
            </div>
          </div>

          {/* Commit to Solana */}
          <div className="surface rounded-2xl p-5 backdrop-blur-xl relative overflow-hidden">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/45">Commit to Solana</h2>
              <span className="text-[9px] uppercase tracking-[0.22em] text-white/65 font-semibold bg-white/[0.05] px-2 py-0.5 rounded-md border border-white/[0.10]">
                ZK Payroll
              </span>
            </div>
            <p className="text-[12px] text-white/45 mb-4 leading-relaxed">
              Broadcast Poseidon commitments on-chain. Creates an immutable Merkle root that
              employees can claim against.
            </p>

            {commitError && (
              <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/[0.06] p-3">
                <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                <p className="text-[12px] text-red-300">{commitError}</p>
              </div>
            )}

            {commitStatus === "success" && commitTx ? (
              <div className="space-y-2.5">
                <div className="flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.05] p-3">
                  <CheckCircle2 className="h-4 w-4 text-white shrink-0" />
                  <p className="text-[12px] text-white font-medium">Payroll committed on-chain</p>
                </div>
                {commitTx !== "pending" && (
                  <a
                    href={buildExplorerUrl("tx", commitTx)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 text-[12px] text-white/85 hover:text-white transition-colors bg-white/[0.04] hover:bg-white/[0.08] px-3 py-2 rounded-lg border border-white/[0.10] w-full justify-center"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    View on Solana Explorer
                  </a>
                )}
              </div>
            ) : isCommitted && run.txHash ? (
              <div className="space-y-2.5">
                <div className="flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.05] p-3">
                  <CheckCircle2 className="h-4 w-4 text-white shrink-0" />
                  <p className="text-[12px] text-white font-medium">Already committed on-chain</p>
                </div>
                <a
                  href={buildExplorerUrl("tx", run.txHash)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 text-[12px] text-white/85 hover:text-white transition-colors bg-white/[0.04] hover:bg-white/[0.08] px-3 py-2 rounded-lg border border-white/[0.10] w-full justify-center"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  View Transaction
                </a>
              </div>
            ) : (
              <Button
                onClick={handleCommit}
                disabled={commitStatus === "loading" || !ownerAddress || !run.commitments?.length}
                className="w-full bg-white text-black hover:bg-white/90 rounded-xl py-5 text-[11px] font-semibold uppercase tracking-[0.2em]"
              >
                {commitStatus === "loading" ? (
                  <>
                    <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-black/20 border-t-black mr-2" />
                    Broadcasting…
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4 mr-2" />
                    Commit to Solana
                  </>
                )}
              </Button>
            )}
          </div>
        </div>

        {/* ── Right column ────────────────────────── */}
        <div className="lg:col-span-2 space-y-5">
          <div className="surface rounded-2xl backdrop-blur-xl overflow-hidden">
            <div className="border-b border-white/[0.06] bg-white/[0.02] px-5 py-4 flex items-center justify-between">
              <h2 className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/45">
                ZK Commitments
              </h2>
              <span className="num text-[11px] text-white/55">{run.commitments?.length ?? 0}</span>
            </div>
            <div className="p-5">
              {run.commitments && run.commitments.length > 0 ? (
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {run.commitments.slice(0, 12).map((c, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-black/20 px-4 py-3 hover:bg-white/[0.03] transition-colors"
                    >
                      <div className="h-6 w-6 shrink-0 rounded-md bg-white/[0.05] border border-white/[0.10] flex items-center justify-center">
                        <span className="num text-[9px] font-semibold text-white/70">{i + 1}</span>
                      </div>
                      <code className="font-mono text-[10px] text-white/55 truncate flex-1">
                        {c.slice(0, 28)}…{c.slice(-8)}
                      </code>
                    </div>
                  ))}
                  {run.commitments.length > 12 && (
                    <p className="text-center text-[11px] text-white/35 py-2">
                      +{run.commitments.length - 12} more commitments sealed
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-white/35 text-center py-8">No commitments data available</p>
              )}
            </div>
          </div>

          <div className="surface rounded-2xl p-5 backdrop-blur-xl">
            <h2 className="mb-5 text-[10px] font-semibold uppercase tracking-[0.22em] text-white/45">Timeline</h2>
            <ol className="space-y-4">
              {events.map((event, i) => (
                <li key={i} className="flex gap-4">
                  <div className="relative flex flex-col items-center">
                    <div
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${
                        i === events.length - 1
                          ? "border-white/40 bg-white/[0.08]"
                          : "border-white/15 bg-white/[0.04]"
                      }`}
                    >
                      {i === events.length - 1 ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-white" />
                      ) : (
                        <Clock className="h-3.5 w-3.5 text-white/55" />
                      )}
                    </div>
                    {i < events.length - 1 && <div className="mt-1.5 h-full w-px bg-white/[0.08]" />}
                  </div>
                  <div className="pb-3 pt-0.5">
                    <p className="text-sm font-medium text-white/85">{event.text}</p>
                    <p className="text-[11px] text-white/35 mt-0.5 font-mono">
                      {event.ts ? new Date(event.ts).toLocaleString() : "Pending"}
                    </p>
                  </div>
                </li>
              ))}
              {(commitStatus === "success" || (isCommitted && run.txHash)) && (
                <li className="flex gap-4">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/40 bg-white/[0.08]">
                    <CheckCircle2 className="h-3.5 w-3.5 text-white" />
                  </div>
                  <div className="pt-0.5">
                    <p className="text-sm font-medium text-white">Committed to Solana</p>
                    <p className="text-[11px] text-white/35 mt-0.5">Merkle root anchored on-chain</p>
                  </div>
                </li>
              )}
            </ol>
          </div>
        </div>
      </div>
    </motion.div>
  )
}
