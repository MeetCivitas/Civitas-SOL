//! Civitas on-chain state account definitions (PDAs).
//!
//! All sizes are calculated with Anchor's 8-byte discriminator prefix.
//! Space budgets include a ~10% headroom buffer for future field additions.

use anchor_lang::prelude::*;

// ── Constants ────────────────────────────────────────────────────────────

/// Maximum commitments storable in a single chunk account.
/// Sized so the serialised CommitmentChunkAccount stays under 10 KB
/// (Solana's default account realloc limit per IX).
pub const MAX_COMMITMENTS_PER_CHUNK: usize = 32;

/// Maximum length of a .sol SNS domain string stored on-chain.
pub const MAX_SNS_DOMAIN_LEN: usize = 64;

/// Maximum length of an on-chain metadata CID string (IPFS/Arweave).
pub const MAX_METADATA_CID_LEN: usize = 128;

/// Maximum length of proof bytes stored in a VerificationSession.
/// UltraHonk proofs are typically ~2 KB but we reserve 8 KB.
pub const MAX_PROOF_BYTES: usize = 8192;

/// Deployment domain tag baked into proof public inputs for replay protection.
/// Must match the tag used by the Noir circuit.
#[cfg(feature = "mainnet")]
pub const DOMAIN_TAG: &[u8] = b"civitas-mainnet-v1";
#[cfg(not(feature = "mainnet"))]
pub const DOMAIN_TAG: &[u8] = b"civitas-devnet-v1";

// ── VaultState ──────────────────────────────────────────────────────────

/// Top-level employer vault: tracks the Merkle root and USDC balance.
/// Seeds: [b"vault", owner]
#[account]
#[derive(InitSpace)]
pub struct VaultState {
    /// Vault owner (employer wallet).
    pub owner: Pubkey,
    /// Latest finalized Poseidon Merkle root (BN254 field element as LE bytes).
    pub merkle_root: [u8; 32],
    /// Count of individual commitments registered across all finalized runs.
    pub commitment_count: u64,
    /// Approximate USDC balance in the confidential vault (lamports-scaled).
    /// Always zero from an on-chain observer's perspective; only the employer
    /// can decrypt the actual balance via ElGamal.
    pub usdc_balance_approx: u64,
    /// Number of completed payroll runs.
    pub run_count: u32,
    /// Optional SNS .sol domain bound to this vault.
    #[max_len(MAX_SNS_DOMAIN_LEN)]
    pub sns_domain: Option<String>,
    /// Token-2022 confidential USDC vault ATA.
    pub usdc_vault: Pubkey,
    /// Bump seed for this PDA.
    pub bump: u8,
}

// ── EmployerRecord ───────────────────────────────────────────────────────

/// Optional display metadata for an employer.
/// Seeds: [b"employer", wallet]
#[account]
#[derive(InitSpace)]
pub struct EmployerRecord {
    pub owner: Pubkey,
    #[max_len(MAX_SNS_DOMAIN_LEN)]
    pub name: String,
    #[max_len(MAX_SNS_DOMAIN_LEN)]
    pub sns_domain: String,
    pub employee_count: u32,
    pub bump: u8,
}

// ── CommitmentAccount ────────────────────────────────────────────────────

/// One registered commitment from a finalized payroll run.
/// Seeds: [b"commit", commitment_hash]
#[account]
#[derive(InitSpace)]
pub struct CommitmentAccount {
    /// The 32-byte Poseidon BN254 commitment hash.
    pub commitment: [u8; 32],
    /// Which payroll run this commitment belongs to.
    pub run_id: [u8; 16],
    /// Solana slot at registration (for reconciliation).
    pub registered_slot: u64,
    pub bump: u8,
}

// ── NullifierAccount ─────────────────────────────────────────────────────

/// Spent nullifier — existence means the voucher was already claimed.
/// Seeds: [b"nullifier", nullifier_hash]
#[account]
#[derive(InitSpace)]
pub struct NullifierAccount {
    /// The 32-byte Poseidon BN254 nullifier hash.
    pub nullifier: [u8; 32],
    /// Solana block time at settlement (unix timestamp).
    pub spent_at: i64,
    pub bump: u8,
}

// ── InvoiceAccount ───────────────────────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, InitSpace)]
pub enum InvoiceStatus {
    Pending,
    Committed,
    Settled,
}

