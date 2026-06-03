"use client";

import { useCallback, useEffect, useState } from "react";
import { BRIDGE_HTTP } from "@/lib/bridge";
import { AISignalPanel } from "./SignalsPage";

const mono = "var(--font-mono, 'IBM Plex Mono', monospace)";
const sans = "var(--font-sans, Inter, sans-serif)";
const GREEN = "#4ecf8a", RED = "#cf4e4e", BLUE = "#4e8ecf", AMBER = "#cfad4e";

// ── Types ─────────────────────────────────────────────────────────────────────

type Coin     = "BTC" | "ETH" | "SOL" | "PAXG";
type Interval = "1h" | "4h";
type StratKey = "A" | "B" | "C" | "D";

interface RegimeCoin {
  state:       "RANGING" | "TRENDING" | "TRANSITION" | "HALTED";
  adx:         number;
  bb_width:    number;
  ma_sep:      number;
  score:       number;
  consecutive: number;
}

interface StratResult {
  direction:   "long" | "short";
  score?:      number;
  entry?:      number;
  sl?:         number;
  tp1?:        number;
  tp2?:        number;
  tp3?:        number;
  rr?:         number;
  min_rr?:     number;
  conditions?: Record<string, boolean | number | string>;
  [key: string]: unknown;
}

interface ScanResult {
  A:        StratResult | null;
  B:        StratResult | null;
  C:        StratResult | null;
  D:        StratResult | null;
  regime:   RegimeCoin;
  coin:     string;
  interval: string;
  candles:  number;
}

type ExecMode   = "stopped" | "paper" | "live";
type ExecBroker = "hl" | "mt5" | "both";

interface AutoExecStatus {
  mode:            ExecMode;
  broker:          ExecBroker;
  hl_configured:   boolean;
  mt5_configured:  boolean;
  live_halted:  boolean;
  next_scan_ts: number;
  secs_to_scan: number;
  log:          AutoExecEntry[];
  paper: {
    equity:    number;
    start:     number;
    pnl:       number;
    positions: Record<string, PaperPosition>;
    trades:    PaperTrade[];
  };
}

interface AutoExecEntry {
  ts:         number;
  coin:       string;
  interval:   string;
  direction:  "LONG" | "SHORT";
  entry:      number;
  sl:         number;
  tp:         number;
  strategies: string[];
  mode:       string;
  ok:         boolean;
  error?:     string;
}

interface PaperPosition {
  direction: "LONG" | "SHORT";
  entry:     number;
  sl:        number;
  tp:        number;
  size_usd:  number;
  leverage:  number;
  opened_at: number;
  strategy:  string;
}

interface PaperTrade {
  coin:       string;
  direction:  string;
  entry:      number;
  exit:       number;
  pnl_usd:   number;
  result:     "TP" | "SL";
  opened_at:  number;
  closed_at:  number;
  strategy:   string;
}

interface Consensus {
  direction:  "LONG" | "SHORT";
  strategies: string[];
  bestStrat:  string;
  bestScore:  number;
  bestEntry:  number;
  bestSL:     number;
  bestTP:     number;
}

interface ConfirmState {
  strat:     string;
  direction: "LONG" | "SHORT";
  entry:     number;
  sl:        number;
  tp:        number;
  coin:      string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function regimeColor(state: string) {
  if (state === "TRENDING")   return GREEN;
  if (state === "RANGING")    return AMBER;
  if (state === "HALTED")     return RED;
  return "#555";
}

function regimeBg(state: string) {
  if (state === "TRENDING")   return "rgba(78,207,138,0.07)";
  if (state === "RANGING")    return "rgba(207,173,78,0.07)";
  if (state === "HALTED")     return "rgba(207,78,78,0.1)";
  return "transparent";
}

function stratColor(s: StratKey) {
  return s === "A" ? AMBER : s === "B" ? GREEN : s === "C" ? RED : BLUE;
}

function stratActive(state: string, s: StratKey) {
  if (s === "C" || s === "D") return true;
  if (s === "A") return state === "RANGING" || state === "TRANSITION";
  if (s === "B") return state === "TRENDING" || state === "TRANSITION";
  return false;
}

function fmtPx(n: unknown) {
  const v = Number(n);
  if (!v || !isFinite(v)) return "—";
  return "$" + v.toLocaleString("en-US", { maximumFractionDigits: v > 100 ? 1 : 4 });
}

function getConsensus(result: ScanResult | null): Consensus | null {
  if (!result) return null;
  const keys: StratKey[] = ["A", "B", "C", "D"];
  const longs: StratKey[]  = [];
  const shorts: StratKey[] = [];
  for (const k of keys) {
    const r = result[k];
    if (!r) continue;
    if (r.direction === "long")  longs.push(k);
    if (r.direction === "short") shorts.push(k);
  }
  const winners = longs.length >= 2 ? longs : shorts.length >= 2 ? shorts : null;
  if (!winners) return null;
  const dir = longs.length >= 2 ? "LONG" : "SHORT";
  const sorted = winners
    .map(k => ({ k, r: result[k] as StratResult }))
    .sort((a, b) => ((b.r.score ?? b.r.rr ?? 0) - (a.r.score ?? a.r.rr ?? 0)));
  const best = sorted[0];
  return {
    direction:  dir,
    strategies: winners,
    bestStrat:  best.k,
    bestScore:  best.r.score ?? 0,
    bestEntry:  best.r.entry ?? 0,
    bestSL:     best.r.sl ?? 0,
    bestTP:     best.r.tp1 ?? 0,
  };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div style={{ fontFamily: mono, fontSize: 7, color: "#2a2a2a", letterSpacing: "0.06em", marginBottom: 1 }}>
        {label}
      </div>
      <div style={{ fontFamily: mono, fontSize: 11, fontWeight: 600, color: color ?? "#888" }}>
        {value}
      </div>
    </div>
  );
}

