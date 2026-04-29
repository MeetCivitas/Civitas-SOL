import type React from "react"
import type { Metadata } from "next"
import { Providers } from "@/components/providers"
import { GlobalNav } from "@/components/global-nav"
import "./globals.css"

export const metadata: Metadata = {
  title: " Civitas Privacy-First Payroll",
  description: "Zero-knowledge payroll infrastructure for the modern workforce",
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
