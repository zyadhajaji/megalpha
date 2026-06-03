"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { Candle, AISignal } from "@/lib/types";
import { ema, rsi, macd, bollinger, volume, fib, adx as calcAdx, ema21 as calcEma21, ema55 as calcEma55, ema200 as calcEma200 } from "@/lib/indicators";
import { BRIDGE_HTTP } from "@/lib/bridge";

type Timeframe = "1m" | "15m" | "1h" | "4h" | "1d";
type Coin = "BTC" | "ETH" | "SOL" | "PAXG";
type IndKey = "bb" | "vol" | "rsi" | "macd" | "fib" | "adx";

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
  { key: "bb",   label: "BOLL" },
  { key: "vol",  label: "VOL" },
  { key: "rsi",  label: "RSI" },
  { key: "macd", label: "MACD" },
  { key: "fib",  label: "FIB" },
  { key: "adx",  label: "ADX" },
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
  // Full WS payload — used for regime badge
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  hl?: any;
}

async function fetchCandles(coin: Coin, interval: string, limit: number): Promise<Candle[]> {
  const params = new URLSearchParams({ interval });
  if (limit > 0) params.set("limit", String(limit));
  const res = await fetch(`${BRIDGE_HTTP}/candles/${coin}?${params}`);
  if (!res.ok) return [];
  return res.json();
}

