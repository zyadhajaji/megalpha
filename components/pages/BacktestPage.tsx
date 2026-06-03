"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BRIDGE_HTTP } from "@/lib/bridge";

type Coin      = "BTC" | "ETH" | "SOL";
type Interval  = "15m" | "1h" | "4h" | "1d";
type Strategy  =
  | "agent"
  | "momentum" | "breakout" | "mean_reversion" | "ema_cross" | "macd" | "bollinger"
  | "supply_demand" | "sl_hunt" | "valued_risk"
  | "stop_hunt_a" | "trend_follow_b" | "sniper_c" | "unified_d";

interface SavedStrategy { name: string; slug: string; }

// Grouped for display
const STRAT_GROUPS: { label: string; items: Strategy[] }[] = [
  { label: "MEGA STRATEGIES", items: ["stop_hunt_a", "trend_follow_b", "sniper_c", "unified_d"] },
  { label: "STRUCTURAL",      items: ["supply_demand", "sl_hunt", "valued_risk"] },
  { label: "CLASSIC",         items: ["agent", "momentum", "breakout", "mean_reversion", "ema_cross", "macd", "bollinger"] },
];

const STRATEGIES: Strategy[] = [
  "stop_hunt_a", "trend_follow_b", "sniper_c", "unified_d",
  "supply_demand", "sl_hunt", "valued_risk",
  "agent", "momentum", "breakout", "mean_reversion", "ema_cross", "macd", "bollinger",
];

const STRAT_LABEL: Record<Strategy, string> = {
  // Mega strategies (from PDF)
  stop_hunt_a:   "A · Stop Hunt",
  trend_follow_b:"B · Trend Follow",
  sniper_c:      "C · Sniper FU",
  unified_d:     "D · Unified",
  // Structural
  supply_demand: "Supply/Demand",
  sl_hunt:       "SL Hunt",
  valued_risk:   "Valued Risk",
  // Classic
  agent:         "RL Bot",
  momentum:      "Momentum",
  breakout:      "Breakout",
  mean_reversion:"Mean Rev",
  ema_cross:     "EMA Cross",
  macd:          "MACD",
  bollinger:     "Bollinger",
};

const STRAT_COLOR: Partial<Record<Strategy, string>> = {
  stop_hunt_a:    "#cfad4e",
  trend_follow_b: "#4ecf8a",
  sniper_c:       "#cf4e4e",
  unified_d:      "#4e8ecf",
};

interface Trade {
  open_time:  number;
  close_time: number;
  direction:  string;
  entry_px:   number;
  exit_px:    number;
  pnl_usd:    number;
  pnl_pct:    number;
  fees?:      number;
}

interface Stats {
  total_trades:        number;
  win_rate:            number;
  profit_factor:       number;
  max_drawdown:        number;
  sharpe:              number;
  sortino:             number;
  net_pnl:             number;
  return_pct:          number;
  avg_win:             number;
  avg_loss:            number;
  expectancy:          number;
  max_consec_losses:   number;
  best_trade:          number;
  worst_trade:         number;
  total_fees:          number;
  long_trades:         number;
  short_trades:        number;
  exposure:            number;
  buy_hold_return_pct: number;
  buy_hold_pnl:        number;
  alpha_pct:           number;
  total_funding:       number;
  slippage_cost:       number;
  halted:              boolean;
}

type Curve = { time: number; value: number }[];

interface BacktestResult {
  trades:         Trade[];
  equity_curve:   Curve;
  buy_hold_curve: Curve;
  stats:          Stats;
  meta:           { coin: string; interval: string; strategy: string; candles: number };
}

interface WFFold {
  fold: number; candles: number; return_pct: number; buy_hold_return_pct: number;
  alpha_pct: number; sharpe: number; max_drawdown: number; trades: number; win_rate: number;
}
interface WalkForwardResult {
  folds: WFFold[];
  summary: {
    folds: number; profitable_folds: number; beats_buy_hold_folds: number;
    mean_return_pct: number; return_std_pct: number; mean_alpha_pct: number;
    best_fold_pct: number; worst_fold_pct: number; consistency: number;
  };
}

const mono = "var(--font-mono, 'IBM Plex Mono', monospace)";
const sans = "var(--font-sans, Inter, sans-serif)";
const GREEN = "#4ecf8a", RED = "#cf4e4e";

