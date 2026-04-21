import { NextRequest, NextResponse } from "next/server";
import { registerEmployeeByTag } from "@/lib/server/employee-store";
import { isNillionConfigured, createEmployees, ensureCompanyCollections } from "@/lib/server/nillion-server";

export const runtime = "nodejs";

/**
 * POST /api/employer/employees/create
 *
 * Employer registers an employee by their self-generated tag.
 * The employee already created their credential client-side and
 * shared only the employee_tag with the employer.
 *
 * Body: { employee_tag: string, name?: string, salary?: number, org_id?: string }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { employee_tag, name, salary, org_id } = body;

    if (!employee_tag) {
      return NextResponse.json(
        { error: "employee_tag is required" },
        { status: 400 }
      );
    }

    // Normalize the tag: accept both decimal strings (from Poseidon hash) and 0x hex strings
    let normalizedTag = employee_tag.toString().trim();
    if (normalizedTag.startsWith("0x") || normalizedTag.startsWith("0X")) {
      try {
        // Convert hex → decimal string
        normalizedTag = BigInt(normalizedTag).toString();
      } catch {
        return NextResponse.json(
          { error: "employee_tag is not a valid hex number" },
          { status: 400 }
        );
      }
    } else {
      // Validate it's a valid decimal number (Poseidon hash)
      try {
        BigInt(normalizedTag);
      } catch {
        return NextResponse.json(
          { error: "employee_tag must be a valid Poseidon hash (decimal or 0x-hex number)" },
          { status: 400 }
        );
      }
    }

    const orgId = org_id || "default_org";
    const employee = await registerEmployeeByTag(
      normalizedTag,
      name,
      salary,
      orgId,
    );

    console.log("[employer/create] Registered employee by tag:", normalizedTag.slice(0, 16) + "...");

    return NextResponse.json({
      success: true,
      employee: {
        employee_id: employee.employee_id,
        username: employee.username,
        employee_tag: employee.employee_tag,
        status: employee.status,
      },
    });
  } catch (error: any) {
    console.error("Create employee error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to register employee" },
      { status: 500 }
    );
  }
}