export default function ChartPanel({ liveCandles, prices, entryPrice, advanced = false, hl }: Props) {
  const [coin, setCoin] = useState<Coin>("BTC");
  const [tf, setTf] = useState<Timeframe>("1h");
  const [loading, setLoading] = useState(false);
  const [historicalCandles, setHistoricalCandles] = useState<Candle[]>([]);
  const [chartReady, setChartReady] = useState(false);
  const [ind, setInd] = useState<Record<IndKey, boolean>>({
    bb: false, vol: true, rsi: false, macd: false, fib: false, adx: false,
  });

  // ── Session clock ──────────────────────────────────────────────────────
  const [sessionInfo, setSessionInfo] = useState({ name: "", quality: "", remaining: "" });
  useEffect(() => {
    function tick() {
      const now = new Date();
      const h = now.getUTCHours(), m = now.getUTCMinutes();
      let name = "", quality = "", endH = 0;
      if (h >= 13 && h < 16)      { name = "LON/NY"; quality = "PEAK";   endH = 16; }
      else if (h >= 8  && h < 13) { name = "LONDON"; quality = "HIGH";   endH = 13; }
      else if (h >= 16 && h < 21) { name = "NEW YORK"; quality = "HIGH"; endH = 21; }
      else                         { name = "ASIA";   quality = "LOW";    endH = h < 8 ? 8 : 24; }
      const remMin = (endH - h) * 60 - m;
      const remaining = `${Math.floor(remMin / 60)}h ${remMin % 60}m`;
      setSessionInfo({ name, quality, remaining });
    }
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  // ── AI signals state ─────────────────────────────────────────────────────
  const [aiSignals, setAiSignals]         = useState<AISignal[]>([]);
  const [aiGenerating, setAiGenerating]   = useState(false);
  const aiSignalsRef                      = useRef<AISignal[]>([]);

  // Only consider LONG/SHORT signals — HOLD is never surfaced on chart
  const latestSignal: AISignal | null = aiSignals.find(s => s.signal !== "HOLD") ?? null;

  // Fetch signals whenever coin or timeframe changes
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${BRIDGE_HTTP}/ai/signals/${coin}?interval=${TF_INTERVAL[tf]}&limit=100`);
        if (r.ok && !cancelled) {
          const data: AISignal[] = await r.json();
          setAiSignals(data);
          aiSignalsRef.current = data;
        }
      } catch { /* bridge offline */ }
    })();
    return () => { cancelled = true; };
  }, [coin, tf]);

  async function generateSignal() {
    if (aiGenerating) return;
    setAiGenerating(true);
    try {
      const r = await fetch(`${BRIDGE_HTTP}/ai/signals/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coin, interval: TF_INTERVAL[tf] }),
      });
      if (r.ok) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sig: any = await r.json();
        if (!sig.error) {
          setAiSignals(prev => [sig, ...prev]);
          aiSignalsRef.current = [sig, ...aiSignalsRef.current];
        }
      }
    } catch { /* bridge offline */ }
    finally { setAiGenerating(false); }
  }

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
        signalLinesRef.current = [];
        if (seriesMarkersRef.current) {
          try { seriesMarkersRef.current.detach?.(); } catch {}
          seriesMarkersRef.current = null;
        }
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

    // ── PERMANENT EMAs: EMA200 (white), EMA55 (red), EMA21 (blue dashed) ──────
    // These are always visible — not toggleable. Part of the base chart style.
    const permanentEmas = [
      { fn: calcEma200, color: "#e8e8e8", lineWidth: 2, lineStyle: 0, label: "EMA200" },
      { fn: calcEma55,  color: "#cf4e4e", lineWidth: 1, lineStyle: 0, label: "EMA55"  },
      { fn: calcEma21,  color: "#4e8ecf", lineWidth: 1, lineStyle: 1, label: "EMA21"  },
    ];
    for (const em of permanentEmas) {
      const data = em.fn(candles);
      if (!data.length) continue;
      const s = chart.addSeries(LineSeries, {
        ...lineOpts,
        color: em.color,
        lineWidth: em.lineWidth,
        lineStyle: em.lineStyle,
      }, 0);
      s.setData(data);
      indSeriesRef.current.push(s);
      legendItemsRef.current.push({ label: em.label, series: s, color: em.color, fmt: fmtP, last: data[data.length - 1].value });
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

    if (ind.adx) {
      const data = calcAdx(candles, 14);
      if (data.length) {
        const paneIdx = nextPane++;
        const s = chart.addSeries(LineSeries, { color: "#8a4ecf", lineWidth: 1, priceLineVisible: false, lastValueVisible: true }, paneIdx);
        s.setData(data);
        // Reference lines at 20 (ranging threshold) and 30 (trending threshold)
        s.createPriceLine({ price: 20, color: "rgba(100,100,100,0.4)", lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
        s.createPriceLine({ price: 30, color: "rgba(130,90,200,0.4)", lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
        indSeriesRef.current.push(s);
        legendItemsRef.current.push({ label: "ADX", series: s, color: "#8a4ecf", fmt: (v) => v.toFixed(1), last: data[data.length - 1].value });
      }
    }

    // Size panes: price pane dominant, each sub-pane a smaller equal share
    const panes = chart.panes();
    if (panes.length) panes[0].setStretchFactor(3);
    for (let i = 1; i < panes.length; i++) panes[i].setStretchFactor(1);

    applyFib();
    updateLegend(null);
  }, [ind, displayCandles, chartReady, advanced, applyFib, updateLegend]);

  // AI signal price lines (entry / SL / TP) — ref so we can remove them
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const signalLinesRef    = useRef<any[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const seriesMarkersRef  = useRef<any>(null);

  const _removeSignalLines = () => {
    const s = seriesInst.current;
    if (!s) return;
    for (const ln of signalLinesRef.current) {
      try { s.removePriceLine(ln); } catch { /* gone */ }
    }
    signalLinesRef.current = [];
  };

  // Apply AI signal markers + entry/SL/TP lines
  useEffect(() => {
    const series = seriesInst.current;
    if (!series || !chartReady) return;

    // 1. Markers (arrows) — v5 API: createSeriesMarkers(series, markers)
    try {
      const lc = lcRef.current;
      // Deduplicate by time — keep one marker per candle (latest signal wins)
      // and limit to last 20 signals so chart stays readable
      const dedupMap = new Map<number, AISignal>();
      for (const s of aiSignals.slice(0, 20)) {
        if (!dedupMap.has(s.time)) dedupMap.set(s.time, s);
      }
      const markerData = Array.from(dedupMap.values())
        .map(s => {
          const sm = s.summary;
          const entryLabel = sm?.entry && sm.entry > 0 ? `  E:${fmtP(sm.entry)}` : "";
          return {
            time:     s.time,
            position: s.signal === "LONG" ? "belowBar" : "aboveBar",
            color:    s.signal === "LONG" ? "#4ecf8a" : "#cf4e4e",
            shape:    s.signal === "LONG" ? "arrowUp"  : "arrowDown",
            text:     `AI ${s.signal === "LONG" ? "↑ LONG" : "↓ SHORT"} ${s.confidence}%${entryLabel}`,
            size:     2,
          };
        })
        .sort((a, b) => (a.time as number) - (b.time as number));

      if (lc?.createSeriesMarkers) {
        // v5 API
        if (seriesMarkersRef.current) {
          seriesMarkersRef.current.setMarkers(markerData);
        } else {
          seriesMarkersRef.current = lc.createSeriesMarkers(series, markerData);
        }
      } else {
        // v4 fallback
        series.setMarkers?.(markerData);
      }
    } catch { /* ignore marker errors */ }

    // 2. Entry / SL / TP horizontal lines for the LATEST actionable signal
    _removeSignalLines();
    const sig = latestSignal;
    if (!sig || sig.signal === "HOLD") return;
    const sm = sig.summary;
    const newLines: unknown[] = [];
    if (sm && sm.entry > 0) {
      try {
        newLines.push(series.createPriceLine({
          price: sm.entry,
          color: "rgba(200,200,200,0.6)", lineWidth: 1, lineStyle: 2,
          axisLabelVisible: true, title: `ENTRY  ${sig.confidence}%`,
        }));
      } catch {}
    }
    if (sm && sm.stop_loss > 0) {
      try {
        newLines.push(series.createPriceLine({
          price: sm.stop_loss,
          color: "rgba(207,78,78,0.7)", lineWidth: 1, lineStyle: 2,
          axisLabelVisible: true,
          title: `SL  ${sm.risk_reward || ""}`,
        }));
      } catch {}
    }
    if (sm && sm.take_profit > 0) {
      try {
        newLines.push(series.createPriceLine({
          price: sm.take_profit,
          color: "rgba(78,207,138,0.7)", lineWidth: 1, lineStyle: 2,
          axisLabelVisible: true, title: "TP",
        }));
      } catch {}
    }
    signalLinesRef.current = newLines as never[];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiSignals, chartReady, latestSignal]);

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
        {(["BTC", "ETH", "SOL", "PAXG"] as Coin[]).map((c) => (
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

        {/* Regime badge */}
        {hl?.regime?.[coin] && (() => {
          const r = hl.regime[coin];
          const state = r.state as string;
          const regimeColor = state === "TRENDING" ? "#4ecf8a" : state === "RANGING" ? "#cfad4e" : state === "HALTED" ? "#cf4e4e" : "#555";
          const regimeBg    = state === "TRENDING" ? "rgba(78,207,138,0.06)" : state === "RANGING" ? "rgba(207,173,78,0.08)" : state === "HALTED" ? "rgba(207,78,78,0.08)" : "rgba(60,60,60,0.06)";
          const regimeBorder = state === "TRENDING" ? "rgba(78,207,138,0.2)" : state === "RANGING" ? "rgba(207,173,78,0.2)" : state === "HALTED" ? "rgba(207,78,78,0.25)" : "rgba(60,60,60,0.15)";
          return (
            <span style={{
              fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace",
              fontSize: 8, color: regimeColor, background: regimeBg,
              border: `1px solid ${regimeBorder}`, borderRadius: 2, padding: "2px 6px",
            }}>
              {state} {r.adx > 0 ? `ADX${r.adx.toFixed(0)}` : ""}
            </span>
          );
        })()}

        {/* Session indicator */}
        {sessionInfo.name && (
          <span style={{
            fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace",
            fontSize: 8,
            color: sessionInfo.quality === "PEAK" ? "#cfad4e" : sessionInfo.quality === "HIGH" ? "#4ecf8a" : "#444",
            background: sessionInfo.quality === "PEAK" ? "rgba(207,173,78,0.08)" : sessionInfo.quality === "HIGH" ? "rgba(78,207,138,0.06)" : "rgba(60,60,60,0.06)",
            border: `1px solid ${sessionInfo.quality === "PEAK" ? "rgba(207,173,78,0.2)" : sessionInfo.quality === "HIGH" ? "rgba(78,207,138,0.15)" : "rgba(60,60,60,0.15)"}`,
            borderRadius: 2,
            padding: "2px 6px",
          }}>
            {sessionInfo.name} · {sessionInfo.remaining}
          </span>
        )}

        {/* AI signal badge — LONG/SHORT only, never HOLD */}
        {latestSignal && latestSignal.signal !== "HOLD" ? (
          <span style={{
            fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace",
            fontSize: 9,
            color: latestSignal.signal === "LONG" ? "#4ecf8a" : "#cf4e4e",
            background: latestSignal.signal === "LONG" ? "rgba(78,207,138,0.08)" : "rgba(207,78,78,0.08)",
            border: `1px solid ${latestSignal.signal === "LONG" ? "rgba(78,207,138,0.25)" : "rgba(207,78,78,0.25)"}`,
            borderRadius: 2, padding: "2px 6px",
          }}>
            AI {latestSignal.signal === "LONG" ? "↑" : "↓"} {latestSignal.confidence}%
          </span>
        ) : (
          <span style={{
            fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace",
            fontSize: 8, color: "#2a2a2a",
          }}>
            AI WATCHING
          </span>
        )}

        {/* Generate button */}
        <button
          onClick={generateSignal}
          disabled={aiGenerating}
          title="Generate AI signal for current coin + timeframe"
          style={{
            fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace",
            fontSize: 9,
            padding: "2px 7px",
            background: aiGenerating ? "#0f1a12" : "#101e30",
            border: `1px solid ${aiGenerating ? "#1c3a28" : "#1c3a60"}`,
            borderRadius: 2,
            color: aiGenerating ? "#4ecf8a" : "#4e8ecf",
            cursor: aiGenerating ? "default" : "pointer",
            opacity: aiGenerating ? 0.7 : 1,
          }}
        >
          {aiGenerating ? "AI…" : "AI ✦"}
        </button>

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

      {/* AI signal strip — only for LONG/SHORT, never for HOLD */}
      {latestSignal && latestSignal.signal !== "HOLD" && (
        <div style={{
          padding: "4px 12px",
          borderBottom: "1px solid #0e0e0e",
          display: "flex", alignItems: "center", gap: 8,
          background: latestSignal.signal === "LONG" ? "rgba(58,170,114,0.04)" : "rgba(170,58,58,0.04)",
          flexShrink: 0,
        }}>
          <span style={{
            fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace",
            fontSize: 8,
            color: latestSignal.signal === "LONG" ? "#3aaa72" : "#aa3a3a",
            fontWeight: 700, flexShrink: 0,
          }}>
            {latestSignal.signal === "LONG" ? "↑ LONG" : "↓ SHORT"} {latestSignal.confidence}%
          </span>
          {(latestSignal.summary?.entry ?? 0) > 0 && (
            <>
              <span style={{ fontFamily: "var(--font-mono), monospace", fontSize: 8, color: "#888", flexShrink: 0 }}>
                E ${(latestSignal.summary?.entry ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}
              </span>
              {(latestSignal.summary?.stop_loss ?? 0) > 0 && (
                <span style={{ fontFamily: "var(--font-mono), monospace", fontSize: 8, color: "#cf4e4e", flexShrink: 0 }}>
                  SL ${(latestSignal.summary?.stop_loss ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}
                </span>
              )}
              {(latestSignal.summary?.take_profit ?? 0) > 0 && (
                <span style={{ fontFamily: "var(--font-mono), monospace", fontSize: 8, color: "#4ecf8a", flexShrink: 0 }}>
                  TP ${(latestSignal.summary?.take_profit ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}
                </span>
              )}
              {latestSignal.summary?.risk_reward && (
                <span style={{ fontFamily: "var(--font-mono), monospace", fontSize: 8, color: "#cfad4e", flexShrink: 0 }}>
                  {latestSignal.summary.risk_reward}
                </span>
              )}
            </>
          )}
          <span style={{
            fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace",
            fontSize: 8, color: "#3a3a3a",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1,
          }}>
            {latestSignal.reasoning?.slice(0, 160)}
          </span>
        </div>
      )}

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
