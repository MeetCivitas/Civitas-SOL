// lib/server/payroll-store.ts
// Thin adapter layer — delegates to NilDB via nillion-server.ts.
// The previous file-based implementation caused EROFS errors on Vercel.

import {
  createPayrollRun as nilCreatePayrollRun,
  updatePayrollRunStatus as nilUpdatePayrollRunStatus,
  listPayrollRuns as nilListPayrollRuns,
  getPayrollRun as nilGetPayrollRun,
  extractRecords,
} from "./nillion-server";

const DEFAULT_COMPANY = process.env.CIVITAS_COMPANY_ID || "default";

type RunRecord = {
  run_id: string;
  created_at: string;
  declared_total: string;
  payroll_root: string;
  proof: Record<string, unknown>;
  public_signals: string[];
  employees: Array<{
    employee_id: string;
    net_pay: number;
  }>;
  status: "generated" | "committed";
  tx_hash?: string;
};

export async function appendRun(run: RunRecord): Promise<void> {
  await nilCreatePayrollRun(DEFAULT_COMPANY, {
    runId: run.run_id,
    epoch: String(Math.floor(Date.now() / 1000)),
    merkleRoot: run.payroll_root || "",
    commitmentCount: run.employees?.length ?? 0,
    commitments: [],
    status: run.status || "generated",
  });
  console.log(`[PayrollStore] Appended run ${run.run_id} to nilDB`);
}

export async function updateRun(runId: string, updates: Partial<RunRecord>): Promise<RunRecord | null> {
  const status = updates.status || "generated";
  const txHash = updates.tx_hash;
  await nilUpdatePayrollRunStatus(DEFAULT_COMPANY, runId, status, txHash);
  return getRun(runId);
}

export async function listRuns(): Promise<RunRecord[]> {
  const result = await nilListPayrollRuns(DEFAULT_COMPANY);
  const rows = extractRecords(result);
  console.log(`[PayrollStore] Listing runs from nilDB, found ${rows.length} runs`);
  return rows.map(rowToRunRecord);
}

export async function getRun(runId: string): Promise<RunRecord | null> {
  const row = await nilGetPayrollRun(DEFAULT_COMPANY, runId);
  return row ? rowToRunRecord(row) : null;
}

function rowToRunRecord(row: Record<string, any>): RunRecord {
  let commitments: string[] = [];
  try { commitments = JSON.parse(row.commitments || "[]"); } catch { /* empty */ }

  return {
    run_id: row.run_id,
    created_at: row.created_at || "",
    declared_total: row.commitment_count || "0",
    payroll_root: row.merkle_root || "",
    proof: {},
    public_signals: commitments,
    employees: [],
    status: (row.status as "generated" | "committed") || "generated",
    tx_hash: row.tx_hash || undefined,
  };
}
