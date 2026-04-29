import { NextResponse } from "next/server";
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
} from "@/lib/server/nillion-server";

export const runtime = "nodejs";

const TEST_COMPANY = "test_" + Date.now().toString(36);
const TEST_RUN_ID = "run_test_" + Date.now().toString(36);
const TEST_EPOCH = Math.floor(Date.now() / 1000).toString();

interface TestResult {
    name: string;
    passed: boolean;
    error?: string;
    data?: any;
}

async function runTest(name: string, fn: () => Promise<any>): Promise<TestResult> {
    try {
        const data = await fn();
        return { name, passed: true, data };
    } catch (err: any) {
        return { name, passed: false, error: err.message };
    }
}

export async function GET() {
    const results: TestResult[] = [];

    console.log("═══════════════════════════════════════════════════");
    console.log("  NilDB Storage Layer — E2E Tests");
    console.log(`  Company: ${TEST_COMPANY}`);
    console.log(`  Run ID:  ${TEST_RUN_ID}`);
    console.log(`  Epoch:   ${TEST_EPOCH}`);
    console.log("═══════════════════════════════════════════════════\n");

    // 0. Config check
    results.push(await runTest("0. NilDB configured", async () => {
        if (!isNillionConfigured()) throw new Error("Not configured");
        return true;
    }));

    // 1. Collections
    let colls: any;
    results.push(await runTest("1. ensureCompanyCollections", async () => {
        colls = await ensureCompanyCollections(TEST_COMPANY);
        console.log("[TEST] Collections:", JSON.stringify(colls));
        if (!colls.meta || !colls.employees || !colls.payrollRuns || !colls.vouchers) {
            throw new Error("Missing collection IDs");
        }
        return colls;
    }));

    // 2. Company Meta
    results.push(await runTest("2a. upsertCompanyMeta", async () => {
        await upsertCompanyMeta(TEST_COMPANY, {
            escrowContractAddress: "0xTEST",
            payrollFrequency: "monthly",
            currentEpoch: TEST_EPOCH,
        });
        return true;
    }));

    results.push(await runTest("2b. getCompanyMeta", async () => {
        const meta = await getCompanyMeta(TEST_COMPANY);
        console.log("[TEST] Meta:", JSON.stringify(meta)?.slice(0, 300));
        if (!meta) throw new Error("Meta not found");
        return meta;
    }));

    // 3. Employees
    results.push(await runTest("3a. createEmployees", async () => {
        await createEmployees(TEST_COMPANY, [
            { employeeTag: "alice_" + Date.now(), salary: "5000" },
            { employeeTag: "bob_" + Date.now(), salary: "6000" },
        ]);
        return true;
    }));

    results.push(await runTest("3b. listActiveEmployees", async () => {
        const result = await listActiveEmployees(TEST_COMPANY);
        console.log("[TEST] listActiveEmployees raw type:", typeof result);
        console.log("[TEST] listActiveEmployees raw:", JSON.stringify(result)?.slice(0, 500));
        return result;
    }));

    // 4. Payroll Runs
    const commitments = ["12345678901234567890", "98765432109876543210", "55555555555555555555"];

    results.push(await runTest("4a. createPayrollRun (with commitments)", async () => {
        const result = await createPayrollRun(TEST_COMPANY, {
            runId: TEST_RUN_ID,
            epoch: TEST_EPOCH,
            merkleRoot: "111222333444555666",
            commitmentCount: commitments.length,
            commitments,
            status: "generated",
        });
        console.log("[TEST] createPayrollRun result:", JSON.stringify(result)?.slice(0, 300));
        return result;
    }));

    results.push(await runTest("4b. createPayrollRun (idempotent)", async () => {
        const result = await createPayrollRun(TEST_COMPANY, {
            runId: TEST_RUN_ID,
            epoch: TEST_EPOCH,
            merkleRoot: "111222333444555666",
            commitmentCount: commitments.length,
            commitments,
            status: "generated",
        });
        console.log("[TEST] Idempotent result:", JSON.stringify(result)?.slice(0, 300));
        return result;
    }));

    results.push(await runTest("4c. listPayrollRuns ⭐", async () => {
        const result = await listPayrollRuns(TEST_COMPANY);
        console.log("[TEST] listPayrollRuns raw type:", typeof result);
        console.log("[TEST] listPayrollRuns raw keys:", Object.keys(result || {}));
        console.log("[TEST] listPayrollRuns FULL:", JSON.stringify(result, null, 2)?.slice(0, 2000));

        // Parse like the merkle-tree API
        const allRuns: any[] = [];
        if (Array.isArray(result)) {
            allRuns.push(...result);
        } else if (result && typeof result === "object") {
            for (const [key, nodeResult] of Object.entries(result)) {
                console.log(`[TEST]   Node ${key}: type=${typeof nodeResult}, isArray=${Array.isArray(nodeResult)}`);
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
        console.log(`[TEST] Parsed ${allRuns.length} runs`);
        if (allRuns.length > 0) {
            console.log("[TEST] First run:", JSON.stringify(allRuns[0])?.slice(0, 500));
            console.log("[TEST] Has commitments:", Array.isArray(allRuns[0]?.commitments));
        }
        if (allRuns.length === 0) {
            throw new Error("0 runs parsed from listPayrollRuns!");
        }
        return { parsed: allRuns.length, firstRun: allRuns[0] };
    }));

    results.push(await runTest("4d. getPayrollRun", async () => {
        const run = await getPayrollRun(TEST_COMPANY, TEST_RUN_ID);
        console.log("[TEST] getPayrollRun:", JSON.stringify(run)?.slice(0, 500));
        if (!run) throw new Error("Run not found");
        return run;
    }));

    results.push(await runTest("4e. updatePayrollRunStatus", async () => {
        await updatePayrollRunStatus(TEST_COMPANY, TEST_RUN_ID, "committed", "0xTEST_TX");
        return true;
    }));

    results.push(await runTest("4f. verify update", async () => {
        const run = await getPayrollRun(TEST_COMPANY, TEST_RUN_ID);
        const r = run as any;
        if (r?.status !== "committed") throw new Error(`Expected 'committed', got '${r?.status}'`);
        return { status: r.status, tx_hash: r.tx_hash };
    }));

    // 5. Vouchers
    results.push(await runTest("5a. createVoucherBatch", async () => {
        await createVoucherBatch(TEST_COMPANY, [
            { commitment: "c1_" + Date.now(), employeeTag: "alice", amount: "5000", nonce: "n1", epoch: TEST_EPOCH, runId: TEST_RUN_ID, employerAddress: "test_employer" },
            { commitment: "c2_" + Date.now(), employeeTag: "bob", amount: "6000", nonce: "n2", epoch: TEST_EPOCH, runId: TEST_RUN_ID, employerAddress: "test_employer" },
        ]);
        return true;
    }));

    results.push(await runTest("5b. listVouchersByEpoch", async () => {
        const result = await listVouchersByEpoch(TEST_COMPANY, TEST_EPOCH);
        console.log("[TEST] listVouchersByEpoch:", JSON.stringify(result)?.slice(0, 500));
        return result;
    }));

    // Summary
    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;

    return NextResponse.json({
        summary: `${passed} passed, ${failed} failed`,
        results,
    });
}
