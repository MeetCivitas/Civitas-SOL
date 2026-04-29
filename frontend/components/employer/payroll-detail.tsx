"use client"

import { useState, useEffect, useCallback } from "react"
import { useCivitas } from "@/lib/civitas-provider"
import { useSolanaWallet } from "@/lib/solana-wallet"
import { buildExplorerUrl, SOLANA_CLUSTER_LABEL } from "@/lib/solana"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/ui/status-badge"
import { ArrowLeft, Copy, Download, RefreshCw, CheckCircle2, Clock, ExternalLink, Send, AlertCircle, Layers } from "lucide-react"
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

  // Try to find run in context first, then fetch from API
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

    // Fetch from API
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

      // Update context
      updatePayrollRun(run.runId, { status: "committed", txHash: lastSig })

      // Persist committed status to NilDB
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
        particleCount: 120,
        spread: 70,
        origin: { y: 0.6 },
        colors: ["#2dd4bf", "#34d399", "#3b82f6", "#a855f7"],
      })
    } catch (err: any) {
      setCommitStatus("error")
      setCommitError(err.message || "Commit failed")
    }
  }, [run, ownerAddress, signAndSendTransaction, updatePayrollRun])

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
        <p className="mt-4 text-sm text-white/40">Loading payroll run…</p>
      </div>
    )
  }

  if (!run) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Layers className="h-12 w-12 text-white/20 mb-4" />
        <p className="text-lg text-white/50 mb-2">Payroll run not found</p>
        <p className="text-sm text-white/30 mb-6">Run ID: <code className="font-mono">{runId}</code></p>
        <Link href="/employer">
          <Button variant="outline" className="bg-white/5 border-white/10 text-white hover:bg-white/10">
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
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <Link
        href="/employer"
        className="mb-6 inline-flex items-center gap-2 text-sm text-white/40 hover:text-white/70 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Dashboard
      </Link>

      {/* Header */}
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-light text-white tracking-tight">Payroll Run</h1>
            <StatusBadge status={run.status} />
          </div>
          <p className="mt-1 text-sm text-white/40">
            Created {new Date(run.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
          </p>
          <code className="mt-2 block font-mono text-xs text-white/30">{run.runId}</code>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="gap-2 bg-white/[0.03] border-white/[0.08] text-white/60 hover:bg-white/[0.06] hover:text-white"
            onClick={() => window.location.reload()}
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left column */}
        <div className="space-y-5">
          {/* Summary card */}
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 backdrop-blur-xl">
            <h2 className="mb-4 text-xs font-bold uppercase tracking-[0.2em] text-white/40">Summary</h2>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-white/50">Employees</span>
                <span className="font-semibold text-white">{run.employeeCount}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-white/50">Total</span>
                <span className="font-semibold text-white/70">*** USDC</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-white/50">Epoch</span>
                <span className="font-mono text-xs text-white/50">{run.epoch || "—"}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-white/50">Network</span>
                <span className="font-semibold text-blue-400">{SOLANA_CLUSTER_LABEL}</span>
              </div>
            </div>
          </div>

          {/* Merkle root card */}
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 backdrop-blur-xl">
            <h2 className="mb-4 text-xs font-bold uppercase tracking-[0.2em] text-white/40">ZK Proof Data</h2>
            <div className="space-y-3">
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs text-white/40">Merkle Root</span>
                  <button
                    onClick={handleCopyRoot}
                    className="flex items-center gap-1 text-[10px] text-white/30 hover:text-white/60 transition-colors"
                  >
                    <Copy className="h-3 w-3" />
                    {copied ? "Copied!" : "Copy"}
                  </button>
                </div>
                <code className="block break-all rounded-lg bg-black/30 p-3 text-[10px] font-mono text-blue-300 border border-blue-500/10">
                  {root || "pending"}
                </code>
              </div>
              <div>
                <span className="text-xs text-white/40">Commitments</span>
                <div className="mt-1 rounded-lg bg-black/30 p-3 border border-white/5">
                  <span className="text-sm font-semibold text-white">{run.commitments?.length ?? 0}</span>
                  <span className="text-xs text-white/40 ml-2">sealed</span>
                </div>
              </div>
            </div>
          </div>

          {/* Commit to Solana card */}
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 backdrop-blur-xl relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 blur-[60px] pointer-events-none" />
            <div className="relative z-10">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-white/40">Commit to Solana</h2>
                <span className="text-[9px] uppercase tracking-widest text-blue-400/60 font-bold bg-blue-500/10 px-2 py-0.5 rounded-full border border-blue-500/15">
                  ZK Payroll
                </span>
              </div>
              <p className="text-xs text-white/40 mb-4 leading-relaxed">
                Broadcast Poseidon commitments on-chain to Solana. Creates an immutable Merkle root that employees can claim against.
              </p>

              {commitError && (
                <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3">
                  <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-red-300">{commitError}</p>
                </div>
              )}

              {commitStatus === "success" && commitTx ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 rounded-xl border border-teal-500/20 bg-teal-500/10 p-3">
                    <CheckCircle2 className="h-4 w-4 text-teal-400 shrink-0" />
                    <p className="text-xs text-teal-300 font-medium">Payroll committed on-chain</p>
                  </div>
                  {commitTx !== "pending" && (
                    <a
                      href={buildExplorerUrl("tx", commitTx)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 text-xs text-blue-400 hover:text-blue-300 transition-colors bg-blue-500/10 px-3 py-2 rounded-lg border border-blue-500/15 w-full justify-center"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      View on Solana Explorer
                    </a>
                  )}
                </div>
              ) : isCommitted && run.txHash ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 rounded-xl border border-teal-500/20 bg-teal-500/10 p-3">
                    <CheckCircle2 className="h-4 w-4 text-teal-400 shrink-0" />
                    <p className="text-xs text-teal-300 font-medium">Already committed on-chain</p>
                  </div>
                  <a
                    href={buildExplorerUrl("tx", run.txHash)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 text-xs text-blue-400 hover:text-blue-300 transition-colors bg-blue-500/10 px-3 py-2 rounded-lg border border-blue-500/15 w-full justify-center"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    View Transaction
                  </a>
                </div>
              ) : (
                <Button
                  onClick={handleCommit}
                  disabled={commitStatus === "loading" || !ownerAddress || !run.commitments?.length}
                  className="w-full bg-blue-600/90 hover:bg-blue-500 text-white border border-blue-400/20 shadow-[0_0_20px_rgba(37,99,235,0.25)] rounded-xl"
                >
                  {commitStatus === "loading" ? (
                    <>
                      <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/20 border-t-white mr-2" />
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
        </div>

        {/* Right column — commitments + timeline */}
        <div className="lg:col-span-2 space-y-5">
          {/* Commitments preview */}
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] backdrop-blur-xl overflow-hidden">
            <div className="border-b border-white/[0.06] bg-white/[0.03] px-5 py-4">
              <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-white/40">
                ZK Commitments ({run.commitments?.length ?? 0})
              </h2>
            </div>
            <div className="p-5">
              {run.commitments && run.commitments.length > 0 ? (
                <div className="space-y-2 max-h-64 overflow-y-auto pr-2">
                  {run.commitments.slice(0, 10).map((c, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-3 rounded-xl border border-white/[0.05] bg-black/20 px-4 py-3"
                    >
                      <div className="h-6 w-6 shrink-0 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                        <span className="text-[9px] font-bold text-blue-400">{i + 1}</span>
                      </div>
                      <code className="font-mono text-[10px] text-white/40 truncate flex-1">
                        {c.slice(0, 24)}…{c.slice(-8)}
                      </code>
                    </div>
                  ))}
                  {run.commitments.length > 10 && (
                    <p className="text-center text-xs text-white/30 py-2">
                      +{run.commitments.length - 10} more commitments sealed
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-white/30 text-center py-8">No commitments data available</p>
              )}
            </div>
          </div>

          {/* Timeline */}
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 backdrop-blur-xl">
            <h2 className="mb-5 text-xs font-bold uppercase tracking-[0.2em] text-white/40">Timeline</h2>
            <div className="space-y-4">
              {events.map((event, i) => (
                <div key={i} className="flex gap-4">
                  <div className="relative flex flex-col items-center">
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-colors ${
                        i === events.length - 1
                          ? "border-teal-500/30 bg-teal-500/10"
                          : "border-blue-500/20 bg-blue-500/10"
                      }`}
                    >
                      {i === events.length - 1 ? (
                        <CheckCircle2 className="h-4 w-4 text-teal-400" />
                      ) : (
                        <Clock className="h-4 w-4 text-blue-400" />
                      )}
                    </div>
                    {i < events.length - 1 && (
                      <div className="mt-2 h-full w-px bg-white/[0.06]" />
                    )}
                  </div>
                  <div className="pb-4 pt-1">
                    <p className="text-sm font-medium text-white/80">{event.text}</p>
                    <p className="text-xs text-white/30 mt-0.5">
                      {event.ts ? new Date(event.ts).toLocaleString() : "—"}
                    </p>
                  </div>
                </div>
              ))}
              {(commitStatus === "success" || (isCommitted && run.txHash)) && (
                <div className="flex gap-4">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-teal-500/30 bg-teal-500/10">
                    <CheckCircle2 className="h-4 w-4 text-teal-400" />
                  </div>
                  <div className="pt-1">
                    <p className="text-sm font-medium text-teal-300">Committed to Solana</p>
                    <p className="text-xs text-white/30 mt-0.5">Merkle root anchored on-chain</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  )
}
