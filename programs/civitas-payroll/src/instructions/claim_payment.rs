//! claim_payment — single-tx voucher redemption with Groth16 verification.
//!
//! What happens here (in one Solana transaction):
//!   1. Caller passes:
//!        - 256 B Groth16 proof (A: G1, B: G2, C: G1)
//!        - 32 B  pi_hash       — Poseidon commitment to all public inputs
//!        - ClaimPublicInputs   — amount, epoch, run_id, recipient_token_account
//!   2. Handler binds the public inputs to authoritative on-chain state:
//!        - vault PDA, program_id, mint, merkle_root, domain_tag
//!      and recomputes pi_hash. Reverts if it doesn't match the supplied one.
//!   3. Verifier runs Groth16 pairing check via `alt_bn128_pairing` (~165k CU).
//!   4. NullifierAccount PDA is initialised — duplicate claims revert.
//!   5. Token-2022 USDC transferred from vault → recipient.
//!   6. PaymentClaimed event emitted (nullifier only — no amount, no identity).
//!
//! CU budget: ~250k including ATA reads and Token-2022 transfer.

use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022::Token2022,
    token_interface::{transfer_checked, Mint, TokenAccount, TransferChecked},
};
use solana_poseidon::{hashv, Endianness, Parameters};

use crate::{
    errors::CivitasError,
    events::PaymentClaimed,
    state::{
        ClaimPublicInputs, NullifierAccount, PayrollRunAccount, PayrollRunStatus, VaultState,
        DOMAIN_TAG, GROTH16_PROOF_BYTES,
    },
    verifier,
};

/// BN254 **scalar** field prime (Fr) in big-endian:
/// `21888242871839275222246405745257275088548364400416034343698204186575808495617`.
/// Poseidon operates over the scalar field — NOT the base field (Fq), whose
/// first 16 bytes coincidentally match Fr's. The `sol_poseidon` syscall
/// (Bn254X5) rejects 32-byte inputs that are >= this prime, so any
/// pubkey-shaped input (mint, vault, program id, …) must be reduced first
/// to match the JS `toFieldElement(...)` reduction.
const BN254_PRIME_BE: [u8; 32] = [
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29,
    0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
    0x28, 0x33, 0xe8, 0x48, 0x79, 0xb9, 0x70, 0x91,
    0x43, 0xe1, 0xf5, 0x93, 0xf0, 0x00, 0x00, 0x01,
];

/// Compare two big-endian 32-byte unsigned integers: `a >= b`.
fn be_geq(a: &[u8; 32], b: &[u8; 32]) -> bool {
    for i in 0..32 {
        if a[i] != b[i] {
            return a[i] > b[i];
        }
    }
    true
}

/// In-place big-endian 32-byte subtraction: `a -= b`. Caller must ensure `a >= b`.
fn be_sub(a: &mut [u8; 32], b: &[u8; 32]) {
    let mut borrow: i16 = 0;
    for i in (0..32).rev() {
        let diff = a[i] as i16 - b[i] as i16 - borrow;
        if diff < 0 {
            a[i] = (diff + 256) as u8;
            borrow = 1;
        } else {
            a[i] = diff as u8;
            borrow = 0;
        }
    }
}

/// Reduce a 32-byte big-endian integer modulo the BN254 scalar prime.
/// Input is at most 2^256-1, prime is ~2^253.79, so at most 18 subtractions —
/// constant-time and CU-cheap relative to a Poseidon round.
fn reduce_bn254(input: &[u8; 32]) -> [u8; 32] {
    let mut out = *input;
    while be_geq(&out, &BN254_PRIME_BE) {
        be_sub(&mut out, &BN254_PRIME_BE);
    }
    out
}

/// Compute pi_hash exactly the way the circom circuit does (SpongePoseidon
/// over the 10 binding fields). Uses Solana's `sol_poseidon` syscall for
/// efficiency — order and endianness MUST match voucher.circom.
///
/// Each input is reduced mod the BN254 scalar prime before being absorbed,
/// matching the JS `toFieldElement` step. Without this, pubkey-shaped inputs
/// whose top byte exceeds 0x30 trigger a syscall error from `hashv`.
fn compute_pi_hash(
    merkle_root: &[u8; 32],
    nullifier: &[u8; 32],
    recipient_token_account: &[u8; 32],
    amount: u64,
    epoch: u64,
    mint: &[u8; 32],
    vault_pda: &[u8; 32],
    program_id: &[u8; 32],
    run_id: &[u8; 16],
    domain_tag: &[u8],
) -> Result<[u8; 32]> {
    let amount_be = pad32_be_u64(amount);
    let epoch_be = pad32_be_u64(epoch);
    let mut run_id_be = [0u8; 32];
    run_id_be[16..].copy_from_slice(run_id);
    let mut dom_be = [0u8; 32];
    let dlen = domain_tag.len().min(32);
    dom_be[32 - dlen..].copy_from_slice(&domain_tag[..dlen]);

    let reduced: [[u8; 32]; 10] = [
        reduce_bn254(merkle_root),
        reduce_bn254(nullifier),
        reduce_bn254(recipient_token_account),
        amount_be,
        epoch_be,
        reduce_bn254(mint),
        reduce_bn254(vault_pda),
        reduce_bn254(program_id),
        run_id_be,
        dom_be,
    ];

    let mut state = [0u8; 32];
    for input in reduced.iter() {
        let h = hashv(Parameters::Bn254X5, Endianness::BigEndian, &[&state, input])
            .map_err(|_| error!(CivitasError::ProofMalformed))?;
        state = h.to_bytes();
    }
    Ok(state)
}

