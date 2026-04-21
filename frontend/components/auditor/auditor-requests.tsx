"use client"

import { useState } from "react"
import { useMockStore } from "@/lib/mock-store"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/ui/status-badge"
import { FileText, Shield, CheckCircle2, Clock, Eye, Users } from "lucide-react"

export function AuditorRequests() {
  const { payrollRuns, updatePayrollRun } = useMockStore()
  const [verifying, setVerifying] = useState<string | null>(null)
  const [expandedRun, setExpandedRun] = useState<string | null>(null)

  const pendingRuns: any[] = payrollRuns.filter((r: any) => r.status === "committed")

  const handleVerify = async (runId: string) => {
    setVerifying(runId)
    await new Promise((resolve) => setTimeout(resolve, 2000))

    const now = new Date().toISOString()
    const run = payrollRuns.find((r: any) => r.runId === runId)
    if (run) {
      updatePayrollRun(runId, {
        status: "settled",
      })
    }
    setVerifying(null)
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">Verification Requests</h1>
        <p className="text-muted-foreground">Payroll runs pending your verification</p>
      </div>

      {pendingRuns.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <CheckCircle2 className="mx-auto h-12 w-12 text-accent" />
          <h3 className="mt-4 text-lg font-semibold text-foreground">All caught up!</h3>
          <p className="mt-2 text-muted-foreground">No pending verification requests</p>
        </div>
      ) : (
        <div className="space-y-4">
          {pendingRuns.map((run: any) => (
            <div key={run.runId} className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="flex items-center gap-4 px-6 py-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                  <FileText className="h-6 w-6 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-foreground">{run.runId}</p>
                    <StatusBadge status={run.status} />
                  </div>
                  <div className="mt-1 flex items-center gap-4 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Users className="h-3 w-3" />
                      {run.employeeCount} employees
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {new Date(run.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setExpandedRun(expandedRun === run.runId ? null : run.runId)}
                  >
                    <Eye className="mr-2 h-4 w-4" />
                    {expandedRun === run.runId ? "Hide" : "Details"}
                  </Button>
                  <Button size="sm" onClick={() => handleVerify(run.runId)} disabled={verifying === run.runId}>
                    {verifying === run.runId ? (
                      <>
                        <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                        Verifying...
                      </>
                    ) : (
                      <>
                        <Shield className="mr-2 h-4 w-4" />
                        Verify
                      </>
                    )}
                  </Button>
                </div>
              </div>

              {expandedRun === run.runId && (
                <div className="border-t border-border bg-muted/30 px-6 py-4">
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">Declared Total</p>
                      <p className="mt-1 font-mono text-sm text-foreground">*** {run.currency}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">Payroll Root</p>
                      <p className="mt-1 font-mono text-sm text-foreground truncate">{run.payrollRoot}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">Proof Hash</p>
                      <p className="mt-1 font-mono text-sm text-foreground truncate">{run.proofHash}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">Created By</p>
                      <p className="mt-1 text-sm text-foreground">{run.createdBy}</p>
                    </div>
                  </div>

                  <div className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-4">
                    <div className="flex items-start gap-3">
                      <Shield className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium text-foreground">Zero-Knowledge Verification</p>
                        <p className="text-sm text-muted-foreground">
                          You can verify that the declared total matches the sum of all encrypted notes without seeing
                          individual amounts.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
