"use client";

import { useEffect, useRef, useState } from "react";

type Coin      = "BTC" | "ETH" | "SOL";
type Interval  = "15m" | "1h" | "4h" | "1d";
type Strategy  = "momentum" | "breakout" | "mean_reversion" | "ema_cross" | "macd" | "bollinger";

const STRATEGIES: Strategy[] = ["momentum", "breakout", "mean_reversion", "ema_cross", "macd", "bollinger"];
const STRAT_LABEL: Record<Strategy, string> = {
  momentum: "momentum", breakout: "breakout", mean_reversion: "mean rev",
  ema_cross: "ema cross", macd: "macd", bollinger: "bollinger",
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
  total_trades:      number;
  win_rate:          number;
  profit_factor:     number;
  max_drawdown:      number;
  sharpe:            number;
  sortino:           number;
  net_pnl:           number;
  return_pct:        number;
  avg_win:           number;
  avg_loss:          number;
  expectancy:        number;
  max_consec_losses: number;
  best_trade:        number;
  worst_trade:       number;
  total_fees:        number;
  long_trades:       number;
  short_trades:      number;
  exposure:          number;
}

interface BacktestResult {
  trades:        Trade[];
  equity_curve:  { time: number; value: number }[];
  stats:         Stats;
  meta:          { coin: string; interval: string; strategy: string; candles: number };
}

const mono = "var(--font-mono, 'IBM Plex Mono', monospace)";
const sans = "var(--font-sans, Inter, sans-serif)";

