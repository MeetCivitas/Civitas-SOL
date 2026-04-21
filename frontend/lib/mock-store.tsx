"use client";

// lib/mock-store.tsx
// Backward-compatibility shim — all state now lives in CivitasProvider
// These re-exports allow legacy components to keep compiling.

import { createContext, useContext, type ReactNode } from "react";
import { useCivitas, type PayrollRun, type Voucher } from "./civitas-provider";

// ── Re-export types used by legacy components ───────────────────────────

export type Note = Voucher;

export interface Auditor {
    id?: string;
    auditorId?: string;
    name: string;
    email: string;
    pubkeyFingerprint?: string;
    status: "active" | "inactive" | "pending";
    [key: string]: any;
}

// ── useMockStore shim ───────────────────────────────────────────────────

export function useMockStore(): Record<string, any> {
    const ctx = useCivitas();
    return {
        // Employer
        employees: ctx.employees,
        payrollRuns: ctx.payrollRuns,
        addPayrollRun: ctx.addPayrollRun,
        updatePayrollRun: ctx.updatePayrollRun,
        addEmployee: ctx.addEmployee,
        company: ctx.company,

        // Employee
        vouchers: ctx.vouchers,
        notes: ctx.vouchers,
        addNote: ctx.addVoucher,
        updateNote: (id: string, updates: any) => ctx.updateVoucher(id, updates),

        // Auditor — wired to CivitasProvider
        auditors: ctx.auditors,
        addAuditor: ctx.addAuditor,
        removeAuditor: ctx.removeAuditor,
    };
}

// ── MockStoreProvider shim ──────────────────────────────────────────────

export function MockStoreProvider({ children }: { children: ReactNode }) {
    return <>{children}</>;
}

export { type PayrollRun };
