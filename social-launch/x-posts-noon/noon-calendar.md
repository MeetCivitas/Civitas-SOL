# Civitas Noon Tech-Infographic Track — 30 days, 15:00 IST, May 19 → Jun 17 2026

**Audience:** engineers, architects, CTOs, Solana protocol nerds, ZK / TEE folks. People who skim until they see a diagram.
**Cadence:** 1 post/day at 15:00 IST.
**Format:** Mermaid diagram → rendered to PNG → attached. Caption ≤ 280 chars.
**Voice:** code-comment terseness. State the diagram's invariant. No emojis. No hashtags. URL in caption only when it pays.

Each post below has:
- `mermaid` block — rendered into `images/dayNN-noon.png`
- caption — actual post text (≤ 280 chars)

---

## Day 1 — Mon May 19 (15:00 IST)
**Topic:** End-to-end architecture (off-chain ↔ on-chain ↔ settlement)
```mermaid
flowchart LR
  subgraph OffChain["off-chain"]
    NDB[("nilDB %allot<br/>encrypted salaries")]
    TEE["nilCC TEE<br/>payroll compute"]
    CMP{compliance<br/>attest}
    NDB --> TEE --> CMP
  end
  subgraph Solana["on-chain (Solana)"]
    AUTH["authorize_disburse<br/>PDA-signed SPL"]
    QUE["MagicBlock<br/>encrypted queue ix"]
    CMP -->|attestation| AUTH --> QUE
  end
  subgraph Settlement["settlement (TEE crank)"]
    SET["3–30s jitter<br/>split + send"]
    QUE --> SET
  end
  SET --> EMP[(employee ATA)]
```
**Caption:**
```
The full Civitas pipeline in one image.

Off-chain: encrypted storage, TEE compute, compliance attest.
On-chain: a single atomic Solana tx — policy gate + private queue ix.
Settlement: TEE crank, 3–30s, employee just gets paid.

No claim flow. Ever.

meetcivitas.xyz
```

## Day 2 — Tue May 20
**Topic:** authorize_disburse policy gate — what runs before USDC moves
```mermaid
flowchart TD
  Tx["authorize_disburse(amount, recipient)"] --> A{compliance<br/>attestation<br/>fresh < 6h?}
  A -- no --> R1[(revert: STALE_ATTESTATION)]
  A -- yes --> B{recipient on<br/>Chainalysis<br/>allowlist?}
  B -- no --> R2[(revert: ADDRESS_BLOCKED)]
  B -- yes --> C{amount <<br/>per-employee cap?}
  C -- no --> R3[(revert: PER_EMP_CAP)]
  C -- yes --> D{daily total<br/>+ amount < cap?}
  D -- no --> R4[(revert: DAILY_CAP)]
  D -- yes --> E{treasury PDA<br/>balance ≥ amount?}
  E -- no --> R5[(revert: INSUFFICIENT_FUNDS)]
  E -- yes --> S["PDA-signed SPL transfer<br/>treasury_ata → employer_working_ata"]
```
**Caption:**
```
The policy gate inside `authorize_disburse`.

5 checks. All in-program. PDA holds custody.

If any fails, the tx reverts before a single lamport moves.

Employer's key can't bypass policy even if it's owned.

github.com/MeetCivitas/Civitas-SOL
```

## Day 3 — Wed May 21
**Topic:** MagicBlock encrypted queue lifecycle (the privacy primitive)
```mermaid
sequenceDiagram
  participant E as employer
  participant P as civitas_ephemeral
  participant Q as MagicBlock<br/>queue
  participant T as TEE crank
  participant R as recipient ATA
  E->>P: authorize_disburse + transferSpl ix (1 tx)
  P-->>P: PDA-signed SPL → working ATA
  P-->>Q: encrypted entry { amt, recipient, jitter, split }
  Q-->>Q: hold (3–30s, mempool-invisible)
  T->>Q: poll + decrypt
  T->>R: USDC settle (split sends)
  T-->>P: receipt sig
```
**Caption:**
```
The MagicBlock encrypted-queue lifecycle.

Encrypt at submit. Hold off-mempool. Decrypt only inside the TEE. Split + jitter on settle.

That's how the amount, the recipient, and the timing stay private — on a public chain.

3–30 seconds.
```

