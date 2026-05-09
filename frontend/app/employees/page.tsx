"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowUpRight,
  Check,
  CheckCircle2,
  Copy,
  CreditCard,
  Database,
  Download,
  FileUp,
  KeyRound,
  Loader2,
  Lock,
  Shield,
  ShieldCheck,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import { useCivitas } from "@/lib/civitas-provider";
import { useSolanaWallet } from "@/lib/solana-wallet";
import { WalletButton } from "@/components/wallet-button";
import { buildExplorerUrl, formatUsdc, shortenAddress, MAGICBLOCK_USDC_MINT } from "@/lib/solana";
import { buildMerkleTree } from "@/lib/merkle-tree";
import { generateVoucherProof } from "@/lib/groth16-proof";
import { encodeClaimPaymentArgs } from "@/lib/borsh-encode";

const CLAIM_STEPS = [
  { id: "merkle",  icon: Database,    label: "Merkle Path"  },
  { id: "proof",   icon: Shield,      label: "Groth16 Proof" },
  { id: "verify",  icon: ShieldCheck, label: "On-Chain Verify" },
  { id: "payment", icon: Zap,         label: "Private Settle" },
] as const;

type ClaimStepId = typeof CLAIM_STEPS[number]["id"] | "idle" | "error";

function ClaimStepper({ currentStep, pct, label }: { currentStep: ClaimStepId; pct: number; label: string }) {
  const activeIdx = currentStep === "idle" || currentStep === "error"
    ? -1
    : CLAIM_STEPS.findIndex(s => s.id === currentStep);

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      className="mt-5 overflow-hidden"
    >
      <div className="rounded-2xl border border-white/[0.10] bg-black/40 backdrop-blur-2xl p-5">
        <div className="flex items-center justify-between mb-5">
          <p className="text-[9px] font-semibold uppercase tracking-[0.32em] text-white/45">
            ZK Pipeline
          </p>
          <span className="num text-[10px] font-mono text-white/55 tabular-nums">{pct.toString().padStart(2, "0")}%</span>
        </div>

        <div className="flex items-center">
          {CLAIM_STEPS.map((step, idx) => {
            const passed = activeIdx > idx;
            const active = activeIdx === idx;
            const Icon = step.icon;
            return (
              <div key={step.id} className="flex flex-1 items-center last:flex-none">
                <div className="flex flex-col items-center gap-2">
                  <div
                    className={`relative grid h-8 w-8 place-items-center rounded-full border transition-colors duration-300 ${
                      passed
                        ? "border-white bg-white text-black"
                        : active
                          ? "border-white bg-black text-white"
                          : "border-white/15 bg-black text-white/30"
                    }`}
                  >
                    {passed ? <Check className="h-3.5 w-3.5" strokeWidth={2.5} /> : <Icon className="h-3.5 w-3.5" />}
                    {active && (
                      <span className="absolute inset-0 rounded-full border border-white/60 animate-ping" aria-hidden />
                    )}
                  </div>
                  <p className={`text-[8px] font-mono uppercase tracking-[0.18em] whitespace-nowrap ${
                    passed || active ? "text-white/75" : "text-white/30"
                  }`}>
                    {step.label}
                  </p>
                </div>
                {idx < CLAIM_STEPS.length - 1 && (
                  <div className="relative mx-2 h-px flex-1 bg-white/10 -mt-5">
                    <motion.div
                      className="absolute inset-y-0 left-0 bg-white"
                      initial={{ width: "0%" }}
                      animate={{ width: passed ? "100%" : active ? "50%" : "0%" }}
                      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {label && (
          <div className="mt-5 flex items-center justify-between border-t border-white/[0.06] pt-4">
            <p className="text-[11px] text-white/65 leading-tight">{label}</p>
            <Loader2 className="h-3.5 w-3.5 animate-spin text-white/40 shrink-0 ml-3" />
          </div>
        )}
      </div>
    </motion.div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string; dot: string }> = {
    pending:  { label: "Pending",  cls: "border-white/15 bg-white/[0.03] text-white/65",   dot: "bg-white/55" },
    prepared: { label: "Prepared", cls: "border-white/30 bg-white/[0.06] text-white/85",   dot: "bg-white/85" },
    claimed:  { label: "Settled",  cls: "border-white bg-white text-black",                dot: "bg-black" },
    settled:  { label: "Settled",  cls: "border-white bg-white text-black",                dot: "bg-black" },
  };
  const { label, cls, dot } = map[status] ?? { label: status, cls: "border-white/10 bg-white/5 text-white/50", dot: "bg-white/40" };
  return (
    <span className={`shrink-0 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] ${cls}`}>
      <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${dot}`}>
        {(status === "pending" || status === "prepared") && (
          <span className={`absolute inset-0 rounded-full ${dot} opacity-50 animate-ping`} aria-hidden />
        )}
      </span>
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
              runStatus: v.runStatus,
              amountIsLikelyStale: v.amountIsLikelyStale,
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
  // Live ATA balance, polled while there's a settled voucher in flight so the
  // UI can show "Received X USDC" the moment the TEE crank fires the SPL
  // transfer — instead of leaving the user staring at Solana Explorer's
  // stale "9 days ago" address-history view.
  const [ataBalanceMicro, setAtaBalanceMicro] = useState<bigint | null>(null);
  const [ataBalanceCheckedAt, setAtaBalanceCheckedAt] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!address) {
      setRecipientAtaForExplorer(null);
      setAtaBalanceMicro(null);
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

  // ── Live ATA balance polling ────────────────────────────────────────────
  // Poll every 6s while at least one voucher is in the "claimed but not yet
  // landed" state. The ATA balance is the *only* source of truth for whether
  // the TEE validator's crank has fired the actual SPL transfer.
  const hasInflightSettlement = useMemo(() => {
    if (!credential) return false;
    return vouchers.some(
      (v) =>
        v.employeeTag === credential.employeeTag &&
        (v.status === "claimed" || v.status === "settled"),
    );
  }, [vouchers, credential]);

  const refreshAtaBalance = useCallback(async () => {
    if (!recipientAtaForExplorer) return;
    try {
      const { Connection, PublicKey } = await import("@solana/web3.js");
      const { RPC_ENDPOINT } = await import("@/lib/solana-program");
      const conn = new Connection(RPC_ENDPOINT, "confirmed");
      const info = await conn.getTokenAccountBalance(new PublicKey(recipientAtaForExplorer));
      const micro = BigInt(info.value.amount);
      setAtaBalanceMicro(micro);
      setAtaBalanceCheckedAt(Date.now());
    } catch (err) {
      // ATA may not exist yet on first ever claim — leave balance null.
      console.warn("[ATA] balance fetch failed:", (err as Error)?.message?.slice(0, 80));
    }
  }, [recipientAtaForExplorer]);

  useEffect(() => {
    if (!recipientAtaForExplorer || !hasInflightSettlement) return;
    void refreshAtaBalance();
    const id = window.setInterval(() => void refreshAtaBalance(), 6000);
    return () => window.clearInterval(id);
  }, [recipientAtaForExplorer, hasInflightSettlement, refreshAtaBalance]);

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

      // ── 1b. Pre-flight: recompute the commitment from voucher fields ──
      // If the stored amount/epoch/voucherNonce/employeeTag don't reproduce
      // the stored commitment, the circuit will fail with the cryptic
      // "unreachable" later. Catch it here and tell the user exactly why.
      // (Skips the wallet pop, the 2-3 s snarkjs proof, and the on-chain tx.)
      try {
        const { poseidon4: poseidon4Local } = await import("poseidon-lite");
        const tagBig = BigInt(String(target.employeeTag || "0"));
        const amtBig = BigInt(String(target.amount || "0"));
        const epochBig = BigInt(String(target.epoch || "0"));
        const nonceBig = BigInt(String(target.voucherNonce || "0"));
        const recomputed = poseidon4Local([tagBig, amtBig, epochBig, nonceBig]).toString();
        if (recomputed !== commitmentStr) {
          // Tell the user which field is most likely wrong. The credential
          // tag is the loudest single suspect, so check that explicitly.
          const credTagBig = BigInt(String(credential.employeeTag || "0"));
          const tagMismatch = tagBig !== credTagBig;
          const detail =
            `Stored commitment ${commitmentStr.slice(0, 12)}… does not match poseidon4(tag, amount, epoch, nonce). ` +
            `Inputs used: tag=${tagBig.toString().slice(0, 14)}…, amount="${target.amount}", epoch="${target.epoch}", nonce="${String(target.voucherNonce).slice(0, 16)}…".`;
          if (tagMismatch) {
            throw new Error(
              "Loaded credential's employee_tag does not match the voucher's. " +
              "You're likely on the wrong credential file. " + detail,
            );
          }
          throw new Error(
            "Voucher data is internally inconsistent. " +
            "This typically happens when a payroll was generated before the salary unit fix; " +
            "the on-chain commitment is bound to a different amount than what's stored in the encrypted voucher. " +
            "Ask the employer to run a fresh payroll. " + detail,
          );
        }
        console.log(
          `[Claim] pre-flight ok: poseidon4(tag, amount=${target.amount}, epoch=${target.epoch}, nonce…) reproduces stored commitment.`,
        );
      } catch (preErr: any) {
        // Re-throw with the message we built; if poseidon-lite import failed,
        // fall through and let snarkjs catch any constraint failure later.
        if (preErr?.message?.includes("commitment") || preErr?.message?.includes("credential")) throw preErr;
        console.warn("[Claim] pre-flight recompute skipped:", preErr?.message);
      }

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
          `Payroll run ${runId.slice(0, 8)}… is not on-chain yet. The employer's commit didn't reach finalization. Ask them to recommit this run.`,
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
        setProvingLabel("ZK proof already verified on-chain · retrying private settlement…");
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
        const detail = dispatchJson?.error || dispatchRes.statusText;
        if (alreadyClaimed && dispatchRes.status === 503) {
          throw new Error(
            `ZK gate verified ✓ but the private settlement vendor (MagicBlock) is unavailable: ${detail}. Your nullifier is already consumed, so this voucher remains valid — click Claim again once the vendor is healthy.`,
          );
        }
        throw new Error(`Private dispatch failed (${dispatchRes.status}): ${detail}`);
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
        `ZK gate ✓  Private transfer queued ✓  Dispatch tx: ${fullDispatchSig}. USDC settles to your USDC ATA within ~30s as the TEE validator cranks the queue.`,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const friendly = msg.includes("unreachable")
        ? "Circuit constraint failed. Your credential does not match this voucher. Verify you loaded the correct credential file."
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


  const stagger = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.06 } } };
  const fadeUp = { hidden: { opacity: 0, y: 18 }, show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] as any } } };

  const marqueeItems = [
    "ZK GROTH16",
    "ALT-BN128 SYSCALLS",
    "NULLIFIER PDA",
    "MAGICBLOCK ER",
    "NILLION SECRETVAULTS",
    "PRIVATE PAYROLL",
    "256-BYTE PROOF",
    "TEE ATTESTATION",
  ];

  return (
    <main className="relative min-h-screen overflow-x-clip bg-black text-white antialiased font-sans">
      {/* ── Background: animated video desaturated to monochrome ──────── */}
      <div className="fixed inset-0 -z-10 pointer-events-none overflow-hidden">
        <video
          autoPlay
          loop
          muted
          playsInline
          aria-hidden
          preload="auto"
          className="absolute inset-0 h-full w-full object-cover opacity-60"
          style={{ filter: "grayscale(1) contrast(1.15) brightness(1.05)" }}
        >
          <source src="/videos/Animated_Privacy_Video_Element.mp4" type="video/mp4" />
        </video>
        {/* Soft top/bottom fade so headline/footer stay readable, center stays open */}
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.55)_0%,rgba(0,0,0,0.15)_30%,rgba(0,0,0,0.15)_70%,rgba(0,0,0,0.7)_100%)]" />
        {/* Subtle side dimming, much gentler than before */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,transparent_60%,rgba(0,0,0,0.45)_100%)]" />
        {/* Animated grain on top for texture */}
        <div className="grain-overlay absolute inset-0 opacity-30" />
      </div>

      {/* ── Portal header ──────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40">
        <div className="absolute inset-0 bg-black/70 backdrop-blur-2xl" aria-hidden />
        <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" aria-hidden />
        <div className="relative mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-8">
          <Link href="/" aria-label="Civitas home" className="group relative flex items-center gap-3 outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:rounded-md">
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" aria-hidden>
              <span className="absolute inset-0 rounded-full bg-white/55 animate-ping" />
            </span>
            <img src="/logo-light.svg" alt="Civitas" width={120} height={24} className="h-[22px] w-auto opacity-95 transition-opacity duration-300 group-hover:opacity-100" draggable={false} />
            <span className="hidden md:inline-block ml-2 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.22em] text-white/55">
              Employee
            </span>
          </Link>
          <div className="flex items-center gap-2 sm:gap-3">
            <span className="hidden sm:inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.025] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-white/55" aria-label="Network status">
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white/85">
                <span className="absolute inset-0 rounded-full bg-white/40 animate-ping" />
              </span>
              Devnet
            </span>
            <WalletButton />
          </div>
        </div>
      </header>

      {/* ── Hero ───────────────────────────────────────────────────────── */}
      <section className="relative mx-auto max-w-7xl px-5 sm:px-8 pt-16 pb-12">
        <motion.div variants={stagger} initial="hidden" animate="show" className="grid gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
          <div>
            <motion.div variants={fadeUp} className="inline-flex items-center gap-3 px-3.5 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.08] text-[10px] font-semibold uppercase tracking-[0.22em] text-white/65 mb-7 backdrop-blur-md">
              <span className="relative flex h-2 w-2" aria-hidden>
                <span className="absolute inline-flex h-full w-full rounded-full bg-white/70 opacity-70 animate-ping" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
              </span>
              ZK Payout Terminal
              <span className="h-3 w-px bg-white/15 mx-1" />
              <span className="font-mono tracking-[0.18em] text-white/40">v4 · live</span>
            </motion.div>

            <motion.h1 variants={fadeUp} className="text-mono-fade text-5xl md:text-7xl lg:text-[88px] font-medium tracking-[-0.04em] leading-[0.93]">
              Private.
              <br />
              <span className="italic font-light text-white/85">Payouts.</span>
            </motion.h1>

            <motion.p variants={fadeUp} className="mt-7 max-w-xl text-[15px] leading-[1.7] text-white/55 font-light">
              Generate or import your zero-knowledge credential, claim payroll vouchers with a 256-byte
              Groth16 proof, and settle privately on Solana through MagicBlock ER. Nothing leaves the device.
            </motion.p>

            <motion.div variants={fadeUp} className="mt-8 flex flex-wrap gap-2">
              {[
                { k: "Wallet", v: connected ? "Connected" : "Disconnected", live: connected },
                { k: "Credential", v: credential ? "Active" : "Empty", live: !!credential },
                { k: "Vouchers", v: `${myVouchers.length} loaded`, live: myVouchers.length > 0 },
              ].map(chip => (
                <span key={chip.k} className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.025] px-3 py-1.5 text-[10px] font-mono uppercase tracking-[0.22em] text-white/55">
                  <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${chip.live ? "bg-white" : "bg-white/25"}`}>
                    {chip.live && <span className="absolute inset-0 rounded-full bg-white/40 animate-ping" aria-hidden />}
                  </span>
                  <span className="text-white/35">{chip.k}</span>
                  <span className="text-white/75">{chip.v}</span>
                </span>
              ))}
            </motion.div>
          </div>

          {/* Hero stat panel — encrypted total */}
          <motion.div variants={fadeUp} className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-white/[0.02] p-7 backdrop-blur-3xl scan-beam">
            <div className="absolute top-0 left-7 right-7 h-px hairline" aria-hidden />
            <div className="absolute bottom-0 left-7 right-7 h-px hairline" aria-hidden />

            <div className="flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-white/35">
                Pending · Encrypted
              </p>
              <Lock className="h-3.5 w-3.5 text-white/35" aria-hidden />
            </div>

            <div className="mt-6 flex items-baseline gap-3">
              <p className="num text-mono-fade text-6xl md:text-7xl font-medium tracking-[-0.04em] leading-none">
                {credential ? formatUsdc(totalPending) : "***"}
              </p>
              <p className="text-sm font-mono uppercase tracking-[0.22em] text-white/40">USDC</p>
            </div>

            <p className="mt-3 text-[11px] font-mono uppercase tracking-[0.22em] text-white/35">
              {credential ? "Awaiting on-chain claim" : "Load a credential to decrypt"}
            </p>

            <div className="mt-7 grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
                <div className="flex items-center justify-between">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.28em] text-white/35">Pending</p>
                  <CreditCard className="h-3.5 w-3.5 text-white/35" aria-hidden />
                </div>
                <p className="num mt-3 text-3xl font-medium text-white tracking-tight">{pendingCount}</p>
              </div>
              <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
                <div className="flex items-center justify-between">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.28em] text-white/35">Settled</p>
                  <CheckCircle2 className="h-3.5 w-3.5 text-white/35" aria-hidden />
                </div>
                <p className="num mt-3 text-3xl font-medium text-white tracking-tight">{claimedCount}</p>
              </div>
            </div>
          </motion.div>
        </motion.div>
      </section>

      {/* ── Main grid ──────────────────────────────────────────────────── */}
      <div className="relative mx-auto max-w-7xl px-5 sm:px-8 pb-24">
        <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          {/* ===================== LEFT COLUMN ===================== */}
          <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-6">

            {/* ── Credential ─────────────────────────────────────── */}
            <motion.section variants={fadeUp} className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-white/[0.02] p-6 sm:p-7 backdrop-blur-2xl">
              <div className="absolute top-0 left-7 right-7 h-px hairline" aria-hidden />
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-white/35">Credential</p>
                  <h2 className="mt-2 text-2xl font-medium tracking-[-0.02em] text-white">Zero-knowledge identity</h2>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.10] bg-white/[0.03] text-white/65">
                  <KeyRound className="h-4 w-4" aria-hidden />
                </div>
              </div>

              {!credential ? (
                <div className="mt-6 grid gap-3 md:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => void handleCreateCredential()}
                    className="btn-magnetic group relative rounded-2xl border border-white/15 bg-white text-black px-5 py-5 text-left transition-transform duration-300 hover:scale-[1.01] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-[9px] font-semibold uppercase tracking-[0.32em] text-black/55">01 · New</p>
                      <ArrowUpRight className="h-4 w-4 text-black/65 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                    </div>
                    <p className="mt-5 text-base font-semibold">Generate credential</p>
                    <p className="mt-1.5 text-xs leading-5 text-black/55">
                      Fresh employee tag generated locally. Private nonce never leaves the device.
                    </p>
                  </button>

                  <label className="btn-magnetic group relative cursor-pointer rounded-2xl border border-white/15 bg-white/[0.02] px-5 py-5 text-left transition-colors duration-300 hover:border-white/35 hover:bg-white/[0.05]">
                    <div className="flex items-center justify-between">
                      <p className="text-[9px] font-semibold uppercase tracking-[0.32em] text-white/45">02 · Restore</p>
                      <FileUp className="h-4 w-4 text-white/55 transition-transform duration-300 group-hover:scale-110" />
                    </div>
                    <p className="mt-5 text-base font-semibold text-white">Import credential</p>
                    <p className="mt-1.5 text-xs leading-5 text-white/55">
                      Load a previously exported JSON backup. Same employee identity continues.
                    </p>
                    <input type="file" accept="application/json" className="sr-only" onChange={handleImport} />
                  </label>
                </div>
              ) : (
                <div className="mt-6 space-y-4">
                  <div className="relative overflow-hidden rounded-2xl border border-white/15 bg-black/40 p-5">
                    <div className="absolute -top-px left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent" aria-hidden />
                    <div className="flex items-center justify-between mb-3">
                      <div className="inline-flex items-center gap-2">
                        <span className="relative flex h-2 w-2" aria-hidden>
                          <span className="absolute inline-flex h-full w-full rounded-full bg-white/70 opacity-70 animate-ping" />
                          <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
                        </span>
                        <p className="text-[9px] font-semibold uppercase tracking-[0.28em] text-white/65">Active credential</p>
                      </div>
                      <span className="text-[9px] font-mono uppercase tracking-[0.22em] text-white/35">local · sealed</span>
                    </div>
                    <p className="break-all font-mono text-[13px] leading-relaxed text-white">{credential.employeeTag}</p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void handleCopyTag()}
                      className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/85 transition-colors hover:bg-white/[0.08] hover:border-white/25"
                    >
                      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      {copied ? "Copied" : "Copy tag"}
                    </button>
                    {downloadHref && (
                      <a
                        href={downloadHref}
                        download="civitas-sol-credential.json"
                        className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/85 transition-colors hover:bg-white/[0.08] hover:border-white/25"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Export backup
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => void handleCreateCredential()}
                      className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/55 transition-colors hover:bg-white/[0.08] hover:text-white/85"
                    >
                      Replace
                    </button>
                  </div>
                </div>
              )}
            </motion.section>

            {/* ── ZK transparency callout ────────────────────────── */}
            <motion.div variants={fadeUp} className="flex items-start gap-4 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 backdrop-blur-md">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-white/[0.10] bg-white/[0.03]">
                <Shield className="h-4 w-4 text-white/75" aria-hidden />
              </div>
              <p className="text-[12px] leading-6 text-white/55">
                <span className="font-semibold text-white">Verifier transparency.</span>{" "}
                256-byte Groth16 proofs are generated in your browser via snarkjs from the{" "}
                <code className="mx-1 rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[11px] text-white/80">voucher.circom</code>
                circuit. On-chain verification runs the full alt-bn128 pairing check natively on Solana,
                fitting inside the CU budget. Anti-double-spend via the nullifier PDA is enforced
                unconditionally on every claim, then settlement routes through MagicBlock private payments.
              </p>
            </motion.div>

            {/* ── Vouchers ───────────────────────────────────────── */}
            <motion.section variants={fadeUp} className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-white/[0.02] p-6 sm:p-7 backdrop-blur-2xl">
              <div className="absolute top-0 left-7 right-7 h-px hairline" aria-hidden />
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-white/35">Vouchers</p>
                  <h2 className="mt-2 text-2xl font-medium tracking-[-0.02em] text-white">Payroll inbox</h2>
                </div>
                <span className="num inline-flex items-center gap-2 rounded-full border border-white/[0.10] bg-white/[0.04] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-white/65">
                  {myVouchers.length}
                  <span className="text-white/30">·</span>
                  <span className="text-white/45 normal-case font-mono">total</span>
                </span>
              </div>

              <div className="mt-6 space-y-3">
                {myVouchers.length ? (
                  <AnimatePresence initial={false}>
                    {myVouchers.map((voucher, idx) => {
                      const vCommitment = String(voucher.commitment);
                      const isThisProving = provingCommitment === vCommitment;
                      const isPending = voucher.status === "pending";
                      const anyProving = provingCommitment !== null;
                      const usdcAmount = formatUsdc(Number(voucher.amount || 0) / 1_000_000);
                      const isSettled = voucher.status === "claimed" || voucher.status === "settled";

                      return (
                        <motion.div
                          key={vCommitment}
                          layout
                          initial={{ opacity: 0, y: 16 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -8 }}
                          transition={{ duration: 0.45, delay: idx * 0.05, ease: [0.16, 1, 0.3, 1] }}
                          className={`group relative overflow-hidden rounded-2xl border p-5 transition-colors duration-300 ${
                            isThisProving
                              ? "border-white/40 bg-white/[0.04]"
                              : isSettled
                                ? "border-white/25 bg-white/[0.03]"
                                : voucher.status === "prepared"
                                  ? "border-white/20 bg-white/[0.025]"
                                  : "border-white/[0.08] bg-black/30 hover:border-white/[0.18] hover:bg-white/[0.025]"
                          }`}
                        >
                          {isThisProving && (
                            <div className="absolute inset-0 -z-10 opacity-40">
                              <div className="absolute inset-0 grain-overlay" />
                            </div>
                          )}

                          {/* Top row */}
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <div className="flex items-baseline gap-2">
                                <p className="num text-3xl font-medium tracking-[-0.02em] text-white">{usdcAmount}</p>
                                <p className="text-xs font-mono uppercase tracking-[0.22em] text-white/40">USDC</p>
                              </div>
                              <p className="mt-1.5 truncate font-mono text-[10px] text-white/30 max-w-[280px]" title={vCommitment}>
                                <span className="text-white/20">commit</span> · {vCommitment.slice(0, 28)}…
                              </p>
                            </div>
                            <StatusBadge status={voucher.status} />
                          </div>

                          {/* Meta row */}
                          <div className="mt-4 flex flex-wrap gap-x-7 gap-y-2.5 border-t border-white/[0.06] pt-4">
                            <div>
                              <p className="text-[9px] font-semibold uppercase tracking-[0.22em] text-white/30">Epoch</p>
                              <p className="mt-0.5 font-mono text-xs text-white/65">{voucher.epoch || "N/A"}</p>
                            </div>
                            <div>
                              <p className="text-[9px] font-semibold uppercase tracking-[0.22em] text-white/30">Nonce</p>
                              <p className="mt-0.5 font-mono text-xs text-white/65" title={String(voucher.voucherNonce || "")}>
                                {voucher.voucherNonce ? `${String(voucher.voucherNonce).slice(0, 12)}…` : "N/A"}
                              </p>
                            </div>
                            {voucher.claimTxHash && (
                              <div>
                                <p className="text-[9px] font-semibold uppercase tracking-[0.22em] text-white/30">Reference</p>
                                <p className="mt-0.5 truncate max-w-[180px] font-mono text-xs text-white/85">{voucher.claimTxHash.slice(0, 16)}…</p>
                              </div>
                            )}
                          </div>

                          {/* Stepper while claiming */}
                          <AnimatePresence>
                            {isThisProving && (
                              <ClaimStepper currentStep={provingStep} pct={provingPct} label={provingLabel} />
                            )}
                          </AnimatePresence>

                          {/* Banner: stale (pre-normalization) data */}
                          {(voucher as any).amountIsLikelyStale && !isSettled && (
                            <div className="mt-5 rounded-xl border border-white/15 bg-white/[0.04] p-4">
                              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/65 mb-1.5">
                                Stale voucher · cannot be claimed
                              </p>
                              <p className="text-xs leading-5 text-white/55">
                                This voucher was generated before the salary-unit normalization fix.
                                The on-chain commitment is bound to a wrong amount, so a fresh proof
                                won't verify. Ask your employer to run a new payroll.
                              </p>
                            </div>
                          )}

                          {/* Banner: run not on-chain yet */}
                          {(voucher as any).runStatus === "missing" && !(voucher as any).amountIsLikelyStale && !isSettled && (
                            <div className="mt-5 rounded-xl border border-white/15 bg-white/[0.04] p-4">
                              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/65 mb-1.5">
                                Awaiting employer commit
                              </p>
                              <p className="text-xs leading-5 text-white/55">
                                The payroll run exists in the encrypted store but hasn't been finalized
                                on-chain yet. Ask the employer to complete the commit step in the wizard.
                                Run id: <span className="font-mono text-white/70">{String((voucher as any).runId || "").slice(0, 8)}…</span>
                              </p>
                            </div>
                          )}

                          {/* Banner: run on-chain but at wrong status (Pending=0 or Settled=2) */}
                          {(voucher as any).runStatus === "pending" && !isSettled && (
                            <div className="mt-5 rounded-xl border border-white/15 bg-white/[0.04] p-4">
                              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/65 mb-1.5">
                                Commit not finalized
                              </p>
                              <p className="text-xs leading-5 text-white/55">
                                On-chain run exists but never reached <span className="font-mono">finalize_merkle_root</span>.
                                Ask the employer to retry the commit (idempotent).
                              </p>
                            </div>
                          )}

                          {/* Claim CTA — only when voucher is healthy and run is committed */}
                          {(isPending || voucher.status === "prepared") &&
                            !(voucher as any).amountIsLikelyStale &&
                            ((voucher as any).runStatus === "committed" || (voucher as any).runStatus === undefined) && (
                            <button
                              type="button"
                              onClick={() => void handleClaim(voucher)}
                              disabled={anyProving}
                              className="btn-magnetic mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full border border-white bg-white px-6 py-3.5 text-[11px] font-semibold uppercase tracking-[0.22em] text-black transition-transform duration-300 hover:scale-[1.005] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:cursor-not-allowed disabled:bg-white/30 disabled:border-white/30 disabled:text-black/60"
                            >
                              {isThisProving ? (
                                <>
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                  {provingLabel ? provingLabel.split(" ").slice(0, 4).join(" ") : "Claiming…"}
                                </>
                              ) : (
                                <>
                                  <Zap className="h-4 w-4" strokeWidth={2.4} />
                                  Claim {usdcAmount} USDC
                                  <ArrowUpRight className="h-4 w-4" />
                                </>
                              )}
                            </button>
                          )}

                          {/* Settled state */}
                          {isSettled && (
                            <div className="mt-5 space-y-3">
                              <div className="inline-flex items-center gap-2 rounded-full border border-white bg-white px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-black">
                                <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2.4} />
                                Settled · {usdcAmount} USDC
                              </div>

                              {/* Live ATA balance — the one source of truth */}
                              <div className="flex items-center justify-between rounded-2xl border border-white/[0.10] bg-black/40 px-4 py-3">
                                <div className="min-w-0">
                                  <p className="text-[9px] font-semibold uppercase tracking-[0.28em] text-white/35 mb-1">
                                    Your USDC ATA balance
                                  </p>
                                  <p className="num text-base font-medium text-white tabular-nums">
                                    {ataBalanceMicro === null
                                      ? "—"
                                      : `${formatUsdc(Number(ataBalanceMicro) / 1_000_000)} USDC`}
                                  </p>
                                  <p className="mt-0.5 text-[10px] font-mono uppercase tracking-[0.18em] text-white/35">
                                    {ataBalanceCheckedAt
                                      ? `as of ${Math.max(0, Math.round((Date.now() - ataBalanceCheckedAt) / 1000))}s ago · auto-refresh 6s`
                                      : "polling…"}
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => void refreshAtaBalance()}
                                  className="shrink-0 rounded-full border border-white/15 bg-white/[0.04] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-white/85 hover:bg-white/[0.08] hover:border-white/25 transition-colors"
                                >
                                  Refresh
                                </button>
                              </div>

                              <div className="rounded-2xl border border-white/[0.10] bg-black/40 px-4 py-3 text-[11px] leading-5 text-white/55 space-y-2">
                                <p>
                                  ZK gate is verified on-chain (nullifier burned). Settlement runs through MagicBlock's TEE validator queue with a randomized 0.5–30 s delay; USDC lands directly in your associated token account when the crank fires. The dispatch tx below is the queue intent — the actual SPL transfer is a separate tx and may not appear in the ATA's history view immediately. Watch the live balance above.
                                </p>
                                {(voucher as any).claimTxHash && (
                                  <div className="font-mono text-[10px] break-all">
                                    <span className="text-white/30">zk gate</span>{" · "}
                                    <a
                                      href={buildExplorerUrl("tx", (voucher as any).claimTxHash)}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-white/85 hover:text-white underline-offset-2 hover:underline"
                                    >
                                      {(voucher as any).claimTxHash.slice(0, 24)}…
                                    </a>
                                  </div>
                                )}
                                {(voucher as any).privateTransferSig && (
                                  <div className="font-mono text-[10px] break-all">
                                    <span className="text-white/30">dispatch</span>{" · "}
                                    <a
                                      href={buildExplorerUrl("tx", (voucher as any).privateTransferSig)}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-white/85 hover:text-white underline-offset-2 hover:underline"
                                    >
                                      {(voucher as any).privateTransferSig.slice(0, 24)}…
                                    </a>
                                  </div>
                                )}
                                {(voucher as any).privateTransferSig && recipientAtaForExplorer && (
                                  <div className="pt-2">
                                    <a
                                      href={buildExplorerUrl("address", recipientAtaForExplorer)}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.22em] text-white/65 hover:text-white"
                                    >
                                      Watch USDC arrive on your ATA
                                      <ArrowUpRight className="h-3 w-3" />
                                    </a>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                ) : (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.97 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
                    className="relative overflow-hidden rounded-2xl border border-dashed border-white/[0.12] bg-white/[0.01] px-8 py-14 text-center"
                  >
                    <div className="absolute inset-0 grain-overlay opacity-30" aria-hidden />
                    <div className="relative">
                      <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl border border-white/15 bg-white/[0.04]">
                        <CreditCard className="h-6 w-6 text-white/45" aria-hidden />
                      </div>
                      <p className="text-mono-fade text-2xl font-light tracking-[-0.02em] mb-2">No vouchers yet.</p>
                      <p className="mx-auto max-w-sm text-[13px] text-white/45 leading-relaxed">
                        Vouchers appear here the moment your employer commits a new payroll run.
                      </p>
                      <div className="mt-7 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.02] px-4 py-2 text-[10px] font-mono uppercase tracking-[0.22em] text-white/45">
                        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white/55">
                          <span className="absolute inset-0 rounded-full bg-white/30 animate-ping" aria-hidden />
                        </span>
                        Listening for payroll
                      </div>
                    </div>
                  </motion.div>
                )}
              </div>
            </motion.section>
          </motion.div>

          {/* ===================== RIGHT COLUMN ===================== */}
          <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-6 xl:sticky xl:top-24 xl:self-start">
            {/* Settlement wallet */}
            <motion.section variants={fadeUp} className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-white/[0.02] p-6 sm:p-7 backdrop-blur-2xl">
              <div className="absolute top-0 left-7 right-7 h-px hairline" aria-hidden />
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-white/35">Settlement Wallet</p>
                  <h2 className="mt-2 text-xl font-medium tracking-[-0.01em] text-white">Recipient route</h2>
                </div>
                <div className="grid h-10 w-10 place-items-center rounded-xl border border-white/[0.10] bg-white/[0.03] text-white/65">
                  <Wallet className="h-4 w-4" aria-hidden />
                </div>
              </div>

              <div className="mt-5 rounded-2xl border border-white/[0.10] bg-black/30 p-4">
                <div className="flex items-center justify-between">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.28em] text-white/35">Connected wallet</p>
                  <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${connected ? "bg-white" : "bg-white/25"}`}>
                    {connected && <span className="absolute inset-0 rounded-full bg-white/40 animate-ping" aria-hidden />}
                  </span>
                </div>
                <p className="num mt-3 font-mono text-sm text-white">
                  {connected && address ? shortenAddress(address, 6) : "Not connected"}
                </p>
                <p className="mt-3 text-xs leading-5 text-white/50">
                  Receiving route for private payouts after the program-side settlement is finalized.
                </p>
                {connected && address && (
                  <a
                    href={buildExplorerUrl("address", address)}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.03] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/85 transition-colors hover:bg-white/[0.08] hover:border-white/25"
                  >
                    View on Explorer
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
            </motion.section>

            {/* Privacy guarantees */}
            <motion.section variants={fadeUp} className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-white/[0.02] p-6 sm:p-7 backdrop-blur-2xl">
              <div className="absolute top-0 left-7 right-7 h-px hairline" aria-hidden />
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-white/35">Guarantees</p>
                  <h2 className="mt-2 text-xl font-medium tracking-[-0.01em] text-white">What stays hidden</h2>
                </div>
                <div className="grid h-10 w-10 place-items-center rounded-xl border border-white/[0.10] bg-white/[0.03] text-white/65">
                  <ShieldCheck className="h-4 w-4" aria-hidden />
                </div>
              </div>

              <ol className="mt-5 space-y-2.5">
                {[
                  { n: "01", t: "Identity stays local", d: "Voucher ownership is bound to a credential held on this device. No public payroll list reveals you." },
                  { n: "02", t: "Encrypted commitment set", d: "Claim preparation runs against the encrypted voucher set; final settlement isolates in the Solana flow." },
                  { n: "03", t: "Backups are recovery", d: "Export only to destinations you control. The credential JSON is your access path." },
                ].map((row) => (
                  <li
                    key={row.n}
                    className="group relative rounded-2xl border border-white/[0.08] bg-black/25 p-4 transition-colors duration-300 hover:border-white/[0.18] hover:bg-white/[0.025]"
                  >
                    <div className="flex items-start gap-3">
                      <span className="num shrink-0 rounded-md border border-white/[0.10] bg-white/[0.03] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.22em] text-white/55">{row.n}</span>
                      <div>
                        <p className="text-[13px] font-medium text-white">{row.t}</p>
                        <p className="mt-1 text-[12px] leading-5 text-white/50">{row.d}</p>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </motion.section>
          </motion.div>
        </div>
      </div>

      {/* ── Kinetic marquee ───────────────────────────────────────────── */}
      <div className="relative overflow-hidden border-y border-white/[0.06] bg-black/40 py-6">
        <motion.div
          className="flex whitespace-nowrap"
          animate={{ x: ["0%", "-50%"] }}
          transition={{ duration: 40, repeat: Infinity, ease: "linear" }}
          aria-hidden
        >
          {[...marqueeItems, ...marqueeItems, ...marqueeItems, ...marqueeItems].map((label, i) => (
            <span key={i} className="mx-7 inline-flex items-center gap-7 text-[11px] font-mono uppercase tracking-[0.32em] text-white/35">
              {label}
              <span className="text-white/15">·</span>
            </span>
          ))}
        </motion.div>
        <div className="pointer-events-none absolute inset-y-0 left-0 w-32 bg-gradient-to-r from-black to-transparent" aria-hidden />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-32 bg-gradient-to-l from-black to-transparent" aria-hidden />
      </div>

      {/* ── Floating status toast ─────────────────────────────────────── */}
      <AnimatePresence>
        {status && (
          <motion.div
            key="status-toast"
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.96 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="fixed bottom-6 right-6 z-50 max-w-md rounded-2xl border border-white/15 bg-black/90 px-5 py-4 backdrop-blur-2xl shadow-[0_20px_60px_-15px_rgba(255,255,255,0.12)]"
            role="status"
          >
            <div className="flex items-start gap-3">
              <div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-white/20 bg-white/[0.06]">
                {status.toLowerCase().includes("error") || status.toLowerCase().includes("fail")
                  ? <X className="h-3.5 w-3.5 text-white/85" />
                  : <CheckCircle2 className="h-3.5 w-3.5 text-white/85" />}
              </div>
              <p className="flex-1 text-[12px] leading-5 text-white/80 break-words">{status}</p>
              <button
                type="button"
                onClick={() => setStatus(null)}
                aria-label="Dismiss"
                className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-white/10 text-white/45 transition-colors hover:bg-white/[0.06] hover:text-white"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
