import type { LucideIcon } from "lucide-react"
import { motion } from "framer-motion"

interface KPICardProps {
  title: string
  value: string | number
  icon: LucideIcon
  trend?: {
    value: string
    positive: boolean
  }
  subtitle?: string
}

export function KPICard({ title, value, icon: Icon, trend, subtitle }: KPICardProps) {
  return (
    <motion.div
      whileHover={{ y: -5, scale: 1.02 }}
      transition={{ type: "spring", stiffness: 300, damping: 20 }}
      className="glass-card rounded-2xl p-6 relative overflow-hidden group"
    >
      <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
      <div className="flex items-start justify-between relative z-10">
        <div>
          <p className="text-sm font-medium text-white/50">{title}</p>
          <p className="mt-2 text-3xl font-bold tracking-tight text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.2)]">{value}</p>
          {trend && (
            <p className={`mt-2 font-medium text-xs flex items-center gap-1 ${trend.positive ? "text-emerald-400 drop-shadow-[0_0_5px_rgba(52,211,153,0.3)]" : "text-red-400 drop-shadow-[0_0_5px_rgba(248,113,113,0.3)]"}`}>
              <span className="text-lg leading-none">{trend.positive ? "↑" : "↓"}</span> {trend.value}
            </p>
          )}
          {subtitle && <p className="mt-1 text-xs text-white/40">{subtitle}</p>}
        </div>
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-500/10 border border-purple-500/20 group-hover:bg-purple-500/20 group-hover:border-purple-500/30 transition-all duration-300 shadow-[0_0_15px_rgba(168,85,247,0.1)] group-hover:shadow-[0_0_20px_rgba(168,85,247,0.2)]">
          <Icon className="h-6 w-6 text-purple-400 group-hover:text-purple-300 transition-colors" />
        </div>
      </div>
    </motion.div>
  )
}
