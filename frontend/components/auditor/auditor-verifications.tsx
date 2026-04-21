"use client"

import { useMockStore } from "@/lib/mock-store"
import { StatusBadge } from "@/components/ui/status-badge"
import { CheckCircle2, FileText, Users, Clock, Shield } from "lucide-react"

export function AuditorVerifications() {
  const { payrollRuns } = useMockStore()

  const verifiedRuns: any[] = payrollRuns.filter((r: any) => r.status === "settled")

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">Verification History</h1>
        <p className="text-muted-foreground">Previously verified payroll runs</p>
      </div>

      {verifiedRuns.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <FileText className="mx-auto h-12 w-12 text-muted-foreground/50" />
          <h3 className="mt-4 text-lg font-semibold text-foreground">No verifications yet</h3>
          <p className="mt-2 text-muted-foreground">Verified runs will appear here</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Run ID
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Employees
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Proof
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {verifiedRuns.map((run: any) => (
                  <tr key={run.runId} className="hover:bg-muted/50">
                    <td className="whitespace-nowrap px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10">
                          <CheckCircle2 className="h-4 w-4 text-accent" />
                        </div>
                        <span className="text-sm font-medium text-foreground">{run.runId}</span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-muted-foreground">
                      {new Date(run.createdAt).toLocaleDateString()}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        {run.employeeCount}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      <StatusBadge status={run.status} />
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      <div className="flex items-center gap-1 text-sm text-accent">
                        <Shield className="h-3 w-3" />
                        Verified
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Verification Stats */}
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10">
              <CheckCircle2 className="h-5 w-5 text-accent" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{verifiedRuns.length}</p>
              <p className="text-sm text-muted-foreground">Total Verified</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Users className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">
                {verifiedRuns.reduce((sum: any, r: any) => sum + r.employeeCount, 0)}
              </p>
              <p className="text-sm text-muted-foreground">Employees Covered</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <Clock className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">
                {verifiedRuns.length > 0 ? new Date(verifiedRuns[0].createdAt).toLocaleDateString() : "N/A"}
              </p>
              <p className="text-sm text-muted-foreground">Latest Verification</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
