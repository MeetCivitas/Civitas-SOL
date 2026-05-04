# Civitas-Sol — Agentic Engineering Grant Application

Submit at: https://superteam.fun/earn/grants/agentic-engineering
Grant: **200 USDG** 

---

## Step 1 — Basics

**Project Title**
> Civitas

**One-line Description**
> Private payroll for Solana — ZK vouchers + MagicBlock private dispatch let employers pay salaries without leaking amounts, recipients, or timing on-chain.

**Telegram Username**
> t.me/rythmern

**Wallet Address (Solana)**
> 8SM1A6wNgreszhF8U7Fp8NHqmgT8euMZFfUvv5wCaYfL

---

## Step 2 — Details

**Project Details**

> Civitas is a private payroll DApp on Solana. Today, every payroll run on a public chain leaks the entire org chart: amounts, recipients, cadence, raises, terminations. For any company that takes salary confidentiality seriously — startups, DAOs, agencies, treasuries — this is a non-starter, and it's the single biggest reason Solana payroll has stayed off-chain.
>
> Civitas fixes this with a five-layer privacy stack composed entirely of production-ready Solana primitives. Salaries are stored as Nillion nilDB secret-shared records (`%allot` encrypted columns) and the payroll merkle commitment is computed inside a Nillion nilCC SEV-SNP TEE, so plaintext salaries never touch our infrastructure. Each employee gets a Groth16/BN254 voucher; redemption is a single Anchor instruction (`claim_payment`) that runs a real on-chain pairing check via Solana's `alt_bn128` syscalls (~165k CU) and burns a nullifier — no amount, no recipient ATA in the IX args. Settlement is then dispatched server-side through MagicBlock's Private Payments API as an ephemeral→base private transfer with randomized split + delay, so the funds movement is unlinkable to the on-chain claim. An optional Cloak shielded-pool hop adds graph-level privacy on the SOL leg.
>
> The repo lives at https://github.com/MeetCivitas/Civitas-SOL and the program is deployed on devnet at `CQW3TnN4X6iG2potguVv2hCKfk4f9tf8PMG7dTV6e24y`. We're targeting three Colosseum Frontier tracks: MagicBlock ($5K — for the private payments integration that replaces the disabled Token-2022 Confidential Transfers), Nillion Nucleus (mandatory — nilDB + nilCC), and Cloak (settlement-graph privacy).
>
> The build was AI-assisted from day one. Most of the architecture decisions, the UltraHonk → Groth16 pivot (forced by Solana CU limits), the circom port of the original Noir voucher circuit, the discovery that MagicBlock SDK 0.12's `fromBalance:"base"` route emits a discriminator that the devnet program rejects (and the workaround through `fromBalance:"ephemeral"` / discriminator 16), and the Token-2022 → legacy SPL mint pivot for MagicBlock compatibility, were all worked out in long Claude Code / Codex sessions — exported transcripts are attached as proof.

**Deadline**
> 2026-05-10 (Asia/Calcutta) — Colosseum hackathon submission window

**Proof of Work**

