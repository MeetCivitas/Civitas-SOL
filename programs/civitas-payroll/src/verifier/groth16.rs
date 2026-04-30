//! Groth16 BN254 pairing verifier — implementation.

use solana_bn254::prelude::{
    alt_bn128_addition, alt_bn128_multiplication, alt_bn128_pairing,
    AltBn128Error, ALT_BN128_ADDITION_OUTPUT_LEN, ALT_BN128_MULTIPLICATION_OUTPUT_LEN,
    ALT_BN128_PAIRING_ELEMENT_LEN, ALT_BN128_PAIRING_OUTPUT_LEN,
};

const G1_LEN: usize = 64;
const G2_LEN: usize = 128;
const SCALAR_LEN: usize = 32;

/// BN254 base-field prime `q` (big-endian).
/// Used to negate G1.y for the pairing equation `e(-A, B) · ... = 1`.
const BN254_Q_BE: [u8; 32] = [
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
    0x97, 0x81, 0x6a, 0x91, 0x68, 0x71, 0xca, 0x8d, 0x3c, 0x20, 0x8c, 0x16, 0xd8, 0x7c, 0xfd, 0x47,
];

// ── Public types ──────────────────────────────────────────────────────────

/// Groth16 proof — exactly 256 bytes on the wire.
#[derive(Clone, Copy)]
pub struct Groth16Proof {
    /// G1 point — 64 bytes.
    pub a: [u8; G1_LEN],
    /// G2 point — 128 bytes.
    pub b: [u8; G2_LEN],
    /// G1 point — 64 bytes.
    pub c: [u8; G1_LEN],
}

impl Groth16Proof {
    pub fn from_bytes(bytes: &[u8]) -> Option<Self> {
        if bytes.len() != G1_LEN + G2_LEN + G1_LEN {
            return None;
        }
        let mut a = [0u8; G1_LEN];
        let mut b = [0u8; G2_LEN];
        let mut c = [0u8; G1_LEN];
        a.copy_from_slice(&bytes[0..G1_LEN]);
        b.copy_from_slice(&bytes[G1_LEN..G1_LEN + G2_LEN]);
        c.copy_from_slice(&bytes[G1_LEN + G2_LEN..]);
        Some(Self { a, b, c })
    }
}

/// Groth16 verifying key. Currently fixed to one public input (`pi_hash`),
/// so `ic` always has length 2 (`ic[0]` + `ic[1] · pi_hash`).
#[derive(Clone)]
pub struct VerifyingKey {
    pub alpha_g1: [u8; G1_LEN],
    pub beta_g2: [u8; G2_LEN],
    pub gamma_g2: [u8; G2_LEN],
    pub delta_g2: [u8; G2_LEN],
    /// IC[0], IC[1]. Each 64 bytes.
    pub ic: [[u8; G1_LEN]; 2],
}

impl VerifyingKey {
    /// Layout (LE prefix lengths, BE point coordinates):
    ///   alpha_g1 (64) || beta_g2 (128) || gamma_g2 (128) || delta_g2 (128)
    ///   || ic_len: u32 LE (must be 2)
    ///   || ic[0] (64) || ic[1] (64)
    pub fn from_bytes(bytes: &[u8]) -> Option<Self> {
        let needed = G1_LEN + G2_LEN * 3 + 4 + G1_LEN * 2;
        if bytes.len() < needed {
            return None;
        }

        let mut off = 0;
        let mut alpha_g1 = [0u8; G1_LEN];
        alpha_g1.copy_from_slice(&bytes[off..off + G1_LEN]);
        off += G1_LEN;

        let mut beta_g2 = [0u8; G2_LEN];
        beta_g2.copy_from_slice(&bytes[off..off + G2_LEN]);
        off += G2_LEN;

        let mut gamma_g2 = [0u8; G2_LEN];
        gamma_g2.copy_from_slice(&bytes[off..off + G2_LEN]);
        off += G2_LEN;

        let mut delta_g2 = [0u8; G2_LEN];
        delta_g2.copy_from_slice(&bytes[off..off + G2_LEN]);
        off += G2_LEN;

        let ic_len = u32::from_le_bytes([
            bytes[off], bytes[off + 1], bytes[off + 2], bytes[off + 3],
        ]) as usize;
        off += 4;
        if ic_len != 2 {
            return None;
        }

        let mut ic0 = [0u8; G1_LEN];
        let mut ic1 = [0u8; G1_LEN];
        ic0.copy_from_slice(&bytes[off..off + G1_LEN]);
        off += G1_LEN;
        ic1.copy_from_slice(&bytes[off..off + G1_LEN]);

        Some(Self { alpha_g1, beta_g2, gamma_g2, delta_g2, ic: [ic0, ic1] })
    }
}

// ── Verifier ──────────────────────────────────────────────────────────────

