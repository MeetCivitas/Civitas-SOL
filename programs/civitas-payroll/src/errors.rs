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

    #[msg("Proof public inputs do not match authoritative on-chain state")]
    PublicInputMismatch,

    // ── ZK / Pairing ─────────────────────────────────────────────────────
    #[msg("Groth16 proof bytes are malformed (must be exactly 256 bytes)")]
    ProofMalformed,

    #[msg("Embedded Groth16 verifying key is malformed")]
    VerifyingKeyMalformed,

    #[msg("Groth16 proof verification failed (pairing check rejected)")]
    ProofVerificationFailed,

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
