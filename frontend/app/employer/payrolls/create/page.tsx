"use client"

import { CreatePayrollWizard } from "@/components/employer/create-payroll-wizard"
import { WalletButton } from "@/components/wallet-button"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"

export default function CreatePayrollPage() {
  return (
    <div className="min-h-screen bg-[#030303] text-white selection:bg-blue-500/30 selection:text-white pb-20 relative overflow-x-hidden">

      {/* ── Living Background ── */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <video autoPlay loop muted playsInline className="w-full h-full object-cover opacity-30 mix-blend-screen">
          <source src="/videos/Animated_Privacy_Video_Element.mp4" type="video/mp4" />
        </video>
        <div className="absolute inset-0 bg-black/70 backdrop-blur-[2px]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,transparent_0%,#030303_70%)]" />
      </div>

      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-white/[0.04] bg-[#030303]/60 backdrop-blur-2xl">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-5">
            <Link href="/employer" className="flex items-center gap-3 group">
              <div className="w-9 h-9 rounded-lg bg-white/[0.06] border border-white/10 flex items-center justify-center font-bold text-white text-sm group-hover:border-blue-500/30 transition-all duration-300">
                C
              </div>
              <div className="flex items-center gap-3">
                <span className="text-lg font-semibold tracking-tight text-white/90">Civitas</span>
                <span className="px-2.5 py-1 rounded-md bg-blue-500/10 border border-blue-500/20 text-[9px] uppercase tracking-[0.2em] text-blue-400 font-bold hidden sm:inline-block">Payroll Wizard</span>
              </div>
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.06] text-[10px] font-bold uppercase tracking-widest text-white/40">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
              </span>
              Solana
            </div>
            <div className="h-4 w-px bg-white/[0.06] hidden sm:block" />
            <WalletButton />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="relative z-10 max-w-5xl mx-auto px-6 mt-8">
        {/* Back navigation */}
        <Link
          href="/employer"
          className="inline-flex items-center gap-2 text-white/40 hover:text-white/80 text-sm font-medium transition-colors duration-200 mb-8 group"
        >
          <ArrowLeft className="h-4 w-4 transition-transform duration-200 group-hover:-translate-x-1" />
          Back to Dashboard
        </Link>

        <CreatePayrollWizard />
      </div>
    </div>
  )
}
