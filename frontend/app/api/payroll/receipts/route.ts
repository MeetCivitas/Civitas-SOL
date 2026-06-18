/**
 * /api/payroll/receipts
 *
 * Audit log for MagicBlock encrypted-queue disbursements. Each entry records
 * the off-chain metadata for a private payment so HR/compliance can replay
 * who paid whom, when, how much — without the public chain leaking it.
 *
 * Storage: Nillion's NilDB (privacy-preserving), reusing the existing
 * `vouchers` collection schema from the legacy ZK flow. Encrypted fields
 * mean only the holding org can decrypt, satisfying the "blind compliance"
 * design goal that's been a constant since the project started.
 *
 * Receipt lifecycle:
 *   pending  — civitas_ephemeral::authorize_disburse landed; crank queued
 *   settled  — recipient ATA confirmed credited on base (poll detected it)
 *
 * POST body (create):
 *   { employer, employee, amount, employerCompanyId, authorizeTxSig,
 *     receiptId, clientRefId?, mint? }
 *
 * PATCH body (settle):
 *   { receiptId, employerCompanyId, settlementTxSig }
 *
 * GET ?employer=<pubkey>&companyId=<id>  → list employer's receipts
 * GET ?employee=<pubkey>                  → scan all configured companies for
 *                                            receipts addressed to this employee
 */

import { NextRequest, NextResponse } from "next/server";
import {
  createVoucherBatch,
  listAllVouchers,
  listVouchersByEmployee,
  updateVoucherStatus,
  extractRecords,
  isNillionConfigured,
} from "@/lib/server/nillion-server";

export const runtime = "nodejs";

function err(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}

function today(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

// ── POST: record a fresh receipt (status=pending) ─────────────────────────

export async function POST(req: NextRequest) {
  if (!isNillionConfigured()) {
    return err(
      "Nillion not configured (NILLION_ORG_SECRET_KEY missing). " +
        "Receipts can't be persisted; the disbursement still settles on-chain.",
      503,
    );
  }
  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return err("invalid JSON body");
  }
  const {
    employer,
    employee,
    amount,
    employerCompanyId,
    authorizeTxSig,
    receiptId,
    clientRefId,
  } = body;
  if (!employer || !employee || !amount || !employerCompanyId || !authorizeTxSig || !receiptId) {
    return err(
      "required: employer, employee, amount, employerCompanyId, authorizeTxSig, receiptId",
    );
  }

  try {
    await createVoucherBatch(employerCompanyId, [
      {
        // `commitment` is the receipt's primary off-chain identifier.
        commitment: receiptId,
        employeeTag: employee,
        amount: String(amount), // base units, decimals=6 for our USDC mint
        // `nonce` carries the on-chain authorize-tx signature so an auditor
        // can pair the receipt to the on-chain DisburseAuthorized event.
        nonce: authorizeTxSig,
        // `nullifier` will be filled with the settlement txSig once crank
        // delivers. Left empty until PATCH.
        nullifier: "",
        epoch: today(),
        runId: clientRefId ?? authorizeTxSig.slice(0, 12),
        employerAddress: employer,
      },
    ]);
    return NextResponse.json({
      success: true,
      receiptId,
      status: "pending",
      epoch: today(),
    });
  } catch (e) {
    const msg = (e as Error).message;
    console.error("[receipts] POST failed:", msg);
    return err(`failed to record receipt: ${msg}`, 500);
  }
}

// ── PATCH: settlement landed ───────────────────────────────────────────────

export async function PATCH(req: NextRequest) {
  if (!isNillionConfigured()) {
    return err("Nillion not configured", 503);
  }
  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return err("invalid JSON body");
  }
  const { receiptId, employerCompanyId, settlementTxSig } = body;
  if (!receiptId || !employerCompanyId) {
    return err("required: receiptId, employerCompanyId");
  }

  try {
    // We store settlement txSig in the `tx_hash` field (added on PATCH by
    // updateVoucherStatus when newStatus === 'settled').
    await updateVoucherStatus(employerCompanyId, receiptId, "settled", settlementTxSig);
    return NextResponse.json({ success: true, receiptId, status: "settled" });
  } catch (e) {
    console.error("[receipts] PATCH failed:", (e as Error).message);
    return err(`failed to update receipt: ${(e as Error).message}`, 500);
  }
}

// ── GET: list ──────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  if (!isNillionConfigured()) {
    return NextResponse.json({ receipts: [], note: "Nillion not configured" });
  }
  const { searchParams } = new URL(req.url);
  const employer = searchParams.get("employer");
  const employee = searchParams.get("employee");
  const companyId = searchParams.get("companyId");

  try {
    if (companyId && employer) {
      const result = await listAllVouchers(companyId);
      const records = extractRecords(result);
      // Filter to disbursements from this employer (legacy ZK vouchers might
      // share the collection — distinguish by `employer_address`).
      const filtered = records.filter(
        (r) => (r.employer_address as string | undefined) === employer,
      );
      return NextResponse.json({ receipts: filtered });
    }
    if (companyId && employee) {
      const result = await listVouchersByEmployee(companyId, employee);
      const records = extractRecords(result);
      return NextResponse.json({ receipts: records });
    }
    return err("provide companyId + (employer OR employee)");
  } catch (e) {
    console.error("[receipts] GET failed:", (e as Error).message);
    return err(`list failed: ${(e as Error).message}`, 500);
  }
}
