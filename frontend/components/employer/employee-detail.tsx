"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { AvatarInitials } from "@/components/ui/avatar-initials"
import { StatusBadge } from "@/components/ui/status-badge"
import { ArrowLeft, Shield, Calendar, Mail, Briefcase, Copy } from "lucide-react"
import Link from "next/link"

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
    wallet_address?: string;
  };
  created_at: string;
  vouchers?: Array<{
    voucher_id: string;
    amount: number;
    currency: string;
    status: string;
    memo?: string;
  }>;
}

export function EmployeeDetail({ employeeId }: { employeeId: string }) {
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [loading, setLoading] = useState(true)
  const [voucherStatus, setVoucherStatus] = useState<"idle" | "loading" | "success" | "error">("idle")
  const [voucherLink, setVoucherLink] = useState<string | null>(null)
  const [voucherError, setVoucherError] = useState("")
  const [activating, setActivating] = useState(false)

  useEffect(() => {
    loadEmployee()
  }, [employeeId])

  const loadEmployee = async () => {
    try {
      const res = await fetch(`/api/employer/employees/${employeeId}`)
      const data = await res.json()
      if (data.success) {
        setEmployee(data.employee)
      }
    } catch (err) {
      console.error("Failed to load employee:", err)
    } finally {
      setLoading(false)
    }
  }

  const handleActivate = async () => {
    if (!employee) return
    setActivating(true)
    try {
      const res = await fetch(`/api/employer/employees/${employeeId}/activate`, {
        method: "POST",
      })
      const data = await res.json()
      if (res.ok) {
        await loadEmployee() // Refresh employee data
        // Auto-generate voucher link after activation
        await handleCreateVoucher()
        alert(`Employee activated! Password: ${data.employee?.temporary_password || "N/A"}`)
      } else {
        throw new Error(data.error || "Activation failed")
      }
    } catch (err: any) {
      alert(err.message || "Failed to activate employee")
    } finally {
      setActivating(false)
    }
  }

  const handleCreateVoucher = async () => {
    if (!employee) return
    
    setVoucherStatus("loading")
    setVoucherError("")
    setVoucherLink(null)
    try {
      const res = await fetch(`/api/employer/employees/${employeeId}/voucher`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee: {
            employee_id: employee.employee_id,
            username: employee.username,
            name: employee.profile?.name,
            email: employee.profile?.email,
            role: employee.profile?.role || employee.role,
            org_id: employee.org_id,
          },
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || "Unable to create voucher")
      }
      setVoucherLink(data.download_url)
      setVoucherStatus("success")
    } catch (err: any) {
      setVoucherStatus("error")
      setVoucherError(err.message || "Failed to create voucher")
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-lg text-muted-foreground">Loading employee...</p>
      </div>
    )
  }

  if (!employee) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-lg text-muted-foreground">Employee not found</p>
        <Link href="/employer/employees" className="mt-4">
          <Button variant="outline">Back to Employees</Button>
        </Link>
      </div>
    )
  }

  return (
    <div>
      <Link
        href="/employer/employees"
        className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Employees
      </Link>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Profile Card */}
        <div className="rounded-xl border border-border bg-card p-6">
          <div className="flex flex-col items-center text-center">
            <AvatarInitials name={employee.profile?.name || employee.username} color="#7C3AED" size="lg" />
            <h1 className="mt-4 text-xl font-bold text-foreground">{employee.profile?.name || employee.username}</h1>
            <p className="text-muted-foreground">{employee.profile?.role || employee.role}</p>
            <StatusBadge status={employee.status || "active"} className="mt-2" />
          </div>

          <div className="mt-6 space-y-4">
            <div className="flex items-center gap-3 text-sm">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <span className="text-foreground">{employee.profile?.email || employee.username}</span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <Briefcase className="h-4 w-4 text-muted-foreground" />
              <span className="text-foreground">{employee.profile?.role || employee.role}</span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span className="text-foreground">Joined {new Date(employee.created_at).toLocaleDateString()}</span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <Shield className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs font-mono text-muted-foreground">{employee.employee_tag.slice(0, 16)}...</span>
            </div>
          </div>
        </div>

        {/* Employment Credential */}
        <div className="lg:col-span-2 space-y-6">
          <div className="rounded-xl border border-border bg-card p-6">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <Shield className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h2 className="font-semibold text-foreground">Employment Credential</h2>
                <p className="text-sm text-muted-foreground">Verifiable on-chain credential</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-lg bg-muted/50 p-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Employee ID</span>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-6 w-6"
                    onClick={() => navigator.clipboard?.writeText(employee.employee_id)}
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
                <code className="text-sm text-foreground">{employee.employee_id}</code>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-lg bg-muted/50 p-4">
                  <span className="text-sm text-muted-foreground">Organization</span>
                  <p className="text-sm font-medium text-foreground">{employee.org_id}</p>
                </div>
                <div className="rounded-lg bg-muted/50 p-4">
                  <span className="text-sm text-muted-foreground">Created At</span>
                  <p className="text-sm font-medium text-foreground">
                    {new Date(employee.created_at).toLocaleDateString()}
                  </p>
                </div>
              </div>

              <div className="rounded-lg bg-muted/50 p-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Employee Tag</span>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-6 w-6"
                    onClick={() => navigator.clipboard?.writeText(employee.employee_tag)}
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
                <code className="break-all text-sm text-foreground">{employee.employee_tag}</code>
              </div>

            {employee.status === "provisional" ? (
              <div className="rounded-lg border border-dashed border-yellow-500/40 bg-yellow-500/5 p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-yellow-500/10">
                    <Shield className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
                  </div>
                  <div className="flex-1 space-y-2">
                    <div>
                      <p className="text-sm font-medium text-foreground">Activate Employee</p>
                      <p className="text-xs text-muted-foreground">
                        This employee is provisional. Activate them to generate credentials and add them to your organization.
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleActivate}
                      disabled={activating}
                    >
                      {activating ? "Activating…" : "Activate Employee"}
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-primary/40 p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10">
                    <Shield className="h-4 w-4 text-primary" />
                  </div>
                  <div className="flex-1 space-y-2">
                    <div>
                      <p className="text-sm font-medium text-foreground">Issue credential voucher</p>
                      <p className="text-xs text-muted-foreground">
                        Generate a single-use download link and share it securely with the employee. Once redeemed, the link
                        expires automatically.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={handleCreateVoucher}
                        disabled={voucherStatus === "loading"}
                      >
                        {voucherStatus === "loading" ? "Generating…" : "Generate voucher"}
                      </Button>
                      {voucherLink && (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => navigator.clipboard?.writeText(voucherLink)}
                        >
                          <Copy className="h-3 w-3 mr-1" />
                          Copy link
                        </Button>
                      )}
                    </div>
                    {voucherError && <p className="text-xs text-destructive">{voucherError}</p>}
                    {voucherLink && (
                      <div className="rounded bg-muted/70 p-2">
                        <p className="text-xs text-muted-foreground">Share this link with the employee:</p>
                        <code className="text-xs break-all text-foreground">{voucherLink}</code>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
            </div>
          </div>

          {/* Vouchers */}
          <div className="rounded-xl border border-border bg-card p-6">
            <h2 className="mb-4 font-semibold text-foreground">Vouchers</h2>
            {employee.vouchers && employee.vouchers.length > 0 ? (
              <div className="space-y-3">
                {employee.vouchers.map((voucher: any) => (
                  <div key={voucher.voucher_id} className="flex items-center justify-between rounded-lg bg-muted/50 p-4">
                    <div>
                      <span className="text-sm font-medium text-foreground">{voucher.memo || "Payroll voucher"}</span>
                      <p className="text-xs text-muted-foreground">{voucher.voucher_id}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-medium text-foreground">{voucher.amount} {voucher.currency}</span>
                      <StatusBadge status={voucher.status === "redeemed" ? "settled" : voucher.status === "issued" ? "committed" : "Draft"} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No vouchers yet</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
