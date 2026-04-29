"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { KPICard } from "@/components/ui/kpi-card"
import { StatusBadge } from "@/components/ui/status-badge"
import { AvatarInitials } from "@/components/ui/avatar-initials"
import { Wallet, Users, ClipboardCheck, TrendingUp, Plus, UserPlus, Eye, Calendar, ArrowRight, Shield, Zap, Lock, Database, Cpu, DollarSign, Globe } from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import { PrivacyStackVisualizer } from "@/components/ui/privacy-stack"
import { PrivacyScoreMeter } from "@/components/ui/privacy-score-meter"

const TABS = ["Overview", "Payrolls", "Employees", "Auditors", "Reports", "Activity"]

function PrivacyStackPanel() {
  return (
    <div className="glass-card rounded-2xl p-6">
      <div className="flex items-center justify-between mb-5">
        <h3 className="font-semibold text-white tracking-tight">Privacy Stack</h3>
        <span className="text-xs font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-3 py-1">5/5 Active</span>
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
  profile?: {
    name?: string;
    email?: string;
    role?: string;
  };
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

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      const [payrollsRes, employeesRes] = await Promise.all([
        fetch("/api/employer/payrolls"),
        fetch("/api/employer/employees"),
      ])

      if (payrollsRes.ok) {
        const payrollsData = await payrollsRes.json()
        if (payrollsData.success) {
          setPayrollRuns(payrollsData.payrollRuns || [])
        }
      }

      if (employeesRes.ok) {
        const employeesData = await employeesRes.json()
        if (employeesData.success) {
          setEmployees(employeesData.employees || [])
        }
      }

      // Fetch on-chain vault state
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

      const { Transaction } = await import("@solana/web3.js")
      const { Connection } = await import("@solana/web3.js")

      const txBytes = Buffer.from(data.serializedTransaction, "base64")
      const tx = Transaction.from(txBytes)

      const solana = (window as any).solana
      if (!solana?.signAndSendTransaction) throw new Error("Wallet not connected")

      const { signature } = await solana.signAndSendTransaction(tx)

      const connection = new Connection(
        process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com",
        "confirmed"
      )
      await connection.confirmTransaction(signature, "confirmed")

      setFundMsg(`✓ Vault funded with 100,000 USDC. Tx: ${signature.slice(0, 20)}…`)
      // Refresh vault state
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
  const totalPayrollSpent = payrollRuns.reduce((sum: any, run: any) => sum + Number.parseFloat(run.declaredTotal || "0"), 0)
  const vaultBalance = vaultState ? (Number(vaultState.usdcBalanceApprox.toString()) / 1_000_000).toLocaleString() : "0"

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4 }}
      className="p-2 sm:p-0"
    >
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <motion.div initial={{ x: -20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.1 }}>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-white/60 tracking-tight">Organization Console</h1>
            {vaultState?.snsDomain && (
              <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-violet-500/10 border border-violet-500/20 text-[10px] font-bold text-violet-300 uppercase tracking-widest">
                <Globe className="h-3 w-3" />
                <span>{vaultState.snsDomain}.sol</span>
              </div>
            )}
          </div>
          <p className="text-white/50 mt-1">Manage private payroll generation and team credentials</p>
        </motion.div>
        <motion.div initial={{ x: 20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.1 }} className="flex gap-2">
          <Link href="/employer/payrolls/create">
            <Button className="gap-2 bg-purple-600 hover:bg-purple-500 text-white shadow-[0_0_15px_rgba(147,51,234,0.4)] border border-purple-400/30 transition-all rounded-full px-6">
              <Plus className="h-4 w-4" />
              Run Payroll
            </Button>
          </Link>
        </motion.div>
      </div>

      {/* Tabs */}
      <motion.div
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="mb-8 flex gap-2 overflow-x-auto rounded-full border border-white/5 bg-white/5 backdrop-blur-md p-1.5"
      >
        {TABS.map((tab: any) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`whitespace-nowrap rounded-full px-5 py-2 text-sm font-medium transition-all duration-300 relative ${activeTab === tab
              ? "text-white shadow-[0_0_10px_rgba(255,255,255,0.1)]"
              : "text-white/40 hover:text-white/80 hover:bg-white/5"
              }`}
          >
            {activeTab === tab && (
              <motion.div
                layoutId="activeTabBadge"
                className="absolute inset-0 bg-white/10 rounded-full"
                transition={{ type: "spring", stiffness: 300, damping: 25 }}
              />
            )}
            <span className="relative z-10">{tab}</span>
          </button>
        ))}
      </motion.div>

      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.2 }}
        >
          {activeTab === "Overview" && (
            <div className="space-y-8">
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
                    className="w-full rounded-xl border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-xs font-semibold text-violet-300 hover:bg-violet-500/20 disabled:opacity-50 transition-colors"
                  >
                    {fundingVault ? "Minting…" : "⚡ Fund Vault (Devnet)"}
                  </button>
                  {fundMsg && (
                    <p className={`text-[11px] leading-tight px-1 ${fundMsg.startsWith("Error") ? "text-red-400" : "text-emerald-400"}`}>
                      {fundMsg}
                    </p>
                  )}
                </div>
                <KPICard
                  title="Total Disbursed"
                  value={`${totalPayrollSpent.toLocaleString()} USDC`}
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

              {/* Privacy Stack + Recent Payroll Runs */}
              <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
                <div className="space-y-6">
                  <div className="glass-card rounded-2xl p-10 flex flex-col items-center justify-center text-center relative overflow-hidden group">
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-violet-500/10 via-transparent to-transparent opacity-50" />
                    <PrivacyScoreMeter score={98} />
                    <div className="relative z-10 mt-6">
                      <h3 className="text-2xl font-bold text-white tracking-tight">Organization Privacy Health</h3>
                      <p className="mt-3 text-sm text-white/40 max-w-sm mx-auto leading-relaxed">
                        Your organization is utilizing the full 5-layer Civitas privacy stack. 
                        All payroll data is shielded via Nillion and MagicBlock.
                      </p>
                      <div className="mt-8 grid grid-cols-2 gap-4">
                        <div className="px-4 py-3 rounded-2xl bg-white/[0.03] border border-white/5">
                          <p className="text-xs font-bold text-white/70">100%</p>
                          <p className="text-[8px] uppercase tracking-widest text-white/30">Nillion Encryption</p>
                        </div>
                        <div className="px-4 py-3 rounded-2xl bg-white/[0.03] border border-white/5">
                          <p className="text-xs font-bold text-white/70">Active</p>
                          <p className="text-[8px] uppercase tracking-widest text-white/30">Private PER Session</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="glass-card rounded-2xl overflow-hidden">
                    <div className="flex items-center justify-between border-b border-white/5 bg-white/5 px-6 py-4">
                      <h2 className="font-semibold text-white">Recent Payroll Runs</h2>
                      <Link href="/employer/payrolls">
                        <Button variant="ghost" size="sm" className="gap-1 text-white/70 hover:text-white hover:bg-white/10">
                          View all <ArrowRight className="h-4 w-4" />
                        </Button>
                      </Link>
                    </div>
                    {loading ? (
                      <div className="px-6 py-8 text-center text-white/40">Loading payroll runs...</div>
                    ) : payrollRuns.length === 0 ? (
                      <div className="px-6 py-8 text-center text-white/40">No payroll runs yet. Create your first payroll!</div>
                    ) : (
                      <div className="divide-y divide-white/5">
                        {payrollRuns.slice(0, 3).map((run: any) => (
                          <Link
                            key={run.runId}
                            href={`/employer/payrolls/${run.runId}`}
                            className="flex items-center gap-4 px-6 py-4 transition-colors hover:bg-white/5"
                          >
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/5 border border-white/10">
                              <Calendar className="h-5 w-5 text-white/60" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-white">{run.runId}</p>
                              <p className="text-sm text-white/40 font-mono">
                                {new Date(run.createdAt).toLocaleDateString()} • {run.employeeCount} employees
                              </p>
                            </div>
                            <StatusBadge status={run.status} />
                            <Button variant="ghost" size="icon" className="text-white/40 hover:text-white">
                              <Eye className="h-4 w-4" />
                            </Button>
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                
                <div className="space-y-6">
                  <PrivacyStackPanel />
                  
                  {/* Quick Links */}
                  <div className="glass-card rounded-2xl p-6">
                    <h3 className="font-semibold text-white mb-4">Quick Links</h3>
                    <div className="space-y-2">
                      <Link href="/employer/payrolls/create" className="flex items-center justify-between p-3 rounded-xl bg-white/[0.03] border border-white/5 hover:bg-white/[0.08] transition-colors group">
                        <div className="flex items-center gap-3">
                          <Wallet className="h-4 w-4 text-purple-400" />
                          <span className="text-xs font-medium text-white/70 group-hover:text-white">New Payroll</span>
                        </div>
                        <ArrowRight className="h-3 w-3 text-white/20 group-hover:text-white/50" />
                      </Link>
                      <Link href="/employer" className="flex items-center justify-between p-3 rounded-xl bg-white/[0.03] border border-white/5 hover:bg-white/[0.08] transition-colors group">
                        <div className="flex items-center gap-3">
                          <UserPlus className="h-4 w-4 text-pink-400" />
                          <span className="text-xs font-medium text-white/70 group-hover:text-white">Add Employee</span>
                        </div>
                        <ArrowRight className="h-3 w-3 text-white/20 group-hover:text-white/50" />
                      </Link>
                      <Link href="/employer/auditors" className="flex items-center justify-between p-3 rounded-xl bg-white/[0.03] border border-white/5 hover:bg-white/[0.08] transition-colors group">
                        <div className="flex items-center gap-3">
                          <ClipboardCheck className="h-4 w-4 text-sky-400" />
                          <span className="text-xs font-medium text-white/70 group-hover:text-white">Invite Auditor</span>
                        </div>
                        <ArrowRight className="h-3 w-3 text-white/20 group-hover:text-white/50" />
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "Payrolls" && (
            <div className="glass-card rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-white/5 bg-white/5 backdrop-blur-md">
                      <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-widest text-white/50">Run ID</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-widest text-white/50">Date</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-widest text-white/50">Status</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-widest text-white/50">Employees</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-widest text-white/50">Total</th>
                      <th className="px-6 py-4 text-right text-xs font-semibold uppercase tracking-widest text-white/50">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {loading ? (
                      <tr>
                        <td colSpan={6} className="px-6 py-8 text-center text-white/40">Loading...</td>
                      </tr>
                    ) : payrollRuns.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-6 py-8 text-center text-white/40">No payroll runs yet</td>
                      </tr>
                    ) : (
                      payrollRuns.map((run: any) => (
                        <tr key={run.runId} className="hover:bg-white/5 transition-colors">
                          <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-white">{run.runId}</td>
                          <td className="whitespace-nowrap px-6 py-4 text-sm text-white/60 font-mono">
                            {new Date(run.createdAt).toLocaleDateString()}
                          </td>
                          <td className="whitespace-nowrap px-6 py-4">
                            <StatusBadge status={run.status} />
                          </td>
                          <td className="whitespace-nowrap px-6 py-4 text-sm text-white/60 font-mono">{run.employeeCount}</td>
                          <td className="whitespace-nowrap px-6 py-4 text-sm text-white/60 font-mono">*** {run.currency}</td>
                          <td className="whitespace-nowrap px-6 py-4 text-right">
                            <Link href={`/employer/payrolls/${run.runId}`}>
                              <Button variant="ghost" size="sm" className="text-white/60 hover:text-white hover:bg-white/10">
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

          {activeTab === "Employees" && (
            <div className="glass-card rounded-2xl overflow-hidden">
              <div className="flex items-center justify-between border-b border-white/5 bg-white/5 px-6 py-4 backdrop-blur-md">
                <h2 className="font-semibold text-white">All Employees</h2>
                <Link href="/employer">
                  <Button size="sm" className="gap-2 bg-pink-600/20 hover:bg-pink-600/40 text-pink-400 border border-pink-500/30 shadow-[0_0_15px_rgba(236,72,153,0.15)] rounded-full px-5 transition-all">
                    <UserPlus className="h-4 w-4" /> Add Employee
                  </Button>
                </Link>
              </div>
              {loading ? (
                <div className="px-6 py-8 text-center text-white/40">Loading employees...</div>
              ) : employees.length === 0 ? (
                <div className="px-6 py-8 text-center text-white/40">No employees yet. Add your first employee!</div>
              ) : (
                <div className="divide-y divide-white/5">
                  {employees.map((emp: any) => (
                    <div
                      key={emp.employee_id}
                      className="flex items-center gap-4 px-6 py-4"
                    >
                      <AvatarInitials name={emp.profile?.name || emp.username} color="#d946ef" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-white">{emp.profile?.name || emp.username}</p>
                        <p className="text-sm text-white/50">{emp.profile?.email || emp.profile?.role || emp.role}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-mono text-white/80">{emp.salary || "0"} USDC</span>
                          <span className="px-1.5 py-0.5 rounded-md bg-violet-500/10 border border-violet-500/20 text-[8px] font-bold text-violet-400 uppercase tracking-tighter">%allot</span>
                        </div>
                        <StatusBadge status={emp.status || "active"} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === "Auditors" && (
            <div className="glass-card rounded-2xl overflow-hidden">
              <div className="flex items-center justify-between border-b border-white/5 bg-white/5 px-6 py-4 backdrop-blur-md">
                <h2 className="font-semibold text-white">Registered Auditors</h2>
                <Link href="/employer/auditors">
                  <Button size="sm" className="gap-2 bg-sky-600/20 hover:bg-sky-600/40 text-sky-400 border border-sky-500/30 shadow-[0_0_15px_rgba(14,165,233,0.15)] rounded-full px-5 transition-all">
                    <Plus className="h-4 w-4" /> Invite Auditor
                  </Button>
                </Link>
              </div>
              {loading ? (
                <div className="px-6 py-8 text-center text-white/40">Loading auditors...</div>
              ) : auditors.length === 0 ? (
                <div className="px-6 py-8 text-center text-white/40">No auditors yet. Invite your first auditor!</div>
              ) : (
                <div className="divide-y divide-white/5">
                  {auditors.map((auditor: any) => (
                    <div key={auditor.auditorId} className="flex items-center gap-4 px-6 py-4 hover:bg-white/5 transition-colors">
                      <AvatarInitials name={auditor.name} color="#0EA5A4" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-white">{auditor.name}</p>
                        <p className="text-sm text-white/50">{auditor.email}</p>
                      </div>
                      <code className="rounded-lg bg-white/5 border border-white/10 px-3 py-1 text-xs text-white/60 font-mono">
                        {auditor.pubkeyFingerprint}
                      </code>
                      <StatusBadge status={auditor.status} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === "Reports" && (
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="glass-card rounded-2xl p-6">
                <h3 className="mb-6 font-semibold text-white tracking-tight">Payroll Spend by Month</h3>
                <div className="flex h-48 items-end gap-3">
                  {[2800, 3200, 3000, 3600, 3800].map((value: any, i: any) => (
                    <div key={i} className="flex flex-1 flex-col items-center gap-2 group">
                      <div
                        className="w-full rounded-t-lg bg-gradient-to-t from-purple-600 to-purple-400/80 transition-all duration-300 group-hover:from-purple-500 group-hover:to-purple-300 shadow-[0_0_15px_rgba(168,85,247,0.2)]"
                        style={{ height: `${(value / 4000) * 100}%` }}
                      />
                      <span className="text-xs text-white/50 font-medium">{["Jul", "Aug", "Sep", "Oct", "Nov"][i]}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="glass-card rounded-2xl p-6">
                <h3 className="mb-6 font-semibold text-white tracking-tight">Headcount Trend</h3>
                <div className="flex h-48 items-end gap-3">
                  {[2, 2, 3, 3, 3].map((value: any, i: any) => (
                    <div key={i} className="flex flex-1 flex-col items-center gap-2 group">
                      <div
                        className="w-full rounded-t-lg bg-gradient-to-t from-pink-600 to-pink-400/80 transition-all duration-300 group-hover:from-pink-500 group-hover:to-pink-300 shadow-[0_0_15px_rgba(236,72,153,0.2)]"
                        style={{ height: `${(value / 4) * 100}%` }}
                      />
                      <span className="text-xs text-white/50 font-medium">{["Jul", "Aug", "Sep", "Oct", "Nov"][i]}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === "Activity" && (
            <div className="glass-card rounded-2xl p-0 overflow-hidden">
              <div className="border-b border-white/5 bg-white/5 px-6 py-4 backdrop-blur-md">
                <h2 className="font-semibold text-white tracking-tight">Activity Timeline</h2>
              </div>
              <div className="p-6">
                <div className="space-y-6">
                  {payrollRuns.flatMap((run) =>
                    (run.events || []).map((event: any, i: any) => (
                      <div key={`${run.runId}-${i}`} className="flex gap-4">
                        <div className="relative flex flex-col items-center">
                          <div className="h-3 w-3 rounded-full bg-purple-500 shadow-[0_0_10px_rgba(168,85,247,0.5)]" />
                          {i < (run.events || []).length - 1 && <div className="h-full w-px bg-white/10" />}
                        </div>
                        <div className="pb-6">
                          <p className="text-sm font-medium text-white/90">{event.text}</p>
                          <p className="text-xs text-white/40 mt-1 font-mono">
                            {new Date(event.ts).toLocaleString()} • {run.runId}
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
