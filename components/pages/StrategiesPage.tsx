"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { BRIDGE_HTTP } from "@/lib/bridge";

// ── Design tokens ─────────────────────────────────────────────────────────────
const mono = "var(--font-mono, 'IBM Plex Mono', monospace)";
const sans = "var(--font-sans, Inter, sans-serif)";
const GREEN  = "#4ecf8a";
const GREEN2 = "#3aaa72";
const RED    = "#cf4e4e";
const RED2   = "#aa3a3a";
const BLUE   = "#4e8ecf";
const AMBER  = "#cfad4e";
const BG     = "#070707";
const SURF   = "#0c0c0c";
const BORDER = "#1c1c1c";
const TEXT   = "#e8e8e8";
const SUB    = "#999";
const DIM    = "#666";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ConditionBar {
  label: string;
  points: number;
  possible: number;
}

interface SignalA {
  direction: "LONG" | "SHORT" | "NEUTRAL";
  confidence: number;
  entry: number | null;
  sl: number | null;
  tp1: number | null;
  rr: number | null;
  conditions: ConditionBar[];
  updated_at: number;
  signal_id?: string;
}

interface SignalB {
  direction: "LONG" | "SHORT" | "NEUTRAL";
  confidence: number;
  entry: number | null;
  sl: number | null;
  tp1: number | null;
  rr: number | null;
  conditions: ConditionBar[];
  updated_at: number;
  signal_id?: string;
}

interface SignalC {
  direction: "LONG" | "SHORT" | "NEUTRAL";
  confidence: number;
  entry: number | null;
  sl: number | null;
  tp1: number | null;
  rr: number | null;
  conditions: ConditionBar[];
  updated_at: number;
  signal_id?: string;
}

interface SignalD {
  score: number;
  direction: "LONG" | "SHORT" | "NEUTRAL";
  priority: "MAX" | "STANDARD" | "WEAK";
  entry: number | null;
  sl: number | null;
  tp1: number | null;
  tp2: number | null;
  tp3: number | null;
  lot_size: number | null;
  phase: 1 | 2 | 3;
  conditions: ConditionBar[];
  updated_at: number;
  signal_id?: string;
}

interface SignalLiveResponse {
  asset: string;
  price: number;
  session: string;
  is_primary_window: boolean;
  regime: string;
  bias: string;
  news_flag: boolean;
  blackout_active: boolean;
  volume_ratio?: number;
  trade_quality?: "PRIME" | "GOOD" | "CAUTION" | "AVOID";
  signal_a: SignalA | null;
  signal_b: SignalB | null;
  signal_c: SignalC | null;
  signal_d: SignalD | null;
}

interface SessionStatus {
  session: string;
  ny_open_secs: number;    // seconds until NY open (negative = already open)
  ny_close_secs: number;   // seconds until NY close
  is_primary_window: boolean;
  news_events: NewsEvent[];
  time_utc: string;
}

interface NewsEvent {
  title: string;
  impact: "HIGH" | "MEDIUM" | "LOW";
  mins_until: number;
}

interface IBSummary {
  today_lots: number;
  today_rebate_usd: number;
  monthly_lots: number;
  monthly_rebate_usd: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtPx(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return "—";
  return "$" + n.toLocaleString("en-US", { maximumFractionDigits: n > 100 ? 1 : 4 });
}

function fmtSecs(secs: number): string {
  const abs = Math.abs(secs);
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = abs % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function timeAgo(ts: number): string {
  const s = Math.floor(Date.now() / 1000 - ts);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function sessionColor(session: string): string {
  if (session === "NY_PRIMARY") return AMBER;
  if (session === "LONDON_OPEN") return BLUE;
  if (session === "ASIA") return "#444";
  return DIM;
}

function directionColor(dir: string): string {
  if (dir === "LONG")    return GREEN;
  if (dir === "SHORT")   return RED;
  return SUB;
}

function scoreColor(score: number): string {
  if (score >= 80) return GREEN;
  if (score >= 60) return AMBER;
  return SUB;
}

// ── Conditions Bar ────────────────────────────────────────────────────────────

function ConditionsBar({ liveAll, sessionSt }: { liveAll: SignalLiveResponse[]; sessionSt: SessionStatus | null }) {
  const quality = liveAll[0]?.trade_quality;
  const blackout = liveAll.some(d => d.blackout_active);
  const newsFlag = liveAll.some(d => d.news_flag);
  const qColor = quality === "PRIME" ? GREEN : quality === "GOOD" ? "#4e8ecf" : quality === "CAUTION" ? AMBER : RED;
  const qLabel = quality ?? "—";

  // Volume across assets
  const volRatios = liveAll.map(d => d.volume_ratio ?? 1.0);
  const avgVol = volRatios.length ? volRatios.reduce((a, b) => a + b, 0) / volRatios.length : 1.0;
  const volLabel = avgVol < 0.6 ? "LOW VOL" : avgVol > 2.0 ? "HIGH VOL" : "NORMAL VOL";
  const volColor = avgVol < 0.6 ? AMBER : avgVol > 2.0 ? GREEN : SUB;

  const isPrimary = sessionSt?.is_primary_window;

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10, flexShrink: 0,
      padding: "5px 14px", background: "#060606", borderBottom: `1px solid ${BORDER}`,
    }}>
      {/* Trade quality */}
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <span style={{ fontFamily: mono, fontSize: 7, color: SUB, letterSpacing: "0.08em" }}>TRADE NOW</span>
        <span style={{
          fontFamily: mono, fontSize: 9, fontWeight: 700, color: qColor,
          background: `${qColor}14`, border: `1px solid ${qColor}33`,
          borderRadius: 3, padding: "1px 8px",
        }}>{qLabel}</span>
      </div>

      <div style={{ width: 1, height: 12, background: BORDER }} />

      {/* Session */}
      <span style={{ fontFamily: mono, fontSize: 8, color: isPrimary ? AMBER : DIM }}>
        {isPrimary ? "⬥ NY PRIMARY WINDOW" : sessionSt ? sessionSt.session.replace(/_/g, " ") : "—"}
      </span>

      <div style={{ width: 1, height: 12, background: BORDER }} />

      {/* Volume */}
      <span style={{ fontFamily: mono, fontSize: 8, color: volColor, fontWeight: 700 }}>
        {volLabel} <span style={{ fontWeight: 400, color: DIM }}>({avgVol.toFixed(1)}×)</span>
      </span>

      {/* Warnings */}
      {blackout && (
        <span style={{
          fontFamily: mono, fontSize: 7, color: RED,
          background: "rgba(207,78,78,0.10)", border: "1px solid rgba(207,78,78,0.25)",
          borderRadius: 3, padding: "1px 7px",
        }}>■ NEWS BLACKOUT — NO ENTRIES</span>
      )}
      {!blackout && newsFlag && (
        <span style={{
          fontFamily: mono, fontSize: 7, color: AMBER,
          background: "rgba(207,173,78,0.10)", border: "1px solid rgba(207,173,78,0.25)",
          borderRadius: 3, padding: "1px 7px",
        }}>⚡ POST-EVENT SCAN ACTIVE</span>
      )}
      {quality === "AVOID" && !blackout && (
        <span style={{
          fontFamily: mono, fontSize: 7, color: SUB,
          background: "rgba(100,100,100,0.08)", border: "1px solid rgba(100,100,100,0.15)",
          borderRadius: 3, padding: "1px 7px",
        }}>Outside trading hours — monitoring only</span>
      )}
    </div>
  );
}

// ── All-Assets Summary Grid ───────────────────────────────────────────────────

