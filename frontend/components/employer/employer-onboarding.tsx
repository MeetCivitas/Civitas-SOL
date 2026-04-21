"use client";

// components/employer/employer-onboarding.tsx
// 4-step onboarding wizard for new employers.
// Shown automatically when the employer is authenticated but has no company
// profile in NilDB. Saves data via POST /api/employer/profile.

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";

export interface EmployerProfileData {
    employerName: string;
    position: string;
    companyName: string;
    industry: string;
    employeeCountRange: string;
}

interface Props {
    ownerAddress: string;
    onComplete: (profile: EmployerProfileData & { companyId: string }) => void;
}

const INDUSTRIES = [
    "Technology", "Finance", "Healthcare", "Education",
    "Manufacturing", "Retail", "Media", "Consulting", "Other",
];

const EMPLOYEE_RANGES = [
    { label: "1–10 employees", value: "1-10" },
    { label: "10–20 employees", value: "10-20" },
    { label: "20–50 employees", value: "20-50" },
    { label: "50–500 employees", value: "50-500" },
    { label: "500+ employees", value: "500+" },
];

const STEPS = [
    { id: 1, title: "Your Info", emoji: "👤" },
    { id: 2, title: "Company", emoji: "🏢" },
    { id: 3, title: "Team Size", emoji: "👥" },
    { id: 4, title: "Review", emoji: "✅" },
];

