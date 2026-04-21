import { Shield, Zap, Users, FileCheck, Link2, BarChart3 } from "lucide-react"

const features = [
  {
    icon: Shield,
    title: "Privacy-First Architecture",
    description:
      "Employee salaries are encrypted end-to-end. Only the recipient can decrypt their paycheck with their private key.",
  },
  {
    icon: Zap,
    title: "Zero-Knowledge Proofs",
    description:
      "Verify payroll correctness without revealing individual amounts. Auditors can confirm totals match without seeing details.",
  },
  {
    icon: Link2,
    title: "Multi-Chain Settlement",
    description:
      "Bridge payroll to any supported chain via Axelar. Employees receive funds in their preferred currency.",
  },
  {
    icon: Users,
    title: "Role-Based Access",
    description:
      "Employers run payroll, employees view their notes, auditors verify proofs. Clear separation of concerns.",
  },
  {
    icon: FileCheck,
    title: "Compliance Ready",
    description:
      "Generate audit reports with selective disclosure. Meet regulatory requirements while preserving privacy.",
  },
  {
    icon: BarChart3,
    title: "Analytics & Reports",
    description:
      "Track payroll spend, headcount trends, and more. All analytics are computed locally on aggregated data.",
  },
]

export function LandingFeatures() {
  return (
    <section className="border-t border-border bg-card/50 py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-16 text-center">
          <h2 className="mb-4 text-3xl font-bold text-foreground sm:text-4xl">
            Everything you need for private payroll
          </h2>
          <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
            Built for teams that value privacy and transparency. Full control over who sees what.
          </p>
        </div>

        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature: any) => (
            <div
              key={feature.title}
              className="group rounded-2xl border border-border bg-card p-6 transition-all hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5"
            >
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 transition-colors group-hover:bg-primary/20">
                <feature.icon className="h-6 w-6 text-primary" />
              </div>
              <h3 className="mb-2 text-lg font-semibold text-foreground">{feature.title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{feature.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
