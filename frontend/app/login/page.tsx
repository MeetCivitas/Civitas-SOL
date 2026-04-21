"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Briefcase,
  ShieldCheck,
  UserCircle,
  Upload,
  KeyRound,
  CheckCircle2,
  Loader2,
  AlertCircle,
  FileJson,
} from "lucide-react";
import { useCivitas } from "@/lib/civitas-provider";
import { useSolanaWallet } from "@/lib/solana-wallet";
import { WalletButton } from "@/components/wallet-button";
import {
  signEmployerIn,
  getEmployerSession,
} from "@/lib/use-employer-session";

export default function LoginPage() {
  const router = useRouter();
  const { connected, address, signMessage } = useSolanaWallet();
  const { credential, importCredential, setUserRole, setWalletAddress } = useCivitas();
  const [role, setRole] = useState<"employer" | "employee" | "auditor">("employer");
  const [error, setError] = useState<string | null>(null);

  // ── Employer state ──────────────────────────────────────────────────────
  const [signInState, setSignInState] = useState<"idle" | "signing" | "signed">("idle");
  const [hasExistingSession, setHasExistingSession] = useState(false);

  // ── Employee / Auditor state ────────────────────────────────────────────
  const [importing, setImporting] = useState(false);
  const [importedTag, setImportedTag] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const subtitle = useMemo(() => {
    if (role === "employer") return "Connect your Solana wallet, then sign a gasless message to authorize your session.";
    if (role === "auditor") return "Load your auditor credential to inspect payout batches and attestation history.";
    return "Upload your keyfile backup to access your private payouts — no password needed.";
  }, [role]);

  // Restore employer session on wallet connect
  useEffect(() => {
    if (connected && address && role === "employer") {
      const session = getEmployerSession(address);
      if (session) {
        setHasExistingSession(true);
        setSignInState("signed");
      } else {
        setHasExistingSession(false);
        setSignInState("idle");
      }
    } else {
      setSignInState("idle");
      setHasExistingSession(false);
    }
  }, [connected, address, role]);

  // Restore imported tag from active credential on mount
  useEffect(() => {
    if (credential && (role === "employee" || role === "auditor")) {
      setImportedTag(credential.employeeTag);
    }
  }, [credential, role]);

  // ── Handlers ────────────────────────────────────────────────────────────

  const handleRoleChange = (newRole: typeof role) => {
    setRole(newRole);
    setError(null);
    setImportedTag(null);
    setSignInState("idle");
  };

  const handleCredentialUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = "";
    setError(null);
    setImporting(true);
    try {
      const imported = await importCredential(file);
      setImportedTag(imported.employeeTag);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Failed to read credential file. Make sure it's a valid Civitas keyfile.");
    } finally {
      setImporting(false);
    }
  };

  const handleCredentialContinue = () => {
    if (!importedTag) {
      setError("Please upload your credential keyfile first.");
      return;
    }
    setUserRole(role);
    setWalletAddress(address ?? null);
    if (role === "auditor") router.push("/auditors");
    else router.push("/employees");
  };

  // Gasless sign-in for employer
  const handleSignIn = async () => {
    if (!address) { setError("Connect a Solana wallet first."); return; }
    setSignInState("signing");
    setError(null);
    try {
      await signEmployerIn(address, signMessage);
      setSignInState("signed");
      setHasExistingSession(false);
    } catch (e: any) {
      setSignInState("idle");
      setError(e?.message ?? "Sign-in was cancelled. Please try again.");
    }
  };

  const handleEmployerContinue = () => {
    if (!connected || !address) { setError("Connect a Solana wallet first."); return; }
    if (signInState !== "signed") { setError("Please authorize your sign-in first."); return; }
    setWalletAddress(address);
    setUserRole("employer");
    router.push("/employer");
  };

  return (
    <main className="min-h-screen bg-black px-4 py-12 text-white">
      <div className="mx-auto max-w-5xl">
        <Link
          href="/"
          className="inline-flex min-h-10 items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-sm text-white/70 transition hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back
        </Link>

        <div className="mt-10 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-3xl border border-white/10 bg-white/5 p-8">
            <p className="text-sm uppercase tracking-[0.2em] text-white/50">Portal Access</p>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight">Sign in to Civitas</h1>
            <p className="mt-4 max-w-2xl text-base text-white/65">{subtitle}</p>

            {/* Role selector */}
            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              {[
                { id: "employer", label: "Employer", icon: Briefcase },
                { id: "employee", label: "Employee", icon: UserCircle },
                { id: "auditor", label: "Auditor", icon: ShieldCheck },
              ].map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => handleRoleChange(id as typeof role)}
                  className={`flex min-h-12 items-center gap-3 rounded-2xl border px-4 py-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black ${
                    role === id
                      ? "border-white/30 bg-white/10 text-white"
                      : "border-white/10 bg-black/20 text-white/65 hover:bg-white/5"
                  }`}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  <span>{label}</span>
                </button>
              ))}
            </div>

            {/* ── EMPLOYER FLOW ── */}
            {role === "employer" && (
              <div className="mt-8 rounded-2xl border border-white/10 bg-black/30 p-6 space-y-6">

                {/* Step 1: Connect wallet */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2.5">
                    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold border transition-all ${connected ? "bg-emerald-500 border-emerald-500 text-black" : "bg-white/5 border-white/15 text-white/50"}`}>
                      {connected ? <CheckCircle2 className="h-3.5 w-3.5" /> : "1"}
                    </span>
                    <p className="text-sm font-semibold text-white/80">Connect Wallet</p>
                  </div>
                  <div className="pl-8">
                    <WalletButton />
                    {connected && address && (
                      <p className="mt-2 font-mono text-xs text-white/40 break-all">{address}</p>
                    )}
                  </div>
                </div>

                {/* Step 2: Gasless sign-in */}
                {connected && (
                  <div className="space-y-3 border-t border-white/[0.07] pt-5">
                    <div className="flex items-center gap-2.5">
                      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold border transition-all ${signInState === "signed" ? "bg-emerald-500 border-emerald-500 text-black" : "bg-amber-500/20 border-amber-500/40 text-amber-300"}`}>
                        {signInState === "signed" ? <CheckCircle2 className="h-3.5 w-3.5" /> : "2"}
                      </span>
                      <p className="text-sm font-semibold text-white/80">Authorize Sign-In</p>
                      {hasExistingSession && (
                        <span className="rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-[10px] text-emerald-400 font-bold uppercase tracking-wider">Session active</span>
                      )}
                    </div>

                    <div className="pl-8 space-y-3">
                      {signInState !== "signed" ? (
                        <>
                          <div className="rounded-xl bg-black/50 border border-white/[0.08] px-4 py-3 font-mono text-xs text-white/40 leading-relaxed">
                            <p className="text-white/20 mb-1 text-[9px] uppercase tracking-widest">Gasless message — 0 SOL cost</p>
                            <p className="text-white/60">Statement: I authorize access to Civitas Protocol as an Employer.</p>
                          </div>
                          <button
                            type="button"
                            onClick={handleSignIn}
                            disabled={signInState === "signing"}
                            className="inline-flex min-h-10 items-center gap-2 rounded-full bg-white px-5 py-2 text-sm font-medium text-black transition hover:bg-white/90 disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                          >
                            {signInState === "signing" ? (
                              <><Loader2 className="h-4 w-4 animate-spin" /> Waiting for wallet...</>
                            ) : (
                              <><KeyRound className="h-4 w-4" /> Authorize Sign-In</>
                            )}
                          </button>
                        </>
                      ) : (
                        <div className="flex items-center gap-2 text-sm text-emerald-400">
                          <CheckCircle2 className="h-4 w-4" />
                          <span>{hasExistingSession ? "Existing session restored — no re-sign needed." : "Signed in successfully."}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Continue */}
                {connected && (
                  <div className="border-t border-white/[0.07] pt-5 pl-8">
                    <button
                      type="button"
                      onClick={handleEmployerContinue}
                      disabled={!connected || signInState !== "signed"}
                      className="inline-flex min-h-10 items-center rounded-full bg-white px-5 py-2 text-sm font-medium text-black transition hover:bg-white/90 disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                    >
                      Enter Employer Dashboard →
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* ── EMPLOYEE / AUDITOR FLOW ── */}
            {(role === "employee" || role === "auditor") && (
              <div className="mt-8 rounded-2xl border border-white/10 bg-black/30 p-6 space-y-5">
                <p className="text-sm text-white/60">
                  Upload your <strong className="text-white">Civitas keyfile</strong> (.json) to restore your private identity.
                  Your credential nonce never leaves your device.
                </p>

                {/* Upload area */}
                {!importedTag ? (
                  <label
                    className={`group flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-10 text-center cursor-pointer transition-all
                      ${importing
                        ? "border-white/20 bg-white/5 pointer-events-none"
                        : "border-white/15 bg-black/20 hover:border-white/30 hover:bg-white/5"
                      }`}
                  >
                    {importing ? (
                      <>
                        <Loader2 className="h-8 w-8 text-white/40 animate-spin" />
                        <p className="text-sm text-white/50">Reading keyfile...</p>
                      </>
                    ) : (
                      <>
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/5 border border-white/10 group-hover:bg-white/10 transition-all">
                          <FileJson className="h-6 w-6 text-white/50" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-white">Click to upload keyfile</p>
                          <p className="mt-1 text-xs text-white/40">civitas-credential.json or civitas-auditor-credential.json</p>
                        </div>
                        <div className="flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-xs text-white/60 hover:text-white hover:border-white/30 transition-all">
                          <Upload className="h-3.5 w-3.5" />
                          Browse files
                        </div>
                      </>
                    )}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="application/json,.json"
                      className="sr-only"
                      onChange={handleCredentialUpload}
                      disabled={importing}
                    />
                  </label>
                ) : (
                  /* Credential loaded successfully */
                  <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                      <p className="text-sm font-medium text-emerald-300">Credential loaded successfully</p>
                    </div>
                    <div className="pl-6">
                      <p className="text-[10px] uppercase tracking-widest text-white/30 mb-1">
                        {role === "auditor" ? "Auditor Tag" : "Employee Tag"}
                      </p>
                      <p className="font-mono text-xs text-white/70 break-all">{importedTag}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => { setImportedTag(null); setError(null); }}
                      className="pl-6 text-xs text-white/40 hover:text-white/70 transition-colors underline underline-offset-2"
                    >
                      Use a different keyfile
                    </button>
                  </div>
                )}

                {/* Continue button */}
                <button
                  type="button"
                  onClick={handleCredentialContinue}
                  disabled={!importedTag || importing}
                  className="w-full inline-flex min-h-11 items-center justify-center rounded-2xl bg-white px-5 py-3 text-sm font-medium text-black transition hover:bg-white/90 disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                >
                  {importing ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading...</>
                  ) : importedTag ? (
                    <>Enter {role === "auditor" ? "Auditor" : "Employee"} Dashboard →</>
                  ) : (
                    "Upload keyfile to continue"
                  )}
                </button>
              </div>
            )}

            {/* Error message */}
            {error && (
              <div className="mt-4 flex items-start gap-2 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3">
                <AlertCircle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
                <p className="text-sm text-rose-300">{error}</p>
              </div>
            )}

            {/* Register link */}
            <p className="mt-6 text-xs text-white/35 text-center">
              No credential yet?{" "}
              <Link href="/register" className="text-white/60 hover:text-white underline underline-offset-2 transition-colors">
                Create one on the register page
              </Link>
            </p>
          </section>

          {/* Info sidebar */}
          <aside className="rounded-3xl border border-white/10 bg-gradient-to-br from-white/8 to-white/0 p-8">
            <p className="text-sm uppercase tracking-[0.2em] text-white/45">Security Model</p>
            <ul className="mt-6 space-y-5 text-sm text-white/70">
              <li className="flex gap-3">
                <span className="mt-0.5 shrink-0 h-4 w-4 rounded-full border border-white/20 bg-white/5 flex items-center justify-center text-[9px] font-bold text-white/40">1</span>
                <span>Employer sessions use a <strong className="text-white">gasless wallet signature</strong>. No passwords, no custodial auth.</span>
              </li>
              <li className="flex gap-3">
                <span className="mt-0.5 shrink-0 h-4 w-4 rounded-full border border-white/20 bg-white/5 flex items-center justify-center text-[9px] font-bold text-white/40">2</span>
                <span>Sessions last <strong className="text-white">24 hours</strong>. You won't be asked to sign again within that window.</span>
              </li>
              <li className="flex gap-3">
                <span className="mt-0.5 shrink-0 h-4 w-4 rounded-full border border-white/20 bg-white/5 flex items-center justify-center text-[9px] font-bold text-white/40">3</span>
                <span>Employee credentials are verified locally — your <strong className="text-white">private nonce never leaves your device</strong>.</span>
              </li>
              <li className="flex gap-3">
                <span className="mt-0.5 shrink-0 h-4 w-4 rounded-full border border-white/20 bg-white/5 flex items-center justify-center text-[9px] font-bold text-white/40">4</span>
                <span>If you registered on this device, your last credential may be <strong className="text-white">auto-restored</strong> — just click the role and continue.</span>
              </li>
            </ul>
          </aside>
        </div>
      </div>
    </main>
  );
}