## Day 4 — Thu May 22
**Topic:** Treasury PDA seed derivation + ATA ownership
```mermaid
flowchart LR
  S1["seed[0] = b'treasury'"] --> H
  S2["seed[1] = employer.key"] --> H
  S3["seed[2] = bump"] --> H
  H[("PDA derive<br/>civitas_ephemeral")] --> P[Treasury PDA]
  P -->|owner of| ATA[(treasury ATA<br/>SPL token account)]
  ATA -->|holds| USD[(USDC)]
  P -.invoke_signed.-> XFER[/SPL transfer<br/>treasury_ata → working_ata/]
```
**Caption:**
```
Where the USDC actually lives in Civitas.

A program-derived address owns the treasury ATA. The PDA signs releases via `invoke_signed`. The employer never holds the SPL account itself.

Compromised employer key ≠ stolen payroll.
```

## Day 5 — Fri May 23
**Topic:** Compliance attestation — what gets signed
```mermaid
flowchart TB
  subgraph Inputs["compliance inputs · per org · per attest"]
    CHN["Chainalysis address screen"]
    GEO["IP geofence resolution"]
    JUR["jurisdiction allowlist"]
    NOW["ts: now"]
  end
  CHN & GEO & JUR & NOW --> ATT["attest_compliance"]
  ATT -->|writes| STATE["EmployerTreasury.compliance<br/>last_attest_ts<br/>passed_flags<br/>ip_country<br/>jurisdiction_id"]
  STATE -.read by.-> AUTH["authorize_disburse<br/>requires now - last_attest_ts < 6h"]
```
**Caption:**
```
What `attest_compliance` actually writes on-chain.

Not just a boolean. A struct: which checks passed, last timestamp, country, jurisdiction id.

`authorize_disburse` requires this struct to be fresher than 6h. Stale → revert.

Compliance is a deadline, not a checkbox.
```

## Day 6 — Sat May 24
**Topic:** nilDB %allot field-level secret sharing
```mermaid
flowchart LR
  S["employee.salary<br/>= 5000.00 USDC"] -- "%allot encrypt" --> SS["secret-shares<br/>(t-of-n)"]
  SS --> N1[(nilDB node 1)]
  SS --> N2[(nilDB node 2)]
  SS --> N3[(nilDB node 3)]
  SS --> N4[(nilDB node 4)]
  org[Civitas org<br/>holds reconstruct cap] -.reconstruct.-> CS["= 5000.00"]
  N1 & N2 & N3 -.subset.-> CS
```
**Caption:**
```
%allot field encryption in nilDB:

The salary number gets split into secret shares across N nodes. Any t-of-n reconstruct returns it. The org holds the reconstruct capability — we don't.

A subpoena to Civitas the company returns ciphertext shares. Not salaries.
```

## Day 7 — Sun May 25
**Topic:** nilCC TEE attestation chain (warm workload)
```mermaid
sequenceDiagram
  participant O as org operator
  participant C as nilCC CVM
  participant P as SNP processor
  O->>C: launch payroll workload
  C->>P: request attestation
  P-->>C: SNP measurement + signature
  C-->>O: { measurement, Ed25519 pubkey }
  O->>O: verify measurement = pinned_known_good
  loop per payroll run
    O->>C: signed input { run_id, employees }
    C-->>O: signed output { commitments, vouchers }
  end
```
**Caption:**
```
The nilCC warm-workload attestation chain.

Boot once → verify SNP measurement against a pinned hash → run many payrolls inside.

Each input + output is Ed25519-signed by the enclave. Verify outside.

~200× faster than spinning a fresh CVM per run.
```

## Day 8 — Mon May 26
**Topic:** Civitas data model (org → users → vouchers)
```mermaid
erDiagram
  ORG ||--o{ EMPLOYEE : employs
  ORG ||--o{ PAYROLL_TEMPLATE : owns
  PAYROLL_TEMPLATE ||--o{ RUN : instantiates
  RUN ||--o{ VOUCHER : produces
  VOUCHER }o--|| EMPLOYEE : pays
  ORG {
    string id PK
    string pubkey
    string jurisdiction
  }
  EMPLOYEE {
    string id PK
    bytes encrypted_salary
    bytes encrypted_pii
    string ata
  }
  PAYROLL_TEMPLATE {
    string id PK
    string frequency
    timestamp next_run
  }
  RUN {
    string id PK
    timestamp ts
    timestamp compliance_attest_ts
    bytes merkle_root
  }
  VOUCHER {
    string id PK
    bytes commitment
    bytes nonce
    string tx_hash
    string status
  }
```
**Caption:**
```
The Civitas data model — 5 entities.

Org owns employees + payroll templates. Templates instantiate runs. Runs produce vouchers. Vouchers pay employees.

PII + salary are encrypted at the row. Audits read commitments + tx hashes. Both can be true.
```

## Day 9 — Tue May 27
**Topic:** One disbursement, instruction-level breakdown
```mermaid
flowchart LR
  T["atomic Solana tx"] --> IX1["ix 1: refresh_compliance (if stale)"]
  T --> IX2["ix 2: authorize_disburse<br/>policy gate + invoke_signed transfer"]
  T --> IX3["ix 3: MagicBlock<br/>transferSpl visibility:private"]
  IX1 -.writes.-> STATE[(EmployerTreasury)]
  IX2 -.reads.-> STATE
  IX2 -.transfers.-> WATA[(employer working ATA)]
  IX3 -.consumes.-> WATA
  IX3 --> QUEUE[(encrypted queue)]
```
**Caption:**
```
One disbursement in 3 instructions, one atomic tx:

1. refresh_compliance — if needed
2. authorize_disburse — policy gate + PDA-signed SPL move
3. MagicBlock transferSpl({ visibility:'private' }) — encrypted-queue entry

If anything fails, none of it happens.
```

## Day 10 — Wed May 28
**Topic:** Voucher lifecycle (pending → settled)
```mermaid
stateDiagram-v2
  [*] --> created : run committed
  created --> pending : authorize_disburse tx confirmed
  pending --> settled : TEE crank settles SPL to recipient
  pending --> failed : crank retries exhausted (rare)
  failed --> pending : org re-attests + retries
  settled --> [*]
```
**Caption:**
```
The voucher lifecycle.

`created` → `pending` once on-chain auth confirms. `pending` → `settled` once the TEE crank lands the SPL. `failed` is rare and recoverable.

Status lives in encrypted nilDB. Auditor sees it. Chain sees only the SPL transfer.
```

## Day 11 — Thu May 29
**Topic:** Settlement latency Gantt
```mermaid
gantt
  title One disbursement: T+0 → T+settled
  dateFormat  X
  axisFormat  %Ss
  section off-chain
  compliance batch       :a1, 0, 8s
  TEE payroll compute    :a2, after a1, 12s
  section on-chain
  authorize_disburse     :b1, after a2, 0.4s
  MagicBlock queue ix    :b2, after b1, 0.3s
  section settlement
  encrypted-queue hold   :c1, after b2, 3s
  TEE crank decrypt      :c2, after c1, 0.5s
  SPL settle             :c3, after c2, 0.4s
```
**Caption:**
```
End-to-end latency for one disbursement.

Off-chain: ~20s (compliance + TEE compute, dominates).
On-chain: <1s (two ix in one tx).
Settlement: 3–30s queue jitter + sub-second SPL transfer.

The "feels like Stripe" claim is measurable.
```

