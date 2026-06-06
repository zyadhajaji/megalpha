"use client";

import type { HLAccount } from "@/lib/types";

interface Props {
  hlAccount: HLAccount | null;
}

function MetaRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span style={{
        fontSize: 9,
        color: "#555",
        fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace",
        letterSpacing: "0.06em",
      }}>
        {label}
      </span>
      <span style={{
        fontFamily: "var(--font-sans, Inter, sans-serif)",
        fontWeight: 700,
        fontSize: 11,
        color: color ?? "#e8e8e8",
        fontVariantNumeric: "tabular-nums",
      }}>
        {value}
      </span>
    </div>
  );
}

export default function PnlCard({ hlAccount }: Props) {
  const equity  = hlAccount?.account_value ?? 0;
  const margin  = hlAccount?.total_margin_used ?? 0;
  const avail   = hlAccount?.withdrawable ?? 0;

  const openPnl  = hlAccount
    ? hlAccount.positions.reduce((s, p) => s + p.unrealized_pnl, 0)
    : 0;
  const isPos    = openPnl >= 0;
  const pnlColor = hlAccount ? (isPos ? "#4ecf8a" : "#cf4e4e") : "#222";
  const pnlSign  = isPos ? "+" : "";

  const marginPct = equity > 0 ? (margin / equity * 100) : 0;

  return (
    <div
      className={hlAccount && openPnl > 0 ? "panel--active" : hlAccount && openPnl < 0 ? "panel--alert" : "panel"}
      style={{ padding: "12px 14px", flexShrink: 0 }}
    >
      {/* Label */}
      <div style={{
        fontSize: 9,
        color: "#555",
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        marginBottom: 6,
        fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace",
        fontWeight: 500,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}>
        <span>Open P&L</span>
        {hlAccount && hlAccount.positions.length > 0 && (
          <span style={{
            fontSize: 8,
            padding: "1px 5px",
            borderRadius: 2,
            background: "rgba(255,255,255,0.04)",
            border: "1px solid #1c1c1c",
            color: "#666",
          }}>
            {hlAccount.positions.length} pos
          </span>
        )}
      </div>

      {/* Big P&L number */}
      <div
        style={{
          fontFamily: "var(--font-sans, Inter, sans-serif)",
          fontWeight: 900,
          fontSize: 38,
          letterSpacing: "-0.05em",
          lineHeight: 1,
          color: pnlColor,
          marginBottom: 4,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {hlAccount
          ? `${pnlSign}$${Math.abs(openPnl).toLocaleString("en-US", { maximumFractionDigits: 0 })}`
          : "—"}
      </div>

      {/* Sub-label */}
      <div style={{
        fontSize: 9,
        color: "#555",
        marginBottom: 12,
        fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace",
      }}>
        {hlAccount
          ? (hlAccount.positions.length > 0
            ? `${hlAccount.positions.map(p => `${p.coin} ${p.is_long ? "↑" : "↓"}`).join(" · ")}`
            : "no open positions")
          : "no wallet connected"}
      </div>

      {/* Account breakdown */}
      {equity > 0 && (
        <div style={{
          paddingTop: 10,
          borderTop: "1px solid #141414",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}>
          <MetaRow
            label="Account Value"
            value={`$${equity.toLocaleString("en-US", { maximumFractionDigits: 0 })}`}
          />
          <MetaRow
            label={`Margin Used ${marginPct > 0 ? `(${marginPct.toFixed(0)}%)` : ""}`}
            value={`$${margin.toLocaleString("en-US", { maximumFractionDigits: 0 })}`}
            color={marginPct > 50 ? "#cfad4e" : marginPct > 80 ? "#cf4e4e" : "#999"}
          />
          <MetaRow
            label="Available"
            value={`$${avail.toLocaleString("en-US", { maximumFractionDigits: 0 })}`}
            color="#4ecf8a"
          />

          {/* Margin utilization bar */}
          {marginPct > 0 && (
            <div style={{ marginTop: 2 }}>
              <div className="prob-bar">
                <div
                  className="prob-bar__fill"
                  style={{
                    width: `${Math.min(100, marginPct)}%`,
                    background: marginPct > 80 ? "#cf4e4e" : marginPct > 50 ? "#cfad4e" : "#3a6eaa",
                  }}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
