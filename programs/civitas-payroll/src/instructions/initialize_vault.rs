//! initialize_vault — create employer vault PDA + Token-2022 confidential USDC ATA

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_2022::Token2022,
    token_interface::{Mint, TokenAccount},
};

use crate::{
    events::VaultInitialized,
    state::{VaultState, MAX_SNS_DOMAIN_LEN},
};

#[derive(Accounts)]
#[instruction(sns_domain: Option<String>)]
pub struct InitializeVault<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        init,
        payer = owner,
        space = 8 + VaultState::INIT_SPACE,
        seeds = [b"vault".as_ref(), owner.key().as_ref()],
        bump,
    )]
    pub vault_state: Account<'info, VaultState>,

    /// The USDC Token-2022 mint with ConfidentialTransfer extension.
    pub usdc_mint: InterfaceAccount<'info, Mint>,

    /// Token-2022 ATA for the vault — will hold confidential USDC.
    #[account(
        init,
        payer = owner,
        associated_token::mint = usdc_mint,
        associated_token::authority = vault_state,
        associated_token::token_program = token_program,
    )]
    pub usdc_vault: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitializeVault>, sns_domain: Option<String>) -> Result<()> {
    // Validate SNS domain length if provided
    if let Some(ref domain) = sns_domain {
        require!(domain.len() <= MAX_SNS_DOMAIN_LEN, crate::errors::CivitasError::ChunkTooLarge);
    }

    let vault = &mut ctx.accounts.vault_state;
    vault.owner = ctx.accounts.owner.key();
    vault.merkle_root = [0u8; 32];
    vault.commitment_count = 0;
    vault.usdc_balance_approx = 0;
    vault.run_count = 0;
    vault.sns_domain = sns_domain.clone();
    vault.usdc_vault = ctx.accounts.usdc_vault.key();
    vault.bump = ctx.bumps.vault_state;

    emit!(VaultInitialized {
        owner: ctx.accounts.owner.key(),
        vault_pda: ctx.accounts.vault_state.key(),
        usdc_vault: ctx.accounts.usdc_vault.key(),
        sns_domain,
    });

    Ok(())
}
