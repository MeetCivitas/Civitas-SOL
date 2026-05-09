"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { KPICard } from "@/components/ui/kpi-card"
import { StatusBadge } from "@/components/ui/status-badge"
import { AvatarInitials } from "@/components/ui/avatar-initials"
import {
  Wallet, Users, ClipboardCheck, TrendingUp, Plus, UserPlus, Eye,
  Calendar, ArrowRight, Globe,
} from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import { PrivacyStackVisualizer } from "@/components/ui/privacy-stack"
import { PrivacyScoreMeter } from "@/components/ui/privacy-score-meter"

const TABS = ["Overview", "Payrolls", "Employees", "Auditors", "Reports", "Activity"]

function PrivacyStackPanel() {
  return (
    <div className="surface rounded-2xl p-6 backdrop-blur-xl">
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-sm font-semibold text-white tracking-tight">Privacy Stack</h3>
        <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-white bg-white/[0.05] border border-white/[0.10] rounded-full px-2.5 py-0.5 uppercase tracking-[0.2em]">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--clr-pulse)]" /> 5/5 Active
        </span>
      </div>
      <div className="flex justify-center py-2">
        <PrivacyStackVisualizer />
      </div>
    </div>
  )
}

interface PayrollRun {
  runId: string;
  orgId: string;
  createdBy: string;
  createdAt: string;
  status: string;
  employeeCount: number;
  declaredTotal: string;
  currency: string;
  payrollRoot?: string;
  proofHash?: string;
  notes?: string[];
  events?: Array<{ ts: string; text: string }>;
}

interface Employee {
  employee_id: string;
  username: string;
  employee_tag: string;
  org_id: string;
  role: string;
  status?: "provisional" | "active" | "terminated";
  profile?: { name?: string; email?: string; role?: string };
  created_at: string;
}

interface Auditor {
  auditorId: string;
  name: string;
  email: string;
  pubkeyFingerprint: string;
  status: string;
}

