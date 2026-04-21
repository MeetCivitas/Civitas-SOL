import bcrypt from "bcryptjs";
import { bn128Poseidon1 as poseidonHash1 } from "../bn128-poseidon";
import { randomBytes, webcrypto, createHash } from "crypto";
import { v4 as uuidv4 } from "uuid";
import {
  upsertIdentityRecord,
  getIdentityByTag,
  getIdentityByUsername,
  listIdentities,
  updateIdentityRecord,
} from "./nillion-server";

const subtle = webcrypto?.subtle;
const encoder = new TextEncoder();

export interface EmployeeSeed {
  employee_id?: string;
  username?: string;
  name?: string;
  email?: string;
  role?: string;
  wallet_address?: string;
  salary?: number;
  currency?: string;
  metadata?: Record<string, unknown>;
  password?: string;
  credential_nonce?: string;
  employee_tag?: string;
}

export interface EmployeeRecord {
  employee_id: string;
  username: string;
  username_normalized: string;
  password_hash: string;
  employee_tag: string;
  credential_nonce: string;
  zkpass_credential: EncryptedCredential;
  org_id: string;
  vouchers: VoucherRecord[];
  role: string;
  credential_vouchers?: CredentialVoucher[];
  profile?: {
    name?: string;
    email?: string;
    role?: string;
    wallet_address?: string;
  };
  created_at: string;
  updated_at: string;
  status?: "provisional" | "active" | "terminated";
}

export interface VoucherRecord {
  voucher_id: string;
  amount: number;
  currency: string;
  run_id?: string;
  status: "issued" | "redeemed" | "settled";
  memo?: string;
  issued_at: string;
  updated_at?: string;
  settlement_txid?: string;
}

export interface EncryptedCredential {
  ciphertext: string;
  iv: string;
  signature: string;
}

export interface ProvisionedEmployee {
  employee_id: string;
  username: string;
  temporary_password: string;
  employee_tag: string;
  credential_secret: string;
  credential_file: EncryptedCredential & { employee_id: string; employee_tag: string };
}

export interface CredentialVoucher {
  token_hash: string;
  created_at: string;
  expires_at: string;
  status: "active" | "consumed";
  downloaded_at?: string;
}

// ── Crypto Helpers ───────────────────────────────────────────────────────

function hexFromBytes(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("hex");
}

function bytesFromHex(hex: string) {
  return Uint8Array.from(Buffer.from(hex, "hex"));
}

function base64FromBytes(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("base64");
}

