"use client"

import { useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { motion, AnimatePresence } from "framer-motion"
import {
  generateCredential,
  encodeCredentialForDownload,
  type CivitasCredential,
} from "@/lib/identity"
import { useCivitas } from "@/lib/civitas-provider"
import { useSolanaWallet } from "@/lib/solana-wallet"
import { useInitializeVault } from "@/lib/use-initialize-vault"
import { buildExplorerUrl } from "@/lib/solana"
import { WalletButton } from "@/components/wallet-button"
import {
  Shield,
  UserCircle,
  ArrowLeft,
  KeyRound,
  Copy,
  CheckCircle2,
  Download,
  AlertCircle,
  Briefcase,
  ExternalLink,
  Loader2,
  Globe,
} from "lucide-react"

type RegRole = "employee" | "auditor" | "employer"

// ─────────────────────────────────────────────────────────────────────────────
// Employer Onboarding Wizard
// ─────────────────────────────────────────────────────────────────────────────

function EmployerWizard() {
  const router = useRouter()
  const { address, connected, signMessage, signAndSendTransaction } = useSolanaWallet()
  const [snsDomain, setSnsDomain] = useState("")
  const [showSnsInput, setShowSnsInput] = useState(false)
  const [snsLoading, setSnsLoading] = useState(false)
  const [snsStatus, setSnsStatus] = useState<{ valid: boolean; message: string } | null>(null)
  const [signedIn, setSignedIn] = useState(false)
  const [signingIn, setSigningIn] = useState(false)
  const [signError, setSignError] = useState<string | null>(null)

  const { status: vaultStatus, vaultPda, error: vaultError, initialize } = useInitializeVault(
    address,
    connected ? signAndSendTransaction : null
  )

  // ── Step 1 → connect wallet
  // ── Step 2 → sign gasless auth message (only if not already signed)
  // ── Step 3 → initialize vault (skipped if already exists)
  // ── Step 4 → done → go to /employer

  const currentStep =
    !connected ? 1 :
    !signedIn ? 2 :
    (vaultStatus === "checking") ? 3 :
    (vaultStatus === "ready" || vaultStatus === "pending" || vaultStatus === "error") ? 3 :
    4 // exists | success

  const handleSignIn = async () => {
    if (!address) return
    setSigningIn(true)
    setSignError(null)
    try {
      const { buildSignInMessage, encodeMessage } = await import("@/lib/use-employer-session")
      const message = buildSignInMessage(address)
      const messageBytes = encodeMessage(message)
      await signMessage(messageBytes) // gasless — no SOL spent
      // Persist session
      const { signEmployerIn } = await import("@/lib/use-employer-session")
      await signEmployerIn(address, signMessage)
      setSignedIn(true)
    } catch (e: any) {
      setSignError(e?.message ?? "Message signing cancelled")
    } finally {
      setSigningIn(false)
    }
  }

  const handleSnsLookup = async () => {
    if (!snsDomain) return
    setSnsLoading(true)
    setSnsStatus(null)
    try {
      const { resolveSNS, isValidSNSDomain } = await import("@/lib/sns")
      if (!isValidSNSDomain(snsDomain)) {
        setSnsStatus({ valid: false, message: "Invalid domain format" })
        return
      }
      const owner = await resolveSNS(snsDomain)
      if (owner) {
        if (owner.toBase58() === address) {
          setSnsStatus({ valid: true, message: "Domain owned by you ✓" })
        } else {
          setSnsStatus({ valid: false, message: "Domain owned by another wallet" })
        }
      } else {
        setSnsStatus({ valid: false, message: "Domain not registered" })
      }
    } catch (e) {
      setSnsStatus({ valid: false, message: "Lookup failed" })
    } finally {
      setSnsLoading(false)
    }
  }

  const handleInitialize = () => initialize(snsDomain || undefined)

  const steps = [
    { num: 1, label: "Connect Wallet" },
    { num: 2, label: "Authorize Sign-In" },
    { num: 3, label: "Initialize Vault" },
    { num: 4, label: "Ready" },
  ]

  return (
    <div className="space-y-6">
      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {steps.map((s, i) => (
          <div key={s.num} className="flex items-center gap-2 flex-1">
            <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold border transition-all duration-300 ${
              currentStep > s.num
                ? "bg-emerald-500 border-emerald-500 text-black"
                : currentStep === s.num
                ? "bg-amber-500/20 border-amber-500/60 text-amber-300"
                : "bg-white/5 border-white/10 text-white/30"
            }`}>
              {currentStep > s.num ? <CheckCircle2 className="h-4 w-4" /> : s.num}
            </div>
            <span className={`text-[10px] font-bold uppercase tracking-widest ${currentStep === s.num ? "text-white/80" : "text-white/25"}`}>
              {s.label}
            </span>
            {i < steps.length - 1 && <div className="h-px flex-1 bg-white/10" />}
          </div>
        ))}
      </div>

      {/* ── Step 1: Connect Wallet ── */}
      <AnimatePresence mode="wait">
        {currentStep === 1 && (
          <motion.div key="step1" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="space-y-4">
            <div className="text-center py-4">
              <div className="inline-flex h-12 w-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 items-center justify-center mb-4">
                <Briefcase className="h-5 w-5 text-amber-400" />
              </div>
              <h2 className="text-xl font-light text-white">Connect your wallet</h2>
              <p className="text-xs text-white/40 mt-2 font-light leading-relaxed px-4">
                Your wallet becomes the treasury owner. Only you can authorize payroll batches.
              </p>
            </div>
            <div className="flex justify-center">
              <WalletButton />
            </div>
          </motion.div>
        )}

        {/* ── Step 2: Gasless Sign-In ── */}
        {currentStep === 2 && (
          <motion.div key="step2" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="space-y-4">
            <div className="text-center py-4">
              <div className="inline-flex h-12 w-12 rounded-2xl bg-blue-500/10 border border-blue-500/20 items-center justify-center mb-4">
                <KeyRound className="h-5 w-5 text-blue-400" />
              </div>
              <h2 className="text-xl font-light text-white">Authorize Sign-In</h2>
              <p className="text-xs text-white/40 mt-2 font-light leading-relaxed px-4">
                Sign a gasless message to prove wallet ownership. This costs <strong className="text-white">zero SOL</strong> and is instant.
              </p>
            </div>
            <div className="rounded-xl bg-black/40 border border-white/10 p-4 font-mono text-xs text-white/50 leading-relaxed break-all">
              <p className="text-white/30 mb-1 uppercase tracking-widest text-[9px]">Message Preview</p>
              <p>Civitas Protocol wants you to sign in.</p>
              <p className="text-emerald-400/70">{address}</p>
              <p className="mt-1">Statement: I authorize access to Civitas Protocol as an Employer.</p>
            </div>
            {signError && (
              <div className="flex items-start gap-2 p-3 rounded-xl border border-red-500/20 bg-red-500/10">
                <AlertCircle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
                <p className="text-xs text-red-300">{signError}</p>
              </div>
            )}
            <button
              onClick={handleSignIn}
              disabled={signingIn}
              className="w-full flex items-center justify-center gap-2 py-4 rounded-xl bg-blue-500 hover:bg-blue-400 text-black text-xs font-bold uppercase tracking-widest transition-all disabled:opacity-40 disabled:pointer-events-none"
            >
              {signingIn ? <><Loader2 className="h-4 w-4 animate-spin" /> Waiting for wallet...</> : "Authorize Sign-In"}
            </button>
          </motion.div>
        )}

        {/* ── Step 3: Initialize Vault ── */}
        {currentStep === 3 && (
          <motion.div key="step3" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="space-y-4">
            <div className="text-center py-4">
              <div className="inline-flex h-12 w-12 rounded-2xl bg-purple-500/10 border border-purple-500/20 items-center justify-center mb-4">
                {vaultStatus === "checking" ? (
                  <Loader2 className="h-5 w-5 text-purple-400 animate-spin" />
                ) : (
                  <Briefcase className="h-5 w-5 text-purple-400" />
                )}
              </div>
              <h2 className="text-xl font-light text-white">Initialize Treasury Vault</h2>
              <p className="text-xs text-white/40 mt-2 font-light leading-relaxed px-4">
                Creates your on-chain treasury in a single transaction (~0.003 SOL for rent). Your wallet will pop up to confirm.
              </p>
            </div>

            {vaultStatus === "checking" && (
              <p className="text-center text-xs text-white/40 animate-pulse">Checking for existing vault...</p>
            )}

            {vaultStatus === "ready" && (
              <div className="space-y-3">
                {/* Optional SNS domain */}
                <div className="space-y-2">
                  <button
                    onClick={() => setShowSnsInput(!showSnsInput)}
                    className="flex items-center gap-2 text-xs text-white/40 hover:text-white/70 transition-colors"
                  >
                    <Globe className="h-3 w-3" />
                    {showSnsInput ? "Skip SNS domain" : "Optionally link an SNS domain (e.g. civitas.sol)"}
                  </button>
                  <AnimatePresence>
                    {showSnsInput && (
                      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                        <div className="flex gap-2">
                          <input
                            autoFocus
                            value={snsDomain}
                            onChange={(e) => setSnsDomain(e.target.value)}
                            placeholder="yourcompany.sol"
                            className="flex-1 rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none transition focus:border-white/30"
                          />
                          <button
                            onClick={handleSnsLookup}
                            disabled={!snsDomain || snsLoading}
                            className="px-4 rounded-xl border border-violet-500/30 text-violet-400 text-[10px] font-bold uppercase tracking-widest hover:bg-violet-500/10 transition-all disabled:opacity-40"
                          >
                            {snsLoading ? "..." : "Verify"}
                          </button>
                        </div>
                        {snsStatus && (
                          <p className={`mt-2 text-[10px] font-bold uppercase tracking-widest ${snsStatus.valid ? "text-emerald-400" : "text-amber-400/70"}`}>
                            {snsStatus.message}
                          </p>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <button
                  onClick={handleInitialize}
                  className="w-full flex items-center justify-center gap-2 py-4 rounded-xl bg-purple-500 hover:bg-purple-400 text-black text-xs font-bold uppercase tracking-widest transition-all"
                >
                  Initialize Vault
                </button>
              </div>
            )}

            {vaultStatus === "pending" && (
              <div className="flex flex-col items-center gap-3 py-4">
                <Loader2 className="h-8 w-8 text-purple-400 animate-spin" />
                <p className="text-sm text-white/60">Confirm in your wallet and wait for confirmation...</p>
              </div>
            )}

            {vaultStatus === "error" && (
              <div className="space-y-3">
                <div className="flex items-start gap-2 p-3 rounded-xl border border-red-500/20 bg-red-500/10">
                  <AlertCircle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
                  <p className="text-xs text-red-300">{vaultError}</p>
                </div>
                <button
                  onClick={handleInitialize}
                  className="w-full py-4 rounded-xl bg-white/10 border border-white/15 text-white text-xs font-bold uppercase tracking-widest hover:bg-white/15 transition-all"
                >
                  Retry
                </button>
              </div>
            )}
          </motion.div>
        )}

        {/* ── Step 4: Done ── */}
        {currentStep === 4 && (
          <motion.div key="step4" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="space-y-5">
            <div className="flex flex-col items-center gap-4 py-4">
              <div className="h-14 w-14 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center">
                <CheckCircle2 className="h-7 w-7 text-emerald-400" />
              </div>
              <div className="text-center">
                <h2 className="text-xl font-light text-white">
                  {vaultStatus === "exists" ? "Vault already active" : "Vault initialized!"}
                </h2>
                <p className="text-xs text-white/40 mt-1">
                  {vaultStatus === "exists" ? "Your treasury vault is already set up on-chain." : "Your treasury is live on Solana Devnet."}
                </p>
              </div>
            </div>

            {vaultPda && (
              <div className="rounded-xl bg-black/40 border border-white/10 p-4 space-y-2">
                <p className="text-[10px] uppercase tracking-widest text-white/30">Treasury Vault PDA</p>
                <p className="font-mono text-xs text-white/70 break-all">{vaultPda}</p>
                <a
                  href={buildExplorerUrl("address", vaultPda)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-[10px] text-emerald-400/70 hover:text-emerald-400 transition-colors"
                >
                  <ExternalLink className="h-3 w-3" /> View on Solana Explorer
                </a>
              </div>
            )}

            <button
              onClick={() => router.push("/employer")}
              className="w-full py-5 rounded-xl bg-white text-black text-xs font-bold uppercase tracking-widest hover:bg-white/90 transition-all"
            >
              Open Employer Dashboard →
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Register Page
// ─────────────────────────────────────────────────────────────────────────────

export default function RegisterPage() {
  const router = useRouter()
  const { createNewCredential, importCredential } = useCivitas()

  const [role, setRole] = useState<RegRole>("employee")
  const [generated, setGenerated] = useState<CivitasCredential | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [copied, setCopied] = useState(false)
  const [backedUp, setBackedUp] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const tagLabel = role === "auditor" ? "auditor_tag" : "employee_tag"
  const fileName = role === "auditor" ? "civitas-auditor-credential.json" : "civitas-credential.json"
  const roleTitle = role === "auditor" ? "Auditor" : "Employee"

  const tabs: { id: RegRole; label: string; icon: React.ReactNode; color: string }[] = [
    { id: "employee", label: "Recipient", icon: <UserCircle className="w-4 h-4" />, color: "blue" },
    { id: "auditor", label: "Auditor", icon: <Shield className="w-4 h-4" />, color: "purple" },
    { id: "employer", label: "Employer", icon: <Briefcase className="w-4 h-4" />, color: "amber" },
  ]

  const handleGenerate = useCallback(async () => {
    setIsGenerating(true)
    setError(null)
    try {
      const cred = await createNewCredential()
      // Only employee/auditor roles are valid for credentials
      if (role === "employee" || role === "auditor") cred.role = role
      setGenerated(cred)
    } catch (err: any) {
      setError(err?.message || "Failed to generate credential")
    } finally {
      setIsGenerating(false)
    }
  }, [createNewCredential, role])

  const handleCopyTag = useCallback(() => {
    if (!generated) return
    navigator.clipboard.writeText(generated.employeeTag)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [generated])

  const handleDownload = useCallback(() => {
    if (!generated) return
    const credRole = (role === "employee" || role === "auditor") ? role : "employee"
    const enriched = { ...generated, role: credRole }
    const encoded = encodeCredentialForDownload(enriched)
    const blob = new Blob([encoded], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = fileName
    a.click()
    URL.revokeObjectURL(url)
    setBackedUp(true)
  }, [generated, fileName, role])

  const handleImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ""
    setError(null)
    try {
      const cred = await importCredential(file)
      setGenerated(cred)
      setBackedUp(true)
    } catch (err: any) {
      setError(err?.message || "Failed to import credential")
    }
  }, [importCredential])

  // Reset credential state when switching roles
  const handleRoleChange = (newRole: RegRole) => {
    setRole(newRole)
    setGenerated(null)
    setBackedUp(false)
    setError(null)
  }

  return (
    <div className="min-h-screen bg-black text-white relative overflow-hidden font-sans flex items-center justify-center">
      {/* ── Background Video & Overlay ── */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <video autoPlay loop muted playsInline className="w-full h-full object-cover opacity-60 mix-blend-screen">
          <source src="/videos/Animated_Privacy_Video_Element.mp4" type="video/mp4" />
        </video>
        <div className="absolute inset-0 bg-black/60 backdrop-blur-[4px]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,#000000_100%)] opacity-80" />
      </div>

      {/* ── Navbar ── */}
      <header className="absolute top-0 w-full z-10 px-6 py-6 flex justify-between items-center">
        <Link href="/" className="flex items-center gap-2 group text-white/50 hover:text-white transition-colors">
          <ArrowLeft className="h-4 w-4 group-hover:-translate-x-1 transition-transform" />
          <span className="text-xs font-bold uppercase tracking-widest">Return to Protocol</span>
        </Link>
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-md bg-white/5 border border-white/10 flex items-center justify-center font-bold text-white text-sm">C</div>
          <span className="text-xs font-bold tracking-[0.3em] uppercase text-white/40">Civitas Auth</span>
        </div>
      </header>

      {/* ── Central Modal ── */}
      <main className="relative z-10 w-full max-w-[520px] px-6 py-20 overflow-y-auto max-h-screen no-scrollbar">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        >
          {/* Title */}
          <div className="text-center mb-8">
            <h1 className="text-4xl font-light tracking-tight text-white mb-3">Identity Creation</h1>
            <p className="text-sm font-light text-white/40 uppercase tracking-widest">Generate your zero-knowledge root</p>
          </div>

          <div className="relative rounded-3xl bg-[#0a0a0a]/90 backdrop-blur-2xl border border-white/10 shadow-[0_0_60px_rgba(0,0,0,0.8)] overflow-hidden">

            {/* Ambient glow */}
            <div className={`absolute top-0 inset-x-0 h-40 opacity-20 blur-[50px] transition-colors duration-700 pointer-events-none
              ${role === "employee" ? "bg-blue-500" : role === "auditor" ? "bg-purple-500" : "bg-amber-500"}`}
            />

            {/* Role Tabs */}
            <AnimatePresence>
              {!(role === "employer") && !generated && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="p-2 border-b border-white/[0.05]"
                >
                  <div className="flex bg-black/50 p-1.5 rounded-2xl border border-white/[0.05]">
                    {tabs.map((tab) => {
                      const isActive = role === tab.id
                      return (
                        <button
                          key={tab.id}
                          onClick={() => handleRoleChange(tab.id)}
                          className={`relative flex-1 flex flex-col items-center gap-1.5 py-3 rounded-xl transition-all duration-300 z-10 ${isActive ? "text-white" : "text-white/40 hover:text-white/70"}`}
                        >
                          {isActive && (
                            <motion.div
                              layoutId="activeRoleBadge"
                              className="absolute inset-0 rounded-xl bg-white/[0.06] border border-white/10"
                              transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                            />
                          )}
                          <div className={`relative z-10 transition-colors duration-300 ${isActive ? `text-${tab.color}-400` : ""}`}>
                            {tab.icon}
                          </div>
                          <span className="text-[10px] font-bold uppercase tracking-widest relative z-10">{tab.label}</span>
                        </button>
                      )
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Also show tab row when employer is selected so user can switch back */}
            {role === "employer" && (
              <div className="p-2 border-b border-white/[0.05]">
                <div className="flex bg-black/50 p-1.5 rounded-2xl border border-white/[0.05]">
                  {tabs.map((tab) => {
                    const isActive = role === tab.id
                    return (
                      <button
                        key={tab.id}
                        onClick={() => handleRoleChange(tab.id)}
                        className={`relative flex-1 flex flex-col items-center gap-1.5 py-3 rounded-xl transition-all duration-300 z-10 ${isActive ? "text-white" : "text-white/40 hover:text-white/70"}`}
                      >
                        {isActive && (
                          <motion.div
                            layoutId="activeRoleBadge"
                            className="absolute inset-0 rounded-xl bg-white/[0.06] border border-white/10"
                            transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                          />
                        )}
                        <div className={`relative z-10 transition-colors duration-300 ${isActive ? `text-${tab.color}-400` : ""}`}>
                          {tab.icon}
                        </div>
                        <span className="text-[10px] font-bold uppercase tracking-widest relative z-10">{tab.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            <div className="p-8">
              {/* ── EMPLOYER WIZARD ── */}
              {role === "employer" ? (
                <EmployerWizard />
              ) : (
                <>
                  {error && (
                    <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
                      <div className="flex items-start gap-3 p-4 rounded-xl border border-red-500/20 bg-red-500/10">
                        <AlertCircle className="h-4 w-4 text-red-400 mt-0.5" />
                        <p className="text-xs text-red-300/90 leading-relaxed font-mono break-all">{error}</p>
                      </div>
                    </motion.div>
                  )}

                  {!generated ? (
                    /* ── State 1: No Credential ── */
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
                      <div className="text-center mb-8">
                        <div className={`inline-flex h-12 w-12 rounded-2xl border items-center justify-center mb-4 transition-colors duration-500 ${role === "employee" ? "bg-blue-500/10 border-blue-500/20 text-blue-400" : "bg-purple-500/10 border-purple-500/20 text-purple-400"}`}>
                          <KeyRound className="h-5 w-5" />
                        </div>
                        <h2 className="text-xl font-light text-white">{roleTitle} Root Storage</h2>
                        <p className="text-xs text-white/40 mt-2 font-light leading-relaxed px-4">
                          Your master secret is generated within your browser sandbox.
                          Only the hashed <strong className="text-white">tag</strong> is safely shared publicly.
                        </p>
                      </div>

                      <button
                        onClick={handleGenerate}
                        disabled={isGenerating}
                        className={`group relative w-full flex items-center justify-center gap-3 py-5 rounded-xl text-black font-bold text-sm uppercase tracking-widest transition-all overflow-hidden ${role === "employee" ? "bg-blue-500 hover:bg-blue-400 hover:shadow-[0_0_20px_rgba(59,130,246,0.3)]" : "bg-purple-500 hover:bg-purple-400 hover:shadow-[0_0_20px_rgba(168,85,247,0.3)]"} disabled:opacity-40 disabled:pointer-events-none`}
                      >
                        {isGenerating ? "Synthesizing Hardware Noise..." : `Generate ${roleTitle} Credential`}
                      </button>

                      <div className="relative py-2">
                        <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-white/10" /></div>
                        <div className="relative flex justify-center text-[10px] uppercase tracking-[0.2em] font-bold"><span className="bg-[#0a0a0a] px-3 text-white/30">Already have one?</span></div>
                      </div>

                      <div className="flex gap-3">
                        <label className={`flex-1 flex text-center justify-center py-4 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-colors cursor-pointer text-xs uppercase tracking-widest font-bold text-white/70 hover:text-white ${isGenerating ? "opacity-40 pointer-events-none" : ""}`}>
                          Import Identity File
                          <input type="file" accept=".json" onChange={handleImport} className="hidden" />
                        </label>
                      </div>
                    </motion.div>
                  ) : (
                    /* ── State 2: Credential Generated ── */
                    <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="space-y-6">
                      <div className="flex flex-col items-center justify-center pb-4 border-b border-white/[0.05]">
                        <div className={`px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest border transition-colors ${role === "auditor" ? "border-purple-500/30 bg-purple-500/10 text-purple-400" : "border-blue-500/30 bg-blue-500/10 text-blue-400"}`}>
                          {roleTitle} Setup Successful
                        </div>
                      </div>

                      <div className="space-y-3">
                        <div className="flex items-center gap-3 text-sm font-semibold tracking-wide">
                          <span className="w-5 h-5 rounded-full bg-white text-black text-[10px] flex items-center justify-center">1</span>
                          <h3 className="text-white">Distribution Hash (Tag)</h3>
                        </div>
                        <p className="text-xs text-white/40 font-light pl-8">
                          This is your public identifier. Send this exactly as it appears to {role === "auditor" ? "the authorized employer node" : "your employer node"}.
                        </p>
                        <div className="ml-8 relative group">
                          <div className="p-4 rounded-xl bg-black/50 border border-white/10 font-mono text-sm text-white/80 break-all select-all pr-12 transition-colors group-hover:bg-white/[0.03]">
                            {generated.employeeTag}
                          </div>
                          <button
                            onClick={handleCopyTag}
                            className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-md hover:bg-white/10 text-white/50 hover:text-white transition-colors"
                          >
                            {copied ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                          </button>
                        </div>
                      </div>

                      <div className="space-y-3 pt-4 border-t border-white/[0.05]">
                        <div className="flex items-center gap-3 text-sm font-semibold tracking-wide">
                          <span className="w-5 h-5 rounded-full bg-white text-black text-[10px] flex items-center justify-center">2</span>
                          <h3 className="text-white">Keyfile Backup</h3>
                        </div>
                        <p className="text-xs text-white/40 font-light pl-8">
                          Your master secret is currently locked inside your active browser session. If you clear cache or change devices, you must inject this keyfile to restore access.
                        </p>
                        <div className="ml-8">
                          <button
                            onClick={handleDownload}
                            className={`w-full flex items-center justify-center gap-2 py-4 rounded-xl text-xs uppercase font-bold tracking-widest transition-all ${backedUp ? "bg-white/10 border border-white/20 text-white" : "bg-emerald-500 border border-emerald-500 text-black hover:bg-emerald-400 hover:shadow-[0_0_20px_rgba(16,185,129,0.2)] animate-[pulse_2s_cubic-bezier(0.4,0,0.6,1)_infinite]"}`}
                            style={backedUp ? { animation: "none" } : {}}
                          >
                            {backedUp ? <><CheckCircle2 className="h-4 w-4" /> Safeguarded Keyfile</> : <><Download className="h-4 w-4" /> Download Keyfile</>}
                          </button>
                        </div>
                      </div>

                      <div className="pt-4 border-t border-white/[0.05]">
                        <button
                          onClick={() => router.push("/login")}
                          disabled={!backedUp}
                          className={`w-full py-5 rounded-xl text-xs uppercase tracking-widest font-bold transition-colors ${backedUp ? "bg-white text-black hover:bg-white/90" : "bg-white/5 text-white/30 cursor-not-allowed"}`}
                        >
                          Initialize Login Terminal
                        </button>
                        {!backedUp && (
                          <p className="text-center text-[10px] font-mono uppercase tracking-widest text-[#ef4444] mt-3">
                            * You must download the keyfile backup first.
                          </p>
                        )}
                      </div>
                    </motion.div>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="mt-8 text-center text-[10px] uppercase font-mono tracking-widest text-white/20">
            <Link href="/login" className="hover:text-white transition-colors">Already have identity established? Log In</Link>
          </div>
        </motion.div>
      </main>

      <footer className="absolute bottom-6 w-full text-center pointer-events-none z-10 px-6">
        <p className="text-[10px] font-mono tracking-widest uppercase text-white/20">
          Powered by Solana · Nillion · private computation
        </p>
      </footer>
    </div>
  )
}
