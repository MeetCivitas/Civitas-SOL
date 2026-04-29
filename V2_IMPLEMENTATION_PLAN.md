# Civitas V2 — Implementation Plan
**Version:** 2.0  
**Date:** 2026-04-28  
**Status:** Active development — Colosseum Frontier submission  
**Target Tracks:** MagicBlock Private Payments ($5K) · Nillion Nucleus · Cloak Privacy  
**Strategic Pivot:** Token-2022 ZK ElGamal disabled on devnet/mainnet → Replace with MagicBlock Private Payments API

---

## V1 Completion Audit — What's Actually Done

### ✅ DONE — Confirmed in codebase

| Item | Status | Evidence |
|------|--------|---------|
| Real packages installed (MagicBlock, Noir, Cloak, Nillion, Bonfida) | ✅ Done | `package.json` deps |
| `employee_tag` encoding fix (`BigInt(emp.employee_tag)`) | ✅ Done | `generate/route.ts:~88` |
| Nullifier set to `""` (server never computes it) | ✅ Done | `generate/route.ts:160` |
| `teeActive` flag in generate response | ✅ Done | `generate/route.ts:332,342` |
| nilCC fallback with explicit error (no silent fallback) | ✅ Done | `generate/route.ts:263,279` |
| ZK proof pipeline: `zk-proof.ts` with UltraHonkBackend, Web Worker | ✅ Done | `lib/zk-proof.ts` |
| Merkle tree API: `/api/payroll/merkle-tree` | ✅ Done | `app/api/payroll/merkle-tree/route.ts` |
| Employee proof generation flow with progress bar | ✅ Done | `app/employees/page.tsx:548` |
| MagicBlock ER routing: `ConnectionMagicRouter` in wizard | ✅ Done | `create-payroll-wizard.tsx:341-350` |
| `signAllAndSend` in `solana-wallet.tsx` | ✅ Done | `lib/solana-wallet.tsx:159` |
| Cloak integration: `lib/cloak.ts` with `shieldPayoutWithCloak` | ✅ Done | `lib/cloak.ts` |
| Cloak Shield section in employees page | ✅ Done | `app/employees/page.tsx:52-116` |
| Garaga/Umbra/L2 references removed from landing | ✅ Done | `app/page.tsx` |
| Payroll settle route with nullifier PDA verification | ✅ Done | `app/api/payroll/settle/route.ts` |
| Fake type stubs deleted | ✅ Done | Confirmed removed |

### ⚠️ PARTIAL — Needs Completion

| Item | Status | What's Missing |
|------|--------|----------------|
| Nillion `%allot` on salary fields | ⚠️ Partial | Need to verify employee record writes use `%allot` wrapper |
| Begin-claim / complete-withdrawal flow | ⚠️ Partial | Uses 400-byte stub proof — needs real Anchor IX encoding |
| SNS domain UI in vault init | ⚠️ Partial | `lib/sns.ts` exists but fund-deploy-modal has no SNS input |
| nilCC `%allot` blindfold markers in NilDB schema | ⚠️ Partial | Schema exists but blindfold markers unverified |

### ❌ NOT DONE — Critical Missing Pieces

| Item | Status | Blocker |
|------|--------|---------|
| **ZK verifier — stub returns `Ok(true)`** | ❌ Stub | `verifier/mod.rs` returns true unconditionally |
| **Token-2022 Confidential Transfers** | ❌ Disabled | Solana disabled ZK ElGamal on devnet/mainnet (security audit) |
| **MagicBlock Private Payments API** | ❌ Not started | Core V2 feature — replaces CT |
| **Permissioned Ephemeral Rollups (PERs)** | ❌ Not started | Upgrade from basic ER for payroll privacy |
| **Real begin_verification + complete_withdrawal Anchor IXs** | ❌ Stub | Full Borsh encoding needed |
| **UI/UX redesign** | ❌ Not started | V2 requires world-class payroll UX |
| **Demo video** | ❌ Not started | Submission requirement |

---

## Strategic Architecture — V2

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                        CIVITAS V2 PRIVACY STACK                              │
│                                                                              │
│  Layer 0 — Identity     : ZK credential (Poseidon/BN254) — stays in browser │
│  Layer 1 — Data Privacy : Nillion nilDB (%allot secret shares on salary)    │
│  Layer 2 — Compute      : Nillion nilCC TEE — amounts never leave enclave    │
│  Layer 3 — Claim        : Noir UltraHonk ZK — anonymous on-chain claiming   │
│  Layer 4 — Payment      : MagicBlock Private Payments — amount-private txs  │
│  Layer 5 — Settlement   : Cloak shielded pool — unlinkable transaction graph │
│  Layer 6 — Compliance   : Cloak viewing keys — selective disclosure          │
│                                                                              │
│  SPEED LAYER: MagicBlock PER — payroll commit in 2 sigs instead of 6+       │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Key Strategic Narrative:**
> "Solana temporarily disabled ZK ElGamal (Token-2022 Confidential Transfers) pending a security audit. Civitas anticipated this limitation and uses MagicBlock Private Payments as a production-ready, audited alternative that provides equivalent payment amount privacy — today, on devnet and mainnet."

This turns a limitation into a feature. Judges WILL ask about Token-2022 CT. Your answer: "We knew it was disabled, so we engineered around it with the only production-ready private payment primitive on Solana — MagicBlock. That's why we're here."

---

## Phase A — MagicBlock Private Payments API Integration
**Priority: CRITICAL — Core V2 Feature**  
**Time estimate: 10 hours**  
**Track: MagicBlock $5K prize pool**

### A.1 — What MagicBlock Private Payments provides

MagicBlock Private Payments routes USDC transfers through a Permissioned Ephemeral Rollup session where:
- The payment amount is **not visible on the public Solana transaction log** during processing
- Only the employer (session initiator) and the recipient (by derivation) can decrypt the amount
- On-chain settlement shows a transfer occurred, but the amount is sealed inside the ER session state
- This is the functional equivalent of Token-2022 Confidential Transfers — available NOW

**Endpoint:** `https://devnet-router.magicblock.app/private`  
**SDK:** `@magicblock-labs/ephemeral-rollups-sdk` (already installed at `^0.6.5`)

### A.2 — New file: `frontend/lib/server/magicblock-private-payments.ts`

```typescript
/**
 * lib/server/magicblock-private-payments.ts
 * MagicBlock Private Payments — replaces Token-2022 Confidential Transfers
 * 
 * Used for the MagicBlock Frontier hackathon track.
 * Provides payment amount privacy via Permissioned Ephemeral Rollup sessions.
 */

import {
  Connection,
  PublicKey,
  Keypair,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { getAssociatedTokenAddress, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";

export const MAGICBLOCK_PRIVATE_ROUTER =
  process.env.NEXT_PUBLIC_MAGICBLOCK_ROUTER ?? "https://devnet-router.magicblock.app";

export const MAGICBLOCK_PRIVATE_WS =
  MAGICBLOCK_PRIVATE_ROUTER.replace("https://", "wss://").replace("http://", "ws://");

/**
 * Creates a private payment session for a payroll disbursement.
 * Returns a session ID that can be used to route all employee payments
 * through the private ER channel.
 * 
 * @param employerPubkey - The employer's wallet (session authority)
 * @param runId - The payroll run UUID
 * @param totalAmountUsdc - Total USDC being disbursed (for session capacity)
 */
export async function createPrivatePaymentSession(
  employerPubkey: PublicKey,
  runId: string,
  totalAmountUsdc: bigint
): Promise<{
  sessionId: string;
  sessionPda: PublicKey;
  routerEndpoint: string;
}> {
  const response = await fetch(`${MAGICBLOCK_PRIVATE_ROUTER}/private/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      authority: employerPubkey.toBase58(),
      metadata: { runId, totalAmountUsdc: totalAmountUsdc.toString() },
      sessionType: "payroll",
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`MagicBlock Private Payments session creation failed: ${err}`);
  }

  const { sessionId, sessionPda } = await response.json();

  return {
    sessionId,
    sessionPda: new PublicKey(sessionPda),
    routerEndpoint: `${MAGICBLOCK_PRIVATE_ROUTER}/private/sessions/${sessionId}`,
  };
}

/**
 * Generates a private payment instruction for a single employee.
 * Amount is sealed in the ER session — not visible in the Solana transaction.
 * 
 * Returns a base64-encoded VersionedTransaction for the wallet to sign.
 */
export async function buildPrivatePaymentTx(
  connection: Connection,
  sessionId: string,
  employerPubkey: PublicKey,
  recipientPubkey: PublicKey,
  usdcMint: PublicKey,
  amountUsdc: bigint,
  commitment: string,
  nullifier: string
): Promise<string> {
  // Derive recipient's USDC token account
  const recipientAta = await getAssociatedTokenAddress(
    usdcMint,
    recipientPubkey,
    false,
    TOKEN_2022_PROGRAM_ID
  );

  // POST to MagicBlock private session to build the sealed transfer
  const buildRes = await fetch(
    `${MAGICBLOCK_PRIVATE_ROUTER}/private/sessions/${sessionId}/transfer`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        from: employerPubkey.toBase58(),
        to: recipientAta.toBase58(),
        mint: usdcMint.toBase58(),
        // Amount is sealed within the session — not in this request body
        // The session authority validates against the pre-committed amount
        commitmentHash: commitment,
        nullifierHash: nullifier,
        // The amount is retrieved from the private session state
        // This means the Solana transaction log shows ZERO amount info
      }),
    }
  );

  if (!buildRes.ok) {
    const err = await buildRes.text();
    throw new Error(`Failed to build private payment tx: ${err}`);
  }

  const { transaction } = await buildRes.json();
  return transaction; // base64 VersionedTransaction
}

/**
 * Finalizes and commits the private payment session to Solana L1.
 * This is the only on-chain transaction — it contains no per-employee amounts.
 * Returns the Solana transaction signature.
 */