async function deriveAesKeyFromNonce(nonceHex: string) {
  if (!subtle) throw new Error("AES not available in this runtime");
  const keyData = bytesFromHex(nonceHex.padStart(64, "0"));
  return subtle.importKey("raw", keyData, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encryptCredentialPayload(
  payload: Record<string, unknown>,
  nonceHex: string
): Promise<EncryptedCredential> {
  const key = await deriveAesKeyFromNonce(nonceHex);
  const iv = randomBytes(12);
  const plaintext = encoder.encode(JSON.stringify(payload));
  const ciphertext = await subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  const cipherBytes = new Uint8Array(ciphertext);
  const signature = base64FromBytes(
    encoder.encode(hexFromBytes(cipherBytes) + ":" + nonceHex.toLowerCase())
  );
  return {
    ciphertext: base64FromBytes(cipherBytes),
    iv: base64FromBytes(iv),
    signature,
  };
}

export function randomPassword(length = 12) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789@#$!";
  const bytes = randomBytes(length);
  let pwd = "";
  for (let i = 0; i < length; i++) {
    pwd += alphabet[bytes[i] % alphabet.length];
  }
  return pwd;
}

function normalizeUsername(username?: string) {
  if (!username) return "";
  return username.trim().toLowerCase();
}

function deriveEmployeeTag(nonceHex: string) {
  const asBigInt = BigInt("0x" + nonceHex);
  return poseidonHash1(asBigInt).toString(16);
}

function nowIso() {
  return new Date().toISOString();
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

// ── Employee Registration ────────────────────────────────────────────────

/**
 * Register an employee by their self-generated tag only.
 * No credential_nonce, no password — just a tag.
 * The nonce never touches the server.
 */
export async function registerEmployeeByTag(
  tag: string,
  name?: string,
  salary?: number,
  orgId?: string
): Promise<EmployeeRecord> {
  const existing = await getIdentityByTag(tag);
  if (existing) return existing as EmployeeRecord;

  const createdAt = nowIso();
  const employeeId = `emp_${tag.slice(0, 8)}_${Date.now()}`;

  const record: EmployeeRecord = {
    employee_id: employeeId,
    username: name || `employee_${tag.slice(0, 8)}`,
    username_normalized: (name || `employee_${tag.slice(0, 8)}`).toLowerCase(),
    password_hash: "",
    employee_tag: tag,
    credential_nonce: "",
    zkpass_credential: { ciphertext: "", iv: "", signature: "" },
    org_id: orgId || "unassigned",
    vouchers: [],
    credential_vouchers: [],
    role: "employee",
    profile: { name },
    created_at: createdAt,
    updated_at: createdAt,
    status: salary ? "active" : "provisional",
  };

  await upsertIdentityRecord(record);
  return record;
}

export async function provisionEmployeesFromSeeds(
  seeds: EmployeeSeed[],
  orgId: string,
  runId?: string
): Promise<{ records: EmployeeRecord[]; provisioning: ProvisionedEmployee[] }> {
  if (!Array.isArray(seeds) || seeds.length === 0) {
    throw new Error("No employees supplied");
  }

  const records: EmployeeRecord[] = [];
  const provisioning: ProvisionedEmployee[] = [];

  for (const seed of seeds) {
    const employeeId = seed.employee_id || uuidv4();
    const username =
      seed.username ||
      (seed.email ? seed.email.split("@")[0] : `employee_${employeeId.slice(0, 8)}`);
    const normalized = normalizeUsername(username);
    const password = seed.password || randomPassword();
    const passwordHash = bcrypt.hashSync(password, 10);
    const credentialNonce = seed.credential_nonce || hexFromBytes(randomBytes(32));
    const employeeTag = seed.employee_tag || deriveEmployeeTag(credentialNonce);
    const createdAt = nowIso();

    const credentialPayload = {
      employee_id: employeeId,
      username,
      employee_tag: employeeTag,
      org_id: orgId,
      issued_at: createdAt,
    };
    const credentialBlob = await encryptCredentialPayload(credentialPayload, credentialNonce);

    const voucher: VoucherRecord = {
      voucher_id: `voucher_${uuidv4()}`,
      amount: seed.salary ?? 0,
      currency: seed.currency ?? "ZEC",
      run_id: runId,
      status: "issued",
      memo: `Payroll allocation for ${username}`,
      issued_at: createdAt,
    };

    const record: EmployeeRecord = {
      employee_id: employeeId,
      username,
      username_normalized: normalized,
      password_hash: passwordHash,
      employee_tag: employeeTag,
      credential_nonce: credentialNonce,
      zkpass_credential: credentialBlob,
      org_id: orgId,
      vouchers: [voucher],
      credential_vouchers: [],
      role: seed.role || "employee",
      profile: {
        name: seed.name,
        email: seed.email,
        role: seed.role || "employee",
        wallet_address: seed.wallet_address,
      },
      created_at: createdAt,
      updated_at: createdAt,
    };

    records.push(record);

    provisioning.push({
      employee_id: employeeId,
      username,
      temporary_password: password,
      employee_tag: employeeTag,
      credential_secret: credentialNonce,
      credential_file: { ...credentialBlob, employee_id: employeeId, employee_tag: employeeTag },
    });
  }

  // Batch upsert all records
  await Promise.all(records.map((r) => upsertIdentityRecord(r)));
  return { records, provisioning };
}

// ── Auth ─────────────────────────────────────────────────────────────────

export async function verifyPasswordLogin(username: string, password: string) {
  const record = await getIdentityByUsername(username);
  if (!record) return null;
  const ok = bcrypt.compareSync(password, record.password_hash);
  if (!ok) return null;
  return record as EmployeeRecord;
}

// ── Employee Lookups ─────────────────────────────────────────────────────

export async function getEmployeeByTag(tag: string): Promise<EmployeeRecord | null> {
  if (!tag) return null;
  return (await getIdentityByTag(tag)) as EmployeeRecord | null;
}

export async function getEmployeeProfile(employeeId: string): Promise<EmployeeRecord | null> {
  // Identity is keyed by tag; scan for employee_id match
  const all = await listIdentities();
  const found = all.find((e) => e.employee_id === employeeId);
  return (found as EmployeeRecord) || null;
}

export async function listAllEmployees(): Promise<EmployeeRecord[]> {
  const all = await listIdentities();
  return all.filter((e) => e.role !== "auditor") as EmployeeRecord[];
}

export async function upsertEmployees(records: EmployeeRecord[]): Promise<EmployeeRecord[]> {
  await Promise.all(records.map((r) => upsertIdentityRecord(r)));
  return records;
}

// ── Voucher Management ───────────────────────────────────────────────────

export async function listEmployeeVouchers(employeeId: string): Promise<VoucherRecord[]> {
  const record = await getEmployeeProfile(employeeId);
  return record?.vouchers ?? [];
}

export async function updateEmployeeVoucher(
  employeeId: string,
  voucherId: string,
  updates: Partial<VoucherRecord>
): Promise<VoucherRecord | null> {
  const record = await getEmployeeProfile(employeeId);
  if (!record || !record.vouchers) return null;

  const voucher = record.vouchers.find((v: VoucherRecord) => v.voucher_id === voucherId);
  if (!voucher) return null;

  Object.assign(voucher, updates, { updated_at: nowIso() });
  await updateIdentityRecord(record.employee_tag, { vouchers: record.vouchers });
  return voucher;
}

// ── Credential Vouchers (download tokens) ────────────────────────────────

export async function createCredentialVoucher(employeeId: string, ttlMs = 7 * 24 * 60 * 60 * 1000) {
  const record = await getEmployeeProfile(employeeId);
  if (!record) throw new Error("Employee not found");

  const token = randomBytes(24).toString("hex");
  const tokenHash = hashToken(token);
  const now = new Date();

  const voucher: CredentialVoucher = {
    token_hash: tokenHash,
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + ttlMs).toISOString(),
    status: "active",
  };

  const updatedVouchers = [...(record.credential_vouchers || []), voucher];
  await updateIdentityRecord(record.employee_tag, { credential_vouchers: updatedVouchers });

  return { token, expires_at: voucher.expires_at };
}

export async function redeemCredentialVoucher(token: string) {
  const tokenHash = hashToken(token);
  const all = await listIdentities();

  for (const employee of all) {
    const vouchers: CredentialVoucher[] = employee.credential_vouchers || [];
    const target = vouchers.find(
      (v: CredentialVoucher) =>
        v.token_hash === tokenHash &&
        v.status === "active" &&
        new Date(v.expires_at).getTime() > Date.now()
    );

    if (target) {
      target.status = "consumed";
      target.downloaded_at = nowIso();
      await updateIdentityRecord(employee.employee_tag, {
        credential_vouchers: vouchers,
        updated_at: target.downloaded_at,
      });

      return {
        employee: employee as EmployeeRecord,
        credential: employee.zkpass_credential,
        voucher: target,
      };
    }
  }
  return null;
}

export async function verifyCredentialBlob(employeeTag: string, blob: EncryptedCredential) {
  const employee = await getIdentityByTag(employeeTag);
  if (!employee) return null;

  const stored = employee.zkpass_credential;
  if (
    stored.ciphertext !== blob.ciphertext ||
    stored.iv !== blob.iv ||
    stored.signature !== blob.signature
  ) {
    return null;
  }
  return employee as EmployeeRecord;
}

// ── Auditor Store Functions ──────────────────────────────────────────────

export async function registerAuditorByTag(
  tag: string,
  name?: string,
  orgId?: string
): Promise<EmployeeRecord> {
  const existing = await getIdentityByTag(tag);
  if (existing) return existing as EmployeeRecord;

  const createdAt = nowIso();
  const auditorId = `aud_${tag.slice(0, 8)}_${Date.now()}`;

  const record: EmployeeRecord = {
    employee_id: auditorId,
    username: name || `auditor_${tag.slice(0, 8)}`,
    username_normalized: (name || `auditor_${tag.slice(0, 8)}`).toLowerCase(),
    password_hash: "",
    employee_tag: tag,
    credential_nonce: "",
    zkpass_credential: { ciphertext: "", iv: "", signature: "" },
    org_id: orgId || "unassigned",
    vouchers: [],
    credential_vouchers: [],
    role: "auditor",
    profile: { name, role: "auditor" },
    created_at: createdAt,
    updated_at: createdAt,
    status: "active",
  };

  await upsertIdentityRecord(record);
  return record;
}

export async function getAuditorByTag(tag: string): Promise<EmployeeRecord | null> {
  if (!tag) return null;
  const record = await getIdentityByTag(tag);
  return record?.role === "auditor" ? (record as EmployeeRecord) : null;
}

export async function listAllAuditors(): Promise<EmployeeRecord[]> {
  const all = await listIdentities();
  return all.filter((e) => e.role === "auditor") as EmployeeRecord[];
}

export async function updateAuditorEmail(employeeId: string, email: string): Promise<void> {
  const record = await getEmployeeProfile(employeeId);
  if (!record) return;
  const updatedProfile = { ...(record.profile || {}), email };
  await updateIdentityRecord(record.employee_tag, { profile: updatedProfile });
}

export async function revokeAuditor(tag: string): Promise<boolean> {
  const record = await getIdentityByTag(tag);
  if (!record || record.role !== "auditor") return false;
  await updateIdentityRecord(tag, { status: "terminated" });
  return true;
}

// ── Sanitize ─────────────────────────────────────────────────────────────

export function sanitizeEmployee(record: EmployeeRecord) {
  if (!record) return null;
  const { password_hash, credential_nonce, zkpass_credential, ...rest } = record;
  return rest;
}

// ── Demo Seeding ─────────────────────────────────────────────────────────

const DEMO_SEEDS: EmployeeSeed[] = [
  {
    username: "employer_demo",
    name: "Demo Employer",
    email: "employer@demo.civ",
    role: "employer",
    salary: 0,
    currency: "ZEC",
    password: "demo123!",
  },
  {
    username: "employee_priya",
    name: "Priya Sharma",
    email: "employee@demo.civ",
    role: "employee",
    salary: 1200,
    currency: "ZEC",
    password: "demo123!",
  },
  {
    username: "auditor_karthik",
    name: "Karthik Rao",
    email: "auditor@demo.civ",
    role: "auditor",
    salary: 0,
    currency: "ZEC",
    password: "demo123!",
  },
];

let demoSeedPromise: Promise<void> | null = null;

export function ensureDemoEmployees() {
  if (process.env.ENABLE_DEMO_EMPLOYEES === "false") {
    return Promise.resolve();
  }
  if (demoSeedPromise) return demoSeedPromise;
  demoSeedPromise = (async () => {
    const existing = await listIdentities();
    if (existing.length > 0) return;
    await provisionEmployeesFromSeeds(DEMO_SEEDS, "demo_org", "demo_run");
  })();
  return demoSeedPromise;
}
