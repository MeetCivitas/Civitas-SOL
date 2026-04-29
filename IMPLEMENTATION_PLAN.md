# Civitas — Full Implementation Plan
**Version:** 1.0  
**Date:** 2026-04-27  
**Target Tracks:** Nillion Nucleus (mandatory) · MagicBlock Privacy + SNS ($5K) · Cloak (privacy payments)  
**Dropped:** Umbra (EVM-only, no Solana support confirmed) · Tether (post-core fix) · Ika (wrong product category)

---

## Executive Summary

This document is the single source of truth for bringing Civitas from its current broken state to a working, multi-track hackathon submission. Every phase must be completed in sequence. Do not start Phase N+1 until Phase N is green.

**Current critical failures (must fix before anything else):**
1. ZK verifier is a stub — accepts every proof unconditionally
2. Nullifier formula in server (`poseidon2`) does not match circuit (`poseidon3`) — employee redemption is impossible
3. `employee_tag` is SHA256-hashed before use in commitment — circuit expects raw BN254 field element
4. Token-2022 Confidential Transfers are disabled on devnet (security audit pending) — the privacy claim is false
5. `@umbra-privacy/sdk` and `@magicblock-labs/ephemeral-rollups-sdk` are fake type stubs — not real packages
6. `@noir-lang/noir_js` and `@noir-lang/backend_barretenberg` are `devDependencies` — proof generation will fail at runtime
7. nilCC silently falls back to plaintext server compute — defeats the TEE privacy model

**Architecture after this plan:**
```
Employee Salary Storage  → Nillion nilDB (encrypted with %allot shares)
Payroll Compute          → Nillion nilCC TEE (Docker-containerised BN254 Poseidon)
ZK Proof Generation      → Browser-side bb.js (UltraHonk, Noir circuit)
On-chain Commitment      → Solana Anchor program (Merkle root + nullifier registry)
Payroll Commit UX        → MagicBlock Ephemeral Rollup (single wallet popup vs N)
Employer Identity        → SNS .sol domain binding (already on-chain, needs UI)
Post-payment Privacy     → Cloak shielded pool (Groth16, @cloak.dev/sdk)
Compliance               → Cloak viewing keys for auditors
```

---

## Phase 0 — Environment Audit
**Time estimate: 2 hours**  
**Must complete before writing any code.**

### 0.1 — Verify Nillion package version

The project declares `"@nillion/secretvaults": "^2.0.0"` in `package.json`, but the public npm registry shows v0.1.x. As a Nillion Nucleus participant you likely have access to a pre-release build.

```bash
cd frontend
npm show @nillion/secretvaults version      # check what npm resolves to
node -e "const sv = require('@nillion/secretvaults'); console.log(Object.keys(sv))"
```

If the installed version exports `SecretVaultBuilderClient` — your imports are correct, continue.  
If it exports `SecretVaultWrapper` — you are on v0.1.x. Contact your Nillion Nucleus liaison immediately to get the v2 access token / registry URL. **Do not proceed with Nillion phases until this is confirmed.**

### 0.2 — Fix dependency classification

Move ZK proving libraries from `devDependencies` to `dependencies` in `frontend/package.json`. They must be bundled at runtime for browser proof generation.

```diff
-  "devDependencies": {
-    "@noir-lang/backend_barretenberg": "^0.36.0",
-    "@noir-lang/noir_js": "^1.0.0-beta.16",
+  "dependencies": {
+    "@noir-lang/backend_barretenberg": "^0.36.0",
+    "@noir-lang/noir_js": "^1.0.0-beta.16",
```

### 0.3 — Install real MagicBlock SDK

Remove the fake type declaration and install the real package:

```bash
cd frontend
npm install @magicblock-labs/ephemeral-rollups-sdk@0.6.5
npm install @bonfida/spl-name-service@3.0.19
npm install @cloak.dev/sdk
```

### 0.4 — Delete fake type stubs

Delete `frontend/types/external-sdks.d.ts` entirely. The file declares fake types for packages that don't exist as described. With real packages installed, TypeScript will use their actual types.

```bash
rm frontend/types/external-sdks.d.ts
```

### 0.5 — Delete dead private-payroll-orchestrator

`frontend/lib/private-payroll-orchestrator.ts` calls `mockReceiveFinalizedNillionPayload()` with hardcoded fake employees and was never wired into any route. Delete it — it will be replaced in Phase 4 with real MagicBlock integration.

```bash
rm frontend/lib/private-payroll-orchestrator.ts
```

### 0.6 — Compile the Noir circuit

The circuit must be compiled to ACIR JSON before browser proving can work.

```bash
cd circuits/voucher_noir
nargo compile
# Output: circuits/voucher_noir/target/voucher_noir.json
```

Copy the compiled artifact to the frontend public directory:

```bash
cp circuits/voucher_noir/target/voucher_noir.json frontend/public/circuits/voucher_noir.json
```

### 0.7 — Confirm checklist before Phase 1

- [ ] Nillion package exports `SecretVaultBuilderClient` (or Nucleus liaison contacted)
- [ ] `@noir-lang/*` in runtime `dependencies`
- [ ] `@magicblock-labs/ephemeral-rollups-sdk@0.6.5` installed
- [ ] `@bonfida/spl-name-service@3.0.19` installed
- [ ] `@cloak.dev/sdk` installed
- [ ] `types/external-sdks.d.ts` deleted
- [ ] `lib/private-payroll-orchestrator.ts` deleted
- [ ] `circuits/voucher_noir/target/voucher_noir.json` exists
- [ ] `frontend/public/circuits/voucher_noir.json` exists

---

## Phase 1 — Critical Bug Fixes
**Time estimate: 6 hours**  
**These bugs make the product non-functional. Fix every single one.**

### 1.1 — Fix employee_tag field encoding in payroll generation

**File:** `frontend/app/api/payroll/generate/route.ts`

**Problem:** The function `hashToField(emp.employee_tag)` does `SHA256(employee_tag_string)` and truncates to 31 bytes. But `employee_tag` in NilDB is already a BN254 field element stored as a decimal string (computed in the browser as `Poseidon1(credential_nonce)`). The server must treat it as a raw field element, not hash it again.

**Fix:** Replace lines 83-85:

```typescript
// BEFORE (wrong — SHA256 of the string, not the field element itself)
const tagField = hashToField(emp.employee_tag);

// AFTER (correct — employee_tag IS already a BN254 field element)
const tagField = fieldElement(BigInt(emp.employee_tag));
```

Also delete the `hashToField` function entirely — it is only used in the wrong callsite and nowhere else.

### 1.2 — Fix nullifier formula and server responsibility

**File:** `frontend/app/api/payroll/generate/route.ts`

**Problem:** The server computes `nullifier = poseidon2([tagField, nonce])` and stores it. The circuit requires `nullifier = poseidon3([credential_nonce, epoch, voucher_nonce])`. The server **cannot compute the real nullifier** because it never has `credential_nonce` — that is the employee's secret key that never leaves the browser.

The server should store only the `voucher_nonce`. The employee browser computes the nullifier client-side when generating the ZK proof.

