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
            initial={{ y: -100 }}
            animate={{ y: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="sticky top-0 z-50 border-b border-white/5 bg-black/40 backdrop-blur-2xl"
        >
            <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
                {/* Logo */}
                <Link href="/" className="flex items-center gap-3 group">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 border border-purple-500/30 flex items-center justify-center font-bold text-white text-base shadow-[0_0_15px_rgba(168,85,247,0.3)] group-hover:shadow-[0_0_25px_rgba(168,85,247,0.5)] transition-all duration-300">
                        C
                    </div>
                    <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-white/70 tracking-tight hidden sm:inline">Civitas</span>
                </Link>

                {/* Center links */}
                <nav className="hidden md:flex items-center gap-2 p-1.5 rounded-full border border-white/5 bg-white/5 backdrop-blur-md">
                    {[
                        { href: "/employer", label: "Employer" },
                        { href: "/employees", label: "Employee" },
                        { href: "/register", label: "Register" },
                    ].map(({ href, label }) => (
                        <Link
                            key={href}
                            href={href}
                            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all duration-300 ${pathname.startsWith(href)
                                ? "text-white bg-white/10 shadow-[0_0_10px_rgba(255,255,255,0.1)]"
                                : "text-white/50 hover:text-white hover:bg-white/5"
                                }`}
                        >
                            {label}
                        </Link>
                    ))}
                </nav>

                {/* Wallet */}
                <div className="flex items-center gap-4">
                    <WalletButton />
                </div>
            </div>
        </motion.header>
    )
}
