import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession } from "@/lib/server/session";
import {
  isNillionConfigured,
  ensureCompanyCollections,
  listPayrollRuns,
} from "@/lib/server/nillion-server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const session = await verifySession(token);
  if (!session || session.role !== "employer") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    if (!isNillionConfigured()) {
      return NextResponse.json({
        success: true,
        payrollRuns: [],
        message: "NilDB not configured — no payroll data available",
      });
    }

    // Get company ID from session
    const companyId = (session as any).company_id || "default";
    await ensureCompanyCollections(companyId);

    // Read payroll runs from NilDB
    const rawResults = await listPayrollRuns(companyId);

    // Parse NilDB response — { data: [...], pagination: {} }
    const allRuns: any[] = Array.isArray((rawResults as any)?.data)
      ? (rawResults as any).data
      : Array.isArray(rawResults)
        ? rawResults as any[]
        : [];

    // Deduplicate by run_id
    const seenIds = new Set<string>();
    const uniqueRuns = allRuns.filter((run: any) => {
      const id = run.run_id || run._id;
      if (!id || seenIds.has(id)) return false;
      seenIds.add(id);
      return true;
    });

    console.log(`[PayrollAPI] Found ${uniqueRuns.length} runs in nilDB`);

    // Transform to match UI format
    const payrollRuns = uniqueRuns.map((run: any) => ({
      runId: run.run_id,
      orgId: companyId,
      createdBy: session.username || "employer",
      createdAt: run.created_at || new Date().toISOString(),
      status: run.status === "committed" ? "Committed" : run.status === "generated" ? "Draft" : "Draft",
      employeeCount: parseInt(run.commitment_count || "0", 10),
      declaredTotal: "***", // Never expose amounts in list view
      currency: "STRK",
      payrollRoot: run.merkle_root || "",
      proofHash: run.zk_proof_hash || "",
      notes: [],
      events: [
        { ts: run.created_at, text: "Payroll run created" },
        ...(run.status === "committed" ? [{ ts: run.updated_at || run.created_at, text: "Committed on-chain" }] : []),
      ],
    }));

    return NextResponse.json({
      success: true,
      payrollRuns,
    });
  } catch (error: any) {
    console.error("List payroll runs error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to list payroll runs" },
      { status: 500 }
    );
  }
}