export function EmployerOnboarding({ ownerAddress, onComplete }: Props) {
    const [step, setStep] = useState(1);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");

    const [form, setForm] = useState<EmployerProfileData>({
        employerName: "",
        position: "",
        companyName: "",
        industry: "",
        employeeCountRange: "",
    });

    const update = (key: keyof EmployerProfileData, value: string) =>
        setForm((p) => ({ ...p, [key]: value }));

    const canNextStep = () => {
        if (step === 1) return form.employerName.trim().length > 0 && form.position.trim().length > 0;
        if (step === 2) return form.companyName.trim().length > 0;
        if (step === 3) return form.employeeCountRange.length > 0;
        return true;
    };

    const handleSubmit = useCallback(async () => {
        setSaving(true);
        setError("");
        try {
            const res = await fetch("/api/employer/profile", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ownerAddress, ...form }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Failed to save profile");
            onComplete({ ...form, companyId: data.profile?.companyId || "" });
        } catch (err: any) {
            setError(err.message || "Something went wrong");
        } finally {
            setSaving(false);
        }
    }, [ownerAddress, form, onComplete]);

    return (
        // Full-screen backdrop
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
            <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 30 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ type: "spring", damping: 20, stiffness: 280 }}
                className="w-full max-w-lg rounded-3xl border border-white/10 bg-[#08080f] shadow-[0_0_80px_rgba(168,85,247,0.2)] overflow-hidden"
            >
                {/* Header */}
                <div className="bg-gradient-to-r from-purple-600/20 via-blue-600/10 to-transparent border-b border-white/5 px-8 py-6">
                    <div className="flex items-center gap-3 mb-1">
                        <div className="h-10 w-10 rounded-xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center text-xl">
                            🏛️
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-white">Welcome to Civitas</h2>
                            <p className="text-xs text-white/40">Set up your employer profile to get started</p>
                        </div>
                    </div>

                    {/* Step indicators */}
                    <div className="flex items-center gap-2 mt-5">
                        {STEPS.map((s, i) => (
                            <div key={s.id} className="flex items-center gap-2">
                                <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${step > s.id
                                        ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                                        : step === s.id
                                            ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                                            : "bg-white/5 text-white/30 border border-white/10"
                                    }`}>
                                    <span>{step > s.id ? "✓" : s.emoji}</span>
                                    <span className="hidden sm:inline">{s.title}</span>
                                </div>
                                {i < STEPS.length - 1 && (
                                    <div className={`h-px w-4 ${step > s.id ? "bg-emerald-500/50" : "bg-white/10"}`} />
                                )}
                            </div>
                        ))}
                    </div>
                </div>

                {/* Body */}
                <div className="px-8 py-7 min-h-[280px]">
                    <AnimatePresence mode="wait">
                        {/* Step 1 — Your info */}
                        {step === 1 && (
                            <motion.div key="s1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-5">
                                <div>
                                    <h3 className="text-base font-semibold text-white mb-4">Tell us about yourself</h3>
                                    <div className="space-y-4">
                                        <div>
                                            <label className="text-xs font-semibold uppercase tracking-wider text-white/40 block mb-1.5">Your Full Name</label>
                                            <input
                                                autoFocus
                                                type="text"
                                                value={form.employerName}
                                                onChange={(e) => update("employerName", e.target.value)}
                                                placeholder="e.g. Jane Doe"
                                                className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-white/25 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/30 transition-all"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-xs font-semibold uppercase tracking-wider text-white/40 block mb-1.5">Your Position / Role</label>
                                            <input
                                                type="text"
                                                value={form.position}
                                                onChange={(e) => update("position", e.target.value)}
                                                placeholder="e.g. Head of Finance, CEO"
                                                className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-white/25 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/30 transition-all"
                                            />
                                        </div>
                                    </div>
                                </div>
                            </motion.div>
                        )}

                        {/* Step 2 — Company */}
                        {step === 2 && (
                            <motion.div key="s2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
                                <h3 className="text-base font-semibold text-white mb-4">Company details</h3>
                                <div>
                                    <label className="text-xs font-semibold uppercase tracking-wider text-white/40 block mb-1.5">Company Name</label>
                                    <input
                                        autoFocus
                                        type="text"
                                        value={form.companyName}
                                        onChange={(e) => update("companyName", e.target.value)}
                                        placeholder="e.g. Acme Corp"
                                        className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-white/25 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/30 transition-all"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs font-semibold uppercase tracking-wider text-white/40 block mb-1.5">Industry</label>
                                    <div className="grid grid-cols-3 gap-2">
                                        {INDUSTRIES.map((ind) => (
                                            <button
                                                key={ind}
                                                onClick={() => update("industry", ind)}
                                                className={`px-3 py-2 rounded-xl text-sm font-medium border transition-all ${form.industry === ind
                                                        ? "bg-purple-500/20 border-purple-500/40 text-purple-300"
                                                        : "bg-white/5 border-white/10 text-white/50 hover:bg-white/10 hover:text-white/80"
                                                    }`}
                                            >
                                                {ind}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </motion.div>
                        )}

                        {/* Step 3 — Team Size */}
                        {step === 3 && (
                            <motion.div key="s3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
                                <h3 className="text-base font-semibold text-white mb-4">How large is your team?</h3>
                                <div className="space-y-3">
                                    {EMPLOYEE_RANGES.map((r) => (
                                        <button
                                            key={r.value}
                                            onClick={() => update("employeeCountRange", r.value)}
                                            className={`w-full px-5 py-4 rounded-xl border text-left font-medium transition-all flex items-center justify-between ${form.employeeCountRange === r.value
                                                    ? "bg-purple-500/20 border-purple-500/40 text-white shadow-[0_0_20px_rgba(168,85,247,0.15)]"
                                                    : "bg-white/5 border-white/10 text-white/60 hover:bg-white/10 hover:text-white/80"
                                                }`}
                                        >
                                            <span>{r.label}</span>
                                            {form.employeeCountRange === r.value && <span className="text-purple-400">✓</span>}
                                        </button>
                                    ))}
                                </div>
                            </motion.div>
                        )}

                        {/* Step 4 — Review */}
                        {step === 4 && (
                            <motion.div key="s4" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
                                <h3 className="text-base font-semibold text-white mb-4">Review your profile</h3>
                                <div className="rounded-2xl border border-white/10 bg-white/[0.03] divide-y divide-white/5 overflow-hidden">
                                    {[
                                        { label: "Name", value: form.employerName },
                                        { label: "Position", value: form.position },
                                        { label: "Company", value: form.companyName },
                                        { label: "Industry", value: form.industry || "—" },
                                        { label: "Team Size", value: EMPLOYEE_RANGES.find(r => r.value === form.employeeCountRange)?.label || "—" },
                                    ].map((row) => (
                                        <div key={row.label} className="flex items-center justify-between px-5 py-3">
                                            <span className="text-sm text-white/40">{row.label}</span>
                                            <span className="text-sm font-medium text-white">{row.value}</span>
                                        </div>
                                    ))}
                                </div>
                                {error && (
                                    <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2">{error}</p>
                                )}
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                {/* Footer nav */}
                <div className="px-8 pb-7 flex items-center justify-between gap-3">
                    {step > 1 ? (
                        <button
                            onClick={() => setStep(s => s - 1)}
                            className="px-5 py-2.5 rounded-xl text-sm font-medium text-white/60 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 transition-all"
                        >
                            ← Back
                        </button>
                    ) : <div />}

                    {step < 4 ? (
                        <button
                            onClick={() => setStep(s => s + 1)}
                            disabled={!canNextStep()}
                            className="flex-1 max-w-[200px] px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-[0_0_20px_rgba(168,85,247,0.25)]"
                        >
                            Continue →
                        </button>
                    ) : (
                        <button
                            onClick={handleSubmit}
                            disabled={saving}
                            className="flex-1 max-w-[200px] px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-50 transition-all shadow-[0_0_20px_rgba(16,185,129,0.25)]"
                        >
                            {saving ? "Saving…" : "Complete Setup ✓"}
                        </button>
                    )}
                </div>
            </motion.div>
        </div>
    );
}