function AllAssetsGrid({ liveAll, selected, onSelect }: {
  liveAll: SignalLiveResponse[];
  selected: string;
  onSelect: (a: string) => void;
}) {
  if (!liveAll.length) return null;

  return (
    <div style={{
      display: "grid", gridTemplateColumns: "repeat(4, 1fr)",
      gap: 0, borderBottom: `1px solid ${BORDER}`, flexShrink: 0,
    }}>
      {ASSETS.map(asset => {
        const d = liveAll.find(x => x.asset === asset);
        const active = selected === asset;
        const dScore = d?.signal_d?.score ?? null;
        const dDir = d?.signal_d?.direction ?? d?.signal_a?.direction ?? null;
        const hasSig = dScore != null && dScore >= 60;
        const quality = d?.trade_quality;
        const qColor = quality === "PRIME" ? GREEN : quality === "GOOD" ? "#4e8ecf" : quality === "CAUTION" ? AMBER : DIM;

        return (
          <button key={asset} onClick={() => onSelect(asset)} style={{
            background: active ? `${BLUE}0c` : "transparent",
            border: "none", borderRight: `1px solid ${BORDER}`,
            borderBottom: active ? `2px solid ${BLUE}` : "2px solid transparent",
            padding: "8px 10px", cursor: "pointer", textAlign: "left",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
              <span style={{ fontFamily: mono, fontSize: 9, fontWeight: 700, color: active ? TEXT : SUB }}>
                {asset}
              </span>
              {hasSig && (
                <span style={{
                  fontFamily: mono, fontSize: 7, fontWeight: 700,
                  color: scoreColor(dScore!),
                  background: `${scoreColor(dScore!)}14`,
                  border: `1px solid ${scoreColor(dScore!)}33`,
                  borderRadius: 2, padding: "0px 5px",
                }}>D:{dScore}</span>
              )}
              <div style={{ flex: 1 }} />
              <span style={{ fontFamily: mono, fontSize: 7, color: qColor }}>{quality ?? "—"}</span>
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              {d?.price ? (
                <span style={{ fontFamily: mono, fontSize: 8, color: DIM }}>
                  ${d.price > 100 ? d.price.toLocaleString("en-US", { maximumFractionDigits: 1 }) : d.price.toFixed(4)}
                </span>
              ) : <span style={{ fontFamily: mono, fontSize: 8, color: "#1e1e1e" }}>—</span>}
              {dDir && (
                <span style={{
                  fontFamily: mono, fontSize: 7, fontWeight: 700,
                  color: dDir === "LONG" ? GREEN : dDir === "SHORT" ? RED : DIM,
                }}>{dDir}</span>
              )}
              <span style={{ fontFamily: mono, fontSize: 7, color: "#555" }}>
                {d?.regime ?? ""}
              </span>
            </div>
            {/* Mini A/B/C indicator dots */}
            <div style={{ display: "flex", gap: 3, marginTop: 4 }}>
              {(["signal_a", "signal_b", "signal_c"] as const).map((k, i) => (
                <div key={i} style={{
                  width: 5, height: 5, borderRadius: "50%",
                  background: d?.[k] ? (d[k]!.direction === "LONG" ? GREEN2 : d[k]!.direction === "SHORT" ? RED2 : "#333") : "#1a1a1a",
                }} title={`Strategy ${["A","B","C"][i]}: ${d?.[k]?.direction ?? "no signal"}`} />
              ))}
              <span style={{ fontFamily: mono, fontSize: 6, color: "#555", marginLeft: 2 }}>A B C</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PriceStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontFamily: mono, fontSize: 7, color: "#555", letterSpacing: "0.08em" }}>
        {label}
      </span>
      <span style={{ fontFamily: mono, fontSize: 11, fontWeight: 700, color: color ?? TEXT }}>
        {value}
      </span>
    </div>
  );
}

function CondBar({ bar }: { bar: ConditionBar }) {
  const pct = bar.possible > 0 ? Math.min(100, (bar.points / bar.possible) * 100) : 0;
  const filled = bar.points > 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontFamily: sans, fontSize: 9, color: filled ? SUB : "#3a3a3a" }}>
          {bar.label}
        </span>
        <span style={{ fontFamily: mono, fontSize: 8, color: filled ? GREEN2 : "#2a2a2a" }}>
          {bar.points}/{bar.possible}
        </span>
      </div>
      <div style={{ height: 3, background: "#141414", borderRadius: 2, overflow: "hidden" }}>
        <div style={{
          width: `${pct}%`,
          height: "100%",
          background: filled ? GREEN2 : "#1c1c1c",
          borderRadius: 2,
          transition: "width 0.4s",
        }} />
      </div>
    </div>
  );
}

function DirectionBadge({ dir }: { dir: string }) {
  const col = directionColor(dir);
  return (
    <span style={{
      fontFamily: mono, fontSize: 9, fontWeight: 700,
      padding: "2px 8px", borderRadius: 2,
      background: `${col}18`, border: `1px solid ${col}33`,
      color: col, letterSpacing: "0.04em",
    }}>
      {dir === "LONG" ? "▲ LONG" : dir === "SHORT" ? "▼ SHORT" : "— NEUTRAL"}
    </span>
  );
}

// ── Entry Quality Analysis ────────────────────────────────────────────────────

function entryQuality(conf: number, rr: number | null, condsMet: number, condsTotal: number) {
  const rrOk    = rr != null && rr >= 2.0;
  const confHigh = conf >= 70;
  const allMet  = condsTotal > 0 && condsMet >= condsTotal;
  const mostMet = condsTotal > 0 && condsMet >= condsTotal * 0.75;
  if (allMet && confHigh && rrOk) return { label: "PRIME ENTRY", color: GREEN,  bg: "rgba(78,207,138,0.08)" };
  if (mostMet && conf >= 55)       return { label: "GOOD ENTRY",  color: BLUE,   bg: "rgba(78,142,207,0.08)" };
  if (conf >= 40)                  return { label: "WAIT",        color: AMBER,  bg: "rgba(207,173,78,0.06)" };
  return                                  { label: "NO SETUP",    color: "#444", bg: "transparent" };
}

interface EntryDetailProps {
  signal: SignalA | SignalB | SignalC | SignalD;
  label: string;
  stratDesc: string;
  idealSession: string;
  minRR: number;
  minConf: number;
}

function EntryDetailPanel({ signal, label, stratDesc, idealSession, minRR, minConf }: EntryDetailProps) {
  const conf       = "confidence" in signal ? signal.confidence : (signal as SignalD).score;
  const entry      = signal.entry;
  const sl         = signal.sl;
  const tp1        = signal.tp1;
  const rrRaw      = "rr" in signal ? (signal as SignalA).rr : null;
  const rr         = rrRaw ?? (entry && sl && tp1 ? Math.abs(tp1 - entry) / (Math.abs(sl - entry) + 1e-9) : null);
  const condsMet   = signal.conditions.reduce((s, c) => s + (c.points > 0 ? 1 : 0), 0);
  const condsTotal = signal.conditions.length;

  const slDist  = entry && sl  ? Math.abs(entry - sl)  : null;
  const tpDist  = entry && tp1 ? Math.abs(tp1 - entry) : null;
  const slPct   = entry && slDist ? (slDist / entry * 100) : null;

  const checks: Array<{ ok: boolean; text: string }> = [
    { ok: condsMet >= condsTotal,                text: `All ${condsTotal} conditions firing` },
    { ok: rr != null && rr >= minRR,             text: `R:R ≥ ${minRR}:1 (need ${minRR}:1 min)` },
    { ok: conf >= minConf,                        text: `Confidence ≥ ${minConf}% (current ${conf}%)` },
    { ok: sl != null && sl > 0,                  text: "Stop loss defined" },
    { ok: tp1 != null && tp1 > 0,                text: "Take profit defined" },
  ];

  return (
    <div style={{
      marginTop: 8, borderTop: `1px solid ${BORDER}`,
      paddingTop: 10, display: "flex", flexDirection: "column", gap: 8,
    }}>
      {/* Strategy description */}
      <div style={{ fontFamily: sans, fontSize: 9, color: "#666", lineHeight: 1.5 }}>
        {stratDesc}
      </div>

      {/* Checklist */}
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <span style={{ fontFamily: mono, fontSize: 7, color: "#444", letterSpacing: "0.10em", marginBottom: 2 }}>
          GOOD ENTRY REQUIRES
        </span>
        {checks.map((c, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 8, color: c.ok ? GREEN : "#333", flexShrink: 0 }}>
              {c.ok ? "✓" : "✗"}
            </span>
            <span style={{ fontFamily: sans, fontSize: 9, color: c.ok ? SUB : "#444" }}>{c.text}</span>
          </div>
        ))}
      </div>

      {/* Risk parameters */}
      {entry && sl && (
        <div style={{
          background: "#0a0a0a", borderRadius: 4, padding: "8px 10px",
          display: "flex", flexDirection: "column", gap: 5,
          border: `1px solid ${BORDER}`,
        }}>
          <span style={{ fontFamily: mono, fontSize: 7, color: "#444", letterSpacing: "0.10em" }}>
            RISK PARAMETERS
          </span>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 12px" }}>
            {[
              { l: "Entry",     v: fmtPx(entry),                           c: TEXT  },
              { l: "Stop Loss", v: fmtPx(sl) + (slPct ? ` (${slPct.toFixed(2)}%)` : ""), c: RED   },
              { l: "Target",    v: fmtPx(tp1),                             c: GREEN },
              { l: "R:R Ratio", v: rr != null ? `${rr.toFixed(2)}:1` : "—", c: rr != null && rr >= minRR ? GREEN : AMBER },
              { l: "SL Dist.",  v: slDist  ? `$${slDist.toFixed(slDist < 1 ? 4 : 1)}` : "—", c: SUB },
              { l: "TP Dist.",  v: tpDist  ? `$${tpDist.toFixed(tpDist < 1 ? 4 : 1)}` : "—", c: SUB },
            ].map((row, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontFamily: mono, fontSize: 7, color: "#555" }}>{row.l}</span>
                <span style={{ fontFamily: mono, fontSize: 9, fontWeight: 600, color: row.c }}>{row.v}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Ideal session + position tip */}
      <div style={{ display: "flex", gap: 6 }}>
        <div style={{
          flex: 1, background: "#0a0a0a", borderRadius: 3, padding: "6px 8px",
          border: `1px solid ${BORDER}`,
        }}>
          <div style={{ fontFamily: mono, fontSize: 7, color: "#444", marginBottom: 3 }}>IDEAL SESSION</div>
          <div style={{ fontFamily: mono, fontSize: 9, color: AMBER }}>{idealSession}</div>
        </div>
        <div style={{
          flex: 1, background: "#0a0a0a", borderRadius: 3, padding: "6px 8px",
          border: `1px solid ${BORDER}`,
        }}>
          <div style={{ fontFamily: mono, fontSize: 7, color: "#444", marginBottom: 3 }}>POSITION SIZE</div>
          <div style={{ fontFamily: mono, fontSize: 9, color: SUB }}>
            {slPct ? `Risk ≤1% acct per ${slPct.toFixed(1)}% SL` : "Set SL to size position"}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Strategy A / B / C card ───────────────────────────────────────────────────

const STRAT_META: Record<string, { desc: string; idealSession: string; minRR: number; minConf: number }> = {
  A: {
    desc: "Stop Hunt / Liquidity Sweep — enters after price grabs liquidity below key lows (or above highs) and reverses. Best in ranging markets where stop clusters are visible in the order book.",
    idealSession: "London Open · NY Open",
    minRR: 2.0,
    minConf: 65,
  },
  B: {
    desc: "EMA Cross Trend Follow — enters on confirmed EMA 21/55 crossover with ADX > 20. Follows the trend on 1H with 4H confirmation. Avoid during choppy/ranging regimes.",
    idealSession: "NY Primary · London",
    minRR: 1.8,
    minConf: 60,
  },
  C: {
    desc: "Gold Sniper FVG — detects Fair Value Gaps on XAUUSD and enters after price returns to fill the imbalance. 5-step confirmation: FVG detect → pullback → trendline touch → volume breakout → close at opposite gap.",
    idealSession: "London Open · NY Open",
    minRR: 2.5,
    minConf: 70,
  },
  D: {
    desc: "Unified Confluence — combines A+C conditions (8 total) requiring ≥5 hits. Highest quality setups only. Scores 60–100; only MAX or STANDARD priority signals are worth executing.",
    idealSession: "NY Primary",
    minRR: 2.0,
    minConf: 60,
  },
};

// ── Scanning animation keyframes (injected once) ─────────────────────────────
const SCAN_STYLE = `
@keyframes scanPulse { 0%,100%{opacity:1} 50%{opacity:0.35} }
@keyframes cardGlow {
  0%,100% { box-shadow: 0 0 0 1px rgba(78,142,207,0.08), 0 8px 24px rgba(0,0,0,0.4); }
  50%     { box-shadow: 0 0 0 1px rgba(78,142,207,0.18), 0 8px 32px rgba(0,0,0,0.5); }
}
@keyframes sweepBar { 0%{left:0;width:30%;opacity:0.8} 50%{left:35%;width:35%;opacity:1} 100%{left:80%;width:20%;opacity:0} }
@keyframes pixelBob { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-5px)} }
@keyframes bubblePop { 0%{transform:scale(0.5) translateY(10px);opacity:0} 65%{transform:scale(1.05) translateY(-3px);opacity:1} 100%{transform:scale(1) translateY(0);opacity:1} }
@keyframes torchFlicker { 0%,100%{opacity:0.55} 30%{opacity:0.85} 70%{opacity:0.4} }
@keyframes starTwinkle { 0%,100%{opacity:0.25} 50%{opacity:0.75} }
@keyframes goldShimmer { 0%,100%{opacity:0.3} 50%{opacity:0.65} }
@keyframes radarSpin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
@keyframes radarSegPulse { 0%,100%{opacity:0.12} 50%{opacity:0.45} }
@keyframes vizDraw { from{stroke-dashoffset:300} to{stroke-dashoffset:0} }
@keyframes vizCandle { 0%,20%{transform:scaleY(0);transform-origin:bottom center;opacity:0} 100%{transform:scaleY(1);transform-origin:bottom center;opacity:1} }
@keyframes slideUpFade { 0%{transform:translateY(16px);opacity:0} 100%{transform:translateY(0);opacity:1} }
`;

// ── Pixel-art Terraria character system ──────────────────────────────────────
// Each rect: [col, row, widthInCells, heightInCells, fillColor]
type PixR = [number, number, number, number, string];

function pxR(rects: PixR[], s: number) {
  return rects.map(([c, r, w, h, col], i) => (
    <rect key={i} x={c * s} y={r * s} width={w * s} height={h * s}
      fill={col} shapeRendering="crispEdges" />
  ));
}

/** Strategy A — THE SHADOW (hooded rogue, amber cloak) */
function PixShadow({ s = 4 }: { s?: number }) {
  const H1 = "#7a3800"; const H2 = "#3d1c00";
  const F  = "#f0c49a"; const E  = "#e02828";
  const B  = "#4e2800"; const G  = "#cfad4e"; const L = "#281400";
  return (
    <g>
      {pxR([
        [3,0, 3,1, H1],[2,1, 5,1, H1],[1,2, 7,1, H1],          // hood peak
        [1,3, 1,4, H2],[7,3, 1,4, H2],                          // hood sides
        [2,3, 5,4, F],                                           // face
        [2,4, 1,1, E],[6,4, 1,1, E],                            // eyes
        [1,7, 7,1, G],                                           // gold shoulders
        [0,8, 9,4, B],                                           // cloak body
        [2,12, 2,4, H2],[5,12, 2,4, H2],                        // legs
        [1,16, 3,1, L],[5,16, 3,1, L],                          // boots
      ], s)}
    </g>
  );
}

/** Strategy B — THE PROPHET (blue-robed mage with staff) */
function PixProphet({ s = 4 }: { s?: number }) {
  const H1 = "#3a5ea0"; const H2 = "#1e3870";
  const F  = "#f0d8b0"; const E  = "#5ad0ff";
  const R  = "#2e5490"; const G  = "#cfad4e";
  const L  = "#1a2e58"; const S  = "#8a9ab8";
  return (
    <g>
      {pxR([
        [3,0, 3,1, H2],[2,1, 5,1, H2],[4,0, 1,2, G],            // hat + tip
        [1,2, 7,1, H1],[0,3, 9,1, H1],                           // hat brim
        [2,4, 5,4, F],                                            // face
        [2,5, 1,1, E],[6,5, 1,1, E],                             // eyes
        [1,8, 7,1, G],                                            // robe band
        [0,9, 9,4, R],                                            // robe
        [1,13, 3,4, L],[5,13, 3,4, L],                           // legs
        [9,7, 1,8, S],[9,6, 2,1, S],[9,5, 3,1, S],              // staff
        [10,5, 1,2, G],                                           // staff crystal
      ], s)}
    </g>
  );
}

/** Strategy C — THE EXCAVATOR (gold miner with hard hat) */
function PixExcavator({ s = 4 }: { s?: number }) {
  const H1 = "#cfad4e"; const H2 = "#8a7430";
  const F  = "#f0c49a"; const E  = "#2a1800";
  const O  = "#7a4218"; const L  = "#4a2c0e";
  const P  = "#c87818"; const GR = "#4a9a24";
  return (
    <g>
      {pxR([
        [1,0, 7,2, H1],[0,2, 9,1, H2],                          // hard hat
        [2,3, 5,4, F],                                            // face
        [2,4, 1,1, E],[6,4, 1,1, E],                             // eyes
        [3,6, 3,1, E],                                            // grin
        [0,7, 9,5, O],                                            // overalls
        [1,9, 7,1, GR],                                           // bib accent
        [1,12, 3,4, L],[5,12, 3,4, L],                           // legs
        [0,16, 4,1, L],[5,16, 4,1, L],                           // boots
        [9,4, 2,1, P],[9,5, 2,1, P],[9,6, 1,5, H2],             // pickaxe
      ], s)}
    </g>
  );
}

/** Strategy D — THE COMMANDER (armored knight with sword) */
function PixCommander({ s = 4 }: { s?: number }) {
  const A1 = "#7a8aaa"; const A2 = "#4a5a74";
  const V  = "#cfad4e"; const E  = "#5ad0ff";
  const P  = "#2a3a54"; const S  = "#c0c8d8"; const R = "#3a5080";
  return (
    <g>
      {pxR([
        [2,0, 5,1, A2],[1,1, 7,1, A1],[0,2, 9,2, A1],           // helmet
        [1,4, 7,2, V],                                            // visor gold
        [2,3, 5,1, E],[2,6, 5,1, E],                             // eye glow
        [0,6, 9,5, A1],                                           // chest
        [1,7, 7,1, V],                                            // chest emblem
        [0,11, 4,4, P],[5,11, 4,4, P],                           // leg armor
        [0,15, 4,1, R],[5,15, 4,1, R],                           // boots
        [9,5, 1,8, S],[9,4, 2,1, S],[9,3, 3,1, S],              // sword blade
        [8,12, 2,1, V],                                           // sword guard
        [8,13, 1,2, S],                                           // sword handle
      ], s)}
    </g>
  );
}

// ── Biome Environment Backgrounds ─────────────────────────────────────────────

function BiomeDungeon() {
  return (
    <svg width="100%" height="100%" viewBox="0 0 240 108" preserveAspectRatio="xMidYMid slice" style={{ imageRendering: "pixelated" }}>
      <rect width="240" height="108" fill="#0b0810"/>
      {/* Stone bricks */}
      {Array.from({ length: 6 }, (_, row) =>
        Array.from({ length: 9 }, (_, col) => {
          const ox = row % 2 === 0 ? 0 : 13;
          return <rect key={`${row}-${col}`} x={col * 28 + ox} y={row * 16}
            width="26" height="14" fill="none" stroke="#18112a" strokeWidth="1.5" rx="0.5"/>;
        })
      )}
      {/* Torch glows */}
      <ellipse cx="22" cy="52" rx="22" ry="28" fill="rgba(207,173,78,0.09)"
        style={{ animation: "torchFlicker 1.8s ease-in-out infinite" }}/>
      <ellipse cx="218" cy="52" rx="22" ry="28" fill="rgba(207,173,78,0.07)"
        style={{ animation: "torchFlicker 2.2s ease-in-out 0.4s infinite" }}/>
      {/* Ground */}
      <rect width="240" height="16" y="92" fill="#18102a"/>
      {/* Spikes */}
      {Array.from({ length: 8 }, (_, i) => (
        <polygon key={i} points={`${i * 30 + 4},108 ${i * 30 + 15},92 ${i * 30 + 26},108`}
          fill="#28183a" stroke="#3a2050" strokeWidth="0.5"/>
      ))}
    </svg>
  );
}

function BiomeSky() {
  const stars = [20,50,80,110,150,185,215,38,95,128,170,205];
  const srows = [10,25,15, 8, 20, 12, 18, 35, 30,  22, 28, 14];
  return (
    <svg width="100%" height="100%" viewBox="0 0 240 108" preserveAspectRatio="xMidYMid slice" style={{ imageRendering: "pixelated" }}>
      <defs>
        <linearGradient id="sky-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0a1a3a"/>
          <stop offset="100%" stopColor="#142050"/>
        </linearGradient>
      </defs>
      <rect width="240" height="108" fill="url(#sky-bg)"/>
      {/* Stars */}
      {stars.map((x, i) => (
        <rect key={i} x={x} y={srows[i]} width="2" height="2" fill="white"
          style={{ animation: `starTwinkle ${1.5 + (i % 4) * 0.4}s ease-in-out ${i * 0.18}s infinite` }}/>
      ))}
      {/* Pixel clouds */}
      <rect x="22"  y="24" width="44" height="8" fill="rgba(78,142,207,0.14)" rx="4"/>
      <rect x="28"  y="18" width="32" height="10" fill="rgba(78,142,207,0.11)" rx="4"/>
      <rect x="150" y="28" width="52" height="8"  fill="rgba(78,142,207,0.11)" rx="4"/>
      {/* Ground */}
      <rect width="240" height="14" y="94" fill="#1a3a14"/>
      <rect width="240" height="6"  y="88" fill="#2a5820"/>
      {/* Trees */}
      <rect x="12"  y="80" width="6"  height="14" fill="#1a3a10"/>
      <rect x="8"   y="66" width="14" height="18" fill="#2a5818"/>
      <rect x="218" y="82" width="6"  height="12" fill="#1a3a10"/>
      <rect x="214" y="69" width="14" height="17" fill="#2a5818"/>
    </svg>
  );
}

function BiomeCave() {
  const oreX = [28,70,115,162,200];
  const oreY = [42,60,32, 68, 50];
  return (
    <svg width="100%" height="100%" viewBox="0 0 240 108" preserveAspectRatio="xMidYMid slice" style={{ imageRendering: "pixelated" }}>
      <rect width="240" height="108" fill="#110c00"/>
      {/* Rocky ceiling */}
      {[15,45,80,120,160,198,228].map((x, i) => (
        <rect key={i} x={x} y={0} width={[26,22,30,24,28,20,18][i]} height={[14,10,12,15,11,13,10][i]}
          fill="#1c1000" rx="2"/>
      ))}
      {/* Ground */}
      <rect width="240" height="16" y="92" fill="#1c1000"/>
      {/* Gold ore clusters */}
      {oreX.map((x, i) => (
        <g key={i} style={{ animation: `goldShimmer ${1.6 + i * 0.3}s ease-in-out ${i * 0.2}s infinite` }}>
          <rect x={x}   y={oreY[i]}   width="9"  height="9"  fill="#cfad4e" opacity="0.55" rx="1"/>
          <rect x={x+5} y={oreY[i]-3} width="5"  height="5"  fill="#e8c85a" opacity="0.4"  rx="1"/>
          <rect x={x+2} y={oreY[i]+7} width="4"  height="4"  fill="#cfad4e" opacity="0.3"  rx="1"/>
        </g>
      ))}
      {/* Ambient gold glow */}
      <ellipse cx="70"  cy="60" rx="30" ry="22" fill="rgba(207,173,78,0.06)"/>
      <ellipse cx="162" cy="68" rx="26" ry="18" fill="rgba(207,173,78,0.05)"/>
    </svg>
  );
}

function BiomeCastle() {
  return (
    <svg width="100%" height="100%" viewBox="0 0 240 108" preserveAspectRatio="xMidYMid slice" style={{ imageRendering: "pixelated" }}>
      <rect width="240" height="108" fill="#08080e"/>
      {/* Stone floor tiles */}
      {Array.from({ length: 6 }, (_, i) => (
        <rect key={i} x={i * 40} y="94" width="38" height="14" fill="#0e1520" stroke="#161e2e" strokeWidth="1"/>
      ))}
      {/* Stone wall pattern */}
      {Array.from({ length: 3 }, (_, row) =>
        Array.from({ length: 5 }, (_, col) => (
          <rect key={`${row}-${col}`} x={50 + col * 28} y={row * 24}
            width="26" height="22" fill="none" stroke="#0e1520" strokeWidth="1"/>
        ))
      )}
      {/* Blue banners */}
      <rect x="14" y="0" width="12" height="44" fill="#1a2a4a" rx="1"/>
      <polygon points="14,44 20,54 26,44" fill="#1a2a4a"/>
      <rect x="214" y="0" width="12" height="44" fill="#1a2a4a" rx="1"/>
      <polygon points="214,44 220,54 226,44" fill="#1a2a4a"/>
      {/* Torch glow */}
      <ellipse cx="38"  cy="52" rx="18" ry="24" fill="rgba(78,142,207,0.07)"
        style={{ animation: "torchFlicker 2.1s ease-in-out infinite" }}/>
      <ellipse cx="202" cy="52" rx="18" ry="24" fill="rgba(78,142,207,0.06)"
        style={{ animation: "torchFlicker 2.5s ease-in-out 0.3s infinite" }}/>
      {/* Pillars */}
      <rect x="30"  y="50" width="8" height="44" fill="#0e1520"/>
      <rect x="202" y="50" width="8" height="44" fill="#0e1520"/>
    </svg>
  );
}

// ── Biome + Character dispatcher ──────────────────────────────────────────────

function BiomeBackground({ label }: { label: string }) {
  if (label === "A") return <BiomeDungeon />;
  if (label === "B") return <BiomeSky />;
  if (label === "C") return <BiomeCave />;
  return <BiomeCastle />;
}

function PixelCharacter({ label, s = 4 }: { label: string; s?: number }) {
  const w = 12 * s; const h = 18 * s;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}
      style={{ imageRendering: "pixelated", overflow: "visible" }}
      shapeRendering="crispEdges">
      {label === "A" && <PixShadow s={s} />}
      {label === "B" && <PixProphet s={s} />}
      {label === "C" && <PixExcavator s={s} />}
      {label === "D" && <PixCommander s={s} />}
    </svg>
  );
}

const CHAR_NAMES: Record<string, string> = {
  A: "THE SHADOW",
  B: "THE PROPHET",
  C: "THE EXCAVATOR",
  D: "THE COMMANDER",
};

const CHAR_TAGLINES: Record<string, string> = {
  A: "Hunts liquidity sweeps",
  B: "Rides the trend wave",
  C: "Mines the price gap",
  D: "Commands all forces",
};

// ─────────────────────────────────────────────────────────────────────────────

function ScanningCard({
  label, color, meta,
  session, volRatio, regime, bias, isPrimary, onExpand,
}: {
  label: string; color: string;
  meta: { desc: string; idealSession: string; minRR: number; minConf: number };
  session?: string; volRatio?: number; regime?: string; bias?: string; isPrimary?: boolean;
  onExpand: () => void;
}) {
  const [tick, setTick] = useState(0);
  const [bubbleOpen, setBubbleOpen] = useState(false);
  const dots = ["", ".", "..", "..."][tick % 4];

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 600);
    return () => clearInterval(id);
  }, []);

  const sessionLabel = session?.replace(/_/g, " ") ?? "—";
  const sessionCol   = isPrimary ? AMBER : session?.includes("LONDON") ? BLUE : DIM;
  const volLabel     = volRatio == null ? "—" : volRatio < 0.6 ? "LOW" : volRatio > 1.8 ? "HIGH" : "NORMAL";
  const volCol       = volRatio == null ? DIM  : volRatio < 0.6 ? AMBER : volRatio > 1.8 ? GREEN : SUB;

  return (
    <>
      <style>{SCAN_STYLE}</style>
      <div
        onClick={() => { setBubbleOpen(b => !b); onExpand(); }}
        style={{
          flex: 1, minWidth: 0,
          background: "linear-gradient(160deg, rgba(18,18,22,0.92) 0%, rgba(10,10,14,0.96) 100%)",
          backdropFilter: "blur(14px)",
          border: `1px solid rgba(255,255,255,0.06)`,
          borderTop: `3px solid ${color}66`,
          borderRadius: 14,
          display: "flex", flexDirection: "column",
          cursor: "pointer",
          animation: "cardGlow 3s ease-in-out infinite",
          boxShadow: `0 0 28px ${color}0a, 0 14px 32px rgba(0,0,0,0.48)`,
          overflow: "hidden",
          transition: "box-shadow 0.2s",
        }}
      >
        {/* ── Biome scene ─────────────────────────── */}
        <div style={{ position: "relative", height: 112, overflow: "hidden", flexShrink: 0 }}>
          {/* Environment background */}
          <div style={{ position: "absolute", inset: 0 }}>
            <BiomeBackground label={label} />
          </div>

          {/* Character (bobbing when scanning) */}
          <div style={{
            position: "absolute", bottom: 8, left: "50%", transform: "translateX(-50%)",
            animation: "pixelBob 2.4s ease-in-out infinite",
            filter: `drop-shadow(0 4px 12px ${color}55)`,
          }}>
            <PixelCharacter label={label} s={4} />
          </div>

          {/* Top-left strat badge */}
          <div style={{
            position: "absolute", top: 8, left: 8,
            background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)",
            border: `1px solid ${color}44`, borderRadius: 6,
            padding: "3px 8px",
          }}>
            <span style={{ fontFamily: mono, fontSize: 10, fontWeight: 700, color, letterSpacing: "0.12em" }}>
              STRAT {label}
            </span>
          </div>

          {/* Top-right scanning indicator */}
          <div style={{
            position: "absolute", top: 8, right: 8,
            background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)",
            border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6,
            padding: "3px 8px", display: "flex", alignItems: "center", gap: 5,
          }}>
            <div style={{
              width: 5, height: 5, borderRadius: "50%", background: color,
              animation: "scanPulse 1.2s ease-in-out infinite",
              boxShadow: `0 0 6px ${color}`,
            }}/>
            <span style={{ fontFamily: mono, fontSize: 9, color: color, letterSpacing: "0.10em" }}>
              SCANNING{dots}
            </span>
          </div>

          {/* Sweep scan line at bottom of scene */}
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 2,
            overflow: "hidden", background: "rgba(0,0,0,0.4)" }}>
            <div style={{
              position: "absolute", top: 0, height: "100%",
              background: `linear-gradient(90deg, transparent, ${color}cc, transparent)`,
              animation: "sweepBar 2.4s ease-in-out infinite",
            }}/>
          </div>
        </div>

        {/* ── Character name + tagline ─────────────── */}
        <div style={{ padding: "10px 12px 6px", borderBottom: `1px solid rgba(255,255,255,0.05)` }}>
          <div style={{ fontFamily: mono, fontSize: 12, fontWeight: 700, color, letterSpacing: "0.08em",
            marginBottom: 2 }}>
            {CHAR_NAMES[label] ?? label}
          </div>
          <div style={{ fontFamily: sans, fontSize: 11, color: SUB }}>
            {CHAR_TAGLINES[label] ?? meta.desc.slice(0, 36)}
          </div>
        </div>

        {/* ── Waiting-for info ─────────────────────── */}
        <div style={{ padding: "8px 12px", display: "flex", flexDirection: "column", gap: 5 }}>
          <div style={{ fontFamily: mono, fontSize: 9, color: "#444", letterSpacing: "0.12em", marginBottom: 2 }}>
            WAITING FOR
          </div>
          <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
            <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#222", flexShrink: 0 }}/>
            <span style={{ fontFamily: sans, fontSize: 11, color: "#555" }}>
              Conf ≥ {meta.minConf}% · R:R ≥ {meta.minRR}:1
            </span>
          </div>
          <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
            <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#222", flexShrink: 0 }}/>
            <span style={{ fontFamily: sans, fontSize: 11, color: "#555" }}>
              Session: {meta.idealSession}
            </span>
          </div>
        </div>

        {/* ── Status pills ─────────────────────────── */}
        <div style={{ padding: "0 12px 10px", display: "flex", gap: 5, flexWrap: "wrap" }}>
          <span style={{ fontFamily: mono, fontSize: 9, padding: "3px 8px", borderRadius: 10,
            border: `1px solid ${sessionCol}30`, color: sessionCol, background: `${sessionCol}0c` }}>
            {sessionLabel}
          </span>
          <span style={{ fontFamily: mono, fontSize: 9, padding: "3px 8px", borderRadius: 10,
            border: `1px solid ${volCol}30`, color: volCol, background: `${volCol}0c` }}>
            {volLabel}{volRatio != null ? ` ${volRatio.toFixed(1)}×` : ""}
          </span>
          {regime && (
            <span style={{ fontFamily: mono, fontSize: 9, padding: "3px 8px", borderRadius: 10,
              border: "1px solid #1e1e1e", color: "#444" }}>{regime}</span>
          )}
          {bias && bias !== "NEUTRAL" && (
            <span style={{ fontFamily: mono, fontSize: 9, padding: "3px 8px", borderRadius: 10,
              border: `1px solid ${bias === "LONG" ? GREEN2 : RED2}40`,
              color: bias === "LONG" ? GREEN2 : RED2 }}>BIAS {bias}</span>
          )}
        </div>

        <div style={{ padding: "4px 12px 10px", fontFamily: mono, fontSize: 9, color: "#333", textAlign: "center" }}>
          tap for strategy details ↗
        </div>
      </div>
    </>
  );
}

