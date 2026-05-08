"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/ui/status-badge"
import { Plus, Eye, RefreshCw } from "lucide-react"
import { motion } from "framer-motion"
import { useSolanaWallet } from "@/lib/solana-wallet"
import { useCivitas } from "@/lib/civitas-provider"

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

export function PayrollsList() {
  const { address } = useSolanaWallet()
  const { walletAddress, payrollRuns: contextRuns } = useCivitas()
  const ownerAddress = address || walletAddress
  const [payrollRuns, setPayrollRuns] = useState<PayrollRun[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (contextRuns.length > 0) {
      setPayrollRuns(
        contextRuns.map((r: any) => ({
          runId: r.runId,
          orgId: r.orgId || "",
          createdBy: r.createdBy || "employer",
          createdAt: r.createdAt || new Date().toISOString(),
          status: r.status || "draft",
          employeeCount: r.employeeCount || 0,
          declaredTotal: r.totalAmount || r.declaredTotal || "***",
          currency: "USDC",
          payrollRoot: r.merkleRoot || r.payrollRoot || "",
        })),
      )
      setLoading(false)
      return
    }
    loadPayrolls()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextRuns])

  const loadPayrolls = async () => {
    if (!ownerAddress) { setLoading(false); return; }
    try {
      const res = await fetch(`/api/employer/payrolls?address=${encodeURIComponent(ownerAddress)}`)
      const data = await res.json()
      if (data.success) setPayrollRuns(data.payrollRuns || [])
    } catch (err) {
      console.error("Failed to load payrolls:", err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
    >
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[10px] font-semibold tracking-[0.28em] uppercase text-white/40 mb-2">ZK Engine</p>
          <h1 className="text-3xl md:text-4xl font-light tracking-[-0.03em] text-white">Payroll Runs</h1>
          <p className="text-white/45 mt-1.5 text-sm">View and manage all payroll runs</p>
        </div>
        <Link href="/employer/payrolls/create">
          <Button className="gap-2 bg-white text-black hover:bg-white/90 rounded-full px-6 py-5 text-[11px] font-semibold uppercase tracking-[0.2em]">
            <Plus className="h-4 w-4" />
            Create Payroll Run
          </Button>
        </Link>
      </div>

      <div className="surface rounded-2xl overflow-hidden backdrop-blur-xl">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/[0.06] bg-white/[0.02]">
                {["Run ID", "Date", "Status", "# Employees", "Total Amount", "Actions"].map((h, i) => (
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
                <tr><td colSpan={6} className="px-6 py-10 text-center text-white/40 text-sm">Loading payroll runs…</td></tr>
              ) : payrollRuns.length === 0 ? (
                <tr><td colSpan={6} className="px-6 py-10 text-center text-white/40 text-sm">No payroll runs yet. Create your first.</td></tr>
              ) : (
                payrollRuns.map((run: any) => (
                  <tr key={run.runId} className="hover:bg-white/[0.03] transition-colors">
                    <td className="whitespace-nowrap px-6 py-4">
                      <code className="text-sm font-medium text-white">{run.runId}</code>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-white/55 font-mono">
                      {new Date(run.createdAt).toLocaleDateString()}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4"><StatusBadge status={run.status} /></td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-white/65 num">{run.employeeCount}</td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-white/65 num">*** {run.currency}</td>
                    <td className="whitespace-nowrap px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button variant="ghost" size="icon" title="Re-run simulation" className="h-8 w-8 text-white/45 hover:text-white hover:bg-white/[0.08]">
                          <RefreshCw className="h-3.5 w-3.5" />
                        </Button>
                        <Link href={`/employer/payrolls/${run.runId}`}>
                          <Button variant="ghost" size="sm" className="gap-1 text-white/65 hover:text-white hover:bg-white/[0.08]">
                            <Eye className="h-3.5 w-3.5" />
                            View
                          </Button>
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </motion.div>
  )
}