## Day 12 — Fri May 30
**Topic:** Failure modes / replay protection
```mermaid
flowchart TD
  T[/authorize_disburse tx/] --> N{tx nonce in<br/>recent_blockhashes?}
  N -- no --> R1[(revert: STALE_TX)]
  N -- yes --> S{voucher_id<br/>seen before?}
  S -- yes --> R2[(revert: REPLAY)]
  S -- no --> A{attestation<br/>fresh?}
  A -- no --> R3[(revert: STALE_ATTEST)]
  A -- yes --> P[proceed]
  P --> W[(write voucher_id<br/>to seen set)]
```
**Caption:**
```
Replay protection in `authorize_disburse`.

Voucher ids are tracked in a bounded recent-set inside the program. Re-submitting the same voucher reverts at REPLAY before any check or transfer runs.

Same voucher can't be paid twice — even if the signer is the legitimate employer.
```

## Day 13 — Sat May 31
**Topic:** Daily-cap reset logic (per-employee + org-wide)
```mermaid
flowchart LR
  T[(now)] --> D{now / 86400 ><br/>last_reset_day?}
  D -- yes --> R[/reset cap_used = 0<br/>set last_reset_day = today/]
  D -- no --> K[keep cap_used]
  R & K --> C{cap_used + amt<br/>≤ daily_cap?}
  C -- no --> X[(revert: DAILY_CAP)]
  C -- yes --> A[cap_used += amt]
  A --> P[proceed]
```
**Caption:**
```
Daily-cap accounting in `authorize_disburse`.

Auto-reset on day boundary (UTC). Increment on success. Compared against `daily_cap` on the org account.

No cron, no off-chain scheduler. The chain is the calendar.
```

## Day 14 — Sun Jun 1
**Topic:** Threat model — what each layer protects against
```mermaid
flowchart TB
  subgraph Threats["adversary capability"]
    A1[steal employer key]
    A2[read public chain]
    A3[compromise Civitas servers]
    A4[compromise 1 nilDB node]
    A5[front-run the mempool]
  end
  A1 -.blocked by.-> L1["PDA-held treasury<br/>+ compliance gate"]
  A2 -.blocked by.-> L2["MagicBlock encrypted queue<br/>amount + recipient sealed"]
  A3 -.blocked by.-> L3["nilDB %allot<br/>(we don't hold the key)"]
  A4 -.blocked by.-> L4["t-of-n secret sharing<br/>(need t shares)"]
  A5 -.blocked by.-> L5["TEE-cranked settle<br/>(not in mempool)"]
```
**Caption:**
```
Civitas threat model — one image.

5 attacker capabilities. 5 layers that each one specifically defeats. Together: amount, recipient, timing, identity all stay confidential, and custody stays gated even if the employer key is owned.

This is the box.
```

## Day 15 — Mon Jun 2
**Topic:** Privy embedded-wallet flow (employee onboarding)
```mermaid
sequenceDiagram
  participant E as employee
  participant W as Civitas web
  participant P as Privy
  participant C as civitas_ephemeral
  E->>W: click invite link
  W->>P: login with Google
  P-->>W: embedded wallet + pubkey
  W->>C: register_employee(org, pubkey)
  C-->>W: ATA seed instructions
  W->>W: lazy-create ATA on first paystub
  W-->>E: dashboard ready
```
**Caption:**
```
Employee onboarding without the word "wallet."

Google OAuth via Privy → embedded wallet provisioned → pubkey registered on org → ATA lazy-created on first paystub.

Total time: <90 seconds. No seed phrases. They never know it's Solana.
```

## Day 16 — Tue Jun 3
**Topic:** SNS name resolution at recipient stage
```mermaid
flowchart LR
  IN["recipient: alice.sol"] --> R[Bonfida SNS resolver]
  R --> PK["pubkey: 4M…aP"]
  PK --> A[derive ATA]
  A --> CHK{Chainalysis<br/>screen}
  CHK --> AD[authorize_disburse]
  AD --> Q[MagicBlock queue]
  Q --> ATA[(alice's USDC ATA)]
```
**Caption:**
```
Paying someone by `.sol` name in Civitas.

Bonfida resolves → ATA derived → compliance screen → policy gate → encrypted queue → USDC arrives.

A name in. Funds out. The recipient never copy-pastes anything.

meetcivitas.xyz
```

