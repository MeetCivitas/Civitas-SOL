//! Civitas Private Payroll Program
//!
//! Implements private on-chain payroll on Solana using:
//!   - Noir UltraHonk ZK proofs for payment validity (split across 2 transactions)
//!   - Token-2022 Confidential Balances to hide USDC amounts on-chain
//!   - Poseidon BN254 Merkle trees for commitment sets
//!   - Nullifier registry to prevent double-claims
//!   - Chunked payroll commit pipeline (start_run → append_chunks → finalize_root)
//!   - SNS domain binding on VaultState
//!
//! Architecture:
//!   Employer calls: initialize_vault → deposit_usdc → start_payroll_run →
//!                   append_commitments_chunk(×N) → finalize_merkle_root
//!   Employee calls: begin_verification (Tx-A, ~800K CU) →
//!                   complete_withdrawal (Tx-B, ~600K CU) →
//!                   close_verification_session (cleanup)
//!   Contractor:     create_invoice → (employer) pay_invoice
//!
//! Security model:
//!   - Proof public inputs are domain-bound to: program_id, vault_pda, mint,
//!     recipient_token_account, run_id/epoch, and deployment domain tag.
//!   - Nullifiers are stored as PDAs; double-spend is rejected at the PDA
//!     init stage (init = error if already exists).
//!   - Token-2022 confidential balances hide USDC amounts at the protocol layer.

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_2022::{self, Token2022},
    token_interface::{Mint, TokenAccount},
};

pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;
pub mod verifier;

use instructions::*;
// Re-export for IDL generation
pub use state::VerificationPublicInputs;

declare_id!("CQW3TnN4X6iG2potguVv2hCKfk4f9tf8PMG7dTV6e24y");

#[program]
pub mod civitas_payroll {
    use super::*;

    /// Create a new payroll vault for an employer.
    /// Seeds: [b"vault", owner pubkey]
    /// Also initializes a Token-2022 confidential USDC vault ATA.
    pub fn initialize_vault(
        ctx: Context<InitializeVault>,
        sns_domain: Option<String>,
    ) -> Result<()> {
        instructions::initialize_vault::handler(ctx, sns_domain)
    }

    /// Deposit USDC from employer into the confidential vault.
    /// Uses Token-2022 apply_pending_balance for the confidential credit.
    pub fn deposit_usdc(ctx: Context<DepositUsdc>, amount: u64) -> Result<()> {
        instructions::deposit_usdc::handler(ctx, amount)
    }

    /// Begin a new payroll run (batch).
    /// Creates PayrollRunAccount PDA and locks run metadata.
    /// Seeds: [b"run", owner, run_id]
    pub fn start_payroll_run(
        ctx: Context<StartPayrollRun>,
        run_id: [u8; 16],
        epoch: u64,
        expected_commitment_count: u32,
    ) -> Result<()> {
        instructions::start_payroll_run::handler(ctx, run_id, epoch, expected_commitment_count)
    }

    /// Append a bounded chunk of Poseidon commitments for an in-progress run.
    /// Seeds: [b"chunk", run_id, chunk_index]
    /// Each chunk is capped at MAX_COMMITMENTS_PER_CHUNK to stay within tx limits.
    pub fn append_commitments_chunk(
        ctx: Context<AppendCommitmentsChunk>,
        run_id: [u8; 16],
        chunk_index: u32,
        commitments: Vec<[u8; 32]>,
    ) -> Result<()> {
        instructions::append_commitments_chunk::handler(ctx, run_id, chunk_index, commitments)
    }

    /// Finalize the Merkle root for a completed payroll run.
    /// Verifies all chunks are present, registers each CommitmentAccount,
    /// updates VaultState.merkle_root, emits PayrollBatchCommitted event.
    pub fn finalize_merkle_root(
        ctx: Context<FinalizeMerkleRoot>,
        run_id: [u8; 16],
        new_root: [u8; 32],
        chunk_count: u32,
    ) -> Result<()> {
        instructions::finalize_merkle_root::handler(ctx, run_id, new_root, chunk_count)
    }

    /// Tx-A of the split UltraHonk verifier.
    /// Stores proof bytes + partial state in VerificationSession PDA.
    /// Target: ≤ 900K CUs.
    /// Seeds: [b"verify", proof_hash]
    /// Caller must compute proof_hash = keccak256(proof_data) off-chain.
    pub fn begin_verification(
        ctx: Context<BeginVerification>,
        proof_hash: [u8; 32],
        proof_data: Vec<u8>,
        nullifier: [u8; 32],
        commitment: [u8; 32],
        public_inputs: VerificationPublicInputs,
    ) -> Result<()> {
        instructions::begin_verification::handler(ctx, proof_hash, proof_data, nullifier, commitment, public_inputs)
    }

    /// Tx-B of the split UltraHonk verifier.
    /// Loads VerificationSession, completes KZG pairing checks,
    /// verifies nullifier/commitment, transfers confidential USDC,
    /// creates NullifierAccount (prevents double-spend).
    /// Target: ≤ 600K CUs.
    pub fn complete_withdrawal(
        ctx: Context<CompleteWithdrawal>,
        session: Pubkey,
    ) -> Result<()> {
        instructions::complete_withdrawal::handler(ctx, session)
    }

    /// Create an invoice for contractor→client payment.
    /// Seeds: [b"invoice", invoice_id]
    pub fn create_invoice(
        ctx: Context<CreateInvoice>,
        id: [u8; 16],
        commitment: [u8; 32],
        due_ts: i64,
        metadata_cid: String,
    ) -> Result<()> {
        instructions::create_invoice::handler(ctx, id, commitment, due_ts, metadata_cid)
    }

    /// Pay an invoice: deposit → start run → append chunk → finalize root
    /// in a single atomic instruction (single commitment batch).
    pub fn pay_invoice(ctx: Context<PayInvoice>, invoice_id: [u8; 16]) -> Result<()> {
        instructions::pay_invoice::handler(ctx, invoice_id)
    }

    /// Close a VerificationSession PDA after successful withdrawal.
    /// Returns rent to the initiator.
    pub fn close_verification_session(
        ctx: Context<CloseVerificationSession>,
        _session: Pubkey,
    ) -> Result<()> {
        instructions::close_verification_session::handler(ctx)
    }
}