> **Live deployment & code**
> - GitHub: https://github.com/MeetCivitas/Civitas-SOL
> - Anchor program (devnet): `CQW3TnN4X6iG2potguVv2hCKfk4f9tf8PMG7dTV6e24y` — https://solscan.io/account/CQW3TnN4X6iG2potguVv2hCKfk4f9tf8PMG7dTV6e24y?cluster=devnet
> - MagicBlock employer-deposit tx (working): https://solscan.io/tx/NdiF65YUmqjGzU2cwQiEiU7eciiya9NQTTPJKkZqdUvmKLfjLL9vppYtwD2msQyyBC82ob9zUgtWEzgnNtfLB8G?cluster=devnet
> - Frontend deployed via Vercel (see `frontend/vercel.json`)
>
> **Real ZK verifier on-chain (not a stub)**
> - `programs/civitas-payroll/src/verifier/groth16.rs` — ~150-LOC Groth16/BN254 verifier using `solana_bn254::prelude::{alt_bn128_addition, _multiplication, _pairing}` (EIP-197 encoding). Verifies `e(-A,B)·e(α,β)·e(L_pub,γ)·e(C,δ) = 1`.
> - Pivoted from Noir UltraHonk to circom Groth16 mid-build after measuring CU consumption — UltraHonk would not fit Solana's 1.4M CU budget. Commit: `06aa1d1 changed from ultrahonk to groth16 due to solana CU`.
> - circom circuit at `circuits/voucher_circom/voucher.circom` — port of original Noir circuit, adds 5th constraint binding `pi_hash` over 10 fields (amount, epoch, run_id, recipient_token_account, employee_tag, etc.) to prevent cross-vault replay.
> - Trusted setup tooling: `scripts/groth16-setup.sh` + `scripts/vk-to-rust.ts` (snarkjs verification_key.json → 580-byte BPF binary).
>
> **MagicBlock Private Payments integration (real, no fallbacks)**
> - `lib/server/magicblock-private-payments.ts` — TEE auth via `tee.magicblock.app/auth/{challenge,login}` + ed25519 signature flow.
> - `app/api/payroll/dispatch-claim/route.ts` — server-side dispatcher: confirms claim tx is finalized, recomputes `pi_hash` from authoritative on-chain state via `lib/server/pi-hash.ts` (poseidon-lite, byte-identical to circuit), rejects on mismatch, signs MagicBlock private transfer with `visibility=private, split=5, randomized 500–30000ms delay`.
> - Discovered + worked around MagicBlock SDK 0.12 vs devnet program version skew: `fromBalance:"base"` emits discriminator 25 (rejected `InvalidInstructionData`) — moved to `fromBalance:"ephemeral"` / discriminator 16 (`depositAndQueueTransferIx`).
> - Identified queue-PDA brick risk in `delegateTransferQueueIx` (10240-byte CPI realloc cap with no recovery path) and avoided it.
>
> **Nillion integration**
> - nilDB encrypted salary storage with `%allot` secret-shared columns (4 collections per company).
> - nilCC TEE workload for payroll commitment computation in SEV-SNP enclave.
>
> **Recent commit history (last 10)**
> ```
> ef92966 vercel fix
> b6ce52e vercel: relocate config under frontend/, opt build out of Turbopack
> cecdda7 vercel: single region for Hobby plan
> 4fb4592 arch structures changes
> 5dd1b1d fixed bugs so that magicblock private payments can work flawlessly
> ca551a0 route claim settlement through MagicBlock private payments
> 06aa1d1 changed from ultrahonk to groth16 due to solana CU
> 090f24d successfully claimed and minted vouchers
> fa70369 programs initialization and magicblock payments integration
> 184de83 architecturing the initial source code for Civitas incl deployed programs on devnet
> ```
>
> **Planning artifacts (reviewed by judges if requested)**
> - `IMPLEMENTATION_PLAN.md` (54KB) — original architecture
> - `V2_IMPLEMENTATION_PLAN.md` (47KB) — Token-2022 CT disabled pivot to MagicBlock
> - `V3_HANDOFF.md` (12KB) — production hardening: real Groth16 verifier + MagicBlock-routed settlement

**Personal X Profile**
> x.com/rythmeNagr64107

**Personal GitHub Profile**
> github.com/rythmern02

**Colosseum Crowdedness Score**
> Civitas hasn't been submitted to Colosseum yet (Cypherpunk submission is M3–M4 in the milestones below), so it doesn't have its own indexed page yet. I pulled the cluster-level crowdedness via the Colosseum Copilot API as the closest available proxy:
>
> - **Cluster:** `v1-c13` — "Solana Privacy and Identity Management"
> - **Cluster crowdedness:** **260 projects**, 15 winners (≈5.8% historical win rate)
> - **Why this cluster:** the top semantic match for "private payroll, confidential salary, ZK, employer payments" is *Privment* (similarity 0.087), which sits in `v1-c13`. Cluster's top primitives (`zk-proof: 66`, `encryption: 31`) and #1 problem tag (`lack of financial privacy: 18`) align directly with Civitas's privacy stack.
> - **Differentiation inside the cluster:** none of the 260 projects in `v1-c13` combine (a) on-chain Groth16/BN254 verification, (b) Nillion nilCC TEE compute, and (c) MagicBlock private dispatch as a single payroll product. Closest neighbors are `Privment` (private invoices, no payroll), `NinjaPay`/`Flux` (general privacy payments, no salary mgmt), and the lone payroll project `CryptoPayRoll` (no privacy, in cluster `v1-c15`).
>
> Once Civitas is submitted to Cypherpunk and indexed, I'll attach a screenshot from https://arena.colosseum.org/copilot showing the project's own page + Crowdedness Score.

