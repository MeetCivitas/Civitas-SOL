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
    // Use context runs if available (already fetched)
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
        }))
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
      if (data.success) {
        setPayrollRuns(data.payrollRuns || [])
      }
    } catch (err) {
      console.error("Failed to load payrolls:", err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-white/60 tracking-tight">Payroll Runs</h1>
          <p className="text-white/50 mt-1">View and manage all payroll runs</p>
        </div>
        <Link href="/employer/payrolls/create">
          <Button className="gap-2 bg-purple-600 hover:bg-purple-500 text-white shadow-[0_0_15px_rgba(147,51,234,0.4)] border border-purple-400/30 transition-all rounded-full px-6">
            <Plus className="h-4 w-4" />
            Create Payroll Run
          </Button>
        </Link>
      </div>

      <div className="glass-card rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5 bg-white/5 backdrop-blur-md">
                <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-widest text-white/50">Run ID</th>
                <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-widest text-white/50">Date</th>
                <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-widest text-white/50">Status</th>
                <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-widest text-white/50"># Employees</th>
                <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-widest text-white/50">Total Amount</th>
                <th className="px-6 py-4 text-right text-xs font-semibold uppercase tracking-widest text-white/50">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-white/40">Loading payroll runs...</td>
                </tr>
              ) : payrollRuns.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-white/40">No payroll runs yet. Create your first payroll!</td>
                </tr>
              ) : (
                payrollRuns.map((run: any) => (
                  <tr key={run.runId} className="hover:bg-white/5 transition-colors">
                    <td className="whitespace-nowrap px-6 py-4">
                      <code className="text-sm font-medium text-white">{run.runId}</code>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-white/60 font-mono">
                      {new Date(run.createdAt).toLocaleDateString()}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      <StatusBadge status={run.status} />
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-white/60 font-mono">{run.employeeCount}</td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-white/60 font-mono">*** {run.currency}</td>
                    <td className="whitespace-nowrap px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button variant="ghost" size="icon" title="Re-run simulation" className="text-white/40 hover:text-white">
                          <RefreshCw className="h-4 w-4" />
                        </Button>
                        <Link href={`/employer/payrolls/${run.runId}`}>
                          <Button variant="ghost" size="sm" className="gap-1 text-white/60 hover:text-white hover:bg-white/10">
                            <Eye className="h-4 w-4" />
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
