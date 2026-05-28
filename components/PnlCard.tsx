"use client";

import type { HLAccount } from "@/lib/types";

interface Props {
  hlAccount: HLAccount | null;
}

export default function PnlCard({ hlAccount }: Props) {
  const equity = hlAccount?.account_value ?? 0;
  const openPnl = hlAccount
    ? hlAccount.positions.reduce((s, p) => s + p.unrealized_pnl, 0)
    : 0;
  const pnlColor = openPnl >= 0 ? "#4ecf8a" : "#cf4e4e";
  const pnlSign  = openPnl >= 0 ? "+" : "";

  return (
    <div className="panel" style={{ padding: "14px 16px", flexShrink: 0 }}>
      <div style={{ fontSize: 9, color: "#333", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 }}>
        Open P&amp;L
      </div>
      <div
        style={{
          fontFamily: "var(--font-sans, Inter, sans-serif)",
          fontWeight: 900,
          fontSize: 36,
          letterSpacing: "-0.05em",
          lineHeight: 1,
          color: hlAccount ? pnlColor : "#222",
        }}
      >
        {hlAccount ? `${pnlSign}$${Math.abs(openPnl).toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "—"}
      </div>
      <div style={{ fontSize: 9, color: "#444", marginTop: 4 }}>
        {hlAccount
          ? `${hlAccount.positions.length} position${hlAccount.positions.length !== 1 ? "s" : ""} open`
          : "no wallet connected"}
      </div>

      {equity > 0 && (
        <div
          style={{
            display: "flex",
            gap: 0,
            marginTop: 10,
            paddingTop: 10,
            borderTop: "1px solid #141414",
          }}
        >
          {[
            { label: "Equity",    value: `$${equity.toLocaleString("en-US", { maximumFractionDigits: 0 })}` },
            { label: "Margin",    value: `$${hlAccount!.total_margin_used.toLocaleString("en-US", { maximumFractionDigits: 0 })}` },
            { label: "Avail.",    value: `$${hlAccount!.withdrawable.toLocaleString("en-US", { maximumFractionDigits: 0 })}` },
          ].map(({ label, value }, i) => (
            <div key={label} style={{ flex: 1, borderRight: i < 2 ? "1px solid #141414" : "none", paddingRight: i < 2 ? 12 : 0, marginRight: i < 2 ? 12 : 0 }}>
              <div style={{ fontSize: 8, color: "#2a2a2a", marginBottom: 3, letterSpacing: "0.06em" }}>{label}</div>
              <div style={{ fontFamily: "var(--font-sans, Inter, sans-serif)", fontWeight: 700, fontSize: 12 }}>{value}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
