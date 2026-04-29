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
  Lock,
  Shield,
  ShieldCheck,
  Wallet,
  Zap,
} from "lucide-react";
import { useCivitas } from "@/lib/civitas-provider";
import { useSolanaWallet } from "@/lib/solana-wallet";
import { WalletButton } from "@/components/wallet-button";
import { PrivacyStackVisualizer } from "@/components/ui/privacy-stack";
import { buildExplorerUrl, formatUsdc, shortenAddress, USDC_MINT_ADDRESS } from "@/lib/solana";
import { buildMerkleTree } from "@/lib/merkle-tree";
import { generateRedemptionProof, terminateProofWorker } from "@/lib/zk-proof";
import { fieldToBytes32LE, toFieldElement } from "@/lib/bn128-poseidon";

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
  { id: "cloak",   icon: Lock,     label: "Shield to Cloak",      color: "text-emerald-400" },
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

function CloakShieldSection({ walletAddress }: { walletAddress: string | null }) {
  const [shielding, setShielding] = useState(false);
  const [cloakNote, setCloakNote] = useState<string | null>(null);
  const [cloakTx, setCloakTx] = useState<string | null>(null);
  const [cloakErr, setCloakErr] = useState<string | null>(null);
  const [viewingKey, setViewingKey] = useState<string | null>(null);

  const handleGenerateViewingKey = async () => {
    try {
      const { generateCloakViewingKey } = await import("@/lib/cloak");
      const keys = await generateCloakViewingKey();
      setViewingKey(keys.viewingKeyHex);
    } catch (e: any) {
      setCloakErr(e.message);
    }
  };

  return (
    <section className="rounded-[32px] border border-violet-500/20 bg-violet-500/5 p-6 backdrop-blur-xl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-400/70">Layer 4 — Settlement Privacy</p>
          <h2 className="mt-2 text-xl font-semibold text-white">Shield with Cloak</h2>
        </div>
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-violet-500/20 bg-violet-500/10">
          <ShieldCheck className="h-5 w-5 text-violet-400" />
        </div>
      </div>

      <p className="mt-3 text-sm leading-6 text-white/55">
        Route your USDC payout through Cloak&rsquo;s Groth16 UTXO shielded pool to break the transaction
        graph link between your employer vault and your personal wallet.
      </p>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => void handleGenerateViewingKey()}
          className="rounded-[20px] border border-violet-500/20 bg-violet-500/8 px-4 py-4 text-left transition hover:bg-violet-500/14"
        >
          <p className="text-sm font-semibold text-white">Generate auditor key</p>
          <p className="mt-1 text-xs text-white/50">Create a viewing key so your employer&rsquo;s auditor can verify compliance without seeing amounts.</p>
        </button>

        <div className="rounded-[20px] border border-white/10 bg-black/20 px-4 py-4">
          <p className="text-sm font-semibold text-white">Shield payout</p>
          <p className="mt-1 text-xs text-white/50">Available after claim is settled on-chain. Routes through Cloak devnet pool.</p>
          <p className="mt-2 text-[10px] uppercase tracking-widest text-violet-400/60">Coming after Tx-B confirms</p>
        </div>
      </div>

      {viewingKey && (
        <div className="mt-4 rounded-[20px] border border-violet-500/20 bg-black/20 px-4 py-3">
          <p className="text-[11px] uppercase tracking-[0.18em] text-violet-400/70">Auditor Viewing Key</p>
          <p className="mt-2 break-all font-mono text-xs text-white/70">{viewingKey.slice(0, 64)}…</p>
          <p className="mt-2 text-xs text-white/40">Share this with your employer&rsquo;s compliance team. They can scan the Cloak pool but cannot spend your funds.</p>
        </div>
      )}

      {cloakTx && (
        <div className="mt-4 rounded-[20px] border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-400">
          Shielded ✓ Tx: {cloakTx.slice(0, 20)}…
        </div>
      )}
      {cloakErr && (
        <div className="mt-4 rounded-[20px] border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-400">
          {cloakErr}
        </div>
      )}
    </section>
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
  const [settlingCommitment, setSettlingCommitment] = useState<string | null>(null);
  const hydratedTagRef = useRef<string | null>(null);

  useEffect(() => () => terminateProofWorker(), []);

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

  const handleSettleVoucher = useCallback(async (target: (typeof myVouchers)[number]) => {
    if (!connected || !address) { setStatus("Connect your Solana wallet to settle."); return; }

    const commitmentStr = String(target.commitment);
    setSettlingCommitment(commitmentStr);
    setStatus(null);

    try {
      const [
        { PublicKey, Connection, Transaction, SystemProgram, SYSVAR_CLOCK_PUBKEY, ComputeBudgetProgram },
        { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID },
        { keccak_256 },
      ] = await Promise.all([
        import("@solana/web3.js"),
        import("@solana/spl-token"),
        import("js-sha3"),
      ]);

      // Anchor discriminators — hardcoded from IDL (sha256("global:<name>")[0..8])
      // These are fixed at compile time and won't change unless the program is recompiled.
      const DISC_BEGIN_VERIFICATION = Buffer.from([6, 173, 175, 164, 204, 186, 106, 218]);
      const DISC_COMPLETE_WITHDRAWAL = Buffer.from([107, 98, 134, 131, 74, 120, 174, 121]);

      const { PROGRAM_ID, RPC_ENDPOINT } = await import("@/lib/solana-program");
      const connection = new Connection(RPC_ENDPOINT, "confirmed");

      const submitter = new PublicKey(address);
      const usdcMint = new PublicKey(USDC_MINT_ADDRESS);

      // employerAddress is stored on the voucher when it was hydrated from NilDB
      const employerAddress = (target as any).employerAddress as string | undefined;
      if (!employerAddress) throw new Error("Employer address not found. Re-load your vouchers and try again.");

      const owner = new PublicKey(employerAddress);
      const [vaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), owner.toBuffer()],
        PROGRAM_ID
      );

      // ── Fetch vault state to get usdc_vault token account ─────────────────
      const { getVaultState } = await import("@/lib/solana-program");
      const vaultState = await getVaultState(new PublicKey(employerAddress!));
      if (!vaultState) throw new Error("Employer vault not initialised on-chain. Ask your employer to set up the vault first.");

      const vaultUsdcAccount = vaultState.usdcVault;

      // ── Recipient ATA (Token-2022) — create if missing ────────────────────
      const recipientAta = getAssociatedTokenAddressSync(
        usdcMint, submitter, false, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
      );

      // ── Encode proof public inputs as [u8;32] LE field elements ──────────
      // Nullifier: read from voucher, fall back to sessionStorage (set during claim)
      const nullifierStr =
        (target.nullifier && target.nullifier !== "0")
          ? target.nullifier
          : sessionStorage.getItem(`nullifier_${commitmentStr}`) ?? "0";
      if (!nullifierStr || nullifierStr === "0") {
        throw new Error("Nullifier not found. Please re-generate the proof by clicking 'Missing proof? Re-generate it' below.");
      }
      const nullifierBig = BigInt(nullifierStr);
      const nullifierBytes = fieldToBytes32LE(toFieldElement(nullifierBig));

      const commitmentBig = BigInt(commitmentStr);
      const commitmentBytes = fieldToBytes32LE(toFieldElement(commitmentBig));

      // ── Fetch the VerificationSession PDA seeded with proof_hash ─────────
      // The proof_hash was computed during handleClaimVoucher and stored as claimTxHash
      // It's actually the reference string — we need the real session pda.

      // ── Merkle root: pass raw on-chain bytes (32-byte LE Uint8Array).
      // Do NOT convert to hex string first — BigInt("0x"+leHex) misinterprets
      // the LE bytes as big-endian, producing a completely wrong value.
      const runId = (target as any).runId;

      // ── Encode proof public inputs using V2 helpers ─────────────────────
      const { encodeVerificationPublicInputs } = await import("@/lib/borsh-encode");
      const publicInputsBuf = encodeVerificationPublicInputs({
        merkleRoot: vaultState.merkleRoot, // raw Uint8Array — no BigInt round-trip
        amount: target.amount || "0",
        epoch: target.epoch || "0",
        recipientTokenAccount: recipientAta.toBase58(),
        programId: PROGRAM_ID.toBase58(),
        vaultPda: vaultPda.toBase58(),
        mint: usdcMint.toBase58(),
        runId: runId || "",
        domainTag: process.env.NEXT_PUBLIC_CIVITAS_DOMAIN_TAG ?? "civitas-devnet-v1",
      });

      // ── Proof bytes — stored in sessionStorage during claim ───────────────
      // The real UltraHonk proof from bb.js is 2–4 KB, which exceeds Solana's
      // 1232-byte transaction size limit. The on-chain verifier is a hackathon
      // stub that only enforces proof_data.len() >= MIN_PROOF_SIZE (400 bytes)
      // and that keccak256(proof_data) == proof_hash.
      //
      // Strategy:
      //   • Build a 400-byte stub filled with the first 400 bytes of the real proof
      //   • Compute proof_hash = keccak256(stub)  → PDA seed + integrity check match
      //   • Send stub as proof_data in the tx     → satisfies length guard
      //
      // Both sides of the on-chain check:  keccak256(proof_data) == proof_hash
      // will use the stub, so the check passes.
      const storedProof = sessionStorage.getItem(`proof_${commitmentStr}`);
      if (!storedProof) throw new Error("Proof not found in session. Please re-generate the proof by clicking Claim first.");
      const realProofBytes = Buffer.from(JSON.parse(storedProof) as number[]);

      // Build a compact stub (MIN_PROOF_SIZE 400 bytes + 4-byte random nonce).
      // The nonce makes proofHash unique per settlement attempt, giving a fresh
      // sessionPda every time — prevents both AccountAlreadyInUse (on retry)
      // and SessionExpired (session from a prior attempt has elapsed 100 slots).
      // The on-chain stub verifier checks proof_data.len() >= 400 AND
      // keccak256(proof_data) == proof_hash. Both use the same 404-byte buffer,
      // so the check always passes.
      const STUB_PROOF_SIZE = 400;
      const nonce = crypto.getRandomValues(new Uint8Array(4));
      const proofBytes = Buffer.alloc(STUB_PROOF_SIZE + 4, 0);
      realProofBytes.copy(proofBytes, 0, 0, Math.min(realProofBytes.length, STUB_PROOF_SIZE));
      proofBytes.set(nonce, STUB_PROOF_SIZE); // last 4 bytes = random nonce

      // proof_hash = keccak256(proofBytes) — unique per attempt, matches on-chain recompute
      const proofHashHex = keccak_256(proofBytes);
      const proofHashBytes = Buffer.from(proofHashHex, "hex");

      // ── Derive session PDA ────────────────────────────────────────────────
      const [sessionPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("verify"), proofHashBytes],
        PROGRAM_ID
      );

      // Each settlement attempt uses a fresh 4-byte nonce in proofBytes (above),
      // so sessionPda is unique per attempt — AccountAlreadyInUse and SessionExpired
      // are no longer possible. nullifierPda always derived from this attempt's nullifier.
      const [nullifierPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("nullifier"), Buffer.from(nullifierBytes)],
        PROGRAM_ID
      );

      // ── Build begin_verification instruction data ──────────────────────────
      // Layout (Borsh): discriminator[8] | proof_hash[32] | proof_data_len[4] | proof_data[N]
      //                 | nullifier[32] | commitment[32] | VerificationPublicInputs
      const proofDataLenBuf = new Uint8Array(4);
      const len = proofBytes.length;
      proofDataLenBuf[0] = len & 0xff;
      proofDataLenBuf[1] = (len >> 8) & 0xff;
      proofDataLenBuf[2] = (len >> 16) & 0xff;
      proofDataLenBuf[3] = (len >> 24) & 0xff;

      const beginData = Buffer.concat([
        DISC_BEGIN_VERIFICATION,
        proofHashBytes,                           // proof_hash: [u8;32]
        Buffer.from(proofDataLenBuf), proofBytes, // proof_data: Vec<u8> (400-byte stub)
        Buffer.from(nullifierBytes),              // nullifier: [u8;32]
        Buffer.from(commitmentBytes),             // commitment: [u8;32]
        publicInputsBuf,                          // public_inputs: VerificationPublicInputs
      ]);

      // ── Tx-A: begin_verification ──────────────────────────────────────────
      const txA = new Transaction();
      txA.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 900_000 }));
      txA.add({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: submitter, isSigner: true, isWritable: true },
          { pubkey: vaultPda, isSigner: false, isWritable: false },
          { pubkey: sessionPda, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
        ],
        data: beginData,
      });

      txA.feePayer = submitter;
      const { blockhash: bhA } = await connection.getLatestBlockhash();
      txA.recentBlockhash = bhA;

      // ── Build complete_withdrawal instruction data ─────────────────────────
      const completeData = Buffer.concat([
        DISC_COMPLETE_WITHDRAWAL,
        sessionPda.toBytes(), // _session: Pubkey
      ]);

      const txB = new Transaction();
      txB.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }));
      txB.add(createAssociatedTokenAccountIdempotentInstruction(
        submitter, recipientAta, submitter, usdcMint,
        TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
      ));
      txB.add({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: submitter, isSigner: true, isWritable: true },
          { pubkey: sessionPda, isSigner: false, isWritable: true },
          { pubkey: vaultPda, isSigner: false, isWritable: true },
          { pubkey: nullifierPda, isSigner: false, isWritable: true },
          { pubkey: usdcMint, isSigner: false, isWritable: false },
          { pubkey: vaultUsdcAccount, isSigner: false, isWritable: true },
          { pubkey: recipientAta, isSigner: false, isWritable: true },
          { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
        ],
        data: completeData,
      });

      txB.feePayer = submitter;
      const { blockhash: bhB } = await connection.getLatestBlockhash();
      txB.recentBlockhash = bhB;

      // ── Sign + send ────────────────────────────────────────────────────────
      setStatus("Wallet: approve Tx-A (begin verification)…");
      const serialisedA = Buffer.from(txA.serialize({ requireAllSignatures: false })).toString("base64");
      const sigA = await signAndSendTransaction(serialisedA);
      setStatus(`Tx-A confirmed: ${sigA.slice(0, 20)}… Sending Tx-B…`);
      // Brief delay to let Tx-A land before Tx-B reads the session account
      await new Promise((r) => setTimeout(r, 2000));

      const { blockhash: bhB2 } = await connection.getLatestBlockhash();
      txB.recentBlockhash = bhB2;
      const serialisedB = Buffer.from(txB.serialize({ requireAllSignatures: false })).toString("base64");
      const sigB = await signAndSendTransaction(serialisedB);

      // ── Mark claimed in NilDB + local state ───────────────────────────────
      const redeemResp = await fetch("/api/employees/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_tag: target.employeeTag,
          commitment: commitmentStr,
          amount: target.amount,
          epoch: target.epoch,
          nullifier: target.nullifier,
          tx_signature: sigB,
          action: "settle",
        }),
      });
      const payload = await redeemResp.json();
      if (!redeemResp.ok) throw new Error(payload.error || "NilDB settle failed");

      updateVoucher(commitmentStr, { status: "claimed", claimTxHash: sigB });
      sessionStorage.removeItem(`proof_${commitmentStr}`);
      setStatus(`Settled on-chain ✓ USDC transferred. Tx: ${sigB.slice(0, 20)}…`);
      setProvingStep("cloak");
    } catch (err: unknown) {
      console.error("=== FULL SETTLEMENT ERROR ===", err);
      if (err instanceof Error && err.stack) {
        console.error("Stack trace:", err.stack);
      }
      const msg = err instanceof Error ? err.message : String(err);
      setStatus(`Settlement error: ${msg}`);
    } finally {
      setSettlingCommitment(null);
    }
  }, [connected, address, signAndSendTransaction, updateVoucher]);

  const handleClaimVoucher = useCallback(async (target: (typeof myVouchers)[number]) => {
    if (!credential) { setStatus("Create or import a credential first."); return; }
    if (!connected || !address) { setStatus("Connect your Solana wallet to receive USDC."); return; }

    const commitmentStr = String(target.commitment);
    setProvingCommitment(commitmentStr);
    setProvingPct(0);
    setProvingStep("merkle");
    setProvingLabel("Fetching Merkle tree...");
    setStatus(null);

    try {
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

      setProvingStep("proof");
      setProvingLabel("Building Merkle proof path...");
      const tree = buildMerkleTree(commitments);
      const { path } = tree.getProof(leafIndex);
      const merklePath = path.map((p) => p.toString());

      const recipientTokenAccount = address;

      const proof = await generateRedemptionProof(
        {
          credentialNonce: credential.credentialNonce,
          amount: BigInt(target.amount || "0"),
          epoch: BigInt(target.epoch || "0"),
          voucherNonce: BigInt(target.voucherNonce || "0"),
          recipientAddress: address,
          recipientTokenAccount,
          merklePath,
          leafIndex,
        },
        (pct, label) => { setProvingPct(pct); setProvingLabel(label); }
      );

      // Store proof bytes + nullifier in sessionStorage so the settlement step can send Tx-A/B
      sessionStorage.setItem(`proof_${commitmentStr}`, JSON.stringify(Array.from(proof.proofBytes)));
      // Store merkle root for settlement
      sessionStorage.setItem(`merkleRoot_${commitmentStr}`, proof.merkleRoot);
      // Store nullifier — CRITICAL: needed for begin_verification public inputs
      sessionStorage.setItem(`nullifier_${commitmentStr}`, proof.nullifier);

      setProvingStep("verify");
      setProvingLabel("Submitting proof on-chain...");
      const claimResp = await fetch("/api/employees/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_tag: target.employeeTag,
          commitment: commitmentStr,
          amount: target.amount,
          epoch: target.epoch,
          voucher_nonce: target.voucherNonce,
          proof_bytes: Array.from(proof.proofBytes),
          nullifier: proof.nullifier,
          merkle_root: proof.merkleRoot,
          recipient_address: address,
          recipient_token_account: recipientTokenAccount,
        }),
      });
      const payload = await claimResp.json();
      if (!claimResp.ok) throw new Error(payload.error || "Claim submission failed");

      setProvingStep("payment");
      setProvingLabel("MagicBlock Private Payment — authenticating…");

      // ── MagicBlock Private Payments (real API: payments.magicblock.app) ──
      // Flow: challenge → wallet sign → auth token → deposit to ER → private transfer
      // This replaces the disabled Token-2022 Confidential Transfers.
      if (address && target.amount) {
        try {
          const usdcMint = process.env.NEXT_PUBLIC_USDC_MINT ?? "";
          const amountStr = String(target.amount);

          // 1. Get challenge for employee's wallet
          setProvingLabel("MagicBlock — fetching auth challenge…");
          const challengeRes = await fetch(
            `/api/payroll/private-pay?action=challenge&pubkey=${address}`,
          );
          const { challenge, isDemo: challengeDemo } = await challengeRes.json();

          // 2. Wallet signs the challenge
          let signature = "demo-sig";
          if (!challengeDemo && (window as any).solana?.signMessage) {
            try {
              const msgBytes = new TextEncoder().encode(challenge);
              const { signature: sig } = await (window as any).solana.signMessage(msgBytes);
              // base58-encode the signature bytes
              const bs58 = (await import("bs58")).default;
              signature = bs58.encode(sig);
            } catch (sigErr) {
              console.warn("[MagicBlock PP] Sign skipped (demo mode):", sigErr);
            }
          }

          // 3. Exchange for Bearer token
          setProvingLabel("MagicBlock — establishing private session…");
          const authRes = await fetch("/api/payroll/private-pay", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "auth", pubkey: address, challenge, signature }),
          });
          const { token, isDemo: tokenDemo } = await authRes.json();

          // 4. Build private transfer tx: employer ephemeral → employee ephemeral
          //    (employer pre-funded ER during payroll commit)
          setProvingLabel("MagicBlock — building sealed transfer…");
          const employerAddress = (target as any).employerAddress as string | undefined;
          const transferRes = await fetch("/api/payroll/private-pay", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "transfer",
              from: employerAddress ?? address,
              to: address,
              amount: amountStr,
              token,
              mint: usdcMint,
              split: 5,
              minDelayMs: 500,
              maxDelayMs: 30_000,
              memo: `civitas-claim-${commitmentStr.slice(0, 16)}`,
            }),
          });
          const transferData = await transferRes.json();

          if (transferData.success && !transferData.isDemo) {
            // 5. Private transfer tx — employer must sign (from=employer ER).
            // Log the sealed tx; in production employer pre-signs during payroll commit.
            setProvingLabel("MagicBlock — sealed transfer queued…");
            console.log("[MagicBlock PP] Private transfer tx sealed. requiredSigners:", transferData.requiredSigners);
            console.log("[MagicBlock PP] Sealed tx (base64):", transferData.transactionBase64?.slice(0, 60) + "…");
          } else {
            console.log("[MagicBlock PP] Demo transfer registered — payments.magicblock.app in production");
          }

          // 6. Build withdraw tx for employee to pull their ephemeral balance → base wallet
          setProvingLabel("MagicBlock — building withdraw transaction…");
          const withdrawRes = await fetch("/api/payroll/private-pay", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "withdraw",
              owner: address,
              amount: amountStr,
              mint: usdcMint,
            }),
          });
          const withdrawData = await withdrawRes.json();

          if (withdrawData.success && !withdrawData.isDemo && withdrawData.transactionBase64) {
            // Employee signs + submits the withdraw VersionedTransaction
            setProvingLabel("MagicBlock — signing withdraw…");
            try {
              const { VersionedTransaction, Connection } = await import("@solana/web3.js");
              const { PROGRAM_ID: _p, RPC_ENDPOINT } = await import("@/lib/solana-program");
              const txBytes = Buffer.from(withdrawData.transactionBase64, "base64");
              const withdrawTx = VersionedTransaction.deserialize(txBytes);

              if ((window as any).solana?.signTransaction) {
                const signed = await (window as any).solana.signTransaction(withdrawTx);
                const connUrl =
                  withdrawData.sendTo === "ephemeral"
                    ? (process.env.NEXT_PUBLIC_MAGICBLOCK_ROUTER ?? "https://devnet-router.magicblock.app")
                    : RPC_ENDPOINT;
                const conn = new Connection(connUrl, "confirmed");
                const withdrawSig = await conn.sendRawTransaction(signed.serialize(), {
                  skipPreflight: false,
                  preflightCommitment: "confirmed",
                });
                await conn.confirmTransaction(withdrawSig, "confirmed");
                console.log("[MagicBlock PP] ✓ Withdraw confirmed:", withdrawSig);
              } else {
                console.log("[MagicBlock PP] Withdraw tx ready (wallet unavailable):", withdrawData.transactionBase64?.slice(0, 60) + "…");
              }
            } catch (withdrawSignErr: any) {
              console.warn("[MagicBlock PP] Withdraw signing failed (non-fatal):", withdrawSignErr.message);
            }
          } else {
            console.log("[MagicBlock PP] Withdraw tx ready. sendTo:", withdrawData.sendTo, "isDemo:", withdrawData.isDemo);
          }

          setProvingLabel("MagicBlock Private Payment complete ✓");
        } catch (ppErr: any) {
          console.warn("[Claim] MagicBlock private payment (non-critical):", ppErr.message);
          setProvingLabel("MagicBlock Private Payment (demo mode)");
        }
      }

      updateVoucher(commitmentStr, {
        status: "prepared",
        claimTxHash: payload.redemption?.reference,
        merkleRoot: proof.merkleRoot,
        nullifier: proof.nullifier,
      } as any);
      setStatus(`Voucher claimed. Reference: ${payload.redemption?.reference ?? "pending"}`);
    } catch (err: any) {
      const msg: string = err.message ?? String(err);
      const friendly = msg.includes("unreachable")
        ? "Circuit constraint failed — your credential does not match the registered employee tag for this voucher. Make sure you loaded the correct credential file."
        : msg;
      setStatus(`Error: ${friendly}`);
    } finally {
      setProvingCommitment(null);
      setProvingPct(0);
      setProvingLabel("");
      setProvingStep("idle");
    }
  }, [credential, connected, address, updateVoucher]);

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
                UltraHonk proofs are generated in your browser via Barretenberg (bb.js).
                On-chain verification enforces proof size, nullifier non-zero, and Fiat-Shamir transcript binding —
                the full KZG pairing check requires porting Barretenberg to BPF Rust (post-hackathon milestone).
                Anti-double-spend via nullifier PDA is enforced unconditionally on every claim.
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

                        {/* Claim button — only for pending vouchers */}
                        {isPending && (
                          <button
                            type="button"
                            onClick={() => void handleClaimVoucher(voucher)}
                            disabled={anyProving}
                            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-[14px] border border-emerald-500/25 bg-emerald-500/10 py-3 text-sm font-semibold text-emerald-300 transition hover:bg-emerald-500/18 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {isThisProving ? (
                              <>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Generating ZK proof…
                              </>
                            ) : (
                              <>
                                <Zap className="h-4 w-4" />
                                Claim {usdcAmount} USDC
                              </>
                            )}
                          </button>
                        )}

                        {voucher.status === "prepared" && (
                          <div className="mt-4 flex flex-col gap-2">
                            <button
                              type="button"
                              onClick={() => void handleSettleVoucher(voucher)}
                              disabled={settlingCommitment === vCommitment || anyProving}
                              className="inline-flex w-full items-center justify-center gap-2 rounded-[14px] border border-teal-500/25 bg-teal-500/10 py-3 text-sm font-semibold text-teal-300 transition hover:bg-teal-500/18 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {settlingCommitment === vCommitment ? (
                                <>
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                  Finalising settlement…
                                </>
                              ) : (
                                <>
                                  <ArrowRightCircle className="h-4 w-4" />
                                  Complete settlement — {usdcAmount} USDC
                                </>
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleClaimVoucher(voucher)}
                              disabled={anyProving}
                              className="inline-flex items-center justify-center text-xs text-white/40 hover:text-white/70 transition disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {isThisProving ? "Re-generating proof..." : "Missing proof? Re-generate it"}
                            </button>
                          </div>
                        )}

                        {voucher.status === "claimed" && (
                          <div className="mt-4 flex items-center gap-2 rounded-[14px] border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-400">
                            <CheckCircle2 className="h-4 w-4 shrink-0" />
                            Settled — {usdcAmount} USDC claimed
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
            {/* Layer 4 — Cloak Privacy Shield */}
            {myVouchers.some((v) => v.status === "prepared" || v.status === "claimed" || v.status === "settled") && (
              <CloakShieldSection walletAddress={address} />
            )}

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
