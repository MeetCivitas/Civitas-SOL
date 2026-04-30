//! Groth16 BN254 verifier — Solana on-chain (BPF).
//!
//! Uses Solana's `alt_bn128_*` syscalls (EIP-196/197 compatible) for all
//! curve arithmetic — no userland field/curve code, so the BPF binary stays
//! tiny and CU stays bounded:
//!
//!   addition:        ~150  CU
//!   multiplication:  ~3,840 CU
//!   pairing(4 pairs):~165k CU (base + 4 × per-pair)
//!
//! Total verify_groth16: ~175k CU — well under Solana's 1.4M per-tx ceiling.
//!
//! Encoding (matches EIP-197):
//!   G1 point: 64 bytes  =  x (32 BE) || y (32 BE)
//!   G2 point: 128 bytes =  x.c1 || x.c0 || y.c1 || y.c0   (each 32 BE)
//!   Scalar:   32 bytes  =  big-endian
//!
//! Verifier checks:
//!     e(-A, B) · e(α, β) · e(L_pub, γ) · e(C, δ)  =  1
//! where L_pub = IC[0] + pi_hash · IC[1].
//!
//! The verifying key is generated off-chain by `snarkjs zkey export
//! verificationkey`, then converted to BPF binary by `scripts/vk-to-rust.ts`
//! and embedded as `keys/voucher_vk.bin` (loaded via include_bytes!).

#![allow(unused_variables, dead_code)]

use anchor_lang::prelude::*;

use crate::errors::CivitasError;

pub mod groth16;
pub use groth16::{verify_groth16, Groth16Proof, VerifyingKey};

// ── Embedded verifying key ────────────────────────────────────────────────
//
// Layout (matches scripts/vk-to-rust.ts):
//   alpha_g1   :  64 B
//   beta_g2    : 128 B
//   gamma_g2   : 128 B
//   delta_g2   : 128 B
//   ic_len: u32 LE  (must be 2 for our circuit — 1 public input)
//   ic[0..ic_len]:  64 B each
//
// Total for our circuit: 64 + 128*3 + 4 + 64*2 = 580 bytes.
pub const VOUCHER_VK_BYTES: &[u8] = include_bytes!("../../keys/voucher_vk.bin");

// ── Top-level entry point ────────────────────────────────────────────────

/// Verify a Groth16 proof against `pi_hash` using the embedded voucher VK.
/// Returns `Ok(())` on success, `Err(ProofVerificationFailed)` on any
/// failure (malformed proof, bad pi_hash, pairing != 1).
pub fn verify_voucher_proof(proof_bytes: &[u8], pi_hash: &[u8; 32]) -> Result<()> {
    let proof = Groth16Proof::from_bytes(proof_bytes)
        .ok_or(error!(CivitasError::ProofMalformed))?;
    let vk = VerifyingKey::from_bytes(VOUCHER_VK_BYTES)
        .ok_or(error!(CivitasError::VerifyingKeyMalformed))?;

    let ok = verify_groth16(&proof, pi_hash, &vk)
        .map_err(|_| error!(CivitasError::ProofVerificationFailed))?;

    require!(ok, CivitasError::ProofVerificationFailed);
    Ok(())
}
