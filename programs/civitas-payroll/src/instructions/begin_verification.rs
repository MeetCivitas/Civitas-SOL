//! begin_verification (Tx-A) — first half of the split UltraHonk verifier.
//!
//! CU budget target: ≤ 900K CUs.
//!
//! What happens here:
//!   1. The proof bytes, nullifier, commitment, and public inputs are stored
//!      in a VerificationSession PDA, seeded with the explicit proof_hash arg.
//!   2. The handler recomputes proof_hash = keccak256(proof_data) and asserts
//!      it matches the seeded value (tamper detection).
//!   3. verifier::verify_step_1() runs constraint-system check (~800K CU max).
//!   4. Domain-binding public inputs are cross-checked against on-chain state.
//!   5. session.step1_passed = true only if step 1 passes.
//!
//! Tx-B (complete_withdrawal) loads the session PDA and runs step 2.
//! The caller computes proof_hash = keccak256(proof_data) off-chain and
//! passes it as the `proof_hash` argument for the PDA seed.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::keccak;

use crate::{
    errors::CivitasError,
    events::VerificationStarted,
    state::{VerificationPublicInputs, VerificationSession, VaultState, DOMAIN_TAG, MAX_PROOF_BYTES},
    verifier,
};

#[derive(Accounts)]
#[instruction(proof_hash: [u8; 32])]
pub struct BeginVerification<'info> {
    #[account(mut)]
    pub submitter: Signer<'info>,

    /// The employer vault whose Merkle root the proof references.
    pub vault_state: Account<'info, VaultState>,

    /// VerificationSession PDA — seeded with the caller-supplied proof_hash.
    /// The handler verifies keccak256(proof_data) == proof_hash to prevent
    /// seed manipulation with a different proof body.
    #[account(
        init,
        payer = submitter,
        space = 8 + VerificationSession::INIT_SPACE,
        seeds = [b"verify".as_ref(), proof_hash.as_ref()],
        bump,
    )]
    pub session: Account<'info, VerificationSession>,

    pub system_program: Program<'info, System>,
    pub clock: Sysvar<'info, Clock>,
}

pub fn handler(
    ctx: Context<BeginVerification>,
    proof_hash: [u8; 32],
    proof_data: Vec<u8>,
    nullifier: [u8; 32],
    commitment: [u8; 32],
    public_inputs: VerificationPublicInputs,
) -> Result<()> {
    require!(
        proof_data.len() <= MAX_PROOF_BYTES,
        CivitasError::ChunkTooLarge
    );

    // ── Verify proof_hash matches keccak256(proof_data) ──────────────────
    // This prevents a caller from seeding the PDA with hash(A) but submitting
    // proof bytes B, which would allow replaying a previous session slot.
    let computed_hash = keccak::hash(&proof_data).0;
    require!(
        computed_hash == proof_hash,
        CivitasError::PublicInputMismatch
    );

    // ── Domain-binding checks (O(1), cheap) ─────────────────────────────
    // These prevent replay across vaults, mints, programs, and networks.

    // 1. Program ID must match this running program.
    require!(
        public_inputs.program_id == crate::ID,
        CivitasError::ProgramIdMismatch
    );
    // 2. Vault PDA must match the provided vault_state account.
    require!(
        public_inputs.vault_pda == ctx.accounts.vault_state.key(),
        CivitasError::VaultMismatch
    );
    // 3. Merkle root must match the vault's current finalized root.
    require!(
        public_inputs.merkle_root == ctx.accounts.vault_state.merkle_root,
        CivitasError::MerkleRootMismatch
    );
    // 4. Deployment domain tag (devnet vs mainnet).
    require!(
        public_inputs.domain_tag.as_slice() == DOMAIN_TAG,
        CivitasError::DomainTagMismatch
    );

    // ── Step 1: UltraHonk constraint-system check ────────────────────────
    // This is the expensive part — target budget ≤ 800K CU.
    let step1_ok = verifier::verify_step_1(&proof_data, &nullifier, &commitment, &public_inputs)?;

    // ── Persist session ──────────────────────────────────────────────────
    let session = &mut ctx.accounts.session;
    session.submitter = ctx.accounts.submitter.key();
    session.proof_hash = proof_hash;
    session.nullifier = nullifier;
    session.commitment = commitment;
    session.public_inputs = public_inputs;
    session.proof_data = proof_data;
    session.step1_passed = step1_ok;
    session.created_slot = ctx.accounts.clock.slot;
    session.bump = ctx.bumps.session;

    require!(step1_ok, CivitasError::ProofVerificationStep1Failed);

    emit!(VerificationStarted {
        session_pda: ctx.accounts.session.key(),
        submitter: ctx.accounts.submitter.key(),
        proof_hash,
    });

    Ok(())
}
