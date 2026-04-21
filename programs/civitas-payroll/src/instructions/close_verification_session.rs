//! close_verification_session — close the VerificationSession PDA and reclaim rent.

use anchor_lang::prelude::*;

use crate::{events::SessionClosed, state::VerificationSession, errors::CivitasError};

#[derive(Accounts)]
pub struct CloseVerificationSession<'info> {
    #[account(mut)]
    pub submitter: Signer<'info>,

    #[account(
        mut,
        close = submitter,
        constraint = session.submitter == submitter.key() @ CivitasError::NotVaultOwner,
    )]
    pub session: Account<'info, VerificationSession>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<CloseVerificationSession>) -> Result<()> {
    let proof_hash = ctx.accounts.session.proof_hash;

    emit!(SessionClosed { proof_hash });

    // Anchor's `close = submitter` attribute automatically transfers rent
    // back to the submitter and zeroes the account — no manual steps needed.
    Ok(())
}
