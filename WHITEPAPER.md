# CIVITAS

## Private Payroll Settlement Protocol on Solana

**Version 3.0 — Solana Mainnet Architecture**
**Date:** May 2026
**Network:** Solana Devnet (Mainnet-Beta target)
**Settlement Asset:** USDC (Token-2022, Confidential Transfer extension)
**ZK Stack:** circom 2.1.6 · Groth16 · BN254 · Solana `alt_bn128_pairing`
**Confidential Storage:** Nillion nilDB (`%allot` secret-shared columns)
**Confidential Compute:** Nillion nilCC (AMD SEV-SNP TEE)
**Settlement Privacy:** MagicBlock Private Ephemeral Rollup (TEE-validated)
**Authentication:** Privy · Phantom · Solflare
**Identity:** Solana Name Service (`.sol`) vault binding
**Program ID:** `CQW3TnN4X6iG2potguVv2hCKfk4f9tf8PMG7dTV6e24y`

---

## Abstract

Civitas is a zero-knowledge payroll settlement protocol that decouples salary confidentiality from settlement finality on Solana. Employers compute payroll obligations inside a hardware-attested AMD SEV-SNP enclave (Nillion nilCC) and publish only Poseidon BN254 commitments organised into a depth-20 Merkle tree, persisted to a secret-shared Nillion nilDB cluster. Employees redeem salary vouchers by submitting 256-byte Groth16 proofs verified directly on-chain via Solana's native `alt_bn128_pairing` syscalls — a single Anchor instruction (`claim_payment`) that runs the pairing check, registers a nullifier PDA, and emits a domain-bound public-input commitment. The actual USDC movement is then dispatched through MagicBlock's TEE-validated Private Ephemeral Rollup, which splits and randomly delays the settlement so the payroll-vault → recipient transfer is never directly linkable to the on-chain ZK gate. This document specifies the protocol's cryptographic model, on-chain program, off-chain data plane, settlement layer, security analysis, and operational lifecycle.

---

## 1. Introduction

### 1.1 The Payroll Privacy Problem

On-chain payroll has, until now, faced an unresolved trilemma: **transparency, privacy, and settlement integrity** could not be simultaneously achieved without trusting an off-chain processor. A traditional payroll provider must possess plaintext salary data to execute disbursements, exposing the entire compensation table to a single privileged operator. A naïve on-chain payroll — depositing USDC into employee wallets directly — guarantees integrity but broadcasts every salary publicly, exposing burn rates, contributor identities, and personal financial activity to anyone with a block explorer.

The cryptographic primitives required to fix this — pairing-based SNARKs, hardware enclaves, secret-shared databases, encrypted-balance token standards, and TEE-validated mixing — only recently became composable on a single L1. Civitas is the first protocol to assemble these into a single end-to-end payroll system natively on Solana.

### 1.2 Design Goals

| Property | Requirement |
|---|---|
| **Salary Confidentiality** | Per-employee salary amounts never appear in plaintext outside the AMD SEV-SNP enclave or the employee's own client. |
| **Identity Confidentiality** | The employee's master credential nonce is never transmitted, stored, or escrowed; it lives exclusively in the browser. |
| **Settlement Integrity** | Every USDC transfer is gated by a Groth16 BN254 proof verified on-chain through Solana's `alt_bn128_pairing` syscalls. |
| **Double-Spend Prevention** | Each commitment is redeemable at most once via an append-only nullifier PDA registry. |
| **Settlement Unlinkability** | The on-chain claim and the actual USDC movement are decoupled by a TEE-cranked private transfer queue with randomised split and delay. |
| **Operator Independence** | Once commitments are finalised on-chain, employees claim their salaries unilaterally — no further employer interaction required. |
| **Auditor Verifiability** | Any third party can prove that a payroll batch was processed in protocol without learning per-employee amounts. |
| **Hardware-Attested Compute** | Payroll commitment generation runs inside an AMD SEV-SNP enclave with cryptographic attestation. |
| **Wallet Universality** | Supports Privy embedded wallets, Phantom, Solflare, and any wallet adapter conforming to Solana's wallet standard. |

**Table 1.** Civitas core design goals.

### 1.3 Key Innovations

1. **Single-transaction ZK claim.** Civitas's Groth16 proof is exactly 256 bytes and its verification key is 580 bytes — both fit inside the Solana 1232-byte transaction limit. The entire claim — proof verification, nullifier PDA initialisation, and event emission — completes in one Anchor instruction.
2. **Native pairing on Solana.** Civitas uses Solana's first-class `alt_bn128_pairing`, `alt_bn128_addition`, and `alt_bn128_multiplication` syscalls. The full Groth16 verifier consumes ~175,000 compute units — well within the per-transaction 1.4M budget.
3. **Domain-bound public-input commitment.** Public inputs (recipient ATA, amount, epoch, mint, vault PDA, program ID, run ID, deployment domain tag) are folded into a single field element `pi_hash` via a 10-input SpongePoseidon. The handler recomputes `pi_hash` from authoritative on-chain state before invoking the verifier — a single forged or replayed field is rejected.
4. **Hardware-attested payroll computation.** Salary computation, commitment derivation, and Merkle root construction execute inside an AMD SEV-SNP confidential VM (Nillion nilCC). The enclave's attestation report cryptographically binds the code measurement to the result.
5. **TEE-validated settlement privacy.** The actual USDC settlement is dispatched through MagicBlock's Private Ephemeral Rollup, where a TEE-fronted validator schedules a configurable number of split transfers with randomised delays in `[500ms, 30s]` — breaking the chronological link between claim and payout.
6. **Token-2022 confidential vault.** Employer treasuries hold USDC in Token-2022 confidential vault accounts, leveraging the ConfidentialTransfer extension for ElGamal-encrypted balance accounting on the base layer.

---

## 2. System Architecture

