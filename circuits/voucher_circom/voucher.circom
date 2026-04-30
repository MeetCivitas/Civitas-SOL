// Civitas Voucher Redemption Circuit (circom 2 / Groth16 / BN254)
//
// Migrated from Noir UltraHonk for on-chain feasibility:
//   UltraHonk proofs are ~2-4 KB and don't fit in a Solana tx (1232 B max),
//   plus the BPF verifier is ~3000 lines unported. Groth16 proofs are 256 B
//   and the verifier is ~150 lines using `alt_bn128_pairing`.
//
// Constraints (mirror the Noir circuit C1-C4 + on-chain pi_hash binding):
//   C1: employee_tag  = Poseidon(credential_nonce)
//   C2: commitment    = Poseidon(employee_tag, amount, epoch, voucher_nonce)
//   C3: Poseidon(credential_nonce, epoch, voucher_nonce) == nullifier
//   C4: MerkleProof(commitment, merkle_path, path_index) == merkle_root
//   C5: Sponge-Poseidon over the 10 binding fields == pi_hash
//
// The on-chain handler (claim_payment.rs) recomputes pi_hash from
// authoritative state using light-poseidon over the SAME 10 fields in the
// SAME order, then asserts equality before verifying the Groth16 pairing —
// so any forged or rerouted proof is rejected.
//
// Public input: pi_hash (single Field — exposes nothing about the witness).
// All other signals are private and belong to the prover's witness.

pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/mux1.circom";

// MerkleProofVerify: reconstructs the root from a leaf, sibling path, and
// a per-level (left/right) selector bit. depth = tree depth.
template MerkleProofVerify(depth) {
    signal input leaf;
    signal input siblings[depth];
    signal input pathBits[depth];   // 0 = leaf is left, 1 = leaf is right
    signal output root;

    signal current[depth + 1];
    current[0] <== leaf;

    component hashers[depth];
    component muxL[depth];
    component muxR[depth];

    for (var i = 0; i < depth; i++) {
        // (left, right) = pathBits[i]==0 ? (current, sibling) : (sibling, current)
        muxL[i] = Mux1();
        muxR[i] = Mux1();
        muxL[i].c[0] <== current[i];
        muxL[i].c[1] <== siblings[i];
        muxL[i].s   <== pathBits[i];
        muxR[i].c[0] <== siblings[i];
        muxR[i].c[1] <== current[i];
        muxR[i].s   <== pathBits[i];

        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== muxL[i].out;
        hashers[i].inputs[1] <== muxR[i].out;

        current[i + 1] <== hashers[i].out;
    }

    root <== current[depth];
}

// SpongePoseidon: chained Poseidon(2) absorbing N inputs.
// state_0 = 0; state_{i+1} = Poseidon(state_i, x_i); out = state_n.
// Mirrored on-chain by light_poseidon::Poseidon::<Fr>::new_circom(2)
// applied iteratively over the same field sequence.
template SpongePoseidon(n) {
    signal input inputs[n];
    signal output out;

    component h[n];
    signal state[n + 1];
    state[0] <== 0;

    for (var i = 0; i < n; i++) {
        h[i] = Poseidon(2);
        h[i].inputs[0] <== state[i];
        h[i].inputs[1] <== inputs[i];
        state[i + 1] <== h[i].out;
    }

    out <== state[n];
}

template Voucher(depth) {
    // ── Private witness (employee credential, voucher fields, merkle path)
    signal input credential_nonce;
    signal input voucher_nonce;
    signal input merkle_path[depth];
    signal input path_index;        // integer in [0, 2^depth)

    // ── Binding fields ───────────────────────────────────────────────────
    // Supplied by the prover and folded into pi_hash. The on-chain handler
    // recomputes pi_hash from authoritative state, so any of these values
    // that does not match what's on-chain causes the claim to revert.
    signal input merkle_root;
    signal input nullifier;
    signal input recipient_token_account;
    signal input amount;
    signal input epoch;
    signal input mint;
    signal input vault_pda;
    signal input program_id;
    signal input run_id;
    signal input domain_tag;

    // ── Public input — single Field that commits to all of the above ────
    signal input pi_hash;

    // ── C1: employee_tag = Poseidon(credential_nonce) ────────────────────
    component h1 = Poseidon(1);
    h1.inputs[0] <== credential_nonce;
    signal employee_tag;
    employee_tag <== h1.out;

    // ── C2: commitment = Poseidon(employee_tag, amount, epoch, voucher_nonce)
    component h2 = Poseidon(4);
    h2.inputs[0] <== employee_tag;
    h2.inputs[1] <== amount;
    h2.inputs[2] <== epoch;
    h2.inputs[3] <== voucher_nonce;
    signal commitment;
    commitment <== h2.out;

    // ── C3: Poseidon(credential_nonce, epoch, voucher_nonce) == nullifier
    component h3 = Poseidon(3);
    h3.inputs[0] <== credential_nonce;
    h3.inputs[1] <== epoch;
    h3.inputs[2] <== voucher_nonce;
    h3.out === nullifier;

    // ── C4: merkle inclusion proof ───────────────────────────────────────
    component idx2bits = Num2Bits(depth);
    idx2bits.in <== path_index;

    component mp = MerkleProofVerify(depth);
    mp.leaf <== commitment;
    for (var i = 0; i < depth; i++) {
        mp.siblings[i] <== merkle_path[i];
        mp.pathBits[i] <== idx2bits.out[i];
    }
    mp.root === merkle_root;

    // ── C5: pi_hash binding ──────────────────────────────────────────────
    // Order MUST match claim_payment.rs::handler.
    component sponge = SpongePoseidon(10);
    sponge.inputs[0] <== merkle_root;
    sponge.inputs[1] <== nullifier;
    sponge.inputs[2] <== recipient_token_account;
    sponge.inputs[3] <== amount;
    sponge.inputs[4] <== epoch;
    sponge.inputs[5] <== mint;
    sponge.inputs[6] <== vault_pda;
    sponge.inputs[7] <== program_id;
    sponge.inputs[8] <== run_id;
    sponge.inputs[9] <== domain_tag;
    sponge.out === pi_hash;
}

component main { public [pi_hash] } = Voucher(20);
