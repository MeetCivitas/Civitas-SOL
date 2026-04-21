"use client"

import type { ReactNode } from "react"
import { ThemeProvider } from "next-themes"
import { CivitasProvider } from "@/lib/civitas-provider"
import { AuthProvider } from "@/lib/auth-context"
import { MockStoreProvider } from "@/lib/mock-store"
import { SolanaWalletProvider } from "@/lib/solana-wallet"
import { WalletSync } from "@/lib/wallet-sync"

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SolanaWalletProvider>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
        <CivitasProvider>
          <WalletSync>
            <MockStoreProvider>
              <AuthProvider>{children}</AuthProvider>
            </MockStoreProvider>
          </WalletSync>
        </CivitasProvider>
      </ThemeProvider>
    </SolanaWalletProvider>
  )
}
