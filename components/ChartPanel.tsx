"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { Candle } from "@/lib/types";
import { ema, rsi, macd, bollinger, volume, fib } from "@/lib/indicators";

type Timeframe = "1m" | "15m" | "1h" | "4h" | "1d";
type Coin = "BTC" | "ETH" | "SOL";
type IndKey = "ma" | "bb" | "vol" | "rsi" | "macd" | "fib";

const TF_LABELS: Timeframe[] = ["1m", "15m", "1h", "4h", "1d"];

// For the REST endpoint, map display labels to HL interval strings
const TF_INTERVAL: Record<Timeframe, string> = {
  "1m":  "1m",
  "15m": "15m",
  "1h":  "1h",
  "4h":  "4h",
  "1d":  "1d",
};

// Max candles to fetch per timeframe (0 = full history from token launch, served from server cache)
const TF_LIMIT: Record<Timeframe, number> = {
  "1m":  1000,  // bounded recent window via REST; live WS updates layer on top
  "15m": 0,     // full history (cached server-side)
  "1h":  0,     // full history (cached server-side)
  "4h":  0,     // full history (cached server-side)
  "1d":  0,     // full history (cached server-side)
};

const IND_LABELS: { key: IndKey; label: string }[] = [
  { key: "ma",   label: "MA" },
  { key: "bb",   label: "BOLL" },
  { key: "vol",  label: "VOL" },
  { key: "rsi",  label: "RSI" },
  { key: "macd", label: "MACD" },
  { key: "fib",  label: "FIB" },
];

