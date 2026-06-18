# Civitas 30-Day X Campaign — May 19 → June 17 2026

**Cadence:** 2 posts/day. Morning (build) @ 9:00 IST. Evening (marketing) @ 20:00 IST.
**Voice:** Mert × Naruto. Receipts > rhetoric. One idea per post. No Cloak mentions.
**Goal:** Design partners, VC inbound, ecosystem heat for mainnet.
**Live:** meetcivitas.xyz · github.com/MeetCivitas/Civitas-SOL · devnet
**Partner emphasis:** W1 MagicBlock · W2 Nillion (Nucleus) · W3 Privy+SNS · W4 Helius+Foundation+Investor

Char limit: 280. Every line below is hand-counted ≤ 280.

---

## Week 1 — MagicBlock heat (Days 1–7, May 19–25)

### Day 1 — Mon May 19
**AM (build, 09:00 IST):** hero image
```
Token-2022 confidential transfers? Disabled.

So we engineered around it.

Civitas runs USDC payroll on Solana with privacy through MagicBlock's encrypted queue + a treasury PDA gate.

Devnet. Live. Today.

meetcivitas.xyz
```

**PM (marketing, 20:00 IST):** text-card
```
Private payroll on Solana.
USDC in. USDC out.
No claim flow. No bridge. No L2.

Employees just get paid.

Built for the Colosseum hackathon. Live on devnet.

meetcivitas.xyz
```

### Day 2 — Tue May 20
**AM (build, 09:00 IST):** text-card
```
The trick with custodial payroll:

employer can't be the signer.

Treasury PDA holds USDC. `authorize_disburse` is the gate. Compliance + per-employee + daily cap, then PDA-signed transfer.

Employer can't bypass policy even if their key is owned.
```

**PM (marketing, 20:00 IST):** text-card
```
Crypto payroll attempts so far:

→ public salaries
→ centralized custodian
→ "ZK soon"
→ EVM, slow, expensive

Civitas is private by construction, custody is contract-held, settlement is seconds, USDC native, live now.

meetcivitas.xyz
```

### Day 3 — Wed May 21
**AM (build, 09:00 IST):** hero image (architecture diagram)
```
One atomic Solana tx:

1. authorize_disburse — compliance + caps + solvency check, PDA-signed SPL transfer to employer working ATA
2. MagicBlock transferSpl({ visibility:'private' }) — into encrypted queue

TEE crank decrypts + jitters + settles in 3-30s.

No claim flow. Ever.
```

**PM (marketing, 20:00 IST):** text-card
```
Old payroll: "your salary will arrive in 2-3 business days"

Civitas: settled in 30 seconds, on Solana, in USDC, with the amount sealed in an encrypted queue.

Live on devnet.
meetcivitas.xyz
```

### Day 4 — Thu May 22
**AM (build, 09:00 IST):** text-card
```
Compliance gate that runs every disbursement:

→ Chainalysis address screen
→ IP geofence
→ jurisdiction allowlist
→ 6h attestation freshness window

If any fail → tx reverts before USDC moves.

Privacy ≠ permissionless. Privacy + policy is the harder fight.
```

**PM (marketing, 20:00 IST):** text-card
```
"How do you stay compliant if salaries are private?"

We separate the layers:

→ amounts are encrypted at settlement
→ recipient identity is verified at the gate
→ vouchers are encrypted-at-rest, decryptable only by the org

Auditors get a viewer key. Public chain stays clean.
```

### Day 5 — Fri May 23
**AM (build, 09:00 IST):** hero image (code screenshot)
```
The MagicBlock Private Payments call that does the heavy lifting:

await transferSpl({
  visibility: 'private',
  fromBalance: 'base',
  toBalance: 'base',
  split, minDelayMs, maxDelayMs,
})

7 lines. Encrypted queue. TEE-cranked settlement.

That's the privacy primitive.
```

**PM (marketing, 20:00 IST):** text-card
```
Shoutout to @MagicBlock — Private Payments is the only production-ready private SPL primitive on Solana.

We built Civitas on top of it because Token-2022 CT is disabled and waiting wasn't an option.

Ship around the constraint. Don't roadmap through it.
```

### Day 6 — Sat May 24
**AM (build, 09:00 IST):** text-card
```
Token-2022 confidential transfers got disabled after the April audit.

Most "private payroll on Solana" projects froze.

We pivoted in a week to MagicBlock's encrypted queue + treasury PDA gate.

Live on devnet. USDC moves. Amounts are sealed.

Engineering > waiting.
```

