"use client"

import { useState, useCallback, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useCivitas } from "@/lib/civitas-provider"
import { useSolanaWallet } from "@/lib/solana-wallet"
import { signEmployerIn, getEmployerSession } from "@/lib/use-employer-session"
import Link from "next/link"
import { motion, AnimatePresence } from "framer-motion"
import { Shield, Briefcase, UserCircle, ChevronRight, UploadCloud, Lock, ArrowLeft, KeyRound } from "lucide-react"
import { WalletButton } from "@/components/wallet-button"

type TabType = "employer" | "employee" | "auditor"

export default function LoginPage() {
  const router = useRouter()
  const { connected, address, signMessage } = useSolanaWallet()
  const { setWalletAddress, setUserRole, credential, importCredential } = useCivitas()

  const [activeTab, setActiveTab] = useState<TabType>("employer")
  const [error, setError] = useState<string | null>(null)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [hasExistingSession, setHasExistingSession] = useState(false)

  useEffect(() => {
    if (connected && address) {
      setWalletAddress(address)
      if (activeTab === "employer") {
        const session = getEmployerSession(address)
        setHasExistingSession(Boolean(session))
      }
    }
  }, [connected, address, setWalletAddress, activeTab])

  const doEmployeeLogin = useCallback(async (nonce: string, tag: string) => {
    setError(null)
    setIsLoading(true)
    setStatusMsg("Authenticating Identity...")

    try {
      const res = await fetch("/api/auth/zk-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: "tag", employee_tag: tag, proof: { nonce }, role: "employee" }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Auth failed (${res.status})`)
      setUserRole("employee")
      setStatusMsg("Identity Verified.")
      window.location.href = "/employees"
    } catch (err: any) {
      setError(`Login failed: ${err?.message || String(err)}`)
      setStatusMsg(null)
    } finally {
      setIsLoading(false)
    }
  }, [setUserRole])

  const doAuditorLogin = useCallback(async (nonce: string, tag: string) => {
    setError(null)
    setIsLoading(true)
    setStatusMsg("Authenticating Auditor Node...")

    try {
      const res = await fetch("/api/auth/zk-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: "tag", employee_tag: tag, proof: { nonce }, role: "auditor" }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Auth failed (${res.status})`)
      setUserRole("auditor")
      setStatusMsg("Clearance Granted.")
      window.location.href = "/auditors"
    } catch (err: any) {
      setError(`Login failed: ${err?.message || String(err)}`)
      setStatusMsg(null)
    } finally {
      setIsLoading(false)
    }
  }, [setUserRole])

  const handleCredentialFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ""
    setError(null)
    try {
      const cred = await importCredential(file)
      await doEmployeeLogin(cred.credentialNonce, cred.employeeTag)
    } catch (err: any) {
      setError(`Failed: ${err?.message || String(err)}`)
    }
  }, [importCredential, doEmployeeLogin])

  const handleAuditorCredentialFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ""
    setError(null)
    try {
      const cred = await importCredential(file)
      await doAuditorLogin(cred.credentialNonce, cred.employeeTag)
    } catch (err: any) {
      setError(`Failed: ${err?.message || String(err)}`)
    }
  }, [importCredential, doAuditorLogin])

  const handleEmployerSignIn = useCallback(async () => {
    if (!address) {
      setError("Connect a Solana wallet first.")
      return
    }

    setError(null)
    setStatusMsg("Waiting for wallet signature...")
    setIsSigningIn(true)

    try {
      await signEmployerIn(address, signMessage)
      setStatusMsg("Session authorized.")
      setHasExistingSession(true)
    } catch (err: any) {
      setError(err?.message || "Sign-in cancelled.")
      setStatusMsg(null)
    } finally {
      setIsSigningIn(false)
    }
  }, [address, signMessage])

  const handleEmployer = useCallback(() => {
    if (!connected || !address) {
      setError("Establish a wallet connection first.")
      return
    }
    if (!hasExistingSession) {
      setError("Authorize sign-in first.")
      return
    }
    setWalletAddress(address)
    setUserRole("employer")
    router.push("/employer")
  }, [connected, address, hasExistingSession, setWalletAddress, setUserRole, router])

  const tabs = [
    { id: "employer" as const, label: "Enterprise", icon: <Briefcase className="w-4 h-4" /> },
    { id: "employee" as const, label: "Recipient", icon: <UserCircle className="w-4 h-4" /> },
    { id: "auditor" as const, label: "Auditor", icon: <Shield className="w-4 h-4" /> },
  ]

  return (
    <div className="min-h-screen bg-black text-white relative overflow-hidden font-sans flex items-center justify-center">
      <div className="absolute inset-0 z-0 pointer-events-none">
        <video autoPlay loop muted playsInline className="w-full h-full object-cover opacity-60 mix-blend-screen">
          <source src="/videos/Animated_Privacy_Video_Element.mp4" type="video/mp4" />
        </video>
        <div className="absolute inset-0 bg-black/60 backdrop-blur-[4px]" />
      </div>

      <header className="absolute top-0 w-full z-10 px-6 py-6 flex justify-between items-center">
        <Link href="/" className="flex items-center gap-2 group text-white/50 hover:text-white transition-colors">
          <ArrowLeft className="h-4 w-4 group-hover:-translate-x-1 transition-transform" />
          <span className="text-xs font-bold uppercase tracking-widest">Return to Protocol</span>
        </Link>
        <div className="flex items-center gap-3">
          <img src="/logo-light.svg" alt="Civitas" className="h-4 w-auto opacity-60" />
          <span className="text-xs font-bold tracking-[0.3em] uppercase text-white/40">Auth</span>
        </div>
      </header>

      <main className="relative z-10 w-full max-w-[420px] px-6">
        <div className="text-center mb-10">
          <h1 className="text-4xl font-light tracking-tight text-white mb-3">Portal Access</h1>
          <p className="text-sm font-light text-white/40 uppercase tracking-widest">Select your authorization layer</p>
        </div>

        <div className="relative rounded-3xl bg-[#0a0a0a]/90 backdrop-blur-2xl border border-white/10 overflow-hidden">
          <div className="p-2 border-b border-white/[0.05]">
            <div className="flex bg-black/50 p-1.5 rounded-2xl border border-white/[0.05]">
              {tabs.map((tab) => {
                const isActive = activeTab === tab.id
                return (
                  <button
                    key={tab.id}
                    onClick={() => { setActiveTab(tab.id); setError(null); setStatusMsg(null) }}
                    className={`relative flex-1 flex flex-col items-center gap-1.5 py-3 rounded-xl transition-all duration-300 z-10 ${isActive ? "text-white" : "text-white/40 hover:text-white/70"}`}
                  >
                    {isActive && <motion.div layoutId="activeTabBadge" className="absolute inset-0 rounded-xl bg-white/[0.06] border border-white/10" />}
                    <div className="relative z-10">{tab.icon}</div>
                    <span className="text-[10px] font-bold uppercase tracking-widest relative z-10">{tab.label}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="p-8 space-y-6">
            <AnimatePresence mode="wait">
              {error && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="p-4 rounded-xl border border-red-500/20 bg-red-500/10 text-xs text-red-300">{error}</motion.div>}
              {statusMsg && !error && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="p-4 rounded-xl border border-white/10 bg-white/5 text-xs text-white/70">{statusMsg}</motion.div>}
            </AnimatePresence>

            {activeTab === "employer" && (
              <div className="space-y-4">
                <div className="flex justify-center"><WalletButton /></div>
                {connected && address && <p className="text-xs font-mono text-emerald-300 break-all text-center">{address}</p>}
                {connected && (
                  <button onClick={handleEmployerSignIn} disabled={isSigningIn} className="w-full py-3 rounded-xl border border-white/10 bg-black/40 hover:bg-white/5 text-sm">
                    {hasExistingSession ? "Session authorized" : isSigningIn ? "Authorizing..." : "Authorize Sign-In"}
                  </button>
                )}
                <button onClick={handleEmployer} disabled={!connected || !hasExistingSession} className="w-full flex items-center justify-center gap-2 py-4 rounded-xl bg-emerald-500 text-black font-bold text-xs uppercase tracking-widest disabled:opacity-40">
                  Access Employer <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}

            {activeTab === "employee" && (
              <div className="space-y-4">
                {credential && credential.role !== "auditor" && (
                  <button onClick={() => doEmployeeLogin(credential.credentialNonce, credential.employeeTag)} disabled={isLoading} className="w-full p-4 rounded-xl border border-blue-500/30 bg-blue-500/10 text-xs font-mono text-white/80">
                    {credential.employeeTag.slice(0, 16)}...
                  </button>
                )}
                <label className="block w-full rounded-xl border border-white/10 bg-black/40 hover:bg-white/5 transition-all cursor-pointer">
                  <div className="flex flex-col items-center justify-center py-8 gap-3">
                    <UploadCloud className="h-6 w-6 text-white/30" />
                    <p className="text-sm font-medium text-white">Import Credential File</p>
                  </div>
                  <input type="file" accept=".json" onChange={handleCredentialFile} className="hidden" />
                </label>
                <div className="text-center text-xs text-white/30">No identity root? <Link href="/register" className="text-blue-400">Synthesize one now.</Link></div>
              </div>
            )}

            {activeTab === "auditor" && (
              <div className="space-y-4">
                {credential && credential.role === "auditor" && (
                  <button onClick={() => doAuditorLogin(credential.credentialNonce, credential.employeeTag)} disabled={isLoading} className="w-full p-4 rounded-xl border border-purple-500/30 bg-purple-500/10 text-xs font-mono text-white/80">
                    {credential.employeeTag.slice(0, 16)}...
                  </button>
                )}
                <label className="block w-full rounded-xl border border-white/10 bg-black/40 hover:bg-white/5 transition-all cursor-pointer">
                  <div className="flex flex-col items-center justify-center py-8 gap-3">
                    <UploadCloud className="h-6 w-6 text-white/30" />
                    <p className="text-sm font-medium text-white">Import Auditor Clearance</p>
                  </div>
                  <input type="file" accept=".json" onChange={handleAuditorCredentialFile} className="hidden" />
                </label>
                <div className="text-center text-xs text-white/30">Need auditor clearance? <Link href="/register" className="text-purple-400">Request here.</Link></div>
              </div>
            )}
          </div>
        </div>
      </main>

      <footer className="absolute bottom-6 w-full text-center pointer-events-none z-10 px-6">
        <p className="text-[10px] font-mono tracking-widest uppercase text-white/20">Powered by Solana · Nillion · private computation</p>
      </footer>
    </div>
  )
}