/// Run the Groth16 pairing check.
///
///   L_pub = IC[0] + pi_hash · IC[1]
///   accept iff   e(-A, B) · e(α, β) · e(L_pub, γ) · e(C, δ)  = 1
///
/// Returns `Ok(true)` if the proof is valid, `Ok(false)` if the pairing
/// rejects, `Err` if a syscall fails (e.g. malformed point that's off-curve).
pub fn verify_groth16(
    proof: &Groth16Proof,
    pi_hash: &[u8; SCALAR_LEN],
    vk: &VerifyingKey,
) -> Result<bool, AltBn128Error> {
    // L_pub = IC[0] + pi_hash · IC[1]
    let l_pub = compute_l_pub(&vk.ic[0], &vk.ic[1], pi_hash)?;

    // -A = (A.x, q - A.y)
    let neg_a = negate_g1(&proof.a);

    // 4 pairs, each 192 B  (G1 64 || G2 128)
    let mut input = [0u8; 4 * (G1_LEN + G2_LEN)];
    let mut off = 0;

    // (−A, B)
    input[off..off + G1_LEN].copy_from_slice(&neg_a);
    off += G1_LEN;
    input[off..off + G2_LEN].copy_from_slice(&proof.b);
    off += G2_LEN;

    // (α, β)
    input[off..off + G1_LEN].copy_from_slice(&vk.alpha_g1);
    off += G1_LEN;
    input[off..off + G2_LEN].copy_from_slice(&vk.beta_g2);
    off += G2_LEN;

    // (L_pub, γ)
    input[off..off + G1_LEN].copy_from_slice(&l_pub);
    off += G1_LEN;
    input[off..off + G2_LEN].copy_from_slice(&vk.gamma_g2);
    off += G2_LEN;

    // (C, δ)
    input[off..off + G1_LEN].copy_from_slice(&proof.c);
    off += G1_LEN;
    input[off..off + G2_LEN].copy_from_slice(&vk.delta_g2);

    let _ = ALT_BN128_PAIRING_ELEMENT_LEN; // silence unused if linker prunes

    let result = alt_bn128_pairing(&input)?;
    if result.len() != ALT_BN128_PAIRING_OUTPUT_LEN {
        return Ok(false);
    }
    // Last byte is 1 iff product of pairings equals identity in GT.
    Ok(result[ALT_BN128_PAIRING_OUTPUT_LEN - 1] == 1)
}

// ── Internals ─────────────────────────────────────────────────────────────

fn compute_l_pub(
    ic0: &[u8; G1_LEN],
    ic1: &[u8; G1_LEN],
    scalar: &[u8; SCALAR_LEN],
) -> Result<[u8; G1_LEN], AltBn128Error> {
    // mul_input = ic1 || scalar  (64 + 32 = 96 bytes)
    let mut mul_input = [0u8; G1_LEN + SCALAR_LEN];
    mul_input[..G1_LEN].copy_from_slice(ic1);
    mul_input[G1_LEN..].copy_from_slice(scalar);
    let mul_out = alt_bn128_multiplication(&mul_input)?;
    if mul_out.len() != ALT_BN128_MULTIPLICATION_OUTPUT_LEN {
        return Err(AltBn128Error::InvalidInputData);
    }

    // add_input = ic0 || (scalar · ic1)
    let mut add_input = [0u8; G1_LEN * 2];
    add_input[..G1_LEN].copy_from_slice(ic0);
    add_input[G1_LEN..].copy_from_slice(&mul_out);
    let add_out = alt_bn128_addition(&add_input)?;
    if add_out.len() != ALT_BN128_ADDITION_OUTPUT_LEN {
        return Err(AltBn128Error::InvalidInputData);
    }

    let mut out = [0u8; G1_LEN];
    out.copy_from_slice(&add_out);
    Ok(out)
}

/// Negate a G1 point: (x, y) → (x, q - y).
/// Operating on big-endian 32-byte field elements (EIP-196 encoding).
fn negate_g1(point: &[u8; G1_LEN]) -> [u8; G1_LEN] {
    let mut out = [0u8; G1_LEN];
    out[..32].copy_from_slice(&point[..32]);

    let y_be = &point[32..64];

    // Special case: y == 0 — the point is the identity, leave it alone.
    if y_be.iter().all(|b| *b == 0) {
        return out;
    }

    // out_y = q - y  (big-endian subtraction)
    let mut borrow: i32 = 0;
    for i in (0..32).rev() {
        let diff = BN254_Q_BE[i] as i32 - y_be[i] as i32 - borrow;
        if diff < 0 {
            out[32 + i] = (diff + 256) as u8;
            borrow = 1;
        } else {
            out[32 + i] = diff as u8;
            borrow = 0;
        }
    }
    out
}
