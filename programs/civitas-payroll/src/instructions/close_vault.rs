//! close_vault — devnet utility: close the vault PDA + its token ATA.
//! Returns all rent lamports to the vault owner.
//! Allows reinitializing with the correct USDC mint after a misconfiguration.

use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022::Token2022,
    token_interface::{close_account, CloseAccount, Mint, TokenAccount},
};

use crate::{errors::CivitasError, state::VaultState};

#[derive(Accounts)]
pub struct CloseVault<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault".as_ref(), owner.key().as_ref()],
        bump = vault_state.bump,
        constraint = vault_state.owner == owner.key() @ CivitasError::NotVaultOwner,
        close = owner,
    )]
    pub vault_state: Account<'info, VaultState>,

    pub usdc_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        address = vault_state.usdc_vault,
    )]
    pub vault_usdc: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<CloseVault>) -> Result<()> {
    let vault_owner = ctx.accounts.vault_state.owner;
    let vault_bump = ctx.accounts.vault_state.bump;
    let seeds: &[&[u8]] = &[b"vault", vault_owner.as_ref(), &[vault_bump]];
    let signer_seeds = &[seeds];

    // Close the vault token account; lamports return to owner.
    // Works for both native (wrapped-SOL) ATAs and regular token ATAs
    // as long as the token balance is zero.
    close_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        CloseAccount {
            account: ctx.accounts.vault_usdc.to_account_info(),
            destination: ctx.accounts.owner.to_account_info(),
            authority: ctx.accounts.vault_state.to_account_info(),
        },
        signer_seeds,
    ))?;

    Ok(())
}