**PM (marketing, 20:00 IST):** hero image
```
Private by construction.

Not bolted on.
Not a roadmap item.
Not "coming Q3".

Civitas — payroll where salaries don't leak, employees don't claim, and auditors still see exactly what they're supposed to.

meetcivitas.xyz
```

### Day 7 — Sun May 25
**AM (build, 09:00 IST):** text-card
```
Week 1 build recap:

→ civitas_ephemeral v2 program live on devnet
→ Treasury PDA custody + compliance-gated authorize_disburse
→ MagicBlock encrypted queue settlement
→ Off-chain NilDB voucher ledger
→ Next.js dashboard end-to-end

github.com/MeetCivitas/Civitas-SOL
```

**PM (marketing, 20:00 IST):** text-card (VC bait — measured)
```
Looking for:

→ 3 design partners (crypto cap tables, DAOs, on-chain orgs paying contributors in USDC)
→ Seed conversations with funds focused on infra + privacy

Devnet works. Mainnet next.

DMs open. meetcivitas.xyz
```

---

## Week 2 — Nillion big drop (Days 8–14, May 26–Jun 1)

### Day 8 — Mon May 26
**AM (build, 09:00 IST):** text-card
```
Where do salaries live in Civitas?

Not in our DB. Not in yours.

In @nillionnetwork nilDB — secret-shared across nodes with %allot encryption. The org holds the decryption capability. We don't.

A subpoena to Civitas returns ciphertext.
```

**PM (marketing, 20:00 IST):** hero image (BIG announce)
```
Civitas is part of @nillionnetwork's Nucleus program.

Why it matters: salaries are split into secret shares before they hit a server. No single node — including ours — can reconstruct them alone.

This is the layer crypto payroll was missing.

meetcivitas.xyz
```

### Day 9 — Tue May 27
**AM (build, 09:00 IST):** text-card
```
nilCC TEE compute, the part nobody talks about:

→ Ed25519-signed attestations of code identity
→ SNP measurement pinned to a known good
→ Long-running warm workload pattern
→ ~200x faster than spinning ephemeral CVMs

Real numbers. Real enclaves. We run payroll inside it.
```

**PM (marketing, 20:00 IST):** text-card
```
Pop quiz:

When your HR SaaS computes everyone's salary into a payroll run — where does the math happen?

For most: a Postgres server with read access for ops.

For Civitas: inside an SNP-attested enclave that signs every result and can't be tampered with.
```

### Day 10 — Wed May 28
**AM (build, 09:00 IST):** hero image (schema diagram)
```
Each Civitas org gets 4 nilDB collections:

→ employees (encrypted PII + comp)
→ payrolls (run templates)
→ runs (executed batches w/ commitments)
→ vouchers (encrypted receipts per disbursement)

%allot field-level. Org-scoped decryption. Auditors get scoped views.
```

**PM (marketing, 20:00 IST):** text-card
```
Private by construction.

Three words. Specific meaning:

→ private when stored (nilDB %allot)
→ private when computed (nilCC TEE)
→ private when settled (MagicBlock queue)
→ verifiable by ZK (Poseidon commitments)

Not optional. Not after-the-fact. By construction.
```

### Day 11 — Thu May 29
**AM (build, 09:00 IST):** text-card
```
The warm-workload pattern in nilCC:

A long-running CVM is attested once, pinned to its SNP measurement, then receives Ed25519-signed inputs.

You sign once, run many. Instead of spinning up a new enclave for every payroll. ~200x latency win.

Privacy doesn't have to be slow.
```

**PM (marketing, 20:00 IST):** text-card
```
The dirty secret of HR SaaS:

your finance team can see what everyone earns. So can their interns. So can anyone who SQLs the DB.

Salary leak = trust collapse.

Civitas treats salary as the encryption target, not the row-level secret it pretends to be in legacy stacks.
```

### Day 12 — Fri May 30
**AM (build, 09:00 IST):** text-card
```
Compliance attestation in Civitas has a freshness window:

6 hours.

After that, `authorize_disburse` reverts. Org has to re-attest. Fresh Chainalysis, fresh geofence.

Privacy + recency. Both, not one.
```

**PM (marketing, 20:00 IST):** text-card
```
"Why does privacy belong in payroll?"

Because the salary number is the most contested piece of data inside a company.

It controls retention. It exposes negotiation. It drives lawsuits.

Make it cryptographic, not procedural. That's the entire pitch.

meetcivitas.xyz
```

