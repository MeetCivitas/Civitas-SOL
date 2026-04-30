/**
 * frontend/lib/solana-program.ts
 * Civitas Anchor Program Client — shared constants, PDA derivations, and
 * read helpers for VaultState. Instruction builders live next to their
 * callers; the claim flow lives in app/employees/page.tsx.
 */

import { Connection, PublicKey } from "@solana/web3.js";
import BN from "bn.js";

import { SOLANA_CLUSTER, SOLANA_PAYROLL_PROGRAM } from "./solana";

// ── Program constants ────────────────────────────────────────────────────

if (!SOLANA_PAYROLL_PROGRAM || SOLANA_PAYROLL_PROGRAM === "Planned for Solana migration") {
  throw new Error(
    "NEXT_PUBLIC_CIVITAS_PROGRAM_ID is not configured. Set it in .env.local to the deployed program address.",
  );
}
export const PROGRAM_ID = new PublicKey(SOLANA_PAYROLL_PROGRAM);

export const RPC_ENDPOINT =
  SOLANA_CLUSTER === "mainnet-beta"
    ? "https://api.mainnet-beta.solana.com"
    : SOLANA_CLUSTER === "testnet"
    ? "https://api.testnet.solana.com"
    : "https://api.devnet.solana.com";

// ── Connection singleton ─────────────────────────────────────────────────

let _connection: Connection | null = null;

export function getConnection(): Connection {
  if (!_connection) {
    _connection = new Connection(RPC_ENDPOINT, {
      commitment: "confirmed",
      confirmTransactionInitialTimeout: 60_000,
    });
  }
  return _connection;
}

// ── PDA Derivation helpers ────────────────────────────────────────────────

export async function deriveVaultPDA(owner: PublicKey): Promise<[PublicKey, number]> {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), owner.toBuffer()],
    PROGRAM_ID
  );
}

export async function derivePayrollRunPDA(
  owner: PublicKey,
  runId: Uint8Array
): Promise<[PublicKey, number]> {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("run"), owner.toBuffer(), Buffer.from(runId)],
    PROGRAM_ID
  );
}

export async function deriveChunkPDA(
  runId: Uint8Array,
  chunkIndex: number
): Promise<[PublicKey, number]> {
  const chunkIdxBuf = new Uint8Array(4);
  chunkIdxBuf[0] = chunkIndex & 0xff;
  chunkIdxBuf[1] = (chunkIndex >> 8) & 0xff;
  chunkIdxBuf[2] = (chunkIndex >> 16) & 0xff;
  chunkIdxBuf[3] = (chunkIndex >> 24) & 0xff;

  return PublicKey.findProgramAddressSync(
    [Buffer.from("chunk"), Buffer.from(runId), Buffer.from(chunkIdxBuf)],
    PROGRAM_ID
  );
}

export async function deriveNullifierPDA(
  nullifier: Uint8Array
): Promise<[PublicKey, number]> {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("nullifier"), Buffer.from(nullifier)],
    PROGRAM_ID
  );
}

export async function deriveCommitmentPDA(
  commitment: Uint8Array
): Promise<[PublicKey, number]> {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("commit"), Buffer.from(commitment)],
    PROGRAM_ID
  );
}

export async function deriveInvoicePDA(
  id: Uint8Array
): Promise<[PublicKey, number]> {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("invoice"), Buffer.from(id)],
    PROGRAM_ID
  );
}

// ── Types ─────────────────────────────────────────────────────────────────

export interface VaultState {
  owner: PublicKey;
  merkleRoot: Uint8Array;
  commitmentCount: BN;
  usdcBalanceApprox: BN;
  runCount: number;
  snsDomain: string | null;
  usdcVault: PublicKey;
  bump: number;
}

export interface PayrollChunk {
  chunkIndex: number;
  commitments: Uint8Array[]; // each [32]
}

export type ProofProgressCallback = (pct: number, label: string) => void;

/**
 * Read the VaultState PDA for a given owner.
 * Returns parsed account data or null if the vault doesn't exist yet.
 */
export async function getVaultState(owner: PublicKey): Promise<VaultState | null> {
  const connection = getConnection();
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), owner.toBuffer()],
    PROGRAM_ID
  );

  const accountInfo = await connection.getAccountInfo(vaultPda);
  if (!accountInfo || accountInfo.data.length < 8) return null;

  // Deserialise Anchor account (skip 8-byte discriminator)
  const data = accountInfo.data.slice(8);
  let offset = 0;

  const readPubkey = () => {
    const pk = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;
    return pk;
  };
  const readBytes32 = () => {
    const b = data.slice(offset, offset + 32);
    offset += 32;
    return b;
  };
  const readU64 = () => {
    const n = new BN(data.slice(offset, offset + 8), "le");
    offset += 8;
    return n;
  };
  const readU32 = () => {
    const n = data.readUInt32LE(offset);
    offset += 4;
    return n;
  };

  const ownerPk = readPubkey();
  const merkleRoot = readBytes32();
  const commitmentCount = readU64();
  const usdcBalanceApprox = readU64();
  const runCount = readU32();

  // Read Option<String> for sns_domain
  const hasDomain = data[offset++] === 1;
  let snsDomain: string | null = null;
  if (hasDomain) {
    const strLen = data.readUInt32LE(offset);
    offset += 4;
    snsDomain = Buffer.from(data.slice(offset, offset + strLen)).toString("utf8");
    offset += strLen;
  }

  const usdcVault = readPubkey();
  const bump = data[offset];

  return {
    owner: ownerPk,
    merkleRoot,
    commitmentCount,
    usdcBalanceApprox,
    runCount,
    snsDomain,
    usdcVault,
    bump,
  };
}

/**
 * Get the approximate USDC pool balance from vault state.
 */
export async function getPoolBalance(owner: PublicKey): Promise<BN> {
  const vault = await getVaultState(owner);
  return vault?.usdcBalanceApprox ?? new BN(0);
}

// Instruction builders live next to their callers (e.g. /api/payroll/commit
// builds start_payroll_run / append_commitments_chunk / finalize_merkle_root).
// The claim flow lives in app/employees/page.tsx and uses lib/groth16-proof.ts.
// All other on-chain calls are built where they're used so the IX layout is
// transparent to whoever is reading that flow.
