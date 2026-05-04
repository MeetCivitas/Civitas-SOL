"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRightCircle,
  CheckCircle2,
  ChevronRight,
  Copy,
  CreditCard,
  Database,
  Download,
  FileUp,
  KeyRound,
  Loader2,
  Shield,
  ShieldCheck,
  Wallet,
  Zap,
} from "lucide-react";
import { useCivitas } from "@/lib/civitas-provider";
import { useSolanaWallet } from "@/lib/solana-wallet";
import { WalletButton } from "@/components/wallet-button";
import { PrivacyStackVisualizer } from "@/components/ui/privacy-stack";
import { buildExplorerUrl, formatUsdc, shortenAddress, USDC_MINT_ADDRESS, MAGICBLOCK_USDC_MINT } from "@/lib/solana";
import { buildMerkleTree } from "@/lib/merkle-tree";
import { generateVoucherProof } from "@/lib/groth16-proof";
import { encodeClaimPaymentArgs } from "@/lib/borsh-encode";

function StatTile({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5 backdrop-blur-xl">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/40">{label}</p>
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-black/25 text-white/70">
          {icon}
        </div>
      </div>
      <p className="mt-5 text-3xl font-semibold tracking-tight text-white">{value}</p>
      <p className="mt-2 text-sm text-white/55">{detail}</p>
    </div>
  );
}

const CLAIM_STEPS = [
  { id: "merkle",  icon: Database, label: "Fetch Merkle Path",    color: "text-violet-400" },
  { id: "proof",   icon: Shield,   label: "Generate ZK Proof",    color: "text-blue-400" },
  { id: "verify",  icon: ShieldCheck, label: "Verify On-Chain",   color: "text-teal-400" },
  { id: "payment", icon: Zap,      label: "Private Payment",      color: "text-amber-400" },
] as const;

type ClaimStepId = typeof CLAIM_STEPS[number]["id"] | "idle" | "error";

