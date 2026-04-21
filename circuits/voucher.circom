pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";

// ─────────────────────────────────────────────────────────────────────────
// VoucherRedemption: Proves knowledge of a valid payroll voucher
// for private withdrawal from the Civitas escrow contract.
//
// Privacy guarantees:
//   - credential_nonce stays private (never revealed on-chain)
//   - salary amount is public only during withdrawal (not linked to identity)
//   - employee_tag is a one-way hash (cannot reverse to get nonce)
//
// PUBLIC SIGNALS (revealed on-chain):
//   - nullifier: prevents double-spend
//   - merkle_root: the commitment tree root
//   - commitment: the voucher commitment hash
//   - amount: withdrawal amount
//   - recipient_hash: hash of recipient address (binds proof to recipient)
//
// PRIVATE SIGNALS (witness only):
//   - credential_nonce: the employee's secret
//   - epoch: payroll epoch
//   - voucher_nonce: unique per-voucher randomness
//   - merkle_path[DEPTH]: sibling hashes along the path
//   - merkle_indices[DEPTH]: left/right indicators
// ─────────────────────────────────────────────────────────────────────────

template MerkleProof(depth) {
    signal input leaf;
    signal input path[depth];
    signal input indices[depth];
    signal output root;

    signal hashes[depth + 1];
    hashes[0] <== leaf;

    // Declare signal arrays at template scope (required by circom 2.2.x)
    signal left[depth];
    signal right[depth];
    component hashers[depth];

    for (var i = 0; i < depth; i++) {
        hashers[i] = Poseidon(2);

        // If index == 0: hash(current, sibling)
        // If index == 1: hash(sibling, current)
        // We use: left = current * (1 - index) + sibling * index
        //         right = sibling * (1 - index) + current * index

        // Ensure index is binary
        indices[i] * (1 - indices[i]) === 0;

        left[i] <== hashes[i] + indices[i] * (path[i] - hashes[i]);
        right[i] <== path[i] + indices[i] * (hashes[i] - path[i]);

        hashers[i].inputs[0] <== left[i];
        hashers[i].inputs[1] <== right[i];
        hashes[i + 1] <== hashers[i].out;
    }

    root <== hashes[depth];
}

template VoucherRedemption(depth) {
    // ── Public Signals ──────────────────────────────────────────────
    signal input nullifier;           // Poseidon(credential_nonce, epoch, voucher_nonce)
    signal input merkle_root;         // Current Merkle root of commitment tree
    signal input commitment;          // Poseidon(employee_tag, amount, epoch, voucher_nonce)
    signal input amount;              // Withdrawal amount
    signal input recipient_hash;      // Hash of recipient address (prevents front-running)

    // ── Private Signals (Witness) ───────────────────────────────────
    signal input credential_nonce;    // The employee's master secret
    signal input epoch;               // Payroll epoch
    signal input voucher_nonce;       // Unique per-voucher randomness
    signal input merkle_path[depth];  // Merkle proof siblings
    signal input merkle_indices[depth]; // Merkle proof position indicators

    // ── Step 1: Derive employee_tag = Poseidon(credential_nonce) ────
    component tagHasher = Poseidon(1);
    tagHasher.inputs[0] <== credential_nonce;
    signal employee_tag;
    employee_tag <== tagHasher.out;

    // ── Step 2: Verify commitment = Poseidon(employee_tag, amount, epoch, voucher_nonce)
    component commitHasher = Poseidon(4);
    commitHasher.inputs[0] <== employee_tag;
    commitHasher.inputs[1] <== amount;
    commitHasher.inputs[2] <== epoch;
    commitHasher.inputs[3] <== voucher_nonce;
    commitHasher.out === commitment;

    // ── Step 3: Verify nullifier = Poseidon(credential_nonce, epoch, voucher_nonce)
    component nullHasher = Poseidon(3);
    nullHasher.inputs[0] <== credential_nonce;
    nullHasher.inputs[1] <== epoch;
    nullHasher.inputs[2] <== voucher_nonce;
    nullHasher.out === nullifier;

    // ── Step 4: Verify Merkle proof ─────────────────────────────────
    component merkleProof = MerkleProof(depth);
    merkleProof.leaf <== commitment;
    for (var i = 0; i < depth; i++) {
        merkleProof.path[i] <== merkle_path[i];
        merkleProof.indices[i] <== merkle_indices[i];
    }
    merkleProof.root === merkle_root;

    // ── Step 5: Bind proof to recipient (prevents front-running) ────
    // This is a no-op constraint that ensures recipient_hash is included
    // in the proof's public signals without computation.
    signal recipient_sq;
    recipient_sq <== recipient_hash * recipient_hash;
}

// Depth 20 supports 2^20 = 1,048,576 leaves
component main {public [nullifier, merkle_root, commitment, amount, recipient_hash]} = VoucherRedemption(20);
