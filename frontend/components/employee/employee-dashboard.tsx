"use client"

import Link from "next/link"
import { useMockStore } from "@/lib/mock-store"
import { useAuth } from "@/lib/auth-context"
import { KPICard } from "@/components/ui/kpi-card"
import { StatusBadge } from "@/components/ui/status-badge"
import { Button } from "@/components/ui/button"
import { Inbox, Wallet, CreditCard, Clock, ArrowRight, Lock, Eye, Sparkles, ShieldCheck, Zap } from "lucide-react"
import { motion, AnimatePresence, Variants } from "framer-motion"

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08, delayChildren: 0.1 },
  },
}

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" } },
}

export function EmployeeDashboard() {
  const { user } = useAuth()
  const { notes, payrollRuns } = useMockStore()

  const employeeId = "emp_001"
  const myNotes = notes.filter((n: any) => n.recipientId === employeeId)
  const unopenedNotes = myNotes.filter((n: any) => n.status === "Unopened")
  const openedNotes = myNotes.filter((n: any) => n.status === "Opened")

  const totalReceived = openedNotes.reduce((sum: any, note: any) => {
    if (note.decryptedAmount) {
      return sum + Number.parseFloat(note.decryptedAmount)
    }
    return sum
  }, 0)

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-8"
    >
      {/* Header */}
      <motion.div variants={itemVariants} className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium text-blue-400 uppercase tracking-widest mb-1">Employee Portal</p>
          <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-white/60 tracking-tight">
            Welcome back, {user?.name?.split(" ")[0] ?? "there"}
          </h1>
          <p className="text-white/50 mt-1">Your private encrypted payroll dashboard</p>
        </div>
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/20"
        >
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          <span className="text-xs font-medium text-emerald-400">ZK Privacy Active</span>
        </motion.div>
      </motion.div>

      {/* KPIs */}
      <motion.div variants={itemVariants} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KPICard
          title="Unopened Notes"
          value={unopenedNotes.length}
          icon={Inbox}
          trend={unopenedNotes.length > 0 ? { value: "New payments", positive: true } : undefined}
        />
        <KPICard
          title="Total Received"
          value={totalReceived > 0 ? `${totalReceived.toFixed(2)} USDC` : "*** USDC"}
          icon={Wallet}
          subtitle="From opened notes"
        />
        <KPICard title="Payroll Notes" value={myNotes.length} icon={CreditCard} subtitle="All time" />
        <KPICard
          title="Latest Run"
          value={payrollRuns[0]?.runId.slice(-8) || "N/A"}
          icon={Clock}
          subtitle={payrollRuns[0] ? new Date(payrollRuns[0].createdAt).toLocaleDateString() : ""}
        />
      </motion.div>

      {/* Quick Actions */}
      <motion.div variants={itemVariants} className="grid gap-4 sm:grid-cols-3">
        <Link
          href="/employee/inbox"
          className="group glass-card rounded-2xl p-6 transition-all hover:-translate-y-1 hover:shadow-[0_0_20px_rgba(59,130,246,0.15)] bg-[#0a0a0a] border-white/10 hover:border-blue-500/30"
        >
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/10 border border-blue-500/20 transition-all duration-300 group-hover:bg-blue-500/20">
            <Inbox className="h-6 w-6 text-blue-400" />
          </div>
          <h3 className="mb-1 font-semibold text-white drop-shadow-md">View Inbox</h3>
          <p className="text-sm text-white/50">
            {unopenedNotes.length > 0
              ? `${unopenedNotes.length} unopened note${unopenedNotes.length > 1 ? "s" : ""}`
              : "All notes opened"}
          </p>
        </Link>
        <Link
          href="/employee/claims"
          className="group glass-card rounded-2xl p-6 transition-all hover:-translate-y-1 hover:shadow-[0_0_20px_rgba(16,185,129,0.15)] bg-[#0a0a0a] border-white/10 hover:border-emerald-500/30"
        >
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/10 border border-emerald-500/20 transition-all duration-300 group-hover:bg-emerald-500/20">
            <CreditCard className="h-6 w-6 text-emerald-400" />
          </div>
          <h3 className="mb-1 font-semibold text-white drop-shadow-md">Claim Funds</h3>
          <p className="text-sm text-white/50">Submit ZK proofs to receive USDC</p>
        </Link>
        <Link
          href="/employee/profile"
          className="group glass-card rounded-2xl p-6 transition-all hover:-translate-y-1 hover:shadow-[0_0_20px_rgba(14,165,233,0.15)] bg-[#0a0a0a] border-white/10 hover:border-sky-500/30"
        >
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-sky-500/10 border border-sky-500/20 transition-all duration-300 group-hover:bg-sky-500/20">
            <ShieldCheck className="h-6 w-6 text-sky-400" />
          </div>
          <h3 className="mb-1 font-semibold text-white drop-shadow-md">My Credential</h3>
          <p className="text-sm text-white/50">View cryptographic identity</p>
        </Link>
      </motion.div>

      {/* Privacy Notice Banner */}
      <motion.div
        variants={itemVariants}
        className="glass-card rounded-2xl p-5 border border-blue-500/20 bg-blue-500/5 flex items-start gap-4"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-500/15 border border-blue-500/25">
          <Zap className="h-5 w-5 text-blue-400" />
        </div>
        <div>
          <p className="font-semibold text-white/90 text-sm">Zero-Knowledge Privacy Enabled</p>
          <p className="text-xs text-white/50 mt-0.5">
            Your salary data is encrypted end-to-end. Amounts stay hidden until you reveal them with your credential key.
            Civitas never sees your compensation.
          </p>
        </div>
        <span className="ml-auto shrink-0 px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/25 text-[10px] font-semibold text-emerald-400 uppercase tracking-wider">
          Active
        </span>
      </motion.div>

      {/* Recent Notes */}
      <motion.div variants={itemVariants} className="glass-card rounded-2xl overflow-hidden bg-[#0a0a0a] border-white/10">
        <div className="flex items-center justify-between border-b border-white/5 bg-white/5 px-6 py-4 backdrop-blur-md">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-emerald-400" />
            <h2 className="font-semibold text-white">Recent Payroll Notes</h2>
          </div>
          <Link href="/employee/inbox">
            <Button variant="ghost" size="sm" className="gap-1 text-white/70 hover:text-white hover:bg-white/10">
              View all <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
        {myNotes.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <Lock className="mx-auto h-12 w-12 text-white/20" />
            <p className="mt-4 text-white/40 text-sm">No payroll notes yet</p>
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            <AnimatePresence>
              {myNotes.slice(0, 5).map((note: any, index: number) => {
                const run = payrollRuns.find((r: any) => r.runId === note.runId)
                return (
                  <motion.div
                    key={note.noteId}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.06 }}
                  >
                    <Link
                      href={`/employee/inbox/${note.noteId}`}
                      className="flex items-center gap-4 px-6 py-4 transition-colors hover:bg-white/5 group"
                    >
                      <div
                        className={`flex h-10 w-10 items-center justify-center rounded-lg transition-colors ${note.status === "Unopened"
                          ? "bg-blue-500/10 border border-blue-500/20 group-hover:bg-blue-500/20"
                          : "bg-white/5 border border-white/10"
                          }`}
                      >
                        {note.status === "Unopened" ? (
                          <Lock className="h-5 w-5 text-blue-400" />
                        ) : (
                          <Eye className="h-5 w-5 text-white/40" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-white text-sm">
                          Payroll · {run ? new Date(run.createdAt).toLocaleDateString() : "Unknown"}
                        </p>
                        <p className="text-xs text-white/40 mt-0.5">
                          {note.status === "Opened" && note.decryptedAmount
                            ? `${note.decryptedAmount} USDC`
                            : note.maskedAmount}
                        </p>
                      </div>
                      <StatusBadge status={note.status} />
                      <ArrowRight className="h-4 w-4 text-white/20 group-hover:text-white/60 transition-all group-hover:translate-x-1" />
                    </Link>
                  </motion.div>
                )
              })}
            </AnimatePresence>
          </div>
        )}
      </motion.div>
    </motion.div>
  )
}
