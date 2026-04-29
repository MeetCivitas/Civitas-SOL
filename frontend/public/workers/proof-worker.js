/**
 * /public/workers/proof-worker.js
 * Web Worker for Noir UltraHonk proof generation.
 *
 * Runs in a separate thread — the main thread stays responsive.
 * Receives:  { type: "generate", circuitInput }
 * Sends:     { type: "progress", pct, label }   — progress updates
 *            { type: "done",     result }        — proof complete
 *            { type: "error",    error }         — failure
 *
 * Circuit artifact must be at:
 *   /circuits/voucher_noir/target/voucher.json  (compiled by `nargo compile`)
 */

/* eslint-disable no-restricted-globals */

self.onmessage = async function (event) {
  const { type, circuitInput } = event.data;
  if (type !== "generate") return;

  try {
    self.postMessage({ type: "progress", pct: 0, label: "Loading Noir circuit artifact..." });

    // Load compiled Noir artifact (nargo compile output)
    const circuitResp = await fetch("/circuits/voucher_noir/target/voucher.json");
    if (!circuitResp.ok) throw new Error("Circuit artifact not found at /circuits/voucher_noir/target/voucher.json");
    const circuitArtifact = await circuitResp.json();

    self.postMessage({ type: "progress", pct: 10, label: "Initialising Noir runtime..." });

    // @noir-lang/noir_js — Noir witness generation
    const { Noir } = await import("@noir-lang/noir_js");

    self.postMessage({ type: "progress", pct: 20, label: "Initialising UltraHonk backend..." });

    // @noir-lang/backend_barretenberg — UltraHonk prover (not Groth16 BarretenbergBackend)
    const { UltraHonkBackend } = await import("@noir-lang/backend_barretenberg");

    self.postMessage({ type: "progress", pct: 30, label: "Compiling proving key (one-time, ~15s)..." });

    const backend = new UltraHonkBackend(circuitArtifact, { threads: navigator.hardwareConcurrency ?? 4 });
    const noir = new Noir(circuitArtifact);

    self.postMessage({ type: "progress", pct: 40, label: "Generating witness..." });

    // Execute Noir circuit — derives the witness from private/public inputs
    const { witness } = await noir.execute(circuitInput);

    self.postMessage({ type: "progress", pct: 55, label: "Generating UltraHonk proof (~30–60s)..." });

    // Generate the proof from the witness
    const proofData = await backend.generateProof(witness);

    self.postMessage({ type: "progress", pct: 88, label: "Exporting verification key..." });

    const vk = await backend.getVerificationKey();

    self.postMessage({ type: "progress", pct: 95, label: "Finalising..." });

    // Extract public inputs — Noir puts them at the front of the proof bytes
    // Public signals are the public inputs passed in circuitInput (non-array, non-object values)
    const publicSignals = [
      circuitInput.merkle_root,
      circuitInput.nullifier,
      circuitInput.recipient_hash,
      circuitInput.amount,
      circuitInput.epoch,
      circuitInput.token_account_hash,
      circuitInput.domain_tag_hash,
    ].map(String);

    self.postMessage({
      type: "done",
      result: {
        proofBytes: Array.from(proofData.proof),
        vkBytes: Array.from(vk),
        publicSignals,
      },
    });
  } catch (err) {
    self.postMessage({
      type: "error",
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
