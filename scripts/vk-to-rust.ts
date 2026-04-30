#!/usr/bin/env tsx
/**
 * scripts/vk-to-rust.ts
 *
 * Converts a snarkjs Groth16 verification_key.json into the byte layout the
 * on-chain verifier expects (programs/civitas-payroll/src/verifier/groth16.rs).
 *
 * Layout (BE coordinates, LE prefix lengths):
 *   alpha_g1 (64) || beta_g2 (128) || gamma_g2 (128) || delta_g2 (128)
 *   || ic_len: u32 LE  (must be 2)
 *   || ic[0] (64) || ic[1] (64)
 *
 * snarkjs gives us point coords as decimal-string BigInts. We:
 *   1. Convert each coord to a 32-byte BE buffer.
 *   2. For G2 points, snarkjs lists imaginary part FIRST in the inner array
 *      (consistent with EIP-197 encoding: x.c1 || x.c0 || y.c1 || y.c0).
 *
 * Usage: tsx scripts/vk-to-rust.ts <verification_key.json> <output.bin>
 */

import * as fs from "node:fs";
import * as path from "node:path";

const BN254_FQ_BYTES = 32;
const G1_LEN = 64;
const G2_LEN = 128;

function fieldToBE(decStr: string): Buffer {
  const buf = Buffer.alloc(BN254_FQ_BYTES, 0);
  let n = BigInt(decStr);
  if (n < 0n) throw new Error("negative coord");
  for (let i = BN254_FQ_BYTES - 1; i >= 0; i--) {
    buf[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  if (n !== 0n) throw new Error(`coord doesn't fit in 32 bytes: ${decStr}`);
  return buf;
}

/** snarkjs G1: [x, y, "1"]. Output: x (32 BE) || y (32 BE). */
function g1ToBytes(p: [string, string, string]): Buffer {
  return Buffer.concat([fieldToBE(p[0]), fieldToBE(p[1])]);
}

/** snarkjs G2: [[x_c0, x_c1], [y_c0, y_c1], ["1","0"]].
 *  EIP-197 expects: x_c1 || x_c0 || y_c1 || y_c0  (each 32 BE). */
function g2ToBytes(p: [[string, string], [string, string], [string, string]]): Buffer {
  return Buffer.concat([
    fieldToBE(p[0][1]), // x.c1
    fieldToBE(p[0][0]), // x.c0
    fieldToBE(p[1][1]), // y.c1
    fieldToBE(p[1][0]), // y.c0
  ]);
}

function main() {
  const [, , inPath, outPath] = process.argv;
  if (!inPath || !outPath) {
    console.error("Usage: tsx scripts/vk-to-rust.ts <verification_key.json> <output.bin>");
    process.exit(1);
  }

  const vk = JSON.parse(fs.readFileSync(path.resolve(inPath), "utf8"));

  if (vk.protocol !== "groth16") {
    throw new Error(`expected protocol=groth16, got ${vk.protocol}`);
  }
  if (vk.curve !== "bn128") {
    throw new Error(`expected curve=bn128, got ${vk.curve}`);
  }

  const ic = vk.IC as [string, string, string][];
  if (ic.length !== 2) {
    throw new Error(
      `expected 2 IC points (1 public input), got ${ic.length}. ` +
      `Update voucher.circom or the on-chain VerifyingKey shape.`,
    );
  }

  const alpha = g1ToBytes(vk.vk_alpha_1);
  const beta = g2ToBytes(vk.vk_beta_2);
  const gamma = g2ToBytes(vk.vk_gamma_2);
  const delta = g2ToBytes(vk.vk_delta_2);
  const ic0 = g1ToBytes(ic[0]);
  const ic1 = g1ToBytes(ic[1]);

  const icLenBuf = Buffer.alloc(4);
  icLenBuf.writeUInt32LE(2, 0);

  const out = Buffer.concat([alpha, beta, gamma, delta, icLenBuf, ic0, ic1]);

  // Sanity: alpha(64) + 3*g2(128) + 4 + 2*g1(64) = 580 bytes.
  const expected = G1_LEN + G2_LEN * 3 + 4 + G1_LEN * 2;
  if (out.length !== expected) {
    throw new Error(`output length ${out.length} != expected ${expected}`);
  }

  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(path.resolve(outPath), out);
  console.log(`wrote ${out.length} bytes → ${outPath}`);
}

main();
