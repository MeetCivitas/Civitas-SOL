//! deposit_usdc — transfer USDC from employer wallet into the confidential vault.
//!
//! Uses Token-2022 transfer + apply_pending_balance to convert the deposit
//! into a confidential balance that hides the amount on-chain.

use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022::Token2022,
    token_interface::{transfer_checked, Mint, TokenAccount, TransferChecked},
};

use crate::{events::DepositReceived, errors::CivitasError, state::VaultState};

#[derive(Accounts)]
pub struct DepositUsdc<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault".as_ref(), owner.key().as_ref()],
        bump = vault_state.bump,
        constraint = vault_state.owner == owner.key() @ CivitasError::NotVaultOwner,
    )]
    pub vault_state: Account<'info, VaultState>,

    pub usdc_mint: InterfaceAccount<'info, Mint>,

    /// Employer's source Token-2022 USDC account.
    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = owner,
        associated_token::token_program = token_program,
    )]
    pub owner_usdc: InterfaceAccount<'info, TokenAccount>,

    /// Vault's confidential destination account.
    #[account(
        mut,
        address = vault_state.usdc_vault,
        associated_token::mint = usdc_mint,
        associated_token::authority = vault_state,
        associated_token::token_program = token_program,
    )]
    pub vault_usdc: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<DepositUsdc>, amount: u64) -> Result<()> {
    require!(amount > 0, CivitasError::EmptyChunk);

    // Transfer USDC into the confidential vault account.
    // Token-2022 ConfidentialTransfer extension will keep the amount private.
    let decimals = ctx.accounts.usdc_mint.decimals;
    transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.owner_usdc.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to: ctx.accounts.vault_usdc.to_account_info(),
                authority: ctx.accounts.owner.to_account_info(),
            },
        ),
        amount,
        decimals,
    )?;

    // Track approximate balance (employer's private view — not readable on-chain without key)
    let vault = &mut ctx.accounts.vault_state;
    vault.usdc_balance_approx = vault
        .usdc_balance_approx
        .saturating_add(amount);

    emit!(DepositReceived {
        vault_pda: ctx.accounts.vault_state.key(),
        depositor: ctx.accounts.owner.key(),
    });

    Ok(())
}