fn pad32_be_u64(x: u64) -> [u8; 32] {
    let mut out = [0u8; 32];
    out[24..].copy_from_slice(&x.to_be_bytes());
    out
}

#[derive(Accounts)]
#[instruction(_proof_bytes: Vec<u8>, _pi_hash: [u8; 32], public_inputs: ClaimPublicInputs, nullifier: [u8; 32])]
pub struct ClaimPayment<'info> {
    #[account(mut)]
    pub submitter: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault".as_ref(), vault_state.owner.as_ref()],
        bump = vault_state.bump,
    )]
    pub vault_state: Account<'info, VaultState>,

    /// The specific payroll run this voucher belongs to. The proof binds
    /// to `payroll_run.finalized_root`, NOT `vault.merkle_root` — so claims
    /// remain valid for any historically committed run, not just the latest.
    #[account(
        seeds = [b"run".as_ref(), vault_state.owner.as_ref(), public_inputs.run_id.as_ref()],
        bump = payroll_run.bump,
        constraint = payroll_run.status == PayrollRunStatus::Committed @ CivitasError::RunNotPending,
    )]
    pub payroll_run: Account<'info, PayrollRunAccount>,

    /// `init` will revert if the PDA already exists — this is the
    /// anti-double-spend gate. Seed is the nullifier.
    #[account(
        init,
        payer = submitter,
        space = 8 + NullifierAccount::INIT_SPACE,
        seeds = [b"nullifier".as_ref(), nullifier.as_ref()],
        bump,
    )]
    pub nullifier_account: Account<'info, NullifierAccount>,

    pub usdc_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        address = vault_state.usdc_vault,
    )]
    pub vault_usdc: InterfaceAccount<'info, TokenAccount>,

    #[account(mut)]
    pub recipient_usdc: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
    pub clock: Sysvar<'info, Clock>,
}

pub fn handler(
    ctx: Context<ClaimPayment>,
    proof_bytes: Vec<u8>,
    pi_hash: [u8; 32],
    public_inputs: ClaimPublicInputs,
    nullifier: [u8; 32],
) -> Result<()> {
    // ── Size check ────────────────────────────────────────────────────────
    require!(
        proof_bytes.len() == GROTH16_PROOF_BYTES,
        CivitasError::ProofMalformed
    );

    // ── Bind public inputs to authoritative on-chain state ───────────────
    // The proof committed to specific values via pi_hash. We recompute
    // pi_hash from on-chain state + supplied public inputs and check equality.
    // If anything was forged or tampered, hash mismatch → revert.

    let vault = &ctx.accounts.vault_state;
    let recipient = &ctx.accounts.recipient_usdc;

    // Recipient ATA on the IX must match what the proof commits to.
    require!(
        recipient.key() == public_inputs.recipient_token_account,
        CivitasError::RecipientMismatch
    );
    require!(
        recipient.mint == ctx.accounts.usdc_mint.key(),
        CivitasError::MintMismatch
    );

    // Recompute pi_hash via SpongePoseidon over the 10 binding fields and
    // assert it matches the supplied pi_hash. Crucially, we use the
    // PER-RUN finalized root (not the vault's latest root) so vouchers
    // from any historically committed run remain claimable.
    let run_root = ctx.accounts.payroll_run.finalized_root;
    let computed = compute_pi_hash(
        &run_root,
        &nullifier,
        &public_inputs.recipient_token_account.to_bytes(),
        public_inputs.amount,
        public_inputs.epoch,
        &ctx.accounts.usdc_mint.key().to_bytes(),
        &vault.key().to_bytes(),
        &crate::ID.to_bytes(),
        &public_inputs.run_id,
        DOMAIN_TAG,
    )?;
    require!(computed == pi_hash, CivitasError::PublicInputMismatch);

    // ── Cryptographic proof check ────────────────────────────────────────
    verifier::verify_voucher_proof(&proof_bytes, &pi_hash)?;

    // ── Register nullifier (init constraint already prevents reuse) ───────
    let null_acc = &mut ctx.accounts.nullifier_account;
    null_acc.nullifier = nullifier;
    null_acc.spent_at = ctx.accounts.clock.unix_timestamp;
    null_acc.bump = ctx.bumps.nullifier_account;

    // ── Transfer USDC out of vault ───────────────────────────────────────
    let amount = public_inputs.amount;
    let decimals = ctx.accounts.usdc_mint.decimals;

    let vault_owner = vault.owner;
    let vault_bump = vault.bump;
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

    // Approximate balance bookkeeping (visible on-chain; exact balance is
    // hidden by Token-2022 confidential extension when enabled).
    let vault_state = &mut ctx.accounts.vault_state;
    vault_state.usdc_balance_approx = vault_state.usdc_balance_approx.saturating_sub(amount);

    emit!(PaymentClaimed {
        nullifier,
        vault_pda: vault_state.key(),
        slot: ctx.accounts.clock.slot,
    });

    Ok(())
}
