// scripts/test-nildb-storage.ts
// End-to-end test for the production NilDB storage layer
// Run with: npx tsx scripts/test-nildb-storage.ts

import {
    isNillionConfigured,
    ensureCompanyCollections,
    createPayrollRun,
    listPayrollRuns,
    getPayrollRun,
    updatePayrollRunStatus,
    createVoucherBatch,
    listVouchersByEpoch,
    upsertCompanyMeta,
    getCompanyMeta,
    createEmployees,
    listActiveEmployees,
} from "../lib/server/nillion-server";

const TEST_COMPANY = "test_company_" + Date.now().toString(36);
const TEST_RUN_ID = "run_test_" + Date.now().toString(36);
const TEST_EPOCH = Math.floor(Date.now() / 1000).toString();

async function test(name: string, fn: () => Promise<void>) {
    try {
        await fn();
        console.log(`✅ ${name}`);
    } catch (err: any) {
        console.error(`❌ ${name}: ${err.message}`);
        if (err.stack) console.error("   ", err.stack.split("\n").slice(1, 3).join("\n   "));
    }
}

async function main() {
    console.log("═══════════════════════════════════════════════════");
    console.log("  NilDB Storage Layer — End-to-End Tests");
    console.log("═══════════════════════════════════════════════════");
    console.log(`  Company: ${TEST_COMPANY}`);
    console.log(`  Run ID:  ${TEST_RUN_ID}`);
    console.log(`  Epoch:   ${TEST_EPOCH}`);
    console.log("═══════════════════════════════════════════════════\n");

    // ── Test 0: Config check ────────────────────────────────────────
    await test("0. NilDB is configured", async () => {
        if (!isNillionConfigured()) {
            throw new Error("NILLION_ORG_SECRET_KEY or NEXT_PUBLIC_NILLION_ORG_SECRET_KEY not set");
        }
    });

    // ── Test 1: Create collections ──────────────────────────────────
    let colls: any;
    await test("1. ensureCompanyCollections", async () => {
        colls = await ensureCompanyCollections(TEST_COMPANY);
        console.log("   Collections:", JSON.stringify(colls, null, 2));
        if (!colls.meta || !colls.employees || !colls.payrollRuns || !colls.vouchers) {
            throw new Error("Missing collection IDs");
        }
    });

    // ── Test 2: Company Meta ────────────────────────────────────────
    await test("2a. upsertCompanyMeta (create)", async () => {
        await upsertCompanyMeta(TEST_COMPANY, {
            escrowContractAddress: "0xTEST_ESCROW",
            payrollFrequency: "monthly",
            currentEpoch: TEST_EPOCH,
        });
    });

    await test("2b. getCompanyMeta", async () => {
        const meta = await getCompanyMeta(TEST_COMPANY);
        console.log("   Meta:", JSON.stringify(meta, null, 2)?.slice(0, 300));
        if (!meta) throw new Error("Company meta not found after upsert");
    });

    // ── Test 3: Employees ───────────────────────────────────────────
    await test("3a. createEmployees", async () => {
        await createEmployees(TEST_COMPANY, [
            { employeeTag: "tag_alice_" + Date.now(), salaryPolicy: "5000" },
            { employeeTag: "tag_bob_" + Date.now(), salaryPolicy: "6000" },
        ]);
    });

    await test("3b. listActiveEmployees", async () => {
        const result = await listActiveEmployees(TEST_COMPANY);
        console.log("   listActiveEmployees raw type:", typeof result);
        console.log("   listActiveEmployees raw keys:", Object.keys(result || {}));
        const str = JSON.stringify(result, null, 2);
        console.log("   listActiveEmployees raw:", str?.slice(0, 500));
    });

    // ── Test 4: Payroll Runs ────────────────────────────────────────
    const testCommitments = [
        "12345678901234567890",
        "98765432109876543210",
        "55555555555555555555",
    ];

    await test("4a. createPayrollRun (with commitments)", async () => {
        const result = await createPayrollRun(TEST_COMPANY, {
            runId: TEST_RUN_ID,
            epoch: TEST_EPOCH,
            merkleRoot: "111222333444555666",
            commitmentCount: testCommitments.length,
            commitments: testCommitments,
            status: "generated",
        });
        console.log("   createPayrollRun result type:", typeof result);
        console.log("   createPayrollRun result:", JSON.stringify(result, null, 2)?.slice(0, 300));
    });

    await test("4b. createPayrollRun (idempotent — should skip)", async () => {
        const result = await createPayrollRun(TEST_COMPANY, {
            runId: TEST_RUN_ID,
            epoch: TEST_EPOCH,
            merkleRoot: "111222333444555666",
            commitmentCount: testCommitments.length,
            commitments: testCommitments,
            status: "generated",
        });
        console.log("   Idempotent result:", JSON.stringify(result, null, 2)?.slice(0, 300));
    });

    await test("4c. listPayrollRuns", async () => {
        const result = await listPayrollRuns(TEST_COMPANY);
        console.log("   listPayrollRuns raw type:", typeof result);
        console.log("   listPayrollRuns raw keys:", Object.keys(result || {}));
        const str = JSON.stringify(result, null, 2);
        console.log("   listPayrollRuns raw (first 1000 chars):", str?.slice(0, 1000));

        // Try to parse like the merkle-tree API does
        const allRuns: any[] = [];
        if (Array.isArray(result)) {
            allRuns.push(...result);
        } else if (result && typeof result === "object") {
            for (const [key, nodeResult] of Object.entries(result)) {
                console.log(`   Node ${key}: type=${typeof nodeResult}, isArray=${Array.isArray(nodeResult)}`);
                if (Array.isArray(nodeResult)) {
                    allRuns.push(...nodeResult);
                } else if (nodeResult && typeof nodeResult === "object") {
                    const nr = nodeResult as any;
                    if (Array.isArray(nr.data)) {
                        allRuns.push(...nr.data);
                    } else if (nr.run_id || nr._id) {
                        allRuns.push(nr);
                    }
                }
            }
        }
        console.log(`   Parsed ${allRuns.length} runs`);
        if (allRuns.length > 0) {
            console.log("   First run:", JSON.stringify(allRuns[0], null, 2)?.slice(0, 500));
            console.log("   Has commitments:", Array.isArray(allRuns[0]?.commitments), "count:", allRuns[0]?.commitments?.length);
        }
        if (allRuns.length === 0) {
            throw new Error("listPayrollRuns returned 0 runs after parsing!");
        }
    });

    await test("4d. getPayrollRun", async () => {
        const run = await getPayrollRun(TEST_COMPANY, TEST_RUN_ID);
        console.log("   getPayrollRun result type:", typeof run);
        console.log("   getPayrollRun result:", JSON.stringify(run, null, 2)?.slice(0, 500));
        if (!run) throw new Error("getPayrollRun returned null");
        const r = run as any;
        if (!r.commitments || !Array.isArray(r.commitments)) {
            console.log("   ⚠ commitments field missing or not array!");
        } else {
            console.log(`   ✓ commitments has ${r.commitments.length} entries`);
        }
    });

    await test("4e. updatePayrollRunStatus", async () => {
        await updatePayrollRunStatus(TEST_COMPANY, TEST_RUN_ID, "committed", "0xTEST_TX_HASH");
    });

    await test("4f. getPayrollRun (verify update)", async () => {
        const run = await getPayrollRun(TEST_COMPANY, TEST_RUN_ID);
        const r = run as any;
        if (r?.status !== "committed") {
            throw new Error(`Expected status 'committed', got '${r?.status}'`);
        }
        console.log(`   ✓ Status is now '${r.status}', tx_hash='${r.tx_hash}'`);
    });

    // ── Test 5: Vouchers ────────────────────────────────────────────
    await test("5a. createVoucherBatch", async () => {
        await createVoucherBatch(TEST_COMPANY, [
            {
                commitment: "commit_alice_" + Date.now(),
                employeeTag: "tag_alice",
                amount: "5000",
                nonce: "nonce_alice_123",
                epoch: TEST_EPOCH,
                runId: TEST_RUN_ID,
                employerAddress: "test_employer",
            },
            {
                commitment: "commit_bob_" + Date.now(),
                employeeTag: "tag_bob",
                amount: "6000",
                nonce: "nonce_bob_456",
                epoch: TEST_EPOCH,
                runId: TEST_RUN_ID,
                employerAddress: "test_employer",
            },
        ]);
    });

    await test("5b. listVouchersByEpoch", async () => {
        const result = await listVouchersByEpoch(TEST_COMPANY, TEST_EPOCH);
        console.log("   listVouchersByEpoch raw type:", typeof result);
        console.log("   listVouchersByEpoch raw:", JSON.stringify(result, null, 2)?.slice(0, 500));
    });

    // ── Summary ─────────────────────────────────────────────────────
    console.log("\n═══════════════════════════════════════════════════");
    console.log("  Tests Complete");
    console.log("═══════════════════════════════════════════════════\n");
}

main().catch((err) => {
    console.error("\n💥 Test suite failed:", err);
    process.exit(1);
});
