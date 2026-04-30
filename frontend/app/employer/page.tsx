"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  AlertCircle,
  Briefcase,
  CheckCircle2,
  Coins,
  CreditCard,
  ExternalLink,
  FileText,
  Layers,
  Lock,
  Plus,
  Send,
  ShieldCheck,
  Users,
  Wallet,
} from "lucide-react";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import { EmployerOnboarding, type EmployerProfileData } from "@/components/employer/employer-onboarding";
import { WalletButton } from "@/components/wallet-button";
import { useCivitas, type CompanyProfile } from "@/lib/civitas-provider";
import {
  buildExplorerUrl,
  formatUsdc,
  shortenAddress,
  SOLANA_CLUSTER_LABEL,
  SOLANA_PAYROLL_PROGRAM,
  USDC_MINT_ADDRESS,
} from "@/lib/solana";
import { useInitializeVault } from "@/lib/use-initialize-vault";
import { useSolanaWallet } from "@/lib/solana-wallet";

type ActiveTab = "overview" | "employees" | "payroll" | "treasury" | "auditors";

async function persistEmployerProfile(payload: {
  ownerAddress: string;
  employerName: string;
  position: string;
  companyName: string;
  industry: string;
  employeeCountRange: string;
  escrowContract?: string;
}) {
  const res = await fetch("/api/employer/profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Failed to save employer profile");
  return data;
}

