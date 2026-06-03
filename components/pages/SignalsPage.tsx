"use client";

import { useEffect, useState, useCallback } from "react";
import type { AISignal } from "@/lib/types";
import { BRIDGE_HTTP } from "@/lib/bridge";

const mono = "var(--font-mono, 'IBM Plex Mono', monospace)";
const sans = "var(--font-sans, Inter, sans-serif)";
const GREEN  = "#4ecf8a", GREEN_DIM = "rgba(78,207,138,0.08)", GREEN_BD = "rgba(78,207,138,0.2)";
const RED    = "#cf4e4e", RED_DIM   = "rgba(207,78,78,0.08)",  RED_BD   = "rgba(207,78,78,0.2)";
const AMBER  = "#cfad4e";
const BORDER = "#1c1c1c";

type FilterMode = "ALL" | "LONG" | "SHORT";

export interface AISignalPanelProps {
  /** When set, cards matching this coin+dir get a ◈ link indicator */
  consensusCoin?: string;
  consensusDir?: "LONG" | "SHORT";
}

function fmtPx(n: number) {
  if (!n || !isFinite(n)) return "—";
  return "$" + n.toLocaleString("en-US", { maximumFractionDigits: n > 100 ? 1 : 4 });
}

function fmtAge(ts: number) {
  const s = Math.floor(Date.now() / 1000) - ts;
  if (s < 60)   return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function SignalCard({ sig, linked }: { sig: AISignal; linked: boolean }) {
  const isLong  = sig.signal === "LONG";
  const isShort = sig.signal === "SHORT";
  const color   = isLong ? GREEN : isShort ? RED : "#888";
  const dimBg   = isLong ? GREEN_DIM : isShort ? RED_DIM : "rgba(100,100,100,0.05)";
  const border  = isLong ? GREEN_BD  : isShort ? RED_BD  : "rgba(100,100,100,0.1)";
  const summary = sig.summary ?? ({} as NonNullable<typeof sig.summary>);

  return (
    <div style={{
      border: `1px solid ${linked ? (isLong ? "rgba(78,207,138,0.45)" : "rgba(207,78,78,0.45)") : border}`,
      borderLeft: `3px solid ${color}`,
      borderRadius: 4,
      background: linked ? (isLong ? "rgba(78,207,138,0.11)" : "rgba(207,78,78,0.11)") : dimBg,
      padding: "11px 13px",
      display: "flex",
      flexDirection: "column",
      gap: 7,
    }}>
      {/* Row 1: coin · signal · confidence · linked indicator · age */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontFamily: sans, fontWeight: 800, fontSize: 14, color: "#e8e8e8" }}>
          {sig.coin}
        </span>
        <span style={{ fontFamily: mono, fontSize: 8, color: "#444" }}>/USDC · {sig.interval}</span>
        <span style={{
          fontFamily: mono, fontSize: 10, fontWeight: 700,
          color, padding: "2px 8px",
          background: isLong ? "rgba(78,207,138,0.12)" : isShort ? "rgba(207,78,78,0.12)" : "rgba(100,100,100,0.1)",
          border: `1px solid ${border}`, borderRadius: 2,
        }}>
          {isLong ? "↑ LONG" : isShort ? "↓ SHORT" : "— HOLD"}
        </span>
        <span style={{ fontFamily: sans, fontWeight: 700, fontSize: 13, color }}>
          {sig.confidence}%
        </span>
        {linked && (
          <span style={{ fontFamily: mono, fontSize: 9, color, marginLeft: 2 }} title="Strategy scanner agrees">
            ◈
          </span>
        )}
        <span style={{ fontFamily: mono, fontSize: 8, color: "#333", marginLeft: "auto" }}>
          {fmtAge(sig.created_at)}
        </span>
      </div>

      {/* Row 2: entry / SL / TP / RR */}
      {(summary.entry || summary.stop_loss || summary.take_profit) ? (
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <StatPill label="ENTRY" value={fmtPx(summary.entry)}      color="#e8e8e8" />
          <StatPill label="SL"    value={fmtPx(summary.stop_loss)}   color={RED} />
          <StatPill label="TP"    value={fmtPx(summary.take_profit)} color={GREEN} />
          {summary.risk_reward && (
            <StatPill label="R:R" value={summary.risk_reward}        color={AMBER} />
          )}
          {sig.support > 0 && (
            <StatPill label="SUP" value={fmtPx(sig.support)}         color="#3aaa72" />
          )}
          {sig.resistance > 0 && (
            <StatPill label="RES" value={fmtPx(sig.resistance)}      color="#aa3a3a" />
          )}
        </div>
      ) : null}

      {/* Row 3: key factors */}
      {summary.key_factors?.length > 0 && (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {summary.key_factors.map((f: string, i: number) => (
            <span key={i} style={{
              fontFamily: mono, fontSize: 8,
              color: "#555", background: "#111",
              border: "1px solid #1c1c1c",
              borderRadius: 2, padding: "2px 6px",
            }}>
              {f}
            </span>
          ))}
        </div>
      )}

      {/* Row 4: reasoning */}
      {sig.reasoning && (
        <p style={{
          fontFamily: mono, fontSize: 9, color: "#555",
          lineHeight: 1.65, margin: 0,
        }}>
          {sig.reasoning}
        </p>
      )}
    </div>
  );
}

