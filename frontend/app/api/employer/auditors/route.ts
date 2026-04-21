import { NextRequest, NextResponse } from "next/server";
import {
    registerAuditorByTag,
    listAllAuditors,
    sanitizeEmployee,
    getAuditorByTag,
    updateAuditorEmail,
    revokeAuditor,
} from "@/lib/server/employee-store";

export const runtime = "nodejs";

/**
 * GET /api/employer/auditors
 * Returns all auditors from the persistent identity store.
 */
export async function GET(_req: NextRequest) {
    try {
        const auditors = await listAllAuditors();
        const sanitized = auditors.map(sanitizeEmployee).filter(Boolean);
        return NextResponse.json({ success: true, auditors: sanitized });
    } catch (error: any) {
        console.error("List auditors error:", error);
        return NextResponse.json(
            { error: error.message || "Failed to list auditors" },
            { status: 500 }
        );
    }
}

/**
 * POST /api/employer/auditors
 * Registers a new auditor by their public tag.
 *
 * Body: { auditor_tag: string, name?: string, email?: string, org_id?: string }
 */
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { auditor_tag, name, email, org_id } = body;

        if (!auditor_tag) {
            return NextResponse.json(
                { error: "auditor_tag is required" },
                { status: 400 }
            );
        }

        // Normalize: accept 0x hex or decimal Poseidon hash
        let normalizedTag = auditor_tag.toString().trim();
        if (normalizedTag.startsWith("0x") || normalizedTag.startsWith("0X")) {
            try {
                normalizedTag = BigInt(normalizedTag).toString();
            } catch {
                return NextResponse.json(
                    { error: "auditor_tag is not a valid hex number" },
                    { status: 400 }
                );
            }
        } else {
            try {
                BigInt(normalizedTag);
            } catch {
                return NextResponse.json(
                    { error: "auditor_tag must be a valid Poseidon hash (decimal or 0x-hex number)" },
                    { status: 400 }
                );
            }
        }

        const orgId = org_id || "default_org";
        const auditor = await registerAuditorByTag(normalizedTag, name, orgId);

        // Store optional email via the employee-store helper (avoids direct identityStore import)
        if (email) {
            await updateAuditorEmail(auditor.employee_id, email);
        }

        console.log("[employer/auditors] Registered auditor:", normalizedTag.slice(0, 16) + "...");

        return NextResponse.json({
            success: true,
            auditor: sanitizeEmployee(auditor),
        });
    } catch (error: any) {
        console.error("Create auditor error:", error);
        return NextResponse.json(
            { error: error.message || "Failed to register auditor" },
            { status: 500 }
        );
    }
}

/**
 * DELETE /api/employer/auditors?tag=<auditor_tag>
 * Soft-deletes an auditor (status → "terminated").
 */
export async function DELETE(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const tag = searchParams.get("tag");

        if (!tag) {
            return NextResponse.json({ error: "tag query param required" }, { status: 400 });
        }

        const auditor = await getAuditorByTag(tag);
        if (!auditor) {
            return NextResponse.json({ error: "Auditor not found" }, { status: 404 });
        }

        const ok = await revokeAuditor(tag);
        if (!ok) {
            return NextResponse.json({ error: "Could not revoke auditor" }, { status: 500 });
        }

        console.log("[employer/auditors] Revoked auditor tag:", tag.slice(0, 16) + "...");
        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error("Delete auditor error:", error);
        return NextResponse.json(
            { error: error.message || "Failed to revoke auditor" },
            { status: 500 }
        );
    }
}
