import { NextRequest, NextResponse } from "next/server";
import {
  isNillionConfigured,
  listVouchersByEmployee,
  extractRecords,
  getPlaintextClient,
  withRetry,
  nameToUUID,
  unwrapNilDBField,
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

    // ── On-chain run status check ───────────────────────────────────────
    // The generate route writes voucher rows to NilDB BEFORE the wizard's
    // commit step lands the payroll_run PDA on-chain. If the wizard's commit
    // failed/timed out (or the user closed it), the voucher exists in NilDB
    // but the run never finalized, and Claim will explode with "not on-chain
    // yet". Verify each unique run once here so the UI can show a clear
    // "awaiting commit" state instead of letting the user click into a wall.
    type RunStatus = "committed" | "missing" | "pending" | "settled" | "unknown";
    const runStatusCache = new Map<string, RunStatus>();
    const uniqueRuns = Array.from(
      new Set(
        allVouchers
          .map((r) => ({ runId: r.run_id, employer: r.employer_address }))
          .filter((x) => x.runId && x.employer)
          .map((x) => `${x.runId}|${x.employer}`),
      ),
    );

    if (uniqueRuns.length > 0) {
      const { Connection, PublicKey } = await import("@solana/web3.js");
      const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";
      const PROGRAM_ID_STR = process.env.NEXT_PUBLIC_CIVITAS_PROGRAM_ID;
      if (PROGRAM_ID_STR) {
        const PROGRAM_ID = new PublicKey(PROGRAM_ID_STR);
        const conn = new Connection(RPC, "confirmed");
        const STATUS_OFFSET = 8 + 16 + 32 + 8 + 32 + 32 + 4 + 4 + 4;
        await Promise.all(
          uniqueRuns.map(async (key) => {
            const [runId, employer] = key.split("|");
            try {
              const ridHex = runId.replace(/-/g, "");
              const ridBytes = Buffer.from(ridHex, "hex");
              const owner = new PublicKey(employer);
              const [pda] = PublicKey.findProgramAddressSync(
                [Buffer.from("run"), owner.toBuffer(), ridBytes],
                PROGRAM_ID,
              );
              const info = await conn.getAccountInfo(pda, "confirmed");
              if (!info) {
                runStatusCache.set(key, "missing");
                return;
              }
              const byte = info.data.length > STATUS_OFFSET ? info.data[STATUS_OFFSET] : -1;
              const map: Record<number, RunStatus> = { 0: "pending", 1: "committed", 2: "settled" };
              runStatusCache.set(key, map[byte] || "unknown");
            } catch (err: any) {
              console.warn(`[Vouchers] runStatus check failed for ${runId.slice(0, 8)}…:`, err.message?.slice(0, 80));
              runStatusCache.set(key, "unknown");
            }
          }),
        );
      }
    }

    const vouchers = allVouchers.map((r: any) => {
      const run = runCache[r.run_id] ?? {};
      // Defensively unwrap amount: NilDB plaintext reads may return scalars OR
      // %allot/%share wrappers. An object would Number-coerce to NaN → "0.00".
      const rawAmount = r.amount;
      const amountStr = unwrapNilDBField(rawAmount) || "0";

      // Diagnostic: tiny amounts almost certainly mean the row was committed
      // before the salary normalization fix (display USDC stored as raw "5"
      // instead of "5000000" micro). These vouchers are unrecoverable — the
      // commitment hash is bound to the wrong amount on-chain.
      const numAmount = Number(amountStr);
      const looksDisplayUsdc = Number.isFinite(numAmount) && numAmount > 0 && numAmount < 1_000;

      if (process.env.NODE_ENV !== "production") {
        if (typeof rawAmount === "object" && rawAmount !== null) {
          console.log(
            `[Vouchers] unwrapped amount for ${String(r.employee_tag).slice(0, 10)}…: ${JSON.stringify(rawAmount)} → ${amountStr}`,
          );
        }
        if (looksDisplayUsdc) {
          console.warn(
            `[Vouchers] suspiciously small amount on voucher ${String(r.commitment).slice(0, 12)}… (run ${String(r.run_id).slice(0, 8)}…): "${amountStr}". Likely pre-normalization data — voucher unrecoverable.`,
          );
        }
      }

      const runKey = `${r.run_id}|${r.employer_address || run.employerAddress || ""}`;
      const runStatus = runStatusCache.get(runKey) || "unknown";

      return {
        commitment: r.commitment || "",
        employeeTag: r.employee_tag || "",
        amount: amountStr,
        epoch: r.epoch || "",
        voucherNonce: r.nonce || "",
        nullifier: r.nullifier || "",
        runId: r.run_id || "",
        status: r.status || "pending",
        runStatus,
        amountIsLikelyStale: looksDisplayUsdc,
        claimedAt: r.claimed_at || "",
        createdAt: r.created_at || "",
        claimTxHash: r.tx_hash || "",
        merkleRoot: run.merkleRoot || r.merkle_root || "",
        employerAddress: r.employer_address || run.employerAddress || "",
      };
    });

    if (process.env.NODE_ENV !== "production") {
      const summary = vouchers.reduce(
        (acc: Record<string, number>, v: any) => {
          acc[v.runStatus] = (acc[v.runStatus] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      );
      console.log(`[Vouchers] returning ${vouchers.length} voucher(s); runStatus breakdown:`, summary);
    }

    return NextResponse.json({ success: true, vouchers });
  } catch (error: any) {
    console.error("[GET /api/employees/vouchers] error:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Failed to fetch vouchers" },
      { status: 500 }
    );
  }
}
