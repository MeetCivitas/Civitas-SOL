"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Briefcase, ExternalLink, FilePlus2, Users } from "lucide-react";
import { useCivitas } from "@/lib/civitas-provider";
import { useSolanaWallet } from "@/lib/solana-wallet";
import { buildExplorerUrl, formatUsdc, SOLANA_PAYROLL_PROGRAM, SOLANA_TREASURY_VAULT } from "@/lib/solana";
import { WalletButton } from "@/components/wallet-button";

export default function EmployerPage() {
  const { connected, address } = useSolanaWallet();
  const { company, setCompany, employees, addEmployee, payrollRuns, addPayrollRun, commitmentCount } = useCivitas();
  const [companyName, setCompanyName] = useState(company?.name ?? "");
  const [employeeName, setEmployeeName] = useState("");
  const [employeeTag, setEmployeeTag] = useState("");
  const [salary, setSalary] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  const totalPayroll = useMemo(
    () => employees.reduce((sum, employee) => sum + Number(employee.salaryAmount || 0), 0),
    [employees],
  );

  const handleSaveCompany = () => {
    if (!address || !companyName.trim()) {
      setStatus("Connect a wallet and set a company name first.");
      return;
    }
    setCompany({
      companyId: company?.companyId ?? `company-${address.slice(0, 8)}`,
      name: companyName.trim(),
      ownerAddress: address,
      escrowContract: SOLANA_TREASURY_VAULT,
    });
    setStatus("Company profile saved locally for the Solana migration shell.");
  };

  const handleAddEmployee = async () => {
    if (!employeeName.trim() || !employeeTag.trim() || !salary.trim()) {
      setStatus("Provide a contributor name, employee tag, and salary.");
      return;
    }
    await addEmployee({
      employeeTag: employeeTag.trim(),
      name: employeeName.trim(),
      salaryAmount: salary.trim(),
      salaryCurrency: "USDC",
      addedAt: new Date().toISOString(),
    });
    setEmployeeName("");
    setEmployeeTag("");
    setSalary("");
    setStatus("Contributor added to the local payroll roster.");
  };

  const handlePrepareBatch = () => {
    if (!employees.length) {
      setStatus("Add at least one contributor before preparing a batch.");
      return;
    }
    const batchId = `run-${Date.now()}`;
    addPayrollRun({
      runId: batchId,
      epoch: String(Date.now()),
      commitments: employees.map((employee, index) => `${employee.employeeTag}-${index}`),
      merkleRoot: `prepared-${batchId}`,
      totalAmount: totalPayroll.toFixed(2),
      employeeCount: employees.length,
      status: "draft",
      createdAt: new Date().toISOString(),
    });
    setStatus("Draft payroll batch prepared. Program submission is still the next integration step.");
  };

  return (
    <main className="min-h-screen bg-black px-4 py-8 text-white">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm uppercase tracking-[0.2em] text-white/45">Employer Workspace</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">Solana payroll operations</h1>
            <p className="mt-3 max-w-2xl text-sm text-white/65">
              This shell keeps private compute and roster management intact while the Solana program integration is built out.
            </p>
          </div>
          <WalletButton />
        </div>

        {!connected ? (
          <section className="rounded-3xl border border-white/10 bg-white/5 p-8">
            <h2 className="text-xl font-semibold">Connect a Solana wallet</h2>
            <p className="mt-2 max-w-xl text-sm text-white/60">
              Treasury ownership and eventual batch submission live behind the connected wallet. Install Phantom if you do not already have a wallet available.
            </p>
          </section>
        ) : null}

        <div className="grid gap-4 md:grid-cols-3">
          <article className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <Briefcase className="h-5 w-5 text-white/75" aria-hidden="true" />
            <p className="mt-4 text-sm text-white/55">Treasury vault</p>
            <a
              href={buildExplorerUrl("address", SOLANA_TREASURY_VAULT)}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-2 break-all text-sm text-white transition hover:text-white/80"
            >
              {SOLANA_TREASURY_VAULT}
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </a>
          </article>
          <article className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <Users className="h-5 w-5 text-white/75" aria-hidden="true" />
            <p className="mt-4 text-sm text-white/55">Contributors</p>
            <p className="mt-2 text-3xl font-semibold tabular-nums">{employees.length}</p>
          </article>
          <article className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <FilePlus2 className="h-5 w-5 text-white/75" aria-hidden="true" />
            <p className="mt-4 text-sm text-white/55">Prepared commitments</p>
            <p className="mt-2 text-3xl font-semibold tabular-nums">{commitmentCount}</p>
          </article>
        </div>

        <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
          <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <h2 className="text-xl font-semibold">Company profile</h2>
            <div className="mt-5 space-y-4">
              <label className="block">
                <span className="mb-2 block text-sm text-white/70">Company name</span>
                <input
                  value={companyName}
                  onChange={(event) => setCompanyName(event.target.value)}
                  className="min-h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none transition focus:border-white/30 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                  placeholder="Civitas Labs"
                  autoComplete="organization"
                />
              </label>
              <button
                type="button"
                onClick={handleSaveCompany}
                className="inline-flex min-h-11 items-center rounded-full bg-white px-5 py-3 text-sm font-medium text-black transition hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
              >
                Save profile
              </button>
              <p className="text-xs text-white/45">Planned program: {SOLANA_PAYROLL_PROGRAM}</p>
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <h2 className="text-xl font-semibold">Add contributor</h2>
            <div className="mt-5 grid gap-4 md:grid-cols-3">
              <label className="block">
                <span className="mb-2 block text-sm text-white/70">Name</span>
                <input
                  value={employeeName}
                  onChange={(event) => setEmployeeName(event.target.value)}
                  className="min-h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none transition focus:border-white/30 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                  placeholder="Alex"
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm text-white/70">Employee tag</span>
                <input
                  value={employeeTag}
                  onChange={(event) => setEmployeeTag(event.target.value)}
                  className="min-h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none transition focus:border-white/30 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                  placeholder="poseidon tag"
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm text-white/70">Salary (USDC)</span>
                <input
                  value={salary}
                  onChange={(event) => setSalary(event.target.value)}
                  className="min-h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none transition focus:border-white/30 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                  placeholder="2500"
                  inputMode="decimal"
                />
              </label>
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void handleAddEmployee()}
                className="inline-flex min-h-11 items-center rounded-full bg-white px-5 py-3 text-sm font-medium text-black transition hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
              >
                Add contributor
              </button>
              <button
                type="button"
                onClick={handlePrepareBatch}
                className="inline-flex min-h-11 items-center rounded-full border border-white/15 px-5 py-3 text-sm font-medium text-white transition hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
              >
                Prepare payroll batch
              </button>
            </div>
          </section>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_0.9fr]">
          <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xl font-semibold">Contributors</h2>
              <p className="text-sm text-white/50">Total payroll: {formatUsdc(totalPayroll)} USDC</p>
            </div>
            <div className="mt-4 space-y-3">
              {employees.length ? (
                employees.map((employee) => (
                  <div key={`${employee.employeeTag}-${employee.addedAt}`} className="rounded-2xl border border-white/10 bg-black/25 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-medium">{employee.name}</p>
                        <p className="font-mono text-xs text-white/45">{employee.employeeTag}</p>
                      </div>
                      <p className="font-mono tabular-nums text-sm text-white/70">
                        {formatUsdc(employee.salaryAmount)} {employee.salaryCurrency}
                      </p>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 p-6 text-sm text-white/55">
                  No contributors yet. Add a roster entry to start preparing batches.
                </div>
              )}
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <h2 className="text-xl font-semibold">Payroll batches</h2>
            <div className="mt-4 space-y-3">
              {payrollRuns.length ? (
                payrollRuns.map((run) => (
                  <Link
                    key={run.runId}
                    href={`/settlement/${encodeURIComponent(run.runId)}`}
                    className="block rounded-2xl border border-white/10 bg-black/25 p-4 transition hover:bg-black/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium">{run.runId}</p>
                        <p className="text-xs text-white/45">{run.employeeCount} contributors</p>
                      </div>
                      <p className="text-sm capitalize text-white/65">{run.status}</p>
                    </div>
                  </Link>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 p-6 text-sm text-white/55">
                  No payroll runs prepared yet.
                </div>
              )}
            </div>
          </section>
        </div>

        {status ? <p className="text-sm text-white/65">{status}</p> : null}
      </div>
    </main>
  );
}