function ClaimStepper({ currentStep, pct, label }: { currentStep: ClaimStepId; pct: number; label: string }) {
  const activeIdx = CLAIM_STEPS.findIndex(s => s.id === currentStep);
  return (
    <div className="mt-4 rounded-[18px] border border-white/10 bg-black/30 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-white/30">Privacy Progress</p>
        {pct > 0 && <span className="text-[10px] font-mono text-white/60">{pct}%</span>}
      </div>
      <div className="flex justify-center py-2">
        <PrivacyStackVisualizer activeLayer={activeIdx === -1 ? undefined : activeIdx} />
      </div>
      {label && (
        <div className="flex items-center justify-center gap-2 pt-3 border-t border-white/5">
          <Loader2 className="h-3 w-3 text-white/40 animate-spin" />
          <p className="text-[10px] font-mono text-white/40 uppercase tracking-widest">{label}</p>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    pending: { label: "Pending", cls: "border-amber-500/25 bg-amber-500/10 text-amber-400" },
    prepared: { label: "Prepared", cls: "border-teal-500/25 bg-teal-500/10 text-teal-400" },
    claimed: { label: "Claimed", cls: "border-emerald-500/25 bg-emerald-500/10 text-emerald-400" },
  };
  const { label, cls } = map[status] ?? { label: status, cls: "border-white/10 bg-white/5 text-white/50" };
  return (
    <span className={`shrink-0 rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] ${cls}`}>
      {label}
    </span>
  );
}

export default function EmployeesPage() {
  const { connected, address, signAndSendTransaction } = useSolanaWallet();
  const {
    credential,
    createNewCredential,
    importCredential,
    vouchers,
    addVoucher,
    updateVoucher,
  } = useCivitas();
  const [status, setStatus] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [provingCommitment, setProvingCommitment] = useState<string | null>(null);
  const [provingPct, setProvingPct] = useState(0);
  const [provingLabel, setProvingLabel] = useState("");
  const [provingStep, setProvingStep] = useState<ClaimStepId>("idle");
  const hydratedTagRef = useRef<string | null>(null);

  // Hydrate vouchers from NilDB once per credential tag
  useEffect(() => {
    const tag = credential?.employeeTag;
    if (!tag || hydratedTagRef.current === tag) return;
    hydratedTagRef.current = tag;

    fetch(`/api/employees/vouchers?employeeTag=${encodeURIComponent(tag)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success && Array.isArray(data.vouchers) && data.vouchers.length > 0) {
          data.vouchers.forEach((v: any) => {
            addVoucher({
              employeeTag: v.employeeTag,
              commitment: v.commitment,
              amount: v.amount,
              epoch: v.epoch,
              voucherNonce: v.voucherNonce,
              nullifier: v.nullifier,
              runId: v.runId,
              status: v.status || "pending",
              claimTxHash: v.claimTxHash || "",
              merkleRoot: v.merkleRoot || "",
              employerAddress: v.employerAddress || "",
            } as any);
          });
          setStatus(`Loaded ${data.vouchers.length} voucher${data.vouchers.length !== 1 ? "s" : ""} from the encrypted payroll vault.`);
        }
      })
      .catch((err) => console.warn("[EmployeesPage] voucher fetch:", err));
  }, [credential?.employeeTag, addVoucher]);

  const myVouchers = credential
    ? vouchers.filter((voucher) => voucher.employeeTag === credential.employeeTag)
    : [];
  const pendingCount = myVouchers.filter((voucher) => voucher.status === "pending").length;
  // preparedCount kept for internal use (pending settlement step)
  const _preparedCount = myVouchers.filter((voucher) => voucher.status === "prepared").length; void _preparedCount;
  // Voucher amounts are stored as USDC micro-units (6 decimals). Divide before display.
  const totalPendingMicro = myVouchers
    .filter((voucher) => voucher.status === "pending" || voucher.status === "prepared")
    .reduce((sum, voucher) => sum + Number(voucher.amount || 0), 0);
  const claimedCount = myVouchers.filter((v) => v.status === "claimed" || v.status === "settled").length;
  const totalPending = totalPendingMicro / 1_000_000;

  const downloadHref = useMemo(() => {
    if (!credential) return null;
    const encoded = encodeURIComponent(JSON.stringify(credential, null, 2));
    return `data:application/json;charset=utf-8,${encoded}`;
  }, [credential]);

  // Recipient USDC ATA on the MagicBlock (legacy SPL) mint — stays stable
  // for the duration of the wallet session. Used to surface an Explorer
  // link so the user can watch settlement land in real time.
  const [recipientAtaForExplorer, setRecipientAtaForExplorer] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!address) {
      setRecipientAtaForExplorer(null);
      return;
    }
    (async () => {
      const { PublicKey } = await import("@solana/web3.js");
      const { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } =
        await import("@solana/spl-token");
      try {
        const ata = getAssociatedTokenAddressSync(
          new PublicKey(MAGICBLOCK_USDC_MINT),
          new PublicKey(address),
          false,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID,
        ).toBase58();
        if (!cancelled) setRecipientAtaForExplorer(ata);
      } catch {
        if (!cancelled) setRecipientAtaForExplorer(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [address]);

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

  const handleCopyTag = async () => {
    if (!credential) return;
    await navigator.clipboard.writeText(credential.employeeTag);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  const handleClaim = useCallback(async (target: (typeof myVouchers)[number]) => {
    if (!credential) { setStatus("Create or import a credential first."); return; }
    if (!connected || !address) { setStatus("Connect your Solana wallet to receive USDC."); return; }

    const commitmentStr = String(target.commitment);
    setProvingCommitment(commitmentStr);
    setProvingPct(0);
    setProvingStep("merkle");
    setProvingLabel("Fetching Merkle tree...");
    setStatus(null);

    try {
      // ── 1. Fetch Merkle path for this voucher ────────────────────────
      const runId = (target as any).runId;
      const treeUrl = runId
        ? `/api/payroll/merkle-tree?run_id=${encodeURIComponent(runId)}`
        : "/api/payroll/merkle-tree";
      const treeResp = await fetch(treeUrl);
      if (!treeResp.ok) throw new Error("Could not load Merkle tree from server.");
      const treeData = await treeResp.json();
      const rawCommitments = treeData.commitments;
      const commitments: string[] = Array.isArray(rawCommitments)
        ? rawCommitments.map(String)
        : typeof rawCommitments === "string" && rawCommitments.startsWith("[")
          ? JSON.parse(rawCommitments)
          : [];

      const leafIndex = commitments.indexOf(commitmentStr);
      if (leafIndex === -1) throw new Error("Voucher commitment not found in Merkle tree.");

      const tree = buildMerkleTree(commitments);
      const { path } = tree.getProof(leafIndex);
      const merklePath = path.map((p) => p.toString());

      // ── 2. Generate Groth16 proof (256 B) ─────────────────────────────
      setProvingStep("proof");
      const employerAddress = (target as any).employerAddress as string | undefined;
      if (!employerAddress) throw new Error("Employer address not on voucher; reload vouchers.");

      const [
        { PublicKey, Connection, Transaction, SystemProgram, ComputeBudgetProgram },
        { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID },
        { PROGRAM_ID, RPC_ENDPOINT, getVaultState },
      ] = await Promise.all([
        import("@solana/web3.js"),
        import("@solana/spl-token"),
        import("@/lib/solana-program"),
      ]);

      const submitter = new PublicKey(address);
      // Bind the proof to the LEGACY MagicBlock USDC mint + legacy ATA since
      // MagicBlock's SPL Vault does not support Token-2022. The Civitas
      // on-chain vault still references the Token-2022 mint as metadata,
      // but the proof's pi_hash binds to the actual settlement mint.
      const usdcMint = new PublicKey(MAGICBLOCK_USDC_MINT);
      const owner = new PublicKey(employerAddress);
      const [vaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), owner.toBuffer()],
        PROGRAM_ID,
      );

      const vaultState = await getVaultState(owner);
      if (!vaultState) throw new Error("Employer vault not initialised on-chain.");

      // Precheck: the voucher's payroll_run PDA must exist and be Committed.
      // Saves ~30 s of proof generation when the run is still Pending or
      // never finalized.
      const [precheckRunPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("run"), owner.toBuffer(), uuidStringToBytes(runId)],
        PROGRAM_ID,
      );
      const conn = new Connection(RPC_ENDPOINT, "confirmed");
      const runInfo = await conn.getAccountInfo(precheckRunPda);
      if (!runInfo) {
        throw new Error(
          `Payroll run ${runId.slice(0, 8)}… is not on-chain yet — the employer's commit didn't reach finalization. Ask them to recommit this run.`,
        );
      }
      // PayrollRunAccount status byte sits at: 8(disc)+16+32+8+32+32+4+4+4 = 140
      const STATUS_OFFSET = 8 + 16 + 32 + 8 + 32 + 32 + 4 + 4 + 4;
      const status = runInfo.data[STATUS_OFFSET];
      if (status !== 1) {
        throw new Error(
          `Payroll run ${runId.slice(0, 8)}… is on-chain but its status is ` +
          `${status === 0 ? "Pending (commit didn't finalize)" : "Settled"}. ` +
          `The employer needs to (re-)commit this run all the way through ` +
          `finalize_merkle_root before this voucher is claimable.`,
        );
      }

      const recipientAta = getAssociatedTokenAddressSync(
        usdcMint, submitter, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
      );

      // Use the run-specific merkle_root so vouchers from any historically
      // committed run remain valid (not just the latest). The on-chain
      // claim_payment handler reads PayrollRunAccount.finalized_root and
      // recomputes pi_hash with that value. NilCC stores the root as a
      // decimal string; the local fallback uses "0x"-prefixed hex.
      // BigInt(s) accepts both — we then write 32 BE bytes consistently.
      const rawRoot = String(treeData.merkle_root || "").trim();
      if (!rawRoot) throw new Error("merkle root missing from run data");
      const merkleRootBE = new Uint8Array(32);
      {
        let n = BigInt(rawRoot);
        for (let i = 31; i >= 0; i--) {
          merkleRootBE[i] = Number(n & 0xffn);
          n >>= 8n;
        }
        if (n !== 0n) throw new Error("merkle root doesn't fit in 32 bytes");
      }

      const proof = await generateVoucherProof(
        {
          credentialNonce: BigInt("0x" + credential.credentialNonce),
          voucherNonce: BigInt(target.voucherNonce || "0"),
          amount: BigInt(target.amount || "0"),
          epoch: BigInt(target.epoch || "0"),
          runId: uuidStringToBytes(runId),
          recipientTokenAccount: recipientAta.toBytes(),
          mint: usdcMint.toBytes(),
          vaultPda: vaultPda.toBytes(),
          programId: PROGRAM_ID.toBytes(),
          merklePath,
          leafIndex,
          merkleRoot: merkleRootBE,
        },
        (pct, label) => { setProvingPct(pct); setProvingLabel(label); },
      );

      // ── 3. Build single claim_payment tx — pure ZK gate ────────────────
      setProvingStep("verify");
      setProvingLabel("Building on-chain ZK gate transaction...");

      const DISC_CLAIM_PAYMENT = Buffer.from([69, 112, 250, 167, 37, 156, 200, 30]);
      const nullifierBytes = fieldToBE32Local(BigInt(proof.nullifier));

      const claimData = encodeClaimPaymentArgs({
        discriminator: DISC_CLAIM_PAYMENT,
        proofBytes: proof.proofBytes,
        piHash: proof.piHash,
        nullifier: nullifierBytes,
        runId,
      });

      const [nullifierPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("nullifier"), Buffer.from(nullifierBytes)],
        PROGRAM_ID,
      );
      const [payrollRunPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("run"), owner.toBuffer(), uuidStringToBytes(runId)],
        PROGRAM_ID,
      );

      const connection = new Connection(RPC_ENDPOINT, "confirmed");

      // ── 3a. Idempotency: if the nullifier PDA already exists and is
      //        owned by our program, the on-chain claim ix already ran
      //        successfully in a prior attempt. Skip the wallet prompt
      //        and dispatch with no claimTxSig — the dispatch route's
      //        nullifier check is the authoritative success proof.
      let sig = "";
      const priorNullifier = await connection.getAccountInfo(nullifierPda, "confirmed");
      const alreadyClaimed =
        priorNullifier !== null && priorNullifier.owner.equals(PROGRAM_ID);

      if (alreadyClaimed) {
        setProvingStep("payment");
        setProvingLabel("Voucher already claimed on-chain — re-dispatching settlement…");
      } else {
        const tx = new Transaction();
        tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }));
        tx.add({
          programId: PROGRAM_ID,
          keys: [
            { pubkey: submitter, isSigner: true, isWritable: true },
            { pubkey: payrollRunPda, isSigner: false, isWritable: false },
            { pubkey: nullifierPda, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: new PublicKey("SysvarC1ock11111111111111111111111111111111"), isSigner: false, isWritable: false },
          ],
          data: claimData,
        });

        tx.feePayer = submitter;
        const { blockhash } = await connection.getLatestBlockhash();
        tx.recentBlockhash = blockhash;

        // ── 4. Wallet signs + submits the ZK gate ─────────────────────
        setProvingStep("payment");
        setProvingLabel("Wallet: approve ZK proof transaction...");
        const serialised = Buffer.from(tx.serialize({ requireAllSignatures: false })).toString("base64");
        sig = await signAndSendTransaction(serialised);
      }

      // ── 5. Dispatch private settlement via MagicBlock ─────────────────
      setProvingLabel("Settling privately via MagicBlock ER…");
      const piHashHex = Array.from(proof.piHash)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      const nullifierHex = Array.from(nullifierBytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      const dispatchRes = await fetch("/api/payroll/dispatch-claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          claimTxSig: sig,
          runId,
          employerAddress,
          employeeWallet: submitter.toBase58(),
          recipientTokenAccount: recipientAta.toBase58(),
          amountBaseUnits: String(target.amount || "0"),
          epoch: String(target.epoch || "0"),
          nullifierHex,
          piHashHex,
        }),
      });
      const dispatchJson = await dispatchRes.json().catch(() => ({}));
      if (!dispatchRes.ok) {
        throw new Error(
          `Private dispatch failed: ${dispatchJson?.error || dispatchRes.statusText}`,
        );
      }

      // ── 6. Record settlement in NilDB ─────────────────────────────────
      await fetch("/api/employees/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_tag: target.employeeTag,
          commitment: commitmentStr,
          amount: target.amount,
          epoch: target.epoch,
          voucher_nonce: target.voucherNonce,
          nullifier: proof.nullifier,
          tx_signature: sig,
          private_transfer_sig: dispatchJson?.privateTransferSig,
          action: "settle",
        }),
      }).catch((e) => console.warn("[Claim] settle record failed (non-fatal):", e));

      updateVoucher(commitmentStr, {
        status: "claimed",
        claimTxHash: sig,
        nullifier: proof.nullifier,
        privateTransferSig: dispatchJson?.privateTransferSig,
      } as any);

      const fullDispatchSig = String(dispatchJson?.privateTransferSig || "");
      setStatus(
        `ZK gate ✓  Private transfer queued ✓  Dispatch tx: ${fullDispatchSig} — USDC settles to your USDC ATA within ~30s as the TEE validator cranks the queue.`,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const friendly = msg.includes("unreachable")
        ? "Circuit constraint failed — your credential does not match this voucher. Verify you loaded the correct credential file."
        : msg;
      console.error("[Claim] FULL ERROR:", err);
      setStatus(`Claim error: ${friendly}`);
      setProvingStep("error");
    } finally {
      setProvingCommitment(null);
      setProvingPct(0);
      setProvingLabel("");
    }
  }, [credential, connected, address, signAndSendTransaction, updateVoucher]);

  // The legacy ER→base withdraw flow was removed when we switched the
  // dispatcher to use ephemeral→base private transfers (depositAndQueueTransferIx).
  // That route settles funds directly into the recipient's USDC ATA via
  // the TEE validator's queue cranks — there's no ER ephemeral balance
  // for the employee to manually drain.

  // ── small local helpers ───────────────────────────────────────────────

  function fieldToBE32Local(n: bigint): Uint8Array {
    const out = new Uint8Array(32);
    let x = n;
    for (let i = 31; i >= 0; i--) {
      out[i] = Number(x & 0xffn);
      x >>= 8n;
    }
    return out;
  }

  function uuidStringToBytes(uuid: string): Uint8Array {
    const clean = (uuid || "").replace(/-/g, "");
    const out = new Uint8Array(16);
    if (clean.length === 32) {
      for (let i = 0; i < 16; i++) {
        out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
      }
    }
    return out;
  }


  return (
    <main className="min-h-screen bg-[#040404] text-white">
      <div className="fixed inset-0 -z-10 pointer-events-none">
        <video autoPlay loop muted playsInline className="h-full w-full object-cover opacity-20 mix-blend-screen">
          <source src="/videos/Animated_Privacy_Video_Element.mp4" type="video/mp4" />
        </video>
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.16),transparent_32%),radial-gradient(circle_at_bottom_left,rgba(59,130,246,0.15),transparent_30%),linear-gradient(180deg,rgba(4,4,4,0.78),rgba(4,4,4,0.98))]" />
      </div>

      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-white/42">Employee Workspace</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight text-white">Private payout access</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/60">
              Restore the complete Civitas employee flow: create or import a private credential, review incoming vouchers,
              and move toward Solana settlement without exposing payroll identity on-chain.
            </p>
          </div>
          <WalletButton />
        </div>

        <section className="mt-6 grid gap-4 md:grid-cols-3">
          <StatTile
            label="Pending"
            value={String(pendingCount)}
            detail="Vouchers ready for private redemption"
            icon={<CreditCard className="h-5 w-5" aria-hidden="true" />}
          />
          <StatTile
            label="Settled"
            value={String(claimedCount)}
            detail="Vouchers fully settled and claimed"
            icon={<CheckCircle2 className="h-5 w-5" aria-hidden="true" />}
          />
          <StatTile
            label="Pending Value"
            value={`${formatUsdc(totalPending)} USDC`}
            detail={credential ? "Scoped to the active employee credential" : "Load a credential to decrypt your view"}
            icon={<ShieldCheck className="h-5 w-5" aria-hidden="true" />}
          />
        </section>

        <section className="mt-6 grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <div className="space-y-6">
            <section className="rounded-[32px] border border-white/10 bg-white/[0.04] p-6 backdrop-blur-xl">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/42">Credential</p>
                  <h2 className="mt-2 text-2xl font-semibold tracking-tight">Zero-knowledge identity</h2>
                </div>
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-black/20">
                  <KeyRound className="h-5 w-5 text-white/72" aria-hidden="true" />
                </div>
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <button
                  type="button"
                  onClick={() => void handleCreateCredential()}
                  className="rounded-[26px] border border-blue-400/20 bg-blue-500/14 px-5 py-5 text-left transition hover:bg-blue-500/20"
                >
                  <p className="text-sm font-semibold">Generate new credential</p>
                  <p className="mt-2 text-sm leading-6 text-white/55">
                    Creates a fresh private employee tag locally and stores it in the browser credential vault.
                  </p>
                </button>

                <label className="cursor-pointer rounded-[26px] border border-emerald-400/20 bg-emerald-500/12 px-5 py-5 text-left transition hover:bg-emerald-500/18">
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    <FileUp className="h-4 w-4" aria-hidden="true" />
                    Import existing credential
                  </p>
                  <p className="mt-2 text-sm leading-6 text-white/55">
                    Load a previously exported credential backup and continue from the same employee identity.
                  </p>
                  <input type="file" accept="application/json" className="sr-only" onChange={handleImport} />
                </label>
              </div>

              <div className="mt-6 rounded-[28px] border border-white/10 bg-black/22 p-5">
                {credential ? (
                  <>
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/42">Active employee tag</p>
                    <p className="mt-3 break-all font-mono text-sm text-white">{credential.employeeTag}</p>
                    <p className="mt-4 text-xs leading-5 text-white/45">
                      The private nonce stays local. Only the employee tag should leave the device.
                    </p>

                    <div className="mt-5 flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={() => void handleCopyTag()}
                        className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/10 px-5 py-3 text-sm text-white transition hover:bg-white/6"
                      >
                        <Copy className="h-4 w-4" aria-hidden="true" />
                        {copied ? "Copied" : "Copy tag"}
                      </button>

                      {downloadHref ? (
                        <a
                          href={downloadHref}
                          download="civitas-sol-credential.json"
                          className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/10 px-5 py-3 text-sm text-white transition hover:bg-white/6"
                        >
                          <Download className="h-4 w-4" aria-hidden="true" />
                          Export backup
                        </a>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <div className="rounded-[24px] border border-dashed border-white/10 bg-black/18 px-4 py-6 text-sm text-white/55">
                    No credential loaded yet. Generate or import one to unlock private payroll vouchers.
                  </div>
                )}
              </div>
            </section>

            {/* ZK verifier transparency disclosure — Phase C.4 */}
            <div className="flex items-start gap-3 rounded-2xl border border-blue-500/20 bg-blue-500/5 p-4 backdrop-blur-sm">
              <Shield className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />
              <p className="text-xs text-white/55 leading-5">
                <span className="font-semibold text-blue-300">ZK Proof:</span>{" "}
                256-byte Groth16 proofs are generated in your browser via snarkjs from the
                <code className="mx-1 px-1 py-0.5 rounded bg-white/[0.06] text-white/70">voucher.circom</code>
                circuit. On-chain verification runs the full alt-bn128 pairing check natively on Solana —
                fitting inside the CU budget. Anti-double-spend via the nullifier PDA is enforced
                unconditionally on every claim, then settlement is routed through MagicBlock private payments.
              </p>
            </div>

            <section className="rounded-[32px] border border-white/10 bg-white/[0.04] p-6 backdrop-blur-xl">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/42">Vouchers</p>
                  <h2 className="mt-2 text-2xl font-semibold tracking-tight">Payroll payouts</h2>
                </div>
                <span className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-xs font-semibold text-white/50">
                  {myVouchers.length} {myVouchers.length === 1 ? "voucher" : "vouchers"}
                </span>
              </div>

              <div className="mt-5 space-y-3">
                {myVouchers.length ? (
                  myVouchers.map((voucher) => {
                    const vCommitment = String(voucher.commitment);
                    const isThisProving = provingCommitment === vCommitment;
                    const isPending = voucher.status === "pending";
                    const anyProving = provingCommitment !== null;
                    const usdcAmount = formatUsdc(Number(voucher.amount || 0) / 1_000_000);

                    return (
                      <div
                        key={vCommitment}
                        className={`rounded-[24px] border p-5 transition-all duration-300 ${isThisProving
                          ? "border-emerald-500/30 bg-emerald-500/[0.04]"
                          : voucher.status === "claimed"
                            ? "border-emerald-500/20 bg-emerald-500/[0.03]"
                            : voucher.status === "prepared"
                              ? "border-teal-500/20 bg-teal-500/[0.03]"
                              : "border-white/[0.08] bg-black/20 hover:border-white/[0.14] hover:bg-white/[0.03]"
                          }`}
                      >
                        {/* Header row */}
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-2xl font-semibold tracking-tight text-white">{usdcAmount} <span className="text-sm font-normal text-white/40">USDC</span></p>
                            <p className="mt-1 font-mono text-[11px] text-white/30 truncate max-w-[240px]" title={vCommitment}>
                              {vCommitment.slice(0, 20)}…
                            </p>
                          </div>
                          <StatusBadge status={voucher.status} />
                        </div>

                        {/* Meta row */}
                        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
                          <div className="min-w-0">
                            <p className="text-[10px] uppercase tracking-[0.18em] text-white/30">Epoch</p>
                            <p className="mt-0.5 font-mono text-xs text-white/60">{voucher.epoch || "—"}</p>
                          </div>
                          <div className="min-w-0">
                            <p className="text-[10px] uppercase tracking-[0.18em] text-white/30">Nonce</p>
                            <p className="mt-0.5 font-mono text-xs text-white/60" title={String(voucher.voucherNonce || "")}>
                              {voucher.voucherNonce ? `${String(voucher.voucherNonce).slice(0, 14)}…` : "—"}
                            </p>
                          </div>
                          {voucher.claimTxHash && (
                            <div className="min-w-0">
                              <p className="text-[10px] uppercase tracking-[0.18em] text-white/30">Reference</p>
                              <p className="mt-0.5 font-mono text-xs text-teal-400 truncate">{voucher.claimTxHash.slice(0, 20)}…</p>
                            </div>
                          )}
                        </div>

                        {/* 5-step claim stepper */}
                        {isThisProving && (
                          <ClaimStepper currentStep={provingStep} pct={provingPct} label={provingLabel} />
                        )}

                        {/* Claim button — single-tx claim_payment */}
                        {(isPending || voucher.status === "prepared") && (
                          <button
                            type="button"
                            onClick={() => void handleClaim(voucher)}
                            disabled={anyProving}
                            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-[14px] border border-emerald-500/25 bg-emerald-500/10 py-3 text-sm font-semibold text-emerald-300 transition hover:bg-emerald-500/18 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {isThisProving ? (
                              <>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                {provingLabel || "Claiming…"}
                              </>
                            ) : (
                              <>
                                <Zap className="h-4 w-4" />
                                Claim {usdcAmount} USDC
                              </>
                            )}
                          </button>
                        )}

                        {voucher.status === "claimed" && (
                          <div className="mt-4 space-y-3">
                            <div className="flex items-center gap-2 rounded-[14px] border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-400">
                              <CheckCircle2 className="h-4 w-4 shrink-0" />
                              Private transfer queued — {usdcAmount} USDC settling to your USDC ATA
                            </div>
                            <div className="rounded-[14px] border border-white/8 bg-white/[0.03] px-4 py-3 text-xs text-white/50 space-y-2">
                              <p>
                                The TEE validator's queue cranks fire within ~30s of the dispatch,
                                settling USDC directly into your associated token account. No additional
                                wallet action needed.
                              </p>
                              {(voucher as any).claimTxHash && (
                                <div className="font-mono text-[10px] break-all">
                                  <span className="text-white/35">ZK gate tx:</span>{" "}
                                  <a
                                    href={buildExplorerUrl("tx", (voucher as any).claimTxHash)}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-blue-400 hover:underline"
                                  >
                                    {(voucher as any).claimTxHash}
                                  </a>
                                </div>
                              )}
                              {(voucher as any).privateTransferSig && (
                                <div className="font-mono text-[10px] break-all">
                                  <span className="text-white/35">Dispatch tx:</span>{" "}
                                  <a
                                    href={buildExplorerUrl("tx", (voucher as any).privateTransferSig)}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-blue-400 hover:underline"
                                  >
                                    {(voucher as any).privateTransferSig}
                                  </a>
                                </div>
                              )}
                              {recipientAtaForExplorer && (
                                <div className="font-mono text-[10px] break-all">
                                  <span className="text-white/35">Your USDC ATA:</span>{" "}
                                  <a
                                    href={buildExplorerUrl("address", recipientAtaForExplorer)}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-blue-400 hover:underline"
                                  >
                                    Watch settlement on Solana Explorer ↗
                                  </a>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <div className="rounded-[24px] border border-dashed border-white/10 bg-black/20 px-5 py-8 text-center">
                    <CreditCard className="mx-auto h-8 w-8 text-white/20 mb-3" />
                    <p className="text-sm text-white/40">No vouchers yet</p>
                    <p className="mt-1 text-xs text-white/25">Ask your employer to run payroll. Vouchers appear here once issued.</p>
                  </div>
                )}
              </div>
            </section>
          </div>

          <div className="space-y-6">
            <section className="rounded-[32px] border border-white/10 bg-white/[0.04] p-6 backdrop-blur-xl">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/42">Settlement Wallet</p>
                  <h2 className="mt-2 text-xl font-semibold">Recipient route</h2>
                </div>
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-black/20">
                  <Wallet className="h-5 w-5 text-white/72" aria-hidden="true" />
                </div>
              </div>

              <div className="mt-5 rounded-[26px] border border-white/10 bg-black/22 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/42">Connected wallet</p>
                <p className="mt-2 font-mono text-sm text-white">{connected && address ? shortenAddress(address, 6) : "Not connected"}</p>
                <p className="mt-3 text-sm leading-6 text-white/55">
                  This wallet is the eventual receiving route for private payouts after the program-side settlement is
                  finalized.
                </p>
                {connected && address ? (
                  <a
                    href={buildExplorerUrl("address", address)}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-full border border-white/10 px-5 py-3 text-sm text-white transition hover:bg-white/6"
                  >
                    <Wallet className="h-4 w-4" aria-hidden="true" />
                    View wallet
                  </a>
                ) : null}
              </div>
            </section>

            <section className="rounded-[32px] border border-white/10 bg-white/[0.04] p-6 backdrop-blur-xl">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/42">Privacy Guarantees</p>
                  <h2 className="mt-2 text-xl font-semibold">What stays hidden</h2>
                </div>
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-black/20">
                  <ShieldCheck className="h-5 w-5 text-white/72" aria-hidden="true" />
                </div>
              </div>

              <div className="mt-5 space-y-3 text-sm leading-6 text-white/58">
                <div className="rounded-[24px] border border-white/10 bg-black/22 px-4 py-4">
                  Employee identity and voucher ownership remain tied to the local credential, not a public payroll list.
                </div>
                <div className="rounded-[24px] border border-white/10 bg-black/22 px-4 py-4">
                  Claim preparation happens against the encrypted commitment set, with the final settlement path isolated in
                  the Solana flow.
                </div>
                <div className="rounded-[24px] border border-white/10 bg-black/22 px-4 py-4">
                  Export a credential backup only if you control the destination. It is the recovery path for your private
                  payroll access.
                </div>
              </div>
            </section>
          </div>
        </section>

        {status ? (
          <div className="mt-6 rounded-[24px] border border-white/10 bg-white/[0.04] px-5 py-4 text-sm text-white/72">
            {status}
          </div>
        ) : null}
      </div>
    </main>
  );
}
