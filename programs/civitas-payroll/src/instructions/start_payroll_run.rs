//! start_payroll_run — begin a new payroll batch.

use anchor_lang::prelude::*;

use crate::{
    errors::CivitasError,
    events::PayrollRunStarted,
    state::{PayrollRunAccount, PayrollRunStatus, VaultState},
};

#[derive(Accounts)]
#[instruction(run_id: [u8; 16], epoch: u64, expected_commitment_count: u32)]
pub struct StartPayrollRun<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        seeds = [b"vault".as_ref(), owner.key().as_ref()],
        bump = vault_state.bump,
        constraint = vault_state.owner == owner.key() @ CivitasError::NotVaultOwner,
    )]
    pub vault_state: Account<'info, VaultState>,

    /// `init_if_needed` so a retry of a partially-completed commit (e.g. when
    /// MagicBlock private payments fails after start_payroll_run already
    /// landed) doesn't fail with AccountAlreadyInUse. The handler asserts
    /// the existing run still belongs to this owner and is still Pending,
    /// so a finalized run cannot be silently reopened.
    #[account(
        init_if_needed,
        payer = owner,
        space = 8 + PayrollRunAccount::INIT_SPACE,
        seeds = [b"run".as_ref(), owner.key().as_ref(), run_id.as_ref()],
        bump,
    )]
    pub payroll_run: Account<'info, PayrollRunAccount>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<StartPayrollRun>,
    run_id: [u8; 16],
    epoch: u64,
    expected_commitment_count: u32,
) -> Result<()> {
    require!(expected_commitment_count > 0, CivitasError::EmptyChunk);

    let run = &mut ctx.accounts.payroll_run;

    // If the PDA already existed (Anchor's init_if_needed reused it), make
    // sure it's still safe to use. A finalized or wrong-owner run must not
    // be reopened.
    let is_fresh = run.run_id == [0u8; 16];
    if !is_fresh {
        require!(run.owner == ctx.accounts.owner.key(), CivitasError::NotVaultOwner);
        require!(run.status == PayrollRunStatus::Pending, CivitasError::RunAlreadyFinalized);
    }

    run.run_id = run_id;
    run.owner = ctx.accounts.owner.key();
    run.epoch = epoch;
    run.pending_root = [0u8; 32];
    run.finalized_root = [0u8; 32];
    run.expected_chunk_count = 0; // Updated at finalize time
    // Preserve received_chunk_count so a partial run can resume.
    if is_fresh {
        run.received_chunk_count = 0;
    }
    run.expected_commitment_count = expected_commitment_count;
    run.status = PayrollRunStatus::Pending;
    run.finalized_slot = 0;
    run.bump = ctx.bumps.payroll_run;

    emit!(PayrollRunStarted {
        run_id,
        owner: ctx.accounts.owner.key(),
        epoch,
        expected_commitment_count,
    });

    Ok(())
}
