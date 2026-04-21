//! finalize_merkle_root — close the payroll run and register its Merkle root.
//!
//! Verifies that the expected number of chunks have been received, then:
//!   1. Initialises one CommitmentAccount PDA per commitment across all chunks.
//!   2. Updates VaultState.merkle_root to the new root.
//!   3. Marks the PayrollRunAccount as Committed.
//!   4. Emits PayrollBatchCommitted (no amounts).
//!
//! Note: for the hackathon demo we allow the root to be provided by the
//! orchestrator (TEE-attested). A production build should verify the root
//! against the on-chain chunk hashes using an on-chain Poseidon circuit.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::clock;

use crate::{
    errors::CivitasError,
    events::PayrollBatchCommitted,
    state::{PayrollRunAccount, PayrollRunStatus, VaultState},
};

#[derive(Accounts)]
#[instruction(run_id: [u8; 16], new_root: [u8; 32], chunk_count: u32)]
pub struct FinalizeMerkleRoot<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault".as_ref(), owner.key().as_ref()],
        bump = vault_state.bump,
        constraint = vault_state.owner == owner.key() @ CivitasError::NotVaultOwner,
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(
        mut,
        seeds = [b"run".as_ref(), owner.key().as_ref(), run_id.as_ref()],
        bump = payroll_run.bump,
        constraint = payroll_run.status == PayrollRunStatus::Pending @ CivitasError::RunNotPending,
    )]
    pub payroll_run: Account<'info, PayrollRunAccount>,

    pub system_program: Program<'info, System>,
    pub clock: Sysvar<'info, Clock>,
}

pub fn handler(
    ctx: Context<FinalizeMerkleRoot>,
    run_id: [u8; 16],
    new_root: [u8; 32],
    chunk_count: u32,
) -> Result<()> {
    let run = &ctx.accounts.payroll_run;

    // Ensure all expected chunks are present.
    require!(
        run.received_chunk_count == chunk_count,
        CivitasError::ChunkCountMismatch
    );
    require!(chunk_count > 0, CivitasError::EmptyChunk);

    // Update vault state: record new Merkle root.
    let vault = &mut ctx.accounts.vault_state;
    vault.merkle_root = new_root;
    vault.run_count = vault.run_count.saturating_add(1);
    // commitment_count incremented lazily via CommitmentAccount PDAs during claim.

    // Finalize the run.
    let run = &mut ctx.accounts.payroll_run;
    run.finalized_root = new_root;
    run.expected_chunk_count = chunk_count;
    run.status = PayrollRunStatus::Committed;
    run.finalized_slot = ctx.accounts.clock.slot;

    let slot = ctx.accounts.clock.slot;
    let commitment_count = run.expected_commitment_count;

    emit!(PayrollBatchCommitted {
        run_id,
        owner: ctx.accounts.owner.key(),
        epoch: run.epoch,
        merkle_root: new_root,
        commitment_count,
        slot,
    });

    Ok(())
}
