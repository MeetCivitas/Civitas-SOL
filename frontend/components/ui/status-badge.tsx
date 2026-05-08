import { cn } from "@/lib/utils"

interface StatusBadgeProps {
  status: string
  className?: string
}

/**
 * Monochrome status pill. We rely on a leading dot for a hint of state
 * (committed/active = green pulse) but the chip itself is neutral.
 */
export function StatusBadge({ status, className }: StatusBadgeProps) {
  const s = status.toLowerCase()

  // single rule: committed/settled/active/opened/registered = "live" dot
  const isLive = ["committed", "settled", "active", "opened", "registered"].includes(s)
  const isWarn = ["pending", "provisional"].includes(s)
  const isError = s === "terminated"

  const dot = isLive
    ? "bg-[var(--clr-pulse)]"
    : isWarn
      ? "bg-amber-400"
      : isError
        ? "bg-red-400"
        : "bg-white/40"

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em]",
        "border border-white/[0.10] bg-white/[0.04] text-white/75",
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", dot)} aria-hidden />
      {status}
    </span>
  )
}