**Fix in `generate/route.ts`** — change the voucher construction in `computeLocalPayroll`:

```typescript
// BEFORE
entries.push({ employee_tag: emp.employee_tag, salaryMicro, commitment, nonce, nullifier });

// AFTER — do not compute nullifier server-side (server doesn't have credential_nonce)
entries.push({ employee_tag: emp.employee_tag, salaryMicro, commitment, nonce });
```

Change the return vouchers array:

```typescript
// BEFORE
vouchers: entries.map((e) => ({
  employee_tag: e.employee_tag,
  amount: e.salaryMicro.toString(),
  epoch: manifest.epoch.toString(),
  voucher_nonce: e.nonce.toString(),
  commitment: e.commitment.toString(),
  nullifier: e.nullifier.toString(),  // ← WRONG: server doesn't know this
})),

// AFTER
vouchers: entries.map((e) => ({
  employee_tag: e.employee_tag,
  amount: e.salaryMicro.toString(),
  epoch: manifest.epoch.toString(),
  voucher_nonce: e.nonce.toString(),   // employee uses this to derive nullifier
  commitment: e.commitment.toString(), // public commitment stored on-chain
  nullifier: "",                       // computed by employee browser only
})),
```

Also update the nilCC manifest voucher format to match — the nilCC compute should also NOT return a server-derived nullifier.

**Update the NilDB schema** for vouchers — mark `nullifier` as optional or remove it from required fields in `nillion-server.ts`.

### 1.3 — Fix commitment formula in nilCC fallback

**File:** `frontend/app/api/payroll/generate/route.ts`

The circuit commitment is:
```
commitment = Poseidon4(employee_tag_field_element, amount, epoch, voucher_nonce)
```

The server currently passes `tagField` which (after fix 1.1) is now `BigInt(emp.employee_tag)` — this is the Poseidon1 hash of credential_nonce. The `poseidon4` call is correct in structure. Verify line 88:

```typescript
// This is correct AFTER fix 1.1 is applied (tagField = BigInt(emp.employee_tag))
const commitment = poseidon4([tagField, salaryMicro, epoch, nonce]);
```

No change needed here after 1.1 is fixed.

### 1.4 — Drop Token-2022 Confidential Transfers claim

**CRITICAL FINDING:** Token-2022 Confidential Transfers are currently **disabled on devnet** pending a security audit (confirmed by Solana documentation, April 2026). You cannot demonstrate them. Claiming they hide USDC amounts is false and a judge who checks the devnet transaction will immediately see public transfer amounts.

**Action 1 — Remove false comment from `complete_withdrawal.rs`:**

```rust
// BEFORE (line 1 of complete_withdrawal.rs)
//! Transfers confidential USDC via Token-2022 to the recipient.

// AFTER
//! Transfers USDC to the recipient via Token-2022 transfer_checked.
//! Note: Confidential Transfer extension is pending Solana security audit.
//! Amount privacy is achieved via ZK commitment architecture + Cloak shielded pool.
```

**Action 2 — Remove claim from landing page:**

In `frontend/app/page.tsx`, find the technology card for "Solana Settlement" and update the description to be accurate.

**Action 3 — Update `VaultState` comment in `state.rs`:**

```rust
// BEFORE
/// Always zero from an on-chain observer's perspective; only the employer
/// can decrypt the actual balance via ElGamal.
pub usdc_balance_approx: u64,

// AFTER
/// Approximate USDC balance in the vault (kept server-side in Nillion).
/// Post-payment privacy is achieved via Cloak shielded pool, not confidential balances.
pub usdc_balance_approx: u64,
```

### 1.5 — Make nilCC failure explicit in the UI

**File:** `frontend/app/api/payroll/generate/route.ts`

**Problem:** When nilCC is unavailable, the code silently falls back to local computation. The JSON response contains `attestation.enclave.type = "local"` which signals no TEE — but the UI never shows this to the user.

**Fix — update the response to include a `tee_active` flag:**

```typescript
return NextResponse.json({
  runId,
  merkleRoot: result.merkle_root,
  // ... other fields ...
  teeActive: result.attestation.enclave?.type !== "local",
  attestation: result.attestation,
});
```

**Fix — update `create-payroll-wizard.tsx` to show TEE status badge:**

In Step 5 ("Generate") of the wizard, after generation completes, show:

```tsx
{generatedRun?.teeActive ? (
  <div className="flex items-center gap-2 text-emerald-400 text-xs">
    <ShieldCheck className="h-4 w-4" />
    Computed in Nillion nilCC TEE — payroll amounts never left the enclave
  </div>
) : (
  <div className="flex items-center gap-2 text-yellow-400 text-xs">
    <AlertCircle className="h-4 w-4" />
    Computed locally — connect nilCC endpoint for full TEE privacy
  </div>
)}
```

### 1.6 — Remove false tech claims from landing page

**File:** `frontend/app/page.tsx`

1. **Remove Garaga** — Garaga is a StarkNet/Cairo library. It has no relation to Solana. The project uses Barretenberg (Aztec) for UltraHonk proving.

   Find the technology card titled "ZK Verification" with text "Garaga Prove" and replace:
   ```
   label: "ZK Verification"
   title: "Barretenberg / Noir"
   desc: "UltraHonk proving backend generating client-side ZK proofs with sub-second verification on Solana via the alt_bn128 syscall."
   ```

2. **Fix "L2 Settlement"** — Solana is an L1 chain, not L2:
   ```
   label: "L1 Settlement"
   title: "Solana Settlement"
   ```

3. **Fix "Solutions" nav link** — it currently links to a personal tweet. Change to `href="/employer"` or the GitHub repo.

4. **Fix footer dead links** — Replace all `href="#"` with real URLs or remove the links:
   - Privacy Policy → `/privacy` (create a minimal page) or remove
   - Terms of Service → `/terms` (create a minimal page) or remove
   - Bug Bounty → link to GitHub Issues
   - Audit Reports → link to GitHub repo with note "audit pending"
   - Docs → link to GitHub README
   - SDK → link to GitHub
   - Smart Contracts → link to Solana Explorer for program ID `CQW3TnN4X6iG2potguVv2hCKfk4f9tf8PMG7dTV6e24y`

### 1.7 — Phase 1 Verification Checklist

Run the following before moving to Phase 2:

```bash
cd frontend
npm run build   # must complete with 0 errors
```

Manual verification:
- [ ] `hashToField` function is deleted from `generate/route.ts`
- [ ] Commitment uses `BigInt(emp.employee_tag)` directly
- [ ] Nullifier is `""` (empty) in all server-generated vouchers
- [ ] Build passes with 0 TypeScript errors
- [ ] Landing page has no mention of Garaga, Umbra, "L2 Settlement"
- [ ] No footer `href="#"` links remain

---

## Phase 2 — ZK Proof Pipeline (Browser-side)
**Time estimate: 8 hours**  
**This is the most critical feature. Employees cannot claim salary without it.**

### 2.1 — Architecture overview

The employee claim flow must work as follows:

