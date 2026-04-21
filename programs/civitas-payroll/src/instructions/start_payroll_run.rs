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

    #[account(
        init,
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
    run.run_id = run_id;
    run.owner = ctx.accounts.owner.key();
    run.epoch = epoch;
    run.pending_root = [0u8; 32];
    run.finalized_root = [0u8; 32];
    run.expected_chunk_count = 0; // Updated at finalize time
    run.received_chunk_count = 0;
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
