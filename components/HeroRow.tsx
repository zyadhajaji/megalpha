"use client";

import type { HLAccount, RLAgentState } from "@/lib/types";
import type { RegimeCoin } from "@/hooks/useHLStream";
import type { MT5StatusData } from "@/hooks/useMT5Status";

interface Props {
  hlAccount: HLAccount | null;
  connected: boolean;
  rlAgent?:  RLAgentState | null;   // kept for type compat, not displayed
  regime?:   Record<string, RegimeCoin> | null;
  autoExecMode?: string;
  paperEquity?:  number;
  mt5?: MT5StatusData | null;
  isMobile?: boolean;
}

interface StatCardProps {
  label: string;
  value: string;
  sub: string;
  valueColor?: string;
  accent?: string;   // left-border accent color
  tag?: React.ReactNode;
}

function StatCard({ label, value, sub, valueColor, accent, tag }: StatCardProps) {
  return (
    <div
      className="panel"
      style={{
        padding: "11px 14px 12px",
        flex: 1,
        borderLeft: accent ? `2px solid ${accent}` : undefined,
        display: "flex",
        flexDirection: "column",
        gap: 0,
        minWidth: 0,
      }}
    >
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 7,
      }}>
        <span style={{
          fontSize: 9,
          color: "#555",
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace",
          fontWeight: 500,
        }}>
          {label}
        </span>
        {tag}
      </div>
      <div
        style={{
          fontFamily: "var(--font-sans, Inter, sans-serif)",
          fontWeight: 900,
          fontSize: 26,
          letterSpacing: "-0.04em",
          lineHeight: 1,
          color: valueColor ?? "#e8e8e8",
          marginBottom: 6,
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {value}
      </div>
      <div style={{
        fontSize: 9,
        color: "#666",
        fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}>
        {sub}
      </div>
    </div>
  );
}

const REGIME_COLOR: Record<string, string> = {
  TRENDING:   "#4ecf8a",
  RANGING:    "#cfad4e",
  TRANSITION: "#555",
  HALTED:     "#cf4e4e",
};

const REGIME_ACCENT: Record<string, string> = {
  TRENDING:   "rgba(78,207,138,0.5)",
  RANGING:    "rgba(207,173,78,0.5)",
  TRANSITION: "rgba(80,80,80,0.3)",
  HALTED:     "rgba(207,78,78,0.5)",
};

export default function HeroRow({ hlAccount, connected, regime, autoExecMode, paperEquity, mt5, isMobile = false }: Props) {
  const equity = hlAccount
    ? `$${hlAccount.account_value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
    : connected ? "—" : "Offline";

  const openPnl = hlAccount
    ? hlAccount.positions.reduce((s, p) => s + p.unrealized_pnl, 0)
    : null;
  const pnlStr = openPnl !== null
    ? `${openPnl >= 0 ? "+" : ""}$${Math.abs(openPnl).toLocaleString("en-US", { maximumFractionDigits: 0 })} open P&L`
    : connected ? "no wallet connected" : "server offline";

  const equityColor = connected ? (openPnl !== null && openPnl < 0 ? "#cf4e4e" : "#e8e8e8") : "#333";
  const equityAccent = openPnl !== null
    ? (openPnl > 0 ? "rgba(78,207,138,0.5)" : openPnl < 0 ? "rgba(207,78,78,0.5)" : undefined)
    : undefined;

  const position = hlAccount?.positions[0];
  const posStr = position
    ? `${position.coin} ${position.is_long ? "Long" : "Short"}`
    : "—";
  const posSub = position
    ? `entry $${position.entry_px.toLocaleString()} · ${position.unrealized_pnl >= 0 ? "+" : ""}$${position.unrealized_pnl.toFixed(0)}`
    : connected ? "no open position" : "";
  const posColor = position ? (position.is_long ? "#4ecf8a" : "#cf4e4e") : "#333";
  const posAccent = position ? (position.is_long ? "rgba(78,207,138,0.5)" : "rgba(207,78,78,0.5)") : undefined;

  const mode         = autoExecMode ?? "stopped";
  const modeColorMap: Record<string, string> = {
    live:    "#cf4e4e",
    paper:   "#4e8ecf",
    stopped: "#333",
  };
  const modeColor  = modeColorMap[mode] ?? "#333";
  const modeStr    = mode === "stopped" ? "IDLE" : mode.toUpperCase();
  const modeSub    = mode === "live"
    ? "executing on Hyperliquid"
    : mode === "paper"
    ? `paper equity $${(paperEquity ?? 10000).toLocaleString("en-US", { maximumFractionDigits: 0 })}`
    : "strategies idle";
  const modeAccent = mode === "live" ? "rgba(207,78,78,0.5)"
    : mode === "paper" ? "rgba(78,142,207,0.5)"
    : undefined;

  // Regime analysis
  const regimeCoins = regime ? Object.entries(regime) : [];
  const dominantState = regimeCoins.length > 0
    ? regimeCoins.reduce((acc, [, r]) => {
        acc[r.state] = (acc[r.state] ?? 0) + 1;
        return acc;
      }, {} as Record<string, number>)
    : {};
  const topState = Object.entries(dominantState).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "TRANSITION";
  const regimeAccent = REGIME_ACCENT[topState];

  // MT5 balance card values
  const mt5Balance = mt5?.balance ?? 0;
  const mt5Currency = mt5?.currency ?? "CAD";
  const mt5Profit = mt5?.profit ?? 0;
  const mt5Connected = mt5?.connected ?? false;
  const mt5BalStr = mt5Balance > 0
    ? `${mt5Balance.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${mt5Currency}`
    : mt5Connected ? "—" : "Offline";
  const mt5SubStr = mt5Profit !== 0
    ? `${mt5Profit >= 0 ? "+" : ""}$${Math.abs(mt5Profit).toFixed(2)} P&L`
    : mt5Connected ? "no open P&L" : "not connected";
  const mt5Accent = mt5Profit > 0 ? "rgba(78,207,138,0.5)" : mt5Profit < 0 ? "rgba(207,78,78,0.5)" : undefined;
  const mt5ValColor = mt5Connected ? (mt5Profit < 0 ? "#cf4e4e" : "#e8e8e8") : "#333";

  // Regime panel (shared between mobile and desktop)
  const regimePanel = regime && regimeCoins.length > 0 ? (
    <div
      className="panel"
      style={{
        padding: "11px 14px 12px",
        flex: 1,
        borderLeft: regimeAccent ? `2px solid ${regimeAccent}` : undefined,
        minWidth: 0,
      }}
    >
      <div style={{
        fontSize: 9, color: "#555", letterSpacing: "0.12em",
        textTransform: "uppercase", fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace",
        fontWeight: 500, marginBottom: 7,
      }}>
        Market Regime
      </div>
      <div style={{ display: "flex", gap: isMobile ? 10 : 14, marginBottom: 7 }}>
        {["BTC", "ETH", "SOL"].map(c => {
          const r = regime[c];
          if (!r) return null;
          const col = REGIME_COLOR[r.state] ?? "#555";
          return (
            <div key={c} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ fontSize: 8, color: "#444", fontFamily: "var(--font-mono)", letterSpacing: "0.08em" }}>{c}</span>
              <span style={{ fontFamily: "var(--font-mono, 'IBM Plex Mono', monospace)", fontSize: 11, fontWeight: 700, color: col, letterSpacing: "0.02em" }}>
                {r.state.slice(0, 5)}
              </span>
              {r.adx > 0 && (
                <span style={{ fontSize: 8, color: "#444", fontFamily: "var(--font-mono)" }}>ADX {r.adx.toFixed(0)}</span>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 9, color: "#666", fontFamily: "var(--font-mono)" }}>
        {["BTC", "ETH", "SOL"].map(c => regime[c]?.state === "TRENDING").filter(Boolean).length >= 2
          ? "Trend follow active · Strategy B"
          : ["BTC", "ETH", "SOL"].map(c => regime[c]?.state === "RANGING").filter(Boolean).length >= 2
          ? "Stop hunt active · Strategy A"
          : "Mixed regime · Strategy D preferred"}
      </div>
    </div>
  ) : (
    <StatCard label="Market Regime" value="—" sub="loading regime…" valueColor="#333" />
  );

  // ── Mobile: 2×2 grid ─────────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, flexShrink: 0 }}>
        {/* Row 1 */}
        <StatCard label="HL Equity" value={equity} sub={pnlStr} valueColor={equityColor} accent={equityAccent} />
        <StatCard
          label="MT5 Balance"
          value={mt5BalStr}
          sub={mt5SubStr}
          valueColor={mt5ValColor}
          accent={mt5Accent}
          tag={mt5Connected ? (
            <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#4ecf8a", boxShadow: "0 0 5px rgba(78,207,138,0.6)", flexShrink: 0 }} />
          ) : undefined}
        />
        {/* Row 2 */}
        <StatCard
          label="Auto-Exec"
          value={modeStr}
          sub={modeSub}
          valueColor={modeColor}
          accent={modeAccent}
        />
        <StatCard
          label="Position"
          value={posStr}
          sub={posSub}
          valueColor={posColor}
          accent={posAccent}
        />
      </div>
    );
  }

  // ── Desktop: 5-card row ──────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
      {/* Card 1 — HL Equity */}
      <StatCard label="Total Equity" value={equity} sub={pnlStr} valueColor={equityColor} accent={equityAccent} />

      {/* Card 2 — MT5 Balance */}
      <StatCard
        label="MT5 Balance"
        value={mt5BalStr}
        sub={mt5SubStr}
        valueColor={mt5ValColor}
        accent={mt5Accent}
        tag={mt5Connected ? (
          <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#4ecf8a", boxShadow: "0 0 5px rgba(78,207,138,0.6)", flexShrink: 0 }} />
        ) : (
          <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#333", flexShrink: 0 }} />
        )}
      />

      {/* Card 3 — Auto-Exec */}
      <StatCard
        label="Auto-Exec"
        value={modeStr}
        sub={modeSub}
        valueColor={modeColor}
        accent={modeAccent}
        tag={mode !== "stopped" ? (
          <div style={{
            width: 6, height: 6, borderRadius: "50%",
            background: modeColor,
            boxShadow: `0 0 6px ${modeColor}`,
            animation: "pulse-dot 1.5s ease-in-out infinite",
            flexShrink: 0,
          }}/>
        ) : undefined}
      />

      {/* Card 4 — Open Position */}
      <StatCard
        label="Open Position"
        value={posStr}
        sub={posSub}
        valueColor={posColor}
        accent={posAccent}
        tag={position ? (
          <span style={{
            fontSize: 8, padding: "1px 5px", borderRadius: 2,
            fontFamily: "var(--font-mono)", fontWeight: 700, letterSpacing: "0.06em",
            background: position.is_long ? "rgba(78,207,138,0.1)" : "rgba(207,78,78,0.1)",
            color: position.is_long ? "#4ecf8a" : "#cf4e4e",
            border: `1px solid ${position.is_long ? "rgba(78,207,138,0.2)" : "rgba(207,78,78,0.2)"}`,
          }}>
            {position.is_long ? "LONG" : "SHORT"}
          </span>
        ) : undefined}
      />

      {/* Card 5 — Market Regime */}
      {regimePanel}
    </div>
  );
}
