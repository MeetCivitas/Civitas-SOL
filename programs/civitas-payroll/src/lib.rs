//! Civitas Private Payroll Program
//!
//! Implements private on-chain payroll on Solana using:
//!   - Groth16 BN254 ZK proofs for voucher redemption (single-tx claim)
//!     verified on-chain via Solana's `alt_bn128_pairing` syscall
//!   - Poseidon BN254 Merkle trees for commitment sets
//!   - Nullifier PDAs to prevent double-claims (init = error if exists)
//!   - Chunked payroll commit pipeline (start_run → append_chunks → finalize_root)
//!   - SNS domain binding on VaultState
//!
//! Architecture:
//!   Employer:   initialize_vault → deposit_usdc → start_payroll_run →
//!               append_commitments_chunk(×N) → finalize_merkle_root
//!   Employee:   claim_payment (single tx — proof verify + transfer + nullifier)
//!   Contractor: create_invoice → (employer) pay_invoice
//!
//! Security model:
//!   - Public inputs are domain-bound to: program_id, vault_pda, mint,
//!     recipient_token_account, run_id, epoch, and deployment domain tag.
//!     The handler recomputes pi_hash from authoritative state and rejects
//!     any mismatch before invoking the verifier.
//!   - Verifier embeds the voucher VK at compile time (loaded from
//!     keys/voucher_vk.bin produced by the trusted-setup ceremony).
//!   - Nullifiers are stored as PDAs; double-spend is rejected at PDA init.

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

    /// Pure ZK gate for voucher redemption. NO on-chain settlement.
    ///
    /// Verifies a Groth16 BN254 proof against the embedded voucher VK and
    /// burns a single-use nullifier PDA. Settlement (USDC movement) happens
    /// off-chain via the MagicBlock Private Payments API — a dispatcher
    /// binds (recipient, amount) to the proof's pi_hash and triggers a
    /// private transfer with visibility=private + split + randomized timing
    /// so amount and recipient are never revealed in any on-chain transfer.
    ///
    /// CU budget: ~180k.
    pub fn claim_payment(
        ctx: Context<ClaimPayment>,
        proof_bytes: Vec<u8>,
        pi_hash: [u8; 32],
        nullifier: [u8; 32],
        run_id: [u8; 16],
    ) -> Result<()> {
        instructions::claim_payment::handler(ctx, proof_bytes, pi_hash, nullifier, run_id)
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

    /// Devnet utility: close vault PDA + its token ATA so it can be
    /// reinitialized with the correct USDC mint.
    pub fn close_vault(ctx: Context<CloseVault>) -> Result<()> {
        instructions::close_vault::handler(ctx)
    }
}
