//! On-chain events emitted by the Civitas payroll program.
//!
//! Privacy guarantee: NO salary amounts and NO employee addresses
//! appear in any event. External observers only see:
//!   - That a payroll batch was committed (run_id, epoch, count, root)
//!   - That a payment was claimed (nullifier only — unlinked to identity)
//!   - That an invoice was created/settled (id + commitment only)

use anchor_lang::prelude::*;

/// Emitted when a new employer vault is initialized.
#[event]
pub struct VaultInitialized {
    pub owner: Pubkey,
    pub vault_pda: Pubkey,
    pub usdc_vault: Pubkey,
    pub sns_domain: Option<String>,
}

/// Emitted when employer deposits USDC into the confidential vault.
/// Amount is NOT emitted — Token-2022 confidential transfer hides it.
#[event]
pub struct DepositReceived {
    pub vault_pda: Pubkey,
    pub depositor: Pubkey,
}

/// Emitted when a payroll run is started.
#[event]
pub struct PayrollRunStarted {
    pub run_id: [u8; 16],
    pub owner: Pubkey,
    pub epoch: u64,
    pub expected_commitment_count: u32,
}

/// Emitted each time a chunk of commitments is appended.
#[event]
pub struct CommitmentsChunkAppended {
    pub run_id: [u8; 16],
    pub chunk_index: u32,
    pub chunk_size: u32,
}

/// Emitted when a payroll batch is committed (root finalized).
/// No salary amounts. The event proves batch integrity on-chain.
#[event]
pub struct PayrollBatchCommitted {
    pub run_id: [u8; 16],
    pub owner: Pubkey,
    pub epoch: u64,
    pub merkle_root: [u8; 32],
    pub commitment_count: u32,
    pub slot: u64,
}

/// Emitted when a payment is successfully claimed (Groth16 proof verified,
/// USDC transferred, nullifier registered). Only the nullifier is emitted —
/// no amount, no identity.
#[event]
pub struct PaymentClaimed {
    pub nullifier: [u8; 32],
    pub vault_pda: Pubkey,
    pub slot: u64,
}

/// Emitted when an invoice is created.
#[event]
pub struct InvoiceCreated {
    pub id: [u8; 16],
    pub commitment: [u8; 32],
    pub creator: Pubkey,
    pub due_ts: i64,
}

/// Emitted when an invoice is paid.
#[event]
pub struct InvoicePaid {
    pub id: [u8; 16],
    pub run_id: [u8; 16],
}

/// Emitted when a VerificationSession PDA is closed.
#[event]
pub struct SessionClosed {
    pub proof_hash: [u8; 32],
}
