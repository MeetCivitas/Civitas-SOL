import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/server/session";

export async function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname || "/";
  const isEmployees = pathname.startsWith("/employees");
  const isAuditors = pathname.startsWith("/auditors");

  if (!isEmployees && !isAuditors) {
    return NextResponse.next();
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const session = await verifySession(token);
  if (!session) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  if (isEmployees && session.role !== "employee") {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  if (isAuditors && session.role !== "auditor") {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/employees/:path*", "/auditors/:path*"],
};

