import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession } from "@/lib/server/session";
import { getEmployeeProfile, upsertEmployees, randomPassword } from "@/lib/server/employee-store";
import bcrypt from "bcryptjs";
import type { EmployeeRecord } from "@/lib/server/employee-store";

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
  const employee = await getEmployeeProfile(employeeId);

  if (!employee) {
    return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  }

  // If already active, return success
  if (employee.status !== "provisional") {
    return NextResponse.json({
      success: true,
      message: "Employee already active",
      employee: {
        employee_id: employee.employee_id,
        username: employee.username,
        status: employee.status,
      },
    });
  }

  // Generate password if not set
  const password = randomPassword();
  const passwordHash = bcrypt.hashSync(password, 10);

  // Activate the employee
  const updated: EmployeeRecord = {
    ...employee,
    password_hash: passwordHash,
    status: "active" as any,
    updated_at: new Date().toISOString(),
  };

  await upsertEmployees([updated]);

  return NextResponse.json({
    success: true,
    message: "Employee activated",
    employee: {
      employee_id: updated.employee_id,
      username: updated.username,
      status: "active",
      temporary_password: password, // Only returned once
    },
  });
}

