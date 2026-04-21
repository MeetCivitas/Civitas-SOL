"use client"

import { useMockStore } from "@/lib/mock-store"
import { useAuth } from "@/lib/auth-context"
import { AvatarInitials } from "@/components/ui/avatar-initials"
import { StatusBadge } from "@/components/ui/status-badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Shield, Key, Copy, CheckCircle2, Calendar, Briefcase, Lock, ShieldCheck, Fingerprint } from "lucide-react"
import { useState } from "react"
import { motion, Variants } from "framer-motion"

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.08, delayChildren: 0.1 } },
}

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" } },
}

export function EmployeeProfile() {
  const { user } = useAuth()
  const { employees } = useMockStore()
  const [showCopied, setShowCopied] = useState<string | null>(null)

  const employee = employees.find((e: any) => e.id === "emp_001")

  if (!employee) {
    return (
      <div className="flex items-center justify-center py-20 text-white/40">Employee not found</div>
    )
  }

  const handleCopy = (text: string, field: string) => {
    navigator.clipboard.writeText(text)
    setShowCopied(field)
    setTimeout(() => setShowCopied(null), 2000)
  }

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-8"
    >
      {/* Header */}
      <motion.div variants={itemVariants}>
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-white/5 border border-white/10 text-[10px] font-bold uppercase tracking-widest text-white/60 mb-4">
          <Shield className="h-3 w-3" /> Zero-Knowledge Identity
        </div>
        <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-white/60 tracking-tight">
          My Profile
        </h1>
        <p className="text-white/50 mt-1 max-w-lg">Your on-chain employment metadata and cryptographic primitives</p>
      </motion.div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Profile Card */}
        <motion.div variants={itemVariants}>
          <div className="glass-card rounded-2xl p-6 relative overflow-hidden bg-[#0a0a0a] border-white/10 group">
            {/* Ambient hover glow */}
            <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none" />
            
            <div className="relative z-10">
              <div className="flex flex-col items-center text-center">
                <div className="p-1 rounded-full border border-white/10 bg-white/5">
                  <AvatarInitials name={employee.name} size="lg" />
                </div>
                <h2 className="mt-4 text-xl font-bold text-white tracking-tight">{employee.name}</h2>
                <p className="text-white/40 text-sm font-light">{employee.role}</p>
                <div className="flex items-center mt-3 gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_2px_rgba(52,211,153,0.4)]" />
                  <span className="text-[10px] uppercase tracking-wider text-emerald-400 font-bold">Active Employee</span>
                </div>
              </div>

              <div className="mt-6 space-y-3 border-t border-white/10 pt-6">
                <div className="flex items-center gap-3 p-3 rounded-xl bg-[#050505] border border-white/5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5">
                    <Briefcase className="h-4 w-4 text-white/40" />
                  </div>
                  <div>
                    <p className="text-[10px] text-white/30 uppercase tracking-widest">Role</p>
                    <p className="text-sm font-medium text-white">{employee.role}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 rounded-xl bg-[#050505] border border-white/5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5">
                    <Calendar className="h-4 w-4 text-white/40" />
                  </div>
                  <div>
                    <p className="text-[10px] text-white/30 uppercase tracking-widest">Start Date</p>
                    <p className="text-sm font-medium text-white">
                      {new Date(employee.startDate).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Details — spans 2 cols */}
        <div className="lg:col-span-2 space-y-5">
          {/* Contact Info */}
          <motion.div variants={itemVariants} className="glass-card bg-[#0a0a0a] border-white/10 rounded-2xl overflow-hidden">
            <div className="flex items-center gap-2 border-b border-white/5 bg-white/[0.02] px-6 py-4">
              <Fingerprint className="h-4 w-4 text-white/40" />
              <h2 className="font-semibold text-white/80 text-sm">Contact Specifications</h2>
            </div>
            <div className="p-6 grid gap-6 sm:grid-cols-2">
              <div>
                <Label className="text-[10px] uppercase tracking-widest text-white/30 font-semibold mb-2 block">Email</Label>
                <div className="relative group">
                  <Input
                    value={employee.email}
                    readOnly
                    className="bg-[#050505] border-white/10 text-white/80 font-mono text-sm focus:border-white/30 focus-visible:ring-0 group-hover:border-white/20 transition-colors"
                  />
                </div>
              </div>
              <div>
                <Label className="text-[10px] uppercase tracking-widest text-white/30 font-semibold mb-2 block">Employee ID</Label>
                <div className="relative group">
                  <Input
                    value={employee.id}
                    readOnly
                    className="bg-[#050505] border-white/10 text-white/80 font-mono text-sm focus:border-white/30 focus-visible:ring-0 group-hover:border-white/20 transition-colors"
                  />
                </div>
              </div>
            </div>
          </motion.div>

          {/* Employment Credential */}
          <motion.div variants={itemVariants} className="glass-card bg-[#0a0a0a] border-white/10 rounded-2xl overflow-hidden">
            <div className="flex items-center gap-2 border-b border-white/5 bg-white/[0.02] px-6 py-4">
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
              <h2 className="font-semibold text-white/80 text-sm">Attested Identity</h2>
            </div>
            <div className="p-6 space-y-6">
              {/* Verified badge */}
              <div className="flex items-center gap-4 p-4 rounded-xl bg-[#050505] border border-white/10 relative overflow-hidden">
                <div className="absolute left-0 top-0 bottom-0 w-1 bg-emerald-500 rounded-l-xl" />
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 border border-emerald-500/20 shrink-0">
                  <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                </div>
                <div>
                  <p className="font-semibold text-white/90 text-sm">Verified Node</p>
                  <p className="text-xs text-white/40 mt-0.5">
                    Attested by {employee.employmentCredential.issuedBy} on{" "}
                    {new Date(employee.employmentCredential.issuedAt).toLocaleDateString()}
                  </p>
                </div>
              </div>

              <div className="grid gap-6 sm:grid-cols-2">
                <div>
                  <Label className="text-[10px] uppercase tracking-widest text-white/30 font-semibold mb-2 block">Credential Hash</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      value={employee.employmentCredential.hash}
                      readOnly
                      className="bg-[#050505] border-white/10 text-white/60 font-mono text-xs focus:border-white/30 focus-visible:ring-0 truncate"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleCopy(employee.employmentCredential.hash, "hash")}
                      className="shrink-0 bg-white/5 border border-white/10 hover:bg-white/10 text-white/50 hover:text-white transition-all rounded-lg h-10 w-10"
                    >
                      {showCopied === "hash" ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>

                <div>
                  <Label className="text-[10px] uppercase tracking-widest text-white/30 font-semibold mb-2 block">Root ID</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      value={employee.employmentCredential.credId}
                      readOnly
                      className="bg-[#050505] border-white/10 text-white/60 font-mono text-xs focus:border-white/30 focus-visible:ring-0 truncate"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleCopy(employee.employmentCredential.credId, "credId")}
                      className="shrink-0 bg-white/5 border border-white/10 hover:bg-white/10 text-white/50 hover:text-white transition-all rounded-lg h-10 w-10"
                    >
                      {showCopied === "credId" ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Encryption Keys */}
          <motion.div variants={itemVariants} className="glass-card bg-[#0a0a0a] border-white/10 rounded-2xl overflow-hidden">
            <div className="flex items-center gap-2 border-b border-white/5 bg-white/[0.02] px-6 py-4">
              <Key className="h-4 w-4 text-blue-400" />
              <h2 className="font-semibold text-white/80 text-sm">Keypair Security</h2>
            </div>
            <div className="p-6">
              <div className="flex items-start gap-4 p-5 rounded-xl bg-blue-500/5 border border-blue-500/10">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 border border-blue-500/20">
                  <Lock className="h-5 w-5 text-blue-400" />
                </div>
                <div className="space-y-1.5">
                  <p className="font-semibold text-white/90 text-sm">Secret Keys Confined</p>
                  <p className="text-xs text-white/50 leading-relaxed font-light">
                    Your cryptographic keys are stored securely off-chain. Neither the enterprise nor the protocol logic has visibility into your local secrets. 
                  </p>
                  <div className="pt-2 mt-2 border-t border-white/5 flex gap-2 items-center">
                    <span className="text-[10px] uppercase tracking-widest text-white/30 font-bold">Public Key:{" "}</span>
                    <code className="text-xs text-blue-400/80 font-mono bg-blue-500/10 px-2 py-0.5 rounded">pk_demo_001_satoshi_abc</code>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </motion.div>
  )
}
