/**
 * POST /api/employees/onboard
 * Employer-initiated contributor onboarding.
 *
 * Flow:
 *   1. Store encrypted employee record in NilDB
 *   2. Generate a short-lived onboarding token (JWT)
 *   3. Return the onboarding link for the employer to share
 *      (e.g. send as email, DM, or display in employer dashboard)
 *   4. Employee clicks link → app auto-installs credential in browser
 */

import { NextRequest, NextResponse } from "next/server";
import { SignJWT } from "jose";
import { v4 as uuidv4 } from "uuid";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      employeeTag,
      name,
      salary,
      currency,
      employerAddress,
    } = body as {
      employeeTag: string;
      name?: string;
      salary: string;
      currency: string;
      employerAddress: string;
    };

    if (!employeeTag || !salary || !employerAddress) {
      return NextResponse.json(
        { error: "Missing employeeTag, salary, or employerAddress" },
        { status: 400 }
      );
    }

    // ── Store encrypted employee record in NilDB ──────────────────────────
    const { getNillionServerClient } = await import("@/lib/server/nillion-server");
    const nillionClient = await getNillionServerClient();

    const companyId = employerAddress;
    await nillionClient.createEmployee({
      employeeTag,
      name: name ?? "Unnamed Contributor",
      salary,          // encrypted via %share in NilDB
      currency,
      companyId,
      status: "active",
    });

    // ── Generate onboarding JWT ───────────────────────────────────────────
    // The token embeds the employeeTag so the employee's browser can
    // look up their vouchers from NilDB after clicking the link.
    // It does NOT embed the salary or credential_nonce.
    const jwtSecret = new TextEncoder().encode(
      process.env.CIVITAS_ONBOARDING_JWT_SECRET ?? "civitas-dev-secret-change-in-production"
    );

    const onboardingToken = await new SignJWT({
      sub: employeeTag,
      companyId,
      iat: Math.floor(Date.now() / 1000),
    })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("72h")
      .sign(jwtSecret);

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://civitas.finance";
    const onboardingLink = `${baseUrl}/onboard?token=${onboardingToken}`;

    return NextResponse.json({
      success: true,
      employeeTag,
      onboardingLink,
    });
  } catch (err: unknown) {
    console.error("[employees/onboard]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Onboarding failed" }, { status: 500 });
  }
}
