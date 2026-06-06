"use client";

import type { HLAccount } from "@/lib/types";

interface Props {
  hlAccount: HLAccount | null;
  paperBalance?: number;
  autoExecMode?: string;
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
      <span style={{
        fontSize: 9,
        color: "#444",
        fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace",
        letterSpacing: "0.04em",
      }}>
        {label}
      </span>
      <span style={{
        fontSize: 9,
        fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace",
        fontWeight: 600,
        color: color ?? "#666",
        fontVariantNumeric: "tabular-nums",
      }}>
        {value}
      </span>
    </div>
  );
}

export default function BottomBar({ hlAccount, paperBalance = 10_000, autoExecMode }: Props) {
  const margin    = hlAccount?.total_margin_used ?? 0;
  const available = hlAccount?.withdrawable ?? 0;
  const equity    = hlAccount?.account_value ?? 0;
  const posCount  = hlAccount?.positions.length ?? 0;
  const marginPct = equity > 0 ? (margin / equity * 100) : 0;

  return (
    <footer
      style={{
        height: 24,
        background: "#0a0a0a",
        border: "1px solid #161616",
        borderRadius: 4,
        display: "flex",
        alignItems: "center",
        padding: "0 12px",
        gap: 16,
        flexShrink: 0,
      }}
    >
      <Stat
        label="Margin"
        value={`$${margin.toLocaleString("en-US", { maximumFractionDigits: 0 })}${marginPct > 0 ? ` (${marginPct.toFixed(0)}%)` : ""}`}
        color={marginPct > 80 ? "#cf4e4e" : marginPct > 50 ? "#cfad4e" : "#666"}
      />
      <div style={{ width: 1, height: 10, background: "#1a1a1a" }} />
      <Stat
        label="Available"
        value={`$${available.toLocaleString("en-US", { maximumFractionDigits: 0 })}`}
        color="#4ecf8a"
      />
      <div style={{ width: 1, height: 10, background: "#1a1a1a" }} />
      <Stat
        label="Paper"
        value={`$${paperBalance.toLocaleString("en-US", { maximumFractionDigits: 0 })}`}
      />
      {posCount > 0 && (
        <>
          <div style={{ width: 1, height: 10, background: "#1a1a1a" }} />
          <Stat label="Positions" value={String(posCount)} color="#cfad4e" />
        </>
      )}

      <div style={{ flex: 1 }} />

      {/* Auto-exec mode badge */}
      {autoExecMode && autoExecMode !== "stopped" && (
        <span style={{
          fontSize: 8,
          padding: "1px 6px",
          borderRadius: 2,
          fontFamily: "var(--font-mono)",
          fontWeight: 700,
          letterSpacing: "0.06em",
          background: autoExecMode === "live" ? "rgba(207,78,78,0.1)" : "rgba(78,142,207,0.1)",
          color: autoExecMode === "live" ? "#cf4e4e" : "#4e8ecf",
          border: `1px solid ${autoExecMode === "live" ? "rgba(207,78,78,0.2)" : "rgba(78,142,207,0.2)"}`,
        }}>
          {autoExecMode.toUpperCase()}
        </span>
      )}

      <div style={{ width: 1, height: 10, background: "#1a1a1a" }} />

      <span style={{
        fontSize: 9,
        color: "#333",
        fontFamily: "var(--font-mono)",
        letterSpacing: "0.04em",
      }}>
        Hyperliquid · Mainnet · Perps
      </span>
    </footer>
  );
}
