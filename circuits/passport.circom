// circuits/passport.circom
// Prove that Poseidon(credential_nonce) == employee_tag (public).
// PUBLIC INPUTS:
// - employee_tag (field)
// PRIVATE INPUTS (witness):
// - credential_nonce (field)

include "../node_modules/circomlib/circuits/poseidon.circom";

template Passport() {
    // public
    signal input employee_tag;

    // private (witness)
    signal input credential_nonce;

    component p = Poseidon(1);
    p.inputs[0] <== credential_nonce;

    signal computed_tag;
    computed_tag <== p.out;

    computed_tag === employee_tag;
}

component main = Passport();
