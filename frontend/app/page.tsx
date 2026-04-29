"use client"

import { useState, useCallback, useRef } from "react"
import { useCivitas } from "@/lib/civitas-provider"
import { generateDownloadUrl } from "@/lib/identity"
import Link from "next/link"
import { motion, AnimatePresence, useMotionValue, useSpring, useTransform } from "framer-motion"
import {
  Shield, Lock, Zap, ArrowRight, KeyRound, Copy, Download,
  CheckCircle2, Briefcase, UserCircle, ChevronRight, Github,
  Twitter, Send, ExternalLink, Database, Cpu, BookOpen,
  X, PlayCircle, Users, Mail, User, Building2
} from "lucide-react"
import { redirect } from "next/navigation"
import { PrivacyStackVisualizer } from "@/components/ui/privacy-stack"

// ── Tilt Card wrapper ────────────────────────────────────────────
function TiltCard({ children, className = "", onClick }: { children: React.ReactNode; className?: string; onClick?: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const springX = useSpring(x, { stiffness: 150, damping: 20 })
  const springY = useSpring(y, { stiffness: 150, damping: 20 })
  const rotateX = useTransform(springY, [-0.5, 0.5], [6, -6])
  const rotateY = useTransform(springX, [-0.5, 0.5], [-6, 6])

  const handleMouse = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!ref.current) return
    const rect = ref.current.getBoundingClientRect()
    x.set((e.clientX - rect.left) / rect.width - 0.5)
    y.set((e.clientY - rect.top) / rect.height - 0.5)
  }
  const handleLeave = () => { x.set(0); y.set(0) }

  return (
    <motion.div
      ref={ref}
      style={{ rotateX, rotateY, transformStyle: "preserve-3d" }}
      onMouseMove={handleMouse}
      onMouseLeave={handleLeave}
      onClick={onClick}
      className={className}
    >
      {children}
    </motion.div>
  )
}

