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

/**
 * Monochrome KPI card. Subtle hairline frame, mono-font value,
 * neutral hover lift. No color accents — hierarchy via type weight.
 */
export function KPICard({ title, value, icon: Icon, trend, subtitle }: KPICardProps) {
  return (
    <motion.div
      whileHover={{ y: -3 }}
      transition={{ type: "spring", stiffness: 280, damping: 22 }}
      className="surface rounded-2xl p-5 relative overflow-hidden group backdrop-blur-xl"
    >
      <div className="absolute inset-x-0 top-0 h-px hairline opacity-60" />
      <div className="flex items-start justify-between relative z-10 gap-4">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/45">{title}</p>
          <p className="mt-3 num text-[28px] font-semibold tracking-[-0.02em] text-white leading-none truncate">
            {value}
          </p>
          {trend && (
            <p className={`mt-3 text-[11px] font-medium flex items-center gap-1.5 ${trend.positive ? "text-white/75" : "text-red-400/85"}`}>
              <span className="inline-flex h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
              {trend.value}
            </p>
          )}
          {subtitle && <p className="mt-2 text-[11px] text-white/35">{subtitle}</p>}
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.04] border border-white/10 text-white/80 group-hover:bg-white/[0.08] group-hover:text-white transition-colors duration-300 shrink-0">
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </motion.div>
  )
}
