import { NextRequest, NextResponse } from "next/server";
import { bn128Poseidon1 as poseidonHash1 } from "@/lib/bn128-poseidon";
import {
  getEmployeeByTag,
  registerEmployeeByTag,
  registerAuditorByTag,
  getAuditorByTag,
  sanitizeEmployee,
  ensureDemoEmployees,
} from "@/lib/server/employee-store";
import { buildSessionCookie, signSession } from "@/lib/server/session";

export const runtime = "nodejs";
export const maxDuration = 60; // Vercel: allow up to 60s for NilDB handshake

function deriveTagFromNonce(nonceHex: string): string {
  return poseidonHash1(BigInt("0x" + nonceHex)).toString();
}

export async function POST(req: NextRequest) {
  try {
    // NOTE: ensureDemoEmployees() removed from hot path — it triggers a full
    // NilDB client init (token refresh + profile registration) which can take
    // 5-15s and kill the Vercel function timeout on cold starts.
    // Demo seeding only matters for local dev and can be triggered separately.
    const body = await req.json();
    const method = body.method || "tag";
    const role = body.role || "employee"; // "employee" | "auditor"

    // ── Method "tag": proves ownership of tag via credential_nonce ──
    if (method === "tag") {
      const { employee_tag, proof } = body;
      const nonce = proof?.nonce || body.credential_nonce;

      if (!nonce) {
        return NextResponse.json({ error: "credential_nonce required" }, { status: 400 });
      }

      // Derive tag from nonce — this is the ZK proof
      const derivedTag = deriveTagFromNonce(nonce);

      // If employee_tag was provided, verify it matches
      if (employee_tag && derivedTag !== employee_tag) {
        console.warn("[zk-login] Tag mismatch — derived:", derivedTag, "provided:", employee_tag);
        return NextResponse.json({ error: "proof mismatch" }, { status: 401 });
      }

      let record;

      if (role === "auditor") {
        // Auditor flow
        record = await getAuditorByTag(derivedTag);
        if (!record) {
          console.log("[zk-login] Auditor tag not found, auto-registering:", derivedTag.slice(0, 16) + "...");
          record = await registerAuditorByTag(derivedTag);
        }
      } else {
        // Employee flow (default)
        record = await getEmployeeByTag(derivedTag);
        if (!record) {
          console.log("[zk-login] Employee tag not found, auto-registering:", derivedTag.slice(0, 16) + "...");
          record = await registerEmployeeByTag(derivedTag);
        }
      }

      const token = await signSession({
        sub: record.employee_id,
        username: record.username || role,
        role: record.role || role,
        employee_tag: record.employee_tag,
      });

      const response = NextResponse.json({
        success: true,
        employee: sanitizeEmployee(record),
        role: record.role,
      });
      const cookie = buildSessionCookie(token);
      response.cookies.set(cookie.name, cookie.value, cookie.options);
      return response;
    }

    // ── Method "credential": legacy blob verification ───────────────────
    if (method === "credential") {
      const { credential, employee_tag } = body;
      if (!credential || !employee_tag) {
        return NextResponse.json({ error: "credential payload missing" }, { status: 400 });
      }
      const { verifyCredentialBlob } = await import("@/lib/server/employee-store");
      const employee = await verifyCredentialBlob(employee_tag, credential);
      if (!employee) {
        return NextResponse.json({ error: "credential verification failed" }, { status: 401 });
      }

      const token = await signSession({
        sub: employee.employee_id,
        username: employee.username,
        role: employee.role || "employee",
        employee_tag: employee.employee_tag,
      });
      const response = NextResponse.json({
        success: true,
        employee: sanitizeEmployee(employee),
      });
      const cookie = buildSessionCookie(token);
      response.cookies.set(cookie.name, cookie.value, cookie.options);
      return response;
    }

    return NextResponse.json({ error: "unsupported method" }, { status: 400 });
  } catch (error: any) {
    // Log both message/stack AND the raw object — NilDB SDK may throw plain objects
    const rawErr = typeof error === "object" ? JSON.stringify(error) : String(error);
    console.error("[zk-login] Error:", error?.message || "(no message)", error?.stack || "(no stack)", "| raw:", rawErr);
    return NextResponse.json(
      { error: error?.message || rawErr || "zk login failed" },
      { status: 500 }
    );
  }
}
