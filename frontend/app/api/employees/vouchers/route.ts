import { NextRequest, NextResponse } from "next/server";
import {
  isNillionConfigured,
  listVouchersByEmployee,
  extractRecords,
  getPlaintextClient,
  withRetry,
  nameToUUID,
} from "@/lib/server/nillion-server";

export const runtime = "nodejs";

const PROFILE_COLLECTION_NAME = "civitas_employer_profiles";

/**
 * GET /api/employees/vouchers?employeeTag=...
 *
 * Fetches vouchers from NilDB for a specific employee (by tag).
 * It dynamically looks up all registered company IDs in the profile collection
 * and queries each company's vouchers collection.
 */
export async function GET(req: NextRequest) {
  try {
    if (!isNillionConfigured()) {
      return NextResponse.json({ success: false, error: "NilDB not configured" }, { status: 503 });
    }

    const { searchParams } = new URL(req.url);
    const employeeTag = searchParams.get("employeeTag");

    if (!employeeTag) {
      return NextResponse.json({ success: false, error: "Missing employeeTag" }, { status: 400 });
    }

    const client = await getPlaintextClient();

    // 1. Fetch all known company IDs from the employer profiles collection
    let companyIdsToTry: string[] = ["default"];
    try {
      const profileCollectionId = nameToUUID(PROFILE_COLLECTION_NAME);
      const profilesResult = await withRetry(
        () => client.findData({ collection: profileCollectionId, filter: {} }),
        "getAllProfiles"
      );
      const profiles = extractRecords(profilesResult);
      const discoveredIds = profiles.map((p: any) => p.company_id).filter(Boolean);
      companyIdsToTry = [...new Set(["default", ...discoveredIds])];
    } catch (err: any) {
      console.warn("[Vouchers] Failed to fetch employer profiles for company discovery:", err.message?.slice(0, 100));
    }

    console.log(`[Vouchers] Scanning ${companyIdsToTry.length} companies for employeeTag ${employeeTag.slice(0, 10)}...`);

    const { listPayrollRuns } = await import("@/lib/server/nillion-server");
    const runCache: Record<string, { merkleRoot?: string; employerAddress?: string }> = {};

    // Fan out across companies in parallel. NilDB calls are network-bound,
    // so doing them serially across N companies = N× wall-clock for no gain.
    const perCompanyResults = await Promise.all(
      companyIdsToTry.map(async (cid) => {
        try {
          const response = await listVouchersByEmployee(cid, employeeTag);
          const records = extractRecords(response);
          if (records.length === 0) return [] as any[];

          console.log(`[Vouchers] Found ${records.length} vouchers in company ${cid}`);

          // Enrich with run metadata; best-effort, runs alongside other companies.
          try {
            const runResp = await listPayrollRuns(cid);
            for (const run of extractRecords(runResp)) {
              if (run.run_id) {
                runCache[run.run_id] = {
                  merkleRoot: run.merkle_root || "",
                  employerAddress: run.employer_address || "",
                };
              }
            }
          } catch { /* non-fatal */ }

          return records;
        } catch {
          // Collection may not exist yet for this company; skip silently.
          return [] as any[];
        }
      })
    );

    const allVouchers: any[] = perCompanyResults.flat();

    const vouchers = allVouchers.map((r: any) => {
      const run = runCache[r.run_id] ?? {};
      return {
        commitment: r.commitment || "",
        employeeTag: r.employee_tag || "",
        amount: r.amount || "0",
        epoch: r.epoch || "",
        voucherNonce: r.nonce || "",
        nullifier: r.nullifier || "",
        runId: r.run_id || "",
        status: r.status || "pending",
        claimedAt: r.claimed_at || "",
        createdAt: r.created_at || "",
        claimTxHash: r.tx_hash || "",
        merkleRoot: run.merkleRoot || r.merkle_root || "",
        employerAddress: r.employer_address || run.employerAddress || "",
      };
    });

    return NextResponse.json({ success: true, vouchers });
  } catch (error: any) {
    console.error("[GET /api/employees/vouchers] error:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Failed to fetch vouchers" },
      { status: 500 }
    );
  }
}