function RegimeStrip({ regime }: { regime: Record<Coin, RegimeCoin> | null }) {
  const coins: Coin[] = ["BTC", "ETH", "SOL"];
  return (
    <div style={{
      height: 36, flexShrink: 0,
      background: "#0c0c0c",
      borderBottom: "1px solid #1a1a1a",
      display: "flex", alignItems: "center",
      padding: "0 14px", gap: 8,
    }}>
      <span style={{ fontFamily: mono, fontSize: 8, color: "#2a2a2a", letterSpacing: "0.10em", marginRight: 4 }}>
        REGIME
      </span>
      {regime ? coins.map(coin => {
        const r = regime[coin];
        if (!r) return null;
        const col = regimeColor(r.state);
        const activeStrats = (["A","B","C","D"] as StratKey[]).filter(s => stratActive(r.state, s));
        return (
          <div key={coin} style={{
            display: "flex", alignItems: "center", gap: 6,
            background: regimeBg(r.state),
            border: `1px solid ${col}22`,
            borderRadius: 3, padding: "3px 8px",
          }}>
            <span style={{ fontFamily: mono, fontSize: 9, fontWeight: 700, color: "#e8e8e8" }}>{coin}</span>
            <span style={{
              fontFamily: mono, fontSize: 8, fontWeight: 700, color: col,
              background: `${col}18`, border: `1px solid ${col}33`,
              borderRadius: 2, padding: "1px 5px",
            }}>{r.state}</span>
            <span style={{ fontFamily: mono, fontSize: 8, color: col }}>ADX {r.adx.toFixed(0)}</span>
            <div style={{ display: "flex", gap: 2 }}>
              {(["A","B","C","D"] as StratKey[]).map(s => {
                const on = activeStrats.includes(s);
                const sc = stratColor(s);
                return (
                  <span key={s} style={{
                    fontFamily: mono, fontSize: 7,
                    color: on ? sc : "#2a2a2a",
                    background: on ? `${sc}18` : "transparent",
                    border: `1px solid ${on ? `${sc}33` : "#1a1a1a"}`,
                    borderRadius: 2, padding: "0px 3px",
                  }}>{s}</span>
                );
              })}
            </div>
          </div>
        );
      }) : (
        <span style={{ fontFamily: mono, fontSize: 8, color: "#2a2a2a" }}>Loading…</span>
      )}
    </div>
  );
}

