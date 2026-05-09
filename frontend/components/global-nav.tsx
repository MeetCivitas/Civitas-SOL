"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { WalletButton } from "@/components/wallet-button"
import { motion } from "framer-motion"

const NAV_ITEMS = [
    { href: "/employer", label: "Employer" },
    { href: "/employees", label: "Employee" },
    { href: "/register", label: "Register" },
] as const

export function GlobalNav() {
    const pathname = usePathname()

    const hideOn = ["/login", "/register"]
    if (
        hideOn.includes(pathname) ||
        pathname.startsWith("/employer") ||
        pathname.startsWith("/employees")
    ) {
        return null
    }

    return (
        <motion.header
            initial={{ y: -24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
            className="sticky top-0 z-50"
            role="banner"
        >
            <div className="absolute inset-0 bg-black/70 backdrop-blur-2xl" aria-hidden />
            <div
                className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent"
                aria-hidden
            />

            <div className="relative max-w-7xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between">
                {/* ── Logo ── */}
                <Link
                    href="/"
                    aria-label="Civitas home"
                    className="group relative flex items-center gap-3 outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:rounded-md"
                >
                    <span
                        className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white"
                        aria-hidden
                    >
                        <span className="absolute inset-0 rounded-full bg-white/55 animate-ping" />
                    </span>
                    <img
                        src="/logo-light.svg"
                        alt="Civitas"
                        width={120}
                        height={24}
                        className="h-[22px] w-auto opacity-95 transition-opacity duration-300 group-hover:opacity-100"
                        draggable={false}
                    />
                </Link>

                {/* ── Center nav pill ── */}
                <nav
                    aria-label="Primary"
                    className="hidden md:flex absolute left-1/2 -translate-x-1/2 items-center gap-1 rounded-full border border-white/10 bg-white/[0.025] p-1 backdrop-blur-md shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                >
                    {NAV_ITEMS.map(({ href, label }) => {
                        const active = pathname.startsWith(href)
                        return (
                            <Link
                                key={href}
                                href={href}
                                aria-current={active ? "page" : undefined}
                                className={`relative px-4 py-1.5 rounded-full text-[11px] font-semibold uppercase tracking-[0.22em] transition-colors duration-300 outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${
                                    active
                                        ? "text-black"
                                        : "text-white/55 hover:text-white"
                                }`}
                            >
                                {active && (
                                    <motion.span
                                        layoutId="nav-active-pill"
                                        transition={{
                                            type: "spring",
                                            stiffness: 380,
                                            damping: 32,
                                        }}
                                        className="absolute inset-0 rounded-full bg-white shadow-[0_0_0_1px_rgba(255,255,255,0.6),0_8px_24px_-12px_rgba(255,255,255,0.45)]"
                                        aria-hidden
                                    />
                                )}
                                <span className="relative">{label}</span>
                            </Link>
                        )
                    })}
                </nav>

                {/* ── Right cluster ── */}
                <div className="flex items-center gap-2 sm:gap-3">
                    <span
                        className="hidden lg:inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.025] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-white/55"
                        aria-label="Network status"
                    >
                        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white/85">
                            <span className="absolute inset-0 rounded-full bg-white/40 animate-ping" />
                        </span>
                        Devnet
                    </span>
                    <WalletButton />
                </div>
            </div>

            {/* Mobile nav strip */}
            <nav
                aria-label="Primary mobile"
                className="md:hidden relative border-t border-white/[0.06] bg-black/50 backdrop-blur-xl"
            >
                <div className="max-w-7xl mx-auto px-5 flex items-center gap-1 overflow-x-auto h-11">
                    {NAV_ITEMS.map(({ href, label }) => {
                        const active = pathname.startsWith(href)
                        return (
                            <Link
                                key={href}
                                href={href}
                                aria-current={active ? "page" : undefined}
                                className={`shrink-0 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.22em] transition-colors duration-200 ${
                                    active
                                        ? "text-white"
                                        : "text-white/45 hover:text-white/80"
                                }`}
                            >
                                <span className="relative inline-block">
                                    {label}
                                    {active && (
                                        <span
                                            className="absolute -bottom-2 left-0 right-0 h-px bg-white"
                                            aria-hidden
                                        />
                                    )}
                                </span>
                            </Link>
                        )
                    })}
                </div>
            </nav>
        </motion.header>
    )
}
