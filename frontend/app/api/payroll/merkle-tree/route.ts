import { NextRequest, NextResponse } from "next/server";
import {
    isNillionConfigured,
    ensureCompanyCollections,
    getPayrollRun,
    listPayrollRuns,
    getPlaintextClient,
    withRetry,
    nameToUUID,
    extractRecords
} from "@/lib/server/nillion-server";
import { listRuns as listLocalRuns, getRun as getLocalRun } from "@/lib/server/payroll-store";

export const runtime = "nodejs";

const PROFILE_COLLECTION_NAME = "civitas_employer_profiles";

/**
 * GET /api/payroll/merkle-tree?run_id=X&company_id=Y
 *
 * Returns the commitment list for a given payroll run so the client
 * can reconstruct the Merkle tree for ZK proof generation.
 *
 * It dynamically discovers other company IDs if "default" returns nothing.
 */
export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const runId = searchParams.get("run_id");
        const companyId = searchParams.get("company_id") || "default";

        // ── Try NilDB first ─────────────────────────────────────────────
        if (isNillionConfigured()) {
            let companyIdsToTry = [companyId];

            // If "default", we don't know the actual company ID, so we must fetch all known IDs
            if (companyId === "default") {
                try {
                    const client = await getPlaintextClient();
                    const profileCollectionId = nameToUUID(PROFILE_COLLECTION_NAME);
                    const profilesResult = await withRetry(
                        () => client.findData({ collection: profileCollectionId, filter: {} }),
                        "getAllProfiles"
                    );
                    const profiles = extractRecords(profilesResult);
                    const discoveredIds = profiles.map((p: any) => p.company_id).filter(Boolean);
                    companyIdsToTry = [...new Set(["default", ...discoveredIds])];
                } catch (err: any) {
                    console.warn("[MerkleTree API] Failed to fetch employer profiles:", err.message?.slice(0, 100));
                }
            }

            for (const cid of companyIdsToTry) {
                try {
                    await ensureCompanyCollections(cid);

                    if (runId) {
                        const run = await getPayrollRun(cid, runId);
                        if (run && (run as any).commitments?.length) {
                            return NextResponse.json({
                                success: true,
                                run_id: (run as any).run_id,
                                merkle_root: (run as any).merkle_root,
                                commitments: (run as any).commitments || [],
                                source: "nildb",
                            });
                        }
                    } else {
                        // Return the latest run with commitments
                        const rawResults = await listPayrollRuns(cid);
                        const allRuns = extractRecords(rawResults);

                        if (allRuns.length > 0) {
                            const seenIds = new Set<string>();
                            const uniqueRuns = allRuns
                                .filter((run: any) => {
                                    const id = run?.run_id;
                                    if (!id || seenIds.has(id)) return false;
                                    seenIds.add(id);
                                    return true;
                                })
                                .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());

                            const latestRun = uniqueRuns.find(r => r.status === "committed") || uniqueRuns[0];
                            if (latestRun && latestRun.commitments?.length) {
                                return NextResponse.json({
                                    success: true,
                                    run_id: latestRun.run_id,
                                    merkle_root: latestRun.merkle_root,
                                    commitments: latestRun.commitments || [],
                                    source: "nildb",
                                });
                            }
                        }
                    }
                } catch (err: any) {
                    // Ignore errors for individual companies and continue scanning
                }
            }
        }

        // ── Fallback: local payroll-store ────────────────────────────────
        console.log("[MerkleTree API] NilDB returned no data, falling back to local payroll-store");

        if (runId) {
            const localRun = await getLocalRun(runId);
            if (localRun) {
                const commitments = localRun.public_signals || [];
                return NextResponse.json({
                    success: true,
                    run_id: localRun.run_id,
                    merkle_root: localRun.payroll_root,
                    commitments,
                    source: "local",
                });
            }
        }

        // No run_id → return latest local run
        const localRuns = await listLocalRuns();
        if (localRuns.length > 0) {
            const latestLocal = localRuns
                .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
                .find(r => r.status === "committed") || localRuns[localRuns.length - 1];

            const commitments = latestLocal.public_signals || [];
            if (commitments.length > 0) {
                return NextResponse.json({
                    success: true,
                    run_id: latestLocal.run_id,
                    merkle_root: latestLocal.payroll_root,
                    commitments,
                    source: "local",
                });
            }
        }

        return NextResponse.json({ error: "No payroll runs found. Ask your employer to run payroll first." }, { status: 404 });
    } catch (error: any) {
        console.error("[MerkleTree API] Error:", error);
        return NextResponse.json(
            { error: error.message || "Failed to fetch Merkle tree" },
            { status: 500 }
        );
    }
}