```
Browser (employee)
│
├── 1. Fetch voucher from NilDB (via /api/employees/vouchers)
│       → receives: { commitment, voucher_nonce, amount, epoch, employee_tag }
│
├── 2. Load credential from local storage
│       → extracts: credential_nonce (never leaves browser)
│
├── 3. Compute public inputs client-side
│       employee_tag_field = BigInt(employee_tag)  // already Poseidon1(credential_nonce)
│       nullifier          = poseidon3([credential_nonce, epoch, voucher_nonce])
│       recipient_hash     = poseidon2([recipient_token_account_bytes])
│       token_account_hash = poseidon2([token_account_pubkey_bytes])
│       domain_tag_hash    = keccak256("civitas-devnet-v1") as field element
│
├── 4. Fetch Merkle path from on-chain/API for this commitment
│
├── 5. Generate UltraHonk proof using bb.js
│       private: credential_nonce, voucher_nonce, merkle_path, path_index
│       public:  merkle_root, nullifier, recipient_hash, amount, epoch,
│                token_account_hash, domain_tag_hash
│
├── 6. Call /api/payroll/begin-claim → serialized begin_verification tx
│
└── 7. Sign + send tx-A, then tx-B (complete_withdrawal)
```

### 2.2 — Create the proof generation utility

**New file:** `frontend/lib/zk-proof.ts`

```typescript
import { Noir } from "@noir-lang/noir_js";
import { UltraHonkBackend } from "@noir-lang/backend_barretenberg";
import { poseidon1, poseidon2, poseidon3, poseidon4 } from "poseidon-lite";
import { PublicKey } from "@solana/web3.js";
import { keccak256 } from "ethers";

const DOMAIN_TAG = "civitas-devnet-v1";
const BN254_PRIME = BigInt(
  "21888242871839275222246405745257275088548364400416034343698204186575808495617"
);
const TREE_DEPTH = 20;

function fieldElement(v: bigint): bigint {
  return ((v % BN254_PRIME) + BN254_PRIME) % BN254_PRIME;
}

function pubkeyToField(pubkey: PublicKey): bigint {
  const bytes = pubkey.toBytes();
  // Take lower 31 bytes as a field element (always < BN254 prime)
  const hex = Buffer.from(bytes.slice(0, 31)).toString("hex");
  return fieldElement(BigInt("0x" + hex));
}

function domainTagToField(tag: string): bigint {
  // keccak256 of domain tag string, truncated to 31 bytes
  const hash = keccak256(Buffer.from(tag, "utf8"));
  return fieldElement(BigInt(hash.slice(0, 64))); // first 31 bytes
}

let _circuit: object | null = null;

async function loadCircuit(): Promise<object> {
  if (_circuit) return _circuit;
  const res = await fetch("/circuits/voucher_noir.json");
  if (!res.ok) throw new Error("Failed to load circuit artifact");
  _circuit = await res.json();
  return _circuit;
}

export interface VoucherProofInputs {
  // Private
  credentialNonce: bigint;
  voucherNonce: bigint;
  merklePath: bigint[];      // length = TREE_DEPTH
  pathIndex: bigint;
  // Public
  merkleRoot: bigint;
  amount: bigint;
  epoch: bigint;
  recipientTokenAccount: PublicKey;
}

export interface GeneratedProof {
  proof: Uint8Array;
  nullifier: bigint;
  commitment: bigint;
  publicInputs: {
    merkleRoot: string;
    nullifier: string;
    recipientHash: string;
    amount: string;
    epoch: string;
    tokenAccountHash: string;
    domainTagHash: string;
  };
}

export async function generateVoucherProof(
  inputs: VoucherProofInputs
): Promise<GeneratedProof> {
  const circuit = await loadCircuit();
  const backend = new UltraHonkBackend((circuit as any).bytecode);
  const noir = new Noir(circuit as any);

  // Derive public values
  const employeeTagField = poseidon1([inputs.credentialNonce]);
  const commitment = poseidon4([
    employeeTagField,
    inputs.amount,
    inputs.epoch,
    inputs.voucherNonce,
  ]);
  const nullifier = poseidon3([
    inputs.credentialNonce,
    inputs.epoch,
    inputs.voucherNonce,
  ]);
  const recipientHash = pubkeyToField(inputs.recipientTokenAccount);
  const tokenAccountHash = pubkeyToField(inputs.recipientTokenAccount); // same account
  const domainTagHash = domainTagToField(DOMAIN_TAG);

  // Execute circuit to get witness
  const { witness } = await noir.execute({
    credential_nonce: inputs.credentialNonce.toString(),
    voucher_nonce: inputs.voucherNonce.toString(),
    merkle_path: inputs.merklePath.map((p) => p.toString()),
    path_index: inputs.pathIndex.toString(),
    merkle_root: inputs.merkleRoot.toString(),
    nullifier: nullifier.toString(),
    recipient_hash: recipientHash.toString(),
    amount: inputs.amount.toString(),
    epoch: inputs.epoch.toString(),
    token_account_hash: tokenAccountHash.toString(),
    domain_tag_hash: domainTagHash.toString(),
  });

  // Generate UltraHonk proof
  const { proof } = await backend.generateProof(witness);

  return {
    proof,
    nullifier,
    commitment,
    publicInputs: {
      merkleRoot: inputs.merkleRoot.toString(),
      nullifier: nullifier.toString(),
      recipientHash: recipientHash.toString(),
      amount: inputs.amount.toString(),
      epoch: inputs.epoch.toString(),
      tokenAccountHash: tokenAccountHash.toString(),
      domainTagHash: domainTagHash.toString(),
    },
  };
}
```

### 2.3 — Create Merkle path fetch API

The employee needs the Merkle path for their commitment to generate the proof. Add a new API route:

**New file:** `frontend/app/api/payroll/merkle-path/route.ts`

```typescript
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/payroll/merkle-path?commitment=<hex>&runId=<uuid>&employerAddress=<addr>
 *
 * Fetches the Merkle inclusion path for a commitment from NilDB.
 * Returns: { path: string[], pathIndex: number, merkleRoot: string }
 */
export async function GET(req: NextRequest) {
  const commitment = req.nextUrl.searchParams.get("commitment");
  const runId = req.nextUrl.searchParams.get("runId");

  if (!commitment || !runId) {
    return NextResponse.json({ error: "commitment and runId required" }, { status: 400 });
  }

  // Fetch the run from NilDB to get all commitments and reconstruct path
  const { getPayrollRun } = await import("@/lib/server/nillion-server");
  const { addressToCompanyId } = await import("@/lib/server/employee-store");

  const employerAddress = req.nextUrl.searchParams.get("employerAddress");
  if (!employerAddress) {
    return NextResponse.json({ error: "employerAddress required" }, { status: 400 });
  }

  const companyId = addressToCompanyId(employerAddress);
  const run = await getPayrollRun(companyId, runId);

  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const commitments: string[] = JSON.parse(run.commitments || "[]");
  const leafIndex = commitments.findIndex((c) => c === commitment);

  if (leafIndex === -1) {
    return NextResponse.json({ error: "Commitment not found in run" }, { status: 404 });
  }

  // Reconstruct Merkle path (matches the server-side tree in generate/route.ts)
  const { poseidon2 } = await import("poseidon-lite");
  const DEPTH = 20;
  const size = Math.pow(2, Math.ceil(Math.log2(Math.max(commitments.length, 1))));

  const leaves = commitments.map((c) => BigInt(c));
  while (leaves.length < size) leaves.push(BigInt(0));

  // Build full tree
  const tree: bigint[][] = [leaves];
  let layer = leaves;
  for (let level = 0; level < DEPTH; level++) {
    const next: bigint[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      next.push(poseidon2([layer[i] ?? BigInt(0), layer[i + 1] ?? BigInt(0)]));
    }
    tree.push(next);
    layer = next;
    if (layer.length === 1) break;
  }

  // Extract path for leafIndex
  const path: string[] = [];
  let idx = leafIndex;
  for (let level = 0; level < DEPTH; level++) {
    const sibling = idx % 2 === 0 ? idx + 1 : idx - 1;
    path.push((tree[level][sibling] ?? BigInt(0)).toString());
    idx = Math.floor(idx / 2);
  }

  return NextResponse.json({
    path,
    pathIndex: leafIndex,
    merkleRoot: run.merkle_root,
  });
}
```