Civitas comprises **four cooperating privacy layers** on Solana, plus the on-chain enforcement layer that anchors everything to a single Anchor program.

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 1 — Confidential Storage   :  Nillion nilDB          │
│            secret-shared salary records, %allot encryption  │
├─────────────────────────────────────────────────────────────┤
│  Layer 2 — Confidential Compute   :  Nillion nilCC          │
│            AMD SEV-SNP TEE — payroll commitment generation  │
├─────────────────────────────────────────────────────────────┤
│  Layer 3 — ZK Anonymous Claim     :  circom + snarkjs +     │
│            Solana alt_bn128_pairing on-chain Groth16 verify │
├─────────────────────────────────────────────────────────────┤
│  Layer 4 — Settlement Privacy     :  MagicBlock Private     │
│            Ephemeral Rollup, TEE-cranked split + delay      │
├─────────────────────────────────────────────────────────────┤
│  ── Anchored on ──                                          │
│  Solana civitas-payroll Program (Token-2022 vault, PDAs,    │
│   nullifier registry, Merkle commitment chain)              │
└─────────────────────────────────────────────────────────────┘
```

**Figure 1.** Civitas four-layer privacy architecture, anchored to a single Solana Anchor program.

### 2.1 End-to-End Flow

```
EMPLOYER                                                       EMPLOYEE
   │                                                              │
   │  1. initialize_vault(sns_domain)                             │
   │  2. deposit_usdc(amount)  — Token-2022 confidential          │
   │  3. nilCC TEE: compute commitments + Merkle root             │
   │  4. start_payroll_run(run_id, epoch, n)                      │
   │  5. append_commitments_chunk × ⌈n/32⌉                        │
   │  6. finalize_merkle_root(run_id, root)                       │
   │  7. write encrypted vouchers to nilDB                        │
   │                                          ─────────────────►  │
   │                                                              │
   │                                          8. fetch encrypted  │
   │                                             voucher (nilDB)  │
   │                                          9. generate Groth16 │
   │                                             proof in browser │
   │                                                              │
   │                                          10. claim_payment   │
   │  ◄─────────────────────────────────────────  on-chain (ZK)   │
   │                                                              │
   │  11. dispatcher: recompute pi_hash, build                    │
   │      MagicBlock Private Pay tx (split N, delay ms)           │
   │                                                              │
   │  12. TEE validator cranks N delayed splits to                │
   │      employee USDC ATA                          ──────────►  │
```

**Figure 2.** End-to-end payroll lifecycle.

### 2.2 Component Map

| Component | Technology | Role |
|---|---|---|
| **`civitas-payroll` Anchor program** | Solana Rust / Anchor 0.30.x | Vault PDA, payroll runs, commitment chain, nullifier registry, on-chain Groth16 verification, Token-2022 deposits, contractor invoices. |
| **Token-2022 USDC vault** | Solana SPL Token-2022 | Confidential employer treasury — vault ATA holds ElGamal-encrypted USDC balances. |
| **circom voucher circuit** | circom 2.1.6 + circomlib | `circuits/voucher_circom/voucher.circom` — Poseidon BN254, depth-20 Merkle, SpongePoseidon(10) public-input binding. |
| **snarkjs prover** | snarkjs Groth16 | Browser proof generation with the compiled `voucher.wasm` (3.1 MB) + `voucher_final.zkey` (8.4 MB). |
| **On-chain Groth16 verifier** | Native `alt_bn128_*` syscalls | `programs/civitas-payroll/src/verifier/groth16.rs` — pairing check `e(-A,B)·e(α,β)·e(L_pub,γ)·e(C,δ) = 1`. |
| **Nillion nilDB** | SecretVaults v2, 3-of-3 staging cluster | Secret-shared encrypted storage of employee tags, vouchers, and payroll-run metadata. |
| **Nillion nilCC** | AMD SEV-SNP CVM | Hardware-attested payroll commitment generator; salary plaintext never leaves the encrypted VM boundary. |
| **MagicBlock Private Payments** | `@magicblock-labs/ephemeral-rollups-sdk` v0.12 | TEE-validated ER for split + delayed private USDC transfers. |
| **Solana Name Service** | Bonfida `@bonfida/spl-name-service` | `.sol` domain binding to employer vaults, human-readable identity. |
| **Privy** | `@privy-io/react-auth` | Embedded wallet + email/social login for web2-native onboarding. |
| **Phantom / Solflare** | Wallet Standard | Native Solana wallets for crypto-native users. |
| **Client credential store** | IndexedDB | Master credential nonce η lives exclusively in the browser; never transmitted. |

**Table 2.** Civitas component inventory, real packages and program IDs.

---

## 3. Cryptographic Model

### 3.1 Field

All cryptographic operations execute over the **BN254 scalar field** `F_p` where `p = 21888242871839275222246405745257275088548364400416034343698204186575808495617`. This single-field design eliminates the cross-field bridging logic of legacy Civitas builds: the circom circuit, the on-chain `light-poseidon` instance, and the off-chain SpongePoseidon used by the dispatcher all evaluate Poseidon over the same `F_p` with identical round constants and MDS matrix (Bn254X5).

### 3.2 Hash Function

All hashing uses **Poseidon over BN254** with circomlib parameters (8 full rounds + 57 partial rounds, MDS matrix from circomlibjs). Three arities are used:

- `Poseidon₁(x)` — employee tag derivation
- `Poseidon₃(x, y, z)` — nullifier derivation
- `Poseidon₄(w, x, y, z)` — voucher commitment derivation

For the public-input commitment a stateful sponge construction `SpongePoseidon(10)` absorbs ten field elements and produces one output:

```
SpongePoseidon(x₁, …, x₁₀) := Poseidon₂(…Poseidon₂(Poseidon₂(0, x₁), x₂)…, x₁₀)
```

The on-chain `light-poseidon` syscall, the client-side `bn128-poseidon.ts`, and the dispatcher's `pi-hash.ts` are byte-equivalent to this construction.

### 3.3 Core Protocol Relations

Let:

| Symbol | Domain | Meaning |
|---|---|---|
| `η` | `F_p` | Master credential nonce — employee secret, generated client-side |
| `τ` | `F_p` | Employee tag, shared with employer at onboarding |
| `a` | `u64` | Salary amount (USDC base units, 6 decimals) |
| `e` | `u64` | Payroll epoch identifier |
| `ν` | `F_p` | Per-voucher nonce — randomly sampled inside nilCC |
| `C` | `F_p` | Voucher commitment — registered on-chain |
| `N` | `F_p` | Nullifier — published on claim |
| `R` | `F_p` | Merkle root of the payroll run's commitment set |
| `π_hash` | `F_p` | SpongePoseidon binding over the 10 public inputs |

The protocol's three fundamental cryptographic relations:

```
τ := Poseidon₁(η)                         (Employee Tag)
C := Poseidon₄(τ, a, e, ν)                (Voucher Commitment)
N := Poseidon₃(η, e, ν)                   (Spend Nullifier)
```

`τ` is one-way derived from `η`, allowing the employer to address the employee on a payroll run without ever learning the underlying secret. `C` binds together the (tag, amount, epoch, voucher-nonce) tuple into a hiding commitment that goes into the Merkle tree. `N` is computed from the same secret `η` and the per-epoch / per-voucher nonces, giving the employee a deterministic, unforgeable spend token that no one else can predict and that the chain can use as a one-time-spend marker.

### 3.4 Merkle Commitment Tree

All commitments for a payroll run are inserted into a **depth-20 binary Poseidon Merkle tree** with capacity 2²⁰ = 1,048,576 leaves. Internal nodes are computed as `Poseidon₂(left, right)`. The tree is built off-chain inside the nilCC enclave and the resulting root is published on-chain via `finalize_merkle_root`.

The circuit's Merkle membership proof uses a per-level `pathBits[i] ∈ {0, 1}` selector and a `siblings[i]` field to reconstruct the root from a leaf and its authentication path:

```
current[0] = leaf
for i in 0..depth:
    left  = pathBits[i] == 0 ? current[i] : siblings[i]
    right = pathBits[i] == 0 ? siblings[i] : current[i]
    current[i+1] = Poseidon₂(left, right)
