"use client";

import { useEffect, useRef, useState } from "react";
import { BRIDGE_HTTP } from "@/lib/bridge";
import type { HLStreamData, MarketMetric, HLLiquidation } from "@/hooks/useHLStream";

const mono = "var(--font-mono, 'IBM Plex Mono', monospace)";
const sans = "var(--font-sans, Inter, sans-serif)";
const GREEN = "#4ecf8a", RED = "#cf4e4e", AMBER = "#cfad4e";
const COINS = ["BTC", "ETH", "SOL"] as const;

// ── helpers ──────────────────────────────────────────────────────────────────

function fmtM(usd: number): string {
  if (usd >= 1_000_000_000) return `$${(usd / 1_000_000_000).toFixed(2)}B`;
  if (usd >= 1_000_000)     return `$${(usd / 1_000_000).toFixed(1)}M`;
  return `$${usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function fmtPx(px: number): string {
  return `$${px.toLocaleString(undefined, { maximumFractionDigits: px < 10 ? 3 : 2 })}`;
}

function fmtTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function fundingColor(apr: number): string {
  if (apr >  30) return RED;    // very expensive to be long
  if (apr >   5) return AMBER;  // somewhat bullish/costly
  if (apr <  -5) return GREEN;  // cheap to be long (shorts paying)
  return "#888";
}

// ── main page ─────────────────────────────────────────────────────────────────

export default function DataHubPage({ hl }: { hl: HLStreamData }) {
  const metrics     = hl.marketMetrics;
  const liquidations = hl.liquidations ?? [];

  const [chartCoin, setChartCoin]     = useState<"BTC" | "ETH" | "SOL">("BTC");
  const [chartDays, setChartDays]     = useState<7 | 30 | 90>(7);
  const [fundingData, setFundingData] = useState<{time: number; value: number}[]>([]);
  const [chartLoading, setChartLoading] = useState(false);
  const chartRef  = useRef<HTMLDivElement>(null);
  const chartInst = useRef<unknown>(null);
  const roRef     = useRef<ResizeObserver | null>(null);

  // Fetch funding history whenever coin or window changes
  useEffect(() => {
    let cancelled = false;
    setChartLoading(true);
    (async () => {
      try {
        const r = await fetch(`${BRIDGE_HTTP}/data/funding/${chartCoin}?days=${chartDays}`);
        if (!r.ok || cancelled) return;
        const data: {time: number; funding_apr: number}[] = await r.json();
        if (cancelled) return;
        setFundingData(data.map(d => ({ time: d.time, value: d.funding_apr })));
      } catch { /* bridge offline */ }
      finally { if (!cancelled) setChartLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [chartCoin, chartDays]);

  // Build / update funding chart
  useEffect(() => {
    if (!chartRef.current || fundingData.length < 2) return;
    let destroyed = false;

    (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const lc = await import("lightweight-charts") as any;
      if (destroyed || !chartRef.current) return;

      const { createChart, BaselineSeries } = lc;

      if (chartInst.current) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (chartInst.current as any).remove();
        chartInst.current = null;
      }

      const chart = createChart(chartRef.current, {
        layout:   { background: { color: "#0a0a0a" }, textColor: "#555" },
        grid:     { vertLines: { color: "rgba(255,255,255,0.03)" }, horzLines: { color: "rgba(255,255,255,0.03)" } },
        crosshair: {
          vertLine: { color: "rgba(255,255,255,0.2)", labelBackgroundColor: "#1c1c1c" },
          horzLine: { color: "rgba(255,255,255,0.2)", labelBackgroundColor: "#1c1c1c" },
        },
        rightPriceScale: { borderColor: "transparent", textColor: "#555" },
        timeScale:        { borderColor: "transparent", timeVisible: true },
        width:  chartRef.current.clientWidth,
        height: chartRef.current.clientHeight,
      });

      const series = chart.addSeries(BaselineSeries, {
        baseValue:        { type: "price", price: 0 },
        topLineColor:     RED,
        topFillColor1:    "rgba(207,78,78,0.25)",
        topFillColor2:    "rgba(207,78,78,0.04)",
        bottomLineColor:  GREEN,
        bottomFillColor1: "rgba(78,207,138,0.04)",
        bottomFillColor2: "rgba(78,207,138,0.25)",
        lineWidth: 1.5,
        priceLineVisible: false,
      });

      series.setData(fundingData);
      chart.timeScale().fitContent();
      chartInst.current = chart;

      const ro = new ResizeObserver(() => {
        try {
          if (chartRef.current && chartInst.current) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (chartInst.current as any).applyOptions({
              width:  chartRef.current.clientWidth,
              height: chartRef.current.clientHeight,
            });
          }
        } catch { /* chart disposed */ }
      });
      ro.observe(chartRef.current);
      roRef.current = ro;
    })();

    return () => {
      destroyed = true;
      if (roRef.current) { roRef.current.disconnect(); roRef.current = null; }
    };
  }, [fundingData]);

  useEffect(() => () => {
    if (roRef.current) { roRef.current.disconnect(); roRef.current = null; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (chartInst.current) { try { (chartInst.current as any).remove(); } catch {} chartInst.current = null; }
  }, []);

  return (
    <div style={{
      height: "100%", padding: 12, display: "flex", flexDirection: "column", gap: 12, overflow: "auto",
      WebkitOverflowScrolling: "touch",
      paddingBottom: "calc(var(--bottom-nav-h, 56px) + env(safe-area-inset-bottom, 0px) + 12px)",
    }}>

      {/* ── Metric cards row ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, flexShrink: 0 }}>
        {COINS.map((coin) => (
          <MetricCard key={coin} coin={coin} data={metrics?.[coin] ?? null} />
        ))}
      </div>

      {/* ── Funding history chart ── */}
      <div className="panel" style={{ flexShrink: 0, height: 220, display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderBottom: "1px solid #141414", flexShrink: 0 }}>
          <span style={{ fontFamily: mono, fontSize: 9, color: "#444", letterSpacing: "0.1em" }}>
            FUNDING RATE APR — {chartCoin}
          </span>
          <div style={{ display: "flex", gap: 4 }}>
            {COINS.map((c) => (
              <TinyChip key={c} active={chartCoin === c} onClick={() => setChartCoin(c)}>{c}</TinyChip>
            ))}
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
            {([7, 30, 90] as const).map((d) => (
              <TinyChip key={d} active={chartDays === d} onClick={() => setChartDays(d)}>{d}d</TinyChip>
            ))}
          </div>
          {chartLoading && <span style={{ fontFamily: mono, fontSize: 9, color: "#333" }}>loading…</span>}
        </div>
        {fundingData.length < 2 && !chartLoading ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: mono, fontSize: 10, color: "#555" }}>
            bridge offline — funding history unavailable
          </div>
        ) : (
          <div ref={chartRef} style={{ flex: 1, minHeight: 0 }} />
        )}
      </div>

      {/* ── Liquidations feed ── */}
      <div className="panel" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ fontFamily: mono, fontSize: 9, color: "#444", padding: "8px 12px", borderBottom: "1px solid #141414", letterSpacing: "0.1em", flexShrink: 0, display: "flex", justifyContent: "space-between" }}>
          <span>LIQUIDATIONS · LIVE</span>
          {liquidations.length > 0 && (
            <span style={{ color: "#333" }}>{liquidations.length} captured this session</span>
          )}
        </div>
        <div style={{ flex: 1, overflowY: "auto" }}>
          {liquidations.length === 0 ? (
            <div style={{ padding: 16, fontFamily: mono, fontSize: 10, color: "#555", lineHeight: 1.8 }}>
              No liquidations yet this session.<br />
              <span style={{ fontSize: 9, color: "#444" }}>Events appear here in real-time as they happen on-chain.</span>
            </div>
          ) : (
            liquidations.slice().reverse().map((liq, i) => (
              <LiqRow key={i} liq={liq} />
            ))
          )}
        </div>
      </div>

    </div>
  );
}

// ── sub-components ────────────────────────────────────────────────────────────

function MetricCard({ coin, data }: { coin: string; data: MarketMetric | null }) {
  const apr = data?.funding_apr ?? 0;
  const fc  = fundingColor(apr);

  return (
    <div className="panel" style={{ padding: "12px 14px" }}>
      <div style={{ fontFamily: mono, fontSize: 9, color: "#444", marginBottom: 8, letterSpacing: "0.08em" }}>
        {coin}/USDC · PERP
      </div>

      {data ? (
        <>
          <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 24, color: "#e8e8e8", marginBottom: 10 }}>
            {fmtPx(data.mark_px)}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "7px 14px" }}>
            <MiniStat label="Day change"
              value={`${data.day_change_pct >= 0 ? "+" : ""}${data.day_change_pct.toFixed(2)}%`}
              color={data.day_change_pct >= 0 ? GREEN : RED} />
            <MiniStat label="Funding /hr"
              value={`${(data.funding_rate * 100).toFixed(4)}%`}
              color={fc} />
            <MiniStat label="Funding APR"
              value={`${data.funding_apr >= 0 ? "+" : ""}${data.funding_apr.toFixed(1)}%`}
              color={fc} />
            <MiniStat label="Open Interest"
              value={fmtM(data.oi_usd)} />
            <MiniStat label="24h Volume"
              value={fmtM(data.day_ntl_vol)} />
          </div>
        </>
      ) : (
        <div style={{ fontFamily: mono, fontSize: 10, color: "#555", paddingTop: 6 }}>bridge offline</div>
      )}
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div style={{ fontFamily: mono, fontSize: 8, color: "#555", marginBottom: 2 }}>{label.toUpperCase()}</div>
      <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 13, color: color ?? "#e8e8e8" }}>{value}</div>
    </div>
  );
}

function LiqRow({ liq }: { liq: HLLiquidation }) {
  const isLong = liq.side === "LONG";
  return (
    <div style={{
      padding: "6px 12px", borderBottom: "1px solid #0e0e0e",
      display: "flex", alignItems: "center", gap: 10,
    }}>
      <div style={{
        fontFamily: mono, fontSize: 9, fontWeight: 700, width: 40, flexShrink: 0,
        color: isLong ? RED : GREEN,  // long liquidation = forced sell = red
      }}>
        {liq.coin}
      </div>
      <div style={{
        fontFamily: mono, fontSize: 9, width: 48, flexShrink: 0,
        color: isLong ? RED : GREEN,
        background: isLong ? "rgba(207,78,78,0.08)" : "rgba(78,207,138,0.08)",
        border: `1px solid ${isLong ? "rgba(207,78,78,0.2)" : "rgba(78,207,138,0.2)"}`,
        borderRadius: 2, padding: "1px 5px", textAlign: "center",
      }}>
        {liq.side}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 12, color: "#e8e8e8" }}>
          {fmtM(liq.notional)}
        </div>
        <div style={{ fontFamily: mono, fontSize: 9, color: "#555" }}>
          {liq.sz.toFixed(4)} @ {fmtPx(liq.px)}
        </div>
      </div>
      <div style={{ fontFamily: mono, fontSize: 9, color: "#444", flexShrink: 0 }}>
        {fmtTime(liq.time)}
      </div>
      {liq.user && (
        <div style={{ fontFamily: mono, fontSize: 8, color: "#555", flexShrink: 0 }}>
          {liq.user}…
        </div>
      )}
    </div>
  );
}

function TinyChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{
      fontFamily: mono, fontSize: 9, padding: "2px 7px",
      background: active ? "#101e30" : "none",
      border: active ? "1px solid #1c3050" : "1px solid transparent",
      borderRadius: 2, color: active ? "#4e8ecf" : "#555", cursor: "pointer",
    }}>
      {children}
    </button>
  );
}
