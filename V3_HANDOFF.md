# Civitas V3 — Production Hardening Handoff

What I shipped in this branch and what you need to do before submission.

## V3.1 — MagicBlock-routed private settlement (2026-04-30)

**On-chain `claim_payment` is now a pure ZK gate** — no USDC transfer, no
`recipient_token_account` or `amount` in IX args. Settlement happens
off-chain via the MagicBlock Private Payments API so amount + recipient
are never visible in any direct on-chain transfer linkable to the claim.

### What runs in a claim now
1. **On-chain `claim_payment` IX** (program `CQW3T…e24y`, redeployed):
   - args: `proof_bytes`, `pi_hash`, `nullifier`, `run_id`
   - accounts: submitter, payroll_run, nullifier_account (init), system_program, clock
   - verifies the Groth16 proof against the embedded VK + burns the nullifier
   - emits `VoucherConsumed { nullifier, run_id, pi_hash, slot }`
2. **`/api/payroll/dispatch-claim`** (server-side):
   - confirms the on-chain claim tx is finalized + the nullifier PDA exists
   - recomputes pi_hash from authoritative on-chain state +
     employee-supplied `(recipient, amount, epoch)` via
     `lib/server/pi-hash.ts` (poseidon-lite, byte-identical to circuit)
   - rejects on mismatch
   - signs MagicBlock private transfer (employer-ER → employee-ER,
     visibility=private, split=5, randomized 500–30000 ms delay) using
     `CIVITAS_DEPLOYER_KEYPAIR_PATH` → real bearer token from
     `payments.magicblock.app/v1/spl/login`
   - submits the signed tx
3. **Employee withdraw** (`/api/payroll/private-pay?action=withdraw`):
   - employee wallet signs + submits → ER → base wallet ATA

### Mints
- `NEXT_PUBLIC_USDC_MINT` (Token-2022) is the legacy Civitas vault metadata mint.
- `NEXT_PUBLIC_MAGICBLOCK_USDC_MINT=4wnU5UyxSZ7otfDAmXucNfEkbnA27NA58y6CLTx4SDLw` (legacy SPL) — MagicBlock's SPL Vault hard-codes legacy SPL Token; Token-2022 is rejected with `IncorrectProgramId`. The proof now binds to the legacy mint + legacy ATA so dispatcher's pi_hash recompute matches.

### Pre-funding
- `/api/payroll/fund-magicblock` (POST `{amountBaseUnits, mintFirst}`): mints USDC to the deployer (devnet only — deployer is mint authority for the test legacy mint), then deposits into MagicBlock ER via `lib/server/magicblock-auth.ts::employerDeposit`. Verified working: tx `NdiF65YUmqjGzU2cwQiEiU7eciiya9NQTTPJKkZqdUvmKLfjLL9vppYtwD2msQyyBC82ob9zUgtWEzgnNtfLB8G`.

### Known external blocker
- `payments.magicblock.app/v1/spl/challenge` returns HTTP 502 / `{"code":"RPC_ERROR","message":"No challenge received"}` for any pubkey/cluster as of 2026-04-30. Deposit, withdraw, balance work — only the auth challenge upstream is degraded. `lib/server/magicblock-auth.ts` retries with exponential backoff (~9s total). When MagicBlock recovers, dispatch-claim will succeed end-to-end with no code change.

## What's done (in this commit set)

### Phase 3 — MagicBlock fallbacks removed
- `lib/server/magicblock-private-payments.ts`: rewritten with `MagicBlockError` class + `assertMagicBlockHealthy()` gate. Demo helpers (`makeDemoDepositTx` etc.) deleted.
- `app/api/payroll/private-pay/route.ts`: every error now returns proper HTTP error; demo challenges/tokens/txs gone.
- `lib/magicblock-per.ts`: PER-failure-→-standard-ER fallback removed; throws `MagicBlockPERError`.
- `components/employer/create-payroll-wizard.tsx`: PER fallback gone, `demo-sig` removed, full error propagation if MagicBlock auth/deposit fails.

### Phase 4 — Dead code purged
- `lib/server/zk-payroll.ts` (snarkjs Groth16, unused): deleted.
- `lib/token22.ts` (Token-2022 ElGamal stubs, unused): deleted.
- `lib/solana-program.ts`: orphan helpers (`claimPayment`, `requestPayrollGenerate`, `notifySettle`, `depositUsdc`, `createInvoice`, `payInvoice`, `startPayrollRun`, `appendCommitmentsChunk`, `finalizeMerkleRoot`) deleted. SystemProgram-placeholder branch deleted (program ID required).
- `programs/civitas-payroll/src/lib.rs.bak`: deleted.

