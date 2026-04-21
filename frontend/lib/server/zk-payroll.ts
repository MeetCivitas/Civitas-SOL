import fs from "fs";
import path from "path";

const snarkjs = require("snarkjs");

/**
 * Verify a Groth16 proof server-side using the voucher circuit verification key.
 */
export async function verifyPayrollProof(
  vKey: any,
  publicSignals: any[],
  proof: any
): Promise<boolean> {
  try {
    console.log("[ZK Verify] Verifying Groth16 proof...");

    // If no vKey provided, try to load from filesystem
    let verificationKey = vKey;
    if (!verificationKey) {
      const vkPath = path.resolve(
        process.cwd(),
        "public",
        "zk",
        "verification_voucher.json"
      );
      if (fs.existsSync(vkPath)) {
        verificationKey = JSON.parse(fs.readFileSync(vkPath, "utf8"));
      } else {
        console.error("[ZK Verify] No verification key available");
        return false;
      }
    }

    const isValid = await snarkjs.groth16.verify(
      verificationKey,
      publicSignals,
      proof
    );

    if (isValid) {
      console.log("[ZK Verify] ✅ Proof verified successfully");
    } else {
      console.warn("[ZK Verify] ❌ Proof verification failed");
    }
    return isValid;
  } catch (error) {
    console.error("[ZK Verify] Verification error:", error);
    return false;
  }
}

/**
 * Verify a commitment proof (simple Poseidon commitment check).
 */
export async function verifyCommitmentProof(
  vKey: any,
  publicSignals: any[],
  proof: any
): Promise<boolean> {
  try {
    let verificationKey = vKey;
    if (!verificationKey) {
      const vkPath = path.resolve(
        process.cwd(),
        "public",
        "zk",
        "verification_commitment.json"
      );
      if (fs.existsSync(vkPath)) {
        verificationKey = JSON.parse(fs.readFileSync(vkPath, "utf8"));
      } else {
        console.error("[ZK Verify] No commitment verification key");
        return false;
      }
    }

    return await snarkjs.groth16.verify(verificationKey, publicSignals, proof);
  } catch (error) {
    console.error("[ZK Verify] Commitment verification error:", error);
    return false;
  }
}