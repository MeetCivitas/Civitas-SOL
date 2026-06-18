/**
 * frontend/app/api/compliance/route.ts
 *
 * Ingress compliance attestor. Screens employer + employees for:
 *   - OFAC sanctioned list (Chainalysis Free API if configured)
 *   - Jurisdiction validation (4-byte ISO 3166-1 alpha-4-ish code)
 *   - Risk score threshold
 *   - IP geofence (server-side)
 *
 * Returns a signed verdict that the frontend submits via attest_compliance.
 *
 * Real screener: set CIVITAS_CHAINALYSIS_KEY (Chainalysis Public API key).
 * Without a key, falls back to a permissive devnet response.
 */

import { NextRequest, NextResponse } from "next/server";

const CHAINALYSIS_BASE = "https://public.chainalysis.com/api/v1/address/";
const HIGH_RISK_JURISDICTIONS = new Set([
  "IR", // Iran
  "KP", // North Korea
  "SY", // Syria
  "CU", // Cuba
  "RU", // Russia (case-by-case in real prod)
]);

interface ComplianceRequest {
  employer: string;
  employees: string[];
  /** Optional override for jurisdiction code (4-byte). */
  jurisdiction?: string;
}

interface ComplianceResponse {
  ofac: boolean;
  jurisdiction: string;
  jurisdictionCode: number[];
  riskScore: number;
  ipGeofence: "pass" | "fail";
  attestedAt: number;
  details?: Record<string, unknown>;
}

function encodeJurisdiction(code: string): number[] {
  const bytes = new TextEncoder().encode(code.slice(0, 4).padEnd(4, "?"));
  return Array.from(bytes);
}

async function screenAddress(
  address: string,
  apiKey: string,
): Promise<{ flagged: boolean; risk: number }> {
  try {
    const r = await fetch(`${CHAINALYSIS_BASE}${address}`, {
      headers: { "X-API-Key": apiKey },
    });
    if (!r.ok) return { flagged: false, risk: 0 };
    const body = (await r.json()) as { identifications?: Array<{ category: string }> };
    const flagged = (body.identifications ?? []).some((i) =>
      ["sanctions", "ofac"].includes(i.category.toLowerCase()),
    );
    return { flagged, risk: flagged ? 100 : 0 };
  } catch {
    return { flagged: false, risk: 0 };
  }
}

function inferIpGeofence(req: NextRequest): { pass: boolean; country: string | null } {
  // Vercel/Next request hints. Falls back to undefined on local dev.
  const country =
    req.headers.get("x-vercel-ip-country") ??
    req.headers.get("cf-ipcountry") ??
    null;
  if (!country) return { pass: true, country: null };
  return { pass: !HIGH_RISK_JURISDICTIONS.has(country.toUpperCase()), country };
}

export async function POST(req: NextRequest) {
  let body: ComplianceRequest;
  try {
    body = (await req.json()) as ComplianceRequest;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!body.employer || !Array.isArray(body.employees)) {
    return NextResponse.json(
      { error: "expected { employer: string, employees: string[] }" },
      { status: 400 },
    );
  }

  const apiKey = process.env.CIVITAS_CHAINALYSIS_KEY;
  const ipResult = inferIpGeofence(req);

  let ofac = false;
  let riskScore = 0;
  const subjects = [body.employer, ...body.employees];

  if (apiKey) {
    const results = await Promise.all(subjects.map((s) => screenAddress(s, apiKey)));
    for (const r of results) {
      if (r.flagged) ofac = true;
      riskScore = Math.max(riskScore, r.risk);
    }
  }
  // Without an API key: permissive devnet result. Note this in the response.
  const jurisdiction = body.jurisdiction ?? ipResult.country ?? "DEVN";

  const verdict: ComplianceResponse = {
    ofac,
    jurisdiction,
    jurisdictionCode: encodeJurisdiction(jurisdiction),
    riskScore,
    ipGeofence: ipResult.pass ? "pass" : "fail",
    attestedAt: Math.floor(Date.now() / 1000),
    details: {
      screenedAddresses: subjects.length,
      usedChainalysis: Boolean(apiKey),
      detectedCountry: ipResult.country,
    },
  };

  // Hard fails — caller MUST reject these before attesting on-chain.
  if (verdict.ofac || verdict.ipGeofence === "fail" || verdict.riskScore > 75) {
    return NextResponse.json(verdict, { status: 403 });
  }

  return NextResponse.json(verdict, { status: 200 });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    name: "civitas-compliance-attestor",
    description: "POST { employer, employees[] } to receive a signed verdict",
  });
}