### 2.4 — Build the claim UI in the employee dashboard

**File:** `frontend/app/employees/page.tsx`

Add a "Claim Payment" section that orchestrates the full proving flow. Add this state and handler to the page component:

```typescript
const [claimStep, setClaimStep] = useState<
  "idle" | "fetching-path" | "generating-proof" | "submitting-tx-a" |
  "submitting-tx-b" | "success" | "error"
>("idle");
const [claimError, setClaimError] = useState<string | null>(null);

const handleClaim = async (voucher: Voucher) => {
  if (!credential || !address) return;
  setClaimStep("fetching-path");
  setClaimError(null);

  try {
    // Step 1: Get Merkle path from server
    const pathRes = await fetch(
      `/api/payroll/merkle-path?commitment=${voucher.commitment}` +
      `&runId=${voucher.runId}&employerAddress=${voucher.employerAddress}`
    );
    if (!pathRes.ok) throw new Error("Failed to fetch Merkle path");
    const { path, pathIndex, merkleRoot } = await pathRes.json();

    // Step 2: Get employee's Token-2022 USDC ATA address
    // (must exist before claiming — guide user to create it)
    const ataRes = await fetch(`/api/employees/token-account?address=${address}`);
    const { tokenAccount } = await ataRes.json();

    setClaimStep("generating-proof");

    // Step 3: Generate ZK proof in browser (the heavy step)
    const { generateVoucherProof } = await import("@/lib/zk-proof");
    const generatedProof = await generateVoucherProof({
      credentialNonce: BigInt(credential.credentialNonce),
      voucherNonce: BigInt(voucher.voucherNonce!),
      merklePath: path.map((p: string) => BigInt(p)),
      pathIndex: BigInt(pathIndex),
      merkleRoot: BigInt(merkleRoot),
      amount: BigInt(voucher.amount!),
      epoch: BigInt(voucher.epoch!),
      recipientTokenAccount: new PublicKey(tokenAccount),
    });

    setClaimStep("submitting-tx-a");

    // Step 4: Get begin_verification transaction from server
    const txARes = await fetch("/api/payroll/begin-claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        proof: Array.from(generatedProof.proof),
        nullifier: generatedProof.nullifier.toString(),
        commitment: generatedProof.commitment.toString(),
        publicInputs: generatedProof.publicInputs,
        recipientAddress: address,
      }),
    });
    const { txA, txB } = await txARes.json();

    // Step 5: Sign and send Tx-A
    const sigA = await signAndSendTransaction(txA);
    console.log("Tx-A confirmed:", sigA);

    setClaimStep("submitting-tx-b");

    // Step 6: Sign and send Tx-B (complete_withdrawal)
    const sigB = await signAndSendTransaction(txB);

    setClaimStep("success");
    updateVoucher(voucher.commitment!, { ...voucher, status: "claimed", claimTxHash: sigB });

  } catch (err: any) {
    setClaimError(err.message || "Claim failed");
    setClaimStep("error");
  }
};
```

Display proof generation progress clearly in the UI:

```tsx
const claimStepMessages: Record<string, string> = {
  "fetching-path": "Fetching Merkle inclusion path...",
  "generating-proof": "Generating zero-knowledge proof in browser (~15s)...",
  "submitting-tx-a": "Submitting proof to Solana (Tx A)...",
  "submitting-tx-b": "Completing withdrawal (Tx B)...",
  "success": "Payment claimed successfully.",
};
```

### 2.5 — Create begin-claim API route

**New file:** `frontend/app/api/payroll/begin-claim/route.ts`

This route receives the proof bytes and public inputs from the browser, then builds the `begin_verification` and `complete_withdrawal` Anchor instructions as serialized transactions for the wallet to sign.

