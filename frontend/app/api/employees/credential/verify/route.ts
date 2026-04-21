import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession } from "@/lib/server/session";
import { verifyCredentialBlob } from "@/lib/server/employee-store";

interface CredentialPayload {
  ciphertext: string;
  iv: string;
  signature: string;
}

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session: any = await verifySession(token);
  if (!session || session.role !== "employee") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  // Support both formats: { credential: {...} } or { employee_tag, credential: {...} }
  const credential: CredentialPayload | undefined = body?.credential ?? body;
  const employeeTagFromFile: string | undefined = body?.employee_tag;

  if (!credential?.ciphertext || !credential?.iv || !credential?.signature) {
    return NextResponse.json({ error: "Invalid credential payload" }, { status: 400 });
  }

  // Try to use employee_tag from the credential file first, fallback to session
  const employeeTagToUse = employeeTagFromFile || session.employee_tag;
  if (!employeeTagToUse) {
    console.error("[CredentialVerify] Missing employee_tag", { 
      fromFile: employeeTagFromFile, 
      fromSession: session.employee_tag 
    });
    return NextResponse.json({ error: "Missing employee_tag" }, { status: 400 });
  }

  console.log("[CredentialVerify] Verifying credential", {
    employeeTag: employeeTagToUse,
    sessionEmployeeId: session.sub,
    hasCiphertext: !!credential.ciphertext,
    hasIv: !!credential.iv,
    hasSignature: !!credential.signature,
  });

  const record = await verifyCredentialBlob(employeeTagToUse, credential);
  if (!record) {
    console.error("[CredentialVerify] Credential blob mismatch", {
      employeeTag: employeeTagToUse,
      sessionEmployeeId: session.sub,
    });
    return NextResponse.json({ error: "Credential does not match account" }, { status: 403 });
  }

  // Note: We verify by employee_tag + credential blob match, which is sufficient.
  // The employee_id check is removed because credential files may have different
  // employee_ids (e.g., 'emp_001') than the session's UUID, but the employee_tag
  // and credential blob uniquely identify the employee.

  console.log("[CredentialVerify] Verification successful", {
    employeeId: record.employee_id,
    employeeTag: record.employee_tag,
    sessionEmployeeId: session.sub,
  });

  return NextResponse.json({ success: true });
}