export default function HomePage() {
  const { userRole, setUserRole, credential, createNewCredential } = useCivitas()
  const [newCred, setNewCred] = useState<any>(null)
  const [copied, setCopied] = useState(false)
  const [email, setEmail] = useState("")
  const [subscribed, setSubscribed] = useState(false)
  const [isSubscribing, setIsSubscribing] = useState(false)

  // Waitlist State
  const [showWaitlist, setShowWaitlist] = useState(false)
  const [waitlistForm, setWaitlistForm] = useState({ email: "", company: "", twitter: "" })
  const [waitlistStatus, setWaitlistStatus] = useState<"idle" | "submitting" | "success" | "error">("idle")

  const handleGenerateCredential = useCallback(async () => {
    const cred = await createNewCredential()
    setNewCred(cred)
  }, [createNewCredential])

  const handleCopyTag = useCallback(() => {
    if (credential) {
      navigator.clipboard.writeText(credential.employeeTag)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }, [credential])

  const handleSubscribe = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) return
    setIsSubscribing(true)
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, company: "Newsletter Subscriber", twitter: "" })
      })
      if (res.ok) {
        setSubscribed(true)
        setEmail("")
      }
    } catch (err) {
      console.error("Failed to subscribe:", err)
    } finally {
      setIsSubscribing(false)
    }
  }

  const handleJoinWaitlist = async (e: React.FormEvent) => {
    e.preventDefault()
    setWaitlistStatus("submitting")
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(waitlistForm)
      })
      if (!res.ok) throw new Error("Failed to submit")
      setWaitlistStatus("success")
      setTimeout(() => {
        setShowWaitlist(false)
        setWaitlistStatus("idle")
        setWaitlistForm({ email: "", company: "", twitter: "" })
      }, 2500)
    } catch (error) {
      setWaitlistStatus("error")
      setTimeout(() => setWaitlistStatus("idle"), 2500)
    }
  }

  const staggerContainer: any = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.12 } }
  }
  const fadeInUp: any = {
    hidden: { opacity: 0, y: 32 },
    show: { opacity: 1, y: 0, transition: { duration: 0.9, ease: [0.16, 1, 0.3, 1] } }
  }

  const scanLine = {
    initial: { top: "-10%", opacity: 0 },
    animate: { top: "110%", opacity: [0, 0.6, 0] },
    transition: { duration: 2.4, repeat: Infinity, repeatDelay: 3, ease: "linear" }
  }

  return (
    <div className="min-h-screen bg-black text-white selection:bg-emerald-500/30 selection:text-white relative overflow-hidden font-sans">

      {/* ── Background Video & Overlay ── */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <video autoPlay loop muted playsInline className="w-full h-full object-cover opacity-60 mix-blend-screen">
          <source src="/videos/Animated_Privacy_Video_Element.mp4" type="video/mp4" />
        </video>
        <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-black/80" />
      </div>

      {/* ── Navbar ── */}
      <header className="fixed top-0 w-full z-50 transition-all duration-300">
        <div className="absolute inset-0 bg-black/50 backdrop-blur-xl border-b border-white/[0.05]" />
        <div className="max-w-7xl mx-auto px-6 py-4 relative">
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="flex items-center justify-between"
          >
            <Link href="/" className="flex items-center gap-3 group">
              <img
                src="/logo-light.svg"
                alt="Civitas"
                className="h-5 md:h-6 w-auto opacity-90 group-hover:opacity-100 transition-opacity duration-300"
              />
            </Link>

            <nav className="hidden md:flex items-center gap-8">
              {[
                { label: "Architecture", href: "https://github.com/MeetCivitas/Civitas-Sol/blob/main/WHITEPAPER.pdf" },
                { label: "Solutions", href: "https://x.com/RythmeNagr64107/status/2034605883200806945?s=20" },
                { label: "Developers", href: "https://github.com/MeetCivitas/Civitas-Sol" },
              ].map(item => (
                <a key={item.label} href={item.href} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold uppercase tracking-widest text-white/50 hover:text-white transition-all duration-300">
                  {item.label}
                </a>
              ))}
            </nav>

            <Link
              href="/login"
              className="group relative flex items-center gap-2 px-6 py-2.5 rounded-lg border border-white/20 bg-white/5 hover:bg-white text-white hover:text-black font-semibold text-xs tracking-wider uppercase transition-all duration-500 overflow-hidden"
            >
              <span className="relative z-10 transition-colors duration-500">Access Portal</span>
              <ChevronRight className="relative z-10 h-4 w-4 transform group-hover:translate-x-1 transition-transform duration-300" />
            </Link>
          </motion.div>
        </div>
      </header>

      {/* ── Main Content ── */}
      <main className="relative z-10 pt-48 pb-0 px-6">
        <motion.div variants={staggerContainer} initial="hidden" animate="show" className="max-w-7xl mx-auto">

          {/* Hero */}
          <div className="flex flex-col lg:flex-row items-center gap-16 mb-40 max-w-6xl mx-auto">
            <div className="flex-1 text-left">
              <motion.div variants={fadeInUp} className="inline-flex items-center gap-3 px-4 py-2 rounded-full bg-white/[0.03] border border-white/[0.05] text-[10px] font-bold uppercase tracking-[0.2em] text-white/60 mb-8 backdrop-blur-md">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                MagicBlock Frontier Hackathon
                <span className="h-3 w-px bg-white/20 mx-1" />
                V2 Production Stack
              </motion.div>

              <motion.h1 variants={fadeInUp} className="text-5xl md:text-7xl lg:text-[84px] font-medium tracking-tighter mb-8 leading-[0.95]">
                <span className="text-white/90">Private Payroll.</span>
                <br />
                <span className="text-gradient italic font-light pr-4">
                  On Solana. Today.
                </span>
              </motion.h1>

              <motion.p variants={fadeInUp} className="text-lg text-white/60 max-w-lg mb-12 leading-relaxed font-light tracking-wide">
                While Token-2022 Confidential Transfers are under security audit, 
                Civitas delivers production-grade payroll privacy through a 5-layer 
                stack — powered by Nillion, MagicBlock, and Noir.
              </motion.p>

              <motion.div variants={fadeInUp} className="flex flex-col sm:flex-row items-center gap-6">
                <button
                  onClick={() => setShowWaitlist(true)}
                  className="group flex items-center justify-center gap-3 px-10 py-5 rounded-xl bg-white text-black font-semibold text-sm tracking-widest uppercase hover:bg-emerald-400 hover:scale-105 hover:shadow-[0_0_40px_rgba(16,185,129,0.4)] transition-all duration-500 w-full sm:w-auto"
                >
                  Join Early Access <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
                </button>

                <Link
                  href="/login"
                  className="flex items-center justify-center gap-3 px-8 py-5 rounded-xl border border-white/20 bg-black/20 backdrop-blur-md text-white font-semibold text-sm tracking-widest uppercase hover:bg-white/10 hover:border-white/40 transition-all duration-300 w-full sm:w-auto"
                >
                  Launch Portal
                </Link>
              </motion.div>
            </div>

            <motion.div 
              variants={fadeInUp}
              className="relative p-8 rounded-3xl border border-white/5 bg-white/[0.01] backdrop-blur-3xl shadow-2xl"
            >
              <div className="absolute -inset-1 rounded-[33px] bg-gradient-to-br from-violet-500/20 via-transparent to-emerald-500/20 opacity-50 blur-xl" />
              <div className="relative z-10 flex flex-col items-center">
                <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-white/30 mb-6">Deep Privacy Stack</p>
                <PrivacyStackVisualizer />
                <div className="mt-8 grid grid-cols-2 gap-4 w-full">
                  <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3 text-center">
                    <p className="text-xs font-bold text-white/70">100%</p>
                    <p className="text-[8px] uppercase tracking-widest text-white/30">Shielded</p>
                  </div>
                  <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3 text-center">
                    <p className="text-xs font-bold text-white/70">&lt; 1s</p>
                    <p className="text-[8px] uppercase tracking-widest text-white/30">Settlement</p>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>

          {/* ── The Proof (Loom Video Demo) ── */}
          <motion.div variants={fadeInUp} id="proof" className="max-w-5xl mx-auto mb-40 relative z-20 scroll-mt-32">
            <div className="absolute -inset-4 rounded-3xl bg-gradient-to-b from-emerald-500/10 via-transparent to-transparent opacity-50 blur-3xl" />

            <div className="mb-10 text-center">
              <p className="text-[10px] font-bold tracking-[0.3em] uppercase text-emerald-400 mb-3">The Proof is in the Execution</p>
              <h2 className="text-3xl md:text-4xl font-light tracking-tight text-white mb-4">Actual Builders. Working Product.</h2>
              <p className="text-white/50 text-sm max-w-2xl mx-auto font-light leading-relaxed">
                Watch Swarna execute a fully shielded zero-knowledge transaction on the testnet. We aren't just another whitepaper—we are shipping production infrastructure today.
              </p>
            </div>

            <div className="relative rounded-2xl border border-white/[0.08] bg-black/60 backdrop-blur-3xl overflow-hidden p-2 shadow-2xl">
              <div className="flex items-center gap-4 px-6 py-4 border-b border-white/[0.04] bg-white/[0.01]">
                <div className="flex gap-2">
                  <div className="w-3 h-3 rounded-full bg-red-500/80" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
                  <div className="w-3 h-3 rounded-full bg-emerald-500/80" />
                </div>
                <div className="flex-1 flex justify-center">
                  <div className="flex items-center gap-2 text-xs font-mono text-white/40 bg-black/50 px-4 py-1.5 rounded-lg border border-white/[0.05]">
                    <Lock className="h-3 w-3 text-emerald-400/50" />
                    <span>civitas-platform-demo.mp4</span>
                  </div>
                </div>
              </div>

              <div className="relative w-full aspect-video bg-[#050505] rounded-b-xl overflow-hidden group">
                <iframe
                  src="https://www.youtube.com/embed/YK5ZtIX1Fig?rel=0&modestbranding=1"
                  frameBorder="0"
                  allowFullScreen
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  className="absolute top-0 left-0 w-full h-full opacity-90 group-hover:opacity-100 transition-opacity duration-700"
                ></iframe>
              </div>
            </div>
          </motion.div>

          {/* ── Solutions / Role Cards ── */}
          <div id="solutions" className="scroll-mt-32 mb-32">
            <motion.div variants={fadeInUp} className="mb-16 text-center">
              <p className="text-[10px] font-bold tracking-[0.3em] uppercase text-white/30 mb-3">Dual-Party Architecture</p>
              <div className="h-px w-32 bg-gradient-to-r from-transparent via-white/15 to-transparent mx-auto" />
            </motion.div>

            <motion.div variants={staggerContainer} className="grid md:grid-cols-2 gap-6 max-w-5xl mx-auto">

              {/* Enterprise Node */}
              <motion.div variants={fadeInUp} className="relative" style={{ perspective: 1000 }}>
                <TiltCard
                  className="cursor-pointer"
                  onClick={() => setUserRole("employer")}
                >
                  {/* Ambient glow */}
                  <div className={`absolute -inset-px rounded-2xl bg-gradient-to-br from-emerald-500/20 via-transparent to-blue-500/20 transition-opacity duration-700 ${userRole === "employer" ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`} />

                  <div className={`relative rounded-2xl overflow-hidden transition-all duration-500 ${userRole === "employer" ? "bg-[#050a06] border border-emerald-500/30 shadow-[0_0_60px_rgba(16,185,129,0.12)]" : "bg-black/60 border border-white/[0.06] hover:border-white/[0.12] backdrop-blur-md"}`}>

                    {/* Scanning laser line on hover/active */}
                    {userRole === "employer" && (
                      <motion.div
                        className="absolute left-0 right-0 h-px bg-gradient-to-r from-transparent via-emerald-400/70 to-transparent pointer-events-none z-10"
                        initial={{ top: "-5%" }}
                        animate={{ top: ["−5%", "105%"] }}
                        transition={{ duration: 2.5, repeat: Infinity, repeatDelay: 2.5, ease: "linear" }}
                      />
                    )}

                    {/* Corner accents */}
                    <div className="absolute top-0 left-0 w-8 h-8 border-t border-l border-emerald-500/40 rounded-tl-2xl pointer-events-none" />
                    <div className="absolute top-0 right-0 w-8 h-8 border-t border-r border-emerald-500/40 rounded-tr-2xl pointer-events-none" />
                    <div className="absolute bottom-0 left-0 w-8 h-8 border-b border-l border-emerald-500/20 rounded-bl-2xl pointer-events-none" />
                    <div className="absolute bottom-0 right-0 w-8 h-8 border-b border-r border-emerald-500/20 rounded-br-2xl pointer-events-none" />

                    <div className="p-8 lg:p-10">
                      {/* Header row */}
                      <div className="flex justify-between items-start mb-10">
                        <div className="relative">
                          <div className={`h-14 w-14 rounded-xl flex items-center justify-center transition-all duration-500 ${userRole === "employer" ? "bg-emerald-500/15 border border-emerald-500/40 shadow-[0_0_20px_rgba(16,185,129,0.2)]" : "bg-white/5 border border-white/10"}`}>
                            <Briefcase className={`h-6 w-6 transition-colors duration-500 ${userRole === "employer" ? "text-emerald-400" : "text-white/40"}`} />
                          </div>
                          {userRole === "employer" && (
                            <motion.div
                              className="absolute -inset-1 rounded-xl border border-emerald-500/30"
                              animate={{ scale: [1, 1.08, 1], opacity: [0.4, 0, 0.4] }}
                              transition={{ duration: 2, repeat: Infinity }}
                            />
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-1.5">
                          <span className={`text-[9px] font-mono uppercase tracking-widest px-2 py-0.5 rounded border ${userRole === "employer" ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10" : "text-white/20 border-white/10"}`}>
                            NODE-01
                          </span>
                          {userRole === "employer" && (
                            <span className="flex items-center gap-1 text-[9px] font-mono text-emerald-400">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> ACTIVE
                            </span>
                          )}
                        </div>
                      </div>

                      <h3 className={`text-2xl font-light tracking-tight mb-3 transition-colors duration-500 ${userRole === "employer" ? "text-white" : "text-white/80"}`}>
                        Enterprise Node
                      </h3>
                      <p className={`text-sm leading-relaxed mb-8 font-light transition-colors duration-500 ${userRole === "employer" ? "text-white/60" : "text-white/40"}`}>
                        Manage global treasuries, register cryptographic employee tags, and initiate private payroll runs sealed inside Nillion nilCC TEE + MagicBlock Permissioned ER.
                      </p>

                      {/* Stats row */}
                      <div className="grid grid-cols-3 gap-3 mb-8">
                        {[["∞", "Treasury"], ["ZK", "Execution"], ["L1", "Settlement"]].map(([val, lbl]) => (
                          <div key={lbl} className={`rounded-lg p-3 text-center border transition-all duration-500 ${userRole === "employer" ? "bg-emerald-500/5 border-emerald-500/20" : "bg-white/[0.02] border-white/[0.05]"}`}>
                            <div className={`text-base font-bold mono mb-0.5 ${userRole === "employer" ? "text-emerald-400" : "text-white/40"}`}>{val}</div>
                            <div className="text-[9px] uppercase tracking-widest text-white/30">{lbl}</div>
                          </div>
                        ))}
                      </div>

                      <ul className="space-y-3 mb-8">
                        {["Treasury Custody & Escrow", "ZK Payroll Execution", "Merkle Set Commitments"].map(f => (
                          <li key={f} className="flex items-center gap-3 text-xs tracking-wider">
                            <CheckCircle2 className={`h-3.5 w-3.5 flex-shrink-0 transition-colors duration-500 ${userRole === "employer" ? "text-emerald-400" : "text-white/20"}`} />
                            <span className={`transition-colors duration-500 ${userRole === "employer" ? "text-white/70" : "text-white/35"}`}>{f}</span>
                          </li>
                        ))}
                      </ul>

                      <AnimatePresence>
                        {userRole === "employer" && (
                          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                            <Link href="/login" className="flex items-center justify-center gap-2 w-full py-3.5 rounded-xl border border-emerald-500/50 text-emerald-400 text-xs font-bold uppercase tracking-widest hover:bg-emerald-500 hover:text-black hover:border-emerald-500 transition-all duration-400">
                              Authenticate Node <ChevronRight className="h-4 w-4" />
                            </Link>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                </TiltCard>
              </motion.div>

              {/* Recipient Client */}
              <motion.div variants={fadeInUp} className="relative" style={{ perspective: 1000 }}>
                <TiltCard
                  className="cursor-pointer"
                  onClick={() => setUserRole("employee")}
                >
                  <div className={`absolute -inset-px rounded-2xl bg-gradient-to-br from-blue-500/20 via-transparent to-indigo-500/20 transition-opacity duration-700 ${userRole === "employee" ? "opacity-100" : "opacity-0"}`} />

                  <div className={`relative rounded-2xl overflow-hidden transition-all duration-500 ${userRole === "employee" ? "bg-[#03050a] border border-blue-500/30 shadow-[0_0_60px_rgba(59,130,246,0.12)]" : "bg-black/60 border border-white/[0.06] hover:border-white/[0.12] backdrop-blur-md"}`}>

                    {userRole === "employee" && (
                      <motion.div
                        className="absolute left-0 right-0 h-px bg-gradient-to-r from-transparent via-blue-400/70 to-transparent pointer-events-none z-10"
                        initial={{ top: "-5%" }}
                        animate={{ top: ["−5%", "105%"] }}
                        transition={{ duration: 2.5, repeat: Infinity, repeatDelay: 2.5, ease: "linear" }}
                      />
                    )}

                    <div className="absolute top-0 left-0 w-8 h-8 border-t border-l border-blue-500/40 rounded-tl-2xl pointer-events-none" />
                    <div className="absolute top-0 right-0 w-8 h-8 border-t border-r border-blue-500/40 rounded-tr-2xl pointer-events-none" />
                    <div className="absolute bottom-0 left-0 w-8 h-8 border-b border-l border-blue-500/20 rounded-bl-2xl pointer-events-none" />
                    <div className="absolute bottom-0 right-0 w-8 h-8 border-b border-r border-blue-500/20 rounded-br-2xl pointer-events-none" />

                    <div className="p-8 lg:p-10">
                      <div className="flex justify-between items-start mb-10">
                        <div className="relative">
                          <div className={`h-14 w-14 rounded-xl flex items-center justify-center transition-all duration-500 ${userRole === "employee" ? "bg-blue-500/15 border border-blue-500/40 shadow-[0_0_20px_rgba(59,130,246,0.2)]" : "bg-white/5 border border-white/10"}`}>
                            <UserCircle className={`h-6 w-6 transition-colors duration-500 ${userRole === "employee" ? "text-blue-400" : "text-white/40"}`} />
                          </div>
                          {userRole === "employee" && (
                            <motion.div
                              className="absolute -inset-1 rounded-xl border border-blue-500/30"
                              animate={{ scale: [1, 1.08, 1], opacity: [0.4, 0, 0.4] }}
                              transition={{ duration: 2, repeat: Infinity }}
                            />
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-1.5">
                          <span className={`text-[9px] font-mono uppercase tracking-widest px-2 py-0.5 rounded border ${userRole === "employee" ? "text-blue-400 border-blue-500/30 bg-blue-500/10" : "text-white/20 border-white/10"}`}>
                            NODE-02
                          </span>
                          {userRole === "employee" && (
                            <span className="flex items-center gap-1 text-[9px] font-mono text-blue-400">
                              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" /> ACTIVE
                            </span>
                          )}
                        </div>
                      </div>

                      <h3 className={`text-2xl font-light tracking-tight mb-3 transition-colors duration-500 ${userRole === "employee" ? "text-white" : "text-white/80"}`}>
                        Recipient Client
                      </h3>
                      <p className={`text-sm leading-relaxed mb-8 font-light transition-colors duration-500 ${userRole === "employee" ? "text-white/60" : "text-white/40"}`}>
                        Generate client-side cryptographic credentials, retrieve encrypted salary packets, and execute sovereign withdrawals on Layer 2.
                      </p>

                      <div className="grid grid-cols-3 gap-3 mb-8">
                        {[["SK", "Private Key"], ["ZK", "Proof"], ["L2", "Withdrawal"]].map(([val, lbl]) => (
                          <div key={lbl} className={`rounded-lg p-3 text-center border transition-all duration-500 ${userRole === "employee" ? "bg-blue-500/5 border-blue-500/20" : "bg-white/[0.02] border-white/[0.05]"}`}>
                            <div className={`text-base font-bold mono mb-0.5 ${userRole === "employee" ? "text-blue-400" : "text-white/40"}`}>{val}</div>
                            <div className="text-[9px] uppercase tracking-widest text-white/30">{lbl}</div>
                          </div>
                        ))}
                      </div>

                      <ul className="space-y-3 mb-8">
                        {["Local Key Generation", "Shielded Routing", "Anonymous Settlement"].map(f => (
                          <li key={f} className="flex items-center gap-3 text-xs tracking-wider">
                            <CheckCircle2 className={`h-3.5 w-3.5 flex-shrink-0 transition-colors duration-500 ${userRole === "employee" ? "text-blue-400" : "text-white/20"}`} />
                            <span className={`transition-colors duration-500 ${userRole === "employee" ? "text-white/70" : "text-white/35"}`}>{f}</span>
                          </li>
                        ))}
                      </ul>

                      <AnimatePresence>
                        {userRole === "employee" && (
                          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="flex flex-col gap-3">
                            <Link href="/login" className="flex items-center justify-center gap-2 w-full py-3.5 rounded-xl border border-blue-500/50 text-blue-400 text-xs font-bold uppercase tracking-widest hover:bg-blue-500 hover:text-black hover:border-blue-500 transition-all duration-400">
                              Access Dashboard <ChevronRight className="h-4 w-4" />
                            </Link>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                </TiltCard>
              </motion.div>
            </motion.div>
          </div>

          {/* Identity Setup */}
          <AnimatePresence>
            {userRole === "employee" && (
              <motion.div
                id="cred-setup"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="max-w-4xl mx-auto mb-32 scroll-mt-32"
              >
                <div className="rounded-2xl border border-white/10 bg-black/60 backdrop-blur-2xl p-8 lg:p-12 shadow-2xl">
                  <div className="flex flex-col md:flex-row gap-12 items-center">
                    <div className="flex-1 space-y-6">
                      <div className="inline-flex items-center gap-3 px-3 py-1.5 rounded-md bg-white/5 border border-white/10 text-[10px] font-bold uppercase tracking-widest text-emerald-400">
                        <Shield className="h-3 w-3" /> Zero-Knowledge Keypair
                      </div>
                      <h3 className="text-3xl font-light text-white tracking-tight">Cryptographic Root</h3>
                      <p className="text-sm font-light text-white/40 leading-relaxed">
                        To receive funds privately, you must establish an identity root. The protocol generates a hardware-entropy backed <span className="text-white/80">Secret Nonce</span> locally. From this, a <span className="text-white/80">Poseidon Hash</span> acts as your public tag.
                      </p>
                      {!credential && (
                        <button
                          onClick={handleGenerateCredential}
                          className="inline-flex items-center justify-center gap-3 px-6 py-3 rounded-lg border border-white text-white hover:bg-white hover:text-black font-semibold text-xs tracking-wider uppercase transition-all duration-300 mt-4"
                        >
                          Synthesize Keypair
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Underlying Technologies ── */}
          <motion.div variants={fadeInUp} className="max-w-7xl mx-auto pt-24 border-t border-white/[0.05]" id="architecture">
            <p className="text-center text-[10px] font-bold uppercase tracking-[0.3em] text-white/30 mb-16">Underlying Technologies</p>
            <div className="grid md:grid-cols-4 gap-6">
              {[
                {
                  icon: <Database className="h-5 w-5" />,
                  accent: "violet",
                  label: "Data Privacy",
                  title: "Nillion nilDB + nilCC",
                  desc: "Salary data stored as %allot secret shares across Nillion nodes. Payroll computation runs inside a Trusted Execution Environment — amounts never leave the enclave.",
                },
                {
                  icon: <Cpu className="h-5 w-5" />,
                  accent: "blue",
                  label: "ZK Proving",
                  title: "Noir UltraHonk",
                  desc: "Barretenberg-powered UltraHonk proofs generated client-side. Employees claim salary anonymously — no identity revealed on-chain. Nullifier prevents double-spend.",
                },
                {
                  icon: <Zap className="h-5 w-5" />,
                  accent: "amber",
                  label: "Payment Privacy",
                  title: "MagicBlock Private Pay",
                  desc: "Payment amounts sealed inside MagicBlock Permissioned Ephemeral Rollup sessions. On-chain observers see a transfer happened — never the amount. Works today on devnet.",
                },
                {
                  icon: <Lock className="h-5 w-5" />,
                  accent: "emerald",
                  label: "Settlement Privacy",
                  title: "Cloak Shielded Pool",
                  desc: "Received payments shielded in Cloak's Groth16 UTXO pool. Transaction graph is unlinkable. Auditors access compliance data via selective viewing keys.",
                },
              ].map((card) => {
                const colors: Record<string, { border: string; iconBg: string; iconText: string; labelText: string; glow: string }> = {
                  emerald: { border: "hover:border-emerald-500/30", iconBg: "bg-emerald-500/10", iconText: "text-emerald-400", labelText: "text-emerald-400/70", glow: "group-hover:shadow-[0_0_30px_rgba(16,185,129,0.08)]" },
                  blue: { border: "hover:border-blue-500/30", iconBg: "bg-blue-500/10", iconText: "text-blue-400", labelText: "text-blue-400/70", glow: "group-hover:shadow-[0_0_30px_rgba(59,130,246,0.08)]" },
                  violet: { border: "hover:border-violet-500/30", iconBg: "bg-violet-500/10", iconText: "text-violet-400", labelText: "text-violet-400/70", glow: "group-hover:shadow-[0_0_30px_rgba(139,92,246,0.08)]" },
                  amber: { border: "hover:border-amber-500/30", iconBg: "bg-amber-500/10", iconText: "text-amber-400", labelText: "text-amber-400/70", glow: "group-hover:shadow-[0_0_30px_rgba(245,158,11,0.08)]" },
                }
                const c = colors[card.accent]
                return (
                  <div key={card.title} className={`group relative p-8 rounded-2xl bg-[#0a0a0a] border border-white/[0.08] ${c.border} ${c.glow} transition-all duration-500`}>
                    {/* Top label */}
                    <p className={`text-[9px] font-bold uppercase tracking-[0.25em] mb-6 ${c.labelText}`}>{card.label}</p>
                    {/* Icon */}
                    <div className={`h-12 w-12 rounded-xl ${c.iconBg} border border-white/10 flex items-center justify-center mb-6 ${c.iconText} transition-all duration-300`}>
                      {card.icon}
                    </div>
                    <h4 className="font-semibold text-lg mb-3 text-white tracking-tight">{card.title}</h4>
                    <p className="text-sm text-white/50 leading-relaxed font-light">{card.desc}</p>
                    {/* Bottom rule */}
                    <div className={`absolute bottom-0 left-8 right-8 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent`} />
                  </div>
                )
              })}
            </div>
          </motion.div>

        </motion.div>
      </main>

      {/* ══════════════════════════════════════════════════════════════
           MEGA FOOTER
      ══════════════════════════════════════════════════════════════ */}
      <footer className="relative z-10 mt-32 bg-[#030303] border-t border-white/[0.05] overflow-hidden">

        {/* Top section: Logo + Subscribe */}
        <div className="max-w-7xl mx-auto px-6 pt-20 pb-16 grid md:grid-cols-2 gap-16 border-b border-white/[0.04]">
          {/* Brand */}
          <div>
            <div className="flex items-center gap-3 mb-6">
              <img
                src="/logo-light.svg"
                alt="Civitas"
                className="h-6 w-auto opacity-90"
              />
            </div>
            <p className="text-sm text-white/40 font-light leading-relaxed max-w-xs">
              Institutional-grade private payroll infrastructure built on Solana &amp; Nillion. Compliant. Confidential. On-chain.
            </p>
            {/* Social icons */}
            <div className="flex items-center gap-4 mt-8">
              {[
                { icon: <Github className="h-4 w-4" />, href: "https://github.com/MeetCivitas/Civitas-Sol" },
                { icon: <Twitter className="h-4 w-4" />, href: "https://x.com/meet_civitas" },
              ].map((s, i) => (
                <a key={i} href={s.href} target="_blank" rel="noreferrer"
                  className="w-9 h-9 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 hover:border-white/20 transition-all duration-300">
                  {s.icon}
                </a>
              ))}
            </div>
          </div>

          {/* Subscribe */}
          <div className="flex flex-col justify-center">
            <p className="text-[10px] font-bold tracking-[0.25em] uppercase text-white/30 mb-3">Stay Updated</p>
            <h3 className="text-2xl font-light text-white mb-2 tracking-tight">Subscribe for the latest updates.</h3>
            <p className="text-sm text-white/30 font-light mb-6">Protocol releases, security advisories, and feature announcements.</p>
            {subscribed ? (
              <div className="flex items-center gap-3 px-5 py-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm font-medium">
                <CheckCircle2 className="h-4 w-4" /> Subscribed ! See you there
              </div>
            ) : (
              <form onSubmit={handleSubscribe} className="flex gap-3">
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="Your email address"
                  required
                  className="flex-1 px-4 py-3 rounded-xl bg-white/[0.04] border border-white/10 text-white placeholder:text-white/25 text-sm focus:outline-none focus:border-white/25 focus:bg-white/[0.06] transition-all"
                />
                <button type="submit" disabled={isSubscribing} className="px-5 py-3 rounded-xl bg-white text-black text-sm font-bold tracking-wider hover:bg-emerald-400 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed">
                  {isSubscribing ? "Subscribing..." : "Subscribe"}
                </button>
              </form>
            )}
          </div>
        </div>

        {/* Middle section: Nav columns */}
        <div className="max-w-7xl mx-auto px-6 py-16 grid grid-cols-2 md:grid-cols-4 gap-12 border-b border-white/[0.04]">
          {[
            {
              heading: "Solutions",
              links: [
                { label: "Employer Portal", href: "/login" },
                { label: "Employee Portal", href: "/login" },
                { label: "Treasury Mgmt", href: "#" },
                { label: "ZK Payroll", href: "#" },
              ]
            },
            {
              heading: "Ecosystem",
              links: [
                { label: "Solana", href: "https://solana.com", ext: true },
                { label: "Nillion Network", href: "https://nillion.com", ext: true },
                { label: "MagicBlock", href: "https://magicblock.gg", ext: true },
                { label: "Cloak", href: "https://cloak.dev", ext: true },
                { label: "Noir Lang", href: "https://noir-lang.org", ext: true },
              ]
            },
            {
              heading: "Developers",
              links: [
                { label: "GitHub", href: "https://github.com/MeetCivitas/Civitas-Sol", ext: true },
                { label: "Docs", href: "#" },
                { label: "Smart Contracts", href: "#" },
                { label: "SDK", href: "#" },
              ]
            },
            {
              heading: "Legal",
              links: [
                { label: "Privacy Policy", href: "#" },
                { label: "Terms of Service", href: "#" },
                { label: "Bug Bounty", href: "#" },
                { label: "Audit Reports", href: "#" },
              ]
            },
          ].map(col => (
            <div key={col.heading}>
              <p className="text-[9px] font-bold tracking-[0.3em] uppercase text-white/30 mb-6">{col.heading}</p>
              <ul className="space-y-4">
                {col.links.map(link => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      target={(link as any).ext ? "_blank" : undefined}
                      rel={(link as any).ext ? "noreferrer" : undefined}
                      className="flex items-center gap-1.5 text-sm text-white/50 hover:text-white transition-colors duration-200 group"
                    >
                      {link.label}
                      {(link as any).ext && <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-50 transition-opacity" />}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="max-w-7xl mx-auto px-6 py-6 flex flex-col md:flex-row items-center justify-between gap-4 border-b border-white/[0.04]">
          <p className="text-[10px] font-mono text-white/20 tracking-widest">© 2026 CIVITAS PROTOCOL · ALL RIGHTS RESERVED</p>
          <div className="flex items-center gap-3">
            {["Solana Devnet", "Nillion Testnet", "Noir ZK"].map(tag => (
              <span key={tag} className="text-[9px] font-mono px-2 py-1 rounded border border-white/[0.06] text-white/20 tracking-widest">{tag}</span>
            ))}
          </div>
        </div>

        {/* ── Massive trademark typography ── */}
        <div className="relative overflow-hidden select-none h-[180px] md:h-[260px] flex items-center justify-center">
          {/* Soft ambient glow behind the text */}
          <div className="absolute inset-0 flex items-center justify-center opacity-40 blur-[100px] pointer-events-none">
            <div className="w-[80%] h-1/2 bg-white/20 rounded-full" />
          </div>

          <motion.p
            initial={{ opacity: 0, y: 30, scale: 0.96 }}
            whileInView={{ opacity: 1, y: 0, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 1.5, ease: [0.16, 1, 0.3, 1] }}
            className="text-[22vw] font-black tracking-tighter leading-none text-transparent bg-clip-text bg-gradient-to-b from-white via-white/80 to-white/10 drop-shadow-[0_10px_30px_rgba(255,255,255,0.1)] relative z-10"
            style={{
              fontFamily: "sans-serif",
            }}
          >
            CIVITAS
          </motion.p>

          {/* Subtle gradient overlay at top to blend perfectly into the section above */}
          <div className="absolute inset-0 bg-gradient-to-b from-[#030303] via-transparent to-transparent pointer-events-none z-20" />
        </div>
      </footer>

      {/* ── Waitlist Modal ── */}
      <AnimatePresence>
        {showWaitlist && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-2xl"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-lg bg-[#050505] border border-white/10 rounded-3xl p-8 shadow-[0_0_100px_rgba(16,185,129,0.1)] overflow-hidden"
            >
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-emerald-500 to-transparent opacity-50" />

              <button
                onClick={() => setShowWaitlist(false)}
                className="absolute top-6 right-6 p-2 rounded-full bg-white/5 hover:bg-white/10 text-white/50 hover:text-white transition-colors"
              >
                <X className="h-5 w-5" />
              </button>

              {waitlistStatus === "success" ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mb-6">
                    <CheckCircle2 className="h-8 w-8 text-emerald-400" />
                  </div>
                  <h3 className="text-2xl font-light text-white mb-2 tracking-tight">Access Requested.</h3>
                  <p className="text-white/50 text-sm max-w-xs font-light">
                    You're officially on the waitlist. We'll be in touch soon with your exclusive early access code.
                  </p>
                </div>
              ) : (
                <>
                  <div className="mb-8">
                    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-[10px] font-bold uppercase tracking-widest text-emerald-400 mb-6">
                      <Zap className="h-3 w-3" /> Priority Queue
                    </div>
                    <h3 className="text-3xl font-light text-white tracking-tight mb-2">Join Early Access.</h3>
                    <p className="text-sm text-white/50 font-light pr-8">
                      Secure your spot to experience the first institutional-grade zero-knowledge payroll infrastructure.
                    </p>
                  </div>

                  <form onSubmit={handleJoinWaitlist} className="space-y-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] uppercase tracking-widest text-white/40 font-semibold pl-1">Work Email *</label>
                      <div className="relative group">
                        <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-white/20 group-focus-within:text-emerald-400 transition-colors duration-300" />
                        <input
                          type="email"
                          required
                          value={waitlistForm.email}
                          onChange={e => setWaitlistForm({ ...waitlistForm, email: e.target.value })}
                          className="w-full bg-white/[0.03] border border-white/[0.08] focus:border-emerald-500/50 rounded-xl px-12 py-3.5 text-white placeholder:text-white/20 text-sm outline-none transition-all duration-300"
                          placeholder="satoshi@nakamoto.com"
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[10px] uppercase tracking-widest text-white/40 font-semibold pl-1">Company / DAO Name</label>
                      <div className="relative group">
                        <Building2 className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-white/20 group-focus-within:text-emerald-400 transition-colors duration-300" />
                        <input
                          type="text"
                          required
                          value={waitlistForm.company}
                          onChange={e => setWaitlistForm({ ...waitlistForm, company: e.target.value })}
                          className="w-full bg-white/[0.03] border border-white/[0.08] focus:border-emerald-500/50 rounded-xl px-12 py-3.5 text-white placeholder:text-white/20 text-sm outline-none transition-all duration-300"
                          placeholder="XYZ Foundation"
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[10px] uppercase tracking-widest text-white/40 font-semibold pl-1">Twitter Handle (Optional)</label>
                      <div className="relative group">
                        <Twitter className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-white/20 group-focus-within:text-emerald-400 transition-colors duration-300" />
                        <input
                          type="text"
                          value={waitlistForm.twitter}
                          onChange={e => setWaitlistForm({ ...waitlistForm, twitter: e.target.value.startsWith('@') ? e.target.value : `@${e.target.value}` })}
                          className="w-full bg-white/[0.03] border border-white/[0.08] focus:border-emerald-500/50 rounded-xl px-12 py-3.5 text-white placeholder:text-white/20 text-sm outline-none transition-all duration-300"
                          placeholder="@satoshinakamoto"
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={waitlistStatus === "submitting"}
                      className="w-full relative group overflow-hidden rounded-xl bg-white text-black font-semibold text-sm tracking-widest uppercase hover:bg-emerald-400 transition-all duration-500 mt-6"
                    >
                      <div className="absolute inset-0 bg-gradient-to-r from-emerald-400 to-blue-400 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                      <div className="relative flex items-center justify-center gap-2 px-8 py-4">
                        {waitlistStatus === "submitting" ? (
                          <div className="flex items-center gap-2">
                            <span className="w-4 h-4 rounded-full border-2 border-black/20 border-t-black animate-spin" />
                            <span>Processing...</span>
                          </div>
                        ) : (
                          <>
                            Submit Application
                            <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
                          </>
                        )}
                      </div>
                    </button>
                    {waitlistStatus === "error" && (
                      <p className="text-red-400 text-xs text-center mt-2">Submission failed. Please try again.</p>
                    )}
                  </form>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
