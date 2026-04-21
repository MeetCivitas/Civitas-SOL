import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession } from "@/lib/server/session";
import { getEmployeeByTag, upsertEmployees } from "@/lib/server/employee-store";
import type { EmployeeRecord } from "@/lib/server/employee-store";

export const runtime = "nodejs";

interface CredentialFile {
  employee_id: string;
  employee_tag: string;
  credential: {
    ciphertext: string;
    iv: string;
    signature: string;
  };
  // Optional fields that might be in the file
  username?: string;
  name?: string;
  email?: string;
  org_id?: string;
}

export async function POST(req: NextRequest) {
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
    const formData = await req.formData();
    const files = formData.getAll("files") as File[];
    const orgId = (formData.get("org_id") as string) || session.sub || "demo_org";

    if (!files || files.length === 0) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    const imported: Array<{
      employee_id: string;
      employee_tag: string;
      username?: string;
      name?: string;
      email?: string;
      status: "new" | "existing" | "duplicate";
    }> = [];

    for (const file of files) {
      try {
        const text = await file.text();
        const credentialFile: CredentialFile = JSON.parse(text);

        // Validate required fields
        if (!credentialFile.employee_id || !credentialFile.employee_tag || !credentialFile.credential) {
          imported.push({
            employee_id: credentialFile.employee_id || "unknown",
            employee_tag: credentialFile.employee_tag || "unknown",
            status: "duplicate",
          });
          continue;
        }

        // Check if employee already exists
        const existing = await getEmployeeByTag(credentialFile.employee_tag);
        if (existing) {
          imported.push({
            employee_id: credentialFile.employee_id,
            employee_tag: credentialFile.employee_tag,
            username: existing.username,
            name: existing.profile?.name,
            email: existing.profile?.email,
            status: "existing",
          });
          continue;
        }

        // Create provisional employee record
        const username = credentialFile.username || credentialFile.email?.split("@")[0] || `emp_${credentialFile.employee_id.slice(0, 8)}`;
        const now = new Date().toISOString();

        const provisionalEmployee: EmployeeRecord = {
          employee_id: credentialFile.employee_id,
          username,
          username_normalized: username.toLowerCase().trim(),
          password_hash: "", // Will be set when activated
          employee_tag: credentialFile.employee_tag,
          credential_nonce: "", // Not available from credential file
          zkpass_credential: credentialFile.credential,
          org_id: orgId,
          vouchers: [],
          credential_vouchers: [],
          role: "employee",
          profile: {
            name: credentialFile.name,
            email: credentialFile.email,
            role: "employee",
          },
          created_at: now,
          updated_at: now,
        };
        
        // Mark as provisional by adding status field
        (provisionalEmployee as any).status = "provisional";

        await upsertEmployees([provisionalEmployee]);

        imported.push({
          employee_id: credentialFile.employee_id,
          employee_tag: credentialFile.employee_tag,
          username,
          name: credentialFile.name,
          email: credentialFile.email,
          status: "new",
        });
      } catch (err: any) {
        console.error(`Error processing file ${file.name}:`, err);
        imported.push({
          employee_id: "error",
          employee_tag: "error",
          status: "duplicate",
        });
      }
    }

    return NextResponse.json({
      success: true,
      imported: imported.length,
      employees: imported,
    });
  } catch (error: any) {
    console.error("Import error:", error);
    return NextResponse.json(
      { error: error.message || "Import failed" },
      { status: 500 }
    );
  }
}

