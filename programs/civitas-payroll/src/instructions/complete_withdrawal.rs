//! complete_withdrawal (Tx-B) — second half of the split UltraHonk verifier.
//!
//! CU budget target: ≤ 600K CUs.
//!
//! What happens here:
//!   1. Loads VerificationSession from Tx-A.
//!   2. Verifies step1_passed == true (guards against incomplete flow).
//!   3. Checks session has not expired (100 slots = ~40s).
//!   4. Verifies: nullifier not yet spent (CommitmentAccount PDA not init'd).
//!   5. verifier::verify_step_2() runs KZG pairing check (~500K CU).
//!   6. Transfers confidential USDC via Token-2022 to the recipient.
//!   7. Creates NullifierAccount PDA (prevents reuse).
//!   8. Emits PaymentClaimed { nullifier } — NO amount, NO identity.

use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022::Token2022,
    token_interface::{transfer_checked, Mint, TokenAccount, TransferChecked},
};

use crate::{
    errors::CivitasError,
    events::PaymentClaimed,
    state::{NullifierAccount, VaultState, VerificationSession},
    verifier,
};

/// Maximum session age in slots before it expires (~100 slots ≈ 40 s at 400ms/slot).
const SESSION_TTL_SLOTS: u64 = 100;

#[derive(Accounts)]
pub struct CompleteWithdrawal<'info> {
    #[account(mut)]
    pub submitter: Signer<'info>,

    /// The VerificationSession created in Tx-A.
    #[account(
        mut,
        constraint = session.step1_passed @ CivitasError::Step1NotComplete,
        constraint = session.submitter == submitter.key() @ CivitasError::NotVaultOwner,
    )]
    pub session: Account<'info, VerificationSession>,

    #[account(
        mut,
        seeds = [b"vault".as_ref(), vault_state.owner.as_ref()],
        bump = vault_state.bump,
        constraint = session.public_inputs.vault_pda == vault_state.key() @ CivitasError::VaultMismatch,
    )]
    pub vault_state: Account<'info, VaultState>,

    /// NullifierAccount — must NOT exist (proves voucher was not spent).
    /// `init` will fail if the PDA already exists, preventing double-spend.
    #[account(
        init,
        payer = submitter,
        space = 8 + NullifierAccount::INIT_SPACE,
        seeds = [b"nullifier".as_ref(), session.nullifier.as_ref()],
        bump,
    )]
    pub nullifier_account: Account<'info, NullifierAccount>,

    pub usdc_mint: InterfaceAccount<'info, Mint>,

    /// Vault's confidential USDC source.
    #[account(
        mut,
        address = vault_state.usdc_vault,
    )]
    pub vault_usdc: InterfaceAccount<'info, TokenAccount>,

    /// Recipient Token-2022 USDC account (must match proof public input).
    #[account(
        mut,
        constraint = recipient_usdc.key() == session.public_inputs.recipient_token_account
            @ CivitasError::RecipientMismatch,
    )]
    pub recipient_usdc: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
    pub clock: Sysvar<'info, Clock>,
}

pub fn handler(ctx: Context<CompleteWithdrawal>, _session: Pubkey) -> Result<()> {
    let current_slot = ctx.accounts.clock.slot;
    let session = &ctx.accounts.session;

    // ── Expiry check ─────────────────────────────────────────────────────
    require!(
        current_slot <= session.created_slot.saturating_add(SESSION_TTL_SLOTS),
        CivitasError::SessionExpired
    );

    // ── Step 2: KZG pairing check ────────────────────────────────────────
    let step2_ok = verifier::verify_step_2(
        &session.proof_data,
        &session.nullifier,
        &session.commitment,
        &session.public_inputs,
    )?;
    require!(step2_ok, CivitasError::ProofVerificationStep2Failed);

    // ── Register nullifier (prevents double-spend) ───────────────────────
    let nullifier = session.nullifier;
    let nullifier_account = &mut ctx.accounts.nullifier_account;
    nullifier_account.nullifier = nullifier;
    nullifier_account.spent_at = ctx.accounts.clock.unix_timestamp;
    nullifier_account.bump = ctx.bumps.nullifier_account;

    // ── Transfer confidential USDC to recipient ──────────────────────────
    // Amount comes from the verified proof public input — not from calldata.
    let amount = session.public_inputs.amount;
    let decimals = ctx.accounts.usdc_mint.decimals;

    let vault_owner = ctx.accounts.vault_state.owner;
    let vault_bump = ctx.accounts.vault_state.bump;
    let seeds: &[&[u8]] = &[b"vault", vault_owner.as_ref(), &[vault_bump]];
    let signer_seeds = &[seeds];

    transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.vault_usdc.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to: ctx.accounts.recipient_usdc.to_account_info(),
                authority: ctx.accounts.vault_state.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
        decimals,
    )?;

    // Update approximate vault balance.
    ctx.accounts.vault_state.usdc_balance_approx = ctx
        .accounts
        .vault_state
        .usdc_balance_approx
        .saturating_sub(amount);

    emit!(PaymentClaimed {
        nullifier,
        vault_pda: ctx.accounts.vault_state.key(),
        slot: current_slot,
    });

    Ok(())
}