```typescript
import { NextRequest, NextResponse } from "next/server";
import {
  Connection, PublicKey, SystemProgram,
  TransactionMessage, VersionedTransaction,
} from "@solana/web3.js";
import { RPC_ENDPOINT, PROGRAM_ID } from "@/lib/solana-program";
import crypto from "crypto";

function discriminator(name: string): Buffer {
  return Buffer.from(
    crypto.createHash("sha256").update(`global:${name}`).digest().slice(0, 8)
  );
}

const IX_BEGIN_VERIFICATION = discriminator("begin_verification");
const IX_COMPLETE_WITHDRAWAL = discriminator("complete_withdrawal");

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      proof,          // number[] — proof bytes from bb.js
      nullifier,      // string — BN254 field element
      commitment,     // string — BN254 field element
      publicInputs,
      recipientAddress,
    } = body;

    const connection = new Connection(RPC_ENDPOINT, "confirmed");
    const submitter = new PublicKey(recipientAddress);
    const { blockhash } = await connection.getLatestBlockhash();

    const proofBytes = Buffer.from(proof);
    const proofHash = Buffer.from(
      crypto.createHash("sha256").update(proofBytes).digest()
    ); // [u8; 32]

    const nullifierBytes = to32BytesLE(BigInt(nullifier));
    const commitmentBytes = to32BytesLE(BigInt(commitment));

    // Derive session PDA
    const [sessionPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("verify"), proofHash],
      PROGRAM_ID
    );

    // Derive vault PDA from the merkle_root → look up employer
    // For this demo, we pass employerAddress in request or look it up
    // from the on-chain commitment registry
    const employerAddress = body.employerAddress;
    const employer = new PublicKey(employerAddress);
    const [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), employer.toBuffer()],
      PROGRAM_ID
    );

    // Tx-A: begin_verification
    const txA = buildBeginVerificationTx(
      submitter, sessionPda, proofHash, proofBytes,
      nullifierBytes, commitmentBytes, publicInputs,
      blockhash, vaultPda
    );

    // Tx-B: complete_withdrawal (unsigned — client signs after Tx-A confirms)
    const txB = buildCompleteWithdrawalTx(
      submitter, sessionPda, vaultPda,
      commitment, new PublicKey(body.recipientTokenAccount || recipientAddress),
      blockhash
    );

    return NextResponse.json({
      txA: Buffer.from(txA.serialize()).toString("base64"),
      txB: Buffer.from(txB.serialize()).toString("base64"),
      sessionPda: sessionPda.toBase58(),
    });
  } catch (err: any) {
    console.error("[begin-claim]", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

function to32BytesLE(value: bigint): Buffer {
  const buf = Buffer.alloc(32);
  let tmp = value;
  for (let i = 0; i < 32; i++) {
    buf[i] = Number(tmp & BigInt(0xff));
    tmp >>= BigInt(8);
  }
  return buf;
}

function buildBeginVerificationTx(
  submitter: PublicKey,
  sessionPda: PublicKey,
  proofHash: Buffer,
  proofData: Buffer,
  nullifier: Buffer,
  commitment: Buffer,
  publicInputs: any,
  blockhash: string,
  vaultPda: PublicKey,
): VersionedTransaction {
  const { TransactionInstruction } = require("@solana/web3.js");

  // Encode public inputs (VerificationPublicInputs Borsh layout)
  const piData = encodeVerificationPublicInputs(publicInputs, vaultPda);

  // Instruction data layout (matches begin_verification Anchor instruction):
  // discriminator(8) | proof_hash[32] | proof_data Vec<u8> | nullifier[32] | commitment[32] | public_inputs
  const proofLenBuf = Buffer.alloc(4);
  proofLenBuf.writeUInt32LE(proofData.length, 0);

  const data = Buffer.concat([
    IX_BEGIN_VERIFICATION,
    proofHash,
    proofLenBuf,
    proofData,
    nullifier,
    commitment,
    piData,
  ]);

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: submitter, isSigner: true, isWritable: true },
      { pubkey: sessionPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  return new VersionedTransaction(
    new TransactionMessage({
      payerKey: submitter,
      recentBlockhash: blockhash,
      instructions: [ix],
    }).compileToV0Message()
  );
}

function buildCompleteWithdrawalTx(
  submitter: PublicKey,
  sessionPda: PublicKey,
  vaultPda: PublicKey,
  commitment: string,
  recipientUsdc: PublicKey,
  blockhash: string,
): VersionedTransaction {
  // Placeholder — full implementation in Phase 2 follow-up
  // The complete_withdrawal instruction requires nullifier_account (init),
  // commitment_account, vault_usdc, recipient_usdc, token_program, clock
  // Derive them from sessionPda on client after Tx-A confirms
  const { TransactionInstruction } = require("@solana/web3.js");
  const data = Buffer.alloc(8);
  IX_COMPLETE_WITHDRAWAL.copy(data, 0);

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: submitter, isSigner: true, isWritable: true },
      { pubkey: sessionPda, isSigner: false, isWritable: true },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
    ],
    data,
  });

  return new VersionedTransaction(
    new TransactionMessage({
      payerKey: submitter,
      recentBlockhash: blockhash,
      instructions: [ix],
    }).compileToV0Message()
  );
}

function encodeVerificationPublicInputs(inputs: any, vaultPda: PublicKey): Buffer {
  // Borsh encoding of VerificationPublicInputs
  // Matches state.rs VerificationPublicInputs struct
  const PROGRAM_ID_CONST = new PublicKey(
    process.env.NEXT_PUBLIC_CIVITAS_PROGRAM_ID!
  );
  const USDC_MINT = new PublicKey(
    process.env.NEXT_PUBLIC_USDC_MINT!
  );

  const domainTag = Buffer.alloc(32);
  const domainTagRaw = Buffer.from("civitas-devnet-v1", "utf8");
  domainTagRaw.copy(domainTag);

  const merkleRoot = to32Bytes(BigInt(inputs.merkleRoot));
  const epochBuf = Buffer.alloc(8);
  epochBuf.writeBigUInt64LE(BigInt(inputs.epoch));
  const runIdBuf = Buffer.alloc(16); // zero for this flow
  const amountBuf = Buffer.alloc(8);
  amountBuf.writeBigUInt64LE(BigInt(inputs.amount));

  return Buffer.concat([
    domainTag,
    merkleRoot,
    epochBuf,
    runIdBuf,
    PROGRAM_ID_CONST.toBuffer(),
    vaultPda.toBuffer(),
    USDC_MINT.toBuffer(),
    new PublicKey(inputs.recipientTokenAccount || PublicKey.default).toBuffer(),
    amountBuf,
  ]);
}

function to32Bytes(value: bigint): Buffer {
  const buf = Buffer.alloc(32);
  let tmp = value;
  for (let i = 0; i < 32; i++) {
    buf[i] = Number(tmp & BigInt(0xff));
    tmp >>= BigInt(8);
  }
  return buf;
}
```

### 2.6 — Phase 2 Verification Checklist

- [ ] `frontend/lib/zk-proof.ts` created and exports `generateVoucherProof`
- [ ] `frontend/app/api/payroll/merkle-path/route.ts` created
- [ ] `frontend/app/api/payroll/begin-claim/route.ts` created
- [ ] Employee dashboard has "Claim Payment" button with step-by-step progress UI
- [ ] Running `nargo prove` locally with a test credential + voucher produces a valid proof
- [ ] `npm run build` still passes with 0 errors

---

## Phase 3 — Nillion Production Hardening
**Time estimate: 4 hours**

### 3.1 — Verify and harden the SecretVaultBuilderClient setup

**File:** `frontend/lib/server/nillion-server.ts`

The `ORG_SECRET_KEY` is pulled from env. Ensure your `.env.local` has:

```bash
NILLION_ORG_SECRET_KEY=<your_nucleus_program_key>
NILCC_ENDPOINT=<your_nilcc_endpoint_from_nucleus_dashboard>
```

Add a startup check that logs clearly if configuration is missing:

```typescript
if (!ORG_SECRET_KEY) {
  console.error(
    "[nillion] NILLION_ORG_SECRET_KEY is not set. " +
    "Nillion features will be unavailable. " +
    "Set this in .env.local from your Nucleus program dashboard."
  );
}
```

### 3.2 — Fix the nilCC manifest format

**File:** `frontend/app/api/payroll/generate/route.ts`

nilCC accepts Docker Compose-format manifests. The current manifest is a raw JSON object. Update `invokeNilCC` to send a proper nilCC workload request:

```typescript
async function invokeNilCC(manifest: object): Promise<...> {
  if (!NILCC_ENDPOINT) throw new Error("nilCC endpoint not configured");

  // nilCC API: POST /workloads with the computation manifest
  const workloadResp = await fetch(`${NILCC_ENDPOINT}/workloads`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.NILCC_API_KEY}`,
    },
    body: JSON.stringify({
      name: `civitas-payroll-${(manifest as any).run_id}`,
      image: process.env.NILCC_COMPUTE_IMAGE,  // your nilCC compute image
      input: manifest,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!workloadResp.ok) {
    const errText = await workloadResp.text();
    throw new Error(`nilCC workload submission failed: ${errText}`);
  }

  const { workload_id } = await workloadResp.json();

  // Poll for result
  for (let attempt = 0; attempt < 40; attempt++) {
    await new Promise((r) => setTimeout(r, 5_000));
    const resultResp = await fetch(
      `${NILCC_ENDPOINT}/workloads/${workload_id}`,
      { headers: { "Authorization": `Bearer ${process.env.NILCC_API_KEY}` } }
    );
    const result = await resultResp.json();
    if (result.status === "completed") return result.output;
    if (result.status === "failed") throw new Error(`nilCC failed: ${result.error}`);
  }

  throw new Error("nilCC timed out after 200 seconds");
}
```

Add `NILCC_API_KEY` and `NILCC_COMPUTE_IMAGE` to your `.env.local`.  
**Note:** Contact your Nillion Nucleus liaison for the exact API spec for your Nucleus tier — the above is the documented public API. Your Nucleus dashboard may provide different credentials.

### 3.3 — Protect salary data with %allot in employee records

**File:** `frontend/lib/server/nillion-server.ts`

Salary amounts must be stored as secret-shared fields. Find where employees are written to NilDB and ensure salary uses the `%allot` blindfold marker:

```typescript
// When creating an employee record, salary must be secret-shared
const employeeRecord = {
  _id: uuidv4(),
  employee_tag: employeeTag,      // public — hash of credential
  employee_name: name,            // public
  salary_policy: {
    "%allot": salaryAmount        // ← this marks the field for encryption
  },
  status: "active",
  created_at: new Date().toISOString(),
};
```

When reading salary back for payroll generation, the `%allot` value is decrypted by the Nillion client automatically.

### 3.4 — Phase 3 Verification Checklist

- [ ] `NILLION_ORG_SECRET_KEY` and `NILCC_ENDPOINT` are in `.env.local`
- [ ] nilCC invocation uses correct workload API format
- [ ] Employee salary records have `"%allot"` wrapper
- [ ] TEE status badge shows in payroll wizard after generation
- [ ] If nilCC is down, UI shows yellow warning badge (not silent fallback)

---

## Phase 4 — MagicBlock Ephemeral Rollup + SNS Integration
**Time estimate: 8 hours**  
**This targets the $5,000 MagicBlock Privacy Track and the SNS sub-track.**

### 4.1 — Architecture: why MagicBlock improves Civitas

**Current problem:** Committing a payroll run with 100 employees requires the employer to:
1. Sign `start_payroll_run` (1 tx)
2. Sign 4× `append_commitments_chunk` (4 txs for 100 employees at 32/chunk)
3. Sign `finalize_merkle_root` (1 tx)

Total: **6 wallet popups**, each must be confirmed sequentially.

**With MagicBlock Ephemeral Rollup:**
1. Delegate the `PayrollRunAccount` PDA to the ephemeral rollup
2. Execute all chunk transactions in the ephemeral rollup (zero-fee, real-time, no wallet popups)
3. Commit state back to Solana L1 with a single transaction
4. Employer signs **twice**: once to delegate, once to finalize and commit

### 4.2 — Add delegation to the Anchor program

**File:** `programs/civitas-payroll/src/instructions/start_payroll_run.rs`

Import the MagicBlock delegation CPI in your Cargo.toml:

```toml
[dependencies]
# Add to programs/civitas-payroll/Cargo.toml
delegation-program-utils = { git = "https://github.com/magicblock-labs/delegation-program", features = ["cpi"] }
```

In `start_payroll_run.rs`, after creating the `PayrollRunAccount`, add the delegation CPI:

```rust
use delegation_program_utils::cpi::delegate_account;

// After initialising the run account, delegate it to MagicBlock
// so chunk appends can happen in the ephemeral rollup
delegate_account(
    CpiContext::new_with_signer(
        ctx.accounts.delegation_program.to_account_info(),
        /* DelegateAccount accounts */,
        signer_seeds,
    ),
    &[],       // pda_seeds (already derived)
    0,         // max_delegation_lifetime: 0 = use default
    60_000,    // commit_interval_ms: 60 seconds
)?;
```

**Note:** Get the exact CPI signature from the MagicBlock examples repo:  
`https://github.com/magicblock-labs/magicblock-engine-examples/tree/main/anchor-counter`

### 4.3 — Update the payroll commit wizard to use Ephemeral Rollup

**File:** `frontend/components/employer/create-payroll-wizard.tsx`

Replace the current sequential transaction sending loop in Step 6 (Commit) with the MagicBlock session flow:

```typescript
import { Connection as EphemeralConnection } from "@magicblock-labs/ephemeral-rollups-sdk";

const MAGIC_ROUTER = "https://devnet-router.magicblock.app";

async function commitPayrollViaEphemeralRollup(
  runId: string,
  employerAddress: string,
  signAndSendTransaction: (tx: string) => Promise<string>
) {
  // Step 1: Get all commit transactions from server
  const res = await fetch("/api/payroll/commit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runId, employerAddress }),
  });
  const { transactions } = await res.json();

  // Tx[0] is start_payroll_run (L1 — must sign on Solana mainnet/devnet)
  // This also triggers account delegation to MagicBlock via CPI
  const startTxSig = await signAndSendTransaction(transactions[0]);
  console.log("Payroll run started + delegated:", startTxSig);

  // Steps 2..N-1: append_commitments_chunk — send to Ephemeral Rollup
  const erConnection = await EphemeralConnection.create(
    MAGIC_ROUTER,
    MAGIC_ROUTER.replace("https", "wss")
  );

  for (let i = 1; i < transactions.length - 1; i++) {
    const sig = await erConnection.sendAndConfirmTransaction(
      deserializeVersionedTx(transactions[i]),
      [],
      { skipPreflight: true }
    );
    console.log(`Chunk ${i} appended in ephemeral rollup:`, sig);
  }

  // Final tx: finalize_merkle_root — commits state back to L1 and undelegates
  const finalizeTxSig = await signAndSendTransaction(
    transactions[transactions.length - 1]
  );
  console.log("Merkle root finalized + committed to L1:", finalizeTxSig);

  return finalizeTxSig;
}
```

Update the wizard's Step 6 commit handler to call `commitPayrollViaEphemeralRollup` instead of the current sequential loop.

**Before/After UX:**
- Before: 6 wallet popups, employer waits ~10 seconds per popup
- After: 1 wallet popup (delegate + start), ephemeral processing, 1 wallet popup (finalize)

### 4.4 — SNS Domain Resolution in Employer Onboarding

**File:** `frontend/app/employer/page.tsx` (or the profile setup flow)

The `VaultState` on-chain already stores an `sns_domain` field. Add SNS domain lookup to the employer profile display:

```typescript
import { resolve, getTwitterRegistry } from "@bonfida/spl-name-service";
import { Connection, PublicKey } from "@solana/web3.js";

export async function resolveSNSDomain(
  connection: Connection,
  domain: string  // e.g. "civitas" (without .sol)
): Promise<PublicKey | null> {
  try {
    const owner = await resolve(connection, domain);
    return owner;
  } catch {
    return null;
  }
}

export async function getEmployerSNSDomain(
  connection: Connection,
  ownerPubkey: PublicKey
): Promise<string | null> {
  // Reverse lookup: given a pubkey, find the .sol domain
  // This requires checking the VaultState.sns_domain field stored on-chain
  // rather than a full reverse SNS lookup (which requires indexing)
  return null; // Implement via reading VaultState from chain
}
```

**In the vault initialization UI (`fund-deploy-modal.tsx`):**

Add a SNS domain input field that resolves and validates the domain before vault creation:

```tsx
const [snsDomain, setSnsDomain] = useState("");
const [snsResolved, setSnsResolved] = useState<string | null>(null);

const handleSnsLookup = async () => {
  const owner = await resolveSNSDomain(connection, snsDomain);
  if (owner && owner.toBase58() === walletAddress) {
    setSnsResolved(`✓ ${snsDomain}.sol resolves to your wallet`);
  } else if (owner) {
    setSnsResolved(`✗ ${snsDomain}.sol belongs to a different wallet`);
  } else {
    setSnsResolved(`✗ ${snsDomain}.sol not found`);
  }
};
```

### 4.5 — Phase 4 Verification Checklist

- [ ] `@magicblock-labs/ephemeral-rollups-sdk@0.6.5` is installed and types resolve
- [ ] `@bonfida/spl-name-service@3.0.19` is installed
- [ ] Payroll commit wizard shows "1 of 2 signatures" UX (not 6 popups)
- [ ] Employer onboarding has SNS domain input with validation
- [ ] `VaultState.sns_domain` is shown in the employer dashboard header
- [ ] Demo can show: employer signs once → chunks processed in ER → finalized on L1

---

## Phase 5 — Cloak Integration
**Time estimate: 6 hours**  
**This targets the Cloak Privacy Track.**

### 5.1 — Architecture: where Cloak fits in the Civitas privacy stack

```
Layer 1 — Data Privacy   : Nillion nilDB encrypts salary amounts at rest
Layer 2 — Compute Privacy: Nillion nilCC TEE processes payroll in secure enclave
Layer 3 — Claim Privacy  : Civitas ZK proof (Noir/UltraHonk) — employee claims
                           without revealing identity to employer
Layer 4 — Settlement     : Cloak shielded pool — payment received privately,
                           transaction graph is unlinkable on-chain
Layer 5 — Compliance     : Cloak viewing keys — auditors can verify total
                           disbursements without seeing individual amounts
```

This is a complete, credible, and unique privacy stack. No competitor at this hackathon has all four layers.

### 5.2 — Install and initialize the Cloak SDK

```bash
cd frontend
npm install @cloak.dev/sdk
```

**New file:** `frontend/lib/cloak.ts`

```typescript
import { CloakClient } from "@cloak.dev/sdk";
import { Connection } from "@solana/web3.js";

export const CLOAK_PROGRAM_ID = "zh1eLd6rSphLejbFfJEneUwzHRfMKxgzrgkfwA6qRkW";

let _cloakClient: CloakClient | null = null;

export async function getCloakClient(connection: Connection): Promise<CloakClient> {
  if (_cloakClient) return _cloakClient;
  _cloakClient = new CloakClient({
    connection,
    programId: CLOAK_PROGRAM_ID,
    // Additional config per @cloak.dev/sdk docs
  });
  return _cloakClient;
}
```

**Note:** Check the exact constructor signature at `https://docs.cloak.ag/sdk/introduction` — the SDK was recently released and the API may have minor differences. The `programId` above is the confirmed on-chain program ID from the research.

### 5.3 — Employee claim → Cloak shielded pool

After the employee completes `complete_withdrawal` (Phase 2), the USDC lands in their public token account. Add an optional step to shield the received funds in Cloak:

**File:** `frontend/app/employees/page.tsx`

Add a "Shield Payment" button that appears after a successful claim:

```typescript
const handleShieldPayment = async (amount: bigint, senderWallet: WalletContextState) => {
  const cloak = await getCloakClient(connection);

  // Create a UTXO in Cloak's shielded pool
  // This moves USDC from the public token account into Cloak's privacy pool
  const shieldTx = await cloak.createUtxo({
    amount,
    tokenMint: USDC_MINT,
    senderWallet,
  });

  const sig = await senderWallet.sendTransaction(shieldTx, connection);
  await connection.confirmTransaction(sig, "confirmed");

  console.log("Payment shielded in Cloak pool:", sig);
  return sig;
};
```

**UI for the claim card:**

```tsx
{voucher.status === "claimed" && !voucher.shielded && (
  <div className="mt-4 p-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5">
    <p className="text-xs text-white/60 mb-3">
      Your payment is in your wallet. Shield it for full transaction privacy.
    </p>
    <button
      onClick={() => handleShieldPayment(BigInt(voucher.amount!), wallet)}
      className="w-full py-2 rounded-lg border border-emerald-500/40 text-emerald-400 text-xs font-bold uppercase tracking-widest hover:bg-emerald-500/10 transition-all"
    >
      Shield with Cloak →
    </button>
  </div>
)}
```

### 5.4 — Auditor viewing keys integration

Cloak supports viewing keys that allow selective disclosure. Wire this into the auditor flow:

**File:** `frontend/components/auditor/auditor-requests.tsx`

```typescript
const handleGenerateViewingKey = async (
  employeeTag: string,
  cloak: CloakClient
) => {
  // Generate a viewing key scoped to this employee's UTXOs
  // The auditor can verify total amounts without seeing counterparty identity
  const viewingKey = await cloak.generateViewingKey({
    scope: employeeTag,
    expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days
  });

  return viewingKey;
};
```

Display the viewing key as a QR code or copyable string that the employer can share with an auditor during a compliance review.

### 5.5 — Update landing page to reflect full 4-layer privacy stack

**File:** `frontend/app/page.tsx`

Replace the three technology cards with accurate descriptions:

```typescript
const techCards = [
  {
    icon: <Database />,
    accent: "emerald",
    label: "Data Privacy",
    title: "Nillion nilDB + nilCC",
    desc: "Salary data stored as encrypted secret shares across Nillion nodes. Payroll computation runs inside a Trusted Execution Environment — amounts are never decrypted outside the enclave.",
  },
  {
    icon: <Shield />,
    accent: "blue",
    label: "Identity Privacy",
    title: "Noir UltraHonk ZK",
    desc: "Employees claim salary with a browser-generated zero-knowledge proof. No identity is revealed on-chain — only a nullifier that prevents double-claiming.",
  },
  {
    icon: <Lock />,
    accent: "violet",
    label: "Settlement Privacy",
    title: "Cloak Shielded Pool",
    desc: "Received payments are shielded in Cloak's UTXO pool. Transaction graph is unlinkable on-chain. Auditors access compliance data via cryptographic viewing keys.",
  },
];
```

### 5.6 — Phase 5 Verification Checklist

- [ ] `@cloak.dev/sdk` installs without errors
- [ ] `frontend/lib/cloak.ts` created with `getCloakClient`
- [ ] Employee dashboard shows "Shield with Cloak" after successful claim
- [ ] Auditor dashboard shows "Generate Viewing Key" for each employee
- [ ] Landing page tech stack is accurate (Nillion + Noir + Cloak — no Garaga, no Umbra)
- [ ] `npm run build` passes with 0 errors