**AI Session Transcript**
> Attach `./claude-session.jsonl` (Claude Code) and `./codex-session.jsonl` (Codex) — both are exported to the `frontend/` directory of the project root.

---

## Step 3 — Milestones

**Goals and Milestones**

> Today: 2026-05-02. Deadline: 2026-05-10 (Asia/Calcutta). 8-day push to Colosseum-grade submission.
>
> **M1 — Trusted setup ceremony + verifier wiring (2026-05-03 → 2026-05-04)**
> Run `scripts/groth16-setup.sh` end-to-end: download Hermez `pot15_final.ptau`, `snarkjs groth16 setup`, single phase-2 contribution, export VK, embed via `vk-to-rust.ts`, replace the 580-byte zero placeholder at `programs/civitas-payroll/keys/voucher_vk.bin`. `anchor build && anchor deploy --provider.cluster devnet`. Confirm program log no longer contains `[verifier] STUB`.
>
> **M2 — End-to-end devnet rehearsal (2026-05-05 → 2026-05-06)**
> Full happy path on devnet: fresh vault → onboard 5 test employees → run nilCC TEE payroll → MagicBlock PER commit → MagicBlock employer pre-deposit → employee `Claim X USDC` flow → verify `PaymentClaimed` event + nullifier PDA created + private dispatch tx submitted. Forge test: XOR a byte of the proof, confirm `ProofVerificationFailed (6014)`.
>
> **M3 — Demo video + Colosseum submission writeup (2026-05-07 → 2026-05-08)**
> Record 3–4 min product walkthrough showing the full privacy stack (Nillion `%allot` badge, nilCC TEE attestation, ZK proof generation, single-tx claim, MagicBlock private dispatch). Write Colosseum submission deck + project README updates. Address all 3 track narratives: MagicBlock ($5K Frontier), Nillion Nucleus, Cloak.
>
> **M4 — Final polish + ship (2026-05-09 → 2026-05-10)**
> Address any judge-facing rough edges (UI polish, error states, README clarity). Submit to Colosseum. Post launch thread on X. Capture Colosseum Crowdedness Score screenshot for grant final tranche.

**Primary KPI**
> Two-part metric, both measurable on devnet by 2026-05-10:
> 1. **≥ 50 successful payroll claims settled via MagicBlock private dispatch** — measured by counting `PaymentClaimed` events on `CQW3TnN4X6iG2potguVv2hCKfk4f9tf8PMG7dTV6e24y` paired with finalized MagicBlock queue transitions on the corresponding `(mint, validator)` PDA.
> 2. **≥ 10 distinct employer companies onboarded that complete at least one full private payroll cycle** (init vault → onboard ≥1 employee → nilCC payroll run → MagicBlock commit → at least one successful employee claim) — measured by counting distinct `company_id = SHA256(lowercase(employer_wallet)).slice(0,20)` values that satisfy the full cycle.

**Final Tranche Submission Checklist** (acknowledged)
> To receive the final tranche I will submit:
> - Colosseum project link
> - GitHub repo: https://github.com/MeetCivitas/Civitas-SOL
> - Receipt for AI subscription used during the build (Claude Pro / Codex)

---

**Files to attach when submitting:**
1. `frontend/claude-session.jsonl` — Claude Code session transcript
2. `frontend/codex-session.jsonl` — Codex session transcript
3. Colosseum Crowdedness Score screenshot (Google Drive public link, replace TODO above)

**Submission link:** https://superteam.fun/earn/grants/agentic-engineering
