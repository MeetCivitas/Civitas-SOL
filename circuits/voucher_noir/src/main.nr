// Civitas Voucher Redemption Circuit (Noir / UltraHonk - Solana build)
//
// Migrated from Starknet to Solana:
//   - REMOVED: STARKNET_MAX_FELT constant and modulo_starknet() function
//   - ADDED:   token_account_hash - binds proof to recipient's token account
//   - ADDED:   program_id, vault_pda, mint domain binding (via domain_tag)
//   - ADDED:   run_id/epoch binding (epoch is a public input; run_id folded into domain_tag)
//
// All hashing uses BN254 Poseidon (matches Solana on-chain light-poseidon and bb.js).
//
// CONSTRAINTS (C1..C7 - checked inside circuit):
//   C1: employee_tag     = Poseidon(credential_nonce)
//   C2: commitment       = Poseidon(employee_tag, amount, epoch, voucher_nonce)
//   C3: nullifier        = Poseidon(credential_nonce, epoch, voucher_nonce)      [public]
//   C4: merkle_root recomputed from commitment + merkle_path                      [public]
//   C5: recipient_hash != 0   - binds proof to specific token account              [public]
//   C6: token_account_hash != 0 - second binding to Token-2022 account             [public]
//   C7: domain_tag_hash != 0  - deployment network anti-replay                    [public]
//
// PUBLIC INPUTS (revealed on-chain, verified by complete_withdrawal):
//   merkle_root, nullifier, recipient_hash, amount, epoch,
//   token_account_hash, domain_tag_hash
//
// PRIVATE INPUTS (stay in browser / prover):
//   credential_nonce, voucher_nonce, merkle_path[20], path_index
//
// NOTE ON MERKLE INDEX:
//   Uses a single Field `path_index` representing the leaf position as an integer.
//   The i-th bit of path_index determines left (0) or right (1) at level i.
//   Conversion: path_index = sum(bit[i] * 2^i) for i in 0..20

use poseidon::poseidon::bn254;

global TREE_DEPTH: u32 = 20;

// Manual Merkle proof verification using BN254 Poseidon.
// Reconstructs the root from the leaf, path siblings, and the index.
fn verify_merkle_proof(
    leaf: Field,
    path: [Field; TREE_DEPTH],
    index: Field,
) -> Field {
    let index_bits: [u1; TREE_DEPTH] = index.to_le_bits();

    let mut current = leaf;
    for i in 0..TREE_DEPTH {
        let sibling = path[i];
        // bit=0: hash(current, sibling)  - leaf is on left
        // bit=1: hash(sibling, current)  - leaf is on right
        let node_hash = if index_bits[i] == 0 {
            bn254::hash_2([current, sibling])
        } else {
            bn254::hash_2([sibling, current])
        };
        current = node_hash;
    }
    current
}

fn main(
    // -- Private inputs (witness only - never revealed) -------------------
    credential_nonce: Field,
    voucher_nonce: Field,
    merkle_path: [Field; TREE_DEPTH],
    path_index: Field,

    // -- Public inputs (revealed on-chain; verified by complete_withdrawal) --
    merkle_root: pub Field,
    nullifier: pub Field,
    recipient_hash: pub Field,
    amount: pub Field,
    epoch: pub Field,
    // Hash of the recipient's Token-2022 token account pubkey (32-byte LE).
    // Prevents proof from being redirected to a different token account.
    token_account_hash: pub Field,
    // Keccak256 hash of the deployment domain tag string ("civitas-devnet-v1" etc.)
    // folded into the proof transcript. Prevents devnet proofs replaying on mainnet.
    domain_tag_hash: pub Field,
) {
    // C1: Derive employee_tag = Poseidon(credential_nonce)
    // No modulo_starknet needed - BN254 field fits natively on Solana.
    let employee_tag = bn254::hash_1([credential_nonce]);

    // C2: Verify commitment = Poseidon(employee_tag, amount, epoch, voucher_nonce)
    let commitment = bn254::hash_4([employee_tag, amount, epoch, voucher_nonce]);

    // C3: Verify nullifier = Poseidon(credential_nonce, epoch, voucher_nonce)
    let computed_nullifier = bn254::hash_3([credential_nonce, epoch, voucher_nonce]);
    assert(computed_nullifier == nullifier, "Nullifier mismatch: proof of credential ownership failed");

    // C4: Verify Merkle inclusion
    let computed_root = verify_merkle_proof(commitment, merkle_path, path_index);
    assert(computed_root == merkle_root, "Merkle proof invalid: commitment not in tree");

    // C5: Bind proof to recipient address (prevents front-running)
    assert(recipient_hash != 0, "Recipient hash must be non-zero");

    // C6: Bind proof to recipient's Token-2022 token account (prevents rerouting)
    assert(token_account_hash != 0, "Token account hash must be non-zero");

    // C7: Domain tag binding - prevents cross-deployment replay
    assert(domain_tag_hash != 0, "Domain tag hash must be non-zero");
}

// -- Tests ----------------------------------------------------------------