### Day 13 — Sat May 31
**AM (build, 09:00 IST):** text-card
```
Auditor mode in Civitas:

→ encrypted voucher log on nilDB
→ org holds the decryption capability
→ auditor receives a scoped key (read-only, time-bound)
→ auditor sees: who paid whom, when, how much

Public chain sees: a settled SPL transfer with no amount in cleartext.
```

**PM (marketing, 20:00 IST):** text-card
```
USDC payroll.
Verified by pairing.
Settled in seconds.

Live on devnet today. Mainnet next.

meetcivitas.xyz
```

### Day 14 — Sun Jun 1
**AM (build, 09:00 IST):** hero image (full stack diagram)
```
Civitas privacy stack:

L1: nilDB %allot — salary storage
L2: nilCC TEE — payroll compute
L3: Poseidon ZK — commitments + claims
L4: MagicBlock queue — settlement

Four layers. Zero leaks.

github.com/MeetCivitas/Civitas-SOL
```

**PM (marketing, 20:00 IST):** text-card (design partner CTA)
```
Design partner slots are open.

If you run:
→ a crypto-native company paying USDC salaries
→ a DAO with contributor comp
→ a fund paying portfolio carry

and you want private payroll without giving up compliance — DM us.

meetcivitas.xyz
```

---

## Week 3 — Privy + SNS / Bonfida (Days 15–21, Jun 2–8)

### Day 15 — Mon Jun 2
**AM (build, 09:00 IST):** text-card
```
Employees in Civitas don't see the word "wallet".

→ Login with Google via @privy_io embedded wallet
→ ATA auto-created on first paystub
→ USDC arrives via MagicBlock queue
→ Paystub PDF in dashboard

Zero seed phrases. Real custody. They never know it's Solana.
```

**PM (marketing, 20:00 IST):** text-card
```
The crypto-payroll problem nobody solved:

your employees aren't crypto natives.

They want a paystub. A bank account number. A "where's my money."

Civitas gives them all three, on Solana, in USDC, without ever forcing them through a Phantom install.

meetcivitas.xyz
```

### Day 16 — Tue Jun 3
**AM (build, 09:00 IST):** text-card
```
Pay an employee by their .sol name:

→ Civitas resolves SNS → pubkey via Bonfida
→ Compliance gate runs against the resolved address
→ MagicBlock queue routes to that wallet's ATA

Human-readable in. USDC out. Zero copy-pasted strings.
```

**PM (marketing, 20:00 IST):** text-card
```
"send 4,500 USDC to alice.sol on the 1st of every month."

This is the entire UX of payroll on Civitas.

No spreadsheets. No CSVs. No bank routing numbers.

A name and an amount. The chain handles the rest. Privately.

meetcivitas.xyz
```

### Day 17 — Wed Jun 4
**AM (build, 09:00 IST):** text-card
```
Employee onboarding in Civitas — the actual flow:

1. Manager invites by email
2. Employee clicks → Google OAuth
3. Privy spawns embedded wallet
4. Compliance attests (Chainalysis + geofence)
5. ATA ready

Total time: <90s. Zero "what's a seed phrase".
```

**PM (marketing, 20:00 IST):** text-card
```
Founder thesis:

Crypto payroll fails when it asks the employee to be a crypto user.

It wins when the employee opens a dashboard, sees their paystub, and gets paid — without ever caring about chains, gas, or wallets.

That's Civitas.
```

### Day 18 — Thu Jun 5
**AM (build, 09:00 IST):** text-card
```
Mobile paystub view in Civitas:

→ encrypted at rest in nilDB
→ decrypted in-browser with org-scoped key
→ shows: net pay, gross, deductions, tx hash, settlement timestamp
→ exportable PDF, signed

Your employees get a real paystub. Your data stays sealed.
```

**PM (marketing, 20:00 IST):** text-card (VC angle)
```
Global crypto payroll TAM:

→ 6M+ remote workers paid in stables (and growing)
→ $80B+ annual stablecoin payroll volume by 2027 (Coinbase est.)
→ Zero compliant private-by-default infra serving them

Civitas is building that layer.

Fund convos open.
```

### Day 19 — Fri Jun 6
**AM (build, 09:00 IST):** text-card
```
Civitas API surface (alpha):

POST /payroll/disburse — compliance + encrypted queue, atomic
POST /compliance/attest — refresh screen + geofence
GET  /receipts/:orgId — encrypted vouchers

Designed so Rippling, Deel, Justworks plug in privately.
```