// ── Card Modal Overlay ────────────────────────────────────────────────────────

function CardModal({
  label, color, signal, onClose, onExecute, executing, execMsg, selAsset,
  session, volRatio, regime, bias, isPrimary,
}: {
  label: string; color: string;
  signal: SignalA | SignalB | SignalC | SignalD | null;
  onClose: () => void;
  onExecute?: (id: string, p: Record<string, unknown>) => void;
  executing?: boolean; execMsg?: string | null; selAsset?: string;
  session?: string; volRatio?: number; regime?: string; bias?: string; isPrimary?: boolean;
}) {
  const meta = STRAT_META[label] ?? STRAT_META.A;
  const conf = signal ? ("confidence" in signal ? signal.confidence : (signal as SignalD).score) : 0;
  const confColor = conf >= 70 ? GREEN : conf >= 50 ? AMBER : SUB;
  const condsMet  = signal ? signal.conditions.reduce((s, c) => s + (c.points > 0 ? 1 : 0), 0) : 0;
  const quality   = signal ? entryQuality(conf, ("rr" in signal ? (signal as SignalA).rr : null), condsMet, signal.conditions.length) : null;

  const sessionLabel = session?.replace(/_/g, " ") ?? "—";
  const sessionCol   = isPrimary ? AMBER : session?.includes("LONDON") ? BLUE : DIM;
  const volLabel     = volRatio == null ? "—" : volRatio < 0.6 ? "LOW" : volRatio > 1.8 ? "HIGH" : "NORMAL";
  const volCol       = volRatio == null ? DIM  : volRatio < 0.6 ? AMBER : volRatio > 1.8 ? GREEN : SUB;

  // Close on ESC
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const isD = label === "D";
  const sigD = isD ? signal as SignalD | null : null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(0,0,0,0.75)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "16px",
        backdropFilter: "blur(4px)",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 640,
          maxHeight: "calc(100vh - 32px)",
          overflowY: "auto",
          background: "#0c0c0c",
          border: `1px solid ${color}44`,
          borderTop: `3px solid ${color}`,
          borderRadius: 8,
          padding: "20px 22px",
          display: "flex", flexDirection: "column", gap: 16,
          boxShadow: `0 24px 60px rgba(0,0,0,0.8), 0 0 0 1px ${color}18`,
        }}
      >
        {/* Modal header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontFamily: mono, fontSize: 10, fontWeight: 700, color, letterSpacing: "0.12em" }}>
            STRATEGY {label}
          </span>
          {signal ? (
            <>
              <DirectionBadge dir={signal.direction} />
              {quality && (
                <span style={{
                  fontFamily: mono, fontSize: 8, fontWeight: 700,
                  color: quality.color, background: quality.bg,
                  border: `1px solid ${quality.color}33`, borderRadius: 3, padding: "2px 8px",
                }}>{quality.label}</span>
              )}
              <span style={{ fontFamily: mono, fontSize: 11, fontWeight: 700, color: confColor, marginLeft: "auto" }}>
                {conf}{isD ? "/100" : "%"}
              </span>
            </>
          ) : (
            <span style={{ fontFamily: mono, fontSize: 9, color: "#555" }}>SCANNING — NO SETUP</span>
          )}
          <button onClick={onClose} style={{
            marginLeft: signal ? 8 : "auto",
            background: "none", border: "none", cursor: "pointer",
            color: "#555", fontSize: 16, lineHeight: 1, padding: "0 4px",
          }}>✕</button>
        </div>

        {/* Live context pills */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <span style={{ fontFamily: mono, fontSize: 8, padding: "3px 8px", borderRadius: 3, border: `1px solid ${sessionCol}33`, color: sessionCol, background: `${sessionCol}0a` }}>{sessionLabel}</span>
          <span style={{ fontFamily: mono, fontSize: 8, padding: "3px 8px", borderRadius: 3, border: `1px solid ${volCol}33`, color: volCol, background: `${volCol}0a` }}>VOL {volLabel}{volRatio != null ? ` · ${volRatio.toFixed(1)}×` : ""}</span>
          {regime && <span style={{ fontFamily: mono, fontSize: 8, padding: "3px 8px", borderRadius: 3, border: "1px solid #2a2a2a", color: "#555" }}>{regime}</span>}
          {bias && bias !== "NEUTRAL" && <span style={{ fontFamily: mono, fontSize: 8, padding: "3px 8px", borderRadius: 3, border: `1px solid ${bias === "LONG" ? GREEN2 : RED2}44`, color: bias === "LONG" ? GREEN2 : RED2 }}>BIAS {bias}</span>}
          {signal && <span style={{ fontFamily: mono, fontSize: 8, padding: "3px 8px", borderRadius: 3, border: "1px solid #1c1c1c", color: "#555" }}>Updated {timeAgo(signal.updated_at)}</span>}
        </div>

        {/* Strategy description */}
        <div style={{
          background: "#080808", borderRadius: 6, padding: "12px 14px",
          border: "1px solid #161616",
        }}>
          <div style={{ fontFamily: mono, fontSize: 7, color: "#444", letterSpacing: "0.10em", marginBottom: 6 }}>STRATEGY DESCRIPTION</div>
          <div style={{ fontFamily: sans, fontSize: 10, color: "#777", lineHeight: 1.7 }}>{meta.desc}</div>
          <div style={{ display: "flex", gap: 16, marginTop: 10 }}>
            <div>
              <div style={{ fontFamily: mono, fontSize: 7, color: "#444", marginBottom: 2 }}>IDEAL SESSION</div>
              <div style={{ fontFamily: mono, fontSize: 9, color: AMBER }}>{meta.idealSession}</div>
            </div>
            <div>
              <div style={{ fontFamily: mono, fontSize: 7, color: "#444", marginBottom: 2 }}>MIN R:R</div>
              <div style={{ fontFamily: mono, fontSize: 9, color: SUB }}>{meta.minRR}:1</div>
            </div>
            <div>
              <div style={{ fontFamily: mono, fontSize: 7, color: "#444", marginBottom: 2 }}>MIN CONF</div>
              <div style={{ fontFamily: mono, fontSize: 9, color: SUB }}>{meta.minConf}%</div>
            </div>
          </div>
        </div>

        {signal ? (
          <>
            {/* Conditions */}
            <div>
              <div style={{ fontFamily: mono, fontSize: 7, color: "#444", letterSpacing: "0.10em", marginBottom: 8 }}>
                CONDITIONS — {condsMet}/{signal.conditions.length} MET
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {signal.conditions.map((c, i) => <CondBar key={i} bar={c} />)}
              </div>
            </div>

            {/* Price levels — big grid */}
            {(signal.entry || signal.sl || signal.tp1) && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8 }}>
                {[
                  { l: "ENTRY",  v: fmtPx(signal.entry), c: TEXT,  b: "#0d0d0d", bc: BORDER },
                  { l: "STOP LOSS", v: fmtPx(signal.sl), c: RED,   b: "rgba(207,78,78,0.04)", bc: "rgba(207,78,78,0.15)" },
                  { l: "TAKE PROFIT", v: fmtPx(signal.tp1), c: GREEN, b: "rgba(78,207,138,0.04)", bc: "rgba(78,207,138,0.15)" },
                  ...(sigD?.tp2 ? [{ l: "TP2", v: fmtPx(sigD.tp2), c: GREEN2, b: "rgba(58,170,114,0.03)", bc: "rgba(58,170,114,0.1)" }] : []),
                  ...(sigD?.tp3 ? [{ l: "TP3", v: fmtPx(sigD.tp3), c: GREEN2, b: "rgba(58,170,114,0.02)", bc: "rgba(58,170,114,0.08)" }] : []),
                  ...("rr" in signal && (signal as SignalA).rr != null ? [{ l: "R:R", v: `${(signal as SignalA).rr!.toFixed(2)}:1`, c: AMBER, b: "#0d0d0d", bc: BORDER }] : []),
                ].map((row, i) => (
                  <div key={i} style={{ background: row.b, border: `1px solid ${row.bc}`, borderRadius: 5, padding: "10px 12px" }}>
                    <div style={{ fontFamily: mono, fontSize: 7, color: "#555", marginBottom: 5, letterSpacing: "0.08em" }}>{row.l}</div>
                    <div style={{ fontFamily: mono, fontSize: 15, fontWeight: 700, color: row.c }}>{row.v}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Full entry detail */}
            <EntryDetailPanel
              signal={signal} label={label}
              stratDesc={meta.desc} idealSession={meta.idealSession}
              minRR={meta.minRR} minConf={meta.minConf}
            />

            {/* Execute button (Strategy D only) */}
            {isD && sigD && sigD.score >= 60 && sigD.signal_id && onExecute && (
              <div>
                {execMsg && (
                  <div style={{
                    fontFamily: mono, fontSize: 9, marginBottom: 8,
                    color: execMsg.startsWith("✓") ? GREEN : RED,
                    background: execMsg.startsWith("✓") ? "rgba(78,207,138,0.07)" : "rgba(207,78,78,0.07)",
                    border: `1px solid ${execMsg.startsWith("✓") ? "rgba(78,207,138,0.2)" : "rgba(207,78,78,0.2)"}`,
                    borderRadius: 4, padding: "8px 12px",
                  }}>{execMsg}</div>
                )}
                <button
                  onClick={() => sigD.signal_id && onExecute(sigD.signal_id, {
                    entry: sigD.entry, sl: sigD.sl, tp: sigD.tp1,
                    coin: selAsset, direction: sigD.direction, strategy: "D",
                  })}
                  disabled={executing}
                  style={{
                    width: "100%", fontFamily: mono, fontSize: 11, fontWeight: 700,
                    padding: "12px 0", borderRadius: 5, cursor: executing ? "not-allowed" : "pointer",
                    background: sigD.direction === "LONG" ? "rgba(78,207,138,0.12)" : "rgba(207,78,78,0.12)",
                    border: `1px solid ${sigD.direction === "LONG" ? "rgba(78,207,138,0.35)" : "rgba(207,78,78,0.35)"}`,
                    color: sigD.direction === "LONG" ? GREEN : RED,
                    letterSpacing: "0.06em", transition: "all 0.15s",
                    opacity: executing ? 0.6 : 1,
                  }}
                >
                  {executing ? "PLACING…" : `▶ EXECUTE ${sigD.direction} — PAPER TRADE`}
                </button>
              </div>
            )}
          </>
        ) : (
          /* No setup — show what we're waiting for */
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontFamily: mono, fontSize: 7, color: "#444", letterSpacing: "0.10em" }}>WAITING FOR</div>
            {[
              `Confidence ≥ ${meta.minConf}%`,
              `R:R ≥ ${meta.minRR}:1`,
              "Entry + Stop Loss + Take Profit levels",
              `Session: ${meta.idealSession}`,
              label === "D" ? "Score ≥ 60/100 (need ≥5 of 8 conditions)" : "All conditions met",
            ].map((t, i) => (
              <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <span style={{ color: "#2a2a2a", fontSize: 10, marginTop: 1, flexShrink: 0 }}>○</span>
                <span style={{ fontFamily: sans, fontSize: 10, color: "#555", lineHeight: 1.5 }}>{t}</span>
              </div>
            ))}
          </div>
        )}

        <div style={{ fontFamily: mono, fontSize: 8, color: "#333", textAlign: "center" }}>
          Press ESC or click outside to close
        </div>
      </div>
    </div>
  );
}

