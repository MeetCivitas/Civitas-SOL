import type React from "react"
import type { Metadata } from "next"
import { Providers } from "@/components/providers"
import { GlobalNav } from "@/components/global-nav"
import "./globals.css"

export const metadata: Metadata = {
  title: "Civitas · Private Payroll on Solana",
  description: "Zero-knowledge payroll infrastructure on Solana — powered by Nillion, MagicBlock, and circom Groth16 ZK proofs.",
  generator: "v0.app",
  icons: {
    icon: [
      {
        url: "/logo-light.svg",
        type: "image/svg+xml",
      },
    ],
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning className="dark text-slate-50">
      <body className={`font-sans antialiased text-slate-50 dark:text-slate-50`}>
        <Providers>
          <GlobalNav />
          {children}
        </Providers>
      </body>
    </html>
  )
}
