"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useSolanaWallet } from "@/lib/solana-wallet";

interface InvoiceData {
  invoiceId: string;
  contractorTag: string;
  contractorAddress?: string;
  contractorName?: string;
  description: string;
  dueDate: string;
  status: "pending" | "committed" | "settled";
  commitment: string;
}

export default function InvoicePage() {
  const params = useParams();
  const invoiceId = params?.id as string;
  const { address, connect, connected } = useSolanaWallet();

  const [invoice, setInvoice] = useState<InvoiceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [txSig, setTxSig] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!invoiceId) return;
    fetch(`/api/invoice/${invoiceId}`)
      .then((r) => r.json())
      .then((data) => setInvoice(data.invoice ?? null))
      .catch(() => setError("Invoice not found"))
      .finally(() => setLoading(false));
  }, [invoiceId]);

  async function handlePay() {
    if (!address || !invoice) return;
    setPaying(true);
    setError(null);

    try {
      const resp = await fetch("/api/invoice/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId, payerAddress: address }),
      });
      const { serializedTransaction } = await resp.json();

      // Sign via Phantom/Solflare
      const provider = (window as any).solana;
      const buf = Buffer.from(serializedTransaction, "base64");
      const { VersionedTransaction } = await import("@solana/web3.js");
      const tx = VersionedTransaction.deserialize(buf);
      const signed = await provider.signTransaction(tx);

      const { Connection } = await import("@solana/web3.js");
      const connection = new Connection(
        process.env.NEXT_PUBLIC_SOLANA_CLUSTER === "mainnet-beta"
          ? "https://api.mainnet-beta.solana.com"
          : "https://api.devnet.solana.com",
        "confirmed"
      );
      const sig = await connection.sendRawTransaction(signed.serialize());
      await connection.confirmTransaction(sig, "confirmed");
      setTxSig(sig);
    } catch (err: any) {
      setError(err?.message ?? "Payment failed");
    } finally {
      setPaying(false);
    }
  }

  if (loading) {
    return (
      <main style={styles.page}>
        <div style={styles.card}>
          <div style={styles.shimmer} />
          <div style={{ ...styles.shimmer, width: "60%", marginTop: 12 }} />
        </div>
      </main>
    );
  }

  if (!invoice || error) {
    return (
      <main style={styles.page}>
        <div style={styles.card}>
          <div style={styles.errorBadge}>Invoice Not Found</div>
          <p style={styles.muted}>This invoice may have expired or the link is incorrect.</p>
        </div>
      </main>
    );
  }

  const isPaid = invoice.status === "committed" || invoice.status === "settled";

  return (
    <main style={styles.page}>
      <div style={styles.card}>
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.logo}>⚖️ Civitas</div>
          <span style={styles.privacyBadge}>🔒 Private &amp; Cryptographically Verified</span>
        </div>

        <h1 style={styles.title}>
          Invoice from{" "}
          <span style={styles.accent}>
            {invoice.contractorName ?? (invoice.contractorAddress ? `${invoice.contractorAddress.slice(0, 8)}...` : "Contractor")}
          </span>
        </h1>

        <div style={styles.divider} />

        <div style={styles.detail}>
          <span style={styles.label}>Service</span>
          <span style={styles.value}>{invoice.description || "Professional services"}</span>
        </div>
        <div style={styles.detail}>
          <span style={styles.label}>Due Date</span>
          <span style={styles.value}>
            {new Date(invoice.dueDate).toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </span>
        </div>
        <div style={styles.detail}>
          <span style={styles.label}>Status</span>
          <span style={{ ...styles.value, color: isPaid ? "#22c55e" : "#f59e0b" }}>
            {isPaid ? "✓ Paid" : "⏳ Pending"}
          </span>
        </div>

        <div style={styles.divider} />

        {/* Amount intentionally hidden — privacy feature */}
        <div style={styles.amountBox}>
          <span style={styles.amountLabel}>Amount</span>
          <span style={styles.amountHidden}>🔒 Private</span>
          <p style={styles.amountNote}>
            The payment amount is cryptographically hidden. Only the contractor can see it.
          </p>
        </div>

        {txSig ? (
          <div style={styles.successBox}>
            <div style={styles.successTitle}>✓ Payment Submitted!</div>
            <a
              href={`https://explorer.solana.com/tx/${txSig}?cluster=devnet`}
              target="_blank"
              rel="noopener noreferrer"
              style={styles.explorerLink}
            >
              View on Solana Explorer →
            </a>
            <p style={styles.muted}>The contractor will receive a private settlement shortly.</p>
          </div>
        ) : isPaid ? (
          <div style={styles.paidBox}>✓ This invoice has already been paid.</div>
        ) : !connected ? (
          <button style={styles.connectBtn} onClick={connect} id="invoice-connect-wallet">
            🔌 Connect Wallet to Pay
          </button>
        ) : (
          <button
            style={{ ...styles.payBtn, opacity: paying ? 0.7 : 1 }}
            onClick={handlePay}
            disabled={paying}
            id="invoice-pay-btn"
          >
            {paying ? "⏳ Processing..." : "▶ Pay Invoice"}
          </button>
        )}

        {error && <p style={styles.errorText}>{error}</p>}

        <div style={styles.footer}>
          <p style={styles.muted}>
            Payment is private and cryptographically proven via Civitas ZK Payroll.
          </p>
        </div>
      </div>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "linear-gradient(135deg, #0a0a0f 0%, #12121e 60%, #0d0d1a 100%)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "24px 16px",
    fontFamily: "'Inter', system-ui, sans-serif",
  },
  card: {
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 20,
    padding: "40px 36px",
    maxWidth: 480,
    width: "100%",
    backdropFilter: "blur(20px)",
    boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 28,
  },
  logo: {
    fontSize: 18,
    fontWeight: 700,
    color: "#e2e8f0",
    letterSpacing: "-0.5px",
  },
  privacyBadge: {
    fontSize: 11,
    color: "#6ee7b7",
    background: "rgba(110,231,183,0.1)",
    border: "1px solid rgba(110,231,183,0.2)",
    borderRadius: 20,
    padding: "4px 10px",
    fontWeight: 500,
  },
  title: {
    fontSize: 22,
    fontWeight: 700,
    color: "#f1f5f9",
    margin: "0 0 20px",
    lineHeight: 1.35,
  },
  accent: {
    background: "linear-gradient(90deg, #818cf8, #a78bfa)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
  },
  divider: {
    height: 1,
    background: "rgba(255,255,255,0.06)",
    margin: "20px 0",
  },
  detail: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "10px 0",
  },
  label: { fontSize: 13, color: "#64748b", fontWeight: 500 },
  value: { fontSize: 14, color: "#e2e8f0", fontWeight: 600 },
  amountBox: {
    background: "rgba(129,140,248,0.06)",
    border: "1px solid rgba(129,140,248,0.15)",
    borderRadius: 12,
    padding: "18px 20px",
    marginBottom: 24,
  },
  amountLabel: { display: "block", fontSize: 12, color: "#64748b", marginBottom: 6 },
  amountHidden: { fontSize: 20, fontWeight: 700, color: "#818cf8" },
  amountNote: { fontSize: 11, color: "#475569", margin: "8px 0 0", lineHeight: 1.5 },
  payBtn: {
    width: "100%",
    padding: "16px 24px",
    background: "linear-gradient(135deg, #818cf8, #a78bfa)",
    border: "none",
    borderRadius: 12,
    color: "#fff",
    fontSize: 16,
    fontWeight: 700,
    cursor: "pointer",
    transition: "all 0.2s",
    letterSpacing: "0.3px",
  },
  connectBtn: {
    width: "100%",
    padding: "16px 24px",
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 12,
    color: "#e2e8f0",
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
  },
  paidBox: {
    textAlign: "center",
    padding: "18px",
    background: "rgba(34,197,94,0.08)",
    border: "1px solid rgba(34,197,94,0.2)",
    borderRadius: 12,
    color: "#22c55e",
    fontWeight: 600,
    fontSize: 15,
  },
  successBox: {
    background: "rgba(34,197,94,0.06)",
    border: "1px solid rgba(34,197,94,0.2)",
    borderRadius: 12,
    padding: "20px",
    textAlign: "center",
  },
  successTitle: { fontSize: 18, fontWeight: 700, color: "#22c55e", marginBottom: 8 },
  explorerLink: { color: "#818cf8", fontSize: 13, textDecoration: "none" },
  shimmer: {
    height: 20,
    background: "linear-gradient(90deg, rgba(255,255,255,0.04), rgba(255,255,255,0.08), rgba(255,255,255,0.04))",
    borderRadius: 8,
    animation: "shimmer 1.5s infinite",
  },
  errorBadge: {
    background: "rgba(239,68,68,0.1)",
    border: "1px solid rgba(239,68,68,0.2)",
    borderRadius: 8,
    padding: "8px 14px",
    color: "#ef4444",
    fontWeight: 600,
    fontSize: 14,
    display: "inline-block",
    marginBottom: 12,
  },
  errorText: { color: "#ef4444", fontSize: 13, marginTop: 12, textAlign: "center" },
  footer: { marginTop: 28, textAlign: "center" },
  muted: { color: "#475569", fontSize: 12, lineHeight: 1.6, margin: 0 },
};