root = current[depth]
```

### 3.5 Public-Input Commitment

Civitas binds the proof to the entire claim context via a single-field public input `π_hash`:

```
π_hash := SpongePoseidon(
    merkle_root,
    nullifier,
    recipient_token_account,
    amount,
    epoch,
    mint,
    vault_pda,
    program_id,
    run_id,
    domain_tag                    // "civitas-mainnet-v1" / "civitas-devnet-v1"
)
```

**Field order is binding.** The circuit's SpongePoseidon, the client-side prover's `spongePoseidon` helper, and the dispatcher's `pi-hash.ts` all absorb fields in this exact order. The on-chain handler (`claim_payment.rs`) recomputes `π_hash` from authoritative state — vault PDA, mint, program ID, run-account fields — before invoking the verifier. Any tampering with a single binding field produces a different `π_hash` and the proof is rejected.

The domain tag binds the proof to a specific deployment, defeating cross-network replay attacks at the cryptographic layer rather than relying on operational segregation.

---

## 4. Zero-Knowledge Circuit (`circuits/voucher_circom/voucher.circom`)

Civitas uses **circom 2.1.6** with the `circomlib` Poseidon, bitify, and mux1 templates. The circuit is compiled to a 3.1 MB `voucher.wasm` and a 8.4 MB `voucher_final.zkey` produced by a Powers-of-Tau ceremony (BN254 trusted setup). The verifying key is exported via `snarkjs zkey export verificationkey`, converted to a 580-byte BPF binary by `scripts/vk-to-rust.ts`, and embedded into the on-chain program at compile time.

### 4.1 Circuit Constraints

| Constraint | Definition |
|---|---|
| **C1** | `employee_tag = Poseidon₁(credential_nonce)` |
| **C2** | `commitment = Poseidon₄(employee_tag, amount, epoch, voucher_nonce)` |
| **C3** | `Poseidon₃(credential_nonce, epoch, voucher_nonce) === nullifier` |
| **C4** | `MerkleProofVerify(commitment, siblings, pathBits) === merkle_root` |
| **C5** | `SpongePoseidon₁₀(merkle_root, nullifier, recipient_token_account, amount, epoch, mint, vault_pda, program_id, run_id, domain_tag) === pi_hash` |

### 4.2 Signal Map

| Signal | Visibility | Type | Description |
|---|---|---|---|
| `credential_nonce` | private | Field | Master secret η. Never leaves the browser. |
| `voucher_nonce` | private | Field | Per-voucher randomness ν, decrypted from the nilDB voucher record. |
| `merkle_path[20]` | private | Field[] | Sibling hashes along the Merkle authentication path. |
| `path_index` | private | Field | Integer leaf position (decomposed into pathBits internally). |
| `merkle_root` | private | Field | Recomputed inside the circuit and bound via `pi_hash`. |
| `nullifier` | private | Field | Recomputed inside the circuit and bound via `pi_hash`. |
| `amount` | private | u64 | Salary in USDC base units; bound via `pi_hash`. |
| `epoch` | private | u64 | Epoch index; bound via `pi_hash`. |
| `recipient_token_account` | private | Field | Recipient USDC ATA; bound via `pi_hash`. |
| `mint`, `vault_pda`, `program_id`, `run_id`, `domain_tag` | private | Field | All bound via `pi_hash`. |
| `pi_hash` | **public** | Field | The single public input — the SpongePoseidon over all 10 binding fields. |

**Table 4.** Circuit signal table. The circuit exposes exactly one public input: `pi_hash`.

### 4.3 Proof System Properties

| Property | Guarantee |
|---|---|
| **Completeness** | Any prover holding `(η, ν, path, path_index, …)` satisfying C1–C5 produces an accepting Groth16 proof. |
| **Knowledge Soundness** | An accepting proof implies the prover knows witnesses satisfying the constraint system, under the q-PKE assumption on BN254. |
| **Zero-Knowledge** | The proof reveals nothing about `(η, ν, path, path_index)` beyond what is committed in `pi_hash`. |
| **Succinctness** | Proof size is exactly 256 bytes (G1: 64 B, G2: 128 B, G1: 64 B) regardless of circuit complexity. |
| **Trusted Setup** | Per-circuit setup (Phase 2 of Powers-of-Tau); the verifying key is publicly auditable and embedded in the on-chain program. |

**Table 5.** Groth16 / BN254 proof-system properties as instantiated by Civitas.

---

## 5. Solana Program (`civitas-payroll`)

The on-chain program is the unconditional enforcement layer. All financial invariants — solvency, double-spend prevention, run finalisation, proof validity — hold on-chain regardless of off-chain behaviour. Program ID: **`CQW3TnN4X6iG2potguVv2hCKfk4f9tf8PMG7dTV6e24y`** on Solana Devnet.

### 5.1 Account Layout

| Account | Seeds | Purpose |
|---|---|---|
| `VaultState` | `[b"vault", owner]` | Employer vault — holds Merkle root, run count, USDC vault ATA, optional `.sol` SNS domain. |
| `EmployerRecord` | `[b"employer", wallet]` | Optional display metadata: name, SNS domain, employee count. |
| `PayrollRunAccount` | `[b"run", owner, run_id]` | Tracks one payroll batch: epoch, expected/received chunk count, status (Pending / Committed / Settled). |
| `CommitmentChunkAccount` | `[b"chunk", run_id, chunk_index]` | One bounded slice (≤32 commitments) of an in-progress payroll run, with keccak chunk hash for integrity. |
| `CommitmentAccount` | `[b"commit", commitment_hash]` | Per-commitment record materialised at `finalize_merkle_root` for O(1) commitment-existence checks. |
| `NullifierAccount` | `[b"nullifier", nullifier_hash]` | Spent nullifier — created via `init` so duplicate claims revert atomically. |
| `InvoiceAccount` | `[b"invoice", invoice_id]` | Contractor invoice: commitment to amount, due date, optional metadata CID, status. |

**Table 6.** PDA layout for the `civitas-payroll` program.

### 5.2 Instruction Reference

| Instruction | Caller | Effect |
|---|---|---|
| `initialize_vault(sns_domain)` | Employer | Creates `VaultState` PDA + Token-2022 confidential USDC vault ATA. Optionally binds an SNS `.sol` domain. |
| `deposit_usdc(amount)` | Employer | Deposits USDC into the Token-2022 confidential vault via `apply_pending_balance`. |
| `start_payroll_run(run_id, epoch, expected_count)` | Employer | Opens a new `PayrollRunAccount`, locks the epoch and expected commitment count. |
| `append_commitments_chunk(run_id, chunk_index, commitments[])` | Employer | Appends one ≤32-commitment slice with a keccak integrity hash. Repeated until all chunks received. |
| `finalize_merkle_root(run_id, new_root, chunk_count)` | Employer | Verifies all chunks present, materialises one `CommitmentAccount` per commitment, updates `VaultState.merkle_root`, marks run `Committed`. |
| `claim_payment(proof_bytes, pi_hash, nullifier, run_id)` | **Anyone** (relayer / fresh wallet / employee) | Runs Groth16 verify via `alt_bn128_pairing`, initialises `NullifierAccount` (atomic anti-double-spend), emits `VoucherConsumed`. **No recipient or amount in IX args.** |
| `create_invoice(invoice_id, commitment, due_ts, metadata_cid)` | Contractor | Creates an `InvoiceAccount` with a Poseidon commitment to the amount. |
| `pay_invoice(invoice_id, …)` | Employer | Settles a contractor invoice against the vault. |
| `close_vault()` | Employer | Closes a vault PDA after all runs are settled. |

**Table 7.** `civitas-payroll` instruction set.

### 5.3 The `claim_payment` Instruction in Detail

`claim_payment` is the keystone — the single Anchor instruction that gates every USDC payout.

**Account layout:**
```rust
pub struct ClaimPayment<'info> {
    #[account(mut)] pub submitter: Signer<'info>,           // can be a fresh wallet
    #[account(seeds = [b"run", payroll_run.owner, run_id], …)]
    pub payroll_run: Account<'info, PayrollRunAccount>,     // status must be Committed
    #[account(init, payer = submitter, seeds = [b"nullifier", nullifier], …)]
    pub nullifier_account: Account<'info, NullifierAccount>, // anti-double-spend gate
    pub system_program: Program<'info, System>,
    pub clock: Sysvar<'info, Clock>,
}
```

**Args** (only four — no recipient, no amount):
- `proof_bytes: [u8; 256]` — Groth16 (G1 || G2 || G1)
- `pi_hash: [u8; 32]` — public-input commitment
- `nullifier: [u8; 32]` — Poseidon₃(η, e, ν), recomputed inside the circuit
- `run_id: [u8; 16]` — UUIDv4 of the payroll run

**Handler steps:**
1. `verifier::verify_voucher_proof(&proof_bytes, &pi_hash)` — runs the Groth16 pairing check using the embedded VK and Solana's `alt_bn128_pairing` syscall.
2. `init` of `NullifierAccount` — atomic anti-double-spend; second claim with the same nullifier reverts at PDA creation, before any state change.
3. Records `spent_at = Clock::unix_timestamp` and emits `VoucherConsumed { nullifier, run_id, pi_hash, slot }` for off-chain dispatchers to observe.

The instruction **does not move USDC**. Settlement is intentionally off-chain via MagicBlock Private Payments (Section 7), which lets the actual fund movement be split, delayed, and randomised — completely decoupled from the on-chain ZK gate.

### 5.4 Security Invariants

| # | Invariant | Mechanism | Guarantee |
|---|---|---|---|
| **INV-1** | Nullifier uniqueness | `NullifierAccount` is `init` — Solana System Program errors if PDA already exists. | Second spend of the same voucher unconditionally reverts. |
| **INV-2** | Commitment registration | `CommitmentAccount` materialised only at `finalize_merkle_root`; the circuit's Merkle proof binds the spend to a registered `merkle_root`. | Fabricated commitments cannot redeem. |
| **INV-3** | Run finalisation | `claim_payment` requires `payroll_run.status == Committed`. | No claims against an in-progress or future run. |
| **INV-4** | Authority exclusivity | `start_payroll_run` / `append_commitments_chunk` / `finalize_merkle_root` enforce `payroll_run.owner == owner.key()`. | Only the vault owner can register commitments under their vault. |
| **INV-5** | ZK proof verification | `verify_voucher_proof` runs `alt_bn128_pairing` before any account mutation. | Only valid Groth16 proofs pass. |
| **INV-6** | Public-input binding | Handler recomputes `pi_hash` from authoritative on-chain state (vault PDA, mint, program ID, run ID, domain tag) before pairing. | Forged or replayed `pi_hash` is rejected with `PiHashMismatch`. |
| **INV-7** | Cross-deployment replay | `domain_tag` baked into `pi_hash` at compile time differs per network (`civitas-mainnet-v1` / `civitas-devnet-v1`). | Devnet proofs cannot replay on Mainnet and vice versa. |
| **INV-8** | Vault ownership | `VaultState.owner == owner.key()` checked on every mutating IX. | Cross-vault attacks impossible. |

**Table 8.** On-chain security invariants.

### 5.5 On-Chain Groth16 Verifier

The verifier (`programs/civitas-payroll/src/verifier/groth16.rs`) implements the standard Groth16 pairing equation:

```
e(-A, B) · e(α, β) · e(L_pub, γ) · e(C, δ)  ?=  1
```

where `L_pub = IC[0] + pi_hash · IC[1]` (single-public-input form).

All curve arithmetic uses Solana's native syscalls:

| Operation | Syscall | Cost |
|---|---|---|
| G1 addition | `sol_alt_bn128_addition` | ~150 CU |
| G1 scalar multiplication | `sol_alt_bn128_multiplication` | ~3,840 CU |
| 4-pair pairing check | `sol_alt_bn128_pairing` | ~165,000 CU |

**Total on-chain verification: ~175,000 CU** — comfortably below the 1.4M per-transaction ceiling, leaving ample budget for the surrounding nullifier-init logic and event emission.

The verifying key `keys/voucher_vk.bin` (580 bytes) is embedded via `include_bytes!()` at program build time. Layout:

```
alpha_g1   :  64 B    (α ∈ G1)
beta_g2    : 128 B    (β ∈ G2)
gamma_g2   : 128 B    (γ ∈ G2)
delta_g2   : 128 B    (δ ∈ G2)
ic_len: u32 LE = 2    (1 public input → 2 IC points)
ic[0..1]   : 128 B    (64 B each, EIP-197 layout)
            ─────