const pct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
const gr  = (v: number) => (v >= 0 ? GREEN : RED);

const STAT_LABELS: { key: keyof Stats; label: string; fmt: (v: number) => string; color?: (v: number) => string }[] = [
  { key: "net_pnl",             label: "Net P&L",       fmt: (v) => `$${v >= 0 ? "+" : ""}${v.toFixed(2)}`, color: gr },
  { key: "return_pct",          label: "Return",        fmt: pct, color: gr },
  { key: "buy_hold_return_pct", label: "Buy & Hold",    fmt: pct, color: gr },
  { key: "alpha_pct",           label: "Alpha",         fmt: pct, color: gr },
  { key: "win_rate",            label: "Win Rate",      fmt: (v) => `${v.toFixed(1)}%`, color: (v) => v >= 50 ? GREEN : RED },
  { key: "profit_factor",       label: "Profit Factor", fmt: (v) => v.toFixed(2),       color: (v) => v >= 1 ? GREEN : RED },
  { key: "sharpe",              label: "Sharpe",        fmt: (v) => v.toFixed(2),       color: (v) => v >= 1 ? GREEN : v >= 0 ? "#cfad4e" : RED },
  { key: "sortino",             label: "Sortino",       fmt: (v) => v.toFixed(2),       color: (v) => v >= 1 ? GREEN : v >= 0 ? "#cfad4e" : RED },
  { key: "max_drawdown",        label: "Max Drawdown",  fmt: (v) => `${v.toFixed(2)}%`, color: (v) => v < 10 ? GREEN : v < 20 ? "#cfad4e" : RED },
  { key: "expectancy",          label: "Expectancy",    fmt: (v) => `$${v >= 0 ? "+" : ""}${v.toFixed(2)}`, color: gr },
  { key: "exposure",            label: "Exposure",      fmt: (v) => `${v.toFixed(1)}%` },
  { key: "total_trades",        label: "Total Trades",  fmt: (v) => String(v) },
];

function fmtTime(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
}