function ConsensusBanner({
  consensus, coin, onExecute,
}: {
  consensus: Consensus;
  coin: Coin;
  onExecute: (c: Consensus) => void;
}) {
  const isLong = consensus.direction === "LONG";
  const col = isLong ? GREEN : RED;
  return (
    <div style={{
      background: isLong ? "rgba(78,207,138,0.06)" : "rgba(207,78,78,0.06)",
      border: `1px solid ${col}33`,
      borderLeft: `3px solid ${col}`,
      borderRadius: 4, padding: "10px 13px",
      display: "flex", alignItems: "center", gap: 12,
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <span style={{ fontFamily: mono, fontSize: 11, fontWeight: 700, color: col }}>
            {isLong ? "▲" : "▼"} CONSENSUS: {consensus.direction}
          </span>
          <span style={{ fontFamily: mono, fontSize: 8, color: "#555" }}>
            Strategies {consensus.strategies.join(" + ")} agree
          </span>
        </div>
        <div style={{ display: "flex", gap: 14 }}>
          {consensus.bestEntry > 0 && (
            <Stat label="ENTRY" value={fmtPx(consensus.bestEntry)} color="#e8e8e8" />
          )}
          {consensus.bestSL > 0 && (
            <Stat label="SL" value={fmtPx(consensus.bestSL)} color={RED} />
          )}
          {consensus.bestTP > 0 && (
            <Stat label="TP" value={fmtPx(consensus.bestTP)} color={GREEN} />
          )}
          <Stat label="LEAD" value={`Strategy ${consensus.bestStrat}`} color={stratColor(consensus.bestStrat as StratKey)} />
        </div>
      </div>
      <button
        onClick={() => onExecute(consensus)}
        style={{
          fontFamily: mono, fontSize: 9, fontWeight: 700,
          padding: "6px 14px", borderRadius: 3, cursor: "pointer",
          background: isLong ? "rgba(78,207,138,0.1)" : "rgba(207,78,78,0.1)",
          border: `1px solid ${col}44`, color: col,
          letterSpacing: "0.04em",
          flexShrink: 0,
        }}
      >
        EXECUTE ON HL →
      </button>
    </div>
  );
}

function ConditionDots({
  conditions,
  keys,
  labels,
}: {
  conditions: Record<string, boolean | number | string>;
  keys: string[];
  labels: string[];
}) {
  return (
    <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
      {keys.map((k, i) => {
        const val = conditions[k];
        const passed = val === true || (typeof val === "number" && val > 0);
        return (
          <span key={k} style={{
            fontFamily: mono, fontSize: 8, padding: "1px 5px", borderRadius: 2,
            background: passed ? "rgba(78,207,138,0.07)" : "#0c0c0c",
            border: `1px solid ${passed ? "rgba(78,207,138,0.2)" : "#1c1c1c"}`,
            color: passed ? "#3aaa72" : "#2a2a2a",
          }}>
            {passed ? "✓" : "✗"} {labels[i]}
          </span>
        );
      })}
    </div>
  );
}

function StrategyCard({
  strat,
  result,
  coin,
  onExecute,
  executing,
}: {
  strat: StratKey;
  result: StratResult | null;
  coin: Coin;
  onExecute: (strat: string, result: StratResult) => void;
  executing: boolean;
}) {
  const col = stratColor(strat);
  const NAMES: Record<StratKey, string> = {
    A: "Stop-Hunt Sniper",
    B: "EMA Cross Trend",
    C: "FU Candle Sniper",
    D: "Unified Sniper",
  };

  if (!result) {
    return (
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "7px 11px",
        background: "#090909",
        border: "1px solid #131313",
        borderLeft: `2px solid ${col}22`,
        borderRadius: 3,
      }}>
        <span style={{ fontFamily: mono, fontSize: 9, fontWeight: 700, color: col, width: 14 }}>{strat}</span>
        <span style={{ fontFamily: mono, fontSize: 8, color: "#1e1e1e" }}>{NAMES[strat]}</span>
        <span style={{ fontFamily: mono, fontSize: 8, color: "#1a1a1a", marginLeft: "auto" }}>
          no signal
        </span>
      </div>
    );
  }

  const direction = result.direction === "long" ? "LONG" : "SHORT";
  const isLong    = direction === "LONG";
  const dirColor  = isLong ? GREEN : RED;

  return (
    <div style={{
      padding: "10px 12px",
      background: isLong ? "rgba(78,207,138,0.04)" : "rgba(207,78,78,0.04)",
      border: `1px solid ${dirColor}22`,
      borderLeft: `3px solid ${col}`,
      borderRadius: 3,
      display: "flex", flexDirection: "column", gap: 7,
    }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontFamily: mono, fontSize: 9, fontWeight: 700, color: col, width: 14 }}>{strat}</span>
        <span style={{ fontFamily: mono, fontSize: 8, color: "#444" }}>{NAMES[strat]}</span>
        <span style={{
          fontFamily: mono, fontSize: 10, fontWeight: 700, color: dirColor,
          background: `${dirColor}18`, border: `1px solid ${dirColor}33`,
          borderRadius: 2, padding: "2px 8px",
        }}>
          {isLong ? "↑" : "↓"} {direction}
        </span>
        {result.score != null && (
          <span style={{ fontFamily: mono, fontSize: 8, color: "#444" }}>
            {result.score}/{strat === "A" ? 100 : strat === "D" ? 100 : "—"}pts
          </span>
        )}
        <div style={{ flex: 1 }} />
        <button
          onClick={() => onExecute(strat, result)}
          disabled={executing}
          style={{
            fontFamily: mono, fontSize: 8, fontWeight: 600,
            padding: "3px 10px", borderRadius: 2,
            cursor: executing ? "not-allowed" : "pointer",
            background: executing ? "#0a0a0a" : (isLong ? "rgba(78,207,138,0.08)" : "rgba(207,78,78,0.08)"),
            border: `1px solid ${executing ? "#1c1c1c" : `${dirColor}33`}`,
            color: executing ? "#333" : dirColor,
            opacity: executing ? 0.5 : 1,
          }}
        >
          {executing ? "…" : "EXECUTE ON HL →"}
        </button>
      </div>

      {/* Price levels */}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        {result.entry != null && <Stat label="ENTRY" value={fmtPx(result.entry)} color="#e8e8e8" />}
        {result.sl    != null && <Stat label="SL"    value={fmtPx(result.sl)}    color={RED} />}
        {result.tp1   != null && <Stat label="TP1"   value={fmtPx(result.tp1)}   color={GREEN} />}
        {result.tp2   != null && <Stat label="TP2"   value={fmtPx(result.tp2)}   color="#3aaa72" />}
        {(result.rr ?? result.min_rr) != null && (
          <Stat label="R:R" value={`${Number(result.rr ?? result.min_rr).toFixed(1)}:1`} color={AMBER} />
        )}
      </div>

      {/* Conditions */}
      {result.conditions && (
        <>
          {strat === "A" && (
            <ConditionDots
              conditions={result.conditions}
              keys={["cond1_wick", "cond2_vol", "cond3_reclaim", "cond4_htf"]}
              labels={["wick", "vol", "reclaim", "htf"]}
            />
          )}
          {strat === "B" && (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {result.conditions.adx_4h != null && (
                <Stat label="ADX 4H" value={String(Number(result.conditions.adx_4h).toFixed(1))} color={GREEN} />
              )}
              {result.conditions.ema200_4h != null && (
                <Stat label="EMA200 4H" value={fmtPx(result.conditions.ema200_4h)} color="#888" />
              )}
              {result.conditions.price_4h != null && (
                <Stat label="PRICE 4H" value={fmtPx(result.conditions.price_4h)} color="#888" />
              )}
            </div>
          )}
          {strat === "D" && (
            <ConditionDots
              conditions={result.conditions}
              keys={[
                "cond1_wick","cond2_vol","cond3_reclaim","cond4_htf",
                "cond5_fu_candle","cond6_orderblock","cond7_fvg","cond8_liq_density",
              ]}
              labels={["wick","vol","reclaim","htf","FU","OB","FVG","liq"]}
            />
          )}
        </>
      )}
    </div>
  );
}