export default function EmployerDashboard() {
  const router = useRouter();
  const { address, connected, signAndSendTransaction } = useSolanaWallet();
  const {
    company,
    setCompany,
    employees,
    addEmployee,
    payrollRuns,
    auditors,
    poolBalanceFormatted,
    merkleRoot,
    commitmentCount,
    isLoadingProfile,
    refreshOnChainState,
  } = useCivitas();
  const {
    status: vaultStatus,
    vaultPda,
    error: vaultError,
    initialize,
  } = useInitializeVault(address, connected ? signAndSendTransaction : null);

  const [activeTab, setActiveTab] = useState<ActiveTab>("overview");
  const [newTag, setNewTag] = useState("");
  const [newName, setNewName] = useState("");
  const [newSalary, setNewSalary] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [txStatus, setTxStatus] = useState("");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [depositAmount, setDepositAmount] = useState("");
  const [newAuditorTag, setNewAuditorTag] = useState("");
  const [dbAuditors, setDbAuditors] = useState<any[]>([]);
  const [auditorLoading, setAuditorLoading] = useState(false);

  const activeVaultAddress = company?.escrowContract || vaultPda || null;

  useEffect(() => {
    if (connected && address && !company && !isLoadingProfile) {
      setShowOnboarding(true);
    }
  }, [address, company, connected, isLoadingProfile]);

  const loadAuditors = useCallback(async () => {
    setAuditorLoading(true);
    try {
      const res = await fetch("/api/employer/auditors");
      const data = await res.json();
      if (data.success) {
        setDbAuditors((data.auditors || []).filter((auditor: any) => auditor.status !== "terminated"));
      }
    } catch (err) {
      console.error("Failed to load auditors:", err);
    } finally {
      setAuditorLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "auditors") void loadAuditors();
  }, [activeTab, loadAuditors]);

  const syncProfileWithVault = useCallback(
    async (profile: EmployerProfileData & { companyId: string }, escrowContract: string) => {
      if (!address) return;

      await persistEmployerProfile({
        ownerAddress: address,
        employerName: profile.employerName,
        position: profile.position,
        companyName: profile.companyName,
        industry: profile.industry,
        employeeCountRange: profile.employeeCountRange,
        escrowContract,
      });

      setCompany({
        companyId: profile.companyId,
        name: profile.companyName,
        ownerAddress: address,
        escrowContract,
        employerName: profile.employerName,
        position: profile.position,
        industry: profile.industry,
        employeeCountRange: profile.employeeCountRange,
      } as CompanyProfile);
    },
    [address, setCompany],
  );

  const handleCompleteOnboarding = useCallback(
    async (profile: EmployerProfileData & { companyId: string }) => {
      if (!address) return;

      setIsProcessing(true);
      setTxHash(null);
      setTxStatus("Finalizing employer setup...");

      try {
        let escrowContract = vaultPda || company?.escrowContract || "";

        if (vaultStatus === "ready" || vaultStatus === "error") {
          setTxStatus("Initializing the Solana treasury vault...");
          await initialize();
          escrowContract = vaultPda || escrowContract;
        } else if (vaultStatus === "exists" || vaultStatus === "success") {
          setTxStatus("Linking the existing Solana treasury vault...");
          escrowContract = vaultPda || escrowContract;
        }

        if (!escrowContract) throw new Error("Treasury vault address could not be resolved.");

        setTxStatus("Saving employer profile to NilDB...");
        await syncProfileWithVault(profile, escrowContract);
        await refreshOnChainState();
        setShowOnboarding(false);
        setTxStatus("Employer onboarding complete.");
      } catch (error) {
        setTxStatus(error instanceof Error ? error.message : "Failed to finish employer setup");
      } finally {
        setIsProcessing(false);
      }
    },
    [address, company?.escrowContract, initialize, refreshOnChainState, syncProfileWithVault, vaultPda, vaultStatus],
  );

  const handleSetupCompany = useCallback(async () => {
    if (!companyName.trim()) return;
    if (!address) {
      setTxStatus("Connect a Solana wallet first.");
      return;
    }

    const profile = {
      companyId: `company-${address.slice(0, 8)}`,
      name: companyName.trim(),
      ownerAddress: address,
      escrowContract: activeVaultAddress || "",
    } as CompanyProfile;

    setCompany(profile);
    setTxStatus("Company profile created for the Solana workspace.");

    try {
      await persistEmployerProfile({
        ownerAddress: address,
        employerName: "",
        position: "",
        companyName: companyName.trim(),
        industry: "",
        employeeCountRange: "",
        escrowContract: activeVaultAddress || "",
      });
    } catch (error) {
      console.error("[employer] quick profile persist failed", error);
    }
  }, [activeVaultAddress, address, companyName, setCompany]);

  const handleAddEmployee = useCallback(async () => {
    if (!newName.trim() || !newTag.trim() || !newSalary.trim()) {
      setTxStatus("Please fill in name, tag, and salary.");
      return;
    }
    if (!address) {
      setTxStatus("Connect a Solana wallet before adding employees.");
      return;
    }

    const tag = newTag.trim();
    if (!/^[a-zA-Z0-9_\-.:@]+$/.test(tag)) {
      setTxStatus("Employee tag must be alphanumeric (letters, numbers, _, -, ., :, @).");
      return;
    }

    setIsProcessing(true);
    setTxStatus("Saving employee to NilDB...");

    try {
      const res = await fetch("/api/employer/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerAddress: address,
          employeeTag: tag,
          employeeName: newName.trim(),
          salaryAmount: newSalary.trim(),
          salaryCurrency: "USDC",
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to save employee");

      const saved = data?.employee || {};
      await addEmployee({
        employeeTag: saved.employee_tag || tag,
        name: saved.employee_name || newName.trim(),
        salaryAmount: saved.salary_amount || newSalary.trim(),
        salaryCurrency: saved.salary_currency || "USDC",
        addedAt: saved.created_at || new Date().toISOString(),
      });

      setNewTag("");
      setNewName("");
      setNewSalary("");
      setTxStatus("Employee added and saved to NilDB.");
    } catch (error) {
      setTxStatus(error instanceof Error ? error.message : "Failed to save employee");
    } finally {
      setIsProcessing(false);
    }
  }, [addEmployee, address, newName, newSalary, newTag]);

  const handleInitializeVault = useCallback(async () => {
    if (!address) {
      setTxStatus("Connect a Solana wallet first.");
      return;
    }

    setIsProcessing(true);
    setTxHash(null);
    setTxStatus("Preparing Solana vault transaction...");

    try {
      // Call /api/vault/init directly so we bypass the stale hook status guard
      // (hook may still show "exists" right after vault close)
      const resp = await fetch("/api/vault/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerAddress: address, snsDomain: null }),
      });
      const data = await resp.json().catch(() => ({}));
      console.log("[handleInitializeVault] API response:", resp.status, data);

      if (!resp.ok) {
        if (resp.status === 409 && data?.alreadyExists) {
          setTxStatus("Vault already initialized on-chain.");
          await refreshOnChainState();
          return;
        }
        throw new Error(data?.error ?? `Server error ${resp.status}`);
      }
      if (!data.serializedTransaction) throw new Error("No transaction returned from vault/init");

      setTxStatus("Sign the vault initialization transaction in your wallet...");
      const sig = await signAndSendTransaction(data.serializedTransaction);
      setTxHash(sig);
      setTxStatus("Treasury vault initialized successfully.");
      await refreshOnChainState();
    } catch (error: any) {
      const logs: string[] = error?.logs ?? error?.transactionError?.logs ?? [];
      const logsStr = logs.length ? `\nLogs:\n${logs.join("\n")}` : "";
      const msg = (error?.message ?? String(error)) + logsStr;
      console.error("[handleInitializeVault] FULL ERROR:", error);
      setTxStatus(`Vault initialization failed: ${msg}`);
    } finally {
      setIsProcessing(false);
    }
  }, [address, refreshOnChainState, signAndSendTransaction]);

  const handleCloseVault = useCallback(async () => {
    if (!address) { setTxStatus("Connect a Solana wallet first."); return; }
    setIsProcessing(true);
    setTxHash(null);
    setTxStatus("Building vault reset transaction...");
    try {
      const res = await fetch("/api/vault/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerAddress: address }),
      });
      const data = await res.json().catch(() => ({}));
      console.log("[vault/close] response:", data);
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setTxStatus("Sign the vault reset transaction in your wallet...");
      const signature = await signAndSendTransaction(data.serializedTransaction);
      setTxHash(signature);
      setTxStatus("Vault reset. Click Initialize Vault to set up with the correct USDC mint.");
      await refreshOnChainState();
    } catch (error: any) {
      const logs: string[] = error?.logs ?? [];
      const logsStr = logs.length ? `\nLogs:\n${logs.join("\n")}` : "";
      const msg = (error?.message ?? String(error)) + logsStr;
      console.error("[vault/close] FULL ERROR:", error);
      setTxStatus(`Vault reset failed: ${msg}`);
    } finally {
      setIsProcessing(false);
    }
  }, [address, refreshOnChainState, signAndSendTransaction]);

  const handleDeposit = useCallback(async () => {
    if (!address) {
      setTxStatus("Connect a Solana wallet first.");
      return;
    }

    const amountUsdc = depositAmount && Number(depositAmount) > 0 ? Number(depositAmount) : 10_000;

    setIsProcessing(true);
    setTxHash(null);
    setTxStatus(`Minting ${amountUsdc.toLocaleString()} test USDC to vault…`);

    try {
      // /api/vault/fund mints test USDC server-side (deployer keypair is mint authority).
      // No client signing required — returns a confirmed tx signature.
      const res = await fetch("/api/vault/fund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerAddress: address, amountUsdc }),
      });
      const data = await res.json().catch(() => ({}));
      console.log("[vault/fund] response:", data);
      if (!res.ok) {
        const msg = data?.error || `HTTP ${res.status}`;
        console.error("[vault/fund] error:", msg, data);
        throw new Error(msg);
      }

      console.log("[vault/fund] confirmed, sig:", data.signature, "vault:", data.vaultUsdcAccount);
      setTxHash(data.signature);
      setDepositAmount("");
      setTxStatus(`Vault funded: ${amountUsdc.toLocaleString()} USDC minted to treasury.`);
      await refreshOnChainState();
    } catch (error: any) {
      const logs: string[] = error?.logs ?? error?.transactionError?.logs ?? [];
      const logsStr = logs.length ? `\nLogs:\n${logs.join("\n")}` : "";
      const msg = (error?.message ?? String(error)) + logsStr;
      console.error("[vault/fund] FULL ERROR:", error);
      if (logs.length) console.error("[vault/fund] program logs:", logs);
      setTxStatus(`Treasury fund failed: ${msg}`);
    } finally {
      setIsProcessing(false);
    }
  }, [address, depositAmount, refreshOnChainState, signAndSendTransaction]);

  const handleAddAuditor = useCallback(async () => {
    if (!newAuditorTag.trim()) return;

    setTxStatus("Registering auditor...");
    try {
      const res = await fetch("/api/employer/auditors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auditor_tag: newAuditorTag.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to register auditor");
      setNewAuditorTag("");
      setTxStatus("Auditor access granted.");
      await loadAuditors();
    } catch (error: any) {
      setTxStatus(error.message || "Failed to register auditor.");
    }
  }, [loadAuditors, newAuditorTag]);

  const handleRevokeAuditor = useCallback(
    async (tag: string) => {
      setTxStatus("Revoking auditor access...");
      try {
        const res = await fetch(`/api/employer/auditors?tag=${encodeURIComponent(tag)}`, { method: "DELETE" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to revoke auditor");
        setTxStatus("Auditor access revoked.");
        await loadAuditors();
      } catch (error: any) {
        setTxStatus(error.message || "Failed to revoke auditor.");
      }
    },
    [loadAuditors],
  );

  const navItems = [
    { id: "overview", label: "Overview", icon: Activity },
    { id: "employees", label: "Employees", icon: Users },
    { id: "payroll", label: "Payroll Runs", icon: FileText },
    { id: "treasury", label: "Treasury", icon: Wallet },
    { id: "auditors", label: "Auditors", icon: ShieldCheck },
  ] as const;

  const hasStatus = txStatus || vaultError;
  const isStatusError = Boolean(vaultError) || /failed|required|connect|valid|error/i.test(txStatus);

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[#030303] pb-20 text-white selection:bg-blue-500/30 selection:text-white">
      <div className="fixed inset-0 z-0 pointer-events-none">
        <video autoPlay loop muted playsInline className="h-full w-full object-cover opacity-30 mix-blend-screen">
          <source src="/videos/Animated_Privacy_Video_Element.mp4" type="video/mp4" />
        </video>
        <div className="absolute inset-0 bg-black/70 backdrop-blur-[2px]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,transparent_0%,#030303_70%)]" />
      </div>

      {showOnboarding && address ? (
        <EmployerOnboarding ownerAddress={address} onComplete={(profile) => void handleCompleteOnboarding(profile)} />
      ) : null}

      <header className="sticky top-0 z-50 border-b border-white/[0.04] bg-[#030303]/60 backdrop-blur-2xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <div className="flex items-center gap-5">
            <Link href="/" className="group flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.06] text-sm font-bold text-white transition-all duration-300 group-hover:border-blue-500/30">
                C
              </div>
              <div className="flex items-center gap-3">
                <span className="text-lg font-semibold tracking-tight text-white/90">Civitas</span>
                <span className="hidden rounded-md border border-blue-500/20 bg-blue-500/10 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.2em] text-blue-400 sm:inline-block">
                  Solana Node
                </span>
              </div>
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/40 sm:flex">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
              {SOLANA_CLUSTER_LABEL}
            </div>
            <div className="hidden h-4 w-px bg-white/[0.06] sm:block" />
            <WalletButton />
          </div>
        </div>
      </header>

      <div className="relative z-10 mx-auto mt-8 flex max-w-7xl flex-col gap-8 px-6 md:flex-row">
        <aside className="w-full shrink-0 md:w-56">
          <div className="sticky top-24 rounded-2xl border border-white/[0.05] bg-white/[0.02] p-3 backdrop-blur-xl">
            <div className="space-y-0.5">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveTab(item.id)}
                    className={`relative flex min-h-10 w-full items-center gap-3 rounded-xl px-4 py-2.5 text-[13px] font-medium transition-all duration-300 ${
                      isActive ? "text-white" : "text-white/40 hover:bg-white/[0.03] hover:text-white/70"
                    }`}
                  >
                    {isActive ? (
                      <motion.div
                        layoutId="activeNavPill"
                        className="absolute inset-0 rounded-xl border border-white/[0.08] bg-white/[0.06] shadow-[0_0_20px_rgba(59,130,246,0.08)]"
                        transition={{ type: "spring", bounce: 0.2, duration: 0.5 }}
                      />
                    ) : null}
                    <Icon className={`relative z-10 h-4 w-4 transition-colors duration-300 ${isActive ? "text-blue-400" : ""}`} />
                    <span className="relative z-10">{item.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="mt-6 border-t border-white/[0.05] px-2 pt-5">
              <button
                type="button"
                onClick={() => router.push("/employer/payrolls/create")}
                className="flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-blue-600/90 py-2.5 text-xs font-bold uppercase tracking-widest text-white shadow-[0_0_20px_rgba(37,99,235,0.25)] transition-all hover:bg-blue-500 hover:shadow-[0_0_30px_rgba(37,99,235,0.4)] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300/60"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" /> New Payroll
              </button>
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          {hasStatus ? (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              className={`mb-6 flex items-center gap-3 rounded-xl border p-4 backdrop-blur-xl ${
                isStatusError
                  ? "border-red-500/20 bg-red-500/10 text-red-100"
                  : "border-emerald-500/20 bg-emerald-500/10 text-emerald-100"
              }`}
            >
              {isStatusError ? (
                <AlertCircle className="h-5 w-5 shrink-0 text-red-400" aria-hidden="true" />
              ) : (
                <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" aria-hidden="true" />
              )}
              <div className="flex-1 min-w-0 overflow-auto">
                <p className="whitespace-pre-wrap break-all text-sm font-medium">{vaultError || txStatus}</p>
                {txHash ? (
                  <a
                    href={buildExplorerUrl("tx", txHash)}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-flex items-center gap-1 text-xs opacity-70 underline underline-offset-2 hover:opacity-100"
                  >
                    View on Solana Explorer <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  </a>
                ) : null}
              </div>
            </motion.div>
          ) : null}

          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            >
              {activeTab === "overview" ? (
                <div className="space-y-8">
                  <div>
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.25em] text-white/30">Command Center</p>
                    <h1 className="text-3xl font-light tracking-tight text-white">Dashboard Overview</h1>
                  </div>

                  {!company ? (
                    <div className="relative max-w-md overflow-hidden rounded-3xl border border-white/[0.06] bg-white/[0.03] p-8 shadow-[0_0_40px_rgba(0,0,0,0.5)] backdrop-blur-2xl">
                      <div className="absolute right-0 top-0 h-40 w-40 rounded-full bg-purple-500/10 blur-[60px] pointer-events-none" />
                      <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-2xl border border-purple-500/20 bg-purple-500/10">
                        <Briefcase className="h-6 w-6 text-purple-400" aria-hidden="true" />
                      </div>
                      <h2 className="mb-2 text-2xl font-light">Setup Your Company</h2>
                      <p className="mb-6 text-sm font-light text-white/40">
                        Complete your employer profile to start managing zk payrolls on Solana.
                      </p>
                      <button
                        type="button"
                        onClick={() => setShowOnboarding(true)}
                        className="mb-3 min-h-11 w-full rounded-xl bg-purple-600 py-3.5 text-xs font-bold uppercase tracking-widest text-white shadow-[0_0_20px_rgba(168,85,247,0.25)] transition-all hover:bg-purple-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-300/60"
                      >
                        Start Onboarding Wizard
                      </button>
                      <div className="relative my-3 flex items-center">
                        <div className="flex-1 border-t border-white/[0.06]" />
                        <span className="px-3 text-[10px] font-bold uppercase tracking-widest text-white/20">or quick setup</span>
                        <div className="flex-1 border-t border-white/[0.06]" />
                      </div>
                      <label htmlFor="company-name" className="sr-only">
                        Company name
                      </label>
                      <input
                        id="company-name"
                        type="text"
                        placeholder="e.g. Acme Corp"
                        value={companyName}
                        onChange={(event) => setCompanyName(event.target.value)}
                        autoComplete="organization"
                        className="mb-3 min-h-11 w-full rounded-xl border border-white/[0.08] bg-black/50 px-4 py-3 text-sm text-white placeholder:text-white/20 transition-all focus:border-blue-500/50 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => void handleSetupCompany()}
                        className="min-h-11 w-full rounded-xl border border-white/[0.06] bg-white/[0.05] py-3 text-xs font-medium uppercase tracking-widest text-white/50 transition-colors hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
                      >
                        Quick Create
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-8">
                      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                        <GlowCard label="Company" value={company.name} icon={<Briefcase className="h-4 w-4" />} color="purple" />
                        <GlowCard label="Employees" value={employees.length.toString()} icon={<Users className="h-4 w-4" />} color="blue" />
                        <GlowCard label="Payroll Runs" value={payrollRuns.length.toString()} icon={<FileText className="h-4 w-4" />} color="teal" />
                        <GlowCard label="Treasury" value={`${poolBalanceFormatted} USDC`} icon={<Coins className="h-4 w-4" />} color="emerald" highlight />
                      </div>

                      <div>
                        <p className="mb-4 text-[10px] font-bold uppercase tracking-[0.25em] text-white/30">On-Chain State</p>
                        <div className="grid gap-3 md:grid-cols-2">
                          <StatePanel
                            color="blue"
                            icon={<Layers className="h-4 w-4 text-blue-400" />}
                            label="Global Merkle Root"
                            value={merkleRoot || "Empty tree"}
                            detail="Secures all employee voucher commitments cryptographically."
                          />
                          <StatePanel
                            color="purple"
                            icon={<ShieldCheck className="h-4 w-4 text-purple-400" />}
                            label="On-Chain Commitments"
                            value={commitmentCount.toString()}
                            detail={`${SOLANA_CLUSTER_LABEL} vault status: ${vaultStatus}`}
                            large
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : null}

              {activeTab === "employees" ? (
                <div className="space-y-6">
                  <div>
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.25em] text-white/30">Identity Registry</p>
                    <h1 className="text-3xl font-light tracking-tight text-white">Employee Roster</h1>
                  </div>

                  <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6 backdrop-blur-xl">
                    <div className="mb-2 flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10">
                        <Plus className="h-4 w-4 text-blue-400" aria-hidden="true" />
                      </div>
                      <h3 className="text-sm font-bold uppercase tracking-widest text-white/70">Register Employee</h3>
                    </div>
                    <p className="mb-5 ml-11 text-xs text-white/30">
                      Add the Poseidon hash generated by their local identity wallet.
                    </p>

                    <div className="ml-0 flex flex-col gap-3 sm:ml-11 sm:flex-row">
                      <input
                        type="text"
                        placeholder="Employee Name"
                        value={newName}
                        onChange={(event) => setNewName(event.target.value)}
                        autoComplete="name"
                        className="min-h-11 flex-1 rounded-xl border border-white/[0.08] bg-black/50 px-4 py-3 text-sm text-white placeholder:text-white/20 transition-colors focus:border-blue-500/40 focus:outline-none"
                      />
                      <input
                        type="text"
                        placeholder="Unique employee tag (e.g. emp_alice)"
                        value={newTag}
                        onChange={(event) => setNewTag(event.target.value)}
                        autoComplete="off"
                        className="min-h-11 flex-1 rounded-xl border border-white/[0.08] bg-black/50 px-4 py-3 font-mono text-sm text-white placeholder:text-white/20 transition-colors focus:border-blue-500/40 focus:outline-none"
                      />
                      <input
                        type="number"
                        placeholder="Base USDC Salary"
                        value={newSalary}
                        onChange={(event) => setNewSalary(event.target.value)}
                        min="0"
                        step="0.01"
                        inputMode="decimal"
                        className="min-h-11 w-full rounded-xl border border-white/[0.08] bg-black/50 px-4 py-3 text-sm text-white placeholder:text-white/20 transition-colors focus:border-blue-500/40 focus:outline-none sm:w-48"
                      />
                      <button
                        type="button"
                        onClick={() => void handleAddEmployee()}
                        disabled={isProcessing}
                        className="min-h-11 whitespace-nowrap rounded-xl bg-blue-600 px-8 py-3 text-xs font-bold uppercase tracking-widest text-white shadow-[0_0_15px_rgba(59,130,246,0.2)] transition-all hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300/60"
                      >
                        Add to Roster
                      </button>
                    </div>
                  </div>

                  {employees.length > 0 ? (
                    <div className="space-y-2">
                      {employees.map((emp, index) => (
                        <div
                          key={`${emp.employeeTag}-${emp.addedAt}`}
                          className="group flex items-center justify-between rounded-xl border border-white/[0.05] bg-white/[0.02] p-4 backdrop-blur-xl transition-all duration-300 hover:border-white/[0.1] hover:bg-white/[0.03]"
                        >
                          <div className="flex items-center gap-4">
                            <AvatarInitials name={emp.name || `Employee ${index + 1}`} color="#3B82F6" size="sm" />
                            <div>
                              <p className="text-sm font-medium text-white/90">{emp.name || `Employee ${index + 1}`}</p>
                              <p className="mt-0.5 font-mono text-[10px] text-white/30">
                                {emp.employeeTag.slice(0, 12)}...{emp.employeeTag.slice(-6)}
                              </p>
                            </div>
                          </div>
                          <span className="inline-flex items-center rounded-lg border border-emerald-500/15 bg-emerald-500/10 px-3 py-1.5 text-xs font-bold text-emerald-400">
                            {formatUsdc(emp.salaryAmount)} {emp.salaryCurrency || "USDC"}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.06] p-16 text-center backdrop-blur-xl">
                      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-white/[0.03]">
                        <Users className="h-7 w-7 text-white/15" aria-hidden="true" />
                      </div>
                      <h3 className="mb-1 text-lg font-medium text-white">No employees onboarded</h3>
                      <p className="max-w-sm text-sm text-white/40">
                        Register employees using their zero-knowledge identity hashes to begin paying them securely.
                      </p>
                    </div>
                  )}
                </div>
              ) : null}

              {activeTab === "payroll" ? (
                <div className="space-y-6">
                  <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                    <div>
                      <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.25em] text-white/30">ZK Proof Ledger</p>
                      <h1 className="text-3xl font-light tracking-tight text-white">Payroll History</h1>
                    </div>
                    <button
                      type="button"
                      onClick={() => router.push("/employer/payrolls/create")}
                      className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-600/90 px-6 py-3 text-xs font-bold uppercase tracking-widest text-white shadow-[0_0_20px_rgba(37,99,235,0.25)] transition-all hover:bg-blue-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300/60"
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Run Payroll
                    </button>
                  </div>

                  {payrollRuns.length > 0 ? (
                    <div className="space-y-3">
                      {payrollRuns.slice().reverse().map((run) => (
                        <Link
                          key={run.runId}
                          href={`/employer/payrolls/${run.runId}`}
                          className="group block rounded-2xl border border-white/[0.05] bg-white/[0.02] p-6 backdrop-blur-xl transition-all duration-300 hover:border-white/[0.1] hover:bg-white/[0.03] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300/50"
                        >
                          <div className="mb-5 flex items-start justify-between gap-4">
                            <div className="flex items-center gap-3">
                              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-500/10">
                                <FileText className="h-4 w-4 text-teal-400" aria-hidden="true" />
                              </div>
                              <div>
                                <h3 className="text-sm font-semibold tracking-tight text-white">{run.runId}</h3>
                                <p className="mt-0.5 text-[10px] text-white/30">{new Date(run.createdAt).toLocaleString()}</p>
                              </div>
                            </div>
                            <span className="flex items-center gap-1.5 rounded-lg border border-emerald-500/15 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-emerald-400">
                              <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> {run.status}
                            </span>
                          </div>

                          <div className="mb-5 grid grid-cols-3 gap-6 border-b border-white/[0.04] pb-5">
                            <div>
                              <p className="mb-1 text-[10px] uppercase tracking-widest text-white/30">Recipients</p>
                              <p className="text-lg font-light text-white">{run.employeeCount}</p>
                            </div>
                            <div>
                              <p className="mb-1 text-[10px] uppercase tracking-widest text-white/30">Total Dispensed</p>
                              <p className="text-lg font-light text-teal-400">{formatUsdc(String(run.totalAmount ?? "0"))} USDC</p>
                            </div>
                            <div>
                              <p className="mb-1 text-[10px] uppercase tracking-widest text-white/30">Encrypted Proofs</p>
                              <p className="text-lg font-light text-purple-400">{run.commitments?.length ?? 0}</p>
                            </div>
                          </div>

                          <div className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-2 text-white/30">
                              <span className="text-[10px] font-bold uppercase tracking-widest">Root:</span>
                              <code className="rounded-md border border-white/[0.06] bg-black/40 px-2 py-1 font-mono text-[10px] text-white/50">
                                {run.merkleRoot ? `${run.merkleRoot.slice(0, 16)}...${run.merkleRoot.slice(-8)}` : "pending"}
                              </code>
                            </div>
                            {run.txHash ? (
                              <span className="flex items-center gap-1.5 rounded-lg bg-white/[0.03] px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/50 transition-colors group-hover:bg-white/[0.06] group-hover:text-white">
                                Explorer <ExternalLink className="h-3 w-3" aria-hidden="true" />
                              </span>
                            ) : null}
                          </div>
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.06] bg-white/[0.02] p-16 text-center backdrop-blur-xl">
                      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-blue-500/10">
                        <Send className="h-7 w-7 translate-x-0.5 text-blue-400" aria-hidden="true" />
                      </div>
                      <h3 className="mb-2 text-lg font-light text-white">Ready for first run</h3>
                      <p className="mb-6 max-w-sm text-xs text-white/30">
                        Create zero-knowledge verifiable payroll distributions securely on Solana.
                      </p>
                      <button
                        type="button"
                        onClick={() => router.push("/employer/payrolls/create")}
                        className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-600/90 px-6 py-3 text-xs font-bold uppercase tracking-widest text-white shadow-[0_0_15px_rgba(37,99,235,0.2)] transition-all hover:bg-blue-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300/60"
                      >
                        <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Start Wizard
                      </button>
                    </div>
                  )}
                </div>
              ) : null}

              {activeTab === "treasury" ? (
                <div className="mx-auto max-w-xl space-y-6 py-4">
                  <div className="mb-6 text-center">
                    <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-emerald-500/20 bg-emerald-500/10">
                      <Wallet className="h-7 w-7 text-emerald-400" aria-hidden="true" />
                    </div>
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.25em] text-white/30">Treasury Operations</p>
                    <h1 className="text-3xl font-light tracking-tight text-white">Solana Vault</h1>
                  </div>

                  <div className="relative overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02] p-8 backdrop-blur-2xl">
                    <div className="absolute right-0 top-0 h-60 w-60 rounded-full bg-emerald-500/5 blur-[80px] pointer-events-none" />

                  <div className="relative z-10 flex flex-col gap-6">
                      <div>
                        <label htmlFor="treasury-deposit" className="mb-3 block text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">
                          Amount to mint (devnet — leave blank for 10,000)
                        </label>
                        <div className="relative">
                          <input
                            id="treasury-deposit"
                            type="number"
                            min="0"
                            step="1"
                            inputMode="numeric"
                            placeholder="10000"
                            value={depositAmount}
                            onChange={(event) => setDepositAmount(event.target.value)}
                            className="min-h-14 w-full rounded-xl border border-white/[0.08] bg-black/50 px-5 py-5 pr-20 text-3xl font-light text-white placeholder:text-white/15 transition-all focus:border-emerald-500/40 focus:outline-none"
                          />
                          <div className="absolute right-5 top-1/2 -translate-y-1/2 text-xs font-bold uppercase tracking-widest text-emerald-500">
                            USDC
                          </div>
                        </div>
                      </div>

                      <div className="rounded-xl border border-white/[0.04] bg-black/30 p-4 text-xs">
                        <div className="flex items-center justify-between gap-4 text-white/40">
                          <span className="flex items-center gap-2">
                            <CreditCard className="h-3.5 w-3.5" aria-hidden="true" /> Current Balance
                          </span>
                          <span className="font-bold text-white/80">{poolBalanceFormatted} USDC</span>
                        </div>
                        <div className="my-3 h-px w-full bg-white/[0.04]" />
                        <div className="flex items-center justify-between gap-4 text-white/40">
                          <span className="flex items-center gap-2">
                            <Lock className="h-3.5 w-3.5" aria-hidden="true" /> Vault
                          </span>
                          <span className="rounded bg-white/[0.03] px-2 py-1 font-mono text-[10px] text-white/50">
                            {activeVaultAddress ? shortenAddress(activeVaultAddress, 6) : "Not initialized"}
                          </span>
                        </div>
                        <div className="my-3 h-px w-full bg-white/[0.04]" />
                        <div className="flex items-center justify-between gap-4 text-white/40">
                          <span>Program</span>
                          <a
                            href={buildExplorerUrl("address", SOLANA_PAYROLL_PROGRAM)}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded bg-white/[0.03] px-2 py-1 font-mono text-[10px] text-white/50 transition hover:text-white"
                          >
                            {shortenAddress(SOLANA_PAYROLL_PROGRAM, 6)}
                            <ExternalLink className="h-3 w-3" aria-hidden="true" />
                          </a>
                        </div>
                        <div className="my-3 h-px w-full bg-white/[0.04]" />
                        <div className="flex items-center justify-between gap-4 text-white/40">
                          <span>Token-2022 Mint</span>
                          <a
                            href={buildExplorerUrl("address", USDC_MINT_ADDRESS)}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded bg-white/[0.03] px-2 py-1 font-mono text-[10px] text-white/50 transition hover:text-white"
                          >
                            {shortenAddress(USDC_MINT_ADDRESS, 6)}
                            <ExternalLink className="h-3 w-3" aria-hidden="true" />
                          </a>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => void handleInitializeVault()}
                        disabled={isProcessing}
                        className="mt-2 min-h-12 w-full rounded-xl bg-emerald-500 py-4 text-xs font-bold uppercase tracking-widest text-black transition-all hover:bg-emerald-400 hover:shadow-[0_0_25px_rgba(16,185,129,0.3)] disabled:cursor-not-allowed disabled:opacity-40 disabled:grayscale focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/70"
                      >
                        {isProcessing ? "Processing..." : "Initialize Vault"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleCloseVault()}
                        disabled={isProcessing}
                        className="min-h-12 w-full rounded-xl border border-orange-500/30 bg-orange-500/10 py-4 text-xs font-bold uppercase tracking-widest text-orange-400 transition-all hover:bg-orange-500/20 disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/70"
                      >
                        {isProcessing ? "Processing..." : "Close & Reset Vault (Devnet)"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeposit()}
                        disabled={isProcessing || vaultStatus === "ready" || vaultStatus === "idle" || vaultStatus === "checking"}
                        className="min-h-12 w-full rounded-xl bg-blue-600 py-4 text-xs font-bold uppercase tracking-widest text-white transition-all hover:bg-blue-500 hover:shadow-[0_0_25px_rgba(37,99,235,0.3)] disabled:cursor-not-allowed disabled:opacity-40 disabled:grayscale focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300/70"
                      >
                        {isProcessing ? "Minting..." : "Fund Treasury (Devnet)"}
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          setTxStatus("Funding MagicBlock ER (mint legacy USDC + deposit)…");
                          try {
                            const r = await fetch("/api/payroll/fund-magicblock", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ amountBaseUnits: "100000000", mintFirst: true }),
                            });
                            const j = await r.json();
                            if (!r.ok) throw new Error(j?.error || "fund-magicblock failed");
                            const sig = String(j.depositSig);
                            const url = `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
                            setTxStatus(
                              `MagicBlock funded ✓ — deployer ${String(j.employer).slice(0, 6)}…${String(j.employer).slice(-4)} now has ER balance. Deposit tx: ${sig} (${url})`,
                            );
                          } catch (e) {
                            const msg = e instanceof Error ? e.message : String(e);
                            setTxStatus(`MagicBlock funding error: ${msg}`);
                          }
                        }}
                        className="min-h-12 w-full rounded-xl bg-fuchsia-600 py-4 text-xs font-bold uppercase tracking-widest text-white transition-all hover:bg-fuchsia-500 hover:shadow-[0_0_25px_rgba(217,70,239,0.3)] focus:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-300/70"
                      >
                        Pre-fund MagicBlock ER (Private Settlement)
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}

              {activeTab === "auditors" ? (
                <div className="space-y-6">
                  <div>
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.25em] text-white/30">Compliance Layer</p>
                    <h1 className="text-3xl font-light tracking-tight text-white">Auditor Access</h1>
                  </div>

                  <div className="relative overflow-hidden rounded-2xl border border-teal-500/10 bg-white/[0.02] p-6 backdrop-blur-xl">
                    <div className="absolute left-0 top-0 h-40 w-40 rounded-full bg-teal-500/5 blur-[60px] pointer-events-none" />
                    <div className="relative z-10 flex items-start gap-4">
                      <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-500/10">
                        <ShieldCheck className="h-4 w-4 text-teal-400" aria-hidden="true" />
                      </div>
                      <div className="flex-1">
                        <h3 className="mb-1 text-sm font-bold uppercase tracking-widest text-white/70">Grant Protocol Access</h3>
                        <p className="mb-5 max-w-2xl text-xs leading-relaxed text-white/30">
                          Auditors can verify selected payroll metadata without exposing individual employee identities or raw payments.
                        </p>
                        <div className="flex flex-col gap-3 sm:flex-row">
                          <input
                            type="text"
                            placeholder="Auditor Public Tag"
                            value={newAuditorTag}
                            onChange={(event) => setNewAuditorTag(event.target.value)}
                            autoComplete="off"
                            className="min-h-11 max-w-md flex-1 rounded-xl border border-teal-500/20 bg-black/50 px-4 py-3 font-mono text-sm text-white placeholder:text-white/20 transition-colors focus:border-teal-400/50 focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => void handleAddAuditor()}
                            className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-teal-500 px-6 py-3 text-xs font-bold uppercase tracking-widest text-black shadow-[0_0_15px_rgba(20,184,166,0.2)] transition-all hover:bg-teal-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-300/70"
                          >
                            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Grant Key
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {auditorLoading ? (
                    <div className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-white/[0.06] p-10 text-xs font-bold uppercase tracking-widest text-white/30 backdrop-blur-xl">
                      <Activity className="h-4 w-4 animate-pulse" aria-hidden="true" /> Loading auditors...
                    </div>
                  ) : dbAuditors.length > 0 || auditors.length > 0 ? (
                    <div className="space-y-2">
                      {(dbAuditors.length ? dbAuditors : auditors).map((auditor: any) => {
                        const tag = auditor.employee_tag || auditor.auditorTag || "";
                        const name = auditor.profile?.name || auditor.name || auditor.username || "Auditor";
                        const createdAt = auditor.created_at || auditor.grantedAt || new Date().toISOString();
                        const status = auditor.status || "active";

                        return (
                          <div
                            key={`${tag}-${createdAt}`}
                            className="group flex items-center justify-between rounded-xl border border-white/[0.05] bg-white/[0.02] p-4 backdrop-blur-xl transition-all duration-300 hover:border-white/[0.1] hover:bg-white/[0.03]"
                          >
                            <div className="flex items-center gap-4">
                              <AvatarInitials name={name} color="#14b8a6" size="sm" />
                              <div>
                                <p className="text-sm font-medium text-white">{name}</p>
                                <code className="font-mono text-[10px] text-white/40">
                                  {tag ? `${tag.slice(0, 12)}...${tag.slice(-4)}` : "pending tag"}
                                </code>
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="inline-flex items-center gap-1.5 rounded-lg border border-teal-500/15 bg-teal-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-teal-400">
                                <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                                {status.toUpperCase()}
                              </span>
                              <span className="font-mono text-[10px] text-white/30">{new Date(createdAt).toLocaleDateString()}</span>
                              {tag ? (
                                <button
                                  type="button"
                                  onClick={() => void handleRevokeAuditor(tag)}
                                  className="min-h-10 rounded-lg border border-transparent bg-red-500/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-red-400 transition-colors hover:border-red-500/20 hover:bg-red-500/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300/50"
                                >
                                  Revoke
                                </button>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center rounded-2xl border border-dashed border-white/[0.06] p-10 text-xs font-bold uppercase tracking-widest text-white/30 backdrop-blur-xl">
                      No auditor keys granted yet.
                    </div>
                  )}
                </div>
              ) : null}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}

const colorMap: Record<string, { bg: string; border: string; text: string; glow: string }> = {
  purple: { bg: "bg-purple-500/10", border: "border-purple-500/15", text: "text-purple-400", glow: "bg-purple-500/5" },
  blue: { bg: "bg-blue-500/10", border: "border-blue-500/15", text: "text-blue-400", glow: "bg-blue-500/5" },
  teal: { bg: "bg-teal-500/10", border: "border-teal-500/15", text: "text-teal-400", glow: "bg-teal-500/5" },
  emerald: { bg: "bg-emerald-500/10", border: "border-emerald-500/15", text: "text-emerald-400", glow: "bg-emerald-500/5" },
};

function GlowCard({
  label,
  value,
  icon,
  color = "blue",
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  color?: string;
  highlight?: boolean;
}) {
  const c = colorMap[color] || colorMap.blue;
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-white/[0.05] bg-white/[0.02] p-5 backdrop-blur-xl transition-all duration-500 hover:border-white/[0.1] hover:bg-white/[0.03]">
      <div className={`absolute right-0 top-0 h-32 w-32 ${c.glow} rounded-full opacity-50 blur-[50px] transition-all duration-700 group-hover:opacity-100 pointer-events-none`} />
      <div className="relative z-10 mb-3 flex items-center gap-3">
        <div className={`flex h-7 w-7 items-center justify-center rounded-lg ${c.bg}`}>
          <div className={c.text}>{icon}</div>
        </div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-white/40">{label}</p>
      </div>
      <p className="relative z-10 text-xl font-light tracking-tight text-white transition-transform duration-300 group-hover:translate-x-0.5">
        {value.length > 25 ? `${value.slice(0, 12)}...${value.slice(-6)}` : value}
      </p>
    </div>
  );
}

function StatePanel({
  color,
  icon,
  label,
  value,
  detail,
  large,
}: {
  color: "blue" | "purple";
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
  large?: boolean;
}) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6 backdrop-blur-xl transition-all duration-500 hover:border-white/[0.1]">
      <div className={`absolute right-0 top-0 h-40 w-40 ${color === "blue" ? "bg-blue-500/5 group-hover:bg-blue-500/10" : "bg-purple-500/5 group-hover:bg-purple-500/10"} rounded-full blur-[60px] transition-all duration-700 pointer-events-none`} />
      <div className="mb-4 flex items-center gap-3">
        <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${color === "blue" ? "bg-blue-500/10" : "bg-purple-500/10"}`}>
          {icon}
        </div>
        <p className="text-xs font-bold uppercase tracking-widest text-white/40">{label}</p>
      </div>
      <p className={large ? "text-4xl font-light tracking-tight text-white" : "break-all font-mono text-sm leading-relaxed text-white/80"}>
        {value}
      </p>
      <div className="mt-4 border-t border-white/[0.04] pt-4">
        <p className="text-[10px] uppercase tracking-widest text-white/30">{detail}</p>
      </div>
    </div>
  );
}