/// Contractor invoice.
/// Seeds: [b"invoice", invoice_id]
#[account]
#[derive(InitSpace)]
pub struct InvoiceAccount {
    /// Unique invoice identifier (UUID v4 bytes).
    pub id: [u8; 16],
    /// Poseidon commitment to the invoice amount.
    pub commitment: [u8; 32],
    /// Invoice creator (contractor).
    pub creator: Pubkey,
    /// UNIX timestamp of due date.
    pub due_ts: i64,
    /// Optional IPFS/Arweave CID for invoice metadata.
    #[max_len(MAX_METADATA_CID_LEN)]
    pub metadata_cid: String,
    pub status: InvoiceStatus,
    pub bump: u8,
}

// ── PayrollRunAccount ────────────────────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, InitSpace)]
pub enum PayrollRunStatus {
    Pending,
    Committed,
    Settled,
}

/// Tracks lifecycle of one payroll batch upload.
/// Seeds: [b"run", owner, run_id]
#[account]
#[derive(InitSpace)]
pub struct PayrollRunAccount {
    pub run_id: [u8; 16],
    pub owner: Pubkey,
    pub epoch: u64,
    /// Root submitted by orchestrator — verified against chunk hashes at finalize time.
    pub pending_root: [u8; 32],
    /// Root accepted on-chain after finalization.
    pub finalized_root: [u8; 32],
    /// Expected total number of chunks.
    pub expected_chunk_count: u32,
    /// Chunks received so far.
    pub received_chunk_count: u32,
    /// Total commitments expected (for reconciliation).
    pub expected_commitment_count: u32,
    pub status: PayrollRunStatus,
    /// Solana slot when finalized.
    pub finalized_slot: u64,
    pub bump: u8,
}

// ── CommitmentChunkAccount ────────────────────────────────────────────────

/// One chunk of commitments for a payroll run.
/// Seeds: [b"chunk", run_id, chunk_index as LE bytes]
#[account]
#[derive(InitSpace)]
pub struct CommitmentChunkAccount {
    pub run_id: [u8; 16],
    pub chunk_index: u32,
    /// Encoded as Vec<[u8;32]>  — see MAX_COMMITMENTS_PER_CHUNK.
    #[max_len(MAX_COMMITMENTS_PER_CHUNK, 32)]
    pub commitments: Vec<[u8; 32]>,
    /// Keccak256 of the serialised commitments for integrity check.
    pub chunk_hash: [u8; 32],
    /// Who appended this chunk.
    pub appended_by: Pubkey,
    pub bump: u8,
}

// ── VerificationSession ───────────────────────────────────────────────────

/// Intermediate state for the split UltraHonk verifier (Tx-A → Tx-B).
/// Seeds: [b"verify", proof_hash (first 32 bytes of keccak256(proof_data))]
#[account]
#[derive(InitSpace)]
pub struct VerificationSession {
    /// Who submitted the proof (employee's wallet).
    pub submitter: Pubkey,
    /// Keccak256 of the full proof blob (used as PDA seed & integrity check).
    pub proof_hash: [u8; 32],
    /// The claimed nullifier (to be registered on successful Tx-B).
    pub nullifier: [u8; 32],
    /// The claimed commitment (must exist in vault's Merkle tree).
    pub commitment: [u8; 32],
    /// Public inputs supplied with the proof.
    pub public_inputs: VerificationPublicInputs,
    /// Serialised proof bytes stored here for Tx-B to load.
    #[max_len(MAX_PROOF_BYTES)]
    pub proof_data: Vec<u8>,
    /// Whether Tx-A constraints check passed.
    pub step1_passed: bool,
    /// Solana slot of Tx-A (for expiry checks).
    pub created_slot: u64,
    pub bump: u8,
}

/// Public inputs for UltraHonk proof verification.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct VerificationPublicInputs {
    /// Must match VaultState.merkle_root.
    pub merkle_root: [u8; 32],
    /// Amount field committed in the proof.
    pub amount: u64,
    /// Epoch committed in the proof.
    pub epoch: u64,
    /// Solana pubkey of the recipient token account (front-run protection).
    pub recipient_token_account: Pubkey,
    /// Bound to the program's own ID.
    pub program_id: Pubkey,
    /// Bound to the employer's vault PDA.
    pub vault_pda: Pubkey,
    /// Token mint (USDC Token-2022).
    pub mint: Pubkey,
    /// Run ID the voucher belongs to.
    pub run_id: [u8; 16],
    /// Deployment domain tag (devnet vs mainnet replay protection).
    #[max_len(32)]
    pub domain_tag: Vec<u8>,
}
