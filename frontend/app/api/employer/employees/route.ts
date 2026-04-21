import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import {
  getPlaintextClient,
  withRetry,
  extractRecords,
  isNillionConfigured,
  ensureCompanyCollections,
  createEmployees,
  listActiveEmployees,
} from "@/lib/server/nillion-server";
import { listAllEmployees, sanitizeEmployee } from "@/lib/server/employee-store";

export const runtime = "nodejs";

function addressToCompanyId(address: string): string {
  return crypto
    .createHash("sha256")
    .update(address.toLowerCase())
    .digest("hex")
    .slice(0, 20);
}

/** Parse salary from NilDB %share value — may be JSON or plain string */
function parseSalary(raw: any): string {
  if (!raw) return "0";
  const val = (raw && raw["%share"]) || raw;
  if (typeof val !== "string") return String(val);
  try {
    const parsed = JSON.parse(val);
    if (parsed && parsed.amount) return String(parsed.amount);
  } catch { /* not JSON, use as-is */ }
  return val;
}

/**
 * GET /api/employer/employees
 */
export async function GET(req: NextRequest) {
  const ownerAddress = req.nextUrl.searchParams.get("address");

  if (ownerAddress && isNillionConfigured()) {
    try {
      const companyId = addressToCompanyId(ownerAddress);
      const result = await listActiveEmployees(companyId);
      const records = extractRecords(result);

      const employees = records.map((r: any) => {
        const tag = r.employee_tag || "";
        const salary = parseSalary(r.salary_policy);
        const name = r.employee_name || "";
        return {
          employee_id: r._id,
          employee_tag: tag,
          employee_name: name,
          salary_amount: salary,
          salary_currency: "STRK",
          status: r.status || "active",
          created_at: r.created_at || "",
          username: name || `emp_${(r._id || "").slice(0, 8)}`,
          org_id: companyId,
          role: "employee",
          profile: {
            name: name || `Employee ${(r._id || "").slice(0, 6)}`,
            role: "employee",
          },
        };
      });

      return NextResponse.json({ success: true, employees, source: "nildb" });
    } catch (err: any) {
      console.error("[employees GET NilDB] error:", err);
    }
  }

  // Legacy fallback
  try {
    const all = await listAllEmployees();
    const employees = all.filter((e) => e.role !== "auditor");
    const sanitized = employees.map(sanitizeEmployee).filter(Boolean);
    return NextResponse.json({ success: true, employees: sanitized, source: "legacy" });
  } catch (error: any) {
    console.error("[employees GET] error:", error);
    return NextResponse.json({ error: error.message || "Failed" }, { status: 500 });
  }
}

/**
 * POST /api/employer/employees
 * Body: { ownerAddress, employeeTag, employeeName, salaryAmount, salaryCurrency }
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { ownerAddress, employeeTag, employeeName, salaryAmount, salaryCurrency = "STRK" } = body;

  if (!ownerAddress || !employeeTag) {
    return NextResponse.json({ error: "ownerAddress and employeeTag required" }, { status: 400 });
  }

  const companyId = addressToCompanyId(ownerAddress);

  if (!isNillionConfigured()) {
    return NextResponse.json({
      success: true,
      employee: {
        employee_id: crypto.randomUUID(),
        employee_tag: employeeTag,
        employee_name: employeeName || "",
        salary_amount: salaryAmount || "0",
        salary_currency: salaryCurrency,
        status: "active",
      },
    });
  }

  try {
    await ensureCompanyCollections(companyId);

    await createEmployees(companyId, [
      {
        employeeTag,
        employeeName: employeeName || "",
        salaryPolicy: salaryAmount || "0",
      },
    ]);

    return NextResponse.json({
      success: true,
      employee: {
        employee_tag: employeeTag,
        employee_name: employeeName || "",
        salary_amount: salaryAmount || "0",
        salary_currency: salaryCurrency,
        status: "active",
      },
    });
  } catch (err: any) {
    console.error("[employees POST] error:", err);
    return NextResponse.json({ error: err.message || "Failed" }, { status: 500 });
  }
}
