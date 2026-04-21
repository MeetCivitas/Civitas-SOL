import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  getEmployeeProfile,
  sanitizeEmployee,
} from "@/lib/server/employee-store";
import { SESSION_COOKIE, verifySession } from "@/lib/server/session";

export const runtime = "nodejs";

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  const session = await verifySession(token);
  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  const employee = await getEmployeeProfile(session.sub);
  if (!employee) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  return NextResponse.json({
    authenticated: true,
    session,
    employee: sanitizeEmployee(employee),
  });
}

