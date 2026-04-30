//! append_commitments_chunk — store one bounded chunk of Poseidon commitments.
//!
//! Bounded by MAX_COMMITMENTS_PER_CHUNK to stay within Solana tx / account limits.
//! Uses keccak256 of the serialised commitments as a chunk integrity hash.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::keccak;

use crate::{
    errors::CivitasError,
    events::CommitmentsChunkAppended,
    state::{
        CommitmentChunkAccount, PayrollRunAccount, PayrollRunStatus, VaultState,
        MAX_COMMITMENTS_PER_CHUNK,
    },
};

#[derive(Accounts)]
#[instruction(run_id: [u8; 16], chunk_index: u32, commitments: Vec<[u8; 32]>)]
pub struct AppendCommitmentsChunk<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
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

    /// `init_if_needed` so a retry of a partially-completed commit doesn't
    /// fail with AccountAlreadyInUse. The handler short-circuits when the
    /// chunk has already been appended with the same hash, and rejects
    /// chunks that change content.
    #[account(
        init_if_needed,
        payer = owner,
        space = 8 + CommitmentChunkAccount::INIT_SPACE,
        seeds = [b"chunk".as_ref(), run_id.as_ref(), chunk_index.to_le_bytes().as_ref()],
        bump,
    )]
    pub chunk_account: Account<'info, CommitmentChunkAccount>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<AppendCommitmentsChunk>,
    run_id: [u8; 16],
    chunk_index: u32,
    commitments: Vec<[u8; 32]>,
) -> Result<()> {
    require!(!commitments.is_empty(), CivitasError::EmptyChunk);
    require!(
        commitments.len() <= MAX_COMMITMENTS_PER_CHUNK,
        CivitasError::ChunkTooLarge
    );

    // Compute keccak256 of the serialized commitment bytes for chunk integrity.
    let flat: Vec<u8> = commitments.iter().flat_map(|c| c.iter().copied()).collect();
    let chunk_hash = keccak::hash(&flat).0;

    let chunk = &mut ctx.accounts.chunk_account;

    // Idempotent retry: if this chunk PDA was already populated with the
    // same commitments, do nothing. Reject if content differs.
    let was_populated = chunk.run_id != [0u8; 16];
    if was_populated {
        require!(chunk.run_id == run_id, CivitasError::ChunkIndexOutOfRange);
        require!(chunk.chunk_index == chunk_index, CivitasError::ChunkIndexOutOfRange);
        require!(chunk.chunk_hash == chunk_hash, CivitasError::PublicInputMismatch);
        return Ok(());
    }

    chunk.run_id = run_id;
    chunk.chunk_index = chunk_index;
    chunk.commitments = commitments.clone();
    chunk.chunk_hash = chunk_hash;
    chunk.appended_by = ctx.accounts.owner.key();
    chunk.bump = ctx.bumps.chunk_account;

    // Increment the received chunk counter on the run only on first insert.
    let run = &mut ctx.accounts.payroll_run;
    run.received_chunk_count = run
        .received_chunk_count
        .checked_add(1)
        .ok_or(CivitasError::CounterOverflow)?;

    emit!(CommitmentsChunkAppended {
        run_id,
        chunk_index,
        chunk_size: commitments.len() as u32,
    });

    Ok(())
}
