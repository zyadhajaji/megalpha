"use client";

import type { HLAccount, RLAgentState } from "@/lib/types";
import type { RegimeCoin } from "@/hooks/useHLStream";

interface Props {
  hlAccount: HLAccount | null;
  connected: boolean;
  rlAgent:   RLAgentState | null;
  regime?:   Record<string, RegimeCoin> | null;
}

function StatCard({ label, value, sub, valueColor }: {
  label: string;
  value: string;
  sub: string;
  valueColor?: string;
}) {
  return (
    <div
      className="panel"
      style={{ padding: "10px 14px", flex: 1 }}
    >
      <div style={{ fontSize: 9, color: "#333", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 6 }}>
        {label}
      </div>
      <div
        style={{
          fontFamily: "var(--font-sans, Inter, sans-serif)",
          fontWeight: 900,
          fontSize: 22,
          letterSpacing: "-0.03em",
          lineHeight: 1,
          color: valueColor ?? "#e8e8e8",
          marginBottom: 4,
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 9, color: "#444" }}>{sub}</div>
    </div>
  );
}

const REGIME_COLOR: Record<string, string> = {
  TRENDING: "#4ecf8a", RANGING: "#cfad4e", TRANSITION: "#555", HALTED: "#cf4e4e"
};

export default function HeroRow({ hlAccount, connected, rlAgent, regime }: Props) {
  const equity = hlAccount
    ? `$${hlAccount.account_value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
    : connected ? "—" : "Offline";

  const openPnl = hlAccount
    ? hlAccount.positions.reduce((s, p) => s + p.unrealized_pnl, 0)
    : null;
  const pnlStr = openPnl !== null
    ? `${openPnl >= 0 ? "+" : ""}$${Math.abs(openPnl).toLocaleString("en-US", { maximumFractionDigits: 0 })} open`
    : connected ? "no wallet connected" : "server offline";

  const position = hlAccount?.positions[0];
  const posStr = position
    ? `${position.coin} ${position.is_long ? "Long" : "Short"}`
    : "—";
  const posSub = position
    ? `entry $${position.entry_px.toLocaleString()} · ${position.unrealized_pnl >= 0 ? "+" : ""}$${position.unrealized_pnl.toFixed(0)}`
    : connected ? "no open position" : "";

  const agentStatus = rlAgent?.status ?? (connected ? "offline" : "offline");
  const agentColor: Record<string, string> = {
    scanning: "#cfad4e", in_trade: "#4ecf8a", training: "#4e8ecf", offline: "#333"
  };
  const agentStr = agentStatus.replace("_", " ").toUpperCase();
  const agentSub = rlAgent
    ? `${Math.round(rlAgent.confidence * 100)}% confidence · ${rlAgent.session}`
    : "not trained yet";

  return (
    <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
      <StatCard
        label="Total Equity"
        value={equity}
        sub={pnlStr}
        valueColor={connected ? "#e8e8e8" : "#333"}
      />
      <StatCard
        label="RL Agent"
        value={agentStr}
        sub={agentSub}
        valueColor={agentColor[agentStatus]}
      />
      <StatCard
        label="Open Position"
        value={posStr}
        sub={posSub}
        valueColor={position ? (position.is_long ? "#4ecf8a" : "#cf4e4e") : "#333"}
      />
      {/* Regime card — live if available, placeholder otherwise */}
      {regime ? (
        <div className="panel" style={{ padding: "10px 14px", flex: 1 }}>
          <div style={{ fontSize: 9, color: "#333", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 6 }}>
            Market Regime
          </div>
          <div style={{ display: "flex", gap: 10, marginBottom: 4 }}>
            {["BTC", "ETH", "SOL"].map(c => {
              const r = regime[c];
              if (!r) return null;
              const col = REGIME_COLOR[r.state] ?? "#555";
              return (
                <div key={c} style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                  <span style={{ fontSize: 8, color: "#333" }}>{c}</span>
                  <span style={{
                    fontFamily: "var(--font-mono, 'IBM Plex Mono', monospace)",
                    fontSize: 10, fontWeight: 700, color: col,
                  }}>{r.state.slice(0, 5)}</span>
                </div>
              );
            })}
          </div>
          <div style={{ fontSize: 9, color: "#444" }}>
            {["BTC", "ETH", "SOL"].map(c => regime[c]?.state === "TRENDING").filter(Boolean).length >= 2
              ? "Strategy B active — trend follow"
              : ["BTC", "ETH", "SOL"].map(c => regime[c]?.state === "RANGING").filter(Boolean).length >= 2
              ? "Strategy A active — stop hunt"
              : "Mixed regime — Strategy D preferred"}
          </div>
        </div>
      ) : (
        <StatCard
          label="Market Regime"
          value="—"
          sub="loading regime detection…"
          valueColor="#333"
        />
      )}
    </div>
  );
}