function StatPill({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <div style={{ fontFamily: mono, fontSize: 7, color: "#2a2a2a", marginBottom: 1 }}>{label}</div>
      <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 11, color }}>{value}</div>
    </div>
  );
}

export function AISignalPanel({ consensusCoin, consensusDir }: AISignalPanelProps = {}) {
  const [signals, setSignals]         = useState<AISignal[]>([]);
  const [filter, setFilter]           = useState<FilterMode>("ALL");
  const [interval, setInterval_]      = useState<"1h" | "4h">("1h");
  const [scanning, setScanning]       = useState(false);
  const [lastScan, setLastScan]       = useState<number | null>(null);
  const [marketCount, setMarketCount] = useState<number>(0);

  const load = useCallback(async (iv: string) => {
    try {
      const r = await fetch(`${BRIDGE_HTTP}/ai/signals/all?interval=${iv}`);
      if (r.ok) {
        setSignals(await r.json());
        setLastScan(Date.now());
      }
    } catch { /* bridge offline */ }
  }, []);

  useEffect(() => { load(interval); }, [interval, load]);

  useEffect(() => {
    const id = setInterval(() => load(interval), 15_000);
    return () => clearInterval(id);
  }, [interval, load]);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${BRIDGE_HTTP}/markets`);
        if (r.ok) setMarketCount((await r.json()).length);
      } catch {}
    })();
  }, []);

  async function triggerScan() {
    if (scanning) return;
    setScanning(true);
    try { await fetch(`${BRIDGE_HTTP}/ai/signals/scan`, { method: "POST" }); } catch {}
    setTimeout(() => { load(interval); setScanning(false); }, 60_000);
  }

  const displayed = signals.filter(s =>
    filter === "ALL" ? true : s.signal === filter
  );
  const longCount  = signals.filter(s => s.signal === "LONG").length;
  const shortCount = signals.filter(s => s.signal === "SHORT").length;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Panel header */}
      <div style={{
        padding: "8px 12px",
        borderBottom: `1px solid ${BORDER}`,
        display: "flex", alignItems: "center", gap: 8, flexShrink: 0,
        background: "#0a0a0a",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <div style={{ width: 5, height: 5, borderRadius: "50%", background: GREEN, boxShadow: `0 0 5px ${GREEN}` }} />
          <span style={{ fontFamily: mono, fontSize: 8, color: "#444", letterSpacing: "0.10em" }}>
            AI SIGNALS
          </span>
        </div>

        {marketCount > 0 && (
          <span style={{ fontFamily: mono, fontSize: 8, color: "#222" }}>{marketCount} markets</span>
        )}

        {/* Interval toggle */}
        <div style={{ display: "flex", gap: 2, marginLeft: 4 }}>
          {(["1h", "4h"] as const).map(iv => (
            <button key={iv} onClick={() => setInterval_(iv)} style={{
              fontFamily: mono, fontSize: 8, padding: "2px 6px",
              background: interval === iv ? "#101e30" : "none",
              border: `1px solid ${interval === iv ? "#1c3050" : "transparent"}`,
              borderRadius: 2, color: interval === iv ? "#4e8ecf" : "#444", cursor: "pointer",
            }}>{iv}</button>
          ))}
        </div>

        {/* Filter chips */}
        <div style={{ display: "flex", gap: 3 }}>
          {(["ALL", "LONG", "SHORT"] as FilterMode[]).map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              fontFamily: mono, fontSize: 8, padding: "2px 6px",
              background: filter === f
                ? (f === "LONG" ? "rgba(78,207,138,0.1)" : f === "SHORT" ? "rgba(207,78,78,0.1)" : "#111")
                : "none",
              border: `1px solid ${filter === f
                ? (f === "LONG" ? GREEN_BD : f === "SHORT" ? RED_BD : "#2a2a2a")
                : "transparent"}`,
              borderRadius: 2,
              color: filter === f ? (f === "LONG" ? GREEN : f === "SHORT" ? RED : "#e8e8e8") : "#333",
              cursor: "pointer",
            }}>{f}</button>
          ))}
        </div>

        {/* Counts */}
        <span style={{ fontFamily: mono, fontSize: 8, color: GREEN }}>{longCount}↑</span>
        <span style={{ fontFamily: mono, fontSize: 8, color: RED }}>{shortCount}↓</span>

        <div style={{ flex: 1 }} />

        {lastScan && (
          <span style={{ fontFamily: mono, fontSize: 7, color: "#2a2a2a" }}>
            {new Date(lastScan).toLocaleTimeString()}
          </span>
        )}

        <button onClick={triggerScan} disabled={scanning} style={{
          fontFamily: mono, fontSize: 8, padding: "3px 8px",
          background: scanning ? "#0f1a12" : "#101e30",
          border: `1px solid ${scanning ? "#1c3a28" : "#1c3a60"}`,
          borderRadius: 2,
          color: scanning ? GREEN : "#4e8ecf",
          cursor: scanning ? "default" : "pointer",
          opacity: scanning ? 0.7 : 1,
        }}>
          {scanning ? "SCANNING…" : "SCAN NOW"}
        </button>
      </div>

      {/* Signal list */}
      <div style={{
        flex: 1, overflowY: "auto",
        padding: 10, display: "flex", flexDirection: "column", gap: 7,
      }}>
        {displayed.length === 0 ? (
          <div style={{
            flex: 1, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", gap: 6, paddingTop: 40,
          }}>
            <div style={{ fontFamily: mono, fontSize: 9, color: "#2a2a2a", letterSpacing: "0.1em" }}>
              {signals.length === 0 ? "NO SIGNALS YET" : `NO ${filter} SIGNALS`}
            </div>
            <div style={{ fontFamily: mono, fontSize: 8, color: "#1a1a1a" }}>
              {signals.length === 0 ? "Click SCAN NOW or wait for auto-scan" : "Try a different filter"}
            </div>
          </div>
        ) : (
          displayed.map(sig => {
            const linked = !!(
              consensusCoin &&
              consensusDir &&
              sig.coin === consensusCoin &&
              sig.signal === consensusDir
            );
            return (
              <SignalCard
                key={sig.id ?? `${sig.coin}-${sig.created_at}`}
                sig={sig}
                linked={linked}
              />
            );
          })
        )}
      </div>
    </div>
  );
}

export default function SignalsPage() {
  return <AISignalPanel />;
}
