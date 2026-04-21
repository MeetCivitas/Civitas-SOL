import os
from garaga.starknet.honk_contract_generator.generator_honk import gen_honk_verifier_files
from garaga.starknet.groth16_contract_generator.generator import write_verifier_files
from garaga.curves import ProofSystem

vk_path = "/Users/rythme/developer/blockchain/Civitas/circuits/voucher_noir/target/vk_bbjs.bin"
out_dir = "/Users/rythme/developer/blockchain/Civitas/circuits/voucher_noir"

with open(vk_path, "rb") as f:
    vk_bytes = f.read()

# Generate the raw code
constants_code, circuits_code, contract_code, contract_name, verif_fname = gen_honk_verifier_files(vk_bytes)

# Write the files manually using the library function, but we MUST mock subprocess so scarb fmt doesn't run and crash it
import subprocess
original_run = subprocess.run
def fake_run(*args, **kwargs):
    if args[0][0] == "scarb" and args[0][1] == "fmt":
        print("MOCKED: Skipping scarb fmt.")
        class FakeResult:
            def __init__(self):
                self.returncode = 0
        return FakeResult()
    return original_run(*args, **kwargs)

subprocess.run = fake_run

write_verifier_files(
    out_dir,
    "honk_verifier_v2",
    constants_code,
    contract_code,
    contract_name,
    verif_fname,
    ProofSystem.UltraKeccakZKHonk,
    False,
    circuits_code=circuits_code,
    modules=["honk_verifier", "honk_verifier_constants", "honk_verifier_circuits"],
    constants_filename="honk_verifier_constants.cairo",
    contract_filename="honk_verifier.cairo",
    circuits_filename="honk_verifier_circuits.cairo",
    include_test_sample=False,
)

print("Files successfully generated.")