## Day 17 — Wed Jun 4
**Topic:** Receipt PDF generation pipeline
```mermaid
flowchart LR
  V[(voucher<br/>settled)] --> NDB[(nilDB:<br/>decrypt PII<br/>+ amount)]
  NDB --> RPT[receipt JSON]
  RPT --> SIG[org-key sign]
  SIG --> TPL[HTML template]
  TPL --> PDF[(paystub.pdf<br/>signed)]
```
**Caption:**
```
How a Civitas paystub PDF gets made.

Pull voucher → decrypt PII inside the org-scoped context → sign the receipt JSON → render → emit a signed PDF.

The chain never sees the salary in cleartext. The PDF cryptographically commits to what it shows.
```

## Day 18 — Thu Jun 5
**Topic:** CPI graph — which program calls what
```mermaid
flowchart TB
  CIV[civitas_ephemeral] -- "invoke_signed" --> TKN[SPL Token program]
  CIV -- "cpi" --> MB[MagicBlock router]
  MB -- "internal" --> QUE[(encrypted queue PDA)]
  CIV -- "read" --> SYSVAR[(Clock sysvar)]
  CIV -- "read" --> RENT[(Rent sysvar)]
  CIV -- "writes" --> ET[(EmployerTreasury PDA)]
  CIV -- "writes" --> VC[(voucher record PDA)]
```
**Caption:**
```
The CPI graph of `civitas_ephemeral` v2.

One outbound CPI to SPL Token (transfers via PDA signer), one to the MagicBlock router. Reads Clock + Rent. Writes EmployerTreasury + voucher records.

Small surface. Audit-friendly.
```

## Day 19 — Fri Jun 6
**Topic:** Compute-unit budget per ix
```mermaid
%%{init: {"theme":"dark","themeVariables":{"primaryColor":"#5B8DEF"}}}%%
xychart-beta
  title "Compute units per civitas_ephemeral ix"
  x-axis ["init_pool","attest","shield","authorize","queue ix"]
  y-axis "CU" 0 --> 80000
  bar [12000, 18500, 22300, 41000, 31200]
```
**Caption:**
```
Compute-unit cost per Civitas instruction (devnet measured).

`authorize_disburse` is the heaviest at ~41k CU — it runs the full policy gate inside the program. Everything else is cheap.

Under 200k CU for the whole atomic-tx pipeline.
```

## Day 20 — Sat Jun 7
**Topic:** Cross-mint disbursement flow (future)
```mermaid
flowchart LR
  USR["employer pays in USDT"] --> SWAP["on-chain swap CPI<br/>Jupiter aggregator"]
  SWAP --> USDC[USDC]
  USDC --> AUTH["authorize_disburse<br/>per-mint cap check"]
  AUTH --> Q["MagicBlock queue"]
  Q --> ATA[(employee USDC ATA)]
```
**Caption:**
```
Cross-mint disbursement, sketched.

Employer holds USDT, employee gets USDC. A Jupiter CPI inside the same atomic tx, then the standard pipeline.

Per-mint caps + freshness still hold. The employee never sees the swap.

Roadmap. Not yet shipped.
```

## Day 21 — Sun Jun 8
**Topic:** Auditor read-key derivation
```mermaid
flowchart LR
  ORG[org master key] --> KDF["HKDF(domain='audit'<br/>+ run_id<br/>+ scope)"]
  KDF --> AK[auditor scoped key]
  AK --> RD[read-only<br/>nilDB capability]
  RD --> V[(decrypt vouchers<br/>in scope window)]
  AK -.expires.-> EX[after T+30d]
```
**Caption:**
```
How an auditor gets a scoped view.

HKDF from org master key + run_id + scope → time-bounded read-only capability. The chain stays in cleartext for the auditor's window.

Public chain still sees just settled SPL transfers. Audit happens off-chain, by design.
```