// ── Strategy A / B / C card (compact — click opens modal) ────────────────────

interface AbcCardProps {
  label: string;
  color: string;
  signal: SignalA | SignalB | SignalC | null;
  session?: string; volRatio?: number; regime?: string; bias?: string; isPrimary?: boolean;
  onExpand: () => void;
}

function AbcCard({ label, color, signal, session, volRatio, regime, bias, isPrimary, onExpand }: AbcCardProps) {
  const [hovered, setHovered] = useState(false);
  const [bubbleOpen, setBubbleOpen] = useState(false);
  const meta = STRAT_META[label] ?? STRAT_META.A;

  if (!signal) {
    return (
      <ScanningCard
        label={label} color={color} meta={meta}
        session={session} volRatio={volRatio}
        regime={regime} bias={bias} isPrimary={isPrimary}
        onExpand={onExpand}
      />
    );
  }

  const conf      = signal.confidence;
  const confColor = conf >= 70 ? GREEN : conf >= 50 ? AMBER : SUB;
  const condsMet  = signal.conditions.reduce((s, c) => s + (c.points > 0 ? 1 : 0), 0);
  const quality   = entryQuality(conf, signal.rr, condsMet, signal.conditions.length);
  const sessionLabel = session?.replace(/_/g, " ") ?? "—";
  const sessionCol   = isPrimary ? AMBER : session?.includes("LONDON") ? BLUE : DIM;
  const volLabel     = volRatio == null ? "—" : volRatio < 0.6 ? "LOW" : volRatio > 1.8 ? "HIGH" : "NORMAL";
  const volCol       = volRatio == null ? DIM  : volRatio < 0.6 ? AMBER : volRatio > 1.8 ? GREEN : SUB;

  const dirColor = signal.direction === "LONG" ? GREEN : signal.direction === "SHORT" ? RED : SUB;

  return (
    <>
      <style>{SCAN_STYLE}</style>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => { setBubbleOpen(b => !b); onExpand(); }}
        style={{
          flex: 1, minWidth: 0,
          background: hovered
            ? "linear-gradient(160deg, rgba(24,24,28,0.96) 0%, rgba(14,14,18,0.98) 100%)"
            : "linear-gradient(160deg, rgba(18,18,22,0.92) 0%, rgba(10,10,14,0.96) 100%)",
          backdropFilter: "blur(14px)",
          border: `1px solid ${hovered ? color + "35" : "rgba(255,255,255,0.06)"}`,
          borderTop: `3px solid ${color}`,
          borderRadius: 14,
          display: "flex", flexDirection: "column",
          transition: "all 0.18s ease",
          boxShadow: hovered
            ? `0 0 32px ${color}22, 0 18px 44px rgba(0,0,0,0.55)`
            : `0 8px 26px rgba(0,0,0,0.4)`,
          cursor: "pointer",
          overflow: "hidden",
        }}
      >
        {/* ── Biome scene (compact) ───────────────── */}
        <div style={{ position: "relative", height: 88, overflow: "hidden", flexShrink: 0 }}>
          <div style={{ position: "absolute", inset: 0 }}>
            <BiomeBackground label={label} />
          </div>

          {/* Character — small, left side */}
          <div style={{
            position: "absolute", bottom: 4, left: "50%", transform: "translateX(-50%)",
            filter: `drop-shadow(0 3px 10px ${color}66)`,
            animation: "pixelBob 3s ease-in-out infinite",
          }}>
            <PixelCharacter label={label} s={3} />
          </div>

          {/* Top-left: strat badge */}
          <div style={{
            position: "absolute", top: 8, left: 8,
            background: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)",
            border: `1px solid ${color}55`, borderRadius: 6, padding: "3px 8px",
            display: "flex", alignItems: "center", gap: 6,
          }}>
            <span style={{ fontFamily: mono, fontSize: 10, fontWeight: 700, color, letterSpacing: "0.12em" }}>
              STRAT {label}
            </span>
            <DirectionBadge dir={signal.direction} />
          </div>

          {/* Top-right: confidence badge */}
          <div style={{
            position: "absolute", top: 8, right: 8,
            background: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)",
            border: `1px solid ${confColor}44`, borderRadius: 6, padding: "3px 10px",
          }}>
            <span style={{ fontFamily: mono, fontSize: 18, fontWeight: 700, color: confColor, lineHeight: 1 }}>
              {conf}<span style={{ fontSize: 10, color: `${confColor}88` }}>%</span>
            </span>
          </div>

          {/* Quality badge bottom-right when hovered */}
          {hovered && (
            <div style={{
              position: "absolute", bottom: 8, right: 8,
              background: quality.bg, border: `1px solid ${quality.color}44`,
              borderRadius: 5, padding: "2px 7px",
              animation: "bubblePop 0.3s cubic-bezier(0.34,1.56,0.64,1) both",
            }}>
              <span style={{ fontFamily: mono, fontSize: 9, fontWeight: 700, color: quality.color }}>
                {quality.label}
              </span>
            </div>
          )}
        </div>

        {/* ── Character name ───────────────────────── */}
        <div style={{ padding: "9px 12px 5px", borderBottom: `1px solid rgba(255,255,255,0.05)` }}>
          <div style={{ fontFamily: mono, fontSize: 12, fontWeight: 700, color, letterSpacing: "0.08em" }}>
            {CHAR_NAMES[label] ?? label}
          </div>
          <div style={{ fontFamily: sans, fontSize: 10, color: SUB, marginTop: 1 }}>
            {CHAR_TAGLINES[label]}
          </div>
        </div>

        {/* ── Conditions bar (compact) ─────────────── */}
        <div style={{ padding: "7px 12px 5px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
            <span style={{ fontFamily: mono, fontSize: 10, color: "#555", letterSpacing: "0.10em" }}>
              CONDITIONS
            </span>
            <span style={{ fontFamily: mono, fontSize: 11, fontWeight: 700, color: confColor }}>
              {condsMet}/{signal.conditions.length} MET
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {signal.conditions.map((c, i) => <CondBar key={i} bar={c} />)}
          </div>
        </div>

        {/* ── Price levels (BIG) ───────────────────── */}
        <div style={{ padding: "6px 12px", borderTop: `1px solid rgba(255,255,255,0.05)`,
          display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
          {[
            { label: "ENTRY", value: fmtPx(signal.entry), col: TEXT },
            { label: "SL",    value: fmtPx(signal.sl),    col: RED  },
            { label: "TP",    value: fmtPx(signal.tp1),   col: GREEN },
          ].map(row => (
            <div key={row.label} style={{
              background: "rgba(0,0,0,0.25)", borderRadius: 6, padding: "5px 7px",
              border: `1px solid rgba(255,255,255,0.04)`,
            }}>
              <div style={{ fontFamily: mono, fontSize: 9, color: "#444", marginBottom: 2, letterSpacing: "0.08em" }}>
                {row.label}
              </div>
              <div style={{ fontFamily: mono, fontSize: 13, fontWeight: 700, color: row.col }}>
                {row.value}
              </div>
            </div>
          ))}
        </div>

        {/* R:R + updated */}
        {signal.rr != null && (
          <div style={{ padding: "4px 12px", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontFamily: mono, fontSize: 10, color: AMBER, fontWeight: 700 }}>
              R:R {signal.rr.toFixed(1)}:1
            </span>
            <div style={{ flex: 1, height: 3, background: "#141414", borderRadius: 2, overflow: "hidden" }}>
              <div style={{ width: `${conf}%`, height: "100%", borderRadius: 2, background: confColor, transition: "width 0.4s" }}/>
            </div>
            <span style={{ fontFamily: mono, fontSize: 9, color: "#444" }}>
              {timeAgo(signal.updated_at)}
            </span>
          </div>
        )}

        {/* ── Status pills ─────────────────────────── */}
        <div style={{ padding: "5px 12px 10px", display: "flex", gap: 5, flexWrap: "wrap" }}>
          <span style={{ fontFamily: mono, fontSize: 9, padding: "3px 8px", borderRadius: 10,
            border: `1px solid ${sessionCol}30`, color: sessionCol, background: `${sessionCol}0c` }}>
            {sessionLabel}
          </span>
          <span style={{ fontFamily: mono, fontSize: 9, padding: "3px 8px", borderRadius: 10,
            border: `1px solid ${volCol}30`, color: volCol, background: `${volCol}0c` }}>
            {volLabel}{volRatio != null ? ` ${volRatio.toFixed(1)}×` : ""}
          </span>
          {regime && (
            <span style={{ fontFamily: mono, fontSize: 9, padding: "3px 8px", borderRadius: 10,
              border: "1px solid #1e1e1e", color: "#444" }}>{regime}</span>
          )}
          {bias && bias !== "NEUTRAL" && (
            <span style={{ fontFamily: mono, fontSize: 9, padding: "3px 8px", borderRadius: 10,
              border: `1px solid ${bias === "LONG" ? GREEN2 : RED2}40`,
              color: bias === "LONG" ? GREEN2 : RED2 }}>BIAS {bias}</span>
          )}
        </div>

        {/* Floating data bubbles (click-toggled) */}
        {bubbleOpen && (
          <div style={{
            position: "absolute", top: 96, left: 12, right: 12,
            display: "flex", gap: 6, flexWrap: "wrap",
            pointerEvents: "none",
          }}>
            {[
              { label: "DIRECTION", value: signal.direction, col: dirColor },
              { label: "CONFIDENCE", value: `${conf}%`, col: confColor },
              { label: "SESSION", value: sessionLabel, col: sessionCol },
            ].map((b, i) => (
              <div key={i} style={{
                background: "rgba(0,0,0,0.9)", backdropFilter: "blur(10px)",
                border: `1px solid ${b.col}44`, borderRadius: 8, padding: "6px 10px",
                animation: `bubblePop 0.35s cubic-bezier(0.34,1.56,0.64,1) ${i * 0.06}s both`,
              }}>
                <div style={{ fontFamily: mono, fontSize: 9, color: "#444", marginBottom: 2 }}>{b.label}</div>
                <div style={{ fontFamily: mono, fontSize: 12, fontWeight: 700, color: b.col }}>{b.value}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// ── Strategy D centre panel ───────────────────────────────────────────────────

interface StratDPanelProps {
  signal: SignalD | null;
  ibEquity: number | null;
  onExecute: (signalId: string, params?: { entry?: number | null; sl?: number | null; tp?: number | null; coin?: string; direction?: string; strategy?: string }) => void;
  executing: boolean;
  execMsg: string | null;
  selAsset?: string;
  onExpand: () => void;
  session?: string;
  volRatio?: number;
  regime?: string;
  bias?: string;
  isPrimary?: boolean;
}

function StratDPanel({ signal, ibEquity, onExecute, executing, execMsg, selAsset, onExpand, session, volRatio, regime, bias, isPrimary }: StratDPanelProps) {
  const [hovered, setHovered] = useState(false);
  const [tick,    setTick]    = useState(0);
  const dots = ["", ".", "..", "..."][tick % 4];

  useEffect(() => {
    if (signal) return;
    const id = setInterval(() => setTick(t => t + 1), 600);
    return () => clearInterval(id);
  }, [signal]);

  if (!signal) {
    const sessionLabel = session?.replace(/_/g, " ") ?? "—";
    const sessionCol   = isPrimary ? AMBER : session?.includes("LONDON") ? BLUE : DIM;
    const volLabel     = volRatio == null ? "—" : volRatio < 0.6 ? "LOW" : volRatio > 1.8 ? "HIGH" : "NORMAL";
    const volCol       = volRatio == null ? DIM  : volRatio < 0.6 ? AMBER : volRatio > 1.8 ? GREEN : SUB;

    return (
      <>
        <style>{SCAN_STYLE}</style>
        <div
          onClick={onExpand}
          style={{
            flex: 1, minWidth: 0,
            background: "linear-gradient(160deg, rgba(18,18,22,0.92) 0%, rgba(10,10,14,0.96) 100%)",
            backdropFilter: "blur(14px)",
            border: `1px solid rgba(255,255,255,0.06)`,
            borderTop: `3px solid ${BLUE}88`,
            borderRadius: 14,
            display: "flex", flexDirection: "column",
            cursor: "pointer",
            animation: "cardGlow 3s ease-in-out infinite",
            boxShadow: `0 0 32px rgba(78,142,207,0.08), 0 16px 40px rgba(0,0,0,0.5)`,
            overflow: "hidden",
          }}
        >
          {/* ── Castle biome scene ───────────────────── */}
          <div style={{ position: "relative", height: 140, overflow: "hidden", flexShrink: 0 }}>
            <div style={{ position: "absolute", inset: 0 }}>
              <BiomeCastle />
            </div>

            {/* Commander character — bigger for strategy D */}
            <div style={{
              position: "absolute", bottom: 8, left: "50%", transform: "translateX(-50%)",
              animation: "pixelBob 2.8s ease-in-out infinite",
              filter: `drop-shadow(0 4px 14px rgba(78,142,207,0.5))`,
            }}>
              <PixelCharacter label="D" s={5} />
            </div>

            {/* Strategy badge */}
            <div style={{
              position: "absolute", top: 8, left: 8,
              background: "rgba(0,0,0,0.8)", backdropFilter: "blur(8px)",
              border: `1px solid ${BLUE}55`, borderRadius: 6, padding: "3px 10px",
            }}>
              <span style={{ fontFamily: mono, fontSize: 11, fontWeight: 700, color: BLUE, letterSpacing: "0.12em" }}>
                STRAT D — UNIFIED
              </span>
            </div>

            {/* Scanning indicator */}
            <div style={{
              position: "absolute", top: 8, right: 8,
              background: "rgba(0,0,0,0.8)", backdropFilter: "blur(8px)",
              border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6,
              padding: "3px 8px", display: "flex", alignItems: "center", gap: 5,
            }}>
              <div style={{
                width: 5, height: 5, borderRadius: "50%", background: BLUE,
                animation: "scanPulse 1.2s ease-in-out infinite",
                boxShadow: `0 0 6px ${BLUE}`,
              }}/>
              <span style={{ fontFamily: mono, fontSize: 9, color: BLUE }}>SCANNING{dots}</span>
            </div>

            {/* Sweep line */}
            <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 2,
              overflow: "hidden", background: "rgba(0,0,0,0.4)" }}>
              <div style={{
                position: "absolute", top: 0, height: "100%",
                background: `linear-gradient(90deg, transparent, ${BLUE}cc, transparent)`,
                animation: "sweepBar 2.4s ease-in-out infinite",
              }}/>
            </div>
          </div>

          {/* ── Commander name ───────────────────────── */}
          <div style={{ padding: "10px 14px 6px", borderBottom: `1px solid rgba(255,255,255,0.05)` }}>
            <div style={{ fontFamily: mono, fontSize: 14, fontWeight: 700, color: BLUE, letterSpacing: "0.08em" }}>
              {CHAR_NAMES.D}
            </div>
            <div style={{ fontFamily: sans, fontSize: 11, color: SUB, marginTop: 2 }}>
              {CHAR_TAGLINES.D} · needs ≥5/8 conditions
            </div>
          </div>

          {/* ── Waiting for info ────────────────────── */}
          <div style={{ padding: "8px 14px 6px", display: "flex", flexDirection: "column", gap: 5 }}>
            <div style={{ fontFamily: mono, fontSize: 10, color: "#444", letterSpacing: "0.12em", marginBottom: 2 }}>
              AWAITING
            </div>
            {[
              "Score ≥ 60 / 100",
              "Entry · Stop Loss · Take Profit",
              `Session: ${STRAT_META.D?.idealSession ?? "NY / London"}`,
            ].map((t, i) => (
              <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#1e1e2e", flexShrink: 0 }}/>
                <span style={{ fontFamily: sans, fontSize: 11, color: "#555" }}>{t}</span>
              </div>
            ))}
          </div>

          {/* Condition progress */}
          <div style={{ padding: "6px 14px" }}>
            <div style={{ height: 3, background: "rgba(255,255,255,0.04)", borderRadius: 2,
              overflow: "hidden", position: "relative" }}>
              <div style={{
                position: "absolute", top: 0, height: "100%",
                background: `linear-gradient(90deg, transparent, ${BLUE}aa, transparent)`,
                animation: "sweepBar 2.4s ease-in-out infinite",
              }}/>
            </div>
          </div>

          {/* Status pills */}
          <div style={{ padding: "4px 14px 12px", display: "flex", gap: 5, flexWrap: "wrap" }}>
            <span style={{ fontFamily: mono, fontSize: 9, padding: "3px 8px", borderRadius: 10,
              border: `1px solid ${sessionCol}30`, color: sessionCol, background: `${sessionCol}0c` }}>
              {sessionLabel}
            </span>
            <span style={{ fontFamily: mono, fontSize: 9, padding: "3px 8px", borderRadius: 10,
              border: `1px solid ${volCol}30`, color: volCol, background: `${volCol}0c` }}>
              {volLabel}{volRatio != null ? ` ${volRatio.toFixed(1)}×` : ""}
            </span>
            {regime && (
              <span style={{ fontFamily: mono, fontSize: 9, padding: "3px 8px", borderRadius: 10,
                border: "1px solid #222", color: "#444" }}>{regime}</span>
            )}
            {bias && bias !== "NEUTRAL" && (
              <span style={{ fontFamily: mono, fontSize: 9, padding: "3px 8px", borderRadius: 10,
                border: `1px solid ${bias === "LONG" ? GREEN2 : RED2}40`,
                color: bias === "LONG" ? GREEN2 : RED2 }}>BIAS {bias}</span>
            )}
          </div>

          <div style={{ padding: "4px 14px 10px", fontFamily: mono, fontSize: 9, color: "#333", textAlign: "center" }}>
            NO SETUP — tap for details ↗
          </div>
        </div>
      </>
    );
  }

  const sc = scoreColor(signal.score);
  const dirCol = directionColor(signal.direction);
  const priorityColors: Record<string, string> = { MAX: GREEN, STANDARD: AMBER, WEAK: SUB };
  const priorityCol = priorityColors[signal.priority] ?? SUB;
  const canExecute = signal.score >= 60;

  const totalPoints = signal.conditions.reduce((a, c) => a + c.points, 0);
  const totalPossible = signal.conditions.reduce((a, c) => a + c.possible, 0);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onExpand}
      style={{
        flex: 1,
        background: hovered ? "#0e0e0e" : SURF,
        border: `1px solid ${hovered ? BLUE + "33" : BORDER}`,
        borderLeft: `3px solid ${BLUE}`, borderRadius: 4,
        padding: "16px 16px", display: "flex", flexDirection: "column", gap: 12, overflow: "auto",
        transition: "background 0.15s, border-color 0.15s, box-shadow 0.15s",
        boxShadow: hovered ? `0 4px 20px rgba(0,0,0,0.4)` : "none",
        cursor: "pointer",
      }}
    >
      {/* ── Castle biome strip (compact) ────────── */}
      <div style={{ position: "relative", height: 90, overflow: "hidden", flexShrink: 0, borderRadius: "11px 11px 0 0" }}>
        <div style={{ position: "absolute", inset: 0 }}>
          <BiomeCastle />
        </div>
        <div style={{
          position: "absolute", bottom: 5, left: "50%", transform: "translateX(-50%)",
          filter: `drop-shadow(0 3px 12px rgba(78,142,207,0.6))`,
          animation: "pixelBob 3s ease-in-out infinite",
        }}>
          <PixelCharacter label="D" s={3.5} />
        </div>
        {/* Header badges */}
        <div style={{
          position: "absolute", top: 8, left: 8,
          background: "rgba(0,0,0,0.8)", backdropFilter: "blur(8px)",
          border: `1px solid ${BLUE}55`, borderRadius: 6, padding: "3px 10px",
          display: "flex", alignItems: "center", gap: 7,
        }}>
          <span style={{ fontFamily: mono, fontSize: 11, fontWeight: 700, color: BLUE, letterSpacing: "0.12em" }}>
            STRAT D
          </span>
          <DirectionBadge dir={signal.direction} />
          <span style={{
            fontFamily: mono, fontSize: 10, fontWeight: 700,
            padding: "1px 6px", borderRadius: 4,
            background: `${priorityCol}18`, border: `1px solid ${priorityCol}33`,
            color: priorityCol,
          }}>
            {signal.priority}
          </span>
        </div>
        <div style={{
          position: "absolute", top: 8, right: 8,
          background: "rgba(0,0,0,0.8)", backdropFilter: "blur(8px)",
          border: `1px solid ${sc}44`, borderRadius: 6, padding: "3px 10px",
        }}>
          <span style={{ fontFamily: mono, fontSize: 10, color: "#444" }}>Updated </span>
          <span style={{ fontFamily: mono, fontSize: 10, color: "#666" }}>{timeAgo(signal.updated_at)}</span>
        </div>
      </div>

      {/* ── THE COMMANDER name ───────────────────── */}
      <div style={{ padding: "10px 14px 6px", borderBottom: `1px solid rgba(255,255,255,0.05)`, flexShrink: 0 }}>
        <div style={{ fontFamily: mono, fontSize: 14, fontWeight: 700, color: BLUE, letterSpacing: "0.08em" }}>
          {CHAR_NAMES.D}
        </div>
        <div style={{ fontFamily: sans, fontSize: 11, color: SUB, marginTop: 2 }}>
          {CHAR_TAGLINES.D}
        </div>
      </div>

      {/* Big score + phase */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "10px 14px", flexShrink: 0 }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontFamily: mono, fontSize: 54, fontWeight: 700, color: sc, lineHeight: 1 }}>
            {signal.score}
          </div>
          <div style={{ fontFamily: mono, fontSize: 10, color: SUB, marginTop: 2 }}>/ 100</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <div style={{ fontFamily: mono, fontSize: 11, color: SUB }}>
            Phase <span style={{ color: TEXT, fontWeight: 700, fontSize: 13 }}>{signal.phase}</span>/3
          </div>
          {ibEquity != null && (
            <div style={{ fontFamily: mono, fontSize: 11, color: SUB }}>
              Equity <span style={{ color: TEXT, fontWeight: 700 }}>${ibEquity.toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
            </div>
          )}
          {signal.lot_size != null && (
            <div style={{ fontFamily: mono, fontSize: 11, color: SUB }}>
              Lots <span style={{ color: AMBER, fontWeight: 700 }}>{signal.lot_size.toFixed(2)}</span>
            </div>
          )}
        </div>
        {/* Score bar */}
        <div style={{ flex: 1, height: 10, background: "#141414", borderRadius: 5, overflow: "hidden" }}>
          <div style={{
            width: `${signal.score}%`, height: "100%", borderRadius: 5,
            background: sc, transition: "width 0.5s",
          }} />
        </div>
      </div>

      {/* Condition bars */}
      <div style={{ display: "flex", flexDirection: "column", gap: 5, flexShrink: 0, padding: "0 14px" }}>
        <div style={{ fontFamily: mono, fontSize: 10, color: "#555", letterSpacing: "0.10em", marginBottom: 3 }}>
          CONDITIONS — {totalPoints}/{totalPossible} pts
        </div>
        {signal.conditions.map((c, i) => <CondBar key={i} bar={c} />)}
      </div>

      {/* Large price display */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(3, 1fr)",
        gap: 8, borderTop: `1px solid ${BORDER}`, padding: "10px 14px", flexShrink: 0,
      }}>
        <div style={{
          padding: "9px 11px", background: BG, borderRadius: 6, border: `1px solid ${BORDER}`,
        }}>
          <div style={{ fontFamily: mono, fontSize: 9, color: "#555", marginBottom: 4, letterSpacing: "0.08em" }}>ENTRY</div>
          <div style={{ fontFamily: mono, fontSize: 14, fontWeight: 700, color: TEXT }}>{fmtPx(signal.entry)}</div>
        </div>
        <div style={{
          padding: "9px 11px", background: BG, borderRadius: 6, border: `1px solid ${RED2}22`,
        }}>
          <div style={{ fontFamily: mono, fontSize: 9, color: "#555", marginBottom: 4, letterSpacing: "0.08em" }}>SL</div>
          <div style={{ fontFamily: mono, fontSize: 14, fontWeight: 700, color: RED }}>{fmtPx(signal.sl)}</div>
        </div>
        <div style={{
          padding: "9px 11px", background: BG, borderRadius: 6, border: `1px solid ${GREEN2}22`,
        }}>
          <div style={{ fontFamily: mono, fontSize: 9, color: "#555", marginBottom: 4, letterSpacing: "0.08em" }}>TP1</div>
          <div style={{ fontFamily: mono, fontSize: 14, fontWeight: 700, color: GREEN }}>{fmtPx(signal.tp1)}</div>
        </div>
        {signal.tp2 != null && (
          <div style={{
            padding: "9px 11px", background: BG, borderRadius: 6, border: `1px solid ${GREEN2}18`,
          }}>
            <div style={{ fontFamily: mono, fontSize: 9, color: "#555", marginBottom: 4, letterSpacing: "0.08em" }}>TP2</div>
            <div style={{ fontFamily: mono, fontSize: 13, fontWeight: 700, color: GREEN2 }}>{fmtPx(signal.tp2)}</div>
          </div>
        )}
        {signal.tp3 != null && (
          <div style={{
            padding: "9px 11px", background: BG, borderRadius: 6, border: `1px solid ${GREEN2}12`,
          }}>
            <div style={{ fontFamily: mono, fontSize: 9, color: "#555", marginBottom: 4, letterSpacing: "0.08em" }}>TP3</div>
            <div style={{ fontFamily: mono, fontSize: 13, fontWeight: 700, color: GREEN2 }}>{fmtPx(signal.tp3)}</div>
          </div>
        )}
      </div>

      {/* Execute button */}
      {canExecute && signal.signal_id && (
        <div style={{ flexShrink: 0 }}>
          {execMsg && (
            <div style={{
              fontFamily: mono, fontSize: 9,
              color: execMsg.startsWith("✓") ? GREEN : RED,
              background: execMsg.startsWith("✓") ? "rgba(78,207,138,0.07)" : "rgba(207,78,78,0.07)",
              border: `1px solid ${execMsg.startsWith("✓") ? "rgba(78,207,138,0.2)" : "rgba(207,78,78,0.2)"}`,
              borderRadius: 3, padding: "6px 9px", marginBottom: 6,
            }}>
              {execMsg}
            </div>
          )}
          <button
            onClick={() => signal.signal_id && onExecute(signal.signal_id, {
              entry: signal.entry, sl: signal.sl, tp: signal.tp1,
              coin: selAsset, direction: signal.direction, strategy: "D",
            })}
            disabled={executing}
            style={{
              width: "100%", fontFamily: mono, fontSize: 10, fontWeight: 700,
              padding: "9px 0", borderRadius: 3, cursor: executing ? "not-allowed" : "pointer",
              background: executing
                ? "#0a0a0a"
                : signal.direction === "LONG"
                  ? "rgba(78,207,138,0.10)"
                  : "rgba(207,78,78,0.10)",
              border: `1px solid ${executing ? BORDER : dirCol + "44"}`,
              color: executing ? DIM : dirCol,
              letterSpacing: "0.06em",
              opacity: executing ? 0.6 : 1,
              transition: "all 0.15s",
            }}
          >
            {executing ? "PLACING…" : `▶ EXECUTE ${signal.direction} ON HL`}
          </button>
        </div>
      )}

      {hovered && (
        <div style={{ fontFamily: mono, fontSize: 7, color: "#444", textAlign: "center" }}>
          Click to expand full detail ↗
        </div>
      )}
    </div>
  );
}

// ── Session news feed ─────────────────────────────────────────────────────────

function NewsFeed({ events }: { events: NewsEvent[] }) {
  if (events.length === 0) {
    return (
      <div style={{
        background: SURF, border: `1px solid ${BORDER}`, borderRadius: 4,
        padding: "10px 12px",
      }}>
        <div style={{ fontFamily: mono, fontSize: 7, color: "#555", letterSpacing: "0.10em", marginBottom: 6 }}>
          NEWS
        </div>
        <span style={{ fontFamily: mono, fontSize: 8, color: "#555" }}>No events in next 2h</span>
      </div>
    );
  }

  const impactColor = (i: string) =>
    i === "HIGH" ? RED : i === "MEDIUM" ? AMBER : SUB;

  return (
    <div style={{
      background: SURF, border: `1px solid ${BORDER}`, borderRadius: 4,
      padding: "10px 12px", display: "flex", flexDirection: "column", gap: 5,
    }}>
      <div style={{ fontFamily: mono, fontSize: 7, color: "#555", letterSpacing: "0.10em", marginBottom: 2 }}>
        UPCOMING NEWS
      </div>
      {events.slice(0, 6).map((ev, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            fontFamily: mono, fontSize: 7, fontWeight: 700,
            color: impactColor(ev.impact), flexShrink: 0,
            padding: "1px 4px", borderRadius: 2,
            background: `${impactColor(ev.impact)}14`,
            border: `1px solid ${impactColor(ev.impact)}22`,
          }}>
            {ev.impact.charAt(0)}
          </span>
          <span style={{ fontFamily: sans, fontSize: 9, color: SUB, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {ev.title}
          </span>
          <span style={{ fontFamily: mono, fontSize: 8, color: "#555", flexShrink: 0 }}>
            {ev.mins_until < 60
              ? `${ev.mins_until}m`
              : `${Math.floor(ev.mins_until / 60)}h${ev.mins_until % 60 > 0 ? `${ev.mins_until % 60}m` : ""}`}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── IB tracker widget ─────────────────────────────────────────────────────────

function IBTracker({ summary }: { summary: IBSummary | null }) {
  return (
    <div style={{
      background: SURF, border: `1px solid ${BORDER}`, borderRadius: 4,
      padding: "10px 12px",
    }}>
      <div style={{ fontFamily: mono, fontSize: 7, color: "#555", letterSpacing: "0.10em", marginBottom: 8 }}>
        IB REBATE TRACKER
      </div>
      {summary ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontFamily: mono, fontSize: 8, color: SUB }}>Today</span>
            <span style={{ fontFamily: mono, fontSize: 9, color: TEXT, fontWeight: 700 }}>
              {summary.today_lots.toFixed(2)} lots
              <span style={{ color: GREEN, marginLeft: 6 }}>
                +${summary.today_rebate_usd.toFixed(2)}
              </span>
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontFamily: mono, fontSize: 8, color: SUB }}>Month</span>
            <span style={{ fontFamily: mono, fontSize: 9, color: TEXT, fontWeight: 700 }}>
              {summary.monthly_lots.toFixed(2)} lots
              <span style={{ color: GREEN, marginLeft: 6 }}>
                +${summary.monthly_rebate_usd.toFixed(2)}
              </span>
            </span>
          </div>
          <div style={{ fontFamily: mono, fontSize: 7, color: "#555", marginTop: 2 }}>
            @ $3.00/std lot
          </div>
        </div>
      ) : (
        <span style={{ fontFamily: mono, fontSize: 8, color: "#555" }}>Loading…</span>
      )}
    </div>
  );
}

// ── Session status bar ────────────────────────────────────────────────────────

function SessionBar({ status }: { status: SessionStatus | null }) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  if (!status) {
    return (
      <div style={{
        height: 36, flexShrink: 0,
        background: "#090909", borderBottom: `1px solid ${BORDER}`,
        display: "flex", alignItems: "center", padding: "0 14px",
      }}>
        <span style={{ fontFamily: mono, fontSize: 8, color: "#555" }}>Loading session…</span>
      </div>
    );
  }

  const col = sessionColor(status.session);
  const isPrimary = status.is_primary_window;
  const nyOpenSecs = status.ny_open_secs - tick;
  const nyCloseSecs = status.ny_close_secs - tick;

  // NY open/close countdown
  let timeLabel: string;
  if (nyOpenSecs > 0) {
    timeLabel = `NY open in ${fmtSecs(nyOpenSecs)}`;
  } else if (nyCloseSecs > 0) {
    timeLabel = `NY close in ${fmtSecs(nyCloseSecs)}`;
  } else {
    timeLabel = "NY closed";
  }

  // News in next 2h inline
  const nearNews = (status.news_events ?? [])
    .filter(e => e.mins_until >= 0 && e.mins_until <= 120 && e.impact === "HIGH")
    .slice(0, 3);

  return (
    <div style={{
      height: 36, flexShrink: 0,
      background: "#090909", borderBottom: `1px solid ${BORDER}`,
      display: "flex", alignItems: "center", padding: "0 14px", gap: 12,
    }}>
      {/* Session name + pulse */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {isPrimary && (
          <span style={{
            display: "inline-block", width: 6, height: 6, borderRadius: "50%",
            background: AMBER,
            animation: "pulse 1.4s infinite",
          }} />
        )}
        <span style={{
          fontFamily: mono, fontSize: 9, fontWeight: 700,
          color: col, letterSpacing: "0.08em",
          background: `${col}12`, border: `1px solid ${col}2a`,
          borderRadius: 3, padding: "2px 8px",
        }}>
          {status.session.replace("_", " ")}
        </span>
      </div>

      <div style={{ width: 1, height: 16, background: BORDER }} />

      {/* NY countdown */}
      <span style={{ fontFamily: mono, fontSize: 8, color: SUB }}>
        {timeLabel}
      </span>

      <div style={{ width: 1, height: 16, background: BORDER }} />

      {/* UTC time */}
      <span style={{ fontFamily: mono, fontSize: 8, color: DIM }}>
        {status.time_utc}
      </span>

      {/* Inline high-impact news */}
      {nearNews.map((ev, i) => (
        <span key={i} style={{
          fontFamily: mono, fontSize: 7,
          color: RED, background: "rgba(207,78,78,0.08)",
          border: "1px solid rgba(207,78,78,0.2)",
          borderRadius: 2, padding: "1px 6px",
        }}>
          ⚡ {ev.title.slice(0, 28)} in {ev.mins_until}m
        </span>
      ))}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; box-shadow: 0 0 0 0 ${AMBER}88; }
          50% { opacity: 0.6; box-shadow: 0 0 0 4px ${AMBER}00; }
        }
      `}</style>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

const ASSETS = ["XAUUSD", "BTC", "ETH", "SOL"] as const;
type AssetKey = typeof ASSETS[number];

export default function StrategiesPage() {
  const [liveAll,      setLiveAll]      = useState<SignalLiveResponse[]>([]);
  const [selAsset,     setSelAsset]     = useState<AssetKey>("XAUUSD");
  const liveData = liveAll.find(d => d.asset === selAsset) ?? null;
  const [sessionSt,    setSessionSt]    = useState<SessionStatus | null>(null);
  const [ibSummary,    setIBSummary]    = useState<IBSummary | null>(null);
  const [executing,    setExecuting]    = useState(false);
  const [execMsg,      setExecMsg]      = useState<string | null>(null);
  const [expandedCard, setExpandedCard] = useState<"A"|"B"|"C"|"D"|null>(null);

  // Shared live context passed to all cards
  const ctx = {
    session:   liveData?.session ?? sessionSt?.session,
    volRatio:  liveData?.volume_ratio,
    regime:    liveData?.regime,
    bias:      liveData?.bias,
    isPrimary: liveData?.is_primary_window ?? sessionSt?.is_primary_window,
  };

  // Polling refs to avoid stale closures
  const aliveRef = useRef(true);

  const fetchLive = useCallback(async () => {
    try {
      const r = await fetch(`${BRIDGE_HTTP}/signals/live`);
      if (r.ok && aliveRef.current) {
        const data = await r.json();
        setLiveAll(Array.isArray(data) ? data : [data]);
      }
    } catch { /* offline */ }
  }, []);

  const fetchSession = useCallback(async () => {
    try {
      const r = await fetch(`${BRIDGE_HTTP}/session/status`);
      if (r.ok && aliveRef.current) setSessionSt(await r.json() as SessionStatus);
    } catch { /* offline */ }
  }, []);

  const fetchIB = useCallback(async () => {
    try {
      const r = await fetch(`${BRIDGE_HTTP}/ib/summary`);
      if (r.ok && aliveRef.current) setIBSummary(await r.json() as IBSummary);
    } catch { /* offline */ }
  }, []);

  useEffect(() => {
    aliveRef.current = true;

    fetchLive();
    fetchSession();
    fetchIB();

    const id1 = setInterval(fetchLive,    15_000);
    const id2 = setInterval(fetchSession,  5_000);
    const id3 = setInterval(fetchIB,      60_000);

    return () => {
      aliveRef.current = false;
      clearInterval(id1);
      clearInterval(id2);
      clearInterval(id3);
    };
  }, [fetchLive, fetchSession, fetchIB]);

  async function handleExecute(signalId: string, params?: {
    entry?: number | null; sl?: number | null; tp?: number | null;
    coin?: string; direction?: string; strategy?: string;
  }) {
    setExecuting(true);
    setExecMsg(null);
    try {
      const r = await fetch(`${BRIDGE_HTTP}/trade/confirm/${signalId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entry:     params?.entry     ?? 0,
          sl:        params?.sl        ?? 0,
          tp:        params?.tp        ?? 0,
          coin:      params?.coin      ?? "",
          direction: params?.direction ?? "",
          strategy:  params?.strategy  ?? "",
        }),
      });
      const d = await r.json() as { ok?: boolean; error?: string; mode?: string; coin?: string; direction?: string };
      if (d.ok) {
        const label = d.coin ? `${d.coin} ${d.direction} (${d.mode ?? "paper"})` : signalId;
        setExecMsg(`✓ Order placed — ${label}`);
        setTimeout(() => setExecMsg(null), 5000);
      } else {
        setExecMsg(`✕ ${d.error ?? "Failed to execute"}`);
      }
    } catch {
      setExecMsg("✕ Bridge offline");
    } finally {
      setExecuting(false);
    }
  }

  const ibEquity = ibSummary
    ? undefined  // IBSummary doesn't carry equity; fetched from /ib/summary separately
    : null;

  // Extract equity from signal_d phase context if available
  const equity: number | null = null;

  const modalSignal = expandedCard === "A" ? liveData?.signal_a
    : expandedCard === "B" ? liveData?.signal_b
    : expandedCard === "C" ? liveData?.signal_c
    : expandedCard === "D" ? liveData?.signal_d
    : null;

  return (
    <div style={{
      height: "100%", display: "flex", flexDirection: "column",
      overflowY: "auto", overflowX: "hidden", background: BG,
      WebkitOverflowScrolling: "touch",
      paddingBottom: "calc(var(--bottom-nav-h, 56px) + env(safe-area-inset-bottom, 0px))",
    }}>
      {/* Session status bar */}
      <SessionBar status={sessionSt} />

      {/* Conditions warning bar */}
      <ConditionsBar liveAll={liveAll} sessionSt={sessionSt} />

      {/* All-assets summary grid — always visible */}
      <AllAssetsGrid liveAll={liveAll} selected={selAsset} onSelect={(a) => setSelAsset(a as AssetKey)} />

      {/* Card detail modal */}
      {expandedCard && (
        <CardModal
          label={expandedCard}
          color={expandedCard === "B" ? GREEN : expandedCard === "D" ? BLUE : AMBER}
          signal={modalSignal ?? null}
          onClose={() => setExpandedCard(null)}
          onExecute={handleExecute}
          executing={executing}
          execMsg={execMsg}
          selAsset={selAsset}
          {...ctx}
        />
      )}

      {/* 3-column body — balanced proportions */}
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "minmax(200px, 260px) 1fr minmax(200px, 260px)", gap: 0, overflow: "hidden", minWidth: 0 }}>

        {/* ── LEFT column: Strategy A + Strategy B ── */}
        <div style={{
          borderRight: `1px solid ${BORDER}`,
          display: "flex", flexDirection: "column", gap: 6,
          padding: "10px 10px", overflow: "auto",
        }}>
          <div style={{
            fontFamily: mono, fontSize: 7, color: "#555",
            letterSpacing: "0.12em", marginBottom: 2, flexShrink: 0,
          }}>
            RANGE / TREND
          </div>
          <AbcCard
            label="A" color={AMBER}
            signal={liveData?.signal_a ?? null}
            onExpand={() => setExpandedCard("A")}
            {...ctx}
          />
          <AbcCard
            label="B" color={GREEN}
            signal={liveData?.signal_b ?? null}
            onExpand={() => setExpandedCard("B")}
            {...ctx}
          />

          {/* Asset + regime context */}
          {liveData && (
            <div style={{
              marginTop: 6, padding: "8px 10px",
              background: SURF, border: `1px solid ${BORDER}`,
              borderRadius: 4, display: "flex", flexDirection: "column", gap: 4,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontFamily: mono, fontSize: 8, color: SUB }}>Asset</span>
                <span style={{ fontFamily: mono, fontSize: 9, fontWeight: 700, color: TEXT }}>
                  {liveData.asset}
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontFamily: mono, fontSize: 8, color: SUB }}>Price</span>
                <span style={{ fontFamily: mono, fontSize: 9, fontWeight: 700, color: TEXT }}>
                  {fmtPx(liveData.price)}
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontFamily: mono, fontSize: 8, color: SUB }}>Regime</span>
                <span style={{ fontFamily: mono, fontSize: 8, fontWeight: 700, color: AMBER }}>
                  {liveData.regime}
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontFamily: mono, fontSize: 8, color: SUB }}>Bias</span>
                <span style={{
                  fontFamily: mono, fontSize: 8, fontWeight: 700,
                  color: liveData.bias === "LONG" ? GREEN : liveData.bias === "SHORT" ? RED : SUB,
                }}>
                  {liveData.bias}
                </span>
              </div>
              {liveData.news_flag && (
                <div style={{
                  fontFamily: mono, fontSize: 7,
                  color: RED, background: "rgba(207,78,78,0.08)",
                  border: "1px solid rgba(207,78,78,0.2)",
                  borderRadius: 2, padding: "2px 6px", textAlign: "center", marginTop: 2,
                }}>
                  ⚡ NEWS ACTIVE
                </div>
              )}
              {liveData.blackout_active && (
                <div style={{
                  fontFamily: mono, fontSize: 7,
                  color: AMBER, background: "rgba(207,173,78,0.08)",
                  border: "1px solid rgba(207,173,78,0.2)",
                  borderRadius: 2, padding: "2px 6px", textAlign: "center",
                }}>
                  ■ BLACKOUT
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── CENTRE column: Strategy D ── */}
        <div style={{
          borderRight: `1px solid ${BORDER}`,
          display: "flex", flexDirection: "column",
          padding: "10px 12px", overflow: "hidden",
        }}>
          <div style={{
            fontFamily: mono, fontSize: 7, color: "#555",
            letterSpacing: "0.12em", marginBottom: 8, flexShrink: 0,
          }}>
            SIGNAL COMMAND — UNIFIED (D)
          </div>
          <StratDPanel
            signal={liveData?.signal_d ?? null}
            ibEquity={equity}
            onExecute={handleExecute}
            executing={executing}
            execMsg={execMsg}
            selAsset={selAsset}
            onExpand={() => setExpandedCard("D")}
            {...ctx}
          />
        </div>

        {/* ── RIGHT column: Strategy C + News + IB ── */}
        <div style={{
          display: "flex", flexDirection: "column", gap: 6,
          padding: "10px 10px", overflow: "auto",
        }}>
          <div style={{
            fontFamily: mono, fontSize: 7, color: "#555",
            letterSpacing: "0.12em", marginBottom: 2, flexShrink: 0,
          }}>
            GOLD / SESSION / IB
          </div>
          <AbcCard
            label="C" color={AMBER}
            signal={liveData?.signal_c ?? null}
            onExpand={() => setExpandedCard("C")}
            {...ctx}
          />
          <NewsFeed events={sessionSt?.news_events ?? []} />
          <IBTracker summary={ibSummary} />
        </div>
      </div>
    </div>
  );
}
