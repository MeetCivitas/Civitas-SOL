//! pay_invoice — employer pays a contractor invoice.
//!
//! This is a single-commitment payroll run: deposit → start_run → append_chunk → finalize_root
//! The invoice commitment is registered as a payroll commitment; the contractor
//! then claims via the normal begin_verification / complete_withdrawal flow.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::clock;

use crate::{
    errors::CivitasError,
    events::{CommitmentsChunkAppended, InvoicePaid, PayrollBatchCommitted, PayrollRunStarted},
    state::{
        CommitmentChunkAccount, InvoiceAccount, InvoiceStatus, PayrollRunAccount,
        PayrollRunStatus, VaultState, MAX_COMMITMENTS_PER_CHUNK,
    },
};
use anchor_lang::solana_program::keccak;

#[derive(Accounts)]
#[instruction(invoice_id: [u8; 16])]
pub struct PayInvoice<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault".as_ref(), payer.key().as_ref()],
        bump = vault_state.bump,
        constraint = vault_state.owner == payer.key() @ CivitasError::NotVaultOwner,
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(
        mut,
        seeds = [b"invoice".as_ref(), invoice_id.as_ref()],
        bump = invoice_account.bump,
        constraint = invoice_account.status == InvoiceStatus::Pending @ CivitasError::InvoiceNotPending,
    )]
    pub invoice_account: Account<'info, InvoiceAccount>,

    /// Single-commitment payroll run PDA — seeded with a deterministic run_id from invoice_id.
    #[account(
        init,
        payer = payer,
        space = 8 + PayrollRunAccount::INIT_SPACE,
        seeds = [b"run".as_ref(), payer.key().as_ref(), invoice_id.as_ref()],
        bump,
    )]
    pub payroll_run: Account<'info, PayrollRunAccount>,

    /// Single-chunk PDA for the invoice commitment.
    #[account(
        init,
        payer = payer,
        space = 8 + CommitmentChunkAccount::INIT_SPACE,
        seeds = [b"chunk".as_ref(), invoice_id.as_ref(), 0u32.to_le_bytes().as_ref()],
        bump,
    )]
    pub chunk_account: Account<'info, CommitmentChunkAccount>,

    pub system_program: Program<'info, System>,
    pub clock: Sysvar<'info, Clock>,
}

pub fn handler(ctx: Context<PayInvoice>, invoice_id: [u8; 16]) -> Result<()> {
    let commitment = ctx.accounts.invoice_account.commitment;
    let epoch = ctx.accounts.clock.unix_timestamp as u64;
    let slot = ctx.accounts.clock.slot;

    // ── Start single-commitment payroll run ───────────────────────────────
    let run = &mut ctx.accounts.payroll_run;
    run.run_id = invoice_id;
    run.owner = ctx.accounts.payer.key();
    run.epoch = epoch;
    run.expected_commitment_count = 1;
    run.received_chunk_count = 1;
    run.expected_chunk_count = 1;
    run.status = PayrollRunStatus::Committed;
    run.finalized_slot = slot;
    run.bump = ctx.bumps.payroll_run;

    emit!(PayrollRunStarted {
        run_id: invoice_id,
        owner: ctx.accounts.payer.key(),
        epoch,
        expected_commitment_count: 1,
    });

    // ── Store single chunk ────────────────────────────────────────────────
    let flat: Vec<u8> = commitment.iter().copied().collect();
    let chunk_hash = keccak::hash(&flat).0;

    let chunk = &mut ctx.accounts.chunk_account;
    chunk.run_id = invoice_id;
    chunk.chunk_index = 0;
    chunk.commitments = vec![commitment];
    chunk.chunk_hash = chunk_hash;
    chunk.appended_by = ctx.accounts.payer.key();
    chunk.bump = ctx.bumps.chunk_account;

    emit!(CommitmentsChunkAppended {
        run_id: invoice_id,
        chunk_index: 0,
        chunk_size: 1,
    });

    // ── Finalize: use the single commitment as the Merkle root ────────────
    // For a single-leaf tree, the root equals the leaf (zero-padded path).
    let vault = &mut ctx.accounts.vault_state;
    vault.merkle_root = commitment;
    vault.run_count = vault.run_count.saturating_add(1);

    run.pending_root = commitment;
    run.finalized_root = commitment;

    emit!(PayrollBatchCommitted {
        run_id: invoice_id,
        owner: ctx.accounts.payer.key(),
        epoch,
        merkle_root: commitment,
        commitment_count: 1,
        slot,
    });

    // ── Mark invoice as Committed ─────────────────────────────────────────
    ctx.accounts.invoice_account.status = InvoiceStatus::Committed;

    emit!(InvoicePaid {
        id: invoice_id,
        run_id: invoice_id,
    });

    Ok(())
}