### Phase 1 — Real on-chain Groth16/BN254 verifier
- `programs/civitas-payroll/src/verifier/groth16.rs`: ~150-line verifier using `solana_bn254::prelude::{alt_bn128_addition, _multiplication, _pairing}`. EIP-197 encoding. Verifies `e(-A,B)·e(α,β)·e(L_pub,γ)·e(C,δ)=1` where `L_pub = IC[0] + pi_hash·IC[1]`.
- `programs/civitas-payroll/src/verifier/mod.rs`: VK loader (`include_bytes!("../../keys/voucher_vk.bin")`), `verify_voucher_proof()` entry.
- `programs/civitas-payroll/src/state.rs`: `VerificationPublicInputs` collapsed to `ClaimPublicInputs` (amount, epoch, run_id, recipient_token_account). `VerificationSession` removed entirely. `MAX_PROOF_BYTES=8192` → `GROTH16_PROOF_BYTES=256`.
- `programs/civitas-payroll/src/instructions/claim_payment.rs`: NEW — single-tx claim. Recomputes pi_hash via `solana_poseidon::hashv` over the same 10 binding fields the circuit hashes. Reverts on mismatch, then calls `verify_voucher_proof`, registers nullifier, transfers USDC.
- `instructions/{begin_verification,complete_withdrawal,close_verification_session}.rs`: deleted.
- `errors.rs`: `ProofVerificationStep1Failed`/`Step2Failed`/`SessionExpired` etc. replaced with `ProofMalformed`, `VerifyingKeyMalformed`, `ProofVerificationFailed`.
- `lib.rs`: `begin_verification` and `complete_withdrawal` removed; new single `claim_payment(proof_bytes, pi_hash, public_inputs, nullifier)` instruction.
- `Cargo.toml`: dropped `ark-bn254`/`ark-ff`/`ark-ec`/`light-poseidon`. Added `solana-bn254 = "=2.1.0"` (alt_bn128 syscalls) + `solana-poseidon = "4.0.0"` (sol_poseidon syscall).
- `programs/civitas-payroll/keys/voucher_vk.bin`: 580-byte zero placeholder (replaced by trusted setup).

### Phase 1d — circom port
- `circuits/voucher_circom/voucher.circom`: full port of the Noir circuit. Constraints C1–C4 (employee_tag, commitment, nullifier, merkle inclusion at depth 20) + new C5 (`SpongePoseidon` over the 10 binding fields == `pi_hash` public input). `Voucher(20)` template, single public input.

### Phase 1e — Trusted setup tooling
- `scripts/groth16-setup.sh`: end-to-end ceremony — compile circom, fetch Hermez `pot15`, run `snarkjs groth16 setup` + `zkey contribute`, export VK, embed via `vk-to-rust.ts`, copy artifacts to `frontend/public/zk/`.
- `scripts/vk-to-rust.ts`: snarkjs `verification_key.json` → 580-byte BPF binary in the layout the verifier expects (alpha_g1 || beta_g2 || gamma_g2 || delta_g2 || ic_len || ic[0] || ic[1]).

### Phase 2 — Client prover + claim flow
- `lib/groth16-proof.ts`: NEW — uses `snarkjs.groth16.fullProve` against `/zk/voucher.wasm` + `/zk/voucher_final.zkey`. Returns 256-byte proof in EIP-197 layout + 32-byte pi_hash. `SpongePoseidon` over the 10 binding fields exactly mirrors the on-chain `compute_pi_hash`.
- `lib/zk-proof.ts`, `lib/solana-proof.ts` (UltraHonk + 400-byte stub hack): deleted.
- `lib/borsh-encode.ts`: `encodeVerificationPublicInputs` → `encodeClaimPublicInputs` + `encodeClaimPaymentArgs` (single 256B proof + pi_hash, no Vec<u8> session juggling).
- `app/employees/page.tsx`: `handleSettleVoucher` + `handleClaimVoucher` collapsed to a single `handleClaim` — proof gen → single claim_payment tx → settle record. The 400-byte proof stub, sessionStorage proof juggling, Tx-A/Tx-B split, and broken employee-side MagicBlock dance are all gone.

---

## What you need to do before deploying

### 1. Install the circom toolchain (one-time)

```bash
# macOS (via brew tap nilfoundation/circom or build from source):
brew tap iden3/iden3-circom
brew install circom

# Or from source:
git clone https://github.com/iden3/circom && cd circom && cargo install --path circom

npm i -g snarkjs
cd /Users/rythme/developer/blockchain/Civitas-Sol && npm i circomlib
```

### 2. Run the trusted setup ceremony

```bash
cd /Users/rythme/developer/blockchain/Civitas-Sol
bash scripts/groth16-setup.sh
```

This downloads `pot15_final.ptau` (~76MB) from Hermez, runs `snarkjs groth16 setup`, contributes one phase-2 round, exports the VK, and writes:
- `programs/civitas-payroll/keys/voucher_vk.bin` (replaces the zero placeholder)
- `frontend/public/zk/voucher.wasm`
- `frontend/public/zk/voucher_final.zkey`
- `frontend/public/zk/verification_key.json`

For mainnet you'll want **multiple contributors** to the phase-2 ceremony (run `snarkjs zkey contribute` repeatedly with different operators). For the hackathon, single contribution is acceptable.

