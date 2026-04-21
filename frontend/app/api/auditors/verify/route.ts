import { NextRequest, NextResponse } from "next/server";
import { listAllEmployees } from "@/lib/server/employee-store";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { run_id } = await req.json();
    if (!run_id) {
      return NextResponse.json({ error: "run_id required" }, { status: 400 });
    }

    const employees = await listAllEmployees();
    const vouchers = employees
      .flatMap((emp) =>
        (emp.vouchers || [])
          .filter((voucher) => voucher.run_id === run_id)
          .map((voucher) => ({
            employee_id: emp.employee_id,
            username: emp.username,
            ...voucher,
          }))
      );

    const redeemed = vouchers.filter((v) => v.status === "redeemed").length;
    const pending = vouchers.filter((v) => v.status !== "redeemed").length;

    return NextResponse.json({
      run_id,
      total_employees: employees.length,
      vouchers_found: vouchers.length,
      redeemed,
      pending,
      vouchers,
      status: pending === 0 ? "settled" : "pending",
    });
  } catch (error: any) {
    console.error("auditor verify error:", error);
    return NextResponse.json(
      { error: error.message || "verification failed" },
      { status: 500 }
    );
  }
}

