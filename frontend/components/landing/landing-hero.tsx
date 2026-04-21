"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"
import { ArrowRight, Play, Lock, Globe, Eye } from "lucide-react"

export function LandingHero() {
  return (
    <section className="relative min-h-screen overflow-hidden pt-16">
      <div className="absolute inset-0 z-0">
        <video autoPlay loop muted playsInline className="h-full w-full object-cover opacity-40 dark:opacity-25">
          <source src="/images/animated-privacy-video-element.mp4" type="video/mp4" />
        </video>
        <div className="absolute inset-0 bg-gradient-to-b from-background/50 via-background/70 to-background" />
      </div>

      {/* Hero Content */}
      <div className="relative z-10 mx-auto flex min-h-[calc(100vh-4rem)] max-w-7xl flex-col items-center justify-center px-4 text-center sm:px-6 lg:px-8">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 backdrop-blur-sm">
          <span className="text-xs font-medium text-primary">Zero-Knowledge Payroll</span>
          <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
            PROTOTYPE
          </span>
        </div>

        <h1 className="mb-6 max-w-4xl text-balance text-4xl font-bold tracking-tight text-foreground sm:text-5xl md:text-6xl lg:text-7xl">
          Privacy-first payroll for the{" "}
          <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
            decentralized era
          </span>
        </h1>

        <p className="mb-10 max-w-2xl text-pretty text-lg text-muted-foreground sm:text-xl">
          Run private payroll with zero-knowledge proofs. Multi-chain settlement with full auditor controls. Your
          employees' salaries remain confidential, yet fully verifiable.
        </p>

        <div className="flex flex-col items-center gap-4 sm:flex-row">
          <Link href="/login">
            <Button size="lg" className="gap-2 bg-primary px-8 hover:bg-primary/90">
              Try Demo
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
          <Button size="lg" variant="outline" className="gap-2 px-8 border-border/50 bg-background/50 backdrop-blur-sm">
            <Play className="h-4 w-4" />
            Watch Demo
          </Button>
        </div>

        {/* Trust Indicators */}
        <div className="mt-16 grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-8">
          <div className="flex items-center justify-center gap-3 rounded-xl border border-border/50 bg-card/50 p-4 backdrop-blur-sm">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Lock className="h-5 w-5 text-primary" />
            </div>
            <div className="text-left">
              <p className="text-sm font-medium text-foreground">End-to-end encrypted</p>
              <p className="text-xs text-muted-foreground">Zero-knowledge proofs</p>
            </div>
          </div>
          <div className="flex items-center justify-center gap-3 rounded-xl border border-border/50 bg-card/50 p-4 backdrop-blur-sm">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10">
              <Globe className="h-5 w-5 text-accent" />
            </div>
            <div className="text-left">
              <p className="text-sm font-medium text-foreground">Multi-chain</p>
              <p className="text-xs text-muted-foreground">Axelar, NEAR, Zcash</p>
            </div>
          </div>
          <div className="flex items-center justify-center gap-3 rounded-xl border border-border/50 bg-card/50 p-4 backdrop-blur-sm">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Eye className="h-5 w-5 text-primary" />
            </div>
            <div className="text-left">
              <p className="text-sm font-medium text-foreground">Auditor access</p>
              <p className="text-xs text-muted-foreground">Selective disclosure</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