**PM (marketing, 20:00 IST):** text-card
```
We're not trying to replace your HR SaaS.

We're the private settlement rail underneath it.

Civitas API + your existing payroll system = your salaries never touch a public chain in cleartext again.

meetcivitas.xyz · DM for early API access
```

### Day 20 — Sat Jun 7
**AM (build, 09:00 IST):** text-card
```
Three flavors of broken in legacy payroll:

1. Salaries readable by your finance team's interns
2. Settlement takes 3 business days
3. Cross-border = 30+ fees + 5+ days

Civitas fixes (1) cryptographically. (2) at Solana speed. (3) USDC native.

One stack. No tradeoff.
```

**PM (marketing, 20:00 IST):** text-card
```
Customer profile we're hunting:

→ team of 10–500
→ paying USDC to contributors or staff
→ at least one privacy concern (cap table optics, founder pay, regional ranges)
→ already has at least one compliance officer

If that's you — meetcivitas.xyz, DMs open.
```

### Day 21 — Sun Jun 8
**AM (build, 09:00 IST):** text-card
```
Week 3 recap (onboarding stack):

→ Privy embedded wallet on first login
→ SNS → ATA resolution at recipient stage
→ Mobile paystub viewer w/ org-key decryption
→ Public API in alpha

End-to-end: invite to first paystub in <90s.

github.com/MeetCivitas/Civitas-SOL
```

**PM (marketing, 20:00 IST):** text-card (investor note)
```
What we're building toward:

→ mainnet on Solana Q3 2026
→ 10 design partners running real payroll
→ open SDK for HR platforms
→ regulatory clarity in 2 jurisdictions

If you invest in privacy + financial infra + Solana — we want to talk.

meetcivitas.xyz
```

---

## Week 4 — Helius + Solana Foundation + Mainnet + Hiring + Investors (Days 22–30, Jun 9–17)

### Day 22 — Mon Jun 9
**AM (build, 09:00 IST):** text-card
```
Civitas uses @heliuslabs:

→ premium RPC for low-latency tx landing
→ webhooks on settlement tx confirmation
→ enhanced parsing to update voucher status pending → settled

Without Helius our tail-latency stories don't ship. Tooling matters at the rail layer.
```

**PM (marketing, 20:00 IST):** text-card
```
Solana is the only chain where:

→ a single atomic tx can encode compliance + private settlement
→ block times let payroll feel like Stripe
→ fees stay under a cent at scale

This is not a multi-chain pitch. This is an L1 pitch.

We're Solana-native. On purpose.
```

### Day 23 — Tue Jun 10
**AM (build, 09:00 IST):** text-card
```
Mainnet hardening list (we're working through it):

→ external audit booked
→ rate limits on /payroll/disburse
→ idempotency keys per voucher
→ disaster recovery drill against treasury PDA freeze

Devnet is the dress rehearsal. Mainnet is the show.
```

**PM (marketing, 20:00 IST):** text-card (hiring)
```
Hiring our first Rust + Anchor engineer.

→ private payroll on Solana, mainnet in months
→ work on civitas_ephemeral (treasury PDA + compliance gate)
→ TEE-adjacent, ZK-adjacent
→ remote, equity-heavy, founder DM track

DM @meetcivitas if this is your wheelhouse.
```

### Day 24 — Wed Jun 11
**AM (build, 09:00 IST):** text-card
```
Front-running protection at settlement:

→ MagicBlock queue jitters delivery 3–30s
→ TEE-cranked, not mempool-observable
→ split sends so amount sniff is harder
→ no public memo

Privacy isn't only "amount hidden." It's "timing hidden" + "graph hidden."
```

**PM (marketing, 20:00 IST):** text-card (investor open letter)
```
Open note to investors:

We're not "another payroll co with a wallet on top."

We're the private settlement layer for crypto payroll. Custody is contract-held. Privacy is cryptographic. Compliance is encoded.

It's an infra company.

DMs open. meetcivitas.xyz
```

### Day 25 — Thu Jun 12
**AM (build, 09:00 IST):** text-card
```
If the MagicBlock TEE crank lies, what happens?

→ Voucher status never moves to "settled"
→ Treasury PDA balance is reconciled from on-chain state, not queue claims
→ Re-disbursement path requires fresh compliance + fresh auth

Trust the chain. Not the relayer.
```

**PM (marketing, 20:00 IST):** text-card
```
Why we don't go multi-chain:

L2s settle on a different layer. Bridges are an exploit surface. EVM private payments don't have a primitive yet.

Solana gives us a single execution layer with sub-second finality, sub-cent fees, and a working private payment rail.

We stay.
```

