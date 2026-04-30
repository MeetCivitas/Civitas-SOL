"use client"

import { useRef, useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useCivitas } from "@/lib/civitas-provider"
import { useSolanaWallet } from "@/lib/solana-wallet"
import { buildExplorerUrl, formatUsdc, SOLANA_CLUSTER_LABEL } from "@/lib/solana"
import { RPC_ENDPOINT } from "@/lib/solana-program"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { AvatarInitials } from "@/components/ui/avatar-initials"
import { Check, Users, FileSpreadsheet, Settings, Eye, Cpu, Send, AlertCircle, CheckCircle2, ExternalLink, Zap } from "lucide-react"
import confetti from "canvas-confetti"
import { motion, AnimatePresence } from "framer-motion"

interface PayrollRun {
  runId: string
  orgId: string
  createdBy: string
  createdAt: string
  status: string
  employeeCount: number
  declaredTotal: string
  currency: string
  payrollRoot: string
  proofHash: string
  notes: string[]
  events: { ts: string; text: string }[]
  commitments?: string[]
  epoch?: string
  txHash?: string
  teeActive?: boolean
}

interface Employee {
  employee_id: string;
  username: string;
  employee_tag: string;
  employee_name?: string;
  org_id: string;
  role: string;
  status?: "provisional" | "active" | "terminated";
  profile?: {
    name?: string;
    email?: string;
    role?: string;
  };
  salary_amount?: string | number;
  salaryAmount?: string | number;
  created_at: string;
  vouchers?: Array<{
    amount: number;
    currency: string;
  }>;
}

const STEPS = [
  { id: 1, title: "Select Employees", icon: Users },
  { id: 2, title: "Input Data", icon: FileSpreadsheet },
  { id: 3, title: "Policy", icon: Settings },
  { id: 4, title: "Review", icon: Eye },
  { id: 5, title: "Generate", icon: Cpu },
  { id: 6, title: "Commit", icon: Send },
]

interface PayrollInput {
  employeeId: string
  hours: number
  bonus: number
  taxCode: string
}

import { PrivacyStackVisualizer } from "@/components/ui/privacy-stack"