---

## Phase 6 — Demo Preparation & Submission Polish
**Time estimate: 4 hours**

### 6.1 — Full end-to-end demo script

Practice this flow until it takes under 4 minutes. This is what you record for the video:

```
[0:00] Employer connects wallet → "Access Portal"
[0:15] Vault already initialized → shows VaultState with SNS domain
[0:25] Add employee: paste employee tag (copied from employee onboarding)
[0:40] Create payroll run → input run name + period
[0:50] Generate: nilCC TEE badge shows green ("Computed in Nillion nilCC TEE")
[1:10] Commit: single wallet popup, MagicBlock ER processes chunks
[1:30] Merkle root finalized on Solana — show Explorer link

--- switch to employee browser ---

[1:45] Employee imports credential, sees pending voucher
[2:00] "Claim Payment" → steps show: Fetching path → Generating proof → Submitting
[2:30] ZK proof generated → Tx-A signed → Tx-B confirmed → Payment received
[2:45] "Shield with Cloak" → shields USDC into Cloak pool
[3:00] Auditor generates viewing key → paste into auditor dashboard → sees totals

[3:15] Show Solana Explorer: nullifier PDA exists (prevents double-spend)
[3:30] Attempt to claim same voucher again → fails: "Nullifier already spent"
```

### 6.2 — Track submission write-ups

**Nillion Nucleus Track submission narrative:**
> Civitas uses Nillion as its foundational privacy layer. Employee salary data is stored as secret-shared encrypted records in Nillion nilDB — no single node can read salary amounts. Payroll computation (Poseidon commitment generation, Merkle tree construction) runs inside a Nillion nilCC TEE, producing an attestation that proves salary amounts never left the enclave. The Nucleus program integration includes nilDB collections for employees, payroll runs, and ZK vouchers, with %allot blindfold encryption on all sensitive fields.

**MagicBlock + SNS Track submission narrative:**
> Civitas integrates MagicBlock Ephemeral Rollups to solve a critical UX problem: committing a payroll run for 100 employees requires N+2 sequential on-chain transactions (chunk appending). With MagicBlock, the PayrollRunAccount PDA is delegated to the ephemeral rollup, all chunk transactions execute in real-time inside the rollup (zero fees), and state is committed back to Solana L1 in a single finalization transaction — reducing employer wallet interactions from 6+ popups to 2. Additionally, every Civitas vault is bound to an SNS .sol domain at initialization (live in the on-chain VaultState struct), enabling human-readable employer identity on-chain.

**Cloak Track submission narrative:**
> Civitas integrates Cloak as the final privacy layer in a 4-layer privacy stack: (1) Nillion nilDB for encrypted salary storage, (2) Nillion nilCC TEE for private payroll compute, (3) Noir ZK proofs for anonymous on-chain claiming, (4) Cloak shielded pool for post-payment transaction privacy. After an employee claims their salary via ZK proof, they can optionally shield the received USDC in Cloak's shielded pool, making the payment unlinkable on the transaction graph. Employers share Cloak viewing keys with auditors for compliance verification without exposing individual salary amounts.

### 6.3 — Environment variables reference

Create `frontend/.env.local.example` with all required variables:

```bash
# Solana
NEXT_PUBLIC_SOLANA_CLUSTER=devnet
NEXT_PUBLIC_SOLANA_RPC=https://api.devnet.solana.com
NEXT_PUBLIC_CIVITAS_PROGRAM_ID=CQW3TnN4X6iG2potguVv2hCKfk4f9tf8PMG7dTV6e24y
NEXT_PUBLIC_USDC_MINT=9pan9bMn5HatX4EJdBwg9VgCa7Uz5HL8N1m5D3NdXejP

# Nillion (from Nucleus dashboard)
NILLION_ORG_SECRET_KEY=
NILCC_ENDPOINT=
NILCC_API_KEY=
NILCC_COMPUTE_IMAGE=

# Cloak
NEXT_PUBLIC_CLOAK_PROGRAM_ID=zh1eLd6rSphLejbFfJEneUwzHRfMKxgzrgkfwA6qRkW

# MagicBlock
NEXT_PUBLIC_MAGIC_ROUTER=https://devnet-router.magicblock.app
```

### 6.4 — Final submission checklist

**Product completeness:**
- [ ] Employer can initialize vault with SNS domain
- [ ] Employer can add employees (salary stored with %allot in Nillion)
- [ ] Employer can generate payroll run (nilCC TEE with fallback badge)
- [ ] Employer can commit via MagicBlock ER (2 signatures, not 6)
- [ ] Employee can generate ZK proof in browser (real UltraHonk, not stub)
- [ ] Employee can claim payment (Tx-A + Tx-B confirmed)
- [ ] Employee can shield to Cloak pool
- [ ] Auditor can generate Cloak viewing key
- [ ] Double-spend attempt fails with "Nullifier already spent"

**Technical honesty:**
- [ ] No mention of Garaga anywhere in the product
- [ ] No "L2 Settlement" claim (Solana is L1)
- [ ] No mention of Umbra (EVM only)
- [ ] Token-2022 "confidential transfers" claim removed (disabled on devnet)
- [ ] TEE badge accurately shows nilCC vs local mode

**Demo assets:**
- [ ] 3-4 minute screen recording following the script in 6.1
- [ ] GitHub repo is public with clear README
- [ ] Anchor program IDL committed to repo
- [ ] Compiled circuit artifact (`target/voucher_noir.json`) committed
- [ ] `.env.local.example` committed (not `.env.local`)

---

## Appendix — Critical Math Reference

Every developer touching the ZK layer must know these exact formulas. Any deviation breaks the system.

| Value | Formula | Who computes |
|-------|---------|--------------|
| `employee_tag` | `Poseidon1(credential_nonce)` | Browser (registration) |
| `commitment` | `Poseidon4(employee_tag, amount, epoch, voucher_nonce)` | Server (payroll generate) |
| `nullifier` | `Poseidon3(credential_nonce, epoch, voucher_nonce)` | Browser (claim) |
| `merkle_root` | `Poseidon2` binary tree over all commitments | Server (payroll generate) |
| `proof` | UltraHonk with all above as public/private inputs | Browser (claim) |

The `employee_tag` stored in NilDB is a BN254 field element as a decimal string. **Never SHA256 it again before use in Poseidon.** Treat it as `BigInt(employee_tag)`.

---

## Appendix — Package Versions (Locked)

```json
{
  "@magicblock-labs/ephemeral-rollups-sdk": "0.6.5",
  "@bonfida/spl-name-service": "3.0.19",
  "@cloak.dev/sdk": "latest",
  "@aztec/bb.js": "^3.0.0-nightly.20251104",
  "@noir-lang/noir_js": "^1.0.0-beta.16",
  "@noir-lang/backend_barretenberg": "^0.36.0",
  "@nillion/secretvaults": "^2.0.0",
  "poseidon-lite": "^0.3.0"
}
```

---

*Civitas Implementation Plan — do not share externally before submission*
