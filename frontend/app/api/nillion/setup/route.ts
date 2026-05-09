import { NextRequest, NextResponse } from "next/server";
import {
    ensureCollections,
    isNillionConfigured,
} from "@/lib/server/nillion-server";

export const runtime = "nodejs";

/**
 * POST /api/nillion/setup
 *
 * Initialize nilDB collections for a company.
 * Called during employer onboarding to set up encrypted data stores.
 */
export async function POST(req: NextRequest) {
    try {
        if (!isNillionConfigured()) {
            return NextResponse.json(
                {
                    success: false,
                    error: "Nillion not configured. Set NEXT_PUBLIC_NILLION_ORG_SECRET_KEY in .env.local.",
                    fallback: true,
                },
                { status: 200 }
            );
        }

        const { company_id } = await req.json();
        if (!company_id) {
            return NextResponse.json(
                { error: "company_id required" },
                { status: 400 }
            );
        }

        console.log(`[nilDB Setup] Initializing collections for company: ${company_id}`);
        const collections = await ensureCollections(company_id);

        return NextResponse.json({
            success: true,
            company_id,
            collections,
            message: "nilDB collections initialized successfully",
        });
    } catch (error: any) {
        console.error("[nilDB Setup] Failed:", error);
        return NextResponse.json(
            { error: error.message || "Collection setup failed", success: false },
            { status: 500 }
        );
    }
}