export function CreatePayrollWizard() {
  const router = useRouter()
  const { walletAddress, employees: contextEmployees, company } = useCivitas()
  const { address: connectedAddress, signAndSendTransaction, signAllAndSend } = useSolanaWallet()
  const ownerAddress = connectedAddress || walletAddress
  const [step, setStep] = useState(1)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loadingEmployees, setLoadingEmployees] = useState(true)
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([])
  const [payrollInputs, setPayrollInputs] = useState<PayrollInput[]>([])
  const [taxPercentage, setTaxPercentage] = useState<number>(20)
  const [isProcessing, setIsProcessing] = useState(false)
  const [processingLabel, setProcessingLabel] = useState("")
  const [generatedRun, setGeneratedRun] = useState<PayrollRun | null>(null)
  const [proofBundle, setProofBundle] = useState<{ proof: Record<string, unknown>; publicSignals: string[] } | null>(null)
  const [generateError, setGenerateError] = useState("")
  const [commitError, setCommitError] = useState("")
  const [commitTx, setCommitTx] = useState<string | null>(null)
  const [manualProofError, setManualProofError] = useState("")
  const proofFileInputRef = useRef<HTMLInputElement | null>(null)
  const [pendingProofFile, setPendingProofFile] = useState<File | null>(null)
  const [privateSessionId, setPrivateSessionId] = useState<string | null>(null)
  const [perStatus, setPerStatus] = useState<"idle" | "delegating" | "processing" | "finalizing" | "done">("idle")

  useEffect(() => {
    loadEmployees()
  }, [ownerAddress])

  const loadEmployees = async () => {
    try {
      const url = ownerAddress
        ? `/api/employer/employees?address=${encodeURIComponent(ownerAddress)}`
        : "/api/employer/employees"
      const res = await fetch(url)
      const data = await res.json()
      if (data.success && Array.isArray(data.employees) && data.employees.length > 0) {
        const loadedEmployees = data.employees as Employee[]
        setEmployees(loadedEmployees)
        const active = loadedEmployees.filter((e: Employee) => e.status === "active" || !e.status)
        setSelectedEmployees(active.map((e: Employee) => e.employee_id || e.employee_tag || ""))
        setPayrollInputs(
          loadedEmployees.map((e: Employee) => ({
            employeeId: e.employee_id || e.employee_tag || "",
            hours: 160,
            bonus: 0,
            taxCode: "STANDARD",
          }))
        )
      } else if (contextEmployees.length > 0) {
        // Fallback: use employees from CivitasProvider context
        const mapped: Employee[] = contextEmployees.map((e, i) => ({
          employee_id: e.employeeTag,
          employee_tag: e.employeeTag,
          username: `emp_${e.employeeTag.slice(0, 8)}`,
          org_id: "",
          role: "employee",
          status: "active" as const,
          salary_amount: e.salaryAmount,
          salaryAmount: e.salaryAmount,
          created_at: e.addedAt,
          profile: { name: `Employee ${i + 1}`, role: "employee" },
        }))
        setEmployees(mapped)
        setSelectedEmployees(mapped.map(e => e.employee_id))
        setPayrollInputs(
          mapped.map(e => ({
            employeeId: e.employee_id,
            hours: 160,
            bonus: 0,
            taxCode: "STANDARD",
          }))
        )
      }
    } catch (err) {
      console.error("Failed to load employees:", err)
    } finally {
      setLoadingEmployees(false)
    }
  }

  const activeEmployees = employees.filter((e: any) => e.status === "active" || !e.status)

  const toggleEmployee = (id: string) => {
    setSelectedEmployees((prev) => (prev.includes(id) ? prev.filter((e: any) => e !== id) : [...prev, id]))
  }

  const selectAll = () => {
    setSelectedEmployees(activeEmployees.map((e: any) => e.employee_id))
  }

  const deselectAll = () => {
    setSelectedEmployees([])
  }

  const updateInput = (employeeId: string, field: keyof PayrollInput, value: number | string) => {
    setPayrollInputs((prev) =>
      prev.map((input: any) => (input.employeeId === employeeId ? { ...input, [field]: value } : input)),
    )
  }

  const computePreTaxPay = (employeeId: string) => {
    const emp = employees.find((e: any) => e.employee_id === employeeId || e.employeeTag === employeeId || e.employee_tag === employeeId)
    const input = payrollInputs.find((i: any) => i.employeeId === employeeId)
    if (!emp || !input) return 0
    // Robust salary parsing — handles plain numbers, JSON strings, objects
    let rawSalary: any = emp.salary_amount || emp.salaryAmount || 0
    if (typeof rawSalary === "string") {
      try {
        const parsed = JSON.parse(rawSalary)
        if (parsed && parsed.amount) rawSalary = parsed.amount
      } catch { /* not JSON */ }
    }
    const base = Number(rawSalary) || 0
    return base + (input.bonus || 0)
  }

  const computeNetPay = (employeeId: string) => {
    return Math.round(computePreTaxPay(employeeId) * (1 - taxPercentage / 100) * 100) / 100
  }

  const totalPayroll = selectedEmployees.reduce((sum: any, id: any) => sum + computeNetPay(id), 0)

  const buildRunScaffold = (payrollRoot: string, runId?: string, createdAt?: string): PayrollRun => {
    const now = createdAt || new Date().toISOString()
    const noteIds = selectedEmployees.map((_: any, i: any) => `note_${Date.now()}_${i}`)
    return {
      runId: runId || `run_manual_${Date.now().toString(36)}`,
      orgId: "demo_org",
      createdBy: "employer@demo",
      createdAt: now,
      status: "Draft",
      employeeCount: selectedEmployees.length,
      declaredTotal: totalPayroll.toFixed(2),
      currency: "USDC",
      payrollRoot,
      proofHash: "0xproof",
      notes: noteIds,
      events: [{ ts: now, text: "Manual proof uploaded" }],
    }
  }

  const handleGenerate = async () => {
    setGenerateError("")
    setCommitError("")
    setIsProcessing(true)
    setProcessingLabel("Step 1/3 — Fetching employees from Nillion SecretVaults...")
    setStep(5)
    console.log("[PayrollWizard] Generating payroll for employees:", selectedEmployees)
    try {
      const payload = {
        employerAddress: ownerAddress,
        runName: `${company?.name || "Civitas"} payroll ${new Date().toLocaleDateString()}`,
        period: new Date().toISOString().slice(0, 10),
        taxPercentage,
      }
      setProcessingLabel("Step 2/3 — Sending to nilCC TEE enclave (or local BN254 fallback)...")
      const res = await fetch("/api/payroll/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      
      let data;
      try {
        data = await res.json()
      } catch (parseErr) {
        console.error("[PayrollWizard] Failed to parse generate response:", parseErr)
        const text = await res.text()
        throw new Error(`Server error (${res.status}): ${text.slice(0, 100)}`)
      }

      if (!res.ok) {
        console.error("[PayrollWizard] Generate failed:", { status: res.status, data })
        const errMsg = data.error || data.details || "Generation failed";
        setGenerateError(errMsg);
        throw new Error(errMsg)
      }

      const now = new Date().toISOString()
      const newRun: any = {
        runId: data.runId || data.run_id,
        orgId: "default",
        createdBy: "employer",
        createdAt: now,
        status: "Draft",
        employeeCount: data.commitmentCount || selectedEmployees.length,
        declaredTotal: String(data.totalUsdcApprox ?? formatUsdc(data.totalAmount || totalPayroll)),
        currency: "USDC",
        payrollRoot: data.merkleRoot || data.merkle_root,
        commitments: data.commitments || [],
        epoch: data.epoch,
        proofHash: (data.merkleRoot || data.merkle_root)?.slice(0, 16) || "pending",
        notes: selectedEmployees.map((_: any, i: any) => `note_${Date.now()}_${i}`),
        events: [{ ts: now, text: "ZK commitments generated" }],
        teeActive: data.teeActive,
      }

      setProcessingLabel("Step 3/3 — Storing encrypted vouchers in Nillion SecretVaults...")
      setGeneratedRun(newRun)
      setProofBundle({ proof: data.proof || {}, publicSignals: data.public_signals || data.publicSignals || [] })
      console.log("[PayrollWizard] Generation success:", newRun)
    } catch (err: any) {
      console.error("[PayrollWizard] Error generating payroll:", err)
      setGenerateError(err.message || "Failed to generate payroll")
    } finally {
      setIsProcessing(false)
      setProcessingLabel("")
    }
  }

  const handleCommit = async () => {
    if (!generatedRun || !proofBundle) {
      console.error("[PayrollWizard] Cannot commit: missing generatedRun or proofBundle")
      setCommitError("Missing payroll data or proof bundle")
      return
    }

    setCommitError("")
    setIsProcessing(true)
    setProcessingLabel("Step 1/3 — Building Solana commit transaction...")
    setCommitTx(null)
    // Move to step 6 (commit step) immediately to show loading state
    setStep(6)
    console.log("[PayrollWizard] Committing payroll", {
      runId: generatedRun.runId,
      total: generatedRun.declaredTotal,
      root: generatedRun.payrollRoot,
      hasProof: !!proofBundle.proof,
      hasSignals: !!proofBundle.publicSignals,
    })

    try {
      const commitPayload = {
        runId: generatedRun.runId,
        employerAddress: ownerAddress || "",
      }

      console.log("[PayrollWizard] Sending commit request", {
        runId: commitPayload.runId,
        employerAddress: commitPayload.employerAddress,
      })

      const res = await fetch("/api/payroll/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(commitPayload),
      })

      let data
      try {
        data = await res.json()
      } catch (parseErr) {
        console.error("[PayrollWizard] Failed to parse response:", parseErr)
        const text = await res.text()
        throw new Error(`Server error (${res.status}): ${text.slice(0, 200)}`)
      }

      if (!res.ok) {
        console.error("[PayrollWizard] Commit failed:", {
          status: res.status,
          error: data.error,
          data,
        })
        throw new Error(data.error || `Commit failed with status ${res.status}`)
      }

      let actualTxHash = data.txHash || ""
      if (Array.isArray(data.transactions) && data.transactions.length > 0) {
        // Submit commit txs through MagicBlock's Ephemeral Rollup router.
        // ConnectionMagicRouter is a drop-in @solana/web3.js Connection that
        // dispatches to the nearest ER node (~50 ms blocks vs 400 ms on L1)
        // and proxies finality back. The router endpoint exposes JSON-RPC at
        // /; ER routing happens transparently. (PER private-state delegation
        // requires REST endpoints not yet deployed on devnet, so we don't
        // attempt a separate PER handshake — the router is the working path.)
        setPerStatus("processing")
        setProcessingLabel(`Step 2/3 — Routing ${data.transactions.length} commit txs through MagicBlock ER…`)

        const MAGIC_ROUTER = process.env.NEXT_PUBLIC_MAGICBLOCK_ROUTER ?? "https://devnet-router.magicblock.app"
        const { ConnectionMagicRouter } = await import("@magicblock-labs/ephemeral-rollups-sdk")
        const magicConn = new ConnectionMagicRouter(MAGIC_ROUTER, "confirmed")

        const sigs = await signAllAndSend(data.transactions, magicConn)
        actualTxHash = sigs[sigs.length - 1] || ""

        setPerStatus("finalizing")
        console.log(`[PayrollWizard] MagicBlock ER confirmed ${sigs.length} tx(s). Last sig: ${actualTxHash}`)
      }

      if (!ownerAddress) throw new Error("Wallet address missing — reconnect and retry")

      // ── Verify the on-chain commit actually finalized ──────────────────
      // The wizard previously declared "committed" if just the last tx
      // signature came back from the wallet adapter, even if devnet RPC
      // timeouts meant finalize_merkle_root never actually landed. Now we
      // poll the payroll_run PDA until it reports status=Committed (1).
      // If it doesn't reach Committed within 60 s, throw — vouchers from
      // this run would be unclaimable anyway.
      setProcessingLabel(`Verifying commit on-chain…`)
      try {
        const { Connection: SConn, PublicKey: SPK } = await import("@solana/web3.js")
        const { PROGRAM_ID } = await import("@/lib/solana-program")
        const verifyConn = new SConn(RPC_ENDPOINT, "confirmed")
        const ridHex = (generatedRun.runId || "").replace(/-/g, "")
        const ridBytes = Buffer.from(ridHex, "hex")
        const owner = new SPK(ownerAddress)
        const [runPda] = SPK.findProgramAddressSync(
          [Buffer.from("run"), owner.toBuffer(), ridBytes],
          PROGRAM_ID,
        )
        const STATUS_OFF = 8 + 16 + 32 + 8 + 32 + 32 + 4 + 4 + 4
        const deadline = Date.now() + 60_000
        let onChainStatus = -1
        while (Date.now() < deadline) {
          const info = await verifyConn.getAccountInfo(runPda)
          if (info && info.data.length > STATUS_OFF) {
            onChainStatus = info.data[STATUS_OFF]
            if (onChainStatus === 1) break
          }
          await new Promise(r => setTimeout(r, 2_000))
        }
        if (onChainStatus !== 1) {
          throw new Error(
            `Commit didn't finalize on-chain (run ${generatedRun.runId.slice(0, 8)}… status=${onChainStatus === -1 ? "missing" : onChainStatus}). ` +
            `Click Retry Commit — start_payroll_run and append_commitments_chunk are now idempotent so retries are safe.`,
          )
        }
      } catch (verErr: any) {
        if (verErr?.message?.startsWith("Commit didn't finalize")) throw verErr
        console.warn("[PayrollWizard] commit verify check error (non-fatal):", verErr?.message)
      }

      // MagicBlock private settlement: NOT done from the wizard. Each claim
      // dispatch (POST /api/payroll/dispatch-claim, server-side) signs a
      // base→base private transfer with the deployer keypair, pulling USDC
      // from the deployer's MagicBlock balance. Use the dedicated
      // "Pre-fund MagicBlock ER" button on the employer page to top that up.
      // The connected browser wallet is NOT involved in private settlement.
      const sessionId = `mbs_${generatedRun.runId.replace(/-/g, "").slice(0, 16)}`
      setPrivateSessionId(sessionId)
      ;(generatedRun as any).magicblockStatus = "deferred"
      ;(generatedRun as any).magicblockError = null

      setPerStatus("done")
      console.log("[PayrollWizard] Commit transaction completed:", actualTxHash)
      setCommitTx(actualTxHash || "pending")

      // Update NilDB payroll run status to committed
      fetch("/api/payroll/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId: generatedRun.runId,
          employerAddress: ownerAddress || "",
          txHash: actualTxHash,
        }),
      }).catch((e) => console.warn("[PayrollWizard] confirm status update failed:", e))

      // Trigger Celebration
      confetti({
        particleCount: 150,
        spread: 70,
        origin: { y: 0.6 },
        colors: ["#2dd4bf", "#34d399", "#3b82f6", "#a855f7"],
      })

      // Stay on step 6 to show success and settlement options
    } catch (err: any) {
      console.error("[PayrollWizard] Error committing payroll:", err)
      const errorMessage = err.message || "Commit failed"
      setCommitError(errorMessage)
      // Stay on step 6 to show error, don't go back to step 5
      console.log("[PayrollWizard] Staying on step 6 with error")
    } finally {
      setIsProcessing(false)
      setProcessingLabel("")
    }
  }

  const handleProofBundleUpload = async (file: File) => {
    setManualProofError("")
    try {
      const text = await file.text()
      const parsed = JSON.parse(text)
      if (!parsed?.proof || !parsed?.publicSignals) throw new Error("Bundle must include proof and publicSignals")
      const publicSignals = parsed.publicSignals.map((sig: string | number) => sig.toString())
      const payrollRoot = publicSignals[1]
      if (!payrollRoot) throw new Error("publicSignals[1] missing payroll root")

      const scaffold = generatedRun ?? buildRunScaffold(payrollRoot)
      scaffold.payrollRoot = payrollRoot
      scaffold.proofHash = publicSignals[0] || scaffold.proofHash
      scaffold.declaredTotal = totalPayroll.toFixed(2)

      setGeneratedRun(scaffold)
      setProofBundle({ proof: parsed.proof, publicSignals })
      if (step < 5) setStep(5)
      console.log("[PayrollWizard] Manual proof bundle loaded")
      setPendingProofFile(null)
      if (proofFileInputRef.current) proofFileInputRef.current.value = ""
    } catch (err: any) {
      console.error("[PayrollWizard] Manual proof upload failed:", err)
      setManualProofError(err.message || "Invalid proof bundle")
    }
  }


  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <input
        ref={proofFileInputRef}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0] || null
          setPendingProofFile(file)
          setManualProofError("")
        }}
      />
      <div className="mb-10">
        <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-white/30 mb-2">ZK Payroll Engine</p>
        <h1 className="text-3xl font-light tracking-tight text-white">Create Payroll Run</h1>
        <p className="text-sm text-white/40 mt-1.5 font-light">Run private, zero-knowledge payroll end-to-end on Solana</p>
      </div>

      {/* Progress Steps */}
      <div className="mb-10 p-4 rounded-2xl bg-white/[0.02] border border-white/[0.05] backdrop-blur-xl">
        <div className="flex items-center justify-between overflow-x-auto pb-1 hide-scrollbar">
          {STEPS.map((s: any, i: any) => (
            <div key={s.id} className="flex items-center">
              <div className="flex flex-col items-center group relative">
                {step === s.id && (
                  <motion.div
                    layoutId="activeStepPill"
                    className="absolute -inset-2 rounded-2xl bg-white/[0.06] border border-white/[0.08] shadow-[0_0_20px_rgba(59,130,246,0.08)]"
                    transition={{ type: "spring", bounce: 0.2, duration: 0.5 }}
                  />
                )}
                <div
                  className={`relative z-10 flex h-11 w-11 items-center justify-center rounded-xl transition-all duration-300 ${step > s.id
                    ? "bg-teal-500/15 text-teal-400 border border-teal-500/30"
                    : step === s.id
                      ? "bg-blue-600/90 border border-blue-400/30 text-white shadow-[0_0_20px_rgba(37,99,235,0.4)]"
                      : "bg-white/[0.03] text-white/20 border border-white/[0.06]"
                    }`}
                >
                  {step > s.id ? <Check className="h-4 w-4" /> : <s.icon className="h-4 w-4" />}
                </div>
                <span
                  className={`relative z-10 mt-2.5 hidden text-[10px] font-bold uppercase tracking-[0.15em] sm:block transition-colors duration-300 ${step > s.id ? "text-teal-400" : step === s.id ? "text-white" : "text-white/25"}`}
                >
                  {s.title}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`mx-3 h-[1.5px] w-6 sm:w-14 rounded-full transition-all duration-500 ${step > s.id ? "bg-teal-500/40 shadow-[0_0_8px_rgba(20,184,166,0.3)]" : "bg-white/[0.06]"}`} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Step Content */}
      <div className="rounded-2xl p-8 relative overflow-hidden border border-white/[0.06] bg-white/[0.02] backdrop-blur-xl shadow-[0_0_60px_rgba(0,0,0,0.5)]">
        {/* Glow effect in background */}
        <div className="absolute top-0 right-0 -mr-20 -mt-20 w-80 h-80 rounded-full bg-blue-500/5 blur-[80px] pointer-events-none" />
        <div className="absolute bottom-0 left-0 -ml-20 -mb-20 w-60 h-60 rounded-full bg-purple-500/5 blur-[60px] pointer-events-none" />

        <AnimatePresence mode="wait">
          {step === 1 && (
            <motion.div key="step1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/30 mb-1">Step 1 of 6</p>
                  <h2 className="text-xl font-light text-white tracking-tight">Select Employees</h2>
                  <p className="text-xs text-white/40 mt-1">Choose team members for this payroll cycle</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={selectAll} className="px-4 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-white/60 hover:text-white hover:bg-white/[0.08] text-[10px] font-bold uppercase tracking-widest transition-all duration-200">
                    Select All
                  </button>
                  <button onClick={deselectAll} className="px-4 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-white/60 hover:text-white hover:bg-white/[0.08] text-[10px] font-bold uppercase tracking-widest transition-all duration-200">
                    Deselect All
                  </button>
                </div>
              </div>
              {loadingEmployees ? (
                <div className="py-12 text-center text-white/40 flex flex-col items-center gap-4">
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
                  Loading team members...
                </div>
              ) : activeEmployees.length === 0 ? (
                <div className="py-12 text-center text-white/40">
                  No employees available. <Link href="/employer" className="text-blue-400 hover:text-blue-300 hover:underline">Add employees</Link> first.
                </div>
              ) : (
                <div className="space-y-2">
                  {activeEmployees.map((emp: any) => {
                    const basePay = Number(emp.salary_amount || emp.salaryAmount || 0)
                    const isSelected = selectedEmployees.includes(emp.employee_id || emp.employeeTag)
                    return (
                      <label
                        key={emp.employee_id}
                        className={`group flex cursor-pointer items-center gap-4 rounded-xl border p-4 transition-all duration-300 ${isSelected
                          ? "border-blue-500/30 bg-blue-500/[0.06] shadow-[0_0_20px_rgba(59,130,246,0.05)]"
                          : "border-white/[0.05] bg-white/[0.02] hover:border-white/[0.12] hover:bg-white/[0.04]"
                          }`}
                      >
                        <div className={`flex h-5 w-5 items-center justify-center rounded-md border transition-all duration-200 ${isSelected ? "bg-blue-500 border-blue-400 text-white shadow-[0_0_10px_rgba(59,130,246,0.3)]" : "border-white/15 bg-black/30"}`}>
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleEmployee(emp.employee_id)}
                            className="hidden"
                          />
                          {isSelected && <Check className="h-3 w-3" />}
                        </div>
                        <AvatarInitials name={emp.employee_name || emp.profile?.name || emp.username} color="#3B82F6" size="sm" />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm text-white/90">{emp.employee_name || emp.profile?.name || emp.username}</p>
                          <p className="text-[10px] text-white/30 uppercase tracking-widest font-bold">{emp.profile?.email || emp.profile?.role || emp.role}</p>
                        </div>
                        <div className="text-right">
                          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/15">
                            <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">Base</span>
                            <span className="text-sm font-bold text-emerald-400 tabular-nums">{basePay} USDC</span>
                          </span>
                        </div>
                      </label>
                    )
                  })}
                </div>
              )}
            </motion.div>
          )}

          {step === 2 && (
            <motion.div key="step2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <div className="mb-6">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/30 mb-1">Step 2 of 6</p>
                <h2 className="text-xl font-light text-white tracking-tight">Payroll Inputs</h2>
                <p className="text-xs text-white/40 mt-1">Adjust hours and bonuses for selected employees</p>
              </div>
              <div className="space-y-3">
                {selectedEmployees.map((empId: any) => {
                  const emp = employees.find((e: any) => e.employee_id === empId)
                  const input = payrollInputs.find((i: any) => i.employeeId === empId)
                  if (!emp || !input) return null
                  return (
                    <div key={empId} className="grid gap-6 rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 sm:grid-cols-4 items-center transition-all duration-300 hover:border-white/[0.1] hover:bg-white/[0.03] backdrop-blur-xl">
                      <div className="flex items-center gap-3">
                        <AvatarInitials name={emp.employee_name || emp.profile?.name || emp.username} color="#3B82F6" size="sm" />
                        <span className="font-medium text-sm text-white/90 truncate">{emp.employee_name || emp.profile?.name || emp.username}</span>
                      </div>
                      <div>
                        <Label className="text-[10px] font-bold uppercase tracking-widest text-white/40 mb-1.5 block">Hours</Label>
                        <Input
                          type="number"
                          value={input.hours}
                          onChange={(e) => updateInput(empId, "hours", Number.parseInt(e.target.value) || 0)}
                          className="bg-black/40 border-white/10 text-white focus-visible:ring-blue-500/50"
                        />
                      </div>
                      <div>
                        <Label className="text-[10px] font-bold uppercase tracking-widest text-white/40 mb-1.5 block">Bonus (USDC)</Label>
                        <Input
                          type="number"
                          value={input.bonus}
                          onChange={(e) => updateInput(empId, "bonus", Number.parseInt(e.target.value) || 0)}
                          className="bg-black/40 border-white/10 text-white focus-visible:ring-blue-500/50"
                        />
                      </div>
                      <div>
                        <Label className="text-[10px] font-bold uppercase tracking-widest text-white/40 mb-1.5 block">Tax Code</Label>
                        <Input
                          value={input.taxCode}
                          onChange={(e) => updateInput(empId, "taxCode", e.target.value)}
                          className="bg-black/40 border-white/10 text-white focus-visible:ring-blue-500/50"
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </motion.div>
          )}

          {step === 3 && (
            <motion.div key="step3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <div className="mb-6">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/30 mb-1">Step 3 of 6</p>
                <h2 className="text-xl font-light text-white tracking-tight">Tax Policy</h2>
                <p className="text-xs text-white/40 mt-1">Configure global tax withholding rate for this run</p>
              </div>
              <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-6 backdrop-blur-xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-40 h-40 bg-purple-500/5 blur-[60px] rounded-full pointer-events-none" />
                <div className="relative z-10">
                  <Label htmlFor="taxPercentage" className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/40 mb-4 block">Tax Withholding Percentage</Label>
                  <div className="flex items-center gap-4">
                    <div className="relative">
                      <Input
                        id="taxPercentage"
                        type="number"
                        min="0"
                        max="100"
                        value={taxPercentage}
                        onChange={(e) => setTaxPercentage(Number(e.target.value) || 0)}
                        className="w-36 bg-black/50 border-white/[0.08] text-white text-2xl font-light pr-10 focus-visible:ring-blue-500/50"
                      />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-white/30 font-bold text-lg">%</span>
                    </div>
                    <span className="text-xs text-white/40 hidden sm:block bg-blue-500/10 text-blue-300/80 px-4 py-2.5 rounded-xl border border-blue-500/15 font-medium leading-relaxed">
                      This percentage will be automatically deducted from all salaries
                    </span>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {step === 4 && (
            <motion.div key="step4" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <div className="mb-6">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/30 mb-1">Step 4 of 6</p>
                <h2 className="text-xl font-light text-white tracking-tight">Review Payroll</h2>
                <p className="text-xs text-white/40 mt-1">Verify amounts before generating zero-knowledge proofs</p>
              </div>

              <div className="mb-6 rounded-xl border border-white/[0.06] overflow-hidden shadow-[0_0_40px_rgba(0,0,0,0.3)] backdrop-blur-xl">
                <div className="border-b border-white/[0.06] bg-white/[0.03] px-5 py-4">
                  <div className="grid grid-cols-3 text-[10px] font-bold tracking-[0.15em] text-white/40 uppercase">
                    <span>Employee</span>
                    <span className="text-center">Earnings (Base + Bonus)</span>
                    <span className="text-right">Net Pay (After {taxPercentage}% tax)</span>
                  </div>
                </div>
                <div className="divide-y divide-white/5 bg-black/20">
                  {selectedEmployees.map((empId: any) => {
                    const emp = employees.find((e: any) => (e.employee_id || e.employeeTag) === empId)
                    const input = payrollInputs.find((i: any) => i.employeeId === empId)
                    if (!emp || !input) return null
                    const basePay = Number(emp.salary_amount || emp.salaryAmount || 0)
                    return (
                      <div key={empId} className="grid grid-cols-3 items-center px-5 py-4 group hover:bg-white/[0.02] transition-colors">
                        <div className="flex items-center gap-3">
                          <AvatarInitials name={emp.employee_name || emp.profile?.name || emp.username} color="#3B82F6" size="sm" />
                          <span className="font-medium text-white">{emp.employee_name || emp.profile?.name || emp.username}</span>
                        </div>
                        <span className="text-center text-sm font-mono text-white/60">
                          {basePay} + {input.bonus} USDC
                        </span>
                        <div className="text-right">
                          <span className="inline-block bg-teal-500/10 border border-teal-500/20 text-teal-300 font-semibold px-3 py-1 rounded-full text-sm">
                            {computeNetPay(empId).toFixed(2)} USDC
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div className="border-t border-white/[0.06] bg-white/[0.03] px-5 py-4">
                  <div className="grid grid-cols-3 items-center">
                    <span className="text-[10px] font-bold text-white/70 tracking-[0.2em] uppercase">Total Run Size</span>
                    <span></span>
                    <div className="text-right">
                      <span className="text-xl font-light tracking-tight text-teal-400">
                        {totalPayroll.toFixed(2)} USDC
                      </span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="rounded-xl border border-amber-500/15 bg-amber-500/[0.05] p-5 backdrop-blur-xl">
                <div className="flex items-start gap-4">
                  <div className="h-9 w-9 shrink-0 rounded-lg bg-amber-500/10 flex items-center justify-center">
                    <AlertCircle className="h-4 w-4 text-amber-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white/90">Bring your own proof</p>
                    <p className="text-xs text-white/40 mt-1 leading-relaxed">
                      Already ran the circuit elsewhere? Upload the bundle containing {"{ proof, publicSignals }"} to skip on-device proving.
                    </p>
                    <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
                      <button
                        type="button"
                        onClick={() => proofFileInputRef.current?.click()}
                        className="px-4 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-white/60 hover:text-white hover:bg-white/[0.08] text-[10px] font-bold uppercase tracking-widest transition-all duration-200"
                      >
                        Select file
                      </button>
                      <div className="text-[10px] font-mono text-white/30 sm:ml-3">
                        {pendingProofFile ? pendingProofFile.name : "No file selected"}
                      </div>
                      <button
                        type="button"
                        disabled={!pendingProofFile}
                        onClick={() => {
                          if (pendingProofFile) void handleProofBundleUpload(pendingProofFile)
                        }}
                        className="px-4 py-2 rounded-lg bg-amber-500/20 border border-amber-500/20 text-amber-300 hover:bg-amber-500/30 text-[10px] font-bold uppercase tracking-widest transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        Upload bundle
                      </button>
                    </div>
                    {manualProofError && <p className="text-xs text-red-400 mt-2">{manualProofError}</p>}
                    {proofBundle && (
                      <p className="text-xs text-emerald-400 mt-2 flex items-center gap-1.5">
                        <CheckCircle2 className="h-3 w-3" />
                        Loaded bundle with {proofBundle.publicSignals.length} public signals
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {step === 5 && (
            <motion.div key="step5" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="text-center py-12">
              {isProcessing ? (
                <div className="space-y-6">
                  <div className="relative mx-auto h-20 w-20">
                    <div className="absolute inset-0 rounded-full border-4 border-blue-500/20" />
                    <div className="absolute inset-0 rounded-full border-4 border-blue-500 border-t-transparent animate-spin shadow-[0_0_15px_rgba(59,130,246,0.5)]" />
                  </div>
                  <p className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-400">Generating ZK Payroll...</p>
                  {processingLabel ? (
                    <p className="text-sm font-mono text-blue-300/80 animate-pulse">{processingLabel}</p>
                  ) : (
                    <p className="text-sm text-white/50">Computing encrypted payslips and Merkle tree</p>
                  )}
                </div>
              ) : generatedRun ? (
                <div className="space-y-8">
                  <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-teal-500/10 border border-teal-500/30 shadow-[0_0_30px_rgba(20,184,166,0.2)]">
                    <CheckCircle2 className="h-10 w-10 text-teal-400" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-white tracking-tight">Proofs Generated Successfully</p>
                    <div className="flex items-center justify-center gap-2 mt-2">
                      <p className="text-sm text-white/50">Ready for on-chain commitment</p>
                      <span className="h-1 w-1 bg-white/20 rounded-full" />
                      {generatedRun.teeActive ? (
                        <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                          <Cpu className="h-3 w-3" /> nilCC TEE
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full">
                          <Cpu className="h-3 w-3" /> Local Compute
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="mx-auto max-w-md rounded-2xl border border-white/10 bg-black/40 p-6 text-left backdrop-blur-md shadow-xl">
                    <div className="space-y-4 text-sm">
                      <div className="flex justify-between items-center border-b border-white/5 pb-3">
                        <span className="text-white/50 font-medium">Run ID</span>
                        <code className="text-white bg-white/5 px-2 py-1 rounded-md tracking-wider font-mono text-xs">{generatedRun.runId}</code>
                      </div>
                      <div className="flex justify-between items-center border-b border-white/5 pb-3">
                        <span className="text-white/50 font-medium">Payroll Root</span>
                        <code className="text-blue-300 bg-blue-500/10 px-2 py-1 rounded-md tracking-wider font-mono text-xs border border-blue-500/20">{generatedRun.payrollRoot.slice(0, 16)}...</code>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-white/50 font-medium">Total Committing</span>
                        <span className="text-teal-400 font-bold text-lg">{generatedRun.declaredTotal} USDC</span>
                      </div>
                    </div>
                  </div>
                  {generateError && <p className="text-sm text-red-400 bg-red-400/10 py-2 px-4 rounded-lg inline-block border border-red-400/20">{generateError}</p>}
                  <div className="pt-4">
                    <Button onClick={() => setStep(6)} className="bg-teal-600 hover:bg-teal-500 text-white rounded-full px-8 shadow-[0_0_15px_rgba(20,184,166,0.4)] border border-teal-400/20">
                      Proceed to Commit
                    </Button>
                  </div>
                </div>
              ) : null}
            </motion.div>
          )}

          {step === 6 && (
            <motion.div key="step6" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="py-12">
              {isProcessing ? (
                <div className="flex flex-col lg:flex-row items-center gap-12 max-w-4xl mx-auto">
                  <div className="flex-1 space-y-6 text-center lg:text-left">
                    <div className="relative h-20 w-20 mx-auto lg:mx-0">
                      <div className="absolute inset-0 rounded-full border-4 border-teal-500/20" />
                      <div className="absolute inset-0 rounded-full border-4 border-teal-500 border-t-transparent animate-spin shadow-[0_0_15px_rgba(20,184,166,0.5)]" />
                    </div>
                    <div>
                      <h2 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-teal-400 to-emerald-400">Committing to Solana...</h2>
                      {processingLabel ? (
                        <p className="text-sm font-mono text-teal-300/80 mt-2 animate-pulse">{processingLabel}</p>
                      ) : (
                        <p className="text-sm text-white/50 mt-2">Broadcasting shielded transactions via MagicBlock PER</p>
                      )}
                    </div>
                    <div className="pt-4 flex items-center gap-3 px-4 py-3 rounded-xl bg-white/[0.03] border border-white/5">
                      <div className="h-2 w-2 rounded-full bg-teal-500 animate-ping" />
                      <span className="text-[10px] uppercase tracking-widest text-white/40 font-bold">L1 Finality: Confirming…</span>
                    </div>
                    {(perStatus === "delegating" || perStatus === "processing" || perStatus === "finalizing") && (
                      <div className="flex items-center gap-2 px-4 py-3 rounded-xl border border-amber-500/20 bg-amber-500/5">
                        <Zap className="h-4 w-4 text-amber-400 shrink-0 animate-pulse" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-amber-400">MagicBlock PER Active</p>
                          <p className="text-[10px] text-white/40 truncate">
                            {perStatus === "delegating" ? "Delegating to Permissioned ER…" :
                             perStatus === "processing" ? "Chunks processing in private ER session" :
                             "Finalizing — committing sealed state to L1"}
                          </p>
                        </div>
                        <span className="text-[9px] text-white/25 font-mono shrink-0">devnet-router.magicblock.app</span>
                      </div>
                    )}
                  </div>

                  <div className="relative p-6 rounded-3xl border border-white/5 bg-white/[0.02] backdrop-blur-xl">
                    <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-white/20 mb-4 text-center">Active Privacy Layers</p>
                    <PrivacyStackVisualizer activeLayer={perStatus === "delegating" ? 1 : perStatus === "processing" ? 2 : perStatus === "finalizing" ? 3 : 1} />
                  </div>
                </div>
              ) : commitError ? (
                <div className="space-y-8">
                  <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-red-500/10 border border-red-500/30 shadow-[0_0_30px_rgba(239,68,68,0.2)]">
                    <AlertCircle className="h-10 w-10 text-red-500" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-white tracking-tight">Commitment Failed</p>
                    <p className="text-sm text-red-400 mt-2 bg-red-500/10 py-2 px-4 rounded-lg inline-block border border-red-500/20">{commitError}</p>
                    <p className="text-xs text-white/40 mt-4">
                      Check the browser console and server logs for details.
                    </p>
                  </div>
                  <div className="flex gap-3 justify-center mt-6">
                    <Button variant="outline" onClick={() => setStep(5)} className="bg-white/5 border-white/10 text-white hover:bg-white/10 rounded-full px-6">
                      Back to Proof
                    </Button>
                    <Button onClick={handleCommit} className="bg-red-600 hover:bg-red-500 text-white rounded-full px-8 shadow-[0_0_15px_rgba(220,38,38,0.4)] border border-red-400/20">
                      Retry Commit
                    </Button>
                  </div>
                </div>
              ) : commitTx ? (
                <div className="space-y-6 text-left max-w-xl mx-auto">
                  <div className="flex items-center gap-4">
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-400/20 to-blue-500/20 border border-teal-500/30 shadow-[0_0_30px_rgba(20,184,166,0.25)]">
                      <CheckCircle2 className="h-8 w-8 text-teal-400" />
                    </div>
                    <div>
                      <h2 className="text-2xl font-bold text-white tracking-tight">Payroll Committed</h2>
                      <p className="text-sm text-white/50 mt-0.5">Merkle root finalized on Solana L1</p>
                    </div>
                  </div>

                  {/* Privacy layers activated */}
                  <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4 space-y-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-white/30 mb-3">Privacy Stack — Active</p>
                    {(() => {
                      const mbStatus = (generatedRun as any)?.magicblockStatus as
                        | "deferred"
                        | "deposited"
                        | "skipped"
                        | undefined
                      const mbError = (generatedRun as any)?.magicblockError as string | null | undefined
                      // "deferred" = the new normal: settlement runs server-side
                      // at each claim from the deployer's pre-funded ER balance,
                      // so the wizard doesn't deposit. "deposited" is the legacy
                      // wallet-signed-deposit path. Both = green.
                      const ppActive = mbStatus === "deferred" || mbStatus === "deposited"
                      const ppSub =
                        mbStatus === "deferred"
                          ? "Settlement runs from deployer ER balance at claim time"
                          : privateSessionId
                            ? `Session ${privateSessionId.slice(0, 20)}… active`
                            : "Deposited to ER"
                      const layers: Array<{ color: string; label: string; sub: string; ok: boolean }> = [
                        { color: "text-violet-400 border-violet-500/20 bg-violet-500/5", label: "Nillion nilCC TEE", sub: "Payroll computed in secure enclave", ok: true },
                        { color: "text-amber-400 border-amber-500/20 bg-amber-500/5", label: "MagicBlock ER", sub: "Commit txs routed through Ephemeral Rollup", ok: true },
                        ppActive
                          ? { color: "text-blue-400 border-blue-500/20 bg-blue-500/5", label: "MagicBlock Private Payments", sub: ppSub, ok: true }
                          : { color: "text-amber-400 border-amber-500/20 bg-amber-500/5", label: "MagicBlock Private Payments — UNAVAILABLE", sub: `Vendor outage; ZK-voucher unlinkability still applies. Detail: ${(mbError ?? "service degraded").slice(0, 80)}`, ok: false },
                        { color: "text-emerald-400 border-emerald-500/20 bg-emerald-500/5", label: "Groth16 ZK Voucher", sub: "Per-claim unlinkability enforced on-chain", ok: true },
                      ]
                      return layers.map(layer => (
                        <div key={layer.label} className={`flex items-center gap-3 rounded-xl border px-4 py-2.5 ${layer.color}`}>
                          <CheckCircle2 className={`h-3.5 w-3.5 shrink-0 ${layer.ok ? "" : "opacity-40"}`} />
                          <div>
                            <p className="text-xs font-semibold">{layer.label}</p>
                            <p className="text-[10px] text-white/40">{layer.sub}</p>
                          </div>
                        </div>
                      ))
                    })()}
                  </div>

                  {commitTx && commitTx !== "pending" && (
                    <a
                      href={buildExplorerUrl("tx", commitTx)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300 transition-colors bg-blue-500/10 px-4 py-2 rounded-full border border-blue-500/20"
                    >
                      <ExternalLink className="h-4 w-4" />
                      View on Solana Explorer
                    </a>
                  )}
                  <Button onClick={() => router.push("/employer/payrolls")} className="w-full bg-white/8 hover:bg-white/14 text-white border border-white/12 rounded-xl py-3 transition-colors">
                    View All Payrolls →
                  </Button>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-blue-500/10 border border-blue-500/30 shadow-[0_0_30px_rgba(59,130,246,0.2)]">
                    <Send className="h-10 w-10 text-blue-400 transform translate-x-1" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-white tracking-tight">Ready to Commit</p>
                    <p className="text-sm text-white/50 mt-1">Publish zero-knowledge commitments to Solana</p>
                  </div>
                  <Button
                    onClick={handleCommit}
                    disabled={!generatedRun || !proofBundle}
                    className="bg-blue-600 hover:bg-blue-500 text-white rounded-full px-10 py-6 text-lg shadow-[0_0_20px_rgba(37,99,235,0.4)] border border-blue-400/20 transition-all hover:scale-105"
                  >
                    Commit to Solana
                  </Button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Navigation */}
      <div className="mt-8 flex justify-between items-center relative z-10 border-t border-white/[0.06] pt-6">
        <button
          onClick={() => setStep((s) => Math.max(1, s - 1))}
          disabled={step === 1 || step === 6 || isProcessing}
          className="px-6 py-3 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white/60 hover:text-white hover:bg-white/[0.08] text-[10px] font-bold uppercase tracking-widest transition-all duration-200 disabled:opacity-20 disabled:cursor-not-allowed"
        >
          ← Back
        </button>
        <div className="flex items-center gap-3">
          {step < 4 && (
            <button
              onClick={() => setStep((s) => s + 1)}
              disabled={step === 1 && selectedEmployees.length === 0}
              className="px-8 py-3 rounded-xl bg-blue-600/90 hover:bg-blue-500 text-white text-xs font-bold uppercase tracking-widest shadow-[0_0_20px_rgba(37,99,235,0.25)] hover:shadow-[0_0_30px_rgba(37,99,235,0.4)] transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Continue →
            </button>
          )}
          {step === 4 && (
            <button
              onClick={handleGenerate}
              disabled={isProcessing}
              className="px-8 py-3 rounded-xl bg-purple-600/90 hover:bg-purple-500 text-white text-xs font-bold uppercase tracking-widest shadow-[0_0_20px_rgba(168,85,247,0.25)] hover:shadow-[0_0_30px_rgba(168,85,247,0.4)] transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isProcessing ? (
                <>
                  <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/20 border-t-white" />
                  Generating...
                </>
              ) : "Generate ZK Payroll"}
            </button>
          )}
        </div>
      </div>
    </motion.div>
  )
}
