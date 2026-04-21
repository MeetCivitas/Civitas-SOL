import { UltraHonkBackend } from '@aztec/bb.js';
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
    try {
        console.log("Loading compiled Noir circuit...");
        const circuitPath = path.join(__dirname, '..', '..', 'circuits', 'voucher_noir', 'target', 'voucher.json');
        const circuitStr = readFileSync(circuitPath, 'utf8');
        const circuit = JSON.parse(circuitStr);

        // Initialize backend with threads: 1 to avoid memory limit issues in Node.js
        console.log("Initializing Barretenberg backend...");
        const backend = new UltraHonkBackend(circuit.bytecode, { threads: 1 });

        // Generating the Ultra Keccak ZK Honk VK
        console.log("Generating Verification Key via @aztec/bb.js WASM (UltraKeccakZKHonk)...");

        // Use keccakZK to match the frontend proof generation options
        const vkBytes = await backend.getVerificationKey({ keccak: true, keccakZK: true });

        const outputPath = path.join(__dirname, '..', '..', 'circuits', 'voucher_noir', 'target', 'vk_bbjs.bin');
        writeFileSync(outputPath, vkBytes);

        console.log(`✅ Success! Wrote ${vkBytes.length} bytes to ${outputPath}`);

        // Clean up
        await backend.destroy();
    } catch (error) {
        console.error("Error generating VK:", error);
        process.exit(1);
    }
}

main();