total      : 580 B
```

---

## 6. Confidential Storage — Nillion nilDB

Civitas persists every privacy-sensitive record into a **3-of-3 Nillion nilDB cluster** via the SecretVaults v2 client (`@nillion/secretvaults`). Sensitive columns are tagged with `%allot`, which causes the client to perform threshold secret-sharing across the three nodes. **No single nilDB node holds plaintext for any sensitive field.** Decryption requires reconstruction by an authorised builder client holding the org secret key.

### 6.1 Collections

| Collection | Sensitive (`%allot`) Columns | Plaintext Columns | Purpose |
|---|---|---|---|
| `employee_registry` | `salary_amount` | `employee_tag`, `company_id`, `salary_currency`, `status`, `created_at` | Roster of employees indexed by their public tag `τ`. |
| `voucher_store` | `amount`, `voucher_nonce` | `employee_tag`, `epoch`, `commitment`, `company_id`, `status`, `created_at` | One voucher per (employee, epoch). Sensitive amount and nonce are secret-shared. |
| `company_registry` | — | `company_id`, `name`, `owner_address`, `escrow_contract`, `created_at` | Public company metadata. |
| `payroll_runs` | `merkle_root`, `epoch_start`, `epoch_end` | `run_id`, `status`, `created_at` | Per-run metadata; root and epoch encrypted to prevent pre-settlement monitoring. |
| `credential_recovery` | `recovery_blob` | `employee_tag`, `created_at` | Optional employee-encrypted backup of their credential nonce, decryptable only by the employee. |

**Table 9.** nilDB collection schema and encryption posture.

### 6.2 Trust Model

- **Confidentiality:** No single nilDB node ever sees plaintext `amount`, `voucher_nonce`, `salary_amount`, or `merkle_root`. A decrypting client must obtain shares from all three nodes and reconstruct.
- **Authentication:** Every read/write is authenticated with a NUC (Nillion Universal Credential) signed by the org private key; nilauth gates collection access.
- **Integrity:** Each record has an `_id` UUID and a server-assigned creation timestamp; tampering is detectable.
- **Key custody:** The master credential nonce `η` is **never** stored in any system, including nilDB. It lives exclusively in the employee's browser IndexedDB. The optional `credential_recovery` collection stores only an employee-encrypted blob whose key is derived from a passphrase the employee holds.

---

## 7. Confidential Compute — Nillion nilCC TEE

Payroll commitment generation is the most privacy-sensitive computation in Civitas: it requires plaintext access to the entire salary table to compute commitments, sample voucher nonces, and build the Merkle root. Civitas runs this computation inside a **Nillion nilCC AMD SEV-SNP confidential VM**.

### 7.1 SEV-SNP Properties

AMD SEV-SNP (Secure Encrypted Virtualization — Secure Nested Paging) provides:

- **Memory encryption** by the AMD Secure Processor using ephemeral keys inaccessible to the hypervisor or host OS.
- **Memory integrity** via reverse-map tables — the hypervisor cannot replay or remap encrypted pages.
- **Cryptographic attestation** — the Secure Processor generates an attestation report containing the launch measurement (a hash over the workload code + initial memory state) signed by the AMD Versioned Chip Endorsement Key (VCEK), chained to the AMD root of trust (ARK → ASK → VCEK).

### 7.2 Civitas Workloads

| Workload | File | Function |
|---|---|---|
| **Payroll Compute** | `workload/run_compute.js` | Receives encrypted manifest of `(employee_tag, salary)` pairs. Inside the enclave: derives `voucher_nonce ← randombytes`, computes `commitment = Poseidon₄(τ, a, e, ν)`, builds the Poseidon Merkle tree, returns root + per-employee voucher records. Plaintext salaries never leave the CVM. |
| **Blind Onboarding** | `workload/onboard_employee.js` | Generates `η ← randombytes(32)` inside the enclave, derives `τ = Poseidon₁(η)`, returns only `τ` to the employer API; `η` is delivered to the employee out-of-band over an authenticated channel. |
| **Attestation Verifier** | `lib/server/nilcc-attestation.ts` | Validates the attestation report's ARK → ASK → VCEK certificate chain, checks the launch measurement against the pinned workload measurement, and verifies the freshness nonce. |

**Table 10.** nilCC TEE workloads.

### 7.3 Why TEE for Civitas

Civitas's threat model treats the employer's web server as **untrusted for salary plaintext**. The salary numbers exist in clear only inside the AMD SEV-SNP enclave during commitment derivation. The web server, the database, and the nilCC host operator never see them. Even a compromised employer server can produce only encrypted nilDB writes and `pi_hash`-bound on-chain commitments — never the underlying salaries.

---

## 8. Settlement Privacy — MagicBlock Private Ephemeral Rollup

The on-chain `claim_payment` instruction is intentionally a **pure ZK gate** — it verifies the proof, burns the nullifier, and emits an event, but it does not move USDC. Settlement is dispatched off-chain through MagicBlock's Private Ephemeral Rollup (PER) so the actual USDC movement is unlinkable to the on-chain claim.

### 8.1 Why Off-Chain Settlement

If `claim_payment` performed an inline USDC transfer, the on-chain transaction would name the recipient ATA and the amount in plaintext, defeating much of the privacy work done in the upstream layers. By splitting the workflow into:

1. **On-chain ZK gate** — proves the right to a payment, without naming the recipient or the amount.
2. **Off-chain TEE-validated dispatch** — moves the funds privately, with cryptographic split + delay routing.

Civitas decouples the *authorisation* of a payment from its *execution*. An observer of the chain sees a stream of opaque `pi_hash`-bound nullifier emissions; the actual USDC settlements arrive at recipient ATAs at randomised times in randomised slices.

### 8.2 Architecture

The `civitas-payroll` integration of MagicBlock uses `@magicblock-labs/ephemeral-rollups-sdk` v0.12 with the TEE-fronted devnet at `https://tee.magicblock.app`:

| Phase | SDK Call | Layer |
|---|---|---|
| **Auth** | `getAuthToken(rpcUrl, employerPubkey, signMessage)` | Bearer-token challenge/sign/login against the TEE auth endpoint. |
| **Pre-fund** | `delegateSpl(employer, mint, amount, { validator, private: true, … })` | Base layer — sets up vault PDA + vault ATA + employer's delegated ephemeral ATA. One-time per mint. |
| **Private dispatch** | `transferSpl(employer, employee, mint, amount, { visibility: "private", validator, privateTransfer: { split, minDelayMs, maxDelayMs } })` | Single instruction submitted to base layer; the TEE validator's crank service then schedules `split` randomly-delayed settlements in `[500ms, 30s]`. |

### 8.3 Dispatcher

The off-chain dispatcher (`/api/payroll/dispatch-claim`) sits between the on-chain claim and the MagicBlock private transfer. Its responsibilities:

1. **Subscribe to `VoucherConsumed` events** from the `civitas-payroll` program.
2. **Recompute `pi_hash`** from authoritative state — looking up the vault PDA, mint, program ID, finalised Merkle root, and combining with the employee-supplied `(recipient_token_account, amount, epoch)`.
3. **Match against the on-chain `pi_hash`** in the event. A mismatch means the employee tried to redirect the payment or alter the amount — rejected.
4. **Build and submit the MagicBlock private transfer** with `visibility: "private"`, `split = N`, `minDelayMs = 500`, `maxDelayMs = 30_000`.

Because step (3) re-binds the payment to the same `pi_hash` that the on-chain proof committed to, the dispatcher cannot route funds to the wrong recipient, change the amount, or replay an old voucher — even though it holds the employer's transfer authority.

### 8.4 Settlement Privacy Properties

| Property | Mechanism |
|---|---|
| **Amount obfuscation** | Single `amount` is split into `N` sub-transfers (default 5), each cranked at a randomised delay. |
| **Timing obfuscation** | Each sub-transfer is scheduled by the TEE validator at `now + uniform(minDelayMs, maxDelayMs)`. |
| **Mixing across runs** | When multiple claims are dispatched within the queue's window, their splits interleave on-chain. |
| **Settlement decoupling** | The on-chain `claim_payment` and the eventual settlement transfers occupy disjoint slots, with no shared transaction-graph edge. |

---

## 9. Identity, Authentication, and Roles

### 9.1 Roles

| Role | Capabilities | Plaintext Access |
|---|---|---|
| **Employer** | `initialize_vault`, `deposit_usdc`, run lifecycle, dispatcher operation. | Salaries during nilCC computation only (inside enclave); employee tags `τ`; never `η`. |
| **Employee** | Generate credential, derive tag, fetch voucher, generate Groth16 proof, submit `claim_payment` (or use a relayer / fresh wallet). | Own `(η, a, ν)` for their own vouchers only. |
| **Auditor** | Verify run integrity from on-chain Merkle roots and chunk hashes, attestation reports, and nilDB metadata. | Run-level metadata only; never per-employee amounts. |
| **Relayer** (optional) | Submits `claim_payment` on behalf of the employee, paying nullifier rent. | Cannot extract any private data — all witness data is inside the proof. |

**Table 11.** Role capabilities and information-access boundaries.

### 9.2 Authentication

| Provider | User | Flow |
|---|---|---|
| **Privy** (`@privy-io/react-auth`) | Employer / Employee | Email or social login; embedded Solana wallet provisioned automatically. Web2-friendly onboarding, no seed phrase required. |
| **Phantom / Solflare** | Employer / Employee | Native Solana wallet via the Wallet Standard. Standard for crypto-native users. |
| **ZK Credential Login** | Employee | The employee proves knowledge of `η` to log in — derives `τ` client-side, signs an authentication challenge bound to `τ`. No wallet required for read-only access to their own vouchers. |

**Table 12.** Authentication providers.

### 9.3 Solana Name Service Binding

Vaults can optionally bind a **`.sol` SNS domain** at initialisation (`sns_domain: Option<String>` in `initialize_vault`). The Civitas frontend uses `@bonfida/spl-name-service` to resolve `.sol` domains to vault PDAs and to display human-readable employer identities. This lets employees verify "I'm claiming against `acme.sol`" rather than a 32-byte program-derived address.

### 9.4 Client-Side Credential Custody

The master credential nonce `η` is generated client-side via `crypto.getRandomValues(new Uint8Array(32))` and stored in the browser's IndexedDB under a domain-scoped key. **It is never transmitted, escrowed, or stored on any server.** The optional `credential_recovery` nilDB collection stores only an employee-encrypted blob whose decryption key is derived from a passphrase the employee chooses; no operator can decrypt it.

---

## 10. Lifecycle Reference

### 10.1 Employer Onboarding

1. Employer connects wallet (Privy / Phantom / Solflare).
2. Optionally registers a `.sol` SNS domain via Bonfida.
3. Calls `initialize_vault(sns_domain)` — creates `VaultState` + Token-2022 confidential USDC vault ATA.
4. Calls `deposit_usdc(amount)` — deposits USDC into the confidential vault.
5. Adds employees to `employee_registry` in nilDB (employer-side bulk import or per-employee TEE onboarding).

### 10.2 Employee Onboarding

| Mode | Flow |
|---|---|
| **Self-Generated** | Employee opens the Civitas app, generates `η` client-side, derives `τ = Poseidon₁(η)`, copies `τ` to the employer. `η` lives in IndexedDB. |
| **TEE Blind Onboarding** | Employer triggers nilCC `onboard_employee` workload; the enclave generates `η` inside SEV-SNP, returns only `τ`. `η` is delivered to the employee out-of-band over an authenticated channel. |
| **Bulk Import** | Employer uploads a CSV of pre-generated `τ` values produced client-side by employees during their app onboarding. |

**Table 13.** Employee onboarding modes.

### 10.3 Payroll Run

1. Employer composes a payroll manifest of `(employee_tag, amount)` pairs.
2. Submits manifest to the nilCC `run_compute` workload.
3. Inside SEV-SNP enclave: sample `voucher_nonce` per employee, compute `commitment = Poseidon₄(τ, a, e, ν)`, build depth-20 Poseidon Merkle tree, produce root + voucher records + attestation report.
4. Employer submits `start_payroll_run(run_id, epoch, n)` on-chain.
5. Employer submits `append_commitments_chunk(run_id, idx, [C…])` for `⌈n/32⌉` chunks.
6. Employer submits `finalize_merkle_root(run_id, root, chunk_count)` — materialises one `CommitmentAccount` per commitment, marks run `Committed`.
7. Encrypted voucher records (`{employee_tag, amount %allot, epoch, voucher_nonce %allot, commitment, …}`) are written to the `voucher_store` nilDB collection.

### 10.4 Employee Claim

1. Employee fetches their voucher records from nilDB by their `τ` (server-side decryption via the org NUC).
2. The browser receives `(amount, voucher_nonce, commitment, epoch, run_id)`.
3. Employee fetches the Merkle authentication path for their commitment from `/api/payroll/merkle-tree`.
4. Browser computes `nullifier = Poseidon₃(η, e, ν)`.
5. Browser computes `pi_hash = SpongePoseidon(merkle_root, nullifier, recipient_ATA, amount, epoch, mint, vault_PDA, program_id, run_id, domain_tag)`.
6. Browser invokes `snarkjs.groth16.fullProve(circuitInput, /zk/voucher.wasm, /zk/voucher_final.zkey)` — produces a 256 B proof.
7. Browser submits `claim_payment(proof_bytes, pi_hash, nullifier, run_id)` — signed by the employee's wallet (or a fresh relayer wallet).
8. On-chain: Groth16 verify (~175k CU) → `NullifierAccount` `init` → `VoucherConsumed` event.
9. Dispatcher catches the event, recomputes `pi_hash` from authoritative state, builds the MagicBlock private transfer, submits to the TEE-fronted ER.
10. Within ~30 s, the TEE validator's crank cranks `split` randomly-delayed sub-transfers to the employee's USDC ATA.

---

## 11. Performance and Scalability

