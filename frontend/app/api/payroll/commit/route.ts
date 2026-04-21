/**
 * POST /api/payroll/commit
 * Phase 2 of the employer payroll flow — builds the Anchor IX sequence.
 *
 * Takes a runId + employer address, fetches the commitments from NilDB,
 * chunks them into Solana-sized batches, and returns serialised versioned
 * transactions for the employer's wallet to sign + submit.
 *
 * Flow:
 *   1. Fetch merkle_root + commitments from NilDB for this runId
 *   2. Chunk commitments into MAX_COMMITMENTS_PER_CHUNK = 32 batches
 *   3. Build IX sequence:
 *        start_payroll_run
 *        append_commitments_chunk × N
 *        finalize_merkle_root
 *   4. Return serialised versioned transactions (never sign server-side)
 *   5. Mark run "committed" in NilDB after employer confirms
 */

import { NextRequest, NextResponse } from "next/server";
import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
  AddressLookupTableProgram,
} from "@solana/web3.js";
import { RPC_ENDPOINT, PROGRAM_ID } from "@/lib/solana-program";

const MAX_COMMITMENTS_PER_CHUNK = 32;

// ── Anchor discriminators (sha256("global:<ix_name>")[0..8]) ─────────────
// Generated from `anchor build` IDL — hardcoded here for the demo build.

function discriminator(name: string): Buffer {
  const hash = require("crypto").createHash("sha256")
    .update(`global:${name}`)
    .digest();
  return Buffer.from(hash.slice(0, 8));
}

const IX_START_PAYROLL_RUN = discriminator("start_payroll_run");
const IX_APPEND_COMMITMENTS_CHUNK = discriminator("append_commitments_chunk");
const IX_FINALIZE_MERKLE_ROOT = discriminator("finalize_merkle_root");

// ── Route Handler ─────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { runId, employerAddress } = body as {
      runId: string;
      employerAddress: string;
    };

    if (!runId || !employerAddress) {
      return NextResponse.json({ error: "Missing runId or employerAddress" }, { status: 400 });
    }

    const connection = new Connection(RPC_ENDPOINT, "confirmed");
    const employer = new PublicKey(employerAddress);

    // ── Fetch commitments from NilDB ──────────────────────────────────────
    const { getNillionServerClient } = await import("@/lib/server/nillion-server");
    const nillionClient = await getNillionServerClient();
    const runData = await nillionClient.getPayrollRun(runId);

    if (!runData) {
      return NextResponse.json({ error: "Payroll run not found" }, { status: 404 });
    }

    const commitments: Uint8Array[] = runData.commitments.map((c: string) => {
      // Each commitment is a BN254 field element — encode as 32-byte LE
      const big = BigInt(c);
      const buf = Buffer.alloc(32);
      let tmp = big;
      for (let i = 0; i < 32; i++) {
        buf[i] = Number(tmp & BigInt(0xff));
        tmp >>= BigInt(8);
      }
      return new Uint8Array(buf);
    });

    // Convert merkle root hex to bytes32
    const merkleRootHex = runData.merkleRoot.replace(/^0x/, "");
    const merkleRootBytes = Buffer.from(merkleRootHex.padStart(64, "0"), "hex");

    // UUID → bytes16
    const runIdBytes = Buffer.from(runId.replace(/-/g, ""), "hex");

    // ── Chunk commitments ─────────────────────────────────────────────────
    const chunks: Uint8Array[][] = [];
    for (let i = 0; i < commitments.length; i += MAX_COMMITMENTS_PER_CHUNK) {
      chunks.push(commitments.slice(i, i + MAX_COMMITMENTS_PER_CHUNK));
    }

    // ── Derive PDAs ───────────────────────────────────────────────────────
    const [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), employer.toBuffer()],
      PROGRAM_ID
    );
    const [runPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("run"), employer.toBuffer(), runIdBytes],
      PROGRAM_ID
    );

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

    const transactions: string[] = [];

    // ── TX 1: start_payroll_run ─────────────────────────────────────────
    const startIx = buildStartPayrollRunIx(
      employer,
      vaultPda,
      runPda,
      runIdBytes,
      BigInt(runData.epoch),
      commitments.length
    );
    const startTx = new VersionedTransaction(
      new TransactionMessage({
        payerKey: employer,
        recentBlockhash: blockhash,
        instructions: [startIx],
      }).compileToV0Message()
    );
    transactions.push(Buffer.from(startTx.serialize()).toString("base64"));

    // ── TX 2..N: append_commitments_chunk ─────────────────────────────────
    for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
      const chunk = chunks[chunkIdx];
      const chunkIdxBuf = Buffer.alloc(4);
      chunkIdxBuf.writeUInt32LE(chunkIdx, 0);

      const [chunkPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("chunk"), runIdBytes, chunkIdxBuf],
        PROGRAM_ID
      );

      const appendIx = buildAppendChunkIx(
        employer,
        vaultPda,
        runPda,
        chunkPda,
        runIdBytes,
        chunkIdx,
        chunk
      );

      const appendTx = new VersionedTransaction(
        new TransactionMessage({
          payerKey: employer,
          recentBlockhash: blockhash,
          instructions: [appendIx],
        }).compileToV0Message()
      );
      transactions.push(Buffer.from(appendTx.serialize()).toString("base64"));
    }

    // ── TX N+1: finalize_merkle_root ──────────────────────────────────────
    const finalizeIx = buildFinalizeRootIx(
      employer,
      vaultPda,
      runPda,
      runIdBytes,
      merkleRootBytes,
      chunks.length
    );
    const finalizeTx = new VersionedTransaction(
      new TransactionMessage({
        payerKey: employer,
        recentBlockhash: blockhash,
        instructions: [finalizeIx],
      }).compileToV0Message()
    );
    transactions.push(Buffer.from(finalizeTx.serialize()).toString("base64"));

    return NextResponse.json({
      runId,
      transactions,
      chunkCount: chunks.length,
      commitmentCount: commitments.length,
    });
  } catch (err: unknown) {
    console.error("[payroll/commit]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Failed to build commit transactions" }, { status: 500 });
  }
}