## Day 22 — Mon Jun 9
**Topic:** Helius observability hooks
```mermaid
flowchart LR
  TX[/Civitas tx confirmed/] --> H[Helius RPC]
  H --> WH[webhook<br/>parse]
  WH --> KS{kind?}
  KS -- authorize_disburse --> UP1[update voucher → pending]
  KS -- spl transfer<br/>from queue --> UP2[update voucher → settled]
  UP1 & UP2 --> DB[(nilDB voucher status)]
  DB --> NTF[employee push notif]
```
**Caption:**
```
Helius is the eyes-and-ears of Civitas.

Confirmed tx → webhook → instruction-parsed → voucher status updated → employee push.

Without it, you'd be polling RPC and chewing rate limits. With it, the dashboard feels real-time.

Tooling at the rail layer matters.
```

## Day 23 — Tue Jun 10
**Topic:** Mainnet hardening checklist (visualized)
```mermaid
flowchart TB
  AUDIT[external audit booked] --> RL[rate limits on<br/>/payroll/disburse]
  RL --> IDM[idempotency keys<br/>per voucher]
  IDM --> DR[disaster recovery drill<br/>treasury PDA freeze]
  DR --> CON[constant-time<br/>policy gate]
  CON --> CD[circuit breakers<br/>on daily_cap]
  CD --> RC1[mainnet RC1]
```
**Caption:**
```
Civitas mainnet hardening, in order:

1. External audit
2. API rate limits
3. Idempotency keys
4. Treasury-freeze DR drill
5. Constant-time policy gate
6. Circuit breakers on caps
→ RC1 cut

Audit report public the same week.
```

## Day 24 — Wed Jun 11
**Topic:** Front-running protections at settlement
```mermaid
flowchart LR
  AUTH[authorize_disburse confirms] -. visible .-> PUB[public mempool]
  AUTH --> QUE[encrypted queue ix]
  QUE -. not visible .-> PUB
  QUE --> TEE[TEE crank<br/>3–30s jitter<br/>split sends]
  TEE --> R1[recipient ATA<br/>send 1]
  TEE --> R2[recipient ATA<br/>send 2]
```
**Caption:**
```
What X-ray vision into a Civitas settlement actually shows.

The authorize tx is public — amounts are policy-checked, not payload. The queue ix carries the encrypted payload. Settlement is TEE-cranked, jittered, optionally split.

Amount hidden. Timing hidden. Graph hidden.
```