function ConfirmModal({
  confirm,
  executing,
  execMsg,
  onConfirm,
  onCancel,
}: {
  confirm:   ConfirmState;
  executing: boolean;
  execMsg:   string | null;
  onConfirm: () => void;
  onCancel:  () => void;
}) {
  const isLong = confirm.direction === "LONG";
  const col    = isLong ? GREEN : RED;

  return (
    <div style={{
      position: "fixed", inset: 0,
      background: "rgba(0,0,0,0.75)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 100,
    }}>
      <div style={{
        background: "#0c0c0c",
        border: "1px solid #2a2a2a",
        borderTop: `2px solid ${col}`,
        borderRadius: 6,
        padding: "22px 26px",
        minWidth: 320, maxWidth: 400,
        display: "flex", flexDirection: "column", gap: 16,
      }}>
        <div style={{ fontFamily: mono, fontSize: 9, color: "#444", letterSpacing: "0.10em" }}>
          CONFIRM TRADE — STRATEGY {confirm.strat}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontFamily: sans, fontWeight: 800, fontSize: 18, color: "#e8e8e8" }}>
            {confirm.coin}
          </span>
          <span style={{
            fontFamily: mono, fontSize: 12, fontWeight: 700, color: col,
            background: `${col}18`, border: `1px solid ${col}33`,
            borderRadius: 3, padding: "3px 10px",
          }}>
            {isLong ? "↑ LONG" : "↓ SHORT"}
          </span>
        </div>

        <div style={{ display: "flex", gap: 20, borderTop: "1px solid #1a1a1a", paddingTop: 12 }}>
          <Stat label="ENTRY" value={fmtPx(confirm.entry)} color="#e8e8e8" />
          <Stat label="SL"    value={fmtPx(confirm.sl)}    color={RED} />
          <Stat label="TP"    value={fmtPx(confirm.tp)}    color={GREEN} />
        </div>

        <div style={{
          fontFamily: mono, fontSize: 8, color: "#555",
          background: "#080808", border: "1px solid #1a1a1a",
          borderRadius: 3, padding: "7px 9px",
        }}>
          Size: $50 · Leverage: 5× · post-only (ALO limit at best bid/ask)
        </div>

        {execMsg && (
          <div style={{
            fontFamily: mono, fontSize: 9,
            color: execMsg.startsWith("✓") ? GREEN : RED,
            background: execMsg.startsWith("✓") ? "rgba(78,207,138,0.07)" : "rgba(207,78,78,0.07)",
            border: `1px solid ${execMsg.startsWith("✓") ? "rgba(78,207,138,0.2)" : "rgba(207,78,78,0.2)"}`,
            borderRadius: 3, padding: "6px 9px",
          }}>
            {execMsg}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={{
            fontFamily: mono, fontSize: 10, padding: "6px 14px",
            background: "none", border: "1px solid #2a2a2a",
            borderRadius: 3, color: "#555", cursor: "pointer",
          }}>
            CANCEL
          </button>
          <button
            onClick={onConfirm}
            disabled={executing}
            style={{
              fontFamily: mono, fontSize: 10, fontWeight: 700, padding: "6px 16px",
              background: executing ? "#0a0a0a" : (isLong ? "rgba(78,207,138,0.12)" : "rgba(207,78,78,0.12)"),
              border: `1px solid ${executing ? "#1c1c1c" : `${col}44`}`,
              borderRadius: 3, color: executing ? "#333" : col,
              cursor: executing ? "not-allowed" : "pointer",
            }}
          >
            {executing ? "PLACING…" : "CONFIRM & PLACE"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Auto-Exec Panel ───────────────────────────────────────────────────────────

function AutoExecPanel({
  status,
  onSetMode,
  onSetBroker,
  setting,
}: {
  status:      AutoExecStatus | null;
  onSetMode:   (mode: ExecMode) => void;
  onSetBroker: (broker: ExecBroker) => void;
  setting:     boolean;
}) {
  const mode       = status?.mode ?? "stopped";
  const broker     = status?.broker ?? "hl";
  const hlOk       = status?.hl_configured ?? false;
  const mt5Ok      = status?.mt5_configured ?? false;
  const halted     = status?.live_halted ?? false;
  const secsLeft   = status?.secs_to_scan ?? 0;
  const paperPnl   = status?.paper.pnl ?? 0;
  const paperEq    = status?.paper.equity ?? 10000;
  const positions  = status?.paper.positions ?? {};
  const lastExec   = status?.log?.[0];

  function minsLeft() {
    const m = Math.floor(secsLeft / 60);
    const s = secsLeft % 60;
    return `${m}m ${s}s`;
  }

  const modeColor: Record<ExecMode, string> = {
    stopped: "#555",
    paper:   AMBER,
    live:    GREEN,
  };
  const col = modeColor[mode];

  return (
    <div style={{
      flexShrink: 0,
      borderBottom: "1px solid #1a1a1a",
      background: "#090909",
      padding: "8px 13px",
      display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
    }}>
      {/* Label */}
      <span style={{ fontFamily: mono, fontSize: 8, color: "#2a2a2a", letterSpacing: "0.10em" }}>
        AUTO-EXEC
      </span>

      {/* Mode indicator */}
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <div style={{
          width: 6, height: 6, borderRadius: "50%",
          background: mode === "stopped" ? "#2a2a2a" : col,
          boxShadow: mode !== "stopped" ? `0 0 5px ${col}` : "none",
        }} />
        <span style={{ fontFamily: mono, fontSize: 9, fontWeight: 700, color: col }}>
          {mode.toUpperCase()}
        </span>
      </div>

      {/* Mode buttons */}
      <div style={{ display: "flex", gap: 2 }}>
        {(["stopped", "paper", "live"] as ExecMode[]).map(m => {
          const disabled = m === "live" && (!hlOk || halted);
          const active   = mode === m;
          const mc       = modeColor[m];
          return (
            <button
              key={m}
              onClick={() => !disabled && !setting && onSetMode(m)}
              disabled={disabled || setting}
              title={
                m === "live" && !hlOk ? "HL_PRIVATE_KEY not configured" :
                m === "live" && halted ? "Kill-switch active — restart bridge" : undefined
              }
              style={{
                fontFamily: mono, fontSize: 8, padding: "3px 8px", borderRadius: 2,
                cursor: disabled ? "not-allowed" : "pointer",
                background: active ? `${mc}18` : "#0a0a0a",
                border: `1px solid ${active ? `${mc}44` : "#1c1c1c"}`,
                color: active ? mc : disabled ? "#222" : "#444",
                opacity: setting ? 0.6 : 1,
              }}
            >
              {m === "stopped" ? "■ STOP" : m === "paper" ? "◎ PAPER" : "▶ LIVE"}
            </button>
          );
        })}
      </div>

      {/* Broker selector */}
      <div style={{ display: "flex", gap: 2 }}>
        {(["hl", "mt5", "both"] as ExecBroker[]).map(b => {
          const labels: Record<ExecBroker, string> = { hl: "HL", mt5: "MT5", both: "BOTH" };
          const colors: Record<ExecBroker, string> = { hl: BLUE, mt5: AMBER, both: GREEN };
          const bc = colors[b];
          const active = broker === b;
          const disabled = (b === "mt5" || b === "both") && !mt5Ok;
          return (
            <button
              key={b}
              onClick={() => !disabled && !setting && onSetBroker(b)}
              disabled={disabled || setting}
              title={disabled ? "MT5 not connected" : undefined}
              style={{
                fontFamily: mono, fontSize: 8, padding: "3px 7px", borderRadius: 2,
                cursor: disabled ? "not-allowed" : "pointer",
                background: active ? `${bc}18` : "#0a0a0a",
                border: `1px solid ${active ? `${bc}44` : "#1c1c1c"}`,
                color: active ? bc : disabled ? "#222" : "#333",
              }}
            >{labels[b]}</button>
          );
        })}
      </div>

      <div style={{ width: 1, height: 16, background: "#1c1c1c" }} />

      {/* Next scan countdown */}
      {mode !== "stopped" && (
        <span style={{ fontFamily: mono, fontSize: 8, color: "#444" }}>
          Next scan: {minsLeft()}
        </span>
      )}

      {/* Paper equity */}
      {(mode === "paper" || (status?.paper.equity ?? 10000) !== 10000) && (
        <span style={{
          fontFamily: mono, fontSize: 8,
          color: paperPnl >= 0 ? GREEN : RED,
        }}>
          Paper: ${paperEq.toFixed(0)} ({paperPnl >= 0 ? "+" : ""}${paperPnl.toFixed(0)})
        </span>
      )}

      {/* Open paper positions */}
      {Object.entries(positions).map(([coin, pos]) => (
        <span key={coin} style={{
          fontFamily: mono, fontSize: 8, padding: "1px 6px", borderRadius: 2,
          background: pos.direction === "LONG" ? "rgba(78,207,138,0.08)" : "rgba(207,78,78,0.08)",
          border: `1px solid ${pos.direction === "LONG" ? "rgba(78,207,138,0.2)" : "rgba(207,78,78,0.2)"}`,
          color: pos.direction === "LONG" ? GREEN : RED,
        }}>
          {pos.direction === "LONG" ? "↑" : "↓"} {coin} @{fmtPx(pos.entry)}
        </span>
      ))}

      {/* Last execution */}
      {lastExec && (
        <>
          <div style={{ width: 1, height: 16, background: "#1c1c1c" }} />
          <span style={{ fontFamily: mono, fontSize: 8, color: "#333" }}>
            Last: {new Date(lastExec.ts * 1000).toLocaleTimeString()} ·{" "}
            <span style={{ color: lastExec.ok ? GREEN : RED }}>
              {lastExec.ok ? "" : "✕ "}{lastExec.direction} {lastExec.coin}
            </span>
            {lastExec.error && (
              <span style={{ color: RED }}> — {lastExec.error}</span>
            )}
          </span>
        </>
      )}

      {/* Kill-switch warning */}
      {halted && (
        <span style={{
          fontFamily: mono, fontSize: 8, color: RED,
          background: "rgba(207,78,78,0.1)", border: "1px solid rgba(207,78,78,0.25)",
          borderRadius: 2, padding: "2px 7px",
        }}>
          ⚠ KILL-SWITCH ACTIVE
        </span>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function StrategiesPage() {
  const [regime,     setRegime]     = useState<Record<Coin, RegimeCoin> | null>(null);
  const [autoExec,   setAutoExec]   = useState<AutoExecStatus | null>(null);
  const [settingMode, setSettingMode] = useState(false);
  const [scanCoin,   setScanCoin]   = useState<Coin>("BTC");
  const [scanIv,     setScanIv]     = useState<Interval>("1h");
  const [scanning,   setScanning]   = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [scanError,  setScanError]  = useState<string | null>(null);
  const [lastScan,   setLastScan]   = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState<ConfirmState | null>(null);
  const [modalExec,   setModalExec]  = useState(false);
  const [modalMsg,    setModalMsg]   = useState<string | null>(null);
  const [cardExec,    setCardExec]   = useState<Record<string, boolean>>({});

  const fetchRegime = useCallback(async () => {
    try {
      const r = await fetch(`${BRIDGE_HTTP}/regime`);
      if (r.ok) setRegime(await r.json());
    } catch { /* offline */ }
  }, []);

  const fetchAutoExec = useCallback(async () => {
    try {
      const r = await fetch(`${BRIDGE_HTTP}/auto-exec/status`);
      if (r.ok) setAutoExec(await r.json());
    } catch { /* offline */ }
  }, []);

  async function setMode(mode: ExecMode) {
    setSettingMode(true);
    try {
      const r = await fetch(`${BRIDGE_HTTP}/auto-exec/mode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const d = await r.json();
      if (d.ok) await fetchAutoExec();
      else setModalMsg(`✕ ${d.error ?? "Failed to set mode"}`);
    } catch {
      setModalMsg("✕ Bridge offline");
    } finally {
      setSettingMode(false);
    }
  }

  async function setBroker(broker: ExecBroker) {
    setSettingMode(true);
    try {
      const r = await fetch(`${BRIDGE_HTTP}/auto-exec/broker`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ broker }),
      });
      const d = await r.json();
      if (d.ok) await fetchAutoExec();
      else setModalMsg(`✕ ${d.error ?? "Failed to set broker"}`);
    } catch {
      setModalMsg("✕ Bridge offline");
    } finally {
      setSettingMode(false);
    }
  }

  useEffect(() => {
    fetchRegime();
    fetchAutoExec();
    const id1 = setInterval(fetchRegime, 30_000);
    const id2 = setInterval(fetchAutoExec, 10_000);
    return () => { clearInterval(id1); clearInterval(id2); };
  }, [fetchRegime, fetchAutoExec]);

  async function runScan() {
    setScanning(true);
    setScanError(null);
    setScanResult(null);
    try {
      const r = await fetch(`${BRIDGE_HTTP}/strategies/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coin: scanCoin, interval: scanIv }),
      });
      if (!r.ok) { setScanError(`Scan failed (HTTP ${r.status})`); return; }
      const d = await r.json();
      if (d.error) { setScanError(d.error); return; }
      setScanResult(d as ScanResult);
      setLastScan(new Date().toLocaleTimeString());
    } catch {
      setScanError("Bridge offline");
    } finally {
      setScanning(false);
    }
  }

  function openConfirm(strat: string, result: StratResult) {
    const direction = result.direction === "long" ? "LONG" : "SHORT";
    setModalMsg(null);
    setShowConfirm({
      strat,
      direction,
      entry: result.entry ?? 0,
      sl:    result.sl    ?? 0,
      tp:    result.tp1   ?? 0,
      coin:  scanCoin,
    });
  }

  function openConfirmFromConsensus(consensus: Consensus) {
    setModalMsg(null);
    setShowConfirm({
      strat:     consensus.bestStrat,
      direction: consensus.direction,
      entry:     consensus.bestEntry,
      sl:        consensus.bestSL,
      tp:        consensus.bestTP,
      coin:      scanCoin,
    });
  }

  async function placeOrder() {
    if (!showConfirm) return;
    setModalExec(true);
    setModalMsg(null);
    try {
      const c = showConfirm;
      const r = await fetch(`${BRIDGE_HTTP}/trade/hl/open`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          coin:              c.coin,
          is_buy:            c.direction === "LONG",
          size_usd:          50,
          leverage:          5,
          post_only:         true,
          max_drawdown_pct:  0.15,
          max_position_pct:  0.20,
        }),
      });
      const d = await r.json();
      if (d.ok) {
        setModalMsg(`✓ ${c.direction} ${c.coin} placed`);
        setTimeout(() => setShowConfirm(null), 1800);
      } else {
        setModalMsg(`✕ ${d.error ?? "Failed"}`);
      }
    } catch {
      setModalMsg("✕ Bridge offline");
    } finally {
      setModalExec(false);
    }
  }

  const consensus = getConsensus(scanResult);
  const coins: Coin[]         = ["BTC", "ETH", "SOL", "PAXG"];
  const intervals: Interval[] = ["1h", "4h"];

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>

      {/* Regime strip */}
      <RegimeStrip regime={regime} />

      {/* Auto-exec control */}
      <AutoExecPanel
        status={autoExec}
        onSetMode={setMode}
        onSetBroker={setBroker}
        setting={settingMode}
      />

      {/* Two-panel body */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* ── Left: Strategy Scanner (55%) ── */}
        <div style={{
          width: "55%", flexShrink: 0,
          display: "flex", flexDirection: "column", overflow: "hidden",
          borderRight: "1px solid #1a1a1a",
        }}>
          {/* Scanner header */}
          <div style={{
            padding: "8px 13px",
            borderBottom: "1px solid #1a1a1a",
            display: "flex", alignItems: "center", gap: 8, flexShrink: 0,
            background: "#0a0a0a",
          }}>
            <span style={{ fontFamily: mono, fontSize: 8, color: "#2a2a2a", letterSpacing: "0.10em" }}>
              STRATEGY SCANNER
            </span>

            {/* Coin selector */}
            <div style={{ display: "flex", gap: 2, marginLeft: 6 }}>
              {coins.map(c => (
                <button key={c} onClick={() => setScanCoin(c)} style={{
                  fontFamily: mono, fontSize: 9, padding: "3px 8px", borderRadius: 2, cursor: "pointer",
                  background: scanCoin === c ? "#101e30" : "#0a0a0a",
                  border: `1px solid ${scanCoin === c ? "#1c3050" : "#1c1c1c"}`,
                  color: scanCoin === c ? BLUE : "#444",
                }}>{c}</button>
              ))}
            </div>

            <div style={{ width: 1, height: 16, background: "#1c1c1c" }} />

            {/* Interval selector */}
            <div style={{ display: "flex", gap: 2 }}>
              {intervals.map(iv => (
                <button key={iv} onClick={() => setScanIv(iv)} style={{
                  fontFamily: mono, fontSize: 9, padding: "3px 8px", borderRadius: 2, cursor: "pointer",
                  background: scanIv === iv ? "#101e30" : "#0a0a0a",
                  border: `1px solid ${scanIv === iv ? "#1c3050" : "#1c1c1c"}`,
                  color: scanIv === iv ? BLUE : "#444",
                }}>{iv}</button>
              ))}
            </div>

            <button onClick={runScan} disabled={scanning} style={{
              fontFamily: mono, fontSize: 9, fontWeight: 600,
              padding: "4px 13px", borderRadius: 2, cursor: scanning ? "not-allowed" : "pointer",
              background: scanning ? "#0f1a12" : "#101e30",
              border: `1px solid ${scanning ? "#1c3a28" : "#1c3050"}`,
              color: scanning ? GREEN : BLUE,
              opacity: scanning ? 0.7 : 1,
            }}>
              {scanning ? "SCANNING…" : "▶ RUN SCAN"}
            </button>

            {scanResult && lastScan && (
              <span style={{ fontFamily: mono, fontSize: 7, color: "#2a2a2a" }}>
                {scanResult.candles?.toLocaleString()} candles · {lastScan}
              </span>
            )}

            {/* Strategy B note when 1h selected */}
            {scanIv === "1h" && (
              <span style={{ fontFamily: mono, fontSize: 7, color: "#333", marginLeft: "auto" }}>
                B: 4h loaded automatically
              </span>
            )}
          </div>

          {/* Error */}
          {scanError && (
            <div style={{
              fontFamily: mono, fontSize: 9, color: RED,
              padding: "7px 13px", background: "rgba(207,78,78,0.07)",
              borderBottom: "1px solid rgba(207,78,78,0.15)", flexShrink: 0,
            }}>
              {scanError}
            </div>
          )}

          {/* Results scroll area */}
          <div style={{ flex: 1, overflowY: "auto", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
            {/* Consensus banner */}
            {consensus && (
              <ConsensusBanner
                consensus={consensus}
                coin={scanCoin}
                onExecute={openConfirmFromConsensus}
              />
            )}

            {/* Strategy cards */}
            {(["A","B","C","D"] as StratKey[]).map(s => (
              <StrategyCard
                key={s}
                strat={s}
                result={scanResult?.[s] ?? null}
                coin={scanCoin}
                onExecute={openConfirm}
                executing={cardExec[s] ?? false}
              />
            ))}

            {/* Empty state */}
            {!scanResult && !scanning && !scanError && (
              <div style={{
                flex: 1, display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center",
                gap: 6, paddingTop: 60,
              }}>
                <div style={{ fontFamily: mono, fontSize: 9, color: "#1e1e1e", letterSpacing: "0.10em" }}>
                  SELECT COIN + INTERVAL AND PRESS ▶ RUN SCAN
                </div>
              </div>
            )}

            {/* Execution log */}
            {(autoExec?.log?.length ?? 0) > 0 && (
              <div style={{ marginTop: 10 }}>
                <div style={{
                  fontFamily: mono, fontSize: 8, color: "#2a2a2a",
                  letterSpacing: "0.10em", marginBottom: 6,
                }}>
                  EXECUTION LOG
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                  {autoExec!.log.slice(0, 10).map((entry, i) => (
                    <div key={i} style={{
                      display: "flex", alignItems: "center", gap: 7,
                      height: 28, padding: "0 8px",
                      background: i % 2 === 0 ? "#090909" : "transparent",
                      borderRadius: 2,
                      fontSize: 9, fontFamily: mono,
                    }}>
                      {/* Timestamp */}
                      <span style={{ color: "#333", flexShrink: 0, width: 62 }}>
                        {new Date(entry.ts * 1000).toLocaleTimeString()}
                      </span>
                      {/* Coin */}
                      <span style={{ color: "#666", flexShrink: 0, width: 32 }}>{entry.coin}</span>
                      {/* Direction */}
                      <span style={{
                        color: entry.direction === "LONG" ? GREEN : RED,
                        flexShrink: 0, width: 12,
                      }}>
                        {entry.direction === "LONG" ? "↑" : "↓"}
                      </span>
                      {/* Strategies */}
                      <span style={{ color: "#555", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {entry.strategies.join("+")}
                      </span>
                      {/* Mode chip */}
                      <span style={{
                        flexShrink: 0,
                        fontFamily: mono, fontSize: 7, padding: "0px 4px", borderRadius: 2,
                        background: entry.mode === "live" ? "rgba(78,207,138,0.08)" : "rgba(207,173,78,0.08)",
                        border: `1px solid ${entry.mode === "live" ? "rgba(78,207,138,0.2)" : "rgba(207,173,78,0.2)"}`,
                        color: entry.mode === "live" ? GREEN : AMBER,
                      }}>
                        {entry.mode === "live" ? "LIVE" : "PAPER"}
                      </span>
                      {/* Result */}
                      <span style={{
                        flexShrink: 0,
                        color: entry.ok ? GREEN : RED,
                        width: entry.ok ? 10 : undefined,
                        maxWidth: 160,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}>
                        {entry.ok ? "✓" : `✕ ${(entry.error ?? "").slice(0, 40)}`}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Right: AI Signal Feed (45%) ── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <AISignalPanel
            consensusCoin={consensus ? scanCoin : undefined}
            consensusDir={consensus?.direction}
          />
        </div>
      </div>

      {/* Confirm modal */}
      {showConfirm && (
        <ConfirmModal
          confirm={showConfirm}
          executing={modalExec}
          execMsg={modalMsg}
          onConfirm={placeOrder}
          onCancel={() => { setShowConfirm(null); setModalMsg(null); }}
        />
      )}
    </div>
  );
}
