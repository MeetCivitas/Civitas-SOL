// circuits/age_proof.circom
// Prove that a private age >= public min_age.
// PUBLIC INPUTS:
// - min_age (uint16)
// - employee_tag (field)
// PRIVATE INPUTS (witness):
// - age (uint16)
// - credential_nonce (field)
//
// Implementation notes:
// - We use LessThan to check if age < min_age. To assert age >= min_age we require that
//   LessThan(age, min_age).out == 0 (i.e. it's NOT the case that age < min_age).
// - We also bind credential_nonce -> employee_tag via Poseidon so the proof links to the passport.

include "../node_modules/circomlib/circuits/comparators.circom";
include "../node_modules/circomlib/circuits/poseidon.circom";

template AgeProof() {
    // public
    signal input min_age;
    signal input employee_tag;

    // private (witness)
    signal input age;
    signal input credential_nonce;

    // Use LessThan comparator: LessThan(a,b).out == 1 if a < b
    // We check LessThan(age, min_age) and require it to be 0 (i.e. age < min_age is false)
    component lt = LessThan(16);
    lt.in[0] <== age;
    lt.in[1] <== min_age;

    // Enforce age >= min_age  <=>  lt.out == 0
    lt.out === 0;

    // Bind credential_nonce -> employee_tag using Poseidon
    component p = Poseidon(1);
    p.inputs[0] <== credential_nonce;
    p.out === employee_tag;
}

component main = AgeProof();