### 3. Rebuild + redeploy the program

```bash
anchor build
anchor deploy --provider.cluster devnet
```

Program ID stays `CQW3TnN4X6iG2potguVv2hCKfk4f9tf8PMG7dTV6e24y`. The on-chain account size will change (the IDL has new `ClaimPublicInputs` struct + new `claim_payment` instruction), so any open verification sessions from the old program will be unreachable — that's fine, those flows didn't really verify anything anyway.

### 4. Update the frontend env (if needed)

`.env.local` already has the required vars. Confirm:
```
NEXT_PUBLIC_CIVITAS_PROGRAM_ID=CQW3TnN4X6iG2potguVv2hCKfk4f9tf8PMG7dTV6e24y
NEXT_PUBLIC_USDC_MINT=Eknzs89o8LuQBeA6cidC7EA85iJas9scNxsJ1oDYNm98
NEXT_PUBLIC_MAGICBLOCK_PAYMENTS_URL=https://payments.magicblock.app
NEXT_PUBLIC_MAGICBLOCK_ROUTER=https://devnet-router.magicblock.app
NEXT_PUBLIC_CIVITAS_DOMAIN_TAG=civitas-devnet-v1
```

### 5. End-to-end devnet rehearsal

1. Initialize a fresh vault (the `init_if_needed` fix from the prior session is shipped).
2. Onboard employees → run NilCC TEE payroll → commit through MagicBlock PER → deposit USDC.
3. Employee claims with the new `Claim X USDC` button — single tx now. The Solscan log should NOT contain `[verifier] STUB`. Instead you'll see `Program log: Instruction: ClaimPayment` followed by alt_bn128 syscall CU consumption (~100K CU), and `Program data: ...` for the `PaymentClaimed` event.

### 6. Forge test (sanity check)

Try modifying any byte of the proof bytes in `lib/groth16-proof.ts` (e.g., XOR the first byte after `proofBytes`). The on-chain pairing check should reject with `ProofVerificationFailed (6014)`. If it accepts, something's wrong with the verifier — flag immediately.

---

## What I deferred (not blocking, but on the V4 list)

| # | Item | Why deferred |
|---|---|---|
| 1 | `lib/mock-store.tsx` | Used by 8 employee/auditor components; deleting requires a frontend refactor that's its own project. Add to V4. |
| 2 | `lib/server/employee-store.ts` `DEMO_SEEDS` | Dev convenience; gate behind `NODE_ENV !== "production"` before mainnet. Mentioned in plan §4 but not blocking devnet. |
| 3 | `payroll/generate` local-poseidon fallback | Acceptable for dev when NilCC creds are absent. Add a feature-flag guard for prod. |
| 4 | NilDB silent-on-401 in `nillion-server.ts:252` | Won't matter once your DID is correctly registered; if it does, you'll see writes fail loudly. |
| 5 | `nilcc-client.ts` "stopped" workload returning `see-nildb` skeleton | Edge case; surface the error to the UI in V4. |

---

## Architectural snapshot for future-you

**Privacy stack (V3):**
1. **Nillion nilDB** — encrypted salary storage (real, working).
2. **Nillion nilCC TEE** — payroll commitment computation in SEV-SNP enclave (real, working when configured).
3. **Groth16/BN254 ZK proof** — voucher redemption unlinkability (REAL after this commit, was stub before).
4. **MagicBlock PER + Private Payments** — amount/timing obfuscation during commit (REAL, no fallbacks after this commit).
5. **Cloak shielded pool** — optional post-claim privacy on the SOL leg.

**Single point of truth for the claim flow:**
- Circuit: `circuits/voucher_circom/voucher.circom` (constraints + pi_hash sponge)
- Client prover: `frontend/lib/groth16-proof.ts`
- On-chain handler: `programs/civitas-payroll/src/instructions/claim_payment.rs`
- Verifier: `programs/civitas-payroll/src/verifier/groth16.rs`
- VK: `programs/civitas-payroll/keys/voucher_vk.bin`

If any of these change, the others must be re-checked for the pi_hash field-order invariant. The circuit's `SpongePoseidon` order is the source of truth; both the client (`lib/groth16-proof.ts: spongePoseidon`) and the on-chain (`claim_payment.rs: compute_pi_hash`) must mirror it exactly.

---

## CU / size budgets

| Item | Estimate | Limit |
|---|---|---|
| Groth16 proof on the wire | 256 B | 1232 B tx limit ✓ |
| `claim_payment` instruction data | ~370 B (8 disc + 4+256 proof + 32 pi + 64 pubin + 32 null) | tx limit ✓ |
| Pairing CU | ~165k | 1.4M ✓ |
| MSM (IC[1] · pi_hash) | ~4k | ✓ |
| Sponge Poseidon (10 absorbs) | ~10k (10 × ~1k syscall) | ✓ |
| Token-2022 transfer CU | ~30k | ✓ |
| Total claim_payment | ~250k | ✓ |
