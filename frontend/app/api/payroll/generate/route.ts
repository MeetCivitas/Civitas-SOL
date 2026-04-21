/**
 * POST /api/payroll/generate
 * Phase 1 of the employer payroll flow.
 *
 * Requests the nilCC TEE enclave to:
 *   1. Fetch encrypted employee salaries from NilDB
 *   2. Compute BN254 Poseidon commitments inside the enclave
 *   3. Build Merkle tree + return root
 *   4. Store encrypted vouchers back to NilDB
 *
 * Returns: { runId, merkleRoot, commitmentCount, totalUsdcApprox }
 * NEVER returns: individual salary amounts or employee identities
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";

// ── nilCC client ──────────────────────────────────────────────────────────

const NILCC_ENDPOINT = process.env.NILCC_ENDPOINT ?? "http://localhost:80";

async function invokeNilCC(manifest: object): Promise<{
  merkle_root: string;
  merkle_root_field: string;
  commitments: string[];
  commitment_count: number;
  total_amount: string;
  run_id: string;
  attestation: object;
}> {
  // Submit manifest to the nilCC TEE enclave and poll for result
  const submitResp = await fetch(`${NILCC_ENDPOINT}/api/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ manifest }),
    signal: AbortSignal.timeout(120_000), // 2 minute TEE compute budget
  });

  if (!submitResp.ok) {
    throw new Error(`nilCC submit failed: ${submitResp.statusText}`);
  }

  // Poll for result (nilCC is async)
  for (let attempt = 0; attempt < 60; attempt++) {
    await new Promise((r) => setTimeout(r, 3_000));
    const resultResp = await fetch(`${NILCC_ENDPOINT}/result`);
    const body = await resultResp.json();

    if (body.status === "done" && body.data) return body.data;
    if (body.status === "error") throw new Error(`nilCC error: ${body.error}`);
  }

  throw new Error("nilCC timed out after 3 minutes");
}

// ── Route Handler ─────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { employerAddress, runName, period } = body as {
      employerAddress: string;
      runName: string;
      period: string;
    };

    if (!employerAddress || !runName) {
      return NextResponse.json({ error: "Missing employerAddress or runName" }, { status: 400 });
    }

    const runId = uuidv4();
    const epoch = Math.floor(Date.now() / 1000);

    // ── Fetch employees from NilDB (server-side — no client access) ─────
    const { getNillionServerClient } = await import("@/lib/server/nillion-server");
    const nillionClient = await getNillionServerClient();

    // Fetch encrypted employee records for this employer
    const employees = await nillionClient.getEmployeesForPayroll(employerAddress);

    if (!employees || employees.length === 0) {
      return NextResponse.json({ error: "No employees registered for this employer" }, { status: 404 });
    }

    // ── Prepare TEE manifest ──────────────────────────────────────────────
    const manifest = {
      run_id: runId,
      epoch,
      company_id: employerAddress,
      run_name: runName,
      period,
      employees: employees.map((emp: { employee_tag: string; salary_amount: string }) => ({
        employee_tag: emp.employee_tag,
        salary: emp.salary_amount,
      })),
    };

    // ── Invoke nilCC TEE ──────────────────────────────────────────────────
    const nilccResult = await invokeNilCC(manifest);

    // ── Store run metadata in NilDB ───────────────────────────────────────
    await nillionClient.createPayrollRun({
      runId,
      companyId: employerAddress,
      merkleRoot: nilccResult.merkle_root,
      totalAmount: nilccResult.total_amount,
      employeeCount: employees.length,
      status: "draft",
      nilccAttestation: JSON.stringify(nilccResult.attestation),
    });

    // ── Response (NO individual amounts) ─────────────────────────────────
    return NextResponse.json({
      runId,
      merkleRoot: nilccResult.merkle_root,
      merkleRootField: nilccResult.merkle_root_field,
      commitmentCount: nilccResult.commitment_count,
      // totalUsdcApprox is for employer treasury display ONLY — not logged, not emitted
      totalUsdcApprox: Number(nilccResult.total_amount) / 1_000_000,
      epoch,
    });
  } catch (err: unknown) {
    console.error("[payroll/generate]", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: "Payroll generation failed. Check nilCC connectivity." },
      { status: 500 }
    );
  }
}
