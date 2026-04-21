// circuits/commitment.circom
// Compute commitment = Poseidon(commit_hash, salt).
// PUBLIC OUTPUT:
// - commitment
// PRIVATE INPUTS:
// - commit_hash (field)  -- e.g. sha256(ciphertext) mapped to field
// - salt (field)

include "../node_modules/circomlib/circuits/poseidon.circom";

template Commitment() {
    signal input commit_hash;
    signal input salt;

    component p = Poseidon(2);
    p.inputs[0] <== commit_hash;
    p.inputs[1] <== salt;

    signal output commitment;
    commitment <== p.out;
}

component main = Commitment();
