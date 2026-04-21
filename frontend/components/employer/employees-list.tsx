"use client"

import type React from "react"

import { useState, useEffect } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AvatarInitials } from "@/components/ui/avatar-initials"
import { StatusBadge } from "@/components/ui/status-badge"
import { Search, Plus, Upload, Eye, FileJson, CheckCircle2, Copy, Shield, Trash2 } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { motion, AnimatePresence } from "framer-motion"

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

export function EmployeesList() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<"all" | "active" | "provisional" | "terminated">("all")
  const [showAddModal, setShowAddModal] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)
  const [addMode, setAddMode] = useState<"manual" | "tee">("manual")
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<{ imported: number; employees: any[] } | null>(null)
  const [activating, setActivating] = useState<string | null>(null)
  const [voucherLinks, setVoucherLinks] = useState<Record<string, string>>({})
  const [creating, setCreating] = useState(false)
  const [teeOnboarding, setTeeOnboarding] = useState(false)
  const [teeResult, setTeeResult] = useState<any[] | null>(null)
  const [teeEmployees, setTeeEmployees] = useState([{ name: "", salary: "" }])
  const [newEmployee, setNewEmployee] = useState({
    employee_tag: "",
    name: "",
    salary: "",
  })

  useEffect(() => {
    loadEmployees()
  }, [])

  const loadEmployees = async () => {
    try {
      const res = await fetch("/api/employer/employees")
      const data = await res.json()
      if (data.success) {
        setEmployees(data.employees || [])
      }
    } catch (err) {
      console.error("Failed to load employees:", err)
    } finally {
      setLoading(false)
    }
  }

  const handleImportCredentials = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    setImporting(true)
    setImportResult(null)

    try {
      const formData = new FormData()
      Array.from(files).forEach((file: any) => {
        formData.append("files", file)
      })

      const res = await fetch("/api/employer/employees/import", {
        method: "POST",
        body: formData,
      })

      const data = await res.json()
      if (res.ok) {
        setImportResult(data)
        await loadEmployees() // Refresh list
      } else {
        throw new Error(data.error || "Import failed")
      }
    } catch (err: any) {
      console.error("Import error:", err)
      alert(err.message || "Failed to import credentials")
    } finally {
      setImporting(false)
    }
  }

  const handleActivate = async (employeeId: string) => {
    setActivating(employeeId)
    try {
      const res = await fetch(`/api/employer/employees/${employeeId}/activate`, {
        method: "POST",
      })
      const data = await res.json()
      if (res.ok) {
        await loadEmployees() // Refresh list
        // Generate voucher link
        await handleCreateVoucher(employeeId)
      } else {
        throw new Error(data.error || "Activation failed")
      }
    } catch (err: any) {
      console.error("Activate error:", err)
      alert(err.message || "Failed to activate employee")
    } finally {
      setActivating(null)
    }
  }

  const handleCreateVoucher = async (employeeId: string) => {
    try {
      const res = await fetch(`/api/employer/employees/${employeeId}/voucher`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })
      const data = await res.json()
      if (res.ok && data.download_url) {
        setVoucherLinks((prev) => ({ ...prev, [employeeId]: data.download_url }))
      }
    } catch (err) {
      console.error("Voucher creation error:", err)
    }
  }

  const copyVoucherLink = (link: string) => {
    navigator.clipboard.writeText(link)
    alert("Link copied to clipboard!")
  }

  const handleAddEmployee = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!newEmployee.employee_tag.trim()) {
      alert("Employee tag is required. Ask the employee to generate it at /register.")
      return
    }
    setCreating(true)
    try {
      const res = await fetch("/api/employer/employees/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_tag: newEmployee.employee_tag.trim(),
          name: newEmployee.name.trim() || undefined,
          salary: Number.parseFloat(newEmployee.salary) || 0,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        setShowAddModal(false)
        setNewEmployee({ employee_tag: "", name: "", salary: "" })
        await loadEmployees()
        alert("Employee registered successfully!")
      } else {
        throw new Error(data.error || "Failed to register employee")
      }
    } catch (err: any) {
      console.error("Create employee error:", err)
      alert(err.message || "Failed to register employee")
    } finally {
      setCreating(false)
    }
  }

  const handleTeeOnboard = async () => {
    const valid = teeEmployees.filter(e => e.name.trim() && e.salary)
    if (valid.length === 0) { alert("Add at least one employee with a name and salary"); return }
    setTeeOnboarding(true)
    setTeeResult(null)
    try {
      const res = await fetch("/api/employer/employees/onboard-tee", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employees: valid.map(e => ({ name: e.name.trim(), salary: Number(e.salary) })) }),
      })
      const data = await res.json()
      if (res.ok) {
        setTeeResult(data.employees)
        await loadEmployees()
      } else {
        throw new Error(data.error || "TEE onboarding failed")
      }
    } catch (err: any) {
      alert(err.message)
    } finally {
      setTeeOnboarding(false)
    }
  }

  const filteredEmployees = employees.filter((emp: any) => {
    const name = emp.profile?.name || emp.username || ""
    const email = emp.profile?.email || ""
    const matchesSearch =
      name.toLowerCase().includes(search.toLowerCase()) || email.toLowerCase().includes(search.toLowerCase())
    const matchesFilter = filter === "all" || emp.status === filter
    return matchesSearch && matchesFilter
  })


  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-white/60 tracking-tight">Employees</h1>
          <p className="text-white/50 mt-1">Manage your team members and credentials</p>
        </div>
        <div className="flex gap-2">
          <Dialog open={showAddModal} onOpenChange={(o) => { setShowAddModal(o); if (!o) { setAddMode("manual"); setTeeResult(null); setTeeEmployees([{ name: "", salary: "" }]) } }}>
            <DialogTrigger asChild>
              <Button className="gap-2 bg-pink-600 hover:bg-pink-500 text-white shadow-[0_0_15px_rgba(236,72,153,0.4)] border border-pink-400/30 transition-all rounded-full px-6">
                <Plus className="h-4 w-4" />Add Employee
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Add Employee</DialogTitle>
              </DialogHeader>

              {/* Mode tabs */}
              <div className="flex rounded-lg bg-muted p-1 gap-1">
                <button onClick={() => setAddMode("manual")}
                  className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${addMode === "manual" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                  Manual Tag
                </button>
                <button onClick={() => setAddMode("tee")}
                  className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors flex items-center justify-center gap-1.5 ${addMode === "tee" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                  <Shield className="h-3.5 w-3.5" />
                  TEE Blind Onboard
                </button>
              </div>

              {addMode === "manual" ? (
                <form onSubmit={handleAddEmployee} className="space-y-4">
                  <div className="rounded-lg border border-border bg-muted/50 p-3">
                    <p className="text-sm text-muted-foreground">
                      Ask the employee to generate their credential at{" "}
                      <span className="font-mono text-foreground">/register</span>{" "}
                      and share their <strong>employee_tag</strong> with you.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="employee_tag">Employee Tag *</Label>
                    <Input id="employee_tag" value={newEmployee.employee_tag}
                      onChange={(e) => setNewEmployee({ ...newEmployee, employee_tag: e.target.value })}
                      placeholder="Paste the Poseidon hash from the employee"
                      className="font-mono text-sm" required />
                    <p className="text-xs text-muted-foreground">Poseidon hash — does not reveal their secret.</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="name">Name (optional)</Label>
                    <Input id="name" value={newEmployee.name}
                      onChange={(e) => setNewEmployee({ ...newEmployee, name: e.target.value })}
                      placeholder="e.g. Priya Sharma" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="salary">Monthly Salary (STRK)</Label>
                    <Input id="salary" type="number" value={newEmployee.salary}
                      onChange={(e) => setNewEmployee({ ...newEmployee, salary: e.target.value })}
                      placeholder="1200" />
                  </div>
                  <Button type="submit" className="w-full" disabled={creating}>
                    {creating ? "Registering..." : "Register Employee"}
                  </Button>
                </form>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                    <p className="text-sm text-emerald-400 font-medium flex items-center gap-2">
                      <Shield className="h-4 w-4" /> Nillion TEE Blind Onboarding
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Credentials are generated <strong>inside the SEV-SNP enclave</strong>.
                      You only receive public employee tags — you will never see raw credential nonces.
                    </p>
                  </div>

                  {/* Employee list builder */}
                  <div className="space-y-2">
                    <Label>Employees to Onboard</Label>
                    {teeEmployees.map((emp, i) => (
                      <div key={i} className="flex gap-2">
                        <Input placeholder="Name" value={emp.name}
                          onChange={e => setTeeEmployees(prev => prev.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                        <Input placeholder="Salary (STRK)" type="number" className="w-36" value={emp.salary}
                          onChange={e => setTeeEmployees(prev => prev.map((x, j) => j === i ? { ...x, salary: e.target.value } : x))} />
                        {teeEmployees.length > 1 && (
                          <button onClick={() => setTeeEmployees(prev => prev.filter((_, j) => j !== i))}
                            className="text-muted-foreground hover:text-destructive">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    ))}
                    <button onClick={() => setTeeEmployees(prev => [...prev, { name: "", salary: "" }])}
                      className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
                      <Plus className="h-3 w-3" /> Add another
                    </button>
                  </div>

                  {teeResult && (
                    <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 space-y-2">
                      <p className="text-sm font-medium text-emerald-400">✓ TEE Onboarding Complete</p>
                      {teeResult.map((emp, i) => (
                        <div key={i} className="text-xs">
                          <span className="font-medium">{emp.name}</span>{" "}
                          <span className="font-mono text-muted-foreground">{emp.employee_tag?.slice(0, 20)}...</span>
                          <span className="ml-2 text-emerald-400">🔒 TEE-generated</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <Button className="w-full gap-2" disabled={teeOnboarding} onClick={handleTeeOnboard}>
                    {teeOnboarding ? (
                      <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Generating in Nillion TEE...</>
                    ) : (
                      <><Shield className="h-4 w-4" />Onboard via TEE</>
                    )}
                  </Button>
                </div>
              )}
            </DialogContent>
          </Dialog>

          <Dialog open={showImportModal} onOpenChange={setShowImportModal}>
            <DialogTrigger asChild>
              <Button variant="outline" className="gap-2 bg-transparent text-white/70 hover:text-white border-white/20 hover:bg-white/10 rounded-full px-6 transition-all">
                <FileJson className="h-4 w-4" />
                Import Credentials
              </Button>
            </DialogTrigger>
            {/* Keeping old dialog internals for brevity */}
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Import Employee Credential Files</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="credential-files">Select credential JSON files</Label>
                  <Input
                    id="credential-files"
                    type="file"
                    accept=".json"
                    multiple
                    onChange={handleImportCredentials}
                    disabled={importing}
                  />
                  <p className="mt-2 text-sm text-muted-foreground">
                    Upload credential JSON files from employees. They will be added as provisional employees.
                  </p>
                </div>
                {importing && <p className="text-sm text-muted-foreground">Importing...</p>}
                {importResult && (
                  <div className="rounded-lg border border-border bg-muted/50 p-4">
                    <p className="font-medium text-foreground">
                      Successfully imported {importResult.imported} employee(s)
                    </p>
                    <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                      {importResult.employees.map((emp: any, i: any) => (
                        <li key={i}>
                          {emp.status === "new" && "✓"} {emp.name || emp.username || emp.employee_id} ({emp.status})
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
          <Input
            placeholder="Search employees..."
            className="pl-11 bg-white/5 border-white/10 text-white placeholder:text-white/40 rounded-full h-11 focus-visible:ring-pink-500/50"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-1 rounded-full border border-white/5 bg-white/5 backdrop-blur-md p-1.5 overflow-auto">
          {(["all", "active", "provisional", "terminated"] as const).map((f: any) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-full px-5 py-2 text-sm font-medium transition-all duration-300 relative whitespace-nowrap ${filter === f ? "text-white shadow-[0_0_10px_rgba(255,255,255,0.1)]" : "text-white/40 hover:text-white/80 hover:bg-white/5"
                }`}
            >
              {filter === f && (
                <motion.div
                  layoutId="employeesFilterTabBadge"
                  className="absolute inset-0 bg-white/10 rounded-full"
                  transition={{ type: "spring", stiffness: 300, damping: 25 }}
                />
              )}
              <span className="relative z-10">{f.charAt(0).toUpperCase() + f.slice(1)}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="glass-card rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5 bg-white/5 backdrop-blur-md">
                <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-widest text-white/50">Employee</th>
                <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-widest text-white/50">Role</th>
                <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-widest text-white/50">Start Date</th>
                <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-widest text-white/50">Status</th>
                <th className="px-6 py-4 text-right text-xs font-semibold uppercase tracking-widest text-white/50">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-white/40">Loading employees...</td>
                </tr>
              ) : filteredEmployees.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-white/40">No employees found</td>
                </tr>
              ) : (
                filteredEmployees.map((emp: any) => (
                  <tr key={emp.employee_id} className="hover:bg-white/5 transition-colors">
                    <td className="whitespace-nowrap px-6 py-4">
                      <div className="flex items-center gap-3">
                        <AvatarInitials
                          name={emp.profile?.name || emp.username}
                          color="#d946ef"
                          size="sm"
                        />
                        <div>
                          <p className="font-medium text-white">{emp.profile?.name || emp.username}</p>
                          <p className="text-sm text-white/40 font-mono">{emp.profile?.email || emp.employee_id}</p>
                        </div>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-white/60">
                      {emp.profile?.role || emp.role}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-white/60 font-mono">
                      {new Date(emp.created_at).toLocaleDateString()}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      <StatusBadge status={emp.status || "active"} />
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {emp.status === "provisional" && (
                          <Button
                            size="sm"
                            onClick={() => handleActivate(emp.employee_id)}
                            disabled={activating === emp.employee_id}
                            className="gap-2 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/20 rounded-full"
                          >
                            <CheckCircle2 className="h-4 w-4" />
                            {activating === emp.employee_id ? "Activating..." : "Activate"}
                          </Button>
                        )}
                        {voucherLinks[emp.employee_id] && (
                          <Button
                            size="sm"
                            onClick={() => copyVoucherLink(voucherLinks[emp.employee_id])}
                            className="gap-2 bg-white/5 hover:bg-white/10 text-white rounded-full border border-white/10"
                          >
                            <Copy className="h-4 w-4" />
                            Copy Link
                          </Button>
                        )}
                        {emp.status === "active" && !voucherLinks[emp.employee_id] && (
                          <Button
                            size="sm"
                            onClick={() => handleCreateVoucher(emp.employee_id)}
                            className="gap-2 bg-white/5 hover:bg-white/10 text-white rounded-full border border-white/10"
                          >
                            Get Link
                          </Button>
                        )}
                        <Link href={`/employer/employees/${emp.employee_id}`}>
                          <Button variant="ghost" size="sm" className="gap-2 text-white/50 hover:text-white hover:bg-white/10 rounded-full">
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
