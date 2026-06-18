/**
 * /api/payroll/prepare-atas
 *
 * Idempotently ensure the employer's working ATA and the employee's
 * receiving ATA exist on base. The MagicBlock crank can ONLY settle into
 * existing ATAs (it doesn't create them inside the settlement tx), and we
 * keep ATA creation OFF the disburse hot path to keep that tx small.
 *
 * Also probes MagicBlock's `is-mint-initialized` and registers the mint for
 * private payments if needed. This is a one-time-per-mint setup that takes
 * ~7 ixs and would otherwise blow the 1232-byte tx limit if bundled with a
 * disburse.
 *
 * POST body: { employer, employee, mint? }
 * Returns:   { transactionBase64 or null if everything is already ready }
 */

import { NextRequest, NextResponse } from "next/server";
import {
  Connection,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import {
  CIVITAS_ER_MINT,
} from "@/lib/civitas-ephemeral-client";
import { SOLANA_RPC } from "@/lib/server/magicblock-private-payments";

export const runtime = "nodejs";

const PAYMENTS_API =
  process.env.NEXT_PUBLIC_MAGICBLOCK_PAYMENTS_API ?? "https://payments.magicblock.app";

interface PrepareBody {
  employer: string;
  employee: string;
  mint?: string;
}

function err(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}

export async function POST(req: NextRequest) {
  let body: PrepareBody;
  try {
    body = (await req.json()) as PrepareBody;
  } catch {
    return err("invalid JSON body");
  }
  if (!body.employer || !body.employee) {
    return err("required: employer, employee");
  }

  let employer: PublicKey;
  let employee: PublicKey;
  let mintPk: PublicKey;
  try {
    employer = new PublicKey(body.employer);
    employee = new PublicKey(body.employee);
    mintPk = body.mint ? new PublicKey(body.mint) : CIVITAS_ER_MINT;
  } catch (e) {
    return err((e as Error).message);
  }

  const conn = new Connection(SOLANA_RPC, "confirmed");

  // ── Step A: Check + initialize the mint for private payments ────────────
  // The MagicBlock /v1/spl/initialize-mint endpoint is the canonical way to
  // bootstrap the transfer queue + rent PDAs for a (mint, validator) pair.
  // It returns a 7-ix unsigned tx that the employer signs.
  let mintInitTxB64: string | null = null;
  let queueValidator: string | null = null;
  try {
    const check = await fetch(
      `${PAYMENTS_API}/v1/spl/is-mint-initialized?mint=${mintPk.toBase58()}&cluster=devnet`,
      { signal: AbortSignal.timeout(8_000) },
    );
    const checkJson = (await check.json()) as {
      initialized?: boolean;
      validator?: string;
      error?: { message?: string };
    };
    queueValidator = checkJson.validator ?? null;
    if (!checkJson.initialized) {
      const init = await fetch(`${PAYMENTS_API}/v1/spl/initialize-mint`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payer: employer.toBase58(),
          mint: mintPk.toBase58(),
          cluster: "devnet",
        }),
        signal: AbortSignal.timeout(12_000),
      });
      const initJson = (await init.json()) as {
        transactionBase64?: string;
        validator?: string;
        error?: { message?: string };
      };
      if (!init.ok || !initJson.transactionBase64) {
        return err(
          `initialize-mint failed: ${initJson.error?.message ?? init.status}`,
          init.status === 200 ? 502 : init.status,
        );
      }
      mintInitTxB64 = initJson.transactionBase64;
      queueValidator = initJson.validator ?? queueValidator;
    }
  } catch (e) {
    return err(`mint-init probe failed: ${(e as Error).message}`, 502);
  }

  // ── Step B: ATA-creation tx (separate; can run in parallel with mint init) ──
  const employerAta = getAssociatedTokenAddressSync(mintPk, employer);
  const employeeAta = getAssociatedTokenAddressSync(mintPk, employee);
  const [empAtaInfo, eeAtaInfo] = await Promise.all([
    conn.getAccountInfo(employerAta),
    conn.getAccountInfo(employeeAta),
  ]);
  const ataIxs = [];
  if (!empAtaInfo) {
    ataIxs.push(
      createAssociatedTokenAccountIdempotentInstruction(employer, employerAta, employer, mintPk),
    );
  }
  if (!eeAtaInfo) {
    ataIxs.push(
      createAssociatedTokenAccountIdempotentInstruction(employer, employeeAta, employee, mintPk),
    );
  }

  let ataTxB64: string | null = null;
  if (ataIxs.length > 0) {
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
    const tx = new Transaction();
    tx.feePayer = employer;
    tx.recentBlockhash = blockhash;
    tx.lastValidBlockHeight = lastValidBlockHeight;
    for (const ix of ataIxs) tx.add(ix);
    ataTxB64 = Buffer.from(
      tx.serialize({ requireAllSignatures: false, verifySignatures: false }),
    ).toString("base64");
  }

  return NextResponse.json({
    success: true,
    mintInitTxBase64: mintInitTxB64, // null if already initialized
    ataTxBase64: ataTxB64, // null if both ATAs already exist
    queueValidator,
    employerAta: employerAta.toBase58(),
    employeeAta: employeeAta.toBase58(),
    mintAlreadyInitialized: mintInitTxB64 === null,
    employerAtaExists: !!empAtaInfo,
    employeeAtaExists: !!eeAtaInfo,
  });
}