export default function BacktestPage() {
  const [coin, setCoin]         = useState<Coin>("ETH");
  const [interval, setInterval] = useState<Interval>("4h");
  const [strategy, setStrategy] = useState<Strategy>("agent");
  const [balance, setBalance]   = useState("10000");
  const [sizeUsd, setSizeUsd]   = useState("200");
  const [leverage, setLeverage] = useState("5");
  // cost model
  const [slip, setSlip]         = useState("2");    // bps/side
  const [funding, setFunding]   = useState("10");   // % APR
  // risk layer (all % ; 0 = off)
  const [stopLoss, setStopLoss] = useState("0");
  const [takeProfit, setTP]     = useState("0");
  const [killDD, setKillDD]     = useState("0");
  const [sizePct, setSizePct]   = useState("0");

  const [loading, setLoading]   = useState(false);
  const [wfLoading, setWfLoading] = useState(false);
  const [result, setResult]     = useState<BacktestResult | null>(null);
  const [wf, setWf]             = useState<WalkForwardResult | null>(null);
  const [error, setError]       = useState<string | null>(null);

  // strategy save / load
  const [saved, setSaved]           = useState<SavedStrategy[]>([]);
  const [showSave, setShowSave]     = useState(false);
  const [saveName, setSaveName]     = useState("");
  const [saveMsg, setSaveMsg]       = useState<string | null>(null);

  const chartRef   = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chartInst  = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const seriesInst = useRef<any>(null);

  // ── strategy persistence ───────────────────────────────────────────────────

  const fetchSaved = useCallback(async () => {
    try {
      const r = await fetch(`${BRIDGE_HTTP}/strategy/list`);
      if (r.ok) setSaved(await r.json());
    } catch { /* server offline */ }
  }, []);

  useEffect(() => { fetchSaved(); }, [fetchSaved]);

  async function saveStrategy() {
    const name = saveName.trim();
    if (!name) return;
    setSaveMsg(null);
    try {
      const r = await fetch(`${BRIDGE_HTTP}/strategy/save`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, config: reqBody() }),
      });
      const d = await r.json();
      if (d.ok) {
        setSaveMsg(`Saved "${name}"`);
        setShowSave(false);
        setSaveName("");
        await fetchSaved();
      } else {
        setSaveMsg(d.error ?? "Save failed");
      }
    } catch { setSaveMsg("Bridge offline"); }
  }

  async function loadStrategy(slug: string) {
    if (!slug) return;
    try {
      const r = await fetch(`${BRIDGE_HTTP}/strategy/${slug}`);
      const d = await r.json();
      if (!d.ok || !d.config) return;
      const c = d.config;
      if (c.coin)     setCoin(c.coin as Coin);
      if (c.interval) setInterval(c.interval as Interval);
      if (c.strategy) setStrategy(c.strategy as Strategy);
      if (c.starting_balance != null) setBalance(String(c.starting_balance));
      if (c.size_usd  != null) setSizeUsd(String(c.size_usd));
      if (c.leverage  != null) setLeverage(String(c.leverage));
      if (c.slippage_bps   != null) setSlip(String(c.slippage_bps));
      if (c.funding_apr    != null) setFunding(String((c.funding_apr * 100).toFixed(2)));
      if (c.stop_loss_pct  != null) setStopLoss(String((c.stop_loss_pct * 100).toFixed(2)));
      if (c.take_profit_pct   != null) setTP(String((c.take_profit_pct * 100).toFixed(2)));
      if (c.max_drawdown_pct  != null) setKillDD(String((c.max_drawdown_pct * 100).toFixed(2)));
      if (c.max_position_pct  != null) setSizePct(String((c.max_position_pct * 100).toFixed(2)));
    } catch { /* server offline */ }
  }

  async function deleteStrategy(slug: string) {
    try {
      await fetch(`${BRIDGE_HTTP}/strategy/${slug}`, { method: "DELETE" });
      await fetchSaved();
    } catch { /* ignore */ }
  }

  function reqBody() {
    return {
      coin, interval, strategy,
      starting_balance: parseFloat(balance) || 10000,
      size_usd:         parseFloat(sizeUsd) || 200,
      leverage:         parseInt(leverage) || 5,
      slippage_bps:     parseFloat(slip) || 0,
      funding_apr:      (parseFloat(funding) || 0) / 100,
      stop_loss_pct:    (parseFloat(stopLoss) || 0) / 100,
      take_profit_pct:  (parseFloat(takeProfit) || 0) / 100,
      max_drawdown_pct: (parseFloat(killDD) || 0) / 100,
      max_position_pct: (parseFloat(sizePct) || 0) / 100,
    };
  }

  async function runBacktest() {
    setLoading(true); setError(null); setResult(null); setWf(null);
    try {
      const url = strategy === "agent" ? `${BRIDGE_HTTP}/backtest/agent` : `${BRIDGE_HTTP}/backtest`;
      const res = await fetch(url, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reqBody()),
      });
      if (res.status === 404) { setError("Bridge is running old code — restart server/main.py"); return; }
      if (!res.ok) { setError(`Backtest failed (HTTP ${res.status})`); return; }
      const data = await res.json();
      if (data?.error) { setError(data.error); return; }
      if (!data?.meta || !data?.stats) { setError("Unexpected response — restart server/main.py"); return; }
      setResult(data as BacktestResult);
    } catch {
      setError("Bridge server offline — start server/main.py first");
    } finally { setLoading(false); }
  }

  async function runWalkForward() {
    setWfLoading(true); setError(null); setWf(null);
    try {
      const res = await fetch(`${BRIDGE_HTTP}/backtest/walkforward`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...reqBody(), folds: 5 }),
      });
      if (res.status === 404) { setError("Bridge is running old code — restart server/main.py to load /backtest/walkforward"); return; }
      if (!res.ok) { setError(`Walk-forward failed (HTTP ${res.status})`); return; }
      const data = await res.json();
      if (data?.error) { setError(data.error); return; }
      setWf(data as WalkForwardResult);
    } catch {
      setError("Bridge server offline — start server/main.py first");
    } finally { setWfLoading(false); }
  }

  // Equity chart + buy-and-hold overlay
  useEffect(() => {
    if (!result || !chartRef.current) return;
    let destroyed = false;
    const snapshot = result;

    async function init() {
      const lc = await import("lightweight-charts");
      if (destroyed || !chartRef.current) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { createChart, LineSeries, createSeriesMarkers } = lc as any;

      if (chartInst.current) { chartInst.current.remove(); chartInst.current = null; seriesInst.current = null; }

      const chart = createChart(chartRef.current, {
        layout:   { background: { color: "#0a0a0a" }, textColor: "#555" },
        grid:     { vertLines: { color: "rgba(255,255,255,0.03)" }, horzLines: { color: "rgba(255,255,255,0.03)" } },
        crosshair: {
          vertLine: { color: "rgba(255,255,255,0.2)", labelBackgroundColor: "#1c1c1c" },
          horzLine: { color: "rgba(255,255,255,0.2)", labelBackgroundColor: "#1c1c1c" },
        },
        rightPriceScale: { borderColor: "transparent", textColor: "#555" },
        timeScale:        { borderColor: "transparent", timeVisible: false },
        width:  chartRef.current.clientWidth,
        height: chartRef.current.clientHeight,
      });

      // buy & hold reference (dashed grey) drawn first so the strategy sits on top
      if (snapshot.buy_hold_curve?.length) {
        const bh = chart.addSeries(LineSeries, {
          color: "rgba(130,130,130,0.55)", lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false,
        });
        bh.setData(snapshot.buy_hold_curve);
      }

      const series = chart.addSeries(LineSeries, {
        color: snapshot.stats.net_pnl >= 0 ? "#3aaa72" : "#aa3a3a", lineWidth: 2,
      });
      series.setData(snapshot.equity_curve);

      const markers = snapshot.trades
        .map((t) => ({
          time: t.close_time,
          position: t.pnl_usd >= 0 ? "aboveBar" : "belowBar",
          color:    t.pnl_usd >= 0 ? "#3aaa72" : "#aa3a3a",
          shape:    t.pnl_usd >= 0 ? "arrowUp" : "arrowDown",
          text:     `${t.pnl_usd >= 0 ? "+" : ""}${t.pnl_usd.toFixed(0)}`,
        }))
        .sort((a, b) => a.time - b.time);
      if (markers.length > 0) createSeriesMarkers(series, markers);

      chart.timeScale().fitContent();
      chartInst.current = chart;
      seriesInst.current = series;

      const ro = new ResizeObserver(() => {
        if (chartRef.current && chartInst.current) {
          chartInst.current.applyOptions({ width: chartRef.current.clientWidth, height: chartRef.current.clientHeight });
        }
      });
      ro.observe(chartRef.current);
    }
    init();
    return () => { destroyed = true; };
  }, [result]);

  useEffect(() => () => { if (chartInst.current) { chartInst.current.remove(); chartInst.current = null; } }, []);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", padding: 12, gap: 12, overflow: "hidden" }}>

      {/* Controls */}
      <div className="panel" style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 14, flexShrink: 0, flexWrap: "wrap" }}>
        <ControlGroup label="Coin">
          {(["BTC", "ETH", "SOL"] as Coin[]).map((c) => <Chip key={c} active={coin === c} onClick={() => setCoin(c)}>{c}</Chip>)}
        </ControlGroup>
        <Sep />
        <ControlGroup label="Interval">
          {(["15m", "1h", "4h", "1d"] as Interval[]).map((iv) => <Chip key={iv} active={interval === iv} onClick={() => setInterval(iv)}>{iv}</Chip>)}
        </ControlGroup>
        <Sep />
        {STRAT_GROUPS.map((g) => (
          <ControlGroup key={g.label} label={g.label}>
            {g.items.map((s) => (
              <Chip
                key={s}
                active={strategy === s}
                onClick={() => setStrategy(s)}
                color={STRAT_COLOR[s]}
              >
                {STRAT_LABEL[s]}
              </Chip>
            ))}
          </ControlGroup>
        ))}
        <Sep />
        <ControlGroup label="Balance"><NumInput value={balance} onChange={setBalance} prefix="$" /></ControlGroup>
        <ControlGroup label="Size/trade"><NumInput value={sizeUsd} onChange={setSizeUsd} prefix="$" /></ControlGroup>
        <ControlGroup label="Leverage"><NumInput value={leverage} onChange={setLeverage} suffix="×" width={44} /></ControlGroup>

        <Sep />
        {/* Cost model */}
        <ControlGroup label="Slip bps"><NumInput value={slip} onChange={setSlip} width={40} /></ControlGroup>
        <ControlGroup label="Funding %"><NumInput value={funding} onChange={setFunding} width={40} /></ControlGroup>

        <Sep />
        {/* Risk layer */}
        <ControlGroup label="Stop %"><NumInput value={stopLoss} onChange={setStopLoss} width={40} /></ControlGroup>
        <ControlGroup label="TP %"><NumInput value={takeProfit} onChange={setTP} width={40} /></ControlGroup>
        <ControlGroup label="Kill DD %"><NumInput value={killDD} onChange={setKillDD} width={40} /></ControlGroup>
        <ControlGroup label="Size %eq"><NumInput value={sizePct} onChange={setSizePct} width={40} /></ControlGroup>

        <div style={{ flex: 1 }} />

        {/* strategy save / load */}
        {saved.length > 0 && (
          <select
            onChange={(e) => { loadStrategy(e.target.value); (e.target as HTMLSelectElement).value = ""; }}
            defaultValue=""
            style={{ fontFamily: mono, fontSize: 10, background: "#0a0a0a", border: "1px solid #1c1c1c", borderRadius: 2, color: "#888", padding: "4px 6px", cursor: "pointer" }}
          >
            <option value="">LOAD ▾</option>
            {saved.map((s) => <option key={s.slug} value={s.slug}>{s.name}</option>)}
          </select>
        )}
        <button onClick={() => { setSaveName(""); setSaveMsg(null); setShowSave(true); }}
          style={btnStyle(false, "#3aaa72", "#071a0e", "#0e3320")}>
          SAVE
        </button>

        <button onClick={runWalkForward} disabled={wfLoading || loading || strategy === "agent"}
          title={strategy === "agent" ? "Walk-forward is for rule strategies; the bot is a single trained model" : "Run the strategy across 5 sequential out-of-sample folds"}
          style={btnStyle(wfLoading || strategy === "agent", "#cfad4e", "#2a2410", "#3a3015")}>
          {wfLoading ? "..." : "WALK-FWD"}
        </button>
        <button onClick={runBacktest} disabled={loading}
          style={btnStyle(loading, "#4e8ecf", "#101e30", "#1c3050")}>
          {loading ? "running..." : "RUN BACKTEST"}
        </button>
      </div>

      {error && (
        <div style={{ fontFamily: mono, fontSize: 11, color: RED, padding: "6px 14px", background: "#1a0a0a", borderRadius: 3, flexShrink: 0 }}>
          {error}
        </div>
      )}

      {/* Walk-forward strip */}
      {wf && (
        <div className="panel" style={{ padding: "8px 14px", flexShrink: 0 }}>
          <div style={{ fontFamily: mono, fontSize: 9, color: "#444", marginBottom: 7, letterSpacing: "0.08em" }}>
            WALK-FORWARD · {wf.summary.folds} FOLDS · <span style={{ color: "#888" }}>{wf.summary.profitable_folds} profitable</span> · beats B&amp;H {wf.summary.beats_buy_hold_folds}/{wf.summary.folds} · consistency <span style={{ color: gr(wf.summary.consistency - 0.5) }}>{wf.summary.consistency}</span> · mean alpha <span style={{ color: gr(wf.summary.mean_alpha_pct) }}>{pct(wf.summary.mean_alpha_pct)}</span>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {wf.folds.map((f) => (
              <div key={f.fold} style={{ background: "#0c0c0c", border: "1px solid #1a1a1a", borderRadius: 3, padding: "4px 8px", minWidth: 86 }}>
                <div style={{ fontFamily: mono, fontSize: 8, color: "#555" }}>FOLD {f.fold} · {f.trades}t</div>
                <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 13, color: gr(f.return_pct) }}>{pct(f.return_pct)}</div>
                <div style={{ fontFamily: mono, fontSize: 8, color: "#666" }}>α {pct(f.alpha_pct)} · DD {f.max_drawdown.toFixed(1)}%</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Results */}
      {result ? (
        <div style={{ flex: 1, display: "flex", gap: 12, minHeight: 0 }}>
          <div style={{ width: 280, display: "flex", flexDirection: "column", gap: 10, flexShrink: 0 }}>
            <div className="panel" style={{ padding: "10px 14px" }}>
              <div style={{ fontFamily: mono, fontSize: 9, color: "#444", marginBottom: result.meta.strategy === "agent" ? 4 : 10, letterSpacing: "0.08em" }}>
                {result.meta.strategy.toUpperCase()} · {result.meta.coin} {result.meta.interval.toUpperCase()} · {result.meta.candles} candles
              </div>
              {result.meta.strategy === "agent" && (
                <div style={{ fontFamily: mono, fontSize: 8, color: "#6a5a2a", marginBottom: 10 }}>
                  trained on older 80% (in-sample) · recent 20% is out-of-sample
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 14px" }}>
                {STAT_LABELS.map(({ key, label, fmt, color }) => {
                  const val = result.stats[key] as number;
                  return (
                    <div key={key}>
                      <div style={{ fontFamily: mono, fontSize: 9, color: "#444", marginBottom: 2 }}>{label}</div>
                      <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 14, color: color ? color(val) : "#e8e8e8" }}>{fmt(val)}</div>
                    </div>
                  );
                })}
              </div>
              <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid #141414", display: "flex", flexWrap: "wrap", gap: "4px 12px", fontFamily: mono, fontSize: 9, color: "#666" }}>
                <span><span style={{ color: "#3aaa72" }}>{result.stats.long_trades}L</span> / <span style={{ color: "#aa3a3a" }}>{result.stats.short_trades}S</span></span>
                <span>fees ${result.stats.total_fees.toFixed(0)}</span>
                <span>funding ${result.stats.total_funding.toFixed(0)}</span>
                <span>slip ${result.stats.slippage_cost.toFixed(0)}</span>
                <span>maxL {result.stats.max_consec_losses}</span>
                {result.stats.halted && <span style={{ color: RED, fontWeight: 700 }}>⚠ KILL-SWITCH FIRED</span>}
              </div>
            </div>

            <div className="panel" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
              <div style={{ fontFamily: mono, fontSize: 9, color: "#444", padding: "8px 12px", borderBottom: "1px solid #141414", letterSpacing: "0.08em" }}>TRADE LOG</div>
              <div style={{ flex: 1, overflowY: "auto" }}>
                {result.trades.length === 0 ? (
                  <div style={{ padding: 12, fontFamily: mono, fontSize: 10, color: "#333" }}>No trades generated</div>
                ) : (
                  result.trades.slice().reverse().map((t, i) => (
                    <div key={i} style={{ padding: "6px 12px", borderBottom: "1px solid #0e0e0e", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <div style={{ fontFamily: mono, fontSize: 9, color: "#555", marginBottom: 2 }}>{fmtTime(t.open_time)}</div>
                        <div style={{ fontFamily: mono, fontSize: 10, color: "#e8e8e8" }}>
                          {t.direction.toUpperCase()} · ${t.entry_px.toLocaleString()} → ${t.exit_px.toLocaleString()}
                        </div>
                      </div>
                      <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 12, color: t.pnl_usd >= 0 ? GREEN : RED, textAlign: "right" }}>
                        {t.pnl_usd >= 0 ? "+" : ""}{t.pnl_usd.toFixed(2)}
                        <div style={{ fontFamily: mono, fontSize: 9, color: t.pnl_usd >= 0 ? "#3aaa72" : "#aa3a3a" }}>
                          {t.pnl_pct >= 0 ? "+" : ""}{t.pnl_pct.toFixed(2)}%
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="panel" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div style={{ fontFamily: mono, fontSize: 9, color: "#444", padding: "8px 12px", borderBottom: "1px solid #141414", letterSpacing: "0.08em", display: "flex", justifyContent: "space-between" }}>
              <span>EQUITY CURVE</span>
              <span style={{ color: "#555" }}>strategy <span style={{ color: "#3aaa72" }}>━</span>  ·  buy &amp; hold <span style={{ color: "#888" }}>┄</span></span>
            </div>
            <div ref={chartRef} style={{ flex: 1, minHeight: 0 }} />
          </div>
        </div>
      ) : !loading ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: mono, fontSize: 11, color: "#2a2a2a", textAlign: "center", lineHeight: 1.8 }}>
          configure parameters above and press RUN BACKTEST<br />
          <span style={{ fontSize: 9, color: "#222" }}>costs (slippage + funding) are on by default · set risk %s to enable stop / kill-switch / sizing</span>
        </div>
      ) : (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: mono, fontSize: 11, color: "#333" }}>
          fetching candles + running backtest...
        </div>
      )}

      {/* save-name modal */}
      {showSave && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100,
        }}>
          <div style={{ background: "#0c0c0c", border: "1px solid #1c1c1c", borderRadius: 4, padding: 24, width: 340, display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontFamily: mono, fontSize: 10, color: "#444", letterSpacing: "0.1em" }}>SAVE STRATEGY</div>
            <input
              autoFocus
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") saveStrategy(); if (e.key === "Escape") setShowSave(false); }}
              placeholder="strategy name"
              style={{ fontFamily: mono, fontSize: 12, background: "#070707", border: "1px solid #1c1c1c", borderRadius: 2, color: "#e8e8e8", padding: "6px 10px", outline: "none" }}
            />
            {saveMsg && <div style={{ fontFamily: mono, fontSize: 10, color: saveMsg.startsWith("Saved") ? GREEN : RED }}>{saveMsg}</div>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setShowSave(false)} style={btnStyle(false, "#888", "#111", "#1c1c1c")}>CANCEL</button>
              <button onClick={saveStrategy} disabled={!saveName.trim()} style={btnStyle(!saveName.trim(), "#3aaa72", "#071a0e", "#0e3320")}>SAVE</button>
            </div>
            {saved.length > 0 && (
              <div style={{ borderTop: "1px solid #141414", paddingTop: 10 }}>
                <div style={{ fontFamily: mono, fontSize: 9, color: "#333", marginBottom: 6 }}>SAVED STRATEGIES</div>
                {saved.map((s) => (
                  <div key={s.slug} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0" }}>
                    <span style={{ fontFamily: mono, fontSize: 10, color: "#888" }}>{s.name}</span>
                    <button onClick={() => deleteStrategy(s.slug)} style={{ fontFamily: mono, fontSize: 9, background: "none", border: "none", color: "#aa3a3a", cursor: "pointer", padding: "2px 4px" }}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {saveMsg && !showSave && (
        <div style={{ position: "fixed", bottom: 20, right: 20, fontFamily: mono, fontSize: 11, color: GREEN, background: "#071a0e", border: "1px solid #0e3320", borderRadius: 3, padding: "6px 14px", zIndex: 99 }}>
          {saveMsg}
        </div>
      )}
    </div>
  );
}

// ─── small reusable UI atoms ──────────────────────────────────────────────────

function btnStyle(disabled: boolean, color: string, bg: string, border: string): React.CSSProperties {
  return {
    fontFamily: mono, fontSize: 11, fontWeight: 600, padding: "6px 16px",
    background: disabled ? "#111" : bg, border: `1px solid ${disabled ? "#1a1a1a" : border}`,
    borderRadius: 3, color: disabled ? "#333" : color, cursor: disabled ? "not-allowed" : "pointer",
  };
}

function ControlGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ fontFamily: mono, fontSize: 8, color: "#444", letterSpacing: "0.1em" }}>{label.toUpperCase()}</div>
      <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>{children}</div>
    </div>
  );
}

