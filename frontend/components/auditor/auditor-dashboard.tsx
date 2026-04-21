"use client"

import Link from "next/link"
import { useAuth } from "@/lib/auth-context"
import { useMockStore } from "@/lib/mock-store"
import { KPICard } from "@/components/ui/kpi-card"
import { StatusBadge } from "@/components/ui/status-badge"
import { Button } from "@/components/ui/button"
import { ClipboardCheck, FileText, Shield, Clock, ArrowRight, CheckCircle2 } from "lucide-react"
import { motion } from "framer-motion"

export function AuditorDashboard() {
  const { user } = useAuth()
  const { payrollRuns } = useMockStore()

  const committedRuns: any[] = payrollRuns.filter((r: any) => r.status === "committed")
  const settledRuns: any[] = payrollRuns.filter((r: any) => r.status === "settled")

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <div className="mb-8">
        <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-white/60 tracking-tight">Auditor Dashboard</h1>
        <p className="text-white/50 mt-1">Welcome back, {user?.name}</p>
      </div>

      {/* KPIs */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KPICard
          title="Pending Verification"
          value={committedRuns.length}
          icon={Clock}
          trend={committedRuns.length > 0 ? { value: "Needs review", positive: false } : undefined}
        />
        <KPICard title="Verified Runs" value={settledRuns.length} icon={CheckCircle2} subtitle="All time" />
        <KPICard title="Total Runs" value={payrollRuns.length} icon={FileText} subtitle="In system" />
        <KPICard title="Status" value="Active" icon={Shield} trend={{ value: "Registered", positive: true }} />
      </div>

      {/* Quick Actions */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2">
        <Link
          href="/auditor/requests"
          className="group flex items-center gap-4 glass-card rounded-2xl p-6 transition-all hover:bg-white/10 hover:shadow-[0_0_20px_rgba(255,255,255,0.05)] border-transparent hover:border-white/10 relative overflow-hidden"
        >
          <div className="absolute left-0 top-0 bottom-0 w-1 bg-blue-500 opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/20 shadow-[0_0_15px_rgba(59,130,246,0.3)] transition-colors group-hover:bg-blue-500/30">
            <FileText className="h-6 w-6 text-blue-400" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-white">View Requests</h3>
            <p className="text-sm text-white/50">{committedRuns.length} pending verification</p>
          </div>
          <ArrowRight className="h-5 w-5 text-white/40 transition-transform group-hover:translate-x-1 group-hover:text-white" />
        </Link>
        <Link
          href="/auditor/verifications"
          className="group flex items-center gap-4 glass-card rounded-2xl p-6 transition-all hover:bg-white/10 hover:shadow-[0_0_20px_rgba(255,255,255,0.05)] border-transparent hover:border-white/10 relative overflow-hidden"
        >
          <div className="absolute left-0 top-0 bottom-0 w-1 bg-emerald-500 opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.3)] transition-colors group-hover:bg-emerald-500/30">
            <ClipboardCheck className="h-6 w-6 text-emerald-400" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-white">Verification History</h3>
            <p className="text-sm text-white/50">{settledRuns.length} verified runs</p>
          </div>
          <ArrowRight className="h-5 w-5 text-white/40 transition-transform group-hover:translate-x-1 group-hover:text-white" />
        </Link>
      </div>

      {/* Recent Activity */}
      <div className="glass-card rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/10 bg-white/5 px-6 py-4 backdrop-blur-md">
          <h2 className="font-semibold text-white">Recent Payroll Runs</h2>
          <Link href="/auditor/requests">
            <Button variant="ghost" size="sm" className="gap-2 text-white/60 hover:text-white hover:bg-white/10 rounded-full h-8 px-4">
              View all <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </Link>
        </div>
        <div className="divide-y divide-white/5">
          {payrollRuns.slice(0, 5).map((run: any) => (
            <div key={run.runId} className="flex items-center gap-4 px-6 py-4 hover:bg-white/5 transition-colors">
              <div
                className={`flex h-10 w-10 items-center justify-center rounded-xl shadow-lg border ${run.status === "committed"
                    ? "bg-blue-500/20 border-blue-500/30 shadow-[0_0_10px_rgba(59,130,246,0.2)]"
                    : "bg-emerald-500/20 border-emerald-500/30 shadow-[0_0_10px_rgba(16,185,129,0.2)]"
                  }`}
              >
                {run.status === "committed" ? (
                  <Clock className="h-5 w-5 text-blue-400" />
                ) : (
                  <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-white">{run.runId}</p>
                <p className="text-sm font-mono text-white/40">
                  {run.employeeCount} employees • {new Date(run.createdAt).toLocaleDateString()}
                </p>
              </div>
              <StatusBadge status={run.status} />
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  )
}
