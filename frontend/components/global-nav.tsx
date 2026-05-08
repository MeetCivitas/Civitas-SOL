"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { WalletButton } from "@/components/wallet-button"
import { motion } from "framer-motion"

export function GlobalNav() {
    const pathname = usePathname()

    // Don't render the global nav on pages that have their own full-page layout
    // (login, register, and portals have their own specialized headers)
    const hideOn = ["/login", "/register"]
    if (hideOn.includes(pathname) || pathname.startsWith("/employer") || pathname.startsWith("/employees")) return null

    return (
        <motion.header
            initial={{ y: -32, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="sticky top-0 z-50 border-b border-white/[0.06] bg-black/60 backdrop-blur-2xl"
        >
            <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
                <Link href="/" className="flex items-center gap-3 group" aria-label="Civitas home">
                    <div className="w-9 h-9 rounded-xl bg-white text-black border border-white flex items-center justify-center font-semibold text-sm group-hover:bg-white/90 transition-colors duration-300">
                        C
                    </div>
                    <span className="text-base font-semibold tracking-tight text-white hidden sm:inline">
                        Civitas
                    </span>
                </Link>

                <nav
                    aria-label="Primary"
                    className="hidden md:flex items-center gap-1 p-1 rounded-full border border-white/[0.08] bg-white/[0.02] backdrop-blur-md"
                >
                    {[
                        { href: "/employer",  label: "Employer" },
                        { href: "/employees", label: "Employee" },
                        { href: "/register",  label: "Register" },
                    ].map(({ href, label }) => {
                        const active = pathname.startsWith(href)
                        return (
                            <Link
                                key={href}
                                href={href}
                                className={`px-4 py-1.5 rounded-full text-[12px] font-semibold uppercase tracking-[0.18em] transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 ${
                                    active ? "text-black bg-white" : "text-white/55 hover:text-white"
                                }`}
                            >
                                {label}
                            </Link>
                        )
                    })}
                </nav>

                <div className="flex items-center gap-3">
                    <WalletButton />
                </div>
            </div>
        </motion.header>
    )
}