function Chip({ active, onClick, children, color }: { active: boolean; onClick: () => void; children: React.ReactNode; color?: string }) {
  const c = color ?? "#4e8ecf";
  return (
    <button onClick={onClick} style={{
      fontFamily: mono, fontSize: 10, padding: "3px 8px",
      background: active ? `${c}18` : "none",
      border: active ? `1px solid ${c}55` : "1px solid transparent",
      borderRadius: 2, color: active ? c : "#555", cursor: "pointer",
      transition: "all 0.12s",
    }}>
      {children}
    </button>
  );
}

function Sep() { return <div style={{ width: 1, height: 28, background: "#1a1a1a" }} />; }

function NumInput({ value, onChange, prefix, suffix, width = 72 }: {
  value: string; onChange: (v: string) => void; prefix?: string; suffix?: string; width?: number;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
      {prefix && <span style={{ fontFamily: mono, fontSize: 10, color: "#444" }}>{prefix}</span>}
      <input value={value} onChange={(e) => onChange(e.target.value)} style={{
        width, fontFamily: mono, fontSize: 11, background: "#0a0a0a", border: "1px solid #1c1c1c",
        borderRadius: 2, color: "#e8e8e8", padding: "3px 6px", outline: "none",
      }} />
      {suffix && <span style={{ fontFamily: mono, fontSize: 10, color: "#444" }}>{suffix}</span>}
    </div>
  );
}