export function EmployerDashboard() {
  const [activeTab, setActiveTab] = useState("Overview")
  const [payrollRuns, setPayrollRuns] = useState<PayrollRun[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [auditors, setAuditors] = useState<Auditor[]>([])
  const [loading, setLoading] = useState(true)
  const [vaultState, setVaultState] = useState<any>(null)
  const [fundingVault, setFundingVault] = useState(false)
  const [fundMsg, setFundMsg] = useState<string | null>(null)

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    try {
      const [payrollsRes, employeesRes] = await Promise.all([
        fetch("/api/employer/payrolls"),
        fetch("/api/employer/employees"),
      ])

      if (payrollsRes.ok) {
        const payrollsData = await payrollsRes.json()
        if (payrollsData.success) setPayrollRuns(payrollsData.payrollRuns || [])
      }
      if (employeesRes.ok) {
        const employeesData = await employeesRes.json()
        if (employeesData.success) setEmployees(employeesData.employees || [])
      }

      const { getVaultState } = await import("@/lib/solana-program")
      const { PublicKey } = await import("@solana/web3.js")
      const ownerAddress = localStorage.getItem("civitas_owner_address")
      if (ownerAddress) {
        const vs = await getVaultState(new PublicKey(ownerAddress))
        setVaultState(vs)
      }
    } catch (err) {
      console.error("Failed to load dashboard data:", err)
    } finally {
      setLoading(false)
    }
  }

  const handleFundVault = async () => {
    const ownerAddress = localStorage.getItem("civitas_owner_address")
    if (!ownerAddress) { setFundMsg("Connect wallet first"); return }
    setFundingVault(true)
    setFundMsg(null)
    try {
      const res = await fetch("/api/vault/fund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerAddress, amountUsdc: 100_000 }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error || "Failed to build tx")

      const { Transaction, Connection } = await import("@solana/web3.js")
      const txBytes = Buffer.from(data.serializedTransaction, "base64")
      const tx = Transaction.from(txBytes)

      const solana = (window as any).solana
      if (!solana?.signAndSendTransaction) throw new Error("Wallet not connected")
      const { signature } = await solana.signAndSendTransaction(tx)

      const connection = new Connection(
        process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com",
        "confirmed",
      )
      await connection.confirmTransaction(signature, "confirmed")

      setFundMsg(`Vault funded. 100,000 USDC. Tx ${signature.slice(0, 12)}…`)
      const { getVaultState } = await import("@/lib/solana-program")
      const { PublicKey } = await import("@solana/web3.js")
      const vs = await getVaultState(new PublicKey(ownerAddress))
      setVaultState(vs)
    } catch (err: any) {
      setFundMsg(`Error: ${err.message}`)
    } finally {
      setFundingVault(false)
    }
  }

  const activeEmployees = employees.filter((e: any) => e.status === "active" || !e.status)
  const totalPayrollSpent = payrollRuns.reduce(
    (sum: any, run: any) => sum + Number.parseFloat(run.declaredTotal || "0"),
    0,
  )
  const vaultBalance = vaultState
    ? (Number(vaultState.usdcBalanceApprox.toString()) / 1_000_000).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : "0.00"

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
      className="px-2 sm:px-0"
    >
      {/* ── Header ─────────────────────────────────── */}
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <motion.div initial={{ x: -16, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.05 }}>
          <p className="text-[10px] font-semibold tracking-[0.28em] uppercase text-white/40 mb-2">Employer Console</p>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-3xl md:text-4xl font-light tracking-[-0.03em] text-white">Organization Console</h1>
            {vaultState?.snsDomain && (
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.05] border border-white/[0.10] text-[10px] font-semibold text-white/85 uppercase tracking-[0.2em]">
                <Globe className="h-3 w-3" />
                <span>{vaultState.snsDomain}.sol</span>
              </div>
            )}
          </div>
          <p className="text-white/45 mt-1.5 text-sm">Manage private payroll generation and team credentials</p>
        </motion.div>
        <motion.div initial={{ x: 16, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.05 }} className="flex gap-2">
          <Link href="/employer/payrolls/create">
            <Button className="gap-2 bg-white text-black hover:bg-white/90 rounded-full px-6 py-5 text-[11px] font-semibold uppercase tracking-[0.2em]">
              <Plus className="h-4 w-4" />
              Run Payroll
            </Button>
          </Link>
        </motion.div>
      </div>

      {/* ── Tabs ───────────────────────────────────── */}
      <motion.div
        initial={{ y: 8, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.1 }}
        className="mb-8 flex gap-1 overflow-x-auto rounded-full border border-white/[0.08] bg-white/[0.02] backdrop-blur-md p-1 hide-scrollbar w-fit"
      >
        {TABS.map((tab: any) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`relative whitespace-nowrap rounded-full px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 ${
              activeTab === tab ? "text-black" : "text-white/55 hover:text-white"
            }`}
          >
            {activeTab === tab && (
              <motion.div
                layoutId="activeTabBadge"
                className="absolute inset-0 bg-white rounded-full"
                transition={{ type: "spring", stiffness: 320, damping: 26 }}
              />
            )}
            <span className="relative z-10">{tab}</span>
          </button>
        ))}
      </motion.div>

      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.18 }}
        >
          {/* ─── OVERVIEW ─────────────────────────── */}
          {activeTab === "Overview" && (
            <div className="space-y-7">
              {/* KPIs */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="flex flex-col gap-2">
                  <KPICard
                    title="Vault Balance"
                    value={`${vaultBalance} USDC`}
                    icon={Wallet}
                    trend={{ value: "Confidential", positive: true }}
                  />
                  <button
                    onClick={handleFundVault}
                    disabled={fundingVault}
                    className="w-full rounded-xl border border-white/[0.10] bg-white/[0.04] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/85 hover:bg-white/[0.08] hover:text-white disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
                  >
                    {fundingVault ? "Minting…" : "Fund Vault (Devnet)"}
                  </button>
                  {fundMsg && (
                    <p className={`text-[11px] leading-tight px-1 ${fundMsg.startsWith("Error") ? "text-red-400/85" : "text-white/65"}`}>
                      {fundMsg}
                    </p>
                  )}
                </div>
                <KPICard
                  title="Total Disbursed"
                  value={`${totalPayrollSpent.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`}
                  icon={TrendingUp}
                  subtitle="All time"
                />
                <KPICard
                  title="Active Employees"
                  value={activeEmployees.length}
                  icon={Users}
                  trend={{ value: "All active", positive: true }}
                />
                <KPICard
                  title="Registered Auditors"
                  value={auditors.length || 0}
                  icon={ClipboardCheck}
                  subtitle="Can verify runs"
                />
              </div>

              {/* Privacy Health + Recent Runs */}
              <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
                <div className="space-y-5">
                  <div className="surface rounded-2xl p-10 flex flex-col items-center justify-center text-center relative overflow-hidden backdrop-blur-xl">
                    <PrivacyScoreMeter score={98} />
                    <div className="relative z-10 mt-6">
                      <h3 className="text-2xl font-light text-white tracking-[-0.02em]">Organization Privacy Health</h3>
                      <p className="mt-2.5 text-sm text-white/50 max-w-md mx-auto leading-relaxed font-light">
                        Full 5-layer Civitas privacy stack engaged. All payroll data is shielded
                        end-to-end via Nillion and MagicBlock.
                      </p>
                      <div className="mt-7 grid grid-cols-2 gap-3 max-w-md mx-auto">
                        <div className="px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.08]">
                          <p className="num text-base font-semibold text-white">100%</p>
                          <p className="text-[9px] uppercase tracking-[0.22em] text-white/35 mt-1">Nillion Encryption</p>
                        </div>
                        <div className="px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.08]">
                          <p className="text-sm font-semibold text-white inline-flex items-center gap-1.5">
                            <span className="h-1.5 w-1.5 rounded-full bg-[var(--clr-pulse)]" /> Active
                          </p>
                          <p className="text-[9px] uppercase tracking-[0.22em] text-white/35 mt-1">Private PER Session</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="surface rounded-2xl overflow-hidden backdrop-blur-xl">
                    <div className="flex items-center justify-between border-b border-white/[0.06] bg-white/[0.02] px-6 py-4">
                      <h2 className="text-sm font-semibold text-white tracking-tight">Recent Payroll Runs</h2>
                      <Link href="/employer/payrolls">
                        <Button variant="ghost" size="sm" className="gap-1 text-white/65 hover:text-white hover:bg-white/[0.06]">
                          View all <ArrowRight className="h-4 w-4" />
                        </Button>
                      </Link>
                    </div>
                    {loading ? (
                      <div className="px-6 py-10 text-center text-white/40 text-sm">Loading payroll runs…</div>
                    ) : payrollRuns.length === 0 ? (
                      <div className="px-6 py-10 text-center text-white/40 text-sm">
                        No payroll runs yet. <Link href="/employer/payrolls/create" className="text-white underline-offset-4 hover:underline">Create your first</Link>.
                      </div>
                    ) : (
                      <div className="divide-y divide-white/[0.04]">
                        {payrollRuns.slice(0, 3).map((run: any) => (
                          <Link
                            key={run.runId}
                            href={`/employer/payrolls/${run.runId}`}
                            className="flex items-center gap-4 px-6 py-4 transition-colors hover:bg-white/[0.03] group"
                          >
                            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/[0.04] border border-white/[0.08]">
                              <Calendar className="h-4 w-4 text-white/65" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-white truncate">{run.runId}</p>
                              <p className="text-[11px] text-white/40 font-mono mt-0.5">
                                {new Date(run.createdAt).toLocaleDateString()} · {run.employeeCount} employees
                              </p>
                            </div>
                            <StatusBadge status={run.status} />
                            <Eye className="h-4 w-4 text-white/30 group-hover:text-white/70 transition-colors" />
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-5">
                  <PrivacyStackPanel />

                  <div className="surface rounded-2xl p-5 backdrop-blur-xl">
                    <h3 className="text-sm font-semibold text-white mb-4 tracking-tight">Quick Links</h3>
                    <div className="space-y-1.5">
                      {[
                        { icon: Wallet,      label: "New Payroll",   href: "/employer/payrolls/create" },
                        { icon: UserPlus,    label: "Add Employee",  href: "/employer" },
                        { icon: ClipboardCheck, label: "Invite Auditor", href: "/employer/auditors" },
                      ].map(({ icon: Icon, label, href }) => (
                        <Link
                          key={label}
                          href={href}
                          className="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-white/[0.06] hover:bg-white/[0.06] hover:border-white/[0.12] transition-colors group"
                        >
                          <div className="flex items-center gap-3">
                            <Icon className="h-4 w-4 text-white/70" />
                            <span className="text-[12px] font-medium text-white/75 group-hover:text-white">{label}</span>
                          </div>
                          <ArrowRight className="h-3.5 w-3.5 text-white/25 group-hover:text-white/70 transition-colors" />
                        </Link>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ─── PAYROLLS ─────────────────────────── */}
          {activeTab === "Payrolls" && (
            <div className="surface rounded-2xl overflow-hidden backdrop-blur-xl">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-white/[0.06] bg-white/[0.02]">
                      {["Run ID", "Date", "Status", "Employees", "Total", "Actions"].map((h, i) => (
                        <th
                          key={h}
                          className={`px-6 py-3.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-white/45 ${
                            i === 5 ? "text-right" : "text-left"
                          }`}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04]">
                    {loading ? (
                      <tr><td colSpan={6} className="px-6 py-10 text-center text-white/40 text-sm">Loading…</td></tr>
                    ) : payrollRuns.length === 0 ? (
                      <tr><td colSpan={6} className="px-6 py-10 text-center text-white/40 text-sm">No payroll runs yet</td></tr>
                    ) : (
                      payrollRuns.map((run: any) => (
                        <tr key={run.runId} className="hover:bg-white/[0.03] transition-colors">
                          <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-white">{run.runId}</td>
                          <td className="whitespace-nowrap px-6 py-4 text-sm text-white/55 font-mono">
                            {new Date(run.createdAt).toLocaleDateString()}
                          </td>
                          <td className="whitespace-nowrap px-6 py-4"><StatusBadge status={run.status} /></td>
                          <td className="whitespace-nowrap px-6 py-4 text-sm text-white/65 num">{run.employeeCount}</td>
                          <td className="whitespace-nowrap px-6 py-4 text-sm text-white/65 num">*** {run.currency}</td>
                          <td className="whitespace-nowrap px-6 py-4 text-right">
                            <Link href={`/employer/payrolls/${run.runId}`}>
                              <Button variant="ghost" size="sm" className="text-white/65 hover:text-white hover:bg-white/[0.08]">
                                View
                              </Button>
                            </Link>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ─── EMPLOYEES ────────────────────────── */}
          {activeTab === "Employees" && (
            <div className="surface rounded-2xl overflow-hidden backdrop-blur-xl">
              <div className="flex items-center justify-between border-b border-white/[0.06] bg-white/[0.02] px-6 py-4">
                <h2 className="text-sm font-semibold text-white tracking-tight">All Employees</h2>
                <Link href="/employer">
                  <Button size="sm" className="gap-2 bg-white text-black hover:bg-white/90 rounded-full px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.2em]">
                    <UserPlus className="h-4 w-4" /> Add Employee
                  </Button>
                </Link>
              </div>
              {loading ? (
                <div className="px-6 py-10 text-center text-white/40 text-sm">Loading employees…</div>
              ) : employees.length === 0 ? (
                <div className="px-6 py-10 text-center text-white/40 text-sm">No employees yet. Add your first one.</div>
              ) : (
                <div className="divide-y divide-white/[0.04]">
                  {employees.map((emp: any) => (
                    <div key={emp.employee_id} className="flex items-center gap-4 px-6 py-4">
                      <AvatarInitials name={emp.profile?.name || emp.username} color="#FFFFFF" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white truncate">{emp.profile?.name || emp.username}</p>
                        <p className="text-[11px] text-white/45 truncate">{emp.profile?.email || emp.profile?.role || emp.role}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1.5">
                        <div className="flex items-center gap-2">
                          <span className="text-xs num text-white/85">{emp.salary || "0"} USDC</span>
                          <span className="px-1.5 py-0.5 rounded-md bg-white/[0.05] border border-white/[0.10] text-[8px] font-semibold text-white/65 uppercase tracking-[0.18em]">%allot</span>
                        </div>
                        <StatusBadge status={emp.status || "active"} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ─── AUDITORS ─────────────────────────── */}
          {activeTab === "Auditors" && (
            <div className="surface rounded-2xl overflow-hidden backdrop-blur-xl">
              <div className="flex items-center justify-between border-b border-white/[0.06] bg-white/[0.02] px-6 py-4">
                <h2 className="text-sm font-semibold text-white tracking-tight">Registered Auditors</h2>
                <Link href="/employer/auditors">
                  <Button size="sm" className="gap-2 bg-white text-black hover:bg-white/90 rounded-full px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.2em]">
                    <Plus className="h-4 w-4" /> Invite Auditor
                  </Button>
                </Link>
              </div>
              {loading ? (
                <div className="px-6 py-10 text-center text-white/40 text-sm">Loading auditors…</div>
              ) : auditors.length === 0 ? (
                <div className="px-6 py-10 text-center text-white/40 text-sm">No auditors yet. Invite your first one.</div>
              ) : (
                <div className="divide-y divide-white/[0.04]">
                  {auditors.map((auditor: any) => (
                    <div key={auditor.auditorId} className="flex items-center gap-4 px-6 py-4 hover:bg-white/[0.03] transition-colors">
                      <AvatarInitials name={auditor.name} color="#FFFFFF" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white">{auditor.name}</p>
                        <p className="text-[11px] text-white/45">{auditor.email}</p>
                      </div>
                      <code className="rounded-md bg-white/[0.04] border border-white/[0.10] px-2.5 py-1 text-[11px] text-white/65 font-mono">
                        {auditor.pubkeyFingerprint}
                      </code>
                      <StatusBadge status={auditor.status} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ─── REPORTS ──────────────────────────── */}
          {activeTab === "Reports" && (
            <div className="grid gap-5 lg:grid-cols-2">
              <div className="surface rounded-2xl p-6 backdrop-blur-xl">
                <h3 className="mb-6 text-sm font-semibold text-white tracking-tight">Payroll Spend by Month</h3>
                <div className="flex h-48 items-end gap-3">
                  {[2800, 3200, 3000, 3600, 3800].map((value: any, i: any) => (
                    <div key={i} className="flex flex-1 flex-col items-center gap-2 group">
                      <div
                        className="w-full rounded-t-md bg-white/85 group-hover:bg-white transition-colors duration-300"
                        style={{ height: `${(value / 4000) * 100}%` }}
                      />
                      <span className="text-[10px] text-white/45 font-medium uppercase tracking-widest">{["Jul", "Aug", "Sep", "Oct", "Nov"][i]}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="surface rounded-2xl p-6 backdrop-blur-xl">
                <h3 className="mb-6 text-sm font-semibold text-white tracking-tight">Headcount Trend</h3>
                <div className="flex h-48 items-end gap-3">
                  {[2, 2, 3, 3, 3].map((value: any, i: any) => (
                    <div key={i} className="flex flex-1 flex-col items-center gap-2 group">
                      <div
                        className="w-full rounded-t-md bg-white/55 group-hover:bg-white transition-colors duration-300"
                        style={{ height: `${(value / 4) * 100}%` }}
                      />
                      <span className="text-[10px] text-white/45 font-medium uppercase tracking-widest">{["Jul", "Aug", "Sep", "Oct", "Nov"][i]}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ─── ACTIVITY ─────────────────────────── */}
          {activeTab === "Activity" && (
            <div className="surface rounded-2xl overflow-hidden backdrop-blur-xl">
              <div className="border-b border-white/[0.06] bg-white/[0.02] px-6 py-4">
                <h2 className="text-sm font-semibold text-white tracking-tight">Activity Timeline</h2>
              </div>
              <div className="p-6">
                <div className="space-y-5">
                  {payrollRuns.flatMap((run) =>
                    (run.events || []).map((event: any, i: any) => (
                      <div key={`${run.runId}-${i}`} className="flex gap-4">
                        <div className="relative flex flex-col items-center">
                          <div className="h-2 w-2 rounded-full bg-white" />
                          {i < (run.events || []).length - 1 && <div className="h-full w-px bg-white/10 mt-1" />}
                        </div>
                        <div className="pb-5">
                          <p className="text-sm font-medium text-white/90">{event.text}</p>
                          <p className="text-[11px] text-white/40 mt-0.5 font-mono">
                            {new Date(event.ts).toLocaleString()} · {run.runId}
                          </p>
                        </div>
                      </div>
                    )),
                  )}
                </div>
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </motion.div>
  )
}