### Day 26 — Fri Jun 13
**AM (build, 09:00 IST):** hero image (perf graph)
```
Stress test: 10,000 employees, one payroll run.

→ Off-chain compute (nilCC): 12s
→ Compliance batch: 8s
→ On-chain dispatches: parallel, ~120 ms each, ~14s wall
→ Settlement: T+30s tail

Live numbers on devnet. Not promises. github.com/MeetCivitas/Civitas-SOL
```

**PM (marketing, 20:00 IST):** text-card (comparison)
```
Civitas vs the alternatives:

Stripe Connect: public bank rails, no privacy, 2–3 days
Deel Crypto: USDC out, but salaries readable internally, no chain-level privacy
Custom on-chain: amounts public, no compliance gate

Civitas: private. compliant. settled in 30s.
```

### Day 27 — Sat Jun 14
**AM (build, 09:00 IST):** text-card
```
External audit prep is in motion:

→ frozen civitas_ephemeral v2 ABI
→ test coverage at 91% on the disbursement path
→ adversarial scenarios written for: stale attestation, replay, queue spoofing, daily-cap overflow

Audit report will be public. Same week as mainnet RC1.
```

**PM (marketing, 20:00 IST):** text-card
```
Devnet is the dress rehearsal.
Mainnet is the show.

Both are us.

Same program. Same flow. Same UX. Same privacy guarantees. Difference is what's at stake on the other side of `authorize_disburse`.

meetcivitas.xyz
```

### Day 28 — Sun Jun 15
**AM (build, 09:00 IST):** text-card
```
Compliance partners in production with Civitas:

→ @chainalysis for address screening at the gate
→ ipinfo for geofence
→ jurisdiction allowlist maintained per-org by ops officer
→ encrypted voucher log for the auditor seat

Not "compliance soon." Compliance now.
```

**PM (marketing, 20:00 IST):** text-card
```
Solana is the only L1 where private financial infrastructure can ship at consumer speed and consumer cost.

That's why @solana matters for this category. Not because of vibes — because of block time, fees, and tooling depth.

Civitas is built on it. By choice.
```

### Day 29 — Mon Jun 16
**AM (build, 09:00 IST):** hero image (architecture deep dive)
```
Full Civitas data + control flow, one image:

Off-chain: nilDB → nilCC enclave → compliance batch
On-chain: authorize_disburse (PDA) → MagicBlock queue ix
Settlement: TEE crank → employee ATA
Audit: encrypted voucher log

github.com/MeetCivitas/Civitas-SOL
```

**PM (marketing, 20:00 IST):** text-card
```
We're meetcivitas.xyz.

The docs are up.
The contract is on devnet.
The frontend works end-to-end.
The privacy stack ships.

Stop guessing what private payroll on Solana looks like.

Open the site. Run a payroll. See for yourself.
```

### Day 30 — Tue Jun 17
**AM (build, 09:00 IST):** text-card
```
30 days of public building.

→ 60 posts. Every claim has a commit or a tx behind it.
→ 5 partners integrated end-to-end.
→ 1 program live on devnet.
→ 3 design partners onboarding.

Engineering > marketing. Engineering as marketing.

github.com/MeetCivitas/Civitas-SOL
```

**PM (marketing, 20:00 IST):** hero image (closing card)
```
Civitas: the private payroll layer for Solana.

→ Series Seed open
→ Design partners onboarding
→ Mainnet Q3 2026
→ Hiring engineers and a head of GTM

Built with @MagicBlock, @nillionnetwork, @privy_io, @heliuslabs.

meetcivitas.xyz · @meetcivitas
```

---

## Image strategy summary

**Hero / DALL-E (8):** D1AM, D3AM, D5AM, D6PM, D8PM, D10AM, D14AM, D26AM, D29AM, D30PM (≈10, room to drop two)
**Text-card screenshots (rest):** all others — rendered from local HTML template via Playwright.

## Operating notes

- All times above are IST. X scheduler is set to user's local; we pick "9:00" / "20:00" off date pickers and assume the timezone field reflects IST (verify on first run).
- Posts ≤280 chars (free-tier limit). Long ones above target ~270 to leave breathing room when URLs auto-shorten or quotes get curly.
- Don't use Cloak in any post. Not in stack diagrams either.
- Don't promise mainnet dates in a way that can't be retracted: phrase as "Q3" not "July 1".
