export const SOLANA_CLUSTER = process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet";
export const SOLANA_CLUSTER_LABEL =
  SOLANA_CLUSTER === "mainnet-beta" ? "Mainnet" : SOLANA_CLUSTER === "testnet" ? "Testnet" : "Devnet";

const CLUSTER_QUERY =
  SOLANA_CLUSTER === "mainnet-beta" ? "" : `?cluster=${encodeURIComponent(SOLANA_CLUSTER)}`;

export const SOLANA_TREASURY_VAULT =
  process.env.NEXT_PUBLIC_SOLANA_TREASURY_VAULT ?? "Pending deployment";

export const SOLANA_PAYROLL_PROGRAM =
  process.env.NEXT_PUBLIC_SOLANA_PAYROLL_PROGRAM ??
  process.env.NEXT_PUBLIC_CIVITAS_PROGRAM_ID ??
  "Planned for Solana migration";

export const USDC_MINT_ADDRESS =
  process.env.NEXT_PUBLIC_USDC_MINT ?? "9pan9bMn5HatX4EJdBwg9VgCa7Uz5HL8N1m5D3NdXejP";

/**
 * Legacy SPL Token mint used by MagicBlock Private Payments. MagicBlock
 * does not support Token-2022 — actual USDC settlement (private transfer
 * + employee withdraw) flows through this mint.
 */
export const MAGICBLOCK_USDC_MINT =
  process.env.NEXT_PUBLIC_MAGICBLOCK_USDC_MINT ?? USDC_MINT_ADDRESS;

export function buildExplorerUrl(
  kind: "address" | "tx" | "token",
  value: string,
) {
  const path = kind === "tx" ? "tx" : "address";
  return `https://explorer.solana.com/${path}/${value}${CLUSTER_QUERY}`;
}

export function shortenAddress(address?: string | null, chars = 4) {
  if (!address) return "Not connected";
  if (address.length <= chars * 2 + 3) return address;
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

/**
 * Format a USDC amount that's already in human units (e.g. 1500.25).
 * Always returns 2 decimals for clean UI tabular alignment.
 */
export function formatUsdc(value: string | number | bigint) {
  const numeric = typeof value === "bigint" ? Number(value) : Number(value || 0);
  if (!Number.isFinite(numeric)) return "0.00";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numeric);
}

/**
 * Format a USDC atomic-unit amount (6 decimals) into a human-readable string.
 * Accepts BigInt, number, or numeric string (string is preferred to avoid
 * loss of precision on totals greater than 9 quadrillion micro-units).
 *
 * Why this exists: the API returns `total_amount` as a micro-USDC string
 * (e.g. "12000000000" = 12,000.00 USDC). Passing that directly to
 * `formatUsdc` previously produced "12,000,000,000" — visually wrong by 6
 * orders of magnitude. Earlier UIs also showed values like "0.004 USDC"
 * when fractional micro-units leaked through.
 */
export function formatUsdcFromMicro(value: string | number | bigint | null | undefined) {
  if (value === null || value === undefined || value === "") return "0.00";
  let micro: bigint;
  try {
    if (typeof value === "bigint") micro = value;
    else if (typeof value === "number") {
      if (!Number.isFinite(value)) return "0.00";
      micro = BigInt(Math.trunc(value));
    } else {
      // string — strip decimals if accidentally passed as a float string
      const s = String(value).trim();
      micro = BigInt(s.includes(".") ? s.split(".")[0] : s || "0");
    }
  } catch {
    return "0.00";
  }
  const sign = micro < 0n ? "-" : "";
  const abs = micro < 0n ? -micro : micro;
  const whole = abs / 1_000_000n;
  const frac = (abs % 1_000_000n).toString().padStart(6, "0").slice(0, 2); // 2 decimals
  const wholeStr = new Intl.NumberFormat("en-US").format(whole);
  return `${sign}${wholeStr}.${frac}`;
}

export function formatTokenAmount(value: string | number, symbol: string) {
  const numeric = Number(value || 0);
  return `${formatUsdc(numeric)} ${symbol}`;
}
