# Build Context

```yaml
review:
  security_score: C
  quality_score: B
  findings:
    - severity: high
      category: security
      description: "The plan makes the custom on-chain UltraHonk verifier the critical path without a fallback if Solana CU, stack, heap, or account-size constraints make the verifier impractical on hackathon timelines."
      fix: "Add a fallback milestone with an alternate settlement path: either off-chain proof verification plus signed attestation, or a simpler proof/settlement mode for the demo, while keeping the on-chain verifier as an advanced milestone."
    - severity: high
      category: correctness
      description: "The proposed `update_merkle_root(new_root, commitments: Vec<[u8;32]>)` instruction does not account for Solana transaction-size limits, account write limits, and growth in commitment registries."
      fix: "Replace the single-shot commit path with `start_payroll_run`, `append_commitments_chunk`, and `finalize_merkle_root`, and plan to use versioned transactions and address lookup tables if the account list grows."
    - severity: high
      category: security
      description: "Proof binding is incomplete for Solana deployment boundaries. The circuit adds `token_account_hash`, but the public-input domain still does not clearly bind program id, vault, mint, recipient token account, and cluster/deployment domain."
      fix: "Expand the proof public inputs or transcript domain separator to include `program_id`, `vault_pda`, mint, recipient token account, payroll run or epoch id, and a deployment domain tag to prevent replay across vaults or environments."
    - severity: medium
      category: correctness
      description: "Token-2022 confidential balances are treated as a library integration, but the plan omits confidential-account provisioning, encryption key lifecycle, browser-state recovery, and auditor-key policy."
      fix: "Add a dedicated Token-2022 onboarding phase that covers confidential account creation, proof generation flow, decrypt key storage and recovery, and mint capability validation before building the higher-level UX."
    - severity: medium
      category: security
      description: "The account model uses one PDA per nullifier and one PDA per commitment, which is simple for a demo but expensive in rent and write amplification and may not scale beyond small payroll runs."
      fix: "Document the demo-safe approach explicitly and add a scale path using chunked registries, bitmaps, or epoch-scoped append-only accounts plus an indexer for retrieval."
    - severity: medium
      category: testing
      description: "The verification plan lacks Solana-specific failure tests such as CU regressions, transaction-size checks, confidential-token local validator tests, and finalized-transaction reconciliation."
      fix: "Add tests for compute budget, transaction serialization size, Token-2022 confidential flows on a local validator, nullifier replay, wrong-root proofs, and indexer reconciliation after finalized settlement."
  ready_for_mainnet: false
```
