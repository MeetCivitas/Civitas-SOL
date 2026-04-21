"use client";

// lib/auth-context.tsx
// Backward-compatibility shim — auth now handled by CivitasProvider wallet connect.
// These re-exports allow legacy components to keep compiling.

import { createContext, useContext, type ReactNode } from "react";
import { useCivitas, type UserRole } from "./civitas-provider";

// ── useAuth shim ────────────────────────────────────────────────────────

export function useAuth() {
    const ctx = useCivitas();
    return {
        user: ctx.walletAddress
            ? { id: ctx.walletAddress, address: ctx.walletAddress, name: ctx.walletAddress.slice(0, 10) + "…", email: "" }
            : null,
        role: ctx.userRole as UserRole,
        isAuthenticated: !!ctx.walletAddress,
        login: async (_email: string, _password: string) => ({ id: "wallet", role: ctx.userRole, address: ctx.walletAddress }),
        register: async (_name: string, _email: string, _password: string, _role: string) => ({ id: "wallet", role: ctx.userRole }),
        refresh: async () => ctx.walletAddress ? ({ id: "wallet", role: ctx.userRole, address: ctx.walletAddress }) : null,
        logout: () => {
            ctx.setWalletAddress(null);
            ctx.setUserRole("none");
        },
        employee_tag: ctx.credential?.employeeTag || null,
    };
}

// ── AuthProvider shim ───────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
    return <>{children}</>;
}

export { type UserRole };
