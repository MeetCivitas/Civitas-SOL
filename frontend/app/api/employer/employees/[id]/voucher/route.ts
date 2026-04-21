import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession } from "@/lib/server/session";
import {
  createCredentialVoucher,
  getEmployeeProfile,
  provisionEmployeesFromSeeds,
} from "@/lib/server/employee-store";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const runtime = "nodejs";

export async function POST(req: NextRequest, context: RouteContext) {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const session = await verifySession(token);
  if (!session || session.role !== "employer") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: employeeId } = await context.params;

  let employee = await getEmployeeProfile(employeeId);
  let body: any = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  if (!employee) {
    const seed = body?.employee;
    if (!seed) {
      return NextResponse.json(
        { error: "Employee not provisioned. Provide employee payload to issue voucher." },
        { status: 404 }
      );
    }
    await provisionEmployeesFromSeeds(
      [
        {
          employee_id: employeeId,
          username: seed.username || seed.email?.split("@")[0] || employeeId,
          name: seed.name,
          email: seed.email,
          role: seed.role || "employee",
          salary: seed.basePay,
          currency: seed.salaryCurrency,
        },
      ],
      seed.org_id || "demo_org",
      "voucher_issue"
    );
    employee = await getEmployeeProfile(employeeId);
  }

  if (!employee) {
    return NextResponse.json({ error: "Unable to provision employee" }, { status: 500 });
  }

  try {
    const { token: voucherToken, expires_at } = await createCredentialVoucher(employee.employee_id);
    const origin = new URL(req.url).origin;
    const downloadUrl = `${origin}/api/credential/${voucherToken}`;

    return NextResponse.json({
      success: true,
      token: voucherToken,
      expires_at,
      download_url: downloadUrl,
    });
  } catch (error: any) {
    console.error("Failed to create credential voucher:", error);
    return NextResponse.json(
      { error: error.message || "Unable to create voucher" },
      { status: 500 }
    );
  }
}
