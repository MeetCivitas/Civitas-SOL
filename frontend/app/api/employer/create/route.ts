// frontend/app/api/employer/create/route.ts
import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { provisionEmployeesFromSeeds } from "@/lib/server/employee-store";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const mode = body.mode || (Array.isArray(body.employees) ? "onboard" : "manifest");

  if (mode === "onboard") {
    try {
      if (!Array.isArray(body.employees) || body.employees.length === 0) {
        return NextResponse.json({ error: "employees array required" }, { status: 400 });
      }
      const orgId = body.org_id || "org_demo";
      const runId = body.run_id || `run_${Date.now()}`;
      const { provisioning } = await provisionEmployeesFromSeeds(body.employees, orgId, runId);

      return NextResponse.json({
        success: true,
        org_id: orgId,
        run_id: runId,
        employees: provisioning
      });
    } catch (error: any) {
      console.error("onboard error:", error);
      return NextResponse.json({ error: error.message || "onboarding failed" }, { status: 500 });
    }
  }

  if (!body.run_id || !Array.isArray(body.inputs) || body.inputs.length === 0) {
    return NextResponse.json({ error: "invalid manifest" }, { status: 400 });
  }

  const runId = body.run_id;
  const manifestsDir = "/tmp/manifests";
  if (!fs.existsSync(manifestsDir)) fs.mkdirSync(manifestsDir, { recursive: true });
  const manifestPath = path.join(manifestsDir, `${runId}.json`);
  fs.writeFileSync(manifestPath, JSON.stringify(body, null, 2), { encoding: "utf8" });

  // spawn orchestrator CLI to submit the job (local dev). This will call orchestrator/index.js submit <manifestPath>
  try {
    // Resolve orchestrator path relative to project root (works in both dev and build)
    // Try multiple possible locations
    const candidates = [
      path.resolve(process.cwd(), "..", "orchestrator", "index.js"),
      path.resolve(process.cwd(), "orchestrator", "index.js"),
      path.resolve(__dirname, "..", "..", "..", "..", "orchestrator", "index.js"),
    ];
    
const projectRoot = process.cwd();

// 2. Construct the path to your script. 
// ADJUST THE FOLDER STRUCTURE BELOW TO MATCH YOUR ACTUAL FILE SYSTEM
let orchestratorBin = path.join(projectRoot, 'orchestrator', 'index.js');

    // for (const candidate of candidates) {
    //   if (fs.existsSync(candidate)) {
    //     orchestratorBin = candidate;
    //     break;
    //   }
    // }
    
    if (!orchestratorBin) {
      return NextResponse.json({ error: "orchestrator not found" }, { status: 500 });
    }

    const child = spawn("node", ["../orchestrator/index.js", "submit", manifestPath], { env: process.env });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", d => (stdout += d.toString()));
    child.stderr?.on("data", d => (stderr += d.toString()));

    const exitCode: number = await new Promise((resolve, reject) => {
      child.on("close", code => resolve(code ?? 0));
      child.on("error", err => reject(err));
    });

    if (exitCode !== 0) {
      console.error("orchestrator stderr:", stderr);
      return NextResponse.json({ error: "orchestrator failed", details: stderr }, { status: 500 });
    }

    // expect orchestrator prints job id as JSON on stdout (e.g. {"job_id":"..."}). Try parse.
    let jobResp;
    try {
      jobResp = JSON.parse(stdout.trim());
    } catch (e) {
      jobResp = { job_id: stdout.trim() || `job-local-${runId}` };
    }

    return NextResponse.json({ ok: true, job_id: jobResp.job_id });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: "internal error", details: String(err) }, { status: 500 });
  }
}