## Day 25 — Thu Jun 12
**Topic:** Disbursement decision tree (engineer's eye view)
```mermaid
flowchart TD
  ST[/start: pay X to alice/] --> O{org compliant<br/>and fresh?}
  O -- no --> RA[re-attest first]
  O -- yes --> S{salary in nilDB<br/>matches X?}
  S -- no --> RJ[(reject: salary mismatch)]
  S -- yes --> CB[build atomic tx:<br/>authorize_disburse + queue ix]
  CB --> SU[submit]
  SU --> CF[confirmed]
  CF --> WB[webhook: voucher → pending]
  WB --> SET[TEE settle]
  SET --> WB2[webhook: voucher → settled]
```
**Caption:**
```
What actually happens when you click "Pay" in Civitas.

Org compliance check → salary commitment match → build atomic tx → submit → confirmed → webhook updates → settle → webhook updates.

10 named states. Zero magic. The whole thing fits in your head.
```

## Day 26 — Fri Jun 13
**Topic:** Stress-test perf curve (10k employees)
```mermaid
%%{init: {"theme":"dark","themeVariables":{"primaryColor":"#7CF9C7"}}}%%
xychart-beta
  title "10k-employee payroll run: wall-clock per stage (s)"
  x-axis ["off-chain compute","compliance batch","on-chain dispatch","settle tail"]
  y-axis "seconds" 0 --> 35
  bar [12, 8, 14, 30]
```
**Caption:**
```
Civitas at 10,000 employees, one payroll run.

Off-chain compute (nilCC): 12s.
Compliance batch: 8s.
On-chain dispatch (parallel ix): 14s.
Settlement tail: 30s.

Total: ~64s wall-clock. Devnet numbers. Not promises.

github.com/MeetCivitas/Civitas-SOL
```

## Day 27 — Sat Jun 14
**Topic:** Token-2022 CT vs. MagicBlock queue (the pivot)
```mermaid
flowchart LR
  subgraph CT["Token-2022 CT (disabled)"]
    A1[private balance on mint]
    A2[ZK proof on every transfer]
    A3[on-chain compute heavy]
  end
  subgraph MB["MagicBlock encrypted queue (live)"]
    B1[base SPL transfer]
    B2[encrypted off-mempool payload]
    B3[TEE-cranked settle]
  end
  CT --x DIS[disabled by Solana audit 2026-04]
  MB --o GO[in production, devnet today]
```
**Caption:**
```
Why Civitas runs on MagicBlock encrypted queue, not Token-2022 CT.

CT is disabled. MagicBlock is shipping. We picked the production-ready private SPL primitive instead of waiting on a roadmap.

Engineering > waiting.
```

## Day 28 — Sun Jun 15
**Topic:** SDK call graph (what an integrator touches)
```mermaid
flowchart LR
  APP[your HR app] -- "civitas.disburse({...})" --> SDK[Civitas SDK]
  SDK --> A1["/api/compliance/attest"]
  SDK --> A2["/api/payroll/disburse"]
  A1 --> CIV[civitas_ephemeral]
  A2 --> CIV
  CIV --> ON[on-chain pipeline]
  ON --> WH[webhooks → SDK]
  WH --> APP
```
**Caption:**
```
Civitas SDK from an integrator's seat.

One method to call. Two API endpoints behind it. One on-chain program. Webhooks come back to your app for status updates.

Designed so Rippling/Deel/Justworks can plug in without rebuilding payroll.
```

## Day 29 — Mon Jun 16
**Topic:** Failure recovery state machine
```mermaid
stateDiagram-v2
  [*] --> healthy
  healthy --> attest_stale : 6h passed
  attest_stale --> healthy : refresh ok
  healthy --> rpc_degraded : Helius timeouts
  rpc_degraded --> healthy : fallback RPC
  healthy --> queue_backlog : TEE crank slow
  queue_backlog --> healthy : crank catches up
  healthy --> frozen : circuit breaker tripped
  frozen --> healthy : ops manual unfreeze
```
**Caption:**
```
Civitas operational state machine.

4 failure modes, each with a known recovery path. `frozen` is the only one that needs human hands — it's the circuit breaker for caps + solvency, and that's by design.

Operability is a design output, not an afterthought.
```

## Day 30 — Tue Jun 17
**Topic:** Civitas system invariants (the contract)
```mermaid
flowchart TD
  I1["I1: USDC never leaves treasury<br/>without a compliance attest<br/>fresh < 6h"]
  I2["I2: same voucher_id can be paid at most once"]
  I3["I3: per-employee daily cap is not exceeded"]
  I4["I4: amount sealed in queue<br/>= amount transferred to working_ata"]
  I5["I5: salary cleartext never lives<br/>outside org-scoped TEE / nilDB share quorum"]
  I1 --- I2 --- I3 --- I4 --- I5
```
**Caption:**
```
The 5 invariants Civitas commits to.

Custody. Replay. Caps. Encrypted-payload integrity. Salary confidentiality.

These are the things the audit will check. These are the things that fail closed.

If we ever break one of these, we owe you a postmortem.

meetcivitas.xyz
```

---

## Image strategy

Each diagram renders to `images/dayNN-noon.png` (1600×900, Civitas dark-brand background, Mermaid SVG embedded, headline + footer chrome).

## Operating notes

- All times IST. Posts fire at 15:00 IST.
- Captions ≤ 280 chars (verified at render).
- Mermaid CDN via `unpkg.com/mermaid` (pinned version).
- Theme: dark; primary teal `#7CF9C7`; accent `#5B8DEF`; bg `#05070d → #0b1322`.
- X free tier caps queue at ~50. New posts only schedule when the AM/PM queue drains.
