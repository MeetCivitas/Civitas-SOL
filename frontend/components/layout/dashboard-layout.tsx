"use client"

import type React from "react"

import type { ReactNode } from "react"
import { useRouter, usePathname } from "next/navigation"
import Link from "next/link"
import { useAuth, type UserRole } from "@/lib/auth-context"
import { Button } from "@/components/ui/button"
import {
  Shield,
  LogOut,
  LayoutDashboard,
  Users,
  Wallet,
  Settings,
  HelpCircle,
  FileText,
  ClipboardCheck,
  Inbox,
  User,
  CreditCard,
  Link2,
  Menu,
  X,
  ChevronRight,
  Zap,
} from "lucide-react"
import { useState, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"

interface NavItem {
  href: string
  label: string
  icon: React.ElementType
  accent?: string
}

const NAV_ITEMS: Record<UserRole, NavItem[]> = {
  employer: [
    { href: "/employer/dashboard", label: "Dashboard", icon: LayoutDashboard, accent: "emerald" },
    { href: "/employer/employees", label: "Employees", icon: Users, accent: "blue" },
    { href: "/employer/payrolls", label: "Payrolls", icon: Wallet, accent: "sky" },
    { href: "/employer/auditors", label: "Auditors", icon: ClipboardCheck, accent: "amber" },
    { href: "/employer/integrations", label: "Integrations", icon: Link2, accent: "emerald" },
    { href: "/employer/settings", label: "Settings", icon: Settings, accent: "blue" },
  ],
  employee: [
    { href: "/employee/dashboard", label: "Dashboard", icon: LayoutDashboard, accent: "blue" },
    { href: "/employee/inbox", label: "Inbox", icon: Inbox, accent: "emerald" },
    { href: "/employee/profile", label: "Profile", icon: User, accent: "sky" },
    { href: "/employee/claims", label: "Claims", icon: CreditCard, accent: "blue" },
  ],
  auditor: [
    { href: "/auditor/dashboard", label: "Dashboard", icon: LayoutDashboard, accent: "amber" },
    { href: "/auditor/requests", label: "Requests", icon: FileText, accent: "sky" },
    { href: "/auditor/verifications", label: "Verifications", icon: ClipboardCheck, accent: "emerald" },
  ],
  none: [],
}

const ACCENT_COLORS: Record<string, string> = {
  purple: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  pink: "bg-pink-500/10 text-pink-400 border-pink-500/20",
  blue: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  sky: "bg-sky-500/10 text-sky-400 border-sky-500/20",
  emerald: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  amber: "bg-amber-500/10 text-amber-400 border-amber-500/20",
}

const ROLE_GRADIENT: Record<string, string> = {
  employer: "from-emerald-500 to-blue-500",
  employee: "from-blue-500 to-emerald-500",
  auditor: "from-sky-500 to-blue-500",
  none: "from-zinc-600 to-zinc-500",
}

const ROLE_LABEL: Record<string, string> = {
  employer: "Employer",
  employee: "Employee",
  auditor: "Auditor",
  none: "",
}

export function DashboardLayout({ children }: { children: ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { user, logout, role } = useAuth()
  const isLoading = false
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    if (!isLoading && !user) {
      router.push("/login")
    }
  }, [user, isLoading, router])

  if (isLoading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#050505]">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
          <p className="text-white/30 text-sm">Loading...</p>
        </div>
      </div>
    )
  }

  const navItems = NAV_ITEMS[role || "none"]
  const gradient = ROLE_GRADIENT[role || "none"]
  const roleLabel = ROLE_LABEL[role || "none"]

  const handleLogout = async () => {
    await logout()
    router.push("/login")
  }

  const SidebarContent = () => (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div className="flex h-16 items-center gap-3 border-b border-white/5 px-5">
        <img src="/logo-light.svg" alt="Civitas" className="h-5 w-auto opacity-90" />
        {roleLabel && (
          <span className="px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-[9px] uppercase tracking-widest text-white/40 font-semibold">{roleLabel}</span>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-1 p-3 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/")
          const accent = item.accent || "purple"
          const accentClass = ACCENT_COLORS[accent] || ACCENT_COLORS.purple

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setSidebarOpen(false)}
              className={`relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200 group ${isActive
                  ? `${accentClass} border`
                  : "text-white/40 hover:text-white/80 hover:bg-white/5"
                }`}
            >
              {isActive && (
                <motion.div
                  layoutId="sidebarActiveItem"
                  className="absolute inset-0 rounded-xl"
                  transition={{ type: "spring", stiffness: 300, damping: 30 }}
                />
              )}
              <item.icon className="relative z-10 h-4 w-4 flex-shrink-0" />
              <span className="relative z-10 flex-1">{item.label}</span>
              {isActive && (
                <ChevronRight className="relative z-10 h-3.5 w-3.5 opacity-60" />
              )}
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-white/5 p-3 space-y-1">
        <Link
          href="/help"
          className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-white/30 hover:text-white/70 hover:bg-white/5 transition-all"
        >
          <HelpCircle className="h-4 w-4" />
          Help & Docs
        </Link>

        {/* User card */}
        <div className="mt-2 flex items-center gap-3 rounded-xl bg-white/5 border border-white/5 p-3">
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${gradient} text-white text-sm font-bold shadow`}>
            {user.name?.charAt(0) || "U"}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-white">{user.name}</p>
            <p className="truncate text-xs text-white/30">{user.email}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 text-white/30 hover:text-white hover:bg-white/10"
            onClick={handleLogout}
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#050505] text-white">
      {/* Mobile Header */}
      <header className="fixed left-0 right-0 top-0 z-50 flex h-14 items-center justify-between border-b border-white/5 bg-[#050505]/90 px-4 backdrop-blur-xl lg:hidden">
        <Link href={`/${role}/dashboard`} className="flex items-center gap-2.5">
          <img src="/logo-light.svg" alt="Civitas" className="h-4 w-auto opacity-80" />
        </Link>

        <div className="flex items-center gap-2">
          {/* Live indicator */}
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-white/5 border border-white/10 text-xs text-white/50">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
            </span>
            Live
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-white/60 hover:text-white hover:bg-white/10" onClick={() => setSidebarOpen(!sidebarOpen)}>
            {sidebarOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </Button>
        </div>
      </header>

      {/* Mobile Overlay */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Mobile Sidebar */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.aside
            key="mobile-sidebar"
            initial={{ x: -280, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -280, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="fixed left-0 top-0 z-50 h-full w-64 border-r border-white/5 bg-[#080808]/95 backdrop-blur-xl lg:hidden"
          >
            <SidebarContent />
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Desktop Sidebar */}
      <aside className="hidden lg:fixed lg:left-0 lg:top-0 lg:z-50 lg:flex lg:h-full lg:w-64 lg:flex-col lg:border-r lg:border-white/5 lg:bg-[#080808]/80 lg:backdrop-blur-xl">
        <SidebarContent />
      </aside>

      {/* Main Content */}
      <main className="pt-14 lg:ml-64 lg:pt-0">
        <div className="min-h-screen p-4 lg:p-8">
          {children}
        </div>
      </main>
    </div>
  )
}
