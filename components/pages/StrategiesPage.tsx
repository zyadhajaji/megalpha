"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

// ── Strategy A / B / C card ───────────────────────────────────────────────────

interface AbcCardProps {
  label: string;
  color: string;
  signal: SignalA | SignalB | SignalC | null;
}

function AbcCard({ label, color, signal }: AbcCardProps) {
  if (!signal) {
    return (
      <div style={{
        flex: 1, background: SURF,
        border: `1px solid ${BORDER}`, borderLeft: `2px solid ${color}22`,
        borderRadius: 4, padding: "12px 13px",
        display: "flex", flexDirection: "column", gap: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <span style={{ fontFamily: mono, fontSize: 8, fontWeight: 700, color, letterSpacing: "0.12em" }}>
            STRAT {label}
          </span>
        </div>
        <div style={{
          flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <span style={{ fontFamily: mono, fontSize: 9, color: "#555", letterSpacing: "0.08em" }}>
            NO SETUP
          </span>
        </div>
      </div>
    );
  }

  const conf = signal.confidence;
  const confColor = conf >= 70 ? GREEN : conf >= 50 ? AMBER : SUB;

  return (
    <div style={{
      flex: 1, background: SURF,
      border: `1px solid ${BORDER}`, borderLeft: `3px solid ${color}`,
      borderRadius: 4, padding: "12px 13px",
      display: "flex", flexDirection: "column", gap: 8,
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontFamily: mono, fontSize: 8, fontWeight: 700, color, letterSpacing: "0.12em" }}>
          STRAT {label}
        </span>
        <DirectionBadge dir={signal.direction} />
        <div style={{ flex: 1 }} />
        <span style={{ fontFamily: mono, fontSize: 9, fontWeight: 700, color: confColor }}>
          {conf}%
        </span>
      </div>

      {/* Conditions */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {signal.conditions.map((c, i) => <CondBar key={i} bar={c} />)}
      </div>

      {/* Price levels */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", borderTop: `1px solid ${BORDER}`, paddingTop: 8 }}>
        <PriceStat label="ENTRY" value={fmtPx(signal.entry)} color={TEXT} />
        <PriceStat label="SL"    value={fmtPx(signal.sl)}    color={RED} />
        <PriceStat label="TP1"   value={fmtPx(signal.tp1)}   color={GREEN} />
        {signal.rr != null && (
          <PriceStat label="R:R" value={`${signal.rr.toFixed(1)}:1`} color={AMBER} />
        )}
      </div>

      {/* Footer */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ height: 4, flex: 1, background: "#141414", borderRadius: 2, overflow: "hidden", marginRight: 10 }}>
          <div style={{
            width: `${conf}%`, height: "100%", borderRadius: 2,
            background: confColor, transition: "width 0.4s",
          }} />
        </div>
        <span style={{ fontFamily: mono, fontSize: 7, color: "#555", flexShrink: 0 }}>
          {timeAgo(signal.updated_at)}
        </span>
      </div>
    </div>
  );
}

// ── Strategy D centre panel ───────────────────────────────────────────────────

interface StratDPanelProps {
  signal: SignalD | null;
  ibEquity: number | null;
  onExecute: (signalId: string) => void;
  executing: boolean;
  execMsg: string | null;
}

function StratDPanel({ signal, ibEquity, onExecute, executing, execMsg }: StratDPanelProps) {
  if (!signal) {
    return (
      <div style={{
        flex: 1, background: SURF, border: `1px solid ${BORDER}`,
        borderRadius: 4, padding: "18px 18px",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10,
      }}>
        <span style={{ fontFamily: mono, fontSize: 8, color: "#1e1e1e", letterSpacing: "0.14em" }}>
          STRATEGY D
        </span>
        <span style={{ fontFamily: mono, fontSize: 12, color: "#555" }}>NO SETUP</span>
      </div>
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
    <div style={{
      flex: 1, background: SURF, border: `1px solid ${BORDER}`,
      borderLeft: `3px solid ${BLUE}`, borderRadius: 4,
      padding: "16px 16px", display: "flex", flexDirection: "column", gap: 12, overflow: "auto",
    }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        <span style={{ fontFamily: mono, fontSize: 8, fontWeight: 700, color: BLUE, letterSpacing: "0.12em" }}>
          STRATEGY D
        </span>
        <DirectionBadge dir={signal.direction} />
        <span style={{
          fontFamily: mono, fontSize: 8, fontWeight: 700,
          padding: "2px 7px", borderRadius: 2,
          background: `${priorityCol}18`, border: `1px solid ${priorityCol}33`,
          color: priorityCol,
        }}>
          {signal.priority}
        </span>
        <div style={{ flex: 1 }} />
        <span style={{ fontFamily: mono, fontSize: 8, color: "#555" }}>
          {timeAgo(signal.updated_at)}
        </span>
      </div>

      {/* Big score + phase */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, flexShrink: 0 }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontFamily: mono, fontSize: 48, fontWeight: 700, color: sc, lineHeight: 1 }}>
            {signal.score}
          </div>
          <div style={{ fontFamily: mono, fontSize: 8, color: SUB, marginTop: 2 }}>/ 100</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontFamily: mono, fontSize: 9, color: SUB }}>
            Phase <span style={{ color: TEXT, fontWeight: 700 }}>{signal.phase}</span>/3
          </div>
          {ibEquity != null && (
            <div style={{ fontFamily: mono, fontSize: 9, color: SUB }}>
              Equity <span style={{ color: TEXT, fontWeight: 700 }}>${ibEquity.toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
            </div>
          )}
          {signal.lot_size != null && (
            <div style={{ fontFamily: mono, fontSize: 9, color: SUB }}>
              Lots <span style={{ color: AMBER, fontWeight: 700 }}>{signal.lot_size.toFixed(2)}</span>
            </div>
          )}
        </div>
        {/* Score bar */}
        <div style={{ flex: 1, height: 8, background: "#141414", borderRadius: 4, overflow: "hidden" }}>
          <div style={{
            width: `${signal.score}%`, height: "100%", borderRadius: 4,
            background: sc, transition: "width 0.5s",
          }} />
        </div>
      </div>

      {/* Condition bars */}
      <div style={{ display: "flex", flexDirection: "column", gap: 5, flexShrink: 0 }}>
        <div style={{ fontFamily: mono, fontSize: 7, color: "#555", letterSpacing: "0.10em", marginBottom: 2 }}>
          CONDITIONS — {totalPoints}/{totalPossible} pts
        </div>
        {signal.conditions.map((c, i) => <CondBar key={i} bar={c} />)}
      </div>

      {/* Large price display */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(3, 1fr)",
        gap: 8, borderTop: `1px solid ${BORDER}`, paddingTop: 10, flexShrink: 0,
      }}>
        <div style={{
          padding: "8px 10px", background: BG, borderRadius: 3, border: `1px solid ${BORDER}`,
        }}>
          <div style={{ fontFamily: mono, fontSize: 7, color: "#555", marginBottom: 3, letterSpacing: "0.08em" }}>ENTRY</div>
          <div style={{ fontFamily: mono, fontSize: 13, fontWeight: 700, color: TEXT }}>{fmtPx(signal.entry)}</div>
        </div>
        <div style={{
          padding: "8px 10px", background: BG, borderRadius: 3, border: `1px solid ${RED2}22`,
        }}>
          <div style={{ fontFamily: mono, fontSize: 7, color: "#555", marginBottom: 3, letterSpacing: "0.08em" }}>SL</div>
          <div style={{ fontFamily: mono, fontSize: 13, fontWeight: 700, color: RED }}>{fmtPx(signal.sl)}</div>
        </div>
        <div style={{
          padding: "8px 10px", background: BG, borderRadius: 3, border: `1px solid ${GREEN2}22`,
        }}>
          <div style={{ fontFamily: mono, fontSize: 7, color: "#555", marginBottom: 3, letterSpacing: "0.08em" }}>TP1</div>
          <div style={{ fontFamily: mono, fontSize: 13, fontWeight: 700, color: GREEN }}>{fmtPx(signal.tp1)}</div>
        </div>
        {signal.tp2 != null && (
          <div style={{
            padding: "8px 10px", background: BG, borderRadius: 3, border: `1px solid ${GREEN2}18`,
          }}>
            <div style={{ fontFamily: mono, fontSize: 7, color: "#555", marginBottom: 3, letterSpacing: "0.08em" }}>TP2</div>
            <div style={{ fontFamily: mono, fontSize: 12, fontWeight: 700, color: GREEN2 }}>{fmtPx(signal.tp2)}</div>
          </div>
        )}
        {signal.tp3 != null && (
          <div style={{
            padding: "8px 10px", background: BG, borderRadius: 3, border: `1px solid ${GREEN2}12`,
          }}>
            <div style={{ fontFamily: mono, fontSize: 7, color: "#555", marginBottom: 3, letterSpacing: "0.08em" }}>TP3</div>
            <div style={{ fontFamily: mono, fontSize: 12, fontWeight: 700, color: GREEN2 }}>{fmtPx(signal.tp3)}</div>
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
            onClick={() => signal.signal_id && onExecute(signal.signal_id)}
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
  const [liveAll,    setLiveAll]    = useState<SignalLiveResponse[]>([]);
  const [selAsset,   setSelAsset]   = useState<AssetKey>("XAUUSD");
  const liveData = liveAll.find(d => d.asset === selAsset) ?? null;
  const [sessionSt,  setSessionSt]  = useState<SessionStatus | null>(null);
  const [ibSummary,  setIBSummary]  = useState<IBSummary | null>(null);
  const [executing,  setExecuting]  = useState(false);
  const [execMsg,    setExecMsg]    = useState<string | null>(null);

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

  async function handleExecute(signalId: string) {
    setExecuting(true);
    setExecMsg(null);
    try {
      const r = await fetch(`${BRIDGE_HTTP}/trade/confirm/${signalId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const d = await r.json();
      if (d.ok) {
        setExecMsg(`✓ Order placed — ${signalId}`);
        setTimeout(() => setExecMsg(null), 4000);
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

      {/* 3-column body */}
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "220px 1fr 220px", gap: 0, overflow: "hidden" }}>

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
            label="A"
            color={AMBER}
            signal={liveData?.signal_a ?? null}
          />
          <AbcCard
            label="B"
            color={GREEN}
            signal={liveData?.signal_b ?? null}
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
            label="C"
            color={AMBER}
            signal={liveData?.signal_c ?? null}
          />
          <NewsFeed events={sessionSt?.news_events ?? []} />
          <IBTracker summary={ibSummary} />
        </div>
      </div>
    </div>
  );
}