const STAT_LABELS: { key: keyof Stats; label: string; fmt: (v: number) => string; color?: (v: number) => string }[] = [
  { key: "net_pnl",       label: "Net P&L",       fmt: (v) => `$${v >= 0 ? "+" : ""}${v.toFixed(2)}`, color: (v) => v >= 0 ? "#4ecf8a" : "#cf4e4e" },
  { key: "return_pct",    label: "Return",        fmt: (v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`,  color: (v) => v >= 0 ? "#4ecf8a" : "#cf4e4e" },
  { key: "win_rate",      label: "Win Rate",      fmt: (v) => `${v.toFixed(1)}%`,                       color: (v) => v >= 50 ? "#4ecf8a" : "#cf4e4e" },
  { key: "profit_factor", label: "Profit Factor", fmt: (v) => v.toFixed(2),                             color: (v) => v >= 1 ? "#4ecf8a" : "#cf4e4e" },
  { key: "sharpe",        label: "Sharpe",        fmt: (v) => v.toFixed(2),                             color: (v) => v >= 1 ? "#4ecf8a" : v >= 0 ? "#cfad4e" : "#cf4e4e" },
  { key: "sortino",       label: "Sortino",       fmt: (v) => v.toFixed(2),                             color: (v) => v >= 1 ? "#4ecf8a" : v >= 0 ? "#cfad4e" : "#cf4e4e" },
  { key: "max_drawdown",  label: "Max Drawdown",  fmt: (v) => `${v.toFixed(2)}%`,                       color: (v) => v < 10 ? "#4ecf8a" : v < 20 ? "#cfad4e" : "#cf4e4e" },
  { key: "expectancy",    label: "Expectancy",    fmt: (v) => `$${v >= 0 ? "+" : ""}${v.toFixed(2)}`,  color: (v) => v >= 0 ? "#4ecf8a" : "#cf4e4e" },
  { key: "avg_win",       label: "Avg Win",       fmt: (v) => `$${v.toFixed(2)}`,                       color: () => "#4ecf8a" },
  { key: "avg_loss",      label: "Avg Loss",      fmt: (v) => `$${v.toFixed(2)}`,                       color: () => "#cf4e4e" },
  { key: "exposure",      label: "Exposure",      fmt: (v) => `${v.toFixed(1)}%` },
  { key: "total_trades",  label: "Total Trades",  fmt: (v) => String(v) },
];

function fmtTime(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
}

export default function BacktestPage() {
  const [coin, setCoin]         = useState<Coin>("BTC");
  const [interval, setInterval] = useState<Interval>("1h");
  const [strategy, setStrategy] = useState<Strategy>("momentum");
  const [balance, setBalance]   = useState("10000");
  const [sizeUsd, setSizeUsd]   = useState("200");
  const [leverage, setLeverage] = useState("5");
  const [loading, setLoading]   = useState(false);
  const [result, setResult]     = useState<BacktestResult | null>(null);
  const [error, setError]       = useState<string | null>(null);

  const chartRef   = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chartInst  = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const seriesInst = useRef<any>(null);

  async function runBacktest() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("http://localhost:8000/backtest", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          coin,
          interval,
          strategy,
          starting_balance: parseFloat(balance) || 10000,
          size_usd:         parseFloat(sizeUsd) || 200,
          leverage:         parseInt(leverage) || 5,
        }),
      });
      if (res.status === 404) {
        setError("Bridge is running old code — restart server/main.py to load the /backtest endpoint");
        return;
      }
      if (!res.ok) {
        setError(`Backtest request failed (HTTP ${res.status})`);
        return;
      }
      const data = await res.json();
      if (data?.error) { setError(data.error); return; }
      if (!data?.meta || !data?.stats) {
        setError("Unexpected response from bridge — restart server/main.py and retry");
        return;
      }
      setResult(data as BacktestResult);
    } catch (e) {
      setError("Bridge server offline — start server/main.py first");
    } finally {
      setLoading(false);
    }
  }

  // Init equity chart
  useEffect(() => {
    if (!result || !chartRef.current) return;
    let destroyed = false;
    const snapshot = result;

    async function init() {
      const lc = await import("lightweight-charts");
      if (destroyed || !chartRef.current) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { createChart, LineSeries, createSeriesMarkers } = lc as any;

      if (chartInst.current) {
        chartInst.current.remove();
        chartInst.current = null;
        seriesInst.current = null;
      }

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

      const series = chart.addSeries(LineSeries, {
        color:     snapshot.stats.net_pnl >= 0 ? "#3aaa72" : "#aa3a3a",
        lineWidth: 2,
      });

      series.setData(snapshot.equity_curve);

      // Trade markers on the equity curve: green ↑ for wins, red ↓ for losses
      const markers = snapshot.trades
        .map((t) => ({
          time:     t.close_time,
          position: t.pnl_usd >= 0 ? "aboveBar" : "belowBar",
          color:    t.pnl_usd >= 0 ? "#3aaa72" : "#aa3a3a",
          shape:    t.pnl_usd >= 0 ? "arrowUp" : "arrowDown",
          text:     `${t.pnl_usd >= 0 ? "+" : ""}${t.pnl_usd.toFixed(0)}`,
        }))
        .sort((a, b) => a.time - b.time);
      if (markers.length > 0) createSeriesMarkers(series, markers);

      chart.timeScale().fitContent();

      chartInst.current  = chart;
      seriesInst.current = series;

      const ro = new ResizeObserver(() => {
        if (chartRef.current && chartInst.current) {
          chartInst.current.applyOptions({
            width:  chartRef.current.clientWidth,
            height: chartRef.current.clientHeight,
          });
        }
      });
      ro.observe(chartRef.current);
    }

    init();
    return () => { destroyed = true; };
  }, [result]);

  // Cleanup on unmount
  useEffect(() => () => {
    if (chartInst.current) { chartInst.current.remove(); chartInst.current = null; }
  }, []);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", padding: 12, gap: 12, overflow: "hidden" }}>

      {/* Controls */}
      <div className="panel" style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 16, flexShrink: 0, flexWrap: "wrap" }}>

        {/* Coin */}
        <ControlGroup label="Coin">
          {(["BTC", "ETH", "SOL"] as Coin[]).map((c) => (
            <Chip key={c} active={coin === c} onClick={() => setCoin(c)}>{c}</Chip>
          ))}
        </ControlGroup>

        <Sep />

        {/* Interval */}
        <ControlGroup label="Interval">
          {(["15m", "1h", "4h", "1d"] as Interval[]).map((iv) => (
            <Chip key={iv} active={interval === iv} onClick={() => setInterval(iv)}>{iv}</Chip>
          ))}
        </ControlGroup>

        <Sep />

        {/* Strategy */}
        <ControlGroup label="Strategy">
          {STRATEGIES.map((s) => (
            <Chip key={s} active={strategy === s} onClick={() => setStrategy(s)}>{STRAT_LABEL[s]}</Chip>
          ))}
        </ControlGroup>

        <Sep />

        {/* Numeric inputs */}
        <ControlGroup label="Balance">
          <NumInput value={balance} onChange={setBalance} prefix="$" />
        </ControlGroup>
        <ControlGroup label="Size/trade">
          <NumInput value={sizeUsd} onChange={setSizeUsd} prefix="$" />
        </ControlGroup>
        <ControlGroup label="Leverage">
          <NumInput value={leverage} onChange={setLeverage} suffix="×" width={48} />
        </ControlGroup>

        <div style={{ flex: 1 }} />

        <button
          onClick={runBacktest}
          disabled={loading}
          style={{
            fontFamily: mono,
            fontSize: 11,
            fontWeight: 600,
            padding: "6px 18px",
            background: loading ? "#111" : "#101e30",
            border: "1px solid #1c3050",
            borderRadius: 3,
            color: loading ? "#333" : "#4e8ecf",
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          {loading ? "running..." : "RUN BACKTEST"}
        </button>
      </div>

      {error && (
        <div style={{ fontFamily: mono, fontSize: 11, color: "#cf4e4e", padding: "6px 14px", background: "#1a0a0a", borderRadius: 3 }}>
          {error}
        </div>
      )}

      {/* Results area */}
      {result ? (
        <div style={{ flex: 1, display: "flex", gap: 12, minHeight: 0 }}>

          {/* Left: stats + trade log */}
          <div style={{ width: 280, display: "flex", flexDirection: "column", gap: 10, flexShrink: 0 }}>

            {/* Stats grid */}
            <div className="panel" style={{ padding: "10px 14px" }}>
              <div style={{ fontFamily: mono, fontSize: 9, color: "#444", marginBottom: 10, letterSpacing: "0.08em" }}>
                {result.meta.strategy.toUpperCase()} · {result.meta.coin} {result.meta.interval.toUpperCase()} · {result.meta.candles} candles
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 14px" }}>
                {STAT_LABELS.map(({ key, label, fmt, color }) => {
                  const val = result.stats[key];
                  return (
                    <div key={key}>
                      <div style={{ fontFamily: mono, fontSize: 9, color: "#444", marginBottom: 2 }}>{label}</div>
                      <div style={{
                        fontFamily: sans,
                        fontWeight: 700,
                        fontSize: 14,
                        color: color ? color(val) : "#e8e8e8",
                      }}>
                        {fmt(val)}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* secondary stats row */}
              <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid #141414", display: "flex", flexWrap: "wrap", gap: "4px 12px", fontFamily: mono, fontSize: 9, color: "#666" }}>
                <span><span style={{ color: "#3aaa72" }}>{result.stats.long_trades}L</span> / <span style={{ color: "#aa3a3a" }}>{result.stats.short_trades}S</span></span>
                <span>best <span style={{ color: "#4ecf8a" }}>+${result.stats.best_trade.toFixed(0)}</span></span>
                <span>worst <span style={{ color: "#cf4e4e" }}>${result.stats.worst_trade.toFixed(0)}</span></span>
                <span>max consec L {result.stats.max_consec_losses}</span>
                <span>fees ${result.stats.total_fees.toFixed(0)}</span>
              </div>
            </div>

            {/* Trade log */}
            <div className="panel" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
              <div style={{ fontFamily: mono, fontSize: 9, color: "#444", padding: "8px 12px", borderBottom: "1px solid #141414", letterSpacing: "0.08em" }}>
                TRADE LOG
              </div>
              <div style={{ flex: 1, overflowY: "auto" }}>
                {result.trades.length === 0 ? (
                  <div style={{ padding: 12, fontFamily: mono, fontSize: 10, color: "#333" }}>No trades generated</div>
                ) : (
                  result.trades.slice().reverse().map((t, i) => (
                    <div
                      key={i}
                      style={{
                        padding: "6px 12px",
                        borderBottom: "1px solid #0e0e0e",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <div>
                        <div style={{ fontFamily: mono, fontSize: 9, color: "#555", marginBottom: 2 }}>{fmtTime(t.open_time)}</div>
                        <div style={{ fontFamily: mono, fontSize: 10, color: "#e8e8e8" }}>
                          {t.direction.toUpperCase()} · ${t.entry_px.toLocaleString()} → ${t.exit_px.toLocaleString()}
                        </div>
                      </div>
                      <div style={{
                        fontFamily: sans,
                        fontWeight: 700,
                        fontSize: 12,
                        color: t.pnl_usd >= 0 ? "#4ecf8a" : "#cf4e4e",
                        textAlign: "right",
                      }}>
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

          {/* Right: equity curve */}
          <div className="panel" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div style={{ fontFamily: mono, fontSize: 9, color: "#444", padding: "8px 12px", borderBottom: "1px solid #141414", letterSpacing: "0.08em" }}>
              EQUITY CURVE
            </div>
            <div ref={chartRef} style={{ flex: 1, minHeight: 0 }} />
          </div>
        </div>
      ) : !loading ? (
        <div style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: mono,
          fontSize: 11,
          color: "#2a2a2a",
        }}>
          configure parameters above and press RUN BACKTEST
        </div>
      ) : (
        <div style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: mono,
          fontSize: 11,
          color: "#333",
        }}>
          fetching candles + running backtest...
        </div>
      )}
    </div>
  );
}

// ─── small reusable UI atoms ──────────────────────────────────────────────────

function ControlGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ fontFamily: "var(--font-mono,'IBM Plex Mono',monospace)", fontSize: 8, color: "#444", letterSpacing: "0.1em" }}>
        {label.toUpperCase()}
      </div>
      <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
        {children}
      </div>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontFamily: "var(--font-mono,'IBM Plex Mono',monospace)",
        fontSize: 10,
        padding: "3px 8px",
        background: active ? "#101e30" : "none",
        border: active ? "1px solid #1c3050" : "1px solid transparent",
        borderRadius: 2,
        color: active ? "#4e8ecf" : "#555",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <div style={{ width: 1, height: 28, background: "#1a1a1a" }} />;
}

function NumInput({
  value, onChange, prefix, suffix, width = 72,
}: {
  value: string;
  onChange: (v: string) => void;
  prefix?: string;
  suffix?: string;
  width?: number;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
      {prefix && <span style={{ fontFamily: "var(--font-mono,'IBM Plex Mono',monospace)", fontSize: 10, color: "#444" }}>{prefix}</span>}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width,
          fontFamily: "var(--font-mono,'IBM Plex Mono',monospace)",
          fontSize: 11,
          background: "#0a0a0a",
          border: "1px solid #1c1c1c",
          borderRadius: 2,
          color: "#e8e8e8",
          padding: "3px 6px",
          outline: "none",
        }}
      />
      {suffix && <span style={{ fontFamily: "var(--font-mono,'IBM Plex Mono',monospace)", fontSize: 10, color: "#444" }}>{suffix}</span>}
    </div>
  );
}
