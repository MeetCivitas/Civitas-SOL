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

export function formatUsdc(value: string | number | bigint) {
  const numeric = typeof value === "bigint" ? Number(value) : Number(value || 0);
  if (!Number.isFinite(numeric)) return "0.00";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: numeric >= 1000 ? 2 : 4,
  }).format(numeric);
}

export function formatTokenAmount(value: string | number, symbol: string) {
  const numeric = Number(value || 0);
  return `${formatUsdc(numeric)} ${symbol}`;
}
