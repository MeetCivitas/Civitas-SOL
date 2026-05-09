"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { CivitasCredential } from "./identity";
import {
  generateCredential,
  verifyCredential,
} from "./identity";
import {
  clearActiveCredentialTag,
  getActiveCredentialTag,
  importCredentialFromFile,
  listCredentials,
  setActiveCredentialTag,
  storeCredential,
} from "./credential-store";
import { buildExplorerUrl, formatUsdc, SOLANA_TREASURY_VAULT } from "./solana";

export type UserRole = "employer" | "employee" | "auditor" | "none";

export interface RegisteredEmployee {
  employeeTag: string;
  name: string;
  salaryAmount: string;
  salaryCurrency: string;
  addedAt: string;
}

export interface RegisteredAuditor {
  auditorTag: string;
  name?: string;
  status: "active" | "pending" | "revoked";
  grantedAt: string;
}

export interface PayrollRun {
  runId: string;
  epoch?: string;
  commitments?: string[];
  merkleRoot?: string;
  totalAmount?: string;
  employeeCount: number;
  status: "draft" | "pending" | "committed" | "settled" | string;
  createdAt: string;
  txHash?: string;
  [key: string]: unknown;
}

export interface Voucher {
  commitment?: string;
  employeeTag?: string;
  amount?: string;
  epoch?: string;
  voucherNonce?: string;
  status: "pending" | "prepared" | "claimed" | string;
  nullifier?: string;
  claimTxHash?: string;
  /** On-chain payroll_run PDA state: missing → employer hasn't committed yet. */
  runStatus?: "committed" | "missing" | "pending" | "settled" | "unknown";
  /** Pre-normalization data (raw display USDC stored where micro was expected). */
  amountIsLikelyStale?: boolean;
  [key: string]: unknown;
}

export interface CompanyProfile {
  companyId: string;
  name: string;
  ownerAddress: string;
  escrowContract: string;
  employerName?: string;
  position?: string;
  industry?: string;
  employeeCountRange?: string;
}

interface CivitasContextType {
  userRole: UserRole;
  setUserRole: (role: UserRole) => void;
  walletAddress: string | null;
  setWalletAddress: (addr: string | null) => void;
  snsDomain: string | null;
  credential: CivitasCredential | null;
  credentials: CivitasCredential[];
  createNewCredential: () => Promise<CivitasCredential>;
  importCredential: (file: File) => Promise<CivitasCredential>;
  selectCredential: (tag: string) => void;
  company: CompanyProfile | null;
  setCompany: (p: CompanyProfile | null) => void;
  isLoadingProfile: boolean;
  employees: RegisteredEmployee[];
  addEmployee: (emp: RegisteredEmployee) => Promise<void>;
  payrollRuns: PayrollRun[];
  addPayrollRun: (run: PayrollRun) => void;
  updatePayrollRun: (runId: string, updates: Partial<PayrollRun>) => void;
  auditors: RegisteredAuditor[];
  addAuditor: (a: RegisteredAuditor) => void;
  removeAuditor: (tag: string) => void;
  vouchers: Voucher[];
  addVoucher: (v: Voucher) => void;
  updateVoucher: (commitment: string, updates: Partial<Voucher>) => void;
  poolBalance: string;
  poolBalanceFormatted: string;
  merkleRoot: string;
  commitmentCount: number;
  isLoadingOnChain: boolean;
  refreshOnChainState: () => Promise<void>;
  setPoolBalance: (b: string) => void;
  setMerkleRoot: (r: string) => void;
  escrowAddress: string;
  explorerUrl: string;
}

const CivitasContext = createContext<CivitasContextType | undefined>(undefined);

