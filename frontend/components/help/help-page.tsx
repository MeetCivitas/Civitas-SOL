"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  HelpCircle,
  Book,
  MessageSquare,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Search,
  Shield,
  Users,
  Wallet,
  Key,
} from "lucide-react"

const FAQS = [
  {
    question: "How does zero-knowledge payroll work?",
    answer:
      "Civitas uses zero-knowledge proofs to encrypt individual salaries while allowing verification of the total payroll amount. This means auditors can verify that the sum of all encrypted payments equals the declared total, without seeing any individual amounts.",
    icon: Shield,
  },
  {
    question: "Who can see my salary?",
    answer:
      "Only you can see your salary. When you receive a payroll note, it's encrypted with your public key. You use your private key to decrypt and reveal the amount. Your employer sees only the total payroll, and auditors see only that the proofs are valid.",
    icon: Key,
  },
  {
    question: "How do I claim my funds?",
    answer:
      "After opening a payroll note and revealing your payment, you can claim your funds by bridging them to your preferred chain (Ethereum, Polygon, Arbitrum, or NEAR) using Axelar's cross-chain messaging.",
    icon: Wallet,
  },
  {
    question: "What role do auditors play?",
    answer:
      "Auditors verify that payroll runs are mathematically correct without seeing individual amounts. They confirm that the sum of all encrypted notes equals the declared total, providing transparency while preserving privacy.",
    icon: Users,
  },
]

const DOCS = [
  { title: "Getting Started Guide", href: "#" },
  { title: "Zero-Knowledge Proofs Explained", href: "#" },
  { title: "Cross-Chain Settlement", href: "#" },
  { title: "API Reference", href: "#" },
  { title: "Security Best Practices", href: "#" },
]

export function HelpPage() {
  const [search, setSearch] = useState("")
  const [expandedFaq, setExpandedFaq] = useState<number | null>(0)

  const filteredFaqs = FAQS.filter(
    (faq) =>
      faq.question.toLowerCase().includes(search.toLowerCase()) ||
      faq.answer.toLowerCase().includes(search.toLowerCase()),
  )

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">Help & Documentation</h1>
        <p className="text-muted-foreground">Learn how to use Civitas and get support</p>
      </div>

      {/* Search */}
      <div className="mb-8">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search for help..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* FAQs */}
        <div className="lg:col-span-2">
          <div className="rounded-xl border border-border bg-card">
            <div className="flex items-center gap-3 border-b border-border px-6 py-4">
              <HelpCircle className="h-5 w-5 text-muted-foreground" />
              <h2 className="font-semibold text-foreground">Frequently Asked Questions</h2>
            </div>
            <div className="divide-y divide-border">
              {filteredFaqs.map((faq: any, index: any) => (
                <div key={index} className="px-6 py-4">
                  <button
                    onClick={() => setExpandedFaq(expandedFaq === index ? null : index)}
                    className="flex w-full items-center justify-between text-left"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                        <faq.icon className="h-4 w-4 text-primary" />
                      </div>
                      <span className="font-medium text-foreground">{faq.question}</span>
                    </div>
                    {expandedFaq === index ? (
                      <ChevronUp className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    )}
                  </button>
                  {expandedFaq === index && (
                    <p className="mt-3 pl-11 text-sm text-muted-foreground leading-relaxed">{faq.answer}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Documentation */}
          <div className="rounded-xl border border-border bg-card">
            <div className="flex items-center gap-3 border-b border-border px-6 py-4">
              <Book className="h-5 w-5 text-muted-foreground" />
              <h2 className="font-semibold text-foreground">Documentation</h2>
            </div>
            <div className="p-4 space-y-1">
              {DOCS.map((doc: any, index: any) => (
                <a
                  key={index}
                  href={doc.href}
                  className="flex items-center justify-between rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                >
                  {doc.title}
                  <ExternalLink className="h-3 w-3" />
                </a>
              ))}
            </div>
          </div>

          {/* Contact */}
          <div className="rounded-xl border border-border bg-card p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <MessageSquare className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">Need more help?</h3>
                <p className="text-sm text-muted-foreground">Contact our support team</p>
              </div>
            </div>
            <Button variant="outline" className="w-full bg-transparent">
              Contact Support
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
