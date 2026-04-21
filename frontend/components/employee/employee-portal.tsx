"use client"

import { useEffect, useRef, useState } from "react"
import { useAuth } from "@/lib/auth-context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Loader2, RefreshCw, ExternalLink, ShieldCheck, UploadCloud, Link as LinkIcon } from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"

interface Voucher {
  voucher_id: string
  amount: number
  currency: string
  status: "issued" | "redeemed" | "settled"
  memo?: string
  issued_at: string
  settlement_txid?: string
}

interface CredentialBundle {
  ciphertext: string
  iv: string
  signature: string
}

export function EmployeePortal({ employeeId }: { employeeId: string }) {
  const { user } = useAuth()
  const [vouchers, setVouchers] = useState<Voucher[]>([])
  const [isLoading, setIsLoading] = useState(false)

  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const [credentialStatus, setCredentialStatus] = useState<"idle" | "verifying" | "verified" | "error">("idle")
  const [credentialError, setCredentialError] = useState("")
  const [credentialFileName, setCredentialFileName] = useState("")
  const [credentialPayload, setCredentialPayload] = useState<CredentialBundle | null>(null)
  const [credentialEmployeeTag, setCredentialEmployeeTag] = useState<string | null>(null)
  const credentialInputRef = useRef<HTMLInputElement | null>(null)

  const loadVouchers = async () => {
    setIsLoading(true)
    try {
      const res = await fetch("/api/employees/vouchers", { cache: "no-store" })
      if (!res.ok) throw new Error("Failed to load vouchers")
      const data = await res.json()
      setVouchers(data.vouchers || [])
    } catch (err: any) {
      setError(err.message || "Unable to fetch vouchers")
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadVouchers()
  }, [])

  const handleCredentialUpload = async (file: File) => {
    setCredentialError("")
    setCredentialStatus("verifying")
    setCredentialFileName(file.name)
    try {
      const text = await file.text()
      const parsed = JSON.parse(text)
      // Support both formats:
      // 1. { employee_id, employee_tag, credential: {...} } (from voucher download)
      // 2. { ciphertext, iv, signature } (direct credential)
      const payload: CredentialBundle | undefined = parsed?.credential ?? parsed
      const employeeTagFromFile: string | undefined = parsed?.employee_tag

      if (!payload?.ciphertext || !payload?.iv || !payload?.signature) {
        throw new Error("File must include a credential payload")
      }

      const res = await fetch("/api/employees/credential/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          credential: payload,
          employee_tag: employeeTagFromFile,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || "Verification failed")
      }
      setCredentialStatus("verified")
      setCredentialPayload(payload)
      setCredentialEmployeeTag(employeeTagFromFile || null)
    } catch (err: any) {
      setCredentialStatus("error")
      setCredentialPayload(null)
      setCredentialEmployeeTag(null)
      setCredentialError(err.message || "Unable to verify credential")
    } finally {
      if (credentialInputRef.current) {
        credentialInputRef.current.value = ""
      }
    }
  }

  const redeemVoucher = async (voucherId: string) => {
    setError("")
    if (credentialStatus !== "verified" || !credentialPayload) {
      setError("Upload and verify your credential bundle before redeeming.")
      return
    }
    setIsLoading(true)
    try {
      const res = await fetch("/api/employees/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          voucher_id: voucherId,
          credential: credentialPayload,
          employee_tag: credentialEmployeeTag,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Redemption failed")
      setSuccess(`Settlement broadcast. txid=${data.txid}`)
      await loadVouchers()
    } catch (err: any) {
      setError(err.message || "Unable to redeem voucher")
    } finally {
      setIsLoading(false)
    }
  }

  if (user && user.id !== employeeId) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-center">
        <p className="text-sm text-muted-foreground">You do not have access to this employee workspace.</p>
      </div>
    )
  }

  const canViewAmounts = credentialStatus === "verified"
  const canRedeem = credentialStatus === "verified" && !!credentialPayload

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="space-y-8"
    >
      <input
        ref={credentialInputRef}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void handleCredentialUpload(file)
        }}
      />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium text-pink-500 uppercase tracking-widest mb-1">Employee Portal</p>
          <h1 className="text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-white/60 tracking-tight">Voucher Locker</h1>
        </div>
        <Button variant="outline" size="sm" className="gap-2 bg-transparent text-white/70 hover:text-white border-white/20 hover:bg-white/10 rounded-full px-5 transition-all" onClick={loadVouchers} disabled={isLoading}>
          <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <div className="flex justify-center max-w-2xl mx-auto mb-8">
        {/* Credential Card */}
        <motion.div
          className="glass-card rounded-2xl p-6 relative overflow-hidden group relative"
          whileHover={{ y: -2 }}
          transition={{ duration: 0.2 }}
        >
          <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
            <ShieldCheck className="h-24 w-24 text-emerald-500" />
          </div>

          <div className="relative z-10">
            <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/20 border border-emerald-500/30">
                <ShieldCheck className="h-4 w-4 text-emerald-400" />
              </span>
              Zero-Knowledge Credential
            </h3>

            <div className="space-y-4">
              <p className="text-sm text-white/50 leading-relaxed">
                Upload the voucher file you downloaded from your employer to unlock balances.
              </p>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <Button
                  className="gap-2 bg-white/10 hover:bg-white/20 text-white shadow-[0_0_15px_rgba(255,255,255,0.05)] border border-white/10 transition-all rounded-full px-5"
                  onClick={() => credentialInputRef.current?.click()}
                >
                  <UploadCloud className="h-4 w-4" />
                  Select File
                </Button>

                <div className="flex items-center gap-3 bg-white/5 rounded-full px-4 py-1.5 border border-white/5 flex-1 overflow-hidden">
                  <span className="text-xs text-white/60 truncate flex-1">
                    {credentialFileName || "No file selected"}
                  </span>
                  {credentialStatus === "idle" && <Badge variant="outline" className="text-white/40 border-white/10 bg-transparent shrink-0">Not verified</Badge>}
                  {credentialStatus === "verifying" && <Badge className="bg-blue-500/20 text-blue-400 border-none shrink-0"><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Verifying</Badge>}
                  {credentialStatus === "error" && <Badge className="bg-red-500/20 text-red-400 border-none shrink-0">Invalid</Badge>}
                  {credentialStatus === "verified" && (
                    <motion.div
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                    >
                      <Badge className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shadow-[0_0_10px_rgba(16,185,129,0.3)] shrink-0 px-2 py-0.5 group">
                        <ShieldCheck className="h-3 w-3 mr-1.5 opacity-70 group-hover:opacity-100 transition-opacity" />
                        Verified by Nillion TEE
                      </Badge>
                    </motion.div>
                  )}
                </div>
              </div>

              {credentialError && <p className="text-xs text-red-400 font-medium">{credentialError}</p>}
              {!canViewAmounts && (
                <p className="text-xs text-white/40 italic">
                  Amounts stay hidden until the credential proves you own them.
                </p>
              )}
            </div>
          </div>
        </motion.div>
      </div>

      {error && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-400">
          {error}
        </motion.div>
      )}

      {success && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-sm text-emerald-400">
          {success}
        </motion.div>
      )}

      <div className="space-y-4">
        {isLoading && (
          <div className="flex items-center gap-3 text-sm text-white/50 p-6 glass-card rounded-2xl justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-purple-400" />
            Syncing vouchers from network...
          </div>
        )}

        {vouchers.length === 0 && !isLoading && (
          <div className="p-8 glass-card rounded-2xl flex items-center justify-center border-dashed border-white/10">
            <p className="text-sm text-white/40">No vouchers issued yet. Check back after the next payroll run.</p>
          </div>
        )}

        <AnimatePresence>
          {vouchers.map((voucher: any, index: number) => (
            <motion.div
              key={voucher.voucher_id}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: index * 0.05 }}
              className="glass-card rounded-2xl p-6 hover:bg-white/5 transition-colors group border border-white/5 relative overflow-hidden"
            >
              <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-purple-500 to-pink-500 opacity-0 group-hover:opacity-100 transition-opacity" />

              <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-2">
                  <div className="flex items-center gap-3 mb-1">
                    <p className="text-xs font-mono text-white/40 bg-white/5 px-2 py-0.5 rounded-md">ID: {voucher.voucher_id.substring(0, 8)}...</p>
                    <p className="text-xs text-white/40">{new Date(voucher.issued_at).toLocaleString()}</p>
                  </div>

                  <div className="flex items-center gap-3">
                    <p className={`text-3xl font-bold tracking-tight ${canViewAmounts ? 'text-white drop-shadow-md' : 'text-white/30 filter blur-[2px]'}`}>
                      {canViewAmounts ? `${voucher.amount} ${voucher.currency}` : "Locked amount"}
                    </p>
                    {!canViewAmounts && <span className="text-xs font-medium text-pink-400 bg-pink-500/10 px-2 py-1 rounded-full border border-pink-500/20">Requires Unlock</span>}
                  </div>

                  <div className="flex items-center gap-3 mt-1">
                    <p className="text-sm text-white/60">
                      {canViewAmounts ? voucher.memo || "Payroll voucher" : "Upload credential to view details"}
                    </p>
                    <Badge
                      className={`${voucher.status === "issued"
                          ? "bg-purple-500/20 text-purple-300 border shadow-[0_0_10px_rgba(168,85,247,0.2)] hover:bg-purple-500/30"
                          : voucher.status === "settled"
                            ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30"
                            : "bg-white/10 text-white/50 border border-white/10"
                        } capitalize px-3 rounded-full`}
                    >
                      {voucher.status}
                    </Badge>
                  </div>
                </div>

                <div className="flex flex-col gap-3 sm:items-end min-w-[200px]">
                  {voucher.status === "issued" ? (
                    <Button
                      onClick={() => redeemVoucher(voucher.voucher_id)}
                      disabled={isLoading || !canRedeem}
                      className={`w-full sm:w-auto shadow-lg transition-all rounded-full px-8 py-5 h-auto font-medium cursor-pointer ${canRedeem
                          ? "bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white shadow-[0_0_20px_rgba(236,72,153,0.3)] hover:scale-105"
                          : "bg-white/5 text-white/30 border border-white/10 cursor-not-allowed"
                        }`}
                    >
                      {canRedeem ? "Redeem to Wallet" : "Unlock to Redeem"}
                    </Button>
                  ) : (
                    <Button disabled className="w-full sm:w-auto rounded-full bg-white/5 text-white/30 border border-white/5 px-8">
                      Already Redeemed
                    </Button>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}
