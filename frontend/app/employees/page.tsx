"use client";

import { useState } from "react";
import { CheckCircle2, FileUp, Wallet } from "lucide-react";
import { useCivitas } from "@/lib/civitas-provider";
import { useSolanaWallet } from "@/lib/solana-wallet";
import { WalletButton } from "@/components/wallet-button";
import { buildExplorerUrl, shortenAddress } from "@/lib/solana";

export default function EmployeesPage() {
  const { connected, address } = useSolanaWallet();
  const {
    credential,
    createNewCredential,
    importCredential,
    vouchers,
    addVoucher,
    updateVoucher,
  } = useCivitas();
  const [status, setStatus] = useState<string | null>(null);

  const myVouchers = credential
    ? vouchers.filter((voucher) => voucher.employeeTag === credential.employeeTag)
    : [];

  const handleCreateCredential = async () => {
    const next = await createNewCredential();
    setStatus(`New credential created for tag ${next.employeeTag.slice(0, 12)}...`);
  };

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = "";
    const imported = await importCredential(file);
    setStatus(`Imported credential ${imported.employeeTag.slice(0, 12)}...`);
  };

  const handlePrepareClaim = async () => {
    if (!credential) {
      setStatus("Create or import a credential first.");
      return;
    }

    if (!myVouchers.length) {
      const commitment = `${credential.employeeTag}-sample`;
      addVoucher({
        employeeTag: credential.employeeTag,
        commitment,
        amount: "2500",
        epoch: String(Date.now()),
        voucherNonce: "1",
        status: "pending",
      });
      setStatus("Sample voucher added so the Solana claim flow can be demonstrated.");
      return;
    }

    const target = myVouchers[0];
    const response = await fetch("/api/employees/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        employee_tag: target.employeeTag,
        commitment: target.commitment,
        amount: target.amount,
        epoch: target.epoch,
        voucher_nonce: target.voucherNonce,
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setStatus(payload.error || "Failed to prepare claim");
      return;
    }
    updateVoucher(String(target.commitment), { status: "prepared", claimTxHash: payload.redemption?.reference });
    setStatus("Claim prepared for Solana settlement. Program execution is still a placeholder.");
  };

  return (
    <main className="min-h-screen bg-black px-4 py-8 text-white">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm uppercase tracking-[0.2em] text-white/45">Employee Workspace</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">Private payout access</h1>
            <p className="mt-3 max-w-2xl text-sm text-white/65">
              Use a local credential for private identity and a Solana wallet for the eventual settlement path.
            </p>
          </div>
          <WalletButton />
        </div>

        <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
          <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <h2 className="text-xl font-semibold">Credential</h2>
            <div className="mt-4 space-y-4">
              {credential ? (
                <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
                  <p className="text-sm text-white/55">Active employee tag</p>
                  <p className="mt-2 break-all font-mono text-sm text-white">{credential.employeeTag}</p>
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 p-6 text-sm text-white/55">
                  No credential loaded yet.
                </div>
              )}

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => void handleCreateCredential()}
                  className="inline-flex min-h-11 items-center rounded-full bg-white px-5 py-3 text-sm font-medium text-black transition hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                >
                  Create credential
                </button>
                <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-white/15 px-5 py-3 text-sm font-medium text-white transition hover:bg-white/5 focus-within:ring-2 focus-within:ring-white focus-within:ring-offset-2 focus-within:ring-offset-black">
                  <FileUp className="h-4 w-4" aria-hidden="true" />
                  Import credential
                  <input type="file" accept="application/json" className="sr-only" onChange={handleImport} />
                </label>
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
            <h2 className="text-xl font-semibold">Settlement wallet</h2>
            <div className="mt-4 rounded-2xl border border-white/10 bg-black/25 p-4">
              <p className="text-sm text-white/55">Connected wallet</p>
              <p className="mt-2 font-mono text-sm text-white">{connected && address ? shortenAddress(address, 6) : "Not connected"}</p>
              {connected && address ? (
                <a
                  href={buildExplorerUrl("address", address)}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex items-center gap-2 text-sm text-white/75 transition hover:text-white"
                >
                  <Wallet className="h-4 w-4" aria-hidden="true" />
                  View wallet
                </a>
              ) : null}
            </div>
          </section>
        </div>

        <section className="rounded-3xl border border-white/10 bg-white/5 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">Vouchers</h2>
            <button
              type="button"
              onClick={() => void handlePrepareClaim()}
              className="inline-flex min-h-11 items-center rounded-full border border-white/15 px-5 py-3 text-sm font-medium text-white transition hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
            >
              Prepare claim
            </button>
          </div>
          <div className="mt-4 space-y-3">
            {myVouchers.length ? (
              myVouchers.map((voucher) => (
                <div key={String(voucher.commitment)} className="rounded-2xl border border-white/10 bg-black/25 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-medium">{voucher.amount} USDC</p>
                      <p className="font-mono text-xs text-white/45">{voucher.commitment}</p>
                    </div>
                    <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70">
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                      {voucher.status}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 p-6 text-sm text-white/55">
                No vouchers loaded yet.
              </div>
            )}
          </div>
        </section>

        {status ? <p className="text-sm text-white/65">{status}</p> : null}
      </div>
    </main>
  );
}
