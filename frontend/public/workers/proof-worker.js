/**
 * /public/workers/proof-worker.js
 * Web Worker for UltraHonk proof generation.
 *
 * Runs in a separate thread — the main thread stays responsive.
 * Receives:  { type: "generate", circuitInput }
 * Sends:     { type: "progress", pct, label }   — progress updates
 *            { type: "done",     result }        — proof complete
 *            { type: "error",    error }         — failure
 *
 * The circuit + VK are loaded from:
 *   /circuits/voucher_noir/target/voucher.json  (compiled Noir artifact)
 *   /circuits/voucher_noir/target/vk.bin        (verification key)
 */

/* eslint-disable no-restricted-globals */

self.onmessage = async function (event) {
  const { type, circuitInput } = event.data;
  if (type !== "generate") return;

  try {
    self.postMessage({ type: "progress", pct: 0, label: "Loading bb.js UltraHonk..." });

    // Dynamic import inside the worker
    const { UltraHonkBackend } = await import(
      "https://unpkg.com/@aztec/bb.js@0.68.2/dest/browser/index.js"
    ).catch(() => import("@aztec/bb.js"));

    self.postMessage({ type: "progress", pct: 5, label: "Loading Noir circuit artifact..." });

    // Load the compiled Noir circuit (bytecode)
    const circuitResp = await fetch("/circuits/voucher_noir/target/voucher.json");
    if (!circuitResp.ok) throw new Error("Circuit artifact not found — run `nargo build` first");
    const circuitArtifact = await circuitResp.json();

    self.postMessage({ type: "progress", pct: 15, label: "Initialising prover (WASM)..." });

    // Import Noir.js runtime
    const { Noir } = await import("@noir-lang/noir_js").catch(
      () => import("https://unpkg.com/@noir-lang/noir_js@1.0.0-beta.16/dist/node/index.js")
    );

    // Import Barretenberg backend
    const { BarretenbergBackend } = await import("@noir-lang/backend_barretenberg").catch(
      () => import("https://unpkg.com/@noir-lang/backend_barretenberg@0.36.0/dist/node/index.js")
    );

    self.postMessage({ type: "progress", pct: 25, label: "Compiling backend..." });

    const backend = new BarretenbergBackend(circuitArtifact, { threads: 4 });
    const noir = new Noir(circuitArtifact, backend);

    self.postMessage({ type: "progress", pct: 35, label: "Generating witness..." });

    // Execute circuit to get witness
    const { witness } = await noir.execute(circuitInput);

    self.postMessage({ type: "progress", pct: 55, label: "Generating UltraHonk proof (most time is here)..." });

    // Generate the actual UltraHonk proof
    const { proof, vk } = await backend.generateProof(witness);

    self.postMessage({ type: "progress", pct: 90, label: "Finalising proof..." });

    // Serialise for transfer back to main thread
    const publicSignals = Object.values(circuitInput)
      .filter((v) => typeof v === "string")
      .map(String);

    self.postMessage({
      type: "done",
      result: {
        proofBytes: Array.from(proof),
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
