import { cn } from "@/lib/utils"

interface StatusBadgeProps {
  status: string
  className?: string
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const statusStyles: Record<string, string> = {
    Draft: "bg-muted text-muted-foreground",
    Committed: "bg-primary/10 text-primary",
    committed: "bg-primary/10 text-primary",
    Settled: "bg-accent/10 text-accent",
    settled: "bg-accent/10 text-accent",
    Unopened: "bg-muted text-muted-foreground",
    Opened: "bg-accent/10 text-accent",
    Registered: "bg-accent/10 text-accent",
    Pending: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
    pending: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
    active: "bg-accent/10 text-accent",
    provisional: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
    terminated: "bg-destructive/10 text-destructive",
  }

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        statusStyles[status] || "bg-muted text-muted-foreground",
        className,
      )}
    >
      {status}
    </span>
  )
}