// ── Instruction builders ──────────────────────────────────────────────────

function buildStartPayrollRunIx(
  owner: PublicKey,
  vault: PublicKey,
  run: PublicKey,
  runId: Buffer,
  epoch: bigint,
  expectedCount: number
) {
  const { TransactionInstruction } = require("@solana/web3.js");

  const data = Buffer.alloc(8 + 16 + 8 + 4);
  IX_START_PAYROLL_RUN.copy(data, 0);
  runId.copy(data, 8);
  data.writeBigUInt64LE(epoch, 24);
  data.writeUInt32LE(expectedCount, 32);

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: false },
      { pubkey: run, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

function buildAppendChunkIx(
  owner: PublicKey,
  vault: PublicKey,
  run: PublicKey,
  chunk: PublicKey,
  runId: Buffer,
  chunkIndex: number,
  commitments: Uint8Array[]
) {
  const { TransactionInstruction } = require("@solana/web3.js");

  // run_id: [u8;16] | chunk_index: u32 | commitments: Vec<[u8;32]>
  const commitmentsBytes = Buffer.concat(commitments.map((c) => Buffer.from(c)));
  const data = Buffer.alloc(8 + 16 + 4 + 4 + commitmentsBytes.length);
  IX_APPEND_COMMITMENTS_CHUNK.copy(data, 0);
  runId.copy(data, 8);
  data.writeUInt32LE(chunkIndex, 24);
  data.writeUInt32LE(commitments.length, 28);
  commitmentsBytes.copy(data, 32);

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: false },
      { pubkey: run, isSigner: false, isWritable: true },
      { pubkey: chunk, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

function buildFinalizeRootIx(
  owner: PublicKey,
  vault: PublicKey,
  run: PublicKey,
  runId: Buffer,
  newRoot: Buffer,
  chunkCount: number
) {
  const { TransactionInstruction, SYSVAR_CLOCK_PUBKEY } = require("@solana/web3.js");

  const data = Buffer.alloc(8 + 16 + 32 + 4);
  IX_FINALIZE_MERKLE_ROOT.copy(data, 0);
  runId.copy(data, 8);
  newRoot.copy(data, 24);
  data.writeUInt32LE(chunkCount, 56);

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: run, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
    ],
    data,
  });
}
