"use client"

import { useCallback, useRef, useState } from "react"
import { useCivitas } from "@/lib/civitas-provider"
import Link from "next/link"
import { motion, AnimatePresence, useMotionValue, useSpring, useTransform } from "framer-motion"
import {
  Shield, Lock, Zap, ArrowRight, CheckCircle2, Briefcase, UserCircle,
  ChevronRight, Github, Twitter, ExternalLink, Database, Cpu,
  X, Mail, Building2,
} from "lucide-react"
import { PrivacyStackVisualizer } from "@/components/ui/privacy-stack"

/* ───────────────────────────────────────────────────────────────────
   Tilt Card — subtle 3D parallax on hover (uiverse-inspired, mono)
   ─────────────────────────────────────────────────────────────────── */
function TiltCard({
  children,
  className = "",
  onClick,
}: {
  children: React.ReactNode
  className?: string
  onClick?: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const sx = useSpring(x, { stiffness: 180, damping: 22 })
  const sy = useSpring(y, { stiffness: 180, damping: 22 })
  const rotateX = useTransform(sy, [-0.5, 0.5], [4, -4])
  const rotateY = useTransform(sx, [-0.5, 0.5], [-4, 4])

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!ref.current) return
    const r = ref.current.getBoundingClientRect()
    x.set((e.clientX - r.left) / r.width - 0.5)
    y.set((e.clientY - r.top) / r.height - 0.5)
  }
  const onLeave = () => { x.set(0); y.set(0) }

  return (
    <motion.div
      ref={ref}
      style={{ rotateX, rotateY, transformStyle: "preserve-3d" }}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      onClick={onClick}
      className={className}
    >
      {children}
    </motion.div>
  )
}

/* ───────────────────────────────────────────────────────────────────
   Magnetic CTA — pointer-tracked highlight, uiverse-inspired
   ─────────────────────────────────────────────────────────────────── */
function MagneticPrimary({
  children,
  onClick,
  href,
  className = "",
  type = "button",
}: {
  children: React.ReactNode
  onClick?: () => void
  href?: string
  className?: string
  type?: "button" | "submit"
}) {
  const ref = useRef<HTMLButtonElement | HTMLAnchorElement | null>(null)
  const onMove = (e: React.MouseEvent) => {
    const el = ref.current as HTMLElement | null
    if (!el) return
    const r = el.getBoundingClientRect()
    el.style.setProperty("--mx", `${e.clientX - r.left}px`)
    el.style.setProperty("--my", `${e.clientY - r.top}px`)
  }
  const cls =
    "btn-magnetic group relative inline-flex items-center justify-center gap-2.5 px-7 py-3.5 rounded-full bg-white text-black text-[12px] font-semibold tracking-[0.18em] uppercase shadow-[0_8px_30px_rgba(255,255,255,0.18)] hover:shadow-[0_12px_40px_rgba(255,255,255,0.28)] transition-shadow duration-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-black " +
    className

  if (href) {
    return (
      <Link
        href={href}
        ref={ref as React.Ref<HTMLAnchorElement>}
        onMouseMove={onMove}
        className={cls}
      >
        {children}
      </Link>
    )
  }
  return (
    <button
      ref={ref as React.Ref<HTMLButtonElement>}
      type={type}
      onMouseMove={onMove}
      onClick={onClick}
      className={cls}
    >
      {children}
    </button>
  )
}

/* ─────────────────────────────────────────────────────────────────── */

export default function HomePage() {
  const { userRole, setUserRole } = useCivitas()

  const [email, setEmail] = useState("")
  const [subscribed, setSubscribed] = useState(false)
  const [isSubscribing, setIsSubscribing] = useState(false)
  const [subscribeError, setSubscribeError] = useState("")

  const [showWaitlist, setShowWaitlist] = useState(false)
  const [waitlistForm, setWaitlistForm] = useState({ email: "", company: "", twitter: "" })
  const [waitlistStatus, setWaitlistStatus] = useState<"idle" | "submitting" | "success" | "error">("idle")
  const [waitlistError, setWaitlistError] = useState("")

  const handleSubscribe = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) return
    setIsSubscribing(true)
    setSubscribeError("")
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, company: "Newsletter Subscriber", twitter: "" }),
      })
      const json = await res.json().catch(() => ({}))
      if (res.ok && json?.success) {
        setSubscribed(true)
        setEmail("")
      } else {
        setSubscribeError(json?.error || "Subscription failed. Please try again.")
      }
    } catch (err) {
      console.error("Failed to subscribe:", err)
      setSubscribeError("Network error. Please try again.")
    } finally {
      setIsSubscribing(false)
    }
  }, [email])

  const handleJoinWaitlist = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    setWaitlistStatus("submitting")
    setWaitlistError("")
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(waitlistForm),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || "Failed to submit")
      }
      setWaitlistStatus("success")
      setTimeout(() => {
        setShowWaitlist(false)
        setWaitlistStatus("idle")
        setWaitlistForm({ email: "", company: "", twitter: "" })
      }, 2500)
    } catch (err: any) {
      setWaitlistError(err?.message || "Submission failed. Please try again.")
      setWaitlistStatus("error")
      setTimeout(() => setWaitlistStatus("idle"), 4000)
    }
  }, [waitlistForm])

  const stagger: any = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.08 } } }
  const fadeUp: any = {
    hidden: { opacity: 0, y: 24 },
    show: { opacity: 1, y: 0, transition: { duration: 0.8, ease: [0.16, 1, 0.3, 1] } },
  }

  return (
    <div className="min-h-screen bg-black text-white relative overflow-x-clip font-sans antialiased">

      {/* ── Ambient background: animated chains video + monochrome veils ── */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <video
          autoPlay
          loop
          muted
          playsInline
          aria-hidden
          className="absolute inset-0 h-full w-full object-cover opacity-[0.55] [filter:grayscale(100%)_contrast(1.15)_brightness(0.85)]"
        >
          <source src="/videos/Animated_Privacy_Video_Element.mp4" type="video/mp4" />
        </video>
        {/* Vignettes — pure black, no chroma */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_transparent_30%,_rgba(0,0,0,0.55)_70%,_#000_100%)]" />
        {/* Hairline grid */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:64px_64px] [mask-image:radial-gradient(ellipse_at_center,black_40%,transparent_75%)]" />
        {/* Top + bottom black gradient to anchor type */}
        <div className="absolute inset-0 bg-gradient-to-b from-black via-black/30 to-black" />
      </div>

      {/* ── Navbar ── */}
      <header className="fixed top-0 w-full z-50">
        <div className="absolute inset-0 bg-black/60 backdrop-blur-xl border-b border-white/[0.06]" />
        <div className="max-w-7xl mx-auto px-6 py-4 relative">
          <motion.div
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="flex items-center justify-between"
          >
            <Link href="/" className="flex items-center gap-3 group" aria-label="Civitas home">
              <img
                src="/logo-light.svg"
                alt="Civitas"
                className="h-5 md:h-6 w-auto opacity-90 group-hover:opacity-100 transition-opacity duration-300"
              />
            </Link>

            <nav className="hidden md:flex items-center gap-9" aria-label="Primary">
              {[
                { label: "Architecture", href: "https://github.com/MeetCivitas/Civitas-Sol/blob/main/WHITEPAPER.pdf" },
                { label: "Solutions",    href: "https://x.com/RythmeNagr64107/status/2034605883200806945?s=20" },
                { label: "Developers",   href: "https://github.com/MeetCivitas/Civitas-Sol" },
              ].map(item => (
                <a
                  key={item.label}
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/55 hover:text-white transition-colors duration-300"
                >
                  {item.label}
                </a>
              ))}
            </nav>

            <Link
              href="/login"
              className="group relative inline-flex items-center gap-2 pl-5 pr-4 py-2.5 rounded-full border border-white/15 bg-white/[0.04] hover:bg-white hover:text-black text-white text-[11px] font-semibold tracking-[0.18em] uppercase transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            >
              <span>Access Portal</span>
              <ChevronRight className="h-4 w-4 transform group-hover:translate-x-0.5 transition-transform duration-200" />
            </Link>
          </motion.div>
        </div>
      </header>

      {/* ── Main ── */}
      <main className="relative z-10 pt-44 pb-24 px-6">
        <motion.div variants={stagger} initial="hidden" animate="show" className="max-w-7xl mx-auto">

          {/* ─ Hero ─────────────────────────────────────────── */}
          <section className="flex flex-col lg:flex-row items-center gap-16 mb-32 max-w-6xl mx-auto">
            <div className="flex-1 text-left">
              <motion.div
                variants={fadeUp}
                className="inline-flex items-center gap-3 px-3.5 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.08] text-[10px] font-semibold uppercase tracking-[0.2em] text-white/65 mb-8 backdrop-blur-md"
              >
                <span className="relative flex h-2 w-2" aria-hidden>
                  <span className="absolute inline-flex h-full w-full rounded-full bg-[var(--clr-pulse)] opacity-70 animate-ping" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--clr-pulse)]" />
                </span>
                Built on Solana
              </motion.div>

              <motion.h1
                variants={fadeUp}
                className="text-5xl md:text-7xl lg:text-[88px] font-medium tracking-[-0.04em] leading-[0.95] mb-7 text-mono-fade"
              >
                Private Payroll.
                <br />
                <span className="italic font-light text-white/85">On Solana. Today.</span>
              </motion.h1>

              <motion.p
                variants={fadeUp}
                className="text-[17px] text-white/55 max-w-xl mb-10 leading-[1.6] font-light"
              >
                Civitas delivers production-grade payroll privacy on Solana through a 4-layer
                stack: Nillion nilDB + nilCC, circom Groth16 ZK proofs verified by Solana&rsquo;s
                native alt-bn128 syscalls, and MagicBlock Private Payments. Settling natively on
                Solana L1.
              </motion.p>

              <motion.div variants={fadeUp} className="flex flex-col sm:flex-row items-center gap-4">
                <MagneticPrimary onClick={() => setShowWaitlist(true)}>
                  Join Early Access
                  <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                </MagneticPrimary>
                <Link
                  href="/login"
                  className="inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-full border border-white/15 bg-white/[0.03] backdrop-blur-md text-white/85 text-[12px] font-semibold tracking-[0.18em] uppercase hover:bg-white/[0.07] hover:border-white/25 transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
                >
                  Launch Portal
                </Link>
              </motion.div>
            </div>

            {/* Hero side panel — privacy stack */}
            <motion.div
              variants={fadeUp}
              className="relative w-full max-w-md p-8 rounded-3xl border border-white/[0.08] bg-white/[0.02] backdrop-blur-3xl overflow-hidden"
            >
              {/* hairline frame accents */}
              <div className="absolute top-0 left-6 right-6 h-px hairline" />
              <div className="absolute bottom-0 left-6 right-6 h-px hairline" />

              <div className="relative z-10 flex flex-col items-center">
                <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-white/35 mb-6">
                  Privacy Stack
                </p>
                <PrivacyStackVisualizer />
                <div className="mt-8 grid grid-cols-2 gap-3 w-full">
                  <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-center">
                    <p className="num text-base font-semibold text-white">100%</p>
                    <p className="text-[8px] uppercase tracking-[0.22em] text-white/35 mt-0.5">Shielded</p>
                  </div>
                  <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-center">
                    <p className="num text-base font-semibold text-white">&lt; 1s</p>
                    <p className="text-[8px] uppercase tracking-[0.22em] text-white/35 mt-0.5">Settlement</p>
                  </div>
                </div>
              </div>
            </motion.div>
          </section>

          {/* ─ Demo video (Rythme) ─────────────────────────── */}
          <motion.section variants={fadeUp} id="proof" className="max-w-5xl mx-auto mb-32 relative scroll-mt-32">
            <div className="mb-10 text-center">
              <p className="text-[10px] font-semibold tracking-[0.3em] uppercase text-white/45 mb-3">
                The Proof Is in the Execution
              </p>
              <h2 className="text-3xl md:text-5xl font-light tracking-[-0.03em] text-mono-fade mb-3">
                Actual builders. Working product.
              </h2>
              <p className="text-white/55 text-[15px] max-w-2xl mx-auto leading-relaxed">
                Watch <span className="text-white">Rythme</span> execute a fully shielded zero-knowledge
                payroll on Solana devnet. Not a whitepaper. Production infrastructure today.
              </p>
            </div>

            <div className="relative rounded-2xl border border-white/[0.08] bg-black/60 backdrop-blur-3xl overflow-hidden p-1.5 shadow-[0_30px_120px_-30px_rgba(255,255,255,0.08)]">
              <div className="flex items-center gap-4 px-5 py-3 border-b border-white/[0.06] bg-white/[0.02]">
                <div className="flex gap-1.5" aria-hidden>
                  <div className="w-2.5 h-2.5 rounded-full bg-white/20" />
                  <div className="w-2.5 h-2.5 rounded-full bg-white/15" />
                  <div className="w-2.5 h-2.5 rounded-full bg-white/10" />
                </div>
                <div className="flex-1 flex justify-center">
                  <div className="flex items-center gap-2 text-[11px] font-mono text-white/45 bg-black/40 px-3 py-1 rounded-md border border-white/[0.06]">
                    <Lock className="h-3 w-3 text-white/55" />
                    <span>civitas-platform-demo.mp4</span>
                  </div>
                </div>
                <div className="w-12" aria-hidden />
              </div>

              <div className="relative w-full aspect-video bg-black rounded-b-xl overflow-hidden">
                <iframe
                  src="https://www.youtube-nocookie.com/embed/csFhpaPIVsw?rel=0&modestbranding=1"
                  frameBorder="0"
                  allowFullScreen
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  className="absolute top-0 left-0 w-full h-full"
                  title="Civitas demo by Rythme"
                />
              </div>
            </div>
          </motion.section>

          {/* ─ Role cards ─────────────────────────────────── */}
          <section id="solutions" className="scroll-mt-32 mb-32">
            <motion.div variants={fadeUp} className="mb-12 text-center">
              <p className="text-[10px] font-semibold tracking-[0.3em] uppercase text-white/35 mb-3">Dual-Party Architecture</p>
              <div className="h-px w-32 hairline mx-auto" />
            </motion.div>

            <motion.div variants={stagger} className="grid md:grid-cols-2 gap-5 max-w-5xl mx-auto">
              {/* Enterprise */}
              <motion.div variants={fadeUp} className="relative" style={{ perspective: 1000 }}>
                <TiltCard className="cursor-pointer" onClick={() => setUserRole("employer")}>
                  <div
                    className={`relative rounded-2xl overflow-hidden transition-colors duration-400 ${
                      userRole === "employer"
                        ? "bg-white/[0.04] border border-white/30"
                        : "bg-black/50 border border-white/[0.08] hover:border-white/[0.18] backdrop-blur-md"
                    }`}
                  >
                    {/* corner brackets — pure white */}
                    <div className="absolute top-0 left-0 w-8 h-8 border-t border-l border-white/30 rounded-tl-2xl pointer-events-none" />
                    <div className="absolute top-0 right-0 w-8 h-8 border-t border-r border-white/30 rounded-tr-2xl pointer-events-none" />
                    <div className="absolute bottom-0 left-0 w-8 h-8 border-b border-l border-white/15 rounded-bl-2xl pointer-events-none" />
                    <div className="absolute bottom-0 right-0 w-8 h-8 border-b border-r border-white/15 rounded-br-2xl pointer-events-none" />

                    <div className="p-8 lg:p-10">
                      <div className="flex justify-between items-start mb-9">
                        <div className={`h-12 w-12 rounded-xl flex items-center justify-center transition-colors duration-300 ${userRole === "employer" ? "bg-white text-black" : "bg-white/[0.05] border border-white/10 text-white/70"}`}>
                          <Briefcase className="h-5 w-5" />
                        </div>
                        <div className="flex flex-col items-end gap-1.5">
                          <span className={`text-[9px] font-mono uppercase tracking-[0.22em] px-2 py-0.5 rounded-md border ${userRole === "employer" ? "text-white border-white/30 bg-white/[0.05]" : "text-white/30 border-white/10"}`}>
                            NODE-01
                          </span>
                          {userRole === "employer" && (
                            <span className="flex items-center gap-1 text-[9px] font-mono text-white">
                              <span className="w-1.5 h-1.5 rounded-full bg-[var(--clr-pulse)] animate-pulse" /> ACTIVE
                            </span>
                          )}
                        </div>
                      </div>

                      <h3 className={`text-2xl font-light tracking-[-0.02em] mb-3 ${userRole === "employer" ? "text-white" : "text-white/85"}`}>
                        Enterprise Node
                      </h3>
                      <p className={`text-sm leading-relaxed mb-7 font-light ${userRole === "employer" ? "text-white/65" : "text-white/45"}`}>
                        Manage global treasuries, register cryptographic employee tags, and initiate
                        private payroll runs sealed inside Nillion nilCC TEE + MagicBlock Permissioned ER.
                      </p>

                      <div className="grid grid-cols-3 gap-2 mb-7">
                        {[["∞", "Treasury"], ["ZK", "Execution"], ["L1", "Settlement"]].map(([val, lbl]) => (
                          <div key={lbl} className="rounded-lg p-2.5 text-center border border-white/[0.06] bg-white/[0.02]">
                            <div className="num text-base font-semibold text-white">{val}</div>
                            <div className="text-[9px] uppercase tracking-[0.2em] text-white/35 mt-0.5">{lbl}</div>
                          </div>
                        ))}
                      </div>

                      <ul className="space-y-2.5 mb-7">
                        {["Treasury Custody & Escrow", "ZK Payroll Execution", "Merkle Set Commitments"].map(f => (
                          <li key={f} className="flex items-center gap-3 text-[13px] tracking-[0.01em]">
                            <CheckCircle2 className={`h-3.5 w-3.5 flex-shrink-0 ${userRole === "employer" ? "text-white" : "text-white/30"}`} />
                            <span className={userRole === "employer" ? "text-white/75" : "text-white/40"}>{f}</span>
                          </li>
                        ))}
                      </ul>

                      <AnimatePresence>
                        {userRole === "employer" && (
                          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                            <Link
                              href="/login"
                              className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-white text-black text-[11px] font-semibold uppercase tracking-[0.2em] hover:bg-white/90 transition-colors duration-300"
                            >
                              Authenticate Node <ChevronRight className="h-4 w-4" />
                            </Link>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                </TiltCard>
              </motion.div>

              {/* Recipient */}
              <motion.div variants={fadeUp} className="relative" style={{ perspective: 1000 }}>
                <TiltCard className="cursor-pointer" onClick={() => setUserRole("employee")}>
                  <div
                    className={`relative rounded-2xl overflow-hidden transition-colors duration-400 ${
                      userRole === "employee"
                        ? "bg-white/[0.04] border border-white/30"
                        : "bg-black/50 border border-white/[0.08] hover:border-white/[0.18] backdrop-blur-md"
                    }`}
                  >
                    <div className="absolute top-0 left-0 w-8 h-8 border-t border-l border-white/30 rounded-tl-2xl pointer-events-none" />
                    <div className="absolute top-0 right-0 w-8 h-8 border-t border-r border-white/30 rounded-tr-2xl pointer-events-none" />
                    <div className="absolute bottom-0 left-0 w-8 h-8 border-b border-l border-white/15 rounded-bl-2xl pointer-events-none" />
                    <div className="absolute bottom-0 right-0 w-8 h-8 border-b border-r border-white/15 rounded-br-2xl pointer-events-none" />

                    <div className="p-8 lg:p-10">
                      <div className="flex justify-between items-start mb-9">
                        <div className={`h-12 w-12 rounded-xl flex items-center justify-center transition-colors duration-300 ${userRole === "employee" ? "bg-white text-black" : "bg-white/[0.05] border border-white/10 text-white/70"}`}>
                          <UserCircle className="h-5 w-5" />
                        </div>
                        <div className="flex flex-col items-end gap-1.5">
                          <span className={`text-[9px] font-mono uppercase tracking-[0.22em] px-2 py-0.5 rounded-md border ${userRole === "employee" ? "text-white border-white/30 bg-white/[0.05]" : "text-white/30 border-white/10"}`}>
                            NODE-02
                          </span>
                          {userRole === "employee" && (
                            <span className="flex items-center gap-1 text-[9px] font-mono text-white">
                              <span className="w-1.5 h-1.5 rounded-full bg-[var(--clr-pulse)] animate-pulse" /> ACTIVE
                            </span>
                          )}
                        </div>
                      </div>

                      <h3 className={`text-2xl font-light tracking-[-0.02em] mb-3 ${userRole === "employee" ? "text-white" : "text-white/85"}`}>
                        Recipient Client
                      </h3>
                      <p className={`text-sm leading-relaxed mb-7 font-light ${userRole === "employee" ? "text-white/65" : "text-white/45"}`}>
                        Generate client-side cryptographic credentials, retrieve encrypted salary packets,
                        and execute sovereign withdrawals on Layer&nbsp;2.
                      </p>

                      <div className="grid grid-cols-3 gap-2 mb-7">
                        {[["SK", "Private Key"], ["ZK", "Proof"], ["L2", "Withdrawal"]].map(([val, lbl]) => (
                          <div key={lbl} className="rounded-lg p-2.5 text-center border border-white/[0.06] bg-white/[0.02]">
                            <div className="num text-base font-semibold text-white">{val}</div>
                            <div className="text-[9px] uppercase tracking-[0.2em] text-white/35 mt-0.5">{lbl}</div>
                          </div>
                        ))}
                      </div>

                      <ul className="space-y-2.5 mb-7">
                        {["Local Key Generation", "Shielded Routing", "Anonymous Settlement"].map(f => (
                          <li key={f} className="flex items-center gap-3 text-[13px] tracking-[0.01em]">
                            <CheckCircle2 className={`h-3.5 w-3.5 flex-shrink-0 ${userRole === "employee" ? "text-white" : "text-white/30"}`} />
                            <span className={userRole === "employee" ? "text-white/75" : "text-white/40"}>{f}</span>
                          </li>
                        ))}
                      </ul>

                      <AnimatePresence>
                        {userRole === "employee" && (
                          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                            <Link
                              href="/login"
                              className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-white text-black text-[11px] font-semibold uppercase tracking-[0.2em] hover:bg-white/90 transition-colors duration-300"
                            >
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
          </section>

          {/* ─ Underlying tech ─ Solana privacy stack ─────── */}
          <motion.section variants={fadeUp} id="architecture" className="max-w-7xl mx-auto pt-20 border-t border-white/[0.06]">
            <p className="text-center text-[10px] font-semibold uppercase tracking-[0.3em] text-white/35 mb-3">The Solana Privacy Stack</p>
            <p className="text-center text-[10px] font-mono uppercase tracking-[0.22em] text-white/25 mb-14">
              Settled on Solana L1 · Powered by the Solana ecosystem
            </p>
            <div className="grid md:grid-cols-3 gap-4">
              {[
                {
                  icon: <Database className="h-5 w-5" />,
                  label: "Data Privacy",
                  title: "Nillion nilDB + nilCC",
                  desc: "Salary data stored as %allot secret shares across Nillion nodes. Payroll computation runs inside a Trusted Execution Environment. Amounts never leave the enclave.",
                },
                {
                  icon: <Cpu className="h-5 w-5" />,
                  label: "ZK Proving",
                  title: "Groth16 (circom + snarkjs)",
                  desc: "256-byte Groth16 proofs generated client-side via snarkjs from the voucher.circom circuit. Verified by Solana's native alt-bn128 syscalls, fitting inside the Solana CU budget. Nullifier PDA blocks double-spend.",
                },
                {
                  icon: <Zap className="h-5 w-5" />,
                  label: "Payment Privacy",
                  title: "MagicBlock Private Pay",
                  desc: "Claim settlement is routed employer-ER → employee-ER through MagicBlock Permissioned Ephemeral Rollups, with split transfers and randomized 500 to 30,000 ms delays. The base layer sees a transfer happened. Never the amount or pairing.",
                },
              ].map((card) => (
                <div
                  key={card.title}
                  className="group relative p-7 rounded-2xl bg-white/[0.02] border border-white/[0.06] hover:border-white/20 transition-colors duration-500"
                >
                  <p className="text-[9px] font-semibold uppercase tracking-[0.28em] mb-5 text-white/45">{card.label}</p>
                  <div className="h-11 w-11 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center mb-5 text-white/85">
                    {card.icon}
                  </div>
                  <h4 className="font-semibold text-lg mb-2.5 text-white tracking-[-0.01em]">{card.title}</h4>
                  <p className="text-sm text-white/55 leading-relaxed font-light">{card.desc}</p>
                  <div className="absolute bottom-0 left-7 right-7 h-px hairline" />
                </div>
              ))}
            </div>
          </motion.section>

        </motion.div>
      </main>

      {/* ══════════════════════════════════════════════════════════════
           FOOTER
      ══════════════════════════════════════════════════════════════ */}
      <footer className="relative z-10 mt-24 bg-black border-t border-white/[0.06] overflow-hidden">

        {/* Top: brand + subscribe */}
        <div className="max-w-7xl mx-auto px-6 pt-16 pb-14 grid md:grid-cols-2 gap-14 border-b border-white/[0.04]">
          <div>
            <div className="flex items-center gap-3 mb-5">
              <img src="/logo-light.svg" alt="Civitas" className="h-6 w-auto opacity-90" />
            </div>
            <p className="text-[14px] text-white/45 font-light leading-relaxed max-w-sm">
              Institutional-grade private payroll infrastructure built on Solana &amp; Nillion.
              Compliant. Confidential. On-chain.
            </p>
            <div className="flex items-center gap-3 mt-7">
              {[
                { icon: <Github className="h-4 w-4" />, href: "https://github.com/MeetCivitas/Civitas-Sol", label: "GitHub" },
                { icon: <Twitter className="h-4 w-4" />, href: "https://x.com/meet_civitas", label: "Twitter" },
              ].map(s => (
                <a
                  key={s.label}
                  href={s.href}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={s.label}
                  className="w-9 h-9 rounded-lg bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-white/55 hover:text-white hover:bg-white/[0.08] hover:border-white/20 transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
                >
                  {s.icon}
                </a>
              ))}
            </div>
          </div>

          <div className="flex flex-col justify-center">
            <p className="text-[10px] font-semibold tracking-[0.28em] uppercase text-white/35 mb-3">Stay Updated</p>
            <h3 className="text-2xl font-light text-white tracking-[-0.02em] mb-2">Subscribe for the latest updates.</h3>
            <p className="text-sm text-white/40 font-light mb-5">Protocol releases, security advisories, and feature announcements.</p>
            {subscribed ? (
              <div className="flex items-center gap-3 px-5 py-3.5 rounded-xl bg-white/[0.04] border border-white/15 text-white text-sm font-medium">
                <CheckCircle2 className="h-4 w-4" /> Subscribed. See you there.
              </div>
            ) : (
              <>
                <form onSubmit={handleSubscribe} className="flex flex-col sm:flex-row gap-3">
                  <label htmlFor="footer-email" className="sr-only">Email address</label>
                  <input
                    id="footer-email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={e => { setEmail(e.target.value); if (subscribeError) setSubscribeError("") }}
                    placeholder="Your email address"
                    required
                    className="flex-1 px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.10] text-white placeholder:text-white/30 text-sm focus-visible:outline-none focus-visible:border-white/35 focus-visible:bg-white/[0.06] transition-colors"
                  />
                  <button
                    type="submit"
                    disabled={isSubscribing}
                    className="px-5 py-3 rounded-xl bg-white text-black text-[12px] font-semibold tracking-[0.18em] uppercase hover:bg-white/90 transition-colors duration-300 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                  >
                    {isSubscribing ? "Subscribing…" : "Subscribe"}
                  </button>
                </form>
                {subscribeError && (
                  <p className="mt-3 text-xs text-red-400/90" role="alert">{subscribeError}</p>
                )}
              </>
            )}
          </div>
        </div>

        {/* Middle: nav columns */}
        <div className="max-w-7xl mx-auto px-6 py-14 grid grid-cols-2 md:grid-cols-4 gap-10 border-b border-white/[0.04]">
          {[
            {
              heading: "Solutions",
              links: [
                { label: "Employer Portal", href: "/login" },
                { label: "Employee Portal", href: "/login" },
                { label: "Treasury Mgmt",   href: "#" },
                { label: "ZK Payroll",      href: "#" },
              ],
            },
            {
              heading: "Ecosystem",
              links: [
                { label: "Solana",          href: "https://solana.com",                      ext: true },
                { label: "Nillion Network", href: "https://nillion.com",                     ext: true },
                { label: "MagicBlock",      href: "https://magicblock.gg",                   ext: true },
                { label: "circom",          href: "https://docs.circom.io",                  ext: true },
                { label: "snarkjs",         href: "https://github.com/iden3/snarkjs",        ext: true },
              ],
            },
            {
              heading: "Developers",
              links: [
                { label: "GitHub",          href: "https://github.com/MeetCivitas/Civitas-Sol", ext: true },
                { label: "Docs",            href: "#" },
                { label: "Smart Contracts", href: "#" },
                { label: "SDK",             href: "#" },
              ],
            },
            {
              heading: "Legal",
              links: [
                { label: "Privacy Policy",   href: "#" },
                { label: "Terms of Service", href: "#" },
                { label: "Bug Bounty",       href: "#" },
                { label: "Audit Reports",    href: "#" },
              ],
            },
          ].map(col => (
            <div key={col.heading}>
              <p className="text-[9px] font-semibold tracking-[0.3em] uppercase text-white/35 mb-5">{col.heading}</p>
              <ul className="space-y-3.5">
                {col.links.map(link => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      target={(link as any).ext ? "_blank" : undefined}
                      rel={(link as any).ext ? "noreferrer" : undefined}
                      className="inline-flex items-center gap-1.5 text-sm text-white/55 hover:text-white transition-colors duration-200 group"
                    >
                      {link.label}
                      {(link as any).ext && (
                        <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-50 transition-opacity" aria-hidden />
                      )}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="max-w-7xl mx-auto px-6 py-6 flex flex-col md:flex-row items-center justify-between gap-4 border-b border-white/[0.04]">
          <p className="text-[10px] font-mono text-white/25 tracking-[0.28em]">© 2026 CIVITAS PROTOCOL · ALL RIGHTS RESERVED</p>
          <div className="flex flex-wrap items-center gap-2">
            {["Solana Devnet", "Nillion Testnet", "Groth16 ZK", "MagicBlock ER"].map(tag => (
              <span key={tag} className="text-[9px] font-mono px-2 py-1 rounded-md border border-white/[0.08] text-white/35 tracking-[0.22em]">
                {tag}
              </span>
            ))}
          </div>
        </div>

        {/* Massive wordmark - logo SVG scaled to footer width (true Qurova-Demo letterforms) */}
        <div className="relative w-full overflow-hidden select-none">
          <div className="px-[3vw] pb-2 pt-8">
            <img
              src="/logo-light.svg"
              alt=""
              aria-hidden
              className="block w-full h-auto"
              style={{
                WebkitMaskImage:
                  "linear-gradient(to bottom, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.45) 55%, rgba(255,255,255,0.05) 100%)",
                maskImage:
                  "linear-gradient(to bottom, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.45) 55%, rgba(255,255,255,0.05) 100%)",
              }}
            />
          </div>
          <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black pointer-events-none" />
        </div>
      </footer>

      {/* ── Waitlist Modal ── */}
      <AnimatePresence>
        {showWaitlist && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/85 backdrop-blur-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="waitlist-heading"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              className="relative w-full max-w-lg bg-[#070707] border border-white/[0.10] rounded-3xl p-8 overflow-hidden"
            >
              <div className="absolute top-0 left-0 w-full h-px hairline" />

              <button
                onClick={() => setShowWaitlist(false)}
                aria-label="Close waitlist"
                className="absolute top-5 right-5 p-2 rounded-full bg-white/[0.04] hover:bg-white/[0.10] text-white/60 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
              >
                <X className="h-4 w-4" />
              </button>

              {waitlistStatus === "success" ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="w-16 h-16 rounded-2xl bg-white/[0.05] border border-white/15 flex items-center justify-center mb-6">
                    <CheckCircle2 className="h-8 w-8 text-white" />
                  </div>
                  <h3 className="text-2xl font-light text-white mb-2 tracking-[-0.02em]">Access requested.</h3>
                  <p className="text-white/55 text-sm max-w-xs font-light">
                    You&apos;re on the waitlist. We&apos;ll be in touch with your early-access code soon.
                  </p>
                </div>
              ) : (
                <>
                  <div className="mb-7">
                    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-white/[0.05] border border-white/15 text-[10px] font-semibold uppercase tracking-[0.22em] text-white mb-5">
                      <Zap className="h-3 w-3" /> Priority Queue
                    </div>
                    <h3 id="waitlist-heading" className="text-3xl font-light text-white tracking-[-0.025em] mb-2">
                      Join early access.
                    </h3>
                    <p className="text-sm text-white/55 font-light pr-8">
                      Be among the first to run institutional-grade zero-knowledge payroll on Solana.
                    </p>
                  </div>

                  <form onSubmit={handleJoinWaitlist} className="space-y-4">
                    <div className="space-y-1.5">
                      <label htmlFor="wl-email" className="text-[10px] uppercase tracking-[0.22em] text-white/45 font-semibold pl-1">
                        Work Email *
                      </label>
                      <div className="relative">
                        <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" aria-hidden />
                        <input
                          id="wl-email"
                          type="email"
                          autoComplete="email"
                          required
                          value={waitlistForm.email}
                          onChange={e => setWaitlistForm({ ...waitlistForm, email: e.target.value })}
                          className="w-full bg-white/[0.03] border border-white/[0.10] focus-visible:border-white/40 rounded-xl pl-11 pr-4 py-3 text-white placeholder:text-white/25 text-sm outline-none transition-colors duration-300"
                          placeholder="satoshi@nakamoto.com"
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label htmlFor="wl-company" className="text-[10px] uppercase tracking-[0.22em] text-white/45 font-semibold pl-1">
                        Company / DAO Name
                      </label>
                      <div className="relative">
                        <Building2 className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" aria-hidden />
                        <input
                          id="wl-company"
                          type="text"
                          autoComplete="organization"
                          required
                          value={waitlistForm.company}
                          onChange={e => setWaitlistForm({ ...waitlistForm, company: e.target.value })}
                          className="w-full bg-white/[0.03] border border-white/[0.10] focus-visible:border-white/40 rounded-xl pl-11 pr-4 py-3 text-white placeholder:text-white/25 text-sm outline-none transition-colors duration-300"
                          placeholder="XYZ Foundation"
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label htmlFor="wl-twitter" className="text-[10px] uppercase tracking-[0.22em] text-white/45 font-semibold pl-1">
                        Twitter Handle (Optional)
                      </label>
                      <div className="relative">
                        <Twitter className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" aria-hidden />
                        <input
                          id="wl-twitter"
                          type="text"
                          value={waitlistForm.twitter}
                          onChange={e => setWaitlistForm({
                            ...waitlistForm,
                            twitter: e.target.value.startsWith("@") ? e.target.value : `@${e.target.value}`,
                          })}
                          className="w-full bg-white/[0.03] border border-white/[0.10] focus-visible:border-white/40 rounded-xl pl-11 pr-4 py-3 text-white placeholder:text-white/25 text-sm outline-none transition-colors duration-300"
                          placeholder="@satoshinakamoto"
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={waitlistStatus === "submitting"}
                      className="w-full mt-2 rounded-xl bg-white text-black font-semibold text-[12px] tracking-[0.2em] uppercase hover:bg-white/90 transition-colors duration-300 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                    >
                      <div className="flex items-center justify-center gap-2 px-8 py-3.5">
                        {waitlistStatus === "submitting" ? (
                          <>
                            <span className="w-4 h-4 rounded-full border-2 border-black/20 border-t-black animate-spin" />
                            <span>Processing…</span>
                          </>
                        ) : (
                          <>
                            Submit Application
                            <ArrowRight className="h-4 w-4" />
                          </>
                        )}
                      </div>
                    </button>
                    {waitlistStatus === "error" && (
                      <p className="text-red-400/90 text-xs text-center mt-2" role="alert">
                        {waitlistError || "Submission failed. Please try again."}
                      </p>
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