export async function finalizePrivatePaymentSession(
  sessionId: string,
  employerPubkey: PublicKey
): Promise<{ tx: string; merkleCommitment: string }> {
  const res = await fetch(
    `${MAGICBLOCK_PRIVATE_ROUTER}/private/sessions/${sessionId}/finalize`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ authority: employerPubkey.toBase58() }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to finalize private payment session: ${err}`);
  }

  const { transaction, merkleCommitment } = await res.json();
  return { tx: transaction, merkleCommitment };
}

/**
 * Checks the status of a private payment session.
 */
export async function getPrivateSessionStatus(sessionId: string): Promise<{
  status: "pending" | "processing" | "finalized" | "failed";
  processedCount: number;
  totalCount: number;
}> {
  const res = await fetch(
    `${MAGICBLOCK_PRIVATE_ROUTER}/private/sessions/${sessionId}`,
    { method: "GET" }
  );
  return res.json();
}
```

### A.3 — New API route: `frontend/app/api/payroll/private-pay/route.ts`

This replaces the `complete_withdrawal` flow for payment disbursement. Instead of the employer transferring USDC openly, all disbursements go through the MagicBlock Private Payment session.

```typescript
/**
 * POST /api/payroll/private-pay
 * Initiates or advances a MagicBlock Private Payment session for a payroll run.
 * 
 * Body: { action: "init" | "disburse" | "finalize", runId, employerAddress, ... }
 */
import { NextRequest, NextResponse } from "next/server";
import {
  createPrivatePaymentSession,
  buildPrivatePaymentTx,
  finalizePrivatePaymentSession,
  getPrivateSessionStatus,
} from "@/lib/server/magicblock-private-payments";
import { PublicKey } from "@solana/web3.js";
import {
  getPayrollRun,
  getCompanyId,
} from "@/lib/server/nillion-server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, runId, employerAddress } = body;

    if (!action || !runId || !employerAddress) {
      return NextResponse.json(
        { error: "action, runId, and employerAddress required" },
        { status: 400 }
      );
    }

    const employerPubkey = new PublicKey(employerAddress);

    switch (action) {
      case "init": {
        // Start a new private payment session for this payroll run
        const { totalAmount } = body;
        const session = await createPrivatePaymentSession(
          employerPubkey,
          runId,
          BigInt(totalAmount)
        );
        return NextResponse.json({
          sessionId: session.sessionId,
          sessionPda: session.sessionPda.toBase58(),
          routerEndpoint: session.routerEndpoint,
        });
      }

      case "disburse": {
        // Build a private payment tx for one employee (called after ZK proof verification)
        const { sessionId, recipientAddress, amountUsdc, commitment, nullifier, usdcMint } = body;
        const tx = await buildPrivatePaymentTx(
          /* connection */ null as any,
          sessionId,
          employerPubkey,
          new PublicKey(recipientAddress),
          new PublicKey(usdcMint ?? process.env.NEXT_PUBLIC_USDC_MINT!),
          BigInt(amountUsdc),
          commitment,
          nullifier
        );
        return NextResponse.json({ transaction: tx });
      }

      case "finalize": {
        // Commit all private payments to L1 in a single sealed transaction
        const { sessionId } = body;
        const { tx, merkleCommitment } = await finalizePrivatePaymentSession(
          sessionId,
          employerPubkey
        );
        return NextResponse.json({ transaction: tx, merkleCommitment });
      }

      case "status": {
        const { sessionId } = body;
        const status = await getPrivateSessionStatus(sessionId);
        return NextResponse.json(status);
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (err: any) {
    console.error("[private-pay]", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
```

### A.4 — Update employee claim flow to use Private Payments

**File:** `frontend/app/employees/page.tsx`

After the ZK proof is verified on-chain (Tx-A `begin_verification` confirms), instead of the employer directly transferring USDC publicly, the claim triggers a MagicBlock private payment disbursement:

```typescript
// After proof verification (Tx-A) confirms:
const disbursRes = await fetch("/api/payroll/private-pay", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    action: "disburse",
    runId: voucher.runId,
    employerAddress: voucher.employerAddress,
    sessionId: voucher.privateSessionId,    // set during payroll commit
    recipientAddress: address,
    amountUsdc: voucher.amount,
    commitment: voucher.commitment,
    nullifier: generatedProof.nullifier.toString(),
    usdcMint: process.env.NEXT_PUBLIC_USDC_MINT,
  }),
});
const { transaction } = await disbursRes.json();
// Employee signs the private payment tx — amount sealed in ER session
const sig = await signAndSendTransaction(transaction);
```

### A.5 — Update payroll commit wizard to init Private Payment session

**File:** `frontend/components/employer/create-payroll-wizard.tsx`

In the commit step, after MagicBlock ER processes all commitment chunks, initialize the Private Payment session:

```typescript
// After ER finalization, create private payment session:
const sessionRes = await fetch("/api/payroll/private-pay", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    action: "init",
    runId,
    employerAddress: address,
    totalAmount: generatedRun.totalUsdcApprox,
  }),
});
const { sessionId } = await sessionRes.json();
// Store sessionId in NilDB with the run record for employees to reference
// (employees use this sessionId to trigger their private payment disbursement)
```

### A.6 — Update landing page narrative

**File:** `frontend/app/page.tsx` — update the payment layer card:

```tsx
{
  icon: <Zap />,
  accent: "amber",
  label: "Payment Privacy",
  title: "MagicBlock Private Payments",
  desc: "Employee salary amounts are sealed inside MagicBlock's Permissioned Ephemeral Rollup sessions. On-chain observers see a transfer occurred — but never the amount. Works today, on devnet and mainnet.",
}
```

### A.7 — Phase A Checklist

- [ ] `lib/server/magicblock-private-payments.ts` created
- [ ] `app/api/payroll/private-pay/route.ts` created
- [ ] Payroll commit wizard inits private session after ER finalization
- [ ] Employee claim flow triggers private disbursement after proof verification
- [ ] Landing page tech card updated from "Token-2022" to "MagicBlock Private Payments"
- [ ] `token22.ts` still exists for Token account creation (needed for the ATA) — do NOT delete, just don't use ElGamal/CT features

---

## Phase B — Permissioned Ephemeral Rollups (PERs) Upgrade
**Priority: HIGH — Direct MagicBlock track integration**  
**Time estimate: 6 hours**  
**Why:** Upgrades basic ER integration to PERs — the MagicBlock feature that judges most want to see

### B.1 — What PERs add to Civitas

Current state: All chunk transactions go through the PUBLIC `devnet-router.magicblock.app`. Anyone monitoring the ER can see which commitments are being appended.

With PERs: The `PayrollRunAccount` PDA is delegated to a **Permissioned ER** where:
- Only the employer's wallet can read the ER state during payroll processing
- Commitment chunks are processed privately
- No competitor can front-run or observe the payroll before it finalizes

**Critical distinction for judges:**  
Basic ER = fast + no fees. PER = fast + no fees + **private state during processing**.

### B.2 — Update `create-payroll-wizard.tsx` to use PER

```typescript
import {
  ConnectionMagicRouter,
  delegateWithPER,    // Permissioned ER delegation
} from "@magicblock-labs/ephemeral-rollups-sdk";

const MAGIC_PER_ENDPOINT = "https://devnet-router.magicblock.app/per";

async function commitPayrollViaPER(
  runId: string,
  employerKeypairOrWallet: WalletContextState,
  transactions: string[]  // serialized VersionedTransactions
) {
  // 1. Start: delegate the PayrollRunAccount to a PER session
  //    Only the employer's keypair can access ER state
  const perSession = await delegateWithPER({
    endpoint: MAGIC_PER_ENDPOINT,
    authority: employerKeypairOrWallet.publicKey!.toBase58(),
    sessionParams: {
      access: "private",       // ← Permissioned ER
      authorizedReaders: [employerKeypairOrWallet.publicKey!.toBase58()],
    },
  });
  
  // 2. Delegate tx (Tx 0 — L1, employer signs)
  const delegateSig = await employerKeypairOrWallet.sendTransaction(
    deserializeTx(transactions[0]),
    connection
  );
  console.log("[PER] PayrollRunAccount delegated:", delegateSig);

  // 3. Chunk txs — processed inside PER (no wallet prompts)
  const perConn = new ConnectionMagicRouter(MAGIC_PER_ENDPOINT);
  for (let i = 1; i < transactions.length - 1; i++) {
    await perConn.sendAndConfirmTransaction(deserializeTx(transactions[i]));
  }

  // 4. Finalize (Tx N — L1, employer signs, commits state + closes PER)
  const finalizeSig = await employerKeypairOrWallet.sendTransaction(
    deserializeTx(transactions[transactions.length - 1]),
    connection
  );
  console.log("[PER] Finalized and committed to L1:", finalizeSig);

  return finalizeSig;
}
```

### B.3 — Update UI to show PER privacy badge

In the payroll commit step, show:

```tsx
<div className="flex items-center gap-2 p-3 rounded-xl border border-amber-500/20 bg-amber-500/5">
  <Zap className="h-4 w-4 text-amber-400" />
  <div>
    <p className="text-xs font-bold text-amber-400">MagicBlock PER Active</p>
    <p className="text-xs text-white/50">Commitment data processed in a Permissioned Ephemeral Rollup. State is private during processing.</p>
  </div>
  <span className="ml-auto text-xs text-white/30 font-mono">devnet-router.magicblock.app/per</span>
</div>
```

### B.4 — Phase B Checklist

- [ ] Payroll wizard uses `delegateWithPER` instead of basic `ConnectionMagicRouter`
- [ ] PER session has `access: "private"` and employer as sole authorized reader
- [ ] UI shows PER badge during commit step
- [ ] `npm run build` passes with 0 errors

---

## Phase C — ZK Verifier: Honest Stub with Real Architecture
**Priority: HIGH — Technical credibility**  
**Time estimate: 4 hours**

### C.1 — The honest approach

The full KZG UltraHonk verifier requires ~3000 lines of BPF Rust. Writing it in a hackathon is not realistic. But shipping a hidden stub (`verify_step_1` returns `Ok(true)`) that nobody knows about **will get you disqualified** if a judge inspects the code.

**The winning approach:** Ship the stub with complete transparency + a real architectural proof.

### C.2 — Update `verifier/mod.rs` with transparent stub + real test

```rust
//! ## HACKATHON DISCLOSURE — Verification Status
//! 
//! `verify_step_1` and `verify_step_2` currently return `Ok(true)` as a stub.
//! This is an INTENTIONAL, DOCUMENTED architectural scaffold for the hackathon.
//! 
//! The full KZG verifier for UltraHonk is a ~3000-line BPF Rust implementation.
//! The Barretenberg team (Aztec) has not yet shipped a Solana-native BPF build.
//! 
//! What IS real in this submission:
//!   • The circuit (circuits/voucher_noir/) is a real compiled Noir program
//!   • UltraHonk proofs ARE generated client-side using bb.js  
//!   • Proof bytes ARE stored in the VerificationSession PDA
//!   • The nullifier IS checked against the on-chain NullifierAccount registry
//!   • Double-spend prevention IS enforced (nullifier PDA init_if_needed)
//!   • The Merkle root IS validated against VaultState.merkle_root
//! 
//! What the stub skips: the BN254 KZG polynomial opening verification.
//! This is equivalent to "trust the prover" — acceptable for a demo but not production.
//! 
//! Production path: port Barretenberg's `ultra_honk_verifier` to no_std BPF Rust.
//! Reference: https://github.com/AztecProtocol/barretenberg/tree/master/cpp/src/barretenberg/ultra_honk

pub fn verify_step_1(/* ... */) -> Result<()> {
    // STUB: Returns Ok(true) — see module doc above.
    // Real implementation: parse UltraHonk constraint system, compute Fiat-Shamir transcript
    msg!("[verifier] STUB: proof structure accepted (KZG check not implemented)");
    
    // What we DO check:
    // 1. proof_data.len() >= MIN_PROOF_SIZE
    require!(ctx.accounts.session.proof_data.len() >= 400, CivitasError::ProofTooShort);
    // 2. keccak256(proof_data) == session.proof_hash (integrity guard)
    let computed_hash = keccak::hash(&ctx.accounts.session.proof_data);
    require!(
        computed_hash.to_bytes() == ctx.accounts.session.proof_hash,
        CivitasError::ProofHashMismatch
    );
    // 3. Nullifier has not been seen before (anti-double-spend)
    // (enforced by nullifier_account init_if_needed — if PDA already exists, TX fails)
    
    Ok(())
}
```

### C.3 — Add a `#[cfg(test)]` reference verifier

```rust
#[cfg(test)]
mod reference_verifier {
    use ark_bn254::{Bn254, Fr, G1Affine, G2Affine};
    use ark_groth16::Groth16;

    /// Reference UltraHonk verifier using ark-bn254 (not BPF-safe, tests only).
    /// This proves the circuit is real and verifiable — just not yet on-chain.
    pub fn verify_ultraHonk_proof(proof: &[u8], vk: &[u8], public_inputs: &[Fr]) -> bool {
        // Full arkworks-based verification
        // See: https://github.com/noir-lang/barretenberg/blob/master/acvm-repo/
        todo!("Full KZG verifier — reference implementation for tests")
    }
}
```

### C.4 — Show verifier status in the UI

In the employee claim flow, add a disclosure banner:

```tsx
<div className="flex items-center gap-2 p-3 mb-4 rounded-xl border border-blue-500/20 bg-blue-500/5">
  <Shield className="h-4 w-4 text-blue-400 shrink-0" />
  <p className="text-xs text-white/60">
    ZK proof generated in your browser (UltraHonk / Barretenberg).
    On-chain verification uses a structural stub — full KZG pairing check
    requires porting Barretenberg to BPF Rust (post-hackathon milestone).
    Anti-double-spend via nullifier PDA is enforced unconditionally.
  </p>
</div>
```

### C.5 — Phase C Checklist

- [ ] `verifier/mod.rs` updated with transparent disclosure comment
- [ ] `proof_data.len()` and `keccak256(proof_data) == proof_hash` checks added
- [ ] `#[cfg(test)]` reference verifier stub added
- [ ] UI shows verifier status banner in employee claim flow
- [ ] No hidden stubs — every limitation is documented

---

## Phase D — Nillion Production Hardening
**Priority: MEDIUM — Nillion track requirement**  
**Time estimate: 3 hours**

### D.1 — Verify %allot on salary fields

**File:** `frontend/lib/server/nillion-server.ts`  
**File:** `frontend/app/api/employer/employees/route.ts`

Find all locations where employee records are written to NilDB. Every salary field must use `%allot`:

```typescript
// WRONG (plaintext salary in NilDB)
const record = { salary: 5000, employee_tag: "..." };

// CORRECT (salary is secret-shared)
const record = {
  salary: { "%allot": 5000 },
  employee_tag: "...",  // public — hash of credential
};
```

Search pattern:
```bash
grep -rn "salary" frontend/lib/server/ frontend/app/api/employer/employees/
```

Every `salary` write to NilDB must use `{ "%allot": value }`.

### D.2 — Add Nillion blindfold indicator to UI

In the employer dashboard employee table, show a blindfold icon next to salary column header:

```tsx
<th className="text-left px-4 py-3 text-xs text-white/50 uppercase tracking-wider">
  <div className="flex items-center gap-1.5">
    Salary
    <span className="text-xs text-violet-400 font-mono" title="Stored as Nillion %allot secret shares">
      %allot
    </span>
  </div>
</th>
```

### D.3 — Fix nilCC API format (if endpoint is live)

**File:** `frontend/lib/server/nilcc-client.ts`

Verify the workload API format matches the Nillion Nucleus documentation. The `submitPayrollJob` function must use:

```typescript
const body = {
  name: `civitas-payroll-${runId}`,
  // Use your Nucleus dashboard image identifier
  image: process.env.NILCC_COMPUTE_IMAGE ?? "civitas-payroll-compute:latest",
  input: manifest,
};
```

If `NILCC_CLUSTER_URL` is not set (local dev), the fallback must log a **yellow warning** — not crash:

```typescript
if (!isNilCCConfigured()) {
  console.warn("[nilCC] Not configured — using local Poseidon compute. TEE badge will show amber.");
  return computeLocalPayroll(manifest);
}
```

### D.4 — Phase D Checklist

- [ ] Every salary write to NilDB uses `{ "%allot": salary }` 
- [ ] Employer dashboard shows `%allot` indicator next to salary column
- [ ] nilCC fallback shows amber badge (not silent)
- [ ] `NILCC_CLUSTER_URL` and `NILCC_SIGNING_KEY` documented in `.env.local.example`

---

## Phase E — UI/UX Redesign (World-Class Payroll)
**Priority: HIGH — Judging is visual. This is what wins.**  
**Time estimate: 12 hours**

This is where Civitas goes from "interesting demo" to "I want to use this product."

### E.1 — Privacy Layer Visualizer (New Component)

**New file:** `frontend/components/ui/privacy-stack.tsx`

An animated, interactive component showing the 5-layer privacy stack. Placed on the landing page hero section and the employer/employee dashboards.

```tsx
/**
 * Animated vertical stack of privacy layers.
 * Each layer pulses with data flowing through it.
 */
export function PrivacyStackVisualizer({ activeLayer }: { activeLayer?: number }) {
  const layers = [
    { icon: "🔐", label: "Nillion nilDB", sublabel: "%allot secret shares", color: "violet" },
    { icon: "🧠", label: "Nillion nilCC TEE", sublabel: "Enclave computation", color: "purple" },
    { icon: "🔏", label: "Noir UltraHonk ZK", sublabel: "Anonymous claiming", color: "blue" },
    { icon: "⚡", label: "MagicBlock Private Pay", sublabel: "Sealed amount transfer", color: "amber" },
    { icon: "🛡️", label: "Cloak Pool", sublabel: "Unlinkable settlement", color: "emerald" },
  ];

  return (
    <div className="flex flex-col gap-1.5">
      {layers.map((layer, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.1 }}
          className={cn(
            "flex items-center gap-3 px-4 py-2.5 rounded-xl border transition-all",
            activeLayer === i
              ? `border-${layer.color}-500/60 bg-${layer.color}-500/10`
              : "border-white/5 bg-white/[0.02]"
          )}
        >
          <span className="text-lg">{layer.icon}</span>
          <div>
            <p className="text-xs font-bold text-white/90">{layer.label}</p>
            <p className="text-[10px] text-white/40">{layer.sublabel}</p>
          </div>
          {activeLayer === i && (
            <motion.div
              className="ml-auto h-1.5 w-1.5 rounded-full bg-current"
              animate={{ scale: [1, 1.5, 1] }}
              transition={{ repeat: Infinity, duration: 1 }}
            />
          )}
        </motion.div>
      ))}
    </div>
  );
}
```

### E.2 — Employer Dashboard Redesign

**File:** `frontend/components/employer/employer-dashboard.tsx`

Key UX improvements:

1. **Vault balance card** — Show vault balance prominently with a "Fund Vault" CTA when low
2. **One-click payroll** — "Run Payroll" mega-button that opens the wizard
3. **Privacy score meter** — Shows which privacy layers are active (Nillion, MagicBlock, Cloak)
4. **Recent activity feed** — Live updates on payroll commits and employee claims
5. **Employee count / coverage** — "12/15 employees covered this cycle"

```tsx
// Vault Overview Card — top of employer dashboard
<div className="grid grid-cols-3 gap-4 mb-6">
  <StatCard 
    label="Vault Balance" 
    value={`${(vaultBalance / 1_000_000).toFixed(2)} USDC`}
    icon={<DollarSign />}
    accent="emerald"
    action={<button onClick={openFundModal}>+ Fund</button>}
  />
  <StatCard 
    label="Active Employees" 
    value={employeeCount.toString()}
    icon={<Users />}
    accent="blue"
  />
  <StatCard 
    label="Privacy Stack"
    value={`${activePrivacyLayers}/5 layers`}
    icon={<Shield />}
    accent="violet"
    action={<PrivacyStackBadges layers={activePrivacyLayers} />}
  />
</div>
```

### E.3 — Employee Dashboard Redesign

**File:** `frontend/components/employee/employee-dashboard.tsx`

Key UX improvements:

1. **Earnings timeline** — Visual timeline of past payments
2. **Claim status flow** — 5-step stepper showing proof generation progress
3. **Privacy mode toggle** — "Shield to Cloak after claim" preference
4. **Pending amount display** — Show "~$X.XX pending" (approximation, not exact)
5. **Credential health indicator** — "Credential valid · Last used 2 days ago"

```tsx
// Claim Status Stepper
const claimSteps = [
  { id: "fetch-path", label: "Fetch Merkle Path", icon: <Database /> },
  { id: "generate-proof", label: "Generate ZK Proof", icon: <Cpu /> },
  { id: "submit-tx-a", label: "Verify On-Chain", icon: <Shield /> },
  { id: "private-pay", label: "Private Payment", icon: <Zap /> },   // NEW — MagicBlock
  { id: "shield-cloak", label: "Shield to Cloak", icon: <Lock /> },
];

<div className="flex items-center gap-2 mb-6">
  {claimSteps.map((step, i) => (
    <Fragment key={step.id}>
      <div className={cn(
        "flex items-center gap-2 px-3 py-2 rounded-lg text-xs",
        currentStep === step.id ? "bg-blue-500/20 text-blue-400 border border-blue-500/30" :
        completedSteps.includes(step.id) ? "bg-emerald-500/10 text-emerald-400" :
        "text-white/20"
      )}>
        {step.icon}
        <span>{step.label}</span>
      </div>
      {i < claimSteps.length - 1 && (
        <ChevronRight className="h-3 w-3 text-white/20 shrink-0" />
      )}
    </Fragment>
  ))}
</div>
```

### E.4 — Payroll Wizard Redesign

**File:** `frontend/components/employer/create-payroll-wizard.tsx`

The wizard is already functional but needs visual polish:

1. **Step indicators** — Numbered circles with connecting lines
2. **Privacy layer progress** — Which layers are engaged at each step
3. **MagicBlock PER badge** — Amber animated badge during ER processing
4. **Real-time employee list** — Shows each commitment being processed
5. **Merkle root display** — Show the computed root as it finalizes

```tsx
// Commitment processing feed (step 4 — Commit)
<div className="space-y-1 max-h-48 overflow-y-auto">
  {commitments.map((c, i) => (
    <motion.div
      key={c}
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: i * 0.05 }}
      className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/5"
    >
      <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" />
      <span className="text-xs font-mono text-white/50 truncate">
        {c.slice(0, 16)}…{c.slice(-8)}
      </span>
      <span className="ml-auto text-[10px] text-white/30">PER</span>
    </motion.div>
  ))}
</div>
```

### E.5 — Landing Page Hero Section Upgrade

**File:** `frontend/app/page.tsx` and `frontend/components/landing/landing-hero.tsx`

1. **Add animated privacy stack visualizer** to the hero section
2. **Replace static stats** with animated counters
3. **Add "Watch Demo" button** linking to the submission video
4. **Add MagicBlock + Nillion + Cloak partner logos** in the tech section
5. **Update headline** to address the Token-2022 CT issue directly:

```tsx
// Hero headline
<h1>
  Private Payroll.<br />
  <span className="text-gradient">On Solana. Today.</span>
</h1>
<p className="text-white/60 max-w-lg">
  While Token-2022 Confidential Transfers are under security audit, 
  Civitas delivers production-grade payroll privacy through a 5-layer 
  stack — powered by Nillion, MagicBlock, and Noir.
</p>
```

### E.6 — Global design tokens

**File:** `frontend/app/globals.css`

Add missing design tokens for consistency:

```css
:root {
  /* Privacy layer accent colors */
  --clr-nillion: #8b5cf6;   /* violet */
  --clr-magicblock: #f59e0b; /* amber */
  --clr-cloak: #10b981;      /* emerald */
  --clr-noir: #3b82f6;       /* blue */
  
  /* Gradient presets */
  --gradient-privacy: linear-gradient(135deg, var(--clr-nillion), var(--clr-noir), var(--clr-magicblock));
  --gradient-brand: linear-gradient(135deg, #8b5cf6 0%, #3b82f6 50%, #10b981 100%);
}

.text-gradient {
  background: var(--gradient-brand);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

/* Privacy layer card hover effect */
.privacy-card {
  backdrop-filter: blur(12px);
  transition: border-color 200ms, background-color 200ms, transform 150ms;
}
.privacy-card:hover {
  transform: translateY(-2px);
}
```

### E.7 — Phase E Checklist

- [ ] `PrivacyStackVisualizer` component created and placed on landing hero
- [ ] Employer dashboard shows vault balance, employee count, privacy score
- [ ] Employee dashboard has 5-step claim stepper with MagicBlock step
- [ ] Payroll wizard shows commitment feed during ER processing
- [ ] Landing hero updated with new headline addressing Token-2022 CT
- [ ] Design tokens added to `globals.css`
- [ ] Mobile responsive on all new components (test at 375px)

---

## Phase F — Begin-Claim / Complete-Withdrawal Real Implementation
**Priority: HIGH — Demo must actually work**  
**Time estimate: 6 hours**

### F.1 — Complete the `begin_verification` Anchor instruction encoding

**File:** `frontend/app/employees/page.tsx` (lines ~278-420)

The current implementation uses a 400-byte stub proof. The REAL flow after MagicBlock Private Payments integration is:

1. Employee generates UltraHonk proof (`generateRedemptionProof`)
2. Proof bytes are stored in session storage
3. `begin_verification` tx sends the proof to the Anchor program
4. Program stores proof in `VerificationSession` PDA
5. Instead of `complete_withdrawal` doing a direct transfer (which reveals amounts),
   it now signals to the MagicBlock private session to release the sealed payment

Update `handleClaimVoucher` to properly encode the Anchor instruction:

```typescript
// Proper Anchor discriminator
const ix_discriminator = Buffer.from(
  crypto.createHash("sha256")
    .update("global:begin_verification")
    .digest()
    .slice(0, 8)
);

// Encode VerificationPublicInputs (Borsh layout matching state.rs)
const publicInputsEncoded = encodePublicInputsBorsh({
  domainTag: Buffer.from("civitas-devnet-v1", "utf8").slice(0, 32),
  merkleRoot: proofResult.merkleRoot,
  epoch: BigInt(voucher.epoch!),
  runId: voucher.runId!,
  programId: PROGRAM_ID.toBase58(),
  vaultPda: vaultPdaAddress,
  usdcMint: process.env.NEXT_PUBLIC_USDC_MINT!,
  recipientAta: recipientAtaAddress,
  amount: BigInt(voucher.amount!),
});
```

### F.2 — Implement `encodePublicInputsBorsh`

**New file:** `frontend/lib/borsh-encode.ts`

```typescript
import { PublicKey } from "@solana/web3.js";

/**
 * Encodes VerificationPublicInputs matching the Anchor program's Borsh layout.
 * See: programs/civitas-payroll/src/state.rs VerificationPublicInputs
 */
export function encodePublicInputsBorsh(params: {
  domainTag: Buffer;          // [u8; 32]
  merkleRoot: string;         // as 32-byte LE
  epoch: bigint;              // u64 LE
  runId: string;              // UUID as [u8; 16]
  programId: string;          // Pubkey [u8; 32]
  vaultPda: string;           // Pubkey [u8; 32]
  usdcMint: string;           // Pubkey [u8; 32]
  recipientAta: string;       // Pubkey [u8; 32]
  amount: bigint;             // u64 LE
}): Buffer {
  const domainTagBuf = Buffer.alloc(32, 0);
  params.domainTag.copy(domainTagBuf, 0, 0, Math.min(32, params.domainTag.length));

  const merkleRootBuf = fieldToBytesLE(BigInt(params.merkleRoot));
  
  const epochBuf = Buffer.alloc(8);
  epochBuf.writeBigUInt64LE(params.epoch);
  
  const runIdBuf = Buffer.alloc(16);
  // UUID string → bytes
  const uuidHex = params.runId.replace(/-/g, "");
  Buffer.from(uuidHex, "hex").copy(runIdBuf);
  
  const amountBuf = Buffer.alloc(8);
  amountBuf.writeBigUInt64LE(params.amount);

  return Buffer.concat([
    domainTagBuf,
    merkleRootBuf,
    epochBuf,
    runIdBuf,
    new PublicKey(params.programId).toBuffer(),
    new PublicKey(params.vaultPda).toBuffer(),
    new PublicKey(params.usdcMint).toBuffer(),
    new PublicKey(params.recipientAta).toBuffer(),
    amountBuf,
  ]); // Total: 32+32+8+16+32+32+32+32+8 = 224 bytes
}

function fieldToBytesLE(value: bigint): Buffer {
  const buf = Buffer.alloc(32);
  let tmp = value;
  for (let i = 0; i < 32; i++) {
    buf[i] = Number(tmp & BigInt(0xff));
    tmp >>= BigInt(8);
  }
  return buf;
}
```

### F.3 — Phase F Checklist

- [ ] `lib/borsh-encode.ts` created with `encodePublicInputsBorsh`
- [ ] `handleClaimVoucher` uses real Anchor discriminator encoding
- [ ] Proof bytes are properly sized (full UltraHonk proof, not 400-byte stub)
- [ ] The `complete_withdrawal` step triggers MagicBlock private payment disbursement
- [ ] End-to-end claim flow tested on devnet

---

## Phase G — SNS Domain Integration (Complete the UI)
**Priority: MEDIUM — MagicBlock + SNS sub-track**  
**Time estimate: 2 hours**

### G.1 — Add SNS input to vault init modal

**File:** `frontend/components/fund-deploy-modal.tsx`

```tsx
// Add after vault name input:
<div className="space-y-2">
  <label className="text-xs text-white/50 uppercase tracking-wider">
    SNS .sol Domain (optional)
  </label>
  <div className="flex gap-2">
    <input
      type="text"
      placeholder="yourcompany (without .sol)"
      value={snsDomain}
      onChange={(e) => setSnsDomain(e.target.value)}
      className="flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-white/30 focus:border-violet-500/50 focus:outline-none"
    />
    <button
      onClick={handleSnsLookup}
      disabled={!snsDomain || snsLoading}
      className="px-4 rounded-xl border border-violet-500/30 text-violet-400 text-sm hover:bg-violet-500/10 transition-all"
    >
      Verify
    </button>
  </div>
  {snsStatus && (
    <p className={cn(
      "text-xs",
      snsStatus.valid ? "text-emerald-400" : "text-red-400"
    )}>
      {snsStatus.message}
    </p>
  )}
</div>
```

### G.2 — Show SNS domain in employer dashboard header

```tsx
{vaultState?.sns_domain && (
  <div className="flex items-center gap-1.5 text-xs text-violet-300">
    <Globe className="h-3 w-3" />
    <span className="font-mono">{vaultState.sns_domain}.sol</span>
    <ExternalLink className="h-3 w-3 opacity-50" />
  </div>
)}
```

---

## Phase H — Demo Preparation & Submission
**Priority: CRITICAL — This is the deliverable**  
**Time estimate: 6 hours**

### H.1 — Full end-to-end demo script (5 minutes max)

```
[0:00] HOOK: "Token-2022 Confidential Transfers are disabled. Here's Civitas — 
             it doesn't need them."

[0:20] Employer connects wallet → Access Portal
[0:30] Vault initialized → shows SNS domain (company.sol), vault balance
[0:45] Add employees → salary stored with %allot badge

[1:00] Generate Payroll Run:
       → nilCC TEE badge glows GREEN
       → "Computed inside Nillion enclave — amounts never left the secure enclave"

[1:20] Commit via MagicBlock PER:
       → "Step 1/3 — Delegating to Permissioned Ephemeral Rollup"
       → Commitment feed scrolls — 12 commitments processed
       → "Step 2/3 — Processing in private ER session"
       → "Step 3/3 — Finalizing on Solana L1"
       → 2 wallet signatures. Not 12.

[1:50] Init Private Payment session:
       → "MagicBlock Private Payments session active"
       → Session ID shown

--- switch to employee browser tab ---

[2:10] Employee imports credential → sees pending voucher
[2:20] Claim: 
       → "Step 1/5 — Fetching Merkle path"
       → "Step 2/5 — Generating ZK proof (~15s)" — progress bar fills
       → "Step 3/5 — Verifying on Solana"
       → "Step 4/5 — MagicBlock Private Payment" ← THE MONEY SHOT
       → "Step 5/5 — Shield to Cloak pool"
       → Claim success badge

[3:00] Show Solana Explorer:
       → NullifierAccount PDA exists (prevents double-spend)
       → Transaction shows transfer happened — no amount visible
       
[3:15] Attempt double-spend → "Nullifier already spent" error

[3:30] Employer generates Cloak viewing key → shares with auditor
       Auditor sees aggregate disbursement, not individual amounts

[4:00] Privacy stack graphic: All 5 layers lit green
       "This is what private payroll looks like on Solana."

[4:30] END
```

### H.2 — Track submission narratives

**MagicBlock Track ($5K USDC):**
> Civitas integrates MagicBlock in two distinct ways:
> 1. **Permissioned Ephemeral Rollups (PERs)** — Payroll commitment data is processed in a PER session where only the employer's wallet can read state during processing. 12 commitment chunks execute with zero fees. The employer signs twice (delegate + finalize) instead of 13 times.
> 2. **MagicBlock Private Payments** — This is our direct response to Token-2022 Confidential Transfers being disabled on devnet and mainnet. MagicBlock Private Payments provides equivalent payment amount privacy via sealed ER sessions. Employees receive exact salaries without the amount being visible in Solana transaction logs.
> 
> Civitas is the only payroll application demonstrating both ER UX optimization AND Private Payments as a CT replacement in a single coherent product.

**Nillion Track:**
> Civitas implements the full Nillion Nucleus stack: nilDB for %allot secret-shared salary storage, nilCC TEE for on-enclave payroll computation (Poseidon BN254 commitment generation), and a TEE attestation badge in the employer UI that distinguishes between enclave computation and local fallback. Employee salary amounts are stored as encrypted secret shares — no single Nillion node can read a salary amount.

**Cloak Track:**
> Civitas implements Cloak as Layer 5 of a 5-layer privacy stack. After claiming salary via ZK proof + MagicBlock Private Payment, employees can optionally shield received funds in Cloak's UTXO pool. The transaction graph becomes unlinkable on-chain. Employers share Cloak viewing keys with auditors for compliance verification without exposing individual salary amounts. This provides the deepest possible privacy guarantee achievable on Solana today.

### H.3 — Final submission checklist

**Core functionality:**
- [ ] Employer vault init with SNS domain
- [ ] Employee salary storage with `%allot` indicator
- [ ] Payroll generation with nilCC TEE badge (green/amber)
- [ ] Payroll commit via MagicBlock PER (2 sigs, commitment feed visible)
- [ ] Employee ZK proof generation (real UltraHonk, progress bar)
- [ ] MagicBlock Private Payment disbursement (amount sealed)
- [ ] Cloak shield after claim
- [ ] Double-spend prevention demonstrated
- [ ] Auditor viewing key generation

**Technical honesty (judges check code):**
- [ ] No false Token-2022 CT claims anywhere in UI or code
- [ ] ZK verifier stub is documented with `#[cfg(not(feature = "stub"))]` guard  
- [ ] All limitations clearly documented in `verifier/mod.rs`
- [ ] `README.md` has architecture diagram + limitation disclosure

**Demo assets:**
- [ ] 4-5 minute screen recording following H.1 script
- [ ] GitHub repo public with clean `README.md`
- [ ] Anchor program IDL in repo
- [ ] `.env.local.example` with all required variables
- [ ] Architecture diagram (draw.io or Excalidraw export)

---

## Appendix — Environment Variables (Complete Reference)

```bash
# Solana
NEXT_PUBLIC_SOLANA_CLUSTER=devnet
NEXT_PUBLIC_SOLANA_RPC=https://api.devnet.solana.com
NEXT_PUBLIC_CIVITAS_PROGRAM_ID=CQW3TnN4X6iG2potguVv2hCKfk4f9tf8PMG7dTV6e24y
NEXT_PUBLIC_USDC_MINT=9pan9bMn5HatX4EJdBwg9VgCa7Uz5HL8N1m5D3NdXejP

# MagicBlock
NEXT_PUBLIC_MAGICBLOCK_ROUTER=https://devnet-router.magicblock.app
NEXT_PUBLIC_MAGICBLOCK_PER_ENDPOINT=https://devnet-router.magicblock.app/per

# Nillion (from Nucleus dashboard)
NILLION_ORG_SECRET_KEY=
NILCC_CLUSTER_URL=
NILCC_SIGNING_KEY=

# Cloak
NEXT_PUBLIC_CLOAK_PROGRAM_ID=zh1eLd6rSphLejbFfJEneUwzHRfMKxgzrgkfwA6qRkW

# App
NEXT_PUBLIC_CIVITAS_DOMAIN_TAG=civitas-devnet-v1
```

---

## Priority Execution Order

Execute phases in this order. Do NOT start a new phase before the previous one builds cleanly.

```
A → F → B → C → D → E → G → H
```

| Phase | Why this order |
|-------|----------------|
| **A** — MagicBlock Private Payments | Core feature. Everything else demonstrates it. |
| **F** — Real Anchor IX encoding | Demo must actually send real transactions. |
| **B** — PERs upgrade | Deepen MagicBlock integration for judges. |
| **C** — ZK verifier transparency | Fixes biggest technical credibility risk. |
| **D** — Nillion hardening | Completes Nillion track requirements. |
| **E** — UI/UX redesign | Polish after all logic works. |
| **G** — SNS UI completion | Small win, do late. |
| **H** — Demo + submission | Last thing before deadline. |

**Total estimate: ~49 hours of focused work.**  
With 2 developers: achievable in 3-4 days before submission.

---

*Civitas V2 Implementation Plan — Internal — Do not share before submission*
