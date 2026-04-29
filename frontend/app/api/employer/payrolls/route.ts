import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import {
  isNillionConfigured,
  ensureCompanyCollections,
  listPayrollRuns,
  extractRecords,
} from "@/lib/server/nillion-server";

export const runtime = "nodejs";

function addressToCompanyId(address: string): string {
  return crypto
    .createHash("sha256")
    .update(address.toLowerCase())
    .digest("hex")
    .slice(0, 20);
}

/**
 * GET /api/employer/payrolls?address=<walletAddress>
 *
 * Returns all payroll runs for the given employer wallet address.
 * Does NOT require session auth — wallet address is the identity.
 */
export async function GET(req: NextRequest) {
  const ownerAddress = req.nextUrl.searchParams.get("address");

  if (!ownerAddress) {
    return NextResponse.json({ error: "address query param required" }, { status: 400 });
  }

  if (!isNillionConfigured()) {
    return NextResponse.json({
      success: true,
      payrollRuns: [],
      message: "NilDB not configured",
    });
  }

  try {
    const companyId = addressToCompanyId(ownerAddress);
    await ensureCompanyCollections(companyId);

    const rawResults = await listPayrollRuns(companyId);
    const allRuns = extractRecords(rawResults);

    // Deduplicate by run_id
    const seenIds = new Set<string>();
    const uniqueRuns = allRuns.filter((run: any) => {
      const id = run.run_id || run._id;
      if (!id || seenIds.has(id)) return false;
      seenIds.add(id);
      return true;
    });

    const payrollRuns = uniqueRuns.map((run: any) => ({
      runId: run.run_id,
      orgId: companyId,
      createdBy: "employer",
      createdAt: run.created_at || new Date().toISOString(),
      status: run.status === "committed" ? "Committed" : run.status === "generated" ? "Draft" : run.status || "Draft",
      employeeCount: parseInt(run.commitment_count || "0", 10),
      declaredTotal: "***",
      currency: "USDC",
      payrollRoot: run.merkle_root || "",
      proofHash: run.zk_proof_hash || "",
      notes: [],
      events: [
        { ts: run.created_at || new Date().toISOString(), text: "Payroll run created" },
        ...(run.status === "committed"
          ? [{ ts: run.updated_at || run.created_at || new Date().toISOString(), text: "Committed on-chain" }]
          : []),
      ],
      commitments: (() => {
        try { return JSON.parse(run.commitments || "[]"); } catch { return []; }
      })(),
      epoch: run.epoch || "",
      txHash: run.tx_hash || "",
      merkleRoot: run.merkle_root || "",
    }));

    return NextResponse.json({ success: true, payrollRuns });
  } catch (error: any) {
    console.error("[employer/payrolls GET]", error);
    return NextResponse.json(
      { error: error.message || "Failed to list payroll runs" },
      { status: 500 }
    );
  }
}