| Operation | Cost / Latency | Notes |
|---|---|---|
| Browser Groth16 proof (depth-20 circuit) | ~10–30 s | snarkjs over WebCrypto on a modern device; no GPU required. |
| On-chain Groth16 verification | ~175,000 CU | 4-pair `alt_bn128_pairing` plus IC scalar mul. |
| Full `claim_payment` ix (verify + nullifier init + event) | ~200,000 CU | Well under 1.4M per-tx cap. |
| `claim_payment` tx size | ~700 B | 256 B proof + 32 B pi_hash + 32 B nullifier + 16 B run_id + accounts. |
| `append_commitments_chunk` (32 leaves) | ~50,000 CU | Linear in chunk size. |
| `finalize_merkle_root` (n leaves) | O(n) | One `CommitmentAccount` `init` per leaf. |
| Solana finality | ~400 ms | Confirmed commitment level. |
| MagicBlock crank latency | 500 ms – 30 s (configurable) | Per-sub-transfer randomised delay. |
| Tx fees (Devnet rate) | ~5,000 lamports | <$0.001 at typical SOL prices. |
| Merkle tree capacity | 2²⁰ = 1,048,576 leaves | Sufficient for ~10,000 employees with monthly cycles for 100+ years. |

**Table 14.** Performance characteristics.

---

## 12. Security Analysis

### 12.1 Threat Model

| Adversary | Capabilities Assumed |
|---|---|
| **Public-chain observer** | Reads every Solana transaction and event in real time. |
| **Network attacker** | Can MITM cleartext channels (defeated by TLS + NUC). |
| **nilDB node operator** | Operates one of the 3 nilDB nodes; sees only one secret share per sensitive field. |
| **Compromised employer web server** | Can read encrypted nilDB rows but cannot decrypt sensitive fields without the org NUC; cannot forge `pi_hash` because the dispatcher's recomputation is bound to authoritative on-chain state. |
| **Forking miner / validator** | Cannot reorder or replay transactions across deployments due to per-network domain tag. |

### 12.2 Property → Mechanism Map

| Property | Defended By |
|---|---|
| **Salary confidentiality (chain)** | Salaries never appear in any on-chain account, IX arg, or event. |
| **Salary confidentiality (storage)** | nilDB `%allot` 3-of-3 secret-sharing on `amount`, `voucher_nonce`, `salary_amount`. |
| **Salary confidentiality (compute)** | nilCC AMD SEV-SNP enclave with attestation chain validation. |
| **Credential confidentiality** | `η` lives only in browser IndexedDB; `τ` is one-way derived. |
| **Spend uniqueness** | `NullifierAccount` `init` semantics — Solana System Program reverts on duplicate PDA. |
| **Proof unforgeability** | Groth16 knowledge soundness over BN254 (q-PKE). |
| **Proof binding** | 10-input SpongePoseidon `pi_hash` recomputed on-chain from authoritative state (INV-6). |
| **Cross-deployment replay** | `domain_tag` baked into `pi_hash` at compile time (INV-7). |
| **Settlement unlinkability** | MagicBlock TEE-validated split + delay routing decouples claim from settlement. |
| **Vault solvency** | Token-2022 confidential vault accounting + employer pre-fund to MagicBlock vault. |

**Table 15.** Property → defending-mechanism map.

---

## 13. Conclusion

Civitas demonstrates that on-chain payroll can be **simultaneously private, verifiable, and trust-minimised** — the long-standing trilemma resolved by a careful composition of zero-knowledge proofs, hardware-attested compute, secret-shared storage, and TEE-validated settlement, all anchored to a single Anchor program on Solana.

The architecture's core contributions:

1. **A 256-byte Groth16 proof** verified on-chain by Solana's native `alt_bn128_pairing` syscalls in a single Anchor instruction — the entire ZK gate fits in one transaction at ~175,000 CU.
2. **A 10-input SpongePoseidon `pi_hash`** that binds the proof to the recipient, amount, vault, mint, run, program ID, and deployment domain tag — recomputed on-chain from authoritative state, defeating proof rerouting and cross-network replay.
3. **A 4-layer privacy stack** (Nillion nilDB + Nillion nilCC + circom Groth16 + MagicBlock Private Pay) where each layer has a distinct trust boundary and contributes a different privacy property.
4. **A pure ZK gate / off-chain dispatch** split that lets settlement be split, delayed, and randomised by a TEE-validated rollup — decoupling the on-chain authorisation from the on-chain settlement.
5. **First-class identity** via Solana Name Service `.sol` binding, Privy embedded wallets, and client-side credential custody.

Civitas is shipping today on Solana Devnet, with the program deployed at `CQW3TnN4X6iG2potguVv2hCKfk4f9tf8PMG7dTV6e24y`, the full circom + snarkjs ZK pipeline operational, the Nillion nilDB and nilCC integrations live against the staging cluster, and the MagicBlock Private Payments dispatch path verified end-to-end against the TEE-fronted devnet.

Civitas turns a long-running thought experiment — "what would private on-chain payroll actually look like, end-to-end?" — into a concrete, audit-ready protocol on the highest-throughput L1 in production.

---

## Appendix A — Protocol Constants

| Constant | Value |
|---|---|
| Curve | BN254 (alt_bn128) |
| BN254 scalar field prime | `21888242871839275222246405745257275088548364400416034343698204186575808495617` |
| Hash function | Poseidon BN254 (circomlib parameters, Bn254X5) |
| Merkle tree depth | 20 |
| Maximum leaves per run | 1,048,576 (2²⁰) |
| Max commitments per chunk | 32 |
| Groth16 proof size | 256 bytes |
| Verifying key size | 580 bytes |
| Public input count | 1 (`pi_hash`) |
| `pi_hash` binding fields | 10 (merkle_root, nullifier, recipient_ATA, amount, epoch, mint, vault_PDA, program_id, run_id, domain_tag) |
| Settlement asset | USDC (Token-2022, ConfidentialTransfer extension) |
| Solana cluster | Devnet → Mainnet-Beta |
| Civitas program ID (Devnet) | `CQW3TnN4X6iG2potguVv2hCKfk4f9tf8PMG7dTV6e24y` |
| Domain tag | `civitas-mainnet-v1` / `civitas-devnet-v1` |
| Anchor version | 0.30.x |
| circom version | 2.1.6 |
| snarkjs version | latest (Groth16) |
| Nillion SDK | `@nillion/secretvaults` v2 + `@nillion/nuc` v2 |
| MagicBlock SDK | `@magicblock-labs/ephemeral-rollups-sdk` v0.12 |
| TEE endpoint | `https://tee.magicblock.app` |
| MagicBlock router | `https://devnet-router.magicblock.app` |
| MagicBlock auth | NUC challenge → ed25519 signature → Bearer token |
| Default private-transfer split | 5 |
| Private-transfer delay range | 500 ms – 30,000 ms |

**Table A1.** Protocol constants.

---

## Appendix B — Anchor Instruction Reference

