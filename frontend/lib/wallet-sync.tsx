"use client"

import { useEffect } from "react"
import { useSolanaWallet } from "./solana-wallet"
import { useCivitas } from "./civitas-provider"

export function WalletSync({ children }: { children: React.ReactNode }) {
    const { address } = useSolanaWallet()
    const { setWalletAddress } = useCivitas()

    useEffect(() => {
        setWalletAddress(address ?? null)
    }, [address, setWalletAddress])

    return <>{children}</>
}