// Price formatter: more decimals for sub-dollar assets, fewer for large prices.
function fmtP(v: number): string {
  if (!isFinite(v)) return "–";
  const a = Math.abs(v);
  const d = a >= 1000 ? 1 : a >= 1 ? 2 : 4;
  return v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

// Compact volume formatter (K/M/B).
function fmtVol(v: number): string {
  if (v >= 1e9) return (v / 1e9).toFixed(2) + "B";
  if (v >= 1e6) return (v / 1e6).toFixed(2) + "M";
  if (v >= 1e3) return (v / 1e3).toFixed(1) + "K";
  return v.toFixed(0);
}

interface LegendItem {
  label: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  series: any;
  color: string;
  fmt: (v: number) => string;
  last: number;
}

interface Props {
  // Live 1m candles from WebSocket
  liveCandles: Record<string, Candle[]> | null;
  // Prices for the current coin
  prices: { btc: number; eth: number; sol: number } | null;
  // Entry price to draw a horizontal line (when position is open)
  entryPrice?: number;
  // When true, show the indicator toolbar, sub-panes, fib levels and crosshair legend.
  advanced?: boolean;
}

async function fetchCandles(coin: Coin, interval: string, limit: number): Promise<Candle[]> {
  const params = new URLSearchParams({ interval });
  if (limit > 0) params.set("limit", String(limit));
  const res = await fetch(`http://localhost:8000/candles/${coin}?${params}`);
  if (!res.ok) return [];
  return res.json();
}

export default function ChartPanel({ liveCandles, prices, entryPrice, advanced = false }: Props) {
  const [coin, setCoin] = useState<Coin>("BTC");
  const [tf, setTf] = useState<Timeframe>("1h");
  const [loading, setLoading] = useState(false);
  const [historicalCandles, setHistoricalCandles] = useState<Candle[]>([]);
  const [chartReady, setChartReady] = useState(false);
  const [ind, setInd] = useState<Record<IndKey, boolean>>({
    ma: true, bb: false, vol: true, rsi: false, macd: false, fib: false,
  });

  const chartRef        = useRef<HTMLDivElement>(null);
  const legendRef       = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chartInst       = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const seriesInst      = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lcRef           = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entryLine       = useRef<any>(null);
  // Indicator series created for the current toggle state (torn down on reconcile)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const indSeriesRef    = useRef<any[]>([]);
  const legendItemsRef  = useRef<LegendItem[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fibLinesRef     = useRef<any[]>([]);
  const fibRafRef       = useRef<number | null>(null);
  // Mirror of `ind` for stable callbacks (crosshair / visible-range subscriptions)
  const indRef          = useRef(ind);
  // Keeps the latest candles available at chart-init time (fixes race condition)
  const displayCandlesRef = useRef<Candle[]>([]);

  const currentPrice = prices
    ? coin === "BTC" ? prices.btc : coin === "ETH" ? prices.eth : prices.sol
    : 0;

  // All timeframes seed from REST/cache; 1m then gets live WS updates layered on top
  const displayCandles: Candle[] = historicalCandles;

  useEffect(() => { indRef.current = ind; }, [ind]);

  // Fetch historical candles when coin or timeframe changes
  const loadHistorical = useCallback(async () => {
    setLoading(true);
    const data = await fetchCandles(coin, TF_INTERVAL[tf], TF_LIMIT[tf]);
    setHistoricalCandles(data);
    setLoading(false);
  }, [coin, tf]);

  useEffect(() => {
    loadHistorical();
  }, [loadHistorical]);

  // Crosshair legend: OHLC + change% + enabled indicator values. Reads hovered
  // point from param.seriesData, else falls back to the last computed value.
  // Stable (reads refs only) so it can be subscribed once at init.
  const updateLegend = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (param: any) => {
      const el = legendRef.current;
      if (!el) return; // legend only rendered in advanced mode
      const cs = seriesInst.current;
      const hovering = !!(param && param.time !== undefined && param.seriesData);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let bar: any = null;
      if (hovering && cs && param.seriesData.get(cs)) {
        bar = param.seriesData.get(cs);
      } else {
        const arr = displayCandlesRef.current;
        bar = arr.length ? arr[arr.length - 1] : null;
      }

      let html = "";
      if (bar && bar.open !== undefined) {
        const chg = bar.open ? ((bar.close - bar.open) / bar.open) * 100 : 0;
        const chgColor = chg >= 0 ? "#3aaa72" : "#aa3a3a";
        html += `<span style="color:#666">O</span><span style="color:#bbb">${fmtP(bar.open)}</span> `;
        html += `<span style="color:#666">H</span><span style="color:#bbb">${fmtP(bar.high)}</span> `;
        html += `<span style="color:#666">L</span><span style="color:#bbb">${fmtP(bar.low)}</span> `;
        html += `<span style="color:#666">C</span><span style="color:#bbb">${fmtP(bar.close)}</span> `;
        html += `<span style="color:${chgColor}">${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%</span>`;
      }

      for (const item of legendItemsRef.current) {
        let v: number | undefined;
        if (hovering && param.seriesData.get(item.series)) {
          const d = param.seriesData.get(item.series);
          v = d && d.value !== undefined ? d.value : undefined;
        } else {
          v = item.last;
        }
        if (v === undefined || v === null || !isFinite(v)) continue;
        html += `   <span style="color:${item.color}">${item.label} ${item.fmt(v)}</span>`;
      }

      el.innerHTML = html;
    },
    [],
  );

  const clearFib = useCallback(() => {
    const cs = seriesInst.current;
    if (cs) {
      for (const ln of fibLinesRef.current) {
        try { cs.removePriceLine(ln); } catch { /* gone */ }
      }
    }
    fibLinesRef.current = [];
  }, []);

  // Draw fib levels over the currently-visible candle slice. Recomputed on
  // pan/zoom so the levels track what the user is looking at.
  const applyFib = useCallback(() => {
    clearFib();
    if (!advanced || !indRef.current.fib) return;
    const chart = chartInst.current;
    const cs = seriesInst.current;
    if (!chart || !cs) return;
    const candles = displayCandlesRef.current;
    if (candles.length === 0) return;

    let slice = candles;
    const range = chart.timeScale().getVisibleLogicalRange();
    if (range) {
      const from = Math.max(0, Math.floor(range.from));
      const to = Math.min(candles.length - 1, Math.ceil(range.to));
      if (to > from) slice = candles.slice(from, to + 1);
    }

    for (const lv of fib(slice)) {
      const ln = cs.createPriceLine({
        price: lv.price,
        color: lv.color,
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: lv.label,
      });
      fibLinesRef.current.push(ln);
    }
  }, [advanced, clearFib]);

  const scheduleFib = useCallback(() => {
    if (fibRafRef.current) cancelAnimationFrame(fibRafRef.current);
    fibRafRef.current = requestAnimationFrame(() => {
      fibRafRef.current = null;
      applyFib();
    });
  }, [applyFib]);

  // Init lightweight-charts once
  useEffect(() => {
    let destroyed = false;
    requestAnimationFrame(() => {
      if (destroyed || !chartRef.current || chartInst.current) return;
      import("lightweight-charts").then((lc) => {
        if (destroyed || !chartRef.current || chartInst.current) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { createChart, CandlestickSeries } = lc as any;

        const chart = createChart(chartRef.current, {
          layout: {
            background: { color: "#0c0c0c" },
            textColor: "#555",
          },
          grid: {
            vertLines: { color: "rgba(255,255,255,0.03)" },
            horzLines: { color: "rgba(255,255,255,0.03)" },
          },
          crosshair: {
            vertLine: { color: "rgba(255,255,255,0.2)", labelBackgroundColor: "#1c1c1c" },
            horzLine: { color: "rgba(255,255,255,0.2)", labelBackgroundColor: "#1c1c1c" },
          },
          rightPriceScale: { borderColor: "transparent", textColor: "#555" },
          timeScale: { borderColor: "transparent", timeVisible: true, secondsVisible: false },
          width: chartRef.current.clientWidth,
          height: chartRef.current.clientHeight,
        });

        const series = chart.addSeries(CandlestickSeries, {
          upColor:       "#3aaa72",
          downColor:     "#aa3a3a",
          borderUpColor: "#3aaa72",
          borderDownColor: "#aa3a3a",
          wickUpColor:   "rgba(58,170,114,0.6)",
          wickDownColor: "rgba(170,58,58,0.6)",
        });

        chartInst.current  = chart;
        seriesInst.current = series;
        lcRef.current      = lc;

        // Seed with any candles that already arrived before init completed
        if (displayCandlesRef.current.length > 0) {
          series.setData(displayCandlesRef.current);
          chart.timeScale().fitContent();
        }

        chart.subscribeCrosshairMove(updateLegend);
        chart.timeScale().subscribeVisibleLogicalRangeChange(scheduleFib);

        const ro = new ResizeObserver(() => {
          if (chartRef.current && chartInst.current) {
            chartInst.current.applyOptions({
              width:  chartRef.current.clientWidth,
              height: chartRef.current.clientHeight,
            });
          }
        });
        ro.observe(chartRef.current);

        setChartReady(true);
      });
    });
    return () => {
      destroyed = true;
      if (fibRafRef.current) cancelAnimationFrame(fibRafRef.current);
      if (chartInst.current) {
        chartInst.current.remove();
        chartInst.current = null;
        seriesInst.current = null;
        entryLine.current = null;
        indSeriesRef.current = [];
        legendItemsRef.current = [];
        fibLinesRef.current = [];
        setChartReady(false);
      }
    };
  }, [updateLegend, scheduleFib]);

  // Keep ref in sync so chart-init can read latest candles immediately
  useEffect(() => {
    displayCandlesRef.current = displayCandles;
  }, [displayCandles]);

  // Load candles into chart when displayCandles changes (or once chart is ready)
  useEffect(() => {
    if (!seriesInst.current || displayCandles.length === 0) return;
    seriesInst.current.setData(displayCandles);
    chartInst.current?.timeScale().fitContent();
  }, [displayCandles, chartReady]);

  // Reconcile indicator series + sub-panes whenever toggles or data change.
  useEffect(() => {
    const chart = chartInst.current;
    const lc = lcRef.current;
    if (!chartReady || !chart || !lc) return;

    // Teardown previous indicator series + sub-panes
    for (const s of indSeriesRef.current) {
      try { chart.removeSeries(s); } catch { /* gone */ }
    }
    indSeriesRef.current = [];
    legendItemsRef.current = [];
    const panesNow = chart.panes();
    for (let i = panesNow.length - 1; i >= 1; i--) {
      try { chart.removePane(i); } catch { /* gone */ }
    }

    const candles = displayCandles;
    if (!advanced || candles.length === 0) {
      applyFib();
      updateLegend(null);
      return;
    }

    const { LineSeries, HistogramSeries } = lc;
    const lineOpts = { lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false };

    // Moving averages (EMA 9 / 20 / 50) on the price pane
    if (ind.ma) {
      const mas = [
        { p: 9,  color: "#4e8ecf", label: "EMA9" },
        { p: 20, color: "#cfad4e", label: "EMA20" },
        { p: 50, color: "#cf4e8a", label: "EMA50" },
      ];
      for (const m of mas) {
        const data = ema(candles, m.p);
        if (!data.length) continue;
        const s = chart.addSeries(LineSeries, { ...lineOpts, color: m.color }, 0);
        s.setData(data);
        indSeriesRef.current.push(s);
        legendItemsRef.current.push({ label: m.label, series: s, color: m.color, fmt: fmtP, last: data[data.length - 1].value });
      }
    }

    // Bollinger bands on the price pane
    if (ind.bb) {
      const bb = bollinger(candles, 20, 2);
      if (bb.mid.length) {
        const up  = chart.addSeries(LineSeries, { ...lineOpts, color: "rgba(130,130,130,0.55)" }, 0);
        const mid = chart.addSeries(LineSeries, { ...lineOpts, color: "rgba(150,150,150,0.7)", lineStyle: 2 }, 0);
        const lo  = chart.addSeries(LineSeries, { ...lineOpts, color: "rgba(130,130,130,0.55)" }, 0);
        up.setData(bb.upper); mid.setData(bb.mid); lo.setData(bb.lower);
        indSeriesRef.current.push(up, mid, lo);
        legendItemsRef.current.push({ label: "BB", series: mid, color: "#999", fmt: fmtP, last: bb.mid[bb.mid.length - 1].value });
      }
    }

    // Volume histogram overlaid at the bottom of the price pane (own scale)
    if (ind.vol) {
      const vol = volume(candles);
      if (vol.length) {
        const s = chart.addSeries(HistogramSeries, { priceScaleId: "volume", priceLineVisible: false, lastValueVisible: false }, 0);
        s.setData(vol);
        chart.priceScale("volume", 0).applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
        indSeriesRef.current.push(s);
        legendItemsRef.current.push({ label: "VOL", series: s, color: "#888", fmt: fmtVol, last: vol[vol.length - 1].value });
      }
    }

    // Sub-panes (assigned in order so toggling one off doesn't leave a gap)
    let nextPane = 1;

    if (ind.rsi) {
      const data = rsi(candles, 14);
      if (data.length) {
        const s = chart.addSeries(LineSeries, { color: "#cfad4e", lineWidth: 1, priceLineVisible: false, lastValueVisible: true }, nextPane++);
        s.setData(data);
        s.createPriceLine({ price: 70, color: "rgba(170,58,58,0.35)", lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
        s.createPriceLine({ price: 30, color: "rgba(58,170,114,0.35)", lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
        indSeriesRef.current.push(s);
        legendItemsRef.current.push({ label: "RSI", series: s, color: "#cfad4e", fmt: (v) => v.toFixed(1), last: data[data.length - 1].value });
      }
    }

    if (ind.macd) {
      const m = macd(candles, 12, 26, 9);
      if (m.macd.length) {
        const paneIdx = nextPane++;
        const hist = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, paneIdx);
        const line = chart.addSeries(LineSeries, { color: "#4e8ecf", lineWidth: 1, priceLineVisible: false, lastValueVisible: false }, paneIdx);
        const sig  = chart.addSeries(LineSeries, { color: "#cf8a4e", lineWidth: 1, priceLineVisible: false, lastValueVisible: false }, paneIdx);
        hist.setData(m.hist); line.setData(m.macd); sig.setData(m.signal);
        indSeriesRef.current.push(hist, line, sig);
        legendItemsRef.current.push({ label: "MACD", series: line, color: "#4e8ecf", fmt: (v) => v.toFixed(2), last: m.macd[m.macd.length - 1].value });
      }
    }

    // Size panes: price pane dominant, each sub-pane a smaller equal share
    const panes = chart.panes();
    if (panes.length) panes[0].setStretchFactor(3);
    for (let i = 1; i < panes.length; i++) panes[i].setStretchFactor(1);

    applyFib();
    updateLegend(null);
  }, [ind, displayCandles, chartReady, advanced, applyFib, updateLegend]);

  // Live update last candle (1m mode)
  useEffect(() => {
    if (tf !== "1m" || !seriesInst.current || !liveCandles?.[coin]?.length) return;
    const last = liveCandles[coin][liveCandles[coin].length - 1];
    try { seriesInst.current.update(last); } catch { /* series may not be ready */ }
  }, [liveCandles, coin, tf]);

  // Draw / update entry line
  useEffect(() => {
    if (!seriesInst.current) return;
    if (entryLine.current) {
      seriesInst.current.removePriceLine(entryLine.current);
      entryLine.current = null;
    }
    if (entryPrice && entryPrice > 0) {
      entryLine.current = seriesInst.current.createPriceLine({
        price:     entryPrice,
        color:     "#4e8ecf",
        lineWidth: 1,
        lineStyle: 2, // dashed
        axisLabelVisible: true,
        title: `ENTRY`,
      });
    }
  }, [entryPrice]);

  const toggle = (k: IndKey) => setInd((p) => ({ ...p, [k]: !p[k] }));

  return (
    <div className="panel" style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div
        style={{
          padding: "7px 12px",
          borderBottom: "1px solid #141414",
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexShrink: 0,
        }}
      >
        {/* Coin selector */}
        {(["BTC", "ETH", "SOL"] as Coin[]).map((c) => (
          <button
            key={c}
            onClick={() => setCoin(c)}
            style={{
              fontFamily: "var(--font-sans, Inter, sans-serif)",
              fontWeight: coin === c ? 700 : 400,
              fontSize: 12,
              background: "none",
              border: "none",
              cursor: "pointer",
              color: coin === c ? "#e8e8e8" : "#555",
              padding: "2px 4px",
            }}
          >
            {c}
          </button>
        ))}

        <div style={{ width: 1, height: 14, background: "#1c1c1c", margin: "0 4px" }} />

        {/* Timeframe selector */}
        {TF_LABELS.map((t) => (
          <button
            key={t}
            onClick={() => setTf(t)}
            style={{
              fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace",
              fontSize: 9,
              background: tf === t ? "#101e30" : "none",
              border: "none",
              cursor: "pointer",
              color: tf === t ? "#4e8ecf" : "#555",
              padding: "2px 5px",
              borderRadius: 2,
            }}
          >
            {t}
          </button>
        ))}

        <div style={{ flex: 1 }} />

        {loading && (
          <span style={{ fontSize: 9, color: "#555" }}>loading...</span>
        )}

        {currentPrice > 0 && (
          <span
            style={{
              fontFamily: "var(--font-sans, Inter, sans-serif)",
              fontWeight: 600,
              fontSize: 12,
              color: "#4ecf8a",
            }}
          >
            ${currentPrice.toLocaleString("en-US", { maximumFractionDigits: currentPrice > 1000 ? 0 : 2 })}
          </span>
        )}
      </div>

      {/* Indicator toolbar (advanced only) */}
      {advanced && (
        <div
          style={{
            padding: "5px 12px",
            borderBottom: "1px solid #141414",
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 8, color: "#444", fontFamily: "var(--font-mono), monospace", letterSpacing: 0.5 }}>
            INDICATORS
          </span>
          {IND_LABELS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => toggle(key)}
              style={{
                fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace",
                fontSize: 9,
                background: ind[key] ? "#101e30" : "none",
                border: `1px solid ${ind[key] ? "#1c3a5a" : "#1c1c1c"}`,
                cursor: "pointer",
                color: ind[key] ? "#4e8ecf" : "#555",
                padding: "2px 6px",
                borderRadius: 2,
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Chart + crosshair legend overlay */}
      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        <div ref={chartRef} style={{ position: "absolute", inset: 0 }} />
        {advanced && (
          <div
            ref={legendRef}
            style={{
              position: "absolute",
              top: 6,
              left: 10,
              zIndex: 3,
              pointerEvents: "none",
              fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace",
              fontSize: 10,
              lineHeight: 1.4,
              color: "#bbb",
              textShadow: "0 0 4px #000, 0 0 4px #000",
              whiteSpace: "nowrap",
            }}
          />
        )}
      </div>
    </div>
  );
}