| # | Instruction | Args | Required Accounts |
|---|---|---|---|
| 1 | `initialize_vault` | `sns_domain: Option<String>` | `owner` (signer, mut), `vault_state` (init PDA), `usdc_mint`, `usdc_vault` (init ATA), token + assoc + system programs |
| 2 | `deposit_usdc` | `amount: u64` | `owner`, `vault_state`, `usdc_vault`, `owner_usdc_ata`, token program |
| 3 | `start_payroll_run` | `run_id: [u8;16]`, `epoch: u64`, `expected_commitment_count: u32` | `owner`, `vault_state`, `payroll_run` (init PDA) |
| 4 | `append_commitments_chunk` | `run_id: [u8;16]`, `chunk_index: u32`, `commitments: Vec<[u8;32]>` | `owner`, `payroll_run`, `chunk` (init PDA) |
| 5 | `finalize_merkle_root` | `run_id: [u8;16]`, `new_root: [u8;32]`, `chunk_count: u32` | `owner`, `vault_state`, `payroll_run`, `chunk[…]`, `commitment[…]` (init PDAs, remaining_accounts) |
| 6 | `claim_payment` | `proof_bytes: Vec<u8>` (256 B), `pi_hash: [u8;32]`, `nullifier: [u8;32]`, `run_id: [u8;16]` | `submitter` (signer, can be fresh), `payroll_run`, `nullifier_account` (init PDA), system program, clock sysvar |
| 7 | `create_invoice` | `invoice_id: [u8;16]`, `commitment: [u8;32]`, `due_ts: i64`, `metadata_cid: String` | `creator` (signer), `invoice` (init PDA) |
| 8 | `pay_invoice` | `invoice_id: [u8;16]` | `payer`, `vault_state`, `invoice`, `vault_ata`, `recipient_ata`, token program |
| 9 | `close_vault` | — | `owner`, `vault_state` (close), system program |

**Table B1.** Anchor instruction set.

---

## Appendix C — HTTP API Reference

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/payroll/generate` | POST | Run nilCC TEE compute over an encrypted manifest, return root + voucher records + attestation. |
| `/api/payroll/commit` | POST | Persist run metadata; return calldata for `start_payroll_run` + `append_commitments_chunk` + `finalize_merkle_root`. |
| `/api/payroll/merkle-tree` | GET | Return the depth-20 authentication path for a given commitment. |
| `/api/payroll/dispatch-claim` | POST | Recompute `pi_hash` from authoritative state; build and submit MagicBlock private transfer. |
| `/api/payroll/private-pay` | POST | Direct private-transfer endpoint (employer → arbitrary recipient). |
| `/api/payroll/fund-magicblock` | POST | One-time `delegateSpl` setup of the employer's delegated ephemeral ATA. |
| `/api/payroll/attestation` | GET | Retrieve the nilCC SEV-SNP attestation report for a payroll run. |
| `/api/payroll/runs` | GET | List committed payroll runs for the connected employer. |
| `/api/payroll/settle` | POST | Record the confirmed Solana + MagicBlock signatures; transition voucher to `settled`. |
| `/api/employees/credential` | POST | Generate or import an employee credential (browser-side `η` derivation). |
| `/api/employees/onboard` | POST | TEE blind onboarding via nilCC. |
| `/api/employees/redeem` | POST | Mark a voucher as in the redemption flow. |
| `/api/employees/vouchers` | GET | Fetch the encrypted voucher records for a given `employee_tag`. |
| `/api/employer/employees` | * | CRUD over the `employee_registry` collection. |
| `/api/employer/payrolls` | * | CRUD over payroll runs (server view). |
| `/api/auditors/verify` | GET | Verify a run's commitment chain against on-chain state without salary access. |
| `/api/auth/login` | POST | Privy / wallet login. |
| `/api/auth/zk-login` | POST | ZK credential login (employee proves knowledge of `η`). |
| `/api/vault/init` / `/deposit` / `/fund` / `/close` | POST | Vault lifecycle helpers (calldata builders). |
| `/api/invoice/create` / `/pay` | POST | Contractor invoice lifecycle. |
| `/api/credential/[token]` | GET | One-time-link credential delivery (TEE onboarding). |
| `/api/nillion/setup` | POST | Initialise nilDB collections + NUCs. |
| `/api/wallet/sign` | POST | Privy server-side signing helper. |

**Table C1.** HTTP API surface.

---

## Appendix D — Glossary

| Term | Definition |
|---|---|
| **AMD SEV-SNP** | AMD Secure Encrypted Virtualization with Secure Nested Paging. Hardware memory-encryption technology providing confidential VMs with cryptographic attestation. |
| **Anchor** | Solana's reference framework for writing on-chain programs in Rust with macro-based account validation. |
| **`alt_bn128`** | Solana's syscall family for BN254 curve arithmetic — addition, scalar multiplication, and pairing. EIP-196 / EIP-197 compatible. |
| **BN254** | Pairing-friendly elliptic curve (a.k.a. alt_bn128, alt-bn128) used by Ethereum and supported natively by Solana. |
| **Commitment** | `Poseidon₄(employee_tag, amount, epoch, voucher_nonce)` — the leaf in the payroll Merkle tree. |
| **CVM** | Confidential Virtual Machine — a VM running inside an SEV-SNP encrypted memory region. |
| **Domain tag** | Per-deployment string (`civitas-devnet-v1` / `civitas-mainnet-v1`) folded into `pi_hash` to defeat cross-network replay. |
| **Ephemeral Rollup (ER)** | MagicBlock's account-delegation rollup; transactions execute on a dedicated validator and settle back to base layer. |
| **Groth16** | Pairing-based zk-SNARK with 256-byte proofs and constant verification cost. |
| **`%allot`** | nilDB column tag indicating threshold secret-sharing across the cluster nodes. |
| **NUC** | Nillion Universal Credential — signed access token authenticating reads/writes to nilDB collections. |
| **Nullifier** | `Poseidon₃(η, e, ν)` — the spend marker that gets `init`-PDA'd on-chain to prevent double-spend. |
| **PER** | Private Ephemeral Rollup — the TEE-validated, privacy-enhanced variant of MagicBlock's ER product. |
| **Poseidon** | SNARK-friendly hash function operating natively over the BN254 scalar field. |
| **`pi_hash`** | The single public input to the Civitas circuit; SpongePoseidon over the 10 binding fields. |
| **SNS** | Solana Name Service (Bonfida) — the `.sol` domain registry. |
| **SpongePoseidon** | Sponge construction over Poseidon₂ used to absorb the 10 binding fields into a single output. |
| **Token-2022 ConfidentialTransfer** | SPL Token-2022 extension providing ElGamal-encrypted balance accounting. |
| **VCEK** | AMD Versioned Chip Endorsement Key — the leaf certificate in the SEV-SNP attestation chain. |
| **Voucher** | The encrypted payroll record `(employee_tag, amount, voucher_nonce, commitment, epoch)` stored in nilDB. |

**Table D1.** Glossary of Civitas-specific terminology.

---

*Civitas — built on Solana. Settled in USDC. Private by construction.*
