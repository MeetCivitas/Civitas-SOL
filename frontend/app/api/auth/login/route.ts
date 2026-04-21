import { NextRequest, NextResponse } from "next/server";
import {
  sanitizeEmployee,
  verifyPasswordLogin,
  ensureDemoEmployees,
} from "@/lib/server/employee-store";
import { buildSessionCookie, signSession } from "@/lib/server/session";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    await ensureDemoEmployees();
    const { username, password } = await req.json();
    if (!username || !password) {
      return NextResponse.json(
        { error: "username and password required" },
        { status: 400 }
      );
    }

    const employee = await verifyPasswordLogin(username, password);
    if (!employee) {
      return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
    }

    const token = await signSession({
      sub: employee.employee_id,
      username: employee.username,
      role: employee.role || "employee",
      employee_tag: employee.employee_tag,
    });

    const response = NextResponse.json({
      success: true,
      employee: sanitizeEmployee(employee),
    });
    const cookie = buildSessionCookie(token);
    response.cookies.set(cookie.name, cookie.value, cookie.options);
    return response;
  } catch (error: any) {
    console.error("login error:", error);
    return NextResponse.json(
      { error: error.message || "login failed" },
      { status: 500 }
    );
  }
}

