//! Custom error codes for the Civitas payroll program.
//!
//! Error numbers start at 6000 (Anchor reserves < 6000).

use anchor_lang::prelude::*;

#[error_code]
pub enum CivitasError {
    // ── Nullifier / Replay ───────────────────────────────────────────────
    #[msg("This nullifier has already been spent — double-spend attempt rejected")]
    NullifierAlreadySpent,

    // ── Commitment / Merkle ──────────────────────────────────────────────
    #[msg("Commitment not found in the current vault Merkle tree")]
    CommitmentNotRegistered,

    #[msg("Provided Merkle root does not match vault state")]
    MerkleRootMismatch,

    // ── Payroll Run ──────────────────────────────────────────────────────
    #[msg("Payroll run is not in Pending state")]
    RunNotPending,

    #[msg("Payroll run is already finalized")]
    RunAlreadyFinalized,

    #[msg("Chunk count mismatch: expected != supplied at finalization")]
    ChunkCountMismatch,

    #[msg("Chunk index out of range for this run")]
    ChunkIndexOutOfRange,

    #[msg("Too many commitments in a single chunk (exceeds MAX_COMMITMENTS_PER_CHUNK)")]
    ChunkTooLarge,

    #[msg("Commitments vector must not be empty")]
    EmptyChunk,

    // ── Verification Session ─────────────────────────────────────────────
    #[msg("Verification session not found or already closed")]
    SessionNotFound,

    #[msg("Verification step 1 (begin_verification) has not passed yet")]
    Step1NotComplete,

    #[msg("Verification session has expired — resubmit the proof")]
    SessionExpired,

    #[msg("Proof public inputs do not match the verification session")]
    PublicInputMismatch,

    // ── Domain / Replay Protection ───────────────────────────────────────
    #[msg("Proof domain tag does not match the deployment network")]
    DomainTagMismatch,

    #[msg("Proof is bound to a different vault PDA")]
    VaultMismatch,

    #[msg("Proof is bound to a different program ID")]
    ProgramIdMismatch,

    #[msg("Proof is bound to a different recipient token account")]
    RecipientMismatch,

    #[msg("Proof is bound to a different mint")]
    MintMismatch,

    // ── ZK / Pairing ─────────────────────────────────────────────────────
    #[msg("UltraHonk proof verification failed in step 1 (constraints check)")]
    ProofVerificationStep1Failed,

    #[msg("UltraHonk proof verification failed in step 2 (KZG pairing check)")]
    ProofVerificationStep2Failed,

    // ── Authorization ─────────────────────────────────────────────────────
    #[msg("Signer is not the vault owner")]
    NotVaultOwner,

    #[msg("Signer is not the invoice creator")]
    NotInvoiceCreator,

    // ── Invoice ──────────────────────────────────────────────────────────
    #[msg("Invoice is not in Pending state")]
    InvoiceNotPending,

    #[msg("Invoice commitment has already been settled")]
    InvoiceAlreadySettled,

    // ── Arithmetic / Overflow ─────────────────────────────────────────────
    #[msg("Arithmetic overflow in commitment count tracking")]
    CounterOverflow,
}