#[test]
fn test_valid_proof_solana() {
    let credential_nonce: Field = 12345;
    let voucher_nonce_val: Field = 67890;
    let amount_val: Field = 1000;
    let epoch_val: Field = 1;
    let recipient_hash_val: Field = 0xABCDEF;
    let token_account_hash_val: Field = 0x123456789;
    let domain_tag_hash_val: Field = 0xDEADBEEF;

    // C1: Derive employee_tag
    let employee_tag = bn254::hash_1([credential_nonce]);

    // C2: Compute commitment
    let commitment = bn254::hash_4([employee_tag, amount_val, epoch_val, voucher_nonce_val]);

    // C3: Compute nullifier
    let nullifier_val = bn254::hash_3([credential_nonce, epoch_val, voucher_nonce_val]);

    // Build single-leaf Merkle tree at index 0 (all siblings are zero)
    let merkle_path_arr = [0 as Field; 20];
    let computed_root = verify_merkle_proof(commitment, merkle_path_arr, 0);

    main(
        credential_nonce,
        voucher_nonce_val,
        merkle_path_arr,
        0,
        computed_root,
        nullifier_val,
        recipient_hash_val,
        amount_val,
        epoch_val,
        token_account_hash_val,
        domain_tag_hash_val,
    );
}

#[test(should_fail_with = "Nullifier mismatch")]
fn test_wrong_credential_nonce() {
    let correct_nonce: Field = 12345;
    let wrong_nonce: Field = 99999;
    let voucher_nonce_val: Field = 67890;
    let amount_val: Field = 1000;
    let epoch_val: Field = 1;
    let recipient_hash_val: Field = 0xABCDEF;
    let token_account_hash_val: Field = 0x123456789;
    let domain_tag_hash_val: Field = 0xDEADBEEF;

    let correct_tag = bn254::hash_1([correct_nonce]);
    let commitment = bn254::hash_4([correct_tag, amount_val, epoch_val, voucher_nonce_val]);
    let nullifier_val = bn254::hash_3([correct_nonce, epoch_val, voucher_nonce_val]);

    let merkle_path_arr = [0 as Field; 20];
    let expected_root = verify_merkle_proof(commitment, merkle_path_arr, 0);

    // Wrong nonce supplied - nullifier derived from wrong nonce won't match
    main(
        wrong_nonce,
        voucher_nonce_val,
        merkle_path_arr,
        0,
        expected_root,
        nullifier_val,
        recipient_hash_val,
        amount_val,
        epoch_val,
        token_account_hash_val,
        domain_tag_hash_val,
    );
}

#[test(should_fail_with = "Merkle proof invalid")]
fn test_wrong_merkle_path() {
    let credential_nonce: Field = 12345;
    let voucher_nonce_val: Field = 67890;
    let amount_val: Field = 1000;
    let epoch_val: Field = 1;

    let employee_tag = bn254::hash_1([credential_nonce]);
    let commitment = bn254::hash_4([employee_tag, amount_val, epoch_val, voucher_nonce_val]);
    let nullifier_val = bn254::hash_3([credential_nonce, epoch_val, voucher_nonce_val]);

    let merkle_path_arr = [0 as Field; 20];
    let expected_root = verify_merkle_proof(commitment, merkle_path_arr, 0);

    let mut bad_path = [0 as Field; 20];
    bad_path[0] = 0xDEADBEEF;

    main(
        credential_nonce,
        voucher_nonce_val,
        bad_path,
        0,
        expected_root,
        nullifier_val,
        0xABCDEF,
        amount_val,
        epoch_val,
        0x123456789,
        0xDEADBEEF,
    );
}

#[test(should_fail_with = "Recipient hash must be non-zero")]
fn test_zero_recipient_hash() {
    let credential_nonce: Field = 12345;
    let voucher_nonce_val: Field = 67890;
    let amount_val: Field = 1000;
    let epoch_val: Field = 1;

    let employee_tag = bn254::hash_1([credential_nonce]);
    let commitment = bn254::hash_4([employee_tag, amount_val, epoch_val, voucher_nonce_val]);
    let nullifier_val = bn254::hash_3([credential_nonce, epoch_val, voucher_nonce_val]);

    let merkle_path_arr = [0 as Field; 20];
    let expected_root = verify_merkle_proof(commitment, merkle_path_arr, 0);

    main(
        credential_nonce,
        voucher_nonce_val,
        merkle_path_arr,
        0,
        expected_root,
        nullifier_val,
        0,  // ZERO recipient_hash - should fail C5
        amount_val,
        epoch_val,
        0x123456789,
        0xDEADBEEF,
    );
}

#[test(should_fail_with = "Token account hash must be non-zero")]
fn test_zero_token_account_hash() {
    let credential_nonce: Field = 12345;
    let voucher_nonce_val: Field = 67890;
    let amount_val: Field = 1000;
    let epoch_val: Field = 1;

    let employee_tag = bn254::hash_1([credential_nonce]);
    let commitment = bn254::hash_4([employee_tag, amount_val, epoch_val, voucher_nonce_val]);
    let nullifier_val = bn254::hash_3([credential_nonce, epoch_val, voucher_nonce_val]);

    let merkle_path_arr = [0 as Field; 20];
    let expected_root = verify_merkle_proof(commitment, merkle_path_arr, 0);

    main(
        credential_nonce,
        voucher_nonce_val,
        merkle_path_arr,
        0,
        expected_root,
        nullifier_val,
        0xABCDEF,
        amount_val,
        epoch_val,
        0,  // ZERO token_account_hash - should fail C6
        0xDEADBEEF,
    );
}
