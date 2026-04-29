/**
 * POST /api/payroll/generate
 * Phase 1 of the employer payroll flow.
 *
 * 1. Fetch encrypted employee salaries from NilDB
 * 2. Attempt nilCC TEE enclave computation (Poseidon commitments + Merkle tree)
 * 3. If nilCC unavailable, fall back to in-process BN254 Poseidon computation
 * 4. Store encrypted vouchers in NilDB
 * 5. Return { runId, merkleRoot, commitmentCount, totalUsdcApprox }
 *
 * NEVER returns individual salary amounts or employee identities.
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import { 
  isNilCCConfigured, 
  submitPayrollJob, 
  pollJobResult, 
  deleteWorkload,
  verifyAttestation 
} from "@/lib/server/nilcc-client";

// ── BN254 field prime ─────────────────────────────────────────────────────
const BN254_PRIME = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");

function fieldElement(value: bigint): bigint {
  return ((value % BN254_PRIME) + BN254_PRIME) % BN254_PRIME;
}

function randomFieldElement(): bigint {
  const buf = crypto.randomBytes(31);
  return fieldElement(BigInt("0x" + buf.toString("hex")));
}

// ── Local Poseidon computation (BN254) ────────────────────────────────────

async function computeLocalPayroll(manifest: {
  run_id: string;
  epoch: string | number;
  company_id: string;
  employees: Array<{ employee_tag: string; salary: string | number }>;
}): Promise<{
  merkle_root: string;
  merkle_root_field: string;
  commitments: string[];
  commitment_count: number;
  total_amount: string;
  run_id: string;
  attestation: object;
  vouchers: Array<{
    employee_tag: string;
    amount: string;
    epoch: string;
    voucher_nonce: string;
    commitment: string;
    nullifier: string;
  }>;
}> {
  console.log(`[payroll/generate] computeLocalPayroll starting for ${manifest.employees.length} employees`);
  
  // Use dynamic import for better compatibility with Next.js/Webpack
  const poseidonPkg = await import("poseidon-lite");
  const poseidon2 = poseidonPkg.poseidon2;
  const poseidon4 = poseidonPkg.poseidon4;

  if (typeof poseidon2 !== "function" || typeof poseidon4 !== "function") {
    throw new Error("Failed to load poseidon-lite functions. Check package installation.");
  }

  const epoch = BigInt(manifest.epoch);
  const entries: Array<{
    employee_tag: string;
    salaryMicro: bigint;
    commitment: bigint;
    nonce: bigint;
  }> = [];

  let totalAmount = BigInt(0);

  for (const emp of manifest.employees) {
    try {
      // Parse salary as USDC micro-units (6 decimals)
      const salaryFloat = Number(emp.salary) || 0;
      const salaryMicro = BigInt(Math.round(salaryFloat * 1_000_000));

      // employee_tag IS already a BN254 field element stored as a decimal string.
      if (!emp.employee_tag) {
        throw new Error(`Missing employee_tag for employee with salary ${emp.salary}`);
      }
      
      const tagField = fieldElement(BigInt(emp.employee_tag));
      const voucherNonce = randomFieldElement();

      // commitment = Poseidon4(employee_tag_field, salary_micro, epoch, voucher_nonce)
      const commitment = poseidon4([tagField, salaryMicro, epoch, voucherNonce]);

      totalAmount += salaryMicro;
      entries.push({ employee_tag: emp.employee_tag, salaryMicro, commitment, nonce: voucherNonce });
    } catch (err) {
      console.error(`[payroll/generate] Error processing employee ${emp.employee_tag}:`, err);
      throw err;
    }
  }

  // ── Build Merkle tree (depth 20, Poseidon2 internal nodes) ─────────────
  const depth = 20;
  const leafCount = entries.length;

  // Zero hashes for empty leaves
  const zeros: bigint[] = [BigInt(0)];
  for (let i = 1; i <= depth; i++) {
    zeros.push(poseidon2([zeros[i - 1], zeros[i - 1]]));
  }

  // Build leaf layer — pad to next power of 2
  const size = Math.pow(2, Math.ceil(Math.log2(Math.max(leafCount, 1))));
  const leaves: bigint[] = entries.map((e) => e.commitment);
  while (leaves.length < size) {
    leaves.push(BigInt(0));
  }

  let currentLayer = leaves;
  for (let level = 0; level < depth; level++) {
    const nextLayer: bigint[] = [];
    const zero = zeros[level];
    for (let i = 0; i < currentLayer.length; i += 2) {
      const left = currentLayer[i] ?? zero;
      const right = currentLayer[i + 1] ?? zero;
      nextLayer.push(poseidon2([left, right]));
    }
    currentLayer = nextLayer;
  }

  const merkleRootField = currentLayer[0] ?? BigInt(0);
  const merkleRootHex = "0x" + merkleRootField.toString(16).padStart(64, "0");

  return {
    merkle_root: merkleRootHex,
    merkle_root_field: merkleRootField.toString(),
    commitments: entries.map((e) => e.commitment.toString()),
    commitment_count: entries.length,
    total_amount: totalAmount.toString(),
    run_id: manifest.run_id,
    attestation: {
      source: "civitas-local-compute",
      run_id: manifest.run_id,
      timestamp: new Date().toISOString(),
      merkle_root: merkleRootHex,
      commitment_count: entries.length,
      enclave: { type: "local", measurement: "civitas-hackathon-v1" },
    },
    vouchers: entries.map((e) => ({
      employee_tag: e.employee_tag,
      amount: e.salaryMicro.toString(),
      epoch: manifest.epoch.toString(),
      voucher_nonce: e.nonce.toString(),
      commitment: e.commitment.toString(),
      nullifier: "",
    })),
  };
}

// ── nilCC invocation (with timeout + fallback) ─────────────────────────────

async function invokeNilCCCluster(manifest: {
  run_id: string;
  epoch: string;
  company_id: string;
  employees: Array<{ employee_tag: string; salary: number | string }>;
}): Promise<any> {
  if (!isNilCCConfigured()) {
    throw new Error("nilCC Cluster is not configured (missing NILCC_CLUSTER_URL or NILCC_SIGNING_KEY)");
  }

  // 1. Submit the workload to the Nillion SEV-SNP enclave cluster
  const jobId = await submitPayrollJob(manifest);
  
  try {
    // 2. Poll until the enclave finishes computation and returns results
    const result = await pollJobResult(jobId);

    // 3. Verify the TEE attestation
    if (result.attestation) {
      const isValid = verifyAttestation(result.attestation);
      if (!isValid) {
        console.warn("[nilCC] ⚠ TEE attestation verification failed - results may be untrusted");
      }
    }

    return result;
  } finally {
    // 4. Always delete the workload to stop credit consumption
    await deleteWorkload(jobId).catch(err => 
      console.warn(`[nilCC] Failed to cleanup workload ${jobId}:`, err.message)
    );
  }
}

// ── Address → companyId (consistent with employer/employees route) ─────────

function addressToCompanyId(address: string): string {
  return crypto
    .createHash("sha256")
    .update(address.toLowerCase())
    .digest("hex")
    .slice(0, 20);
}

// ── Route Handler ─────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { employerAddress, runName, period, taxPercentage } = body as {
      employerAddress: string;
      runName: string;
      period: string;
      taxPercentage?: number;
    };

    console.log("[payroll/generate] POST received:", { employerAddress, runName, period, taxPercentage });

    if (!employerAddress || !runName) {
      return NextResponse.json({ error: "Missing employerAddress or runName" }, { status: 400 });
    }

    const companyId = addressToCompanyId(employerAddress);
    const runId = uuidv4();
    const epoch = Math.floor(Date.now() / 1000);

    // ── Fetch employees from NilDB ────────────────────────────────────────
    console.log(`[payroll/generate] Step 1 — Fetching employees for company ${companyId}`);
    const { getNillionServerClient } = await import("@/lib/server/nillion-server");
    const nillionClient = await getNillionServerClient();

    const employees = await nillionClient.getEmployeesForPayroll(companyId);
    console.log(`[payroll/generate] Step 1 complete — found ${employees?.length ?? 0} employee(s)`);

    if (!employees || employees.length === 0) {
      return NextResponse.json(
        { error: "No employees registered for this employer. Add employees first." },
        { status: 404 }
      );
    }

    // ── Prepare manifest ─────────────────────────────────────────────────
    const manifest = {
      run_id: runId,
      epoch: epoch.toString(),
      company_id: companyId,
      employees: employees.map((emp) => ({
        employee_tag: emp.employee_tag,
        salary: emp.salary_amount,
      })),
    };

    // ── Try nilCC TEE (Strict) ───────────────────────────────────────────
    let result: any;

    if (!isNilCCConfigured()) {
      console.warn("[nilCC] Not configured — using local Poseidon compute. TEE badge will show amber.");
      result = computeLocalPayroll(manifest);
    } else {
      try {
        console.log(`[payroll/generate] Step 2 — Dispatching job to Nillion nilCC Cluster...`);
        result = await invokeNilCCCluster(manifest);
        console.log("[payroll/generate] Step 2 complete — nilCC cluster computation succeeded");
      } catch (nilccErr) {
        const reason = nilccErr instanceof Error ? nilccErr.message : String(nilccErr);
        console.error(`[payroll/generate] FATAL: nilCC computation failed: ${reason}`);
        
        return NextResponse.json(
          { 
            error: "Secure Enclave Computation Failed", 
            details: reason,
            suggestion: "Check nilCC cluster status or workload image configuration." 
          }, 
          { status: 500 }
        );
      }
    }

    // ── Store run + vouchers in NilDB ─────────────────────────────────────
    console.log(`[payroll/generate] Step 3 — Storing payroll run ${runId} with attestation`);
    const { createPayrollRun, createVoucherBatch, ensureCompanyCollections } =
      await import("@/lib/server/nillion-server");

    await ensureCompanyCollections(companyId);

    // Pass the attestation stringified if it's an object
    const attestationStr = typeof result.attestation === "object" 
      ? JSON.stringify(result.attestation) 
      : String(result.attestation || "");

    await createPayrollRun(companyId, {
      runId,
      epoch: String(epoch),
      merkleRoot: result.merkle_root,
      commitmentCount: result.commitment_count,
      commitments: result.commitments,
      status: "generated",
      employerAddress,
      // @ts-ignore - explicitly passing attestation to NilDB
      nilccAttestation: attestationStr,
    });

    if (result.vouchers && result.vouchers.length > 0) {
      console.log(`[payroll/generate] Step 3b — storing ${result.vouchers.length} vouchers`);
      await createVoucherBatch(
        companyId,
        result.vouchers.map((v: any) => ({
          commitment: v.commitment,
          employeeTag: v.employee_tag,
          amount: v.amount,
          nonce: v.voucher_nonce,
          nullifier: v.nullifier ?? "",
          epoch: String(epoch),
          runId,
          employerAddress,
        }))
      );
    }

    const teeActive = (result.attestation as any)?.enclave?.type !== "local";
    return NextResponse.json({
      runId,
      merkleRoot: result.merkle_root,
      merkleRootField: result.merkle_root_field,
      commitmentCount: result.commitment_count,
      commitments: result.commitments,
      totalAmount: result.total_amount,
      totalUsdcApprox: Number(result.total_amount) / 1_000_000,
      epoch,
      teeActive,
      attestation: result.attestation,
    });
  } catch (err: unknown) {
    console.error("[payroll/generate] FATAL ERROR:", err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: message || "Payroll generation failed", details: String(err) },
      { status: 500 }
    );
  }
}