export function CivitasProvider({ children }: { children: ReactNode }) {
  const [userRole, setUserRole] = useState<UserRole>("none");
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [snsDomain, setSnsDomain] = useState<string | null>(null);
  const [credential, setCredential] = useState<CivitasCredential | null>(null);
  const [credentials, setCredentials] = useState<CivitasCredential[]>([]);
  const [company, setCompanyState] = useState<CompanyProfile | null>(null);
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);
  const [employees, setEmployees] = useState<RegisteredEmployee[]>([]);
  const [payrollRuns, setPayrollRuns] = useState<PayrollRun[]>([]);
  const [auditors, setAuditors] = useState<RegisteredAuditor[]>([]);
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [poolBalance, setPoolBalance] = useState("0");
  const [poolBalanceFormatted, setPoolBalanceFormatted] = useState("0.00");
  const [merkleRoot, setMerkleRoot] = useState("pending");
  const [commitmentCount, setCommitmentCount] = useState(0);
  const [isLoadingOnChain, setIsLoadingOnChain] = useState(false);

  useEffect(() => {
    listCredentials().then((creds) => {
      setCredentials(creds);
      if (creds.length === 0) return;
      const activeTag = getActiveCredentialTag();
      const active = activeTag ? creds.find((entry) => entry.employeeTag === activeTag) : null;
      setCredential(active || creds[creds.length - 1]);
    });
  }, []);

  // ── Auto-credential: generate + store in IndexedDB on wallet connect ───
  // Uses credential-store.ts IDB (civitas_credentials) as single source of truth.
  // getOrCreateAutoCredential from identity.ts used a DIFFERENT IDB (civitas-credentials)
  // causing stale credentials to override imported ones. Fixed: always read from credential-store.
  useEffect(() => {
    if (!walletAddress || credential) return;
    listCredentials().then((stored) => {
      if (stored.length > 0) {
        // Credentials exist — pick by active tag or latest
        const activeTag = getActiveCredentialTag();
        const found = activeTag ? stored.find((c) => c.employeeTag === activeTag) : null;
        setCredential(found || stored[stored.length - 1]);
      } else {
        // Truly no credentials — generate a fresh one into credential-store IDB
        const newCred = generateCredential();
        storeCredential(newCred)
          .then(() => {
            setCredential(newCred);
            setCredentials([newCred]);
            setActiveCredentialTag(newCred.employeeTag);
          })
          .catch((err) => console.error("[CivitasProvider] auto-credential store failed:", err));
      }
    }).catch((err) => console.error("[CivitasProvider] auto-credential failed:", err));
  }, [walletAddress, credential]);

  // ── SNS resolution on wallet connect ──────────────────────────────────
  useEffect(() => {
    if (!walletAddress) { setSnsDomain(null); return; }
    let cancelled = false;

    const loadSnsDomain = async () => {
      try {
        const [{ PublicKey }, { lookupSNS }] = await Promise.all([
          import("@solana/web3.js"),
          import("./sns"),
        ]);
        const name = await lookupSNS(new PublicKey(walletAddress));
        if (!cancelled) setSnsDomain(name);
      } catch {
        if (!cancelled) setSnsDomain(null);
      }
    };

    void loadSnsDomain();

    return () => {
      cancelled = true;
    };
  }, [walletAddress]);

  // ── Trigger on-chain refresh whenever wallet connects ─────────────────
  useEffect(() => {
    if (walletAddress) {
      void refreshOnChainState();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletAddress]);

  useEffect(() => {
    if (!walletAddress) {
      setCompanyState(null);
      setEmployees([]);
      setPayrollRuns([]);
      setAuditors([]);
      setPoolBalance("0");
      setPoolBalanceFormatted("0.00");
      setMerkleRoot("pending");
      setCommitmentCount(0);
      return;
    }

    let cancelled = false;

    const hydrate = async () => {
      setIsLoadingProfile(true);
      try {
        const profileResponse = await fetch(`/api/employer/profile?address=${encodeURIComponent(walletAddress)}`);
        const profilePayload = await profileResponse.json();
        if (cancelled) return;

        if (profilePayload?.exists && profilePayload.profile) {
          const profile = profilePayload.profile;
          setCompanyState({
            companyId: profile.companyId ?? `company-${walletAddress.slice(0, 8)}`,
            name: profile.name ?? "Civitas Treasury",
            ownerAddress: profile.ownerAddress ?? walletAddress,
            escrowContract: profile.escrowContract ?? "",
            employerName: profile.employerName,
            position: profile.position,
            industry: profile.industry,
            employeeCountRange: profile.employeeCountRange,
          });
        } else {
          setCompanyState(null);
        }

        const employeesResponse = await fetch(`/api/employer/employees?address=${encodeURIComponent(walletAddress)}`);
        const employeesPayload = await employeesResponse.json();
        if (!cancelled && Array.isArray(employeesPayload?.employees)) {
          setEmployees(
            employeesPayload.employees.map((employee: Record<string, string>) => ({
              employeeTag: employee.employee_tag || "",
              name: employee.employee_name || employee.name || "Unnamed contributor",
              salaryAmount: employee.salary_amount || "0",
              salaryCurrency: employee.salary_currency || "USDC",
              addedAt: employee.created_at || new Date().toISOString(),
            })),
          );
        }

        // Hydrate payroll runs from NilDB
        try {
          const runsResponse = await fetch(`/api/employer/payrolls?address=${encodeURIComponent(walletAddress)}`);
          const runsPayload = await runsResponse.json();
          if (!cancelled && runsPayload?.success && Array.isArray(runsPayload.payrollRuns)) {
            setPayrollRuns(
              runsPayload.payrollRuns.map((run: Record<string, any>) => ({
                runId: run.runId || "",
                employeeCount: run.employeeCount || 0,
                status: run.status || "draft",
                createdAt: run.createdAt || new Date().toISOString(),
                merkleRoot: run.merkleRoot || run.payrollRoot || "",
                commitments: run.commitments || [],
                epoch: run.epoch || "",
                txHash: run.txHash || "",
                totalAmount: run.declaredTotal || "0",
              }))
            );
          }
        } catch {
          // non-fatal — payroll runs will start empty
        }

        const auditorsResponse = await fetch("/api/employer/auditors");
        const auditorsPayload = await auditorsResponse.json();
        if (!cancelled && Array.isArray(auditorsPayload?.auditors)) {
          setAuditors(
            auditorsPayload.auditors.map((auditor: Record<string, string>) => ({
              auditorTag: auditor.auditor_tag || auditor.employee_tag || "",
              name: auditor.name,
              status: (auditor.status as RegisteredAuditor["status"]) || "active",
              grantedAt: auditor.granted_at || new Date().toISOString(),
            })),
          );
        }
      } catch (error) {
        console.error("[CivitasProvider] hydration failed", error);
      } finally {
        if (!cancelled) setIsLoadingProfile(false);
      }
    };

    void hydrate();

    return () => {
      cancelled = true;
    };
  }, [walletAddress]);

  useEffect(() => {
    setPoolBalanceFormatted(formatUsdc(poolBalance));
    setCommitmentCount(payrollRuns.reduce((sum, run) => sum + (run.commitments?.length ?? 0), 0));
    setMerkleRoot(payrollRuns[0]?.merkleRoot ?? (payrollRuns.length ? "queued" : "pending"));
  }, [payrollRuns, poolBalance]);

  // ── On-chain state refresh — reads real VaultState PDA from Solana ─────
  const refreshOnChainState = useCallback(async () => {
    if (!walletAddress) return;
    setIsLoadingOnChain(true);
    try {
      const [{ PublicKey }, { getVaultState }] = await Promise.all([
        import("@solana/web3.js"),
        import("./solana-program"),
      ]);
      const ownerKey = new PublicKey(walletAddress);

      // Fetch real VaultState from Solana RPC
      const vaultState = await getVaultState(ownerKey).catch(() => null);

      if (vaultState) {
        // Pool balance from on-chain confidential vault (approximate — employer's private view)
        setPoolBalance(vaultState.usdcBalanceApprox.toString());
        setPoolBalanceFormatted(formatUsdc(vaultState.usdcBalanceApprox.toString()));
        setCommitmentCount(Number(vaultState.commitmentCount.toString()));

        // Merkle root as hex string
        const rootHex = "0x" + Buffer.from(vaultState.merkleRoot).toString("hex");
        const isZeroRoot = vaultState.merkleRoot.every((b: number) => b === 0);
        setMerkleRoot(isZeroRoot ? "pending" : rootHex);

        // SNS domain from vault state
        if (vaultState.snsDomain) setSnsDomain(vaultState.snsDomain);
      } else {
        // Fallback to local payroll run state if vault not yet initialised
        setPoolBalanceFormatted(formatUsdc(poolBalance));
        setCommitmentCount(payrollRuns.reduce((sum, run) => sum + (run.commitments?.length ?? 0), 0));
        setMerkleRoot(payrollRuns[0]?.merkleRoot ?? "pending");
      }
    } catch (err) {
      console.error("[CivitasProvider] refreshOnChainState failed:", err);
    } finally {
      setIsLoadingOnChain(false);
    }
  }, [walletAddress, payrollRuns, poolBalance]);

  const createNewCredential = useCallback(async () => {
    const next = generateCredential();
    if (!verifyCredential(next)) {
      throw new Error("Generated credential failed local verification");
    }
    await storeCredential(next);
    setCredentials((current) => [...current, next]);
    setCredential(next);
    setActiveCredentialTag(next.employeeTag);
    return next;
  }, []);

  const importCredential = useCallback(async (file: File) => {
    const imported = await importCredentialFromFile(file);
    if (!verifyCredential(imported)) {
      throw new Error("Imported credential is invalid");
    }
    await storeCredential(imported);
    setCredentials((current) => {
      const deduped = current.filter((entry) => entry.employeeTag !== imported.employeeTag);
      return [...deduped, imported];
    });
    setCredential(imported);
    setActiveCredentialTag(imported.employeeTag);
    return imported;
  }, []);

  const selectCredential = useCallback(
    (tag: string) => {
      const selected = credentials.find((entry) => entry.employeeTag === tag) ?? null;
      setCredential(selected);
      if (selected) setActiveCredentialTag(selected.employeeTag);
      else clearActiveCredentialTag();
    },
    [credentials],
  );

  const setCompany = useCallback((profile: CompanyProfile | null) => {
    setCompanyState(profile);
  }, []);

  const addEmployee = useCallback(async (employee: RegisteredEmployee) => {
    setEmployees((current) => [employee, ...current]);
  }, []);

  const addPayrollRun = useCallback((run: PayrollRun) => {
    setPayrollRuns((current) => [run, ...current]);
  }, []);

  const updatePayrollRun = useCallback((runId: string, updates: Partial<PayrollRun>) => {
    setPayrollRuns((current) =>
      current.map((run) => (run.runId === runId ? { ...run, ...updates } : run)),
    );
  }, []);

  const addAuditor = useCallback((auditor: RegisteredAuditor) => {
    setAuditors((current) => [auditor, ...current]);
  }, []);

  const removeAuditor = useCallback((tag: string) => {
    setAuditors((current) => current.filter((auditor) => auditor.auditorTag !== tag));
  }, []);

  const addVoucher = useCallback((voucher: Voucher) => {
    setVouchers((current) => {
      const exists = current.findIndex((v) => v.commitment === voucher.commitment);
      if (exists !== -1) {
        // Merge: NilDB status takes priority over stale in-memory state
        const updated = [...current];
        updated[exists] = { ...current[exists], ...voucher };
        return updated;
      }
      return [voucher, ...current];
    });
  }, []);

  const updateVoucher = useCallback((commitment: string, updates: Partial<Voucher>) => {
    setVouchers((current) =>
      current.map((voucher) =>
        voucher.commitment === commitment ? { ...voucher, ...updates } : voucher,
      ),
    );
  }, []);

  const value = useMemo<CivitasContextType>(
    () => ({
      userRole,
      setUserRole,
      walletAddress,
      setWalletAddress,
      snsDomain,
      credential,
      credentials,
      createNewCredential,
      importCredential,
      selectCredential,
      company,
      setCompany,
      isLoadingProfile,
      employees,
      addEmployee,
      payrollRuns,
      addPayrollRun,
      updatePayrollRun,
      auditors,
      addAuditor,
      removeAuditor,
      vouchers,
      addVoucher,
      updateVoucher,
      poolBalance,
      poolBalanceFormatted,
      merkleRoot,
      commitmentCount,
      isLoadingOnChain,
      refreshOnChainState,
      setPoolBalance,
      setMerkleRoot,
      escrowAddress: SOLANA_TREASURY_VAULT,
      explorerUrl: buildExplorerUrl("address", SOLANA_TREASURY_VAULT),
    }),
    [
      addAuditor,
      addEmployee,
      addPayrollRun,
      addVoucher,
      auditors,
      commitmentCount,
      company,
      createNewCredential,
      credential,
      credentials,
      employees,
      importCredential,
      isLoadingOnChain,
      isLoadingProfile,
      merkleRoot,
      payrollRuns,
      poolBalance,
      poolBalanceFormatted,
      refreshOnChainState,
      removeAuditor,
      selectCredential,
      setCompany,
      updatePayrollRun,
      updateVoucher,
      userRole,
      vouchers,
      walletAddress,
      snsDomain,
    ],
  );

  return <CivitasContext.Provider value={value}>{children}</CivitasContext.Provider>;
}

export function useCivitas() {
  const ctx = useContext(CivitasContext);
  if (!ctx) throw new Error("useCivitas must be used inside <CivitasProvider>");
  return ctx;
}
