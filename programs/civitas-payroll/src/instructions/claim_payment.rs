//! claim_payment — pure ZK gate. No on-chain settlement.
//!
//! What happens here (in one Solana transaction):
//!   1. Caller passes:
//!        - 256 B Groth16 proof (A: G1, B: G2, C: G1)
//!        - 32 B  pi_hash       — Poseidon commitment to the 10 binding fields
//!                                (merkle_root, nullifier, recipient, amount,
//!                                epoch, mint, vault_pda, program_id, run_id,
//!                                domain_tag) — recipient/amount are NOT
//!                                exposed in IX args; they are bound only
//!                                inside pi_hash.
//!        - 32 B  nullifier
//!        - 16 B  run_id
//!   2. Verifier runs Groth16 pairing check via `alt_bn128_pairing`.
//!   3. NullifierAccount PDA initialised — duplicate claims revert.
//!   4. VoucherConsumed event emitted (nullifier + pi_hash + run_id) so the
//!      off-chain dispatcher can recompute pi_hash from authoritative state
//!      + employee-provided (recipient, amount) and confirm binding before
//!      triggering the MagicBlock private transfer that actually moves USDC.
//!
//! Settlement is intentionally OFF-CHAIN. The MagicBlock Private Payments
//! API moves USDC from employer-ER → employee-ER with visibility=private,
//! split=N, randomized timing — so neither amount nor recipient appear in
//! any direct on-chain transfer linkable to this claim.
//!
//! CU budget: ~180k (just Groth16 verify + nullifier PDA init).

use anchor_lang::prelude::*;

use crate::{
    errors::CivitasError,
    events::VoucherConsumed,
    state::{NullifierAccount, PayrollRunAccount, PayrollRunStatus, GROTH16_PROOF_BYTES},
    verifier,
};

#[derive(Accounts)]
#[instruction(_proof_bytes: Vec<u8>, _pi_hash: [u8; 32], nullifier: [u8; 32], run_id: [u8; 16])]
pub struct ClaimPayment<'info> {
    /// The relayer or employee submitting the claim. Pays nullifier rent.
    /// Identity-unlinkable: this can be a fresh wallet — does not need to
    /// be the recipient of the eventual USDC payment.
    #[account(mut)]
    pub submitter: Signer<'info>,

    /// The specific payroll run this voucher belongs to. The proof binds
    /// to this run's `finalized_root` via pi_hash (off-chain verified by
    /// the dispatcher). Status must be Committed.
    #[account(
        seeds = [b"run".as_ref(), payroll_run.owner.as_ref(), run_id.as_ref()],
        bump = payroll_run.bump,
        constraint = payroll_run.status == PayrollRunStatus::Committed @ CivitasError::RunNotPending,
    )]
    pub payroll_run: Account<'info, PayrollRunAccount>,

    /// `init` will revert if the PDA already exists — anti-double-spend gate.
    #[account(
        init,
        payer = submitter,
        space = 8 + NullifierAccount::INIT_SPACE,
        seeds = [b"nullifier".as_ref(), nullifier.as_ref()],
        bump,
    )]
    pub nullifier_account: Account<'info, NullifierAccount>,

    pub system_program: Program<'info, System>,
    pub clock: Sysvar<'info, Clock>,
}

pub fn handler(
    ctx: Context<ClaimPayment>,
    proof_bytes: Vec<u8>,
    pi_hash: [u8; 32],
    nullifier: [u8; 32],
    run_id: [u8; 16],
) -> Result<()> {
    require!(
        proof_bytes.len() == GROTH16_PROOF_BYTES,
        CivitasError::ProofMalformed
    );

    // ── Cryptographic proof check ────────────────────────────────────────
    // The proof attests: there exists a witness (credential_nonce,
    // voucher_nonce, recipient, amount, ...) such that
    //   commitment ∈ payroll_run.finalized_root  (Merkle membership)
    //   nullifier  = Poseidon(credential_nonce, epoch, voucher_nonce)
    //   pi_hash    = SpongePoseidon over the 10 binding fields
    // The full pi_hash → authoritative-state binding is verified OFF-CHAIN
    // by the dispatcher before it triggers the MagicBlock private transfer.
    verifier::verify_voucher_proof(&proof_bytes, &pi_hash)?;

    // ── Register nullifier (init constraint already prevents reuse) ──────
    let null_acc = &mut ctx.accounts.nullifier_account;
    null_acc.nullifier = nullifier;
    null_acc.spent_at = ctx.accounts.clock.unix_timestamp;
    null_acc.bump = ctx.bumps.nullifier_account;

    emit!(VoucherConsumed {
        nullifier,
        run_id,
        pi_hash,
        slot: ctx.accounts.clock.slot,
    });

    Ok(())
}
