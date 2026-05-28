"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { Candle } from "@/lib/types";

type Timeframe = "1m" | "15m" | "1h" | "4h" | "1d";
type Coin = "BTC" | "ETH" | "SOL";

const TF_LABELS: Timeframe[] = ["1m", "15m", "1h", "4h", "1d"];

// For the REST endpoint, map display labels to HL interval strings
const TF_INTERVAL: Record<Timeframe, string> = {
  "1m":  "1m",
  "15m": "15m",
  "1h":  "1h",
  "4h":  "4h",
  "1d":  "1d",
};

// Max candles to fetch per timeframe (0 = all history)
const TF_LIMIT: Record<Timeframe, number> = {
  "1m":  0,     // use live WS candles — no REST fetch
  "15m": 2000,
  "1h":  2000,
  "4h":  0,     // all history (~4800 candles)
  "1d":  0,     // all history (~1200 candles)
};

interface Props {
  // Live 1m candles from WebSocket
  liveCandles: Record<string, Candle[]> | null;
  // Prices for the current coin
  prices: { btc: number; eth: number; sol: number } | null;
  // Entry price to draw a horizontal line (when position is open)
  entryPrice?: number;
}

async function fetchCandles(coin: Coin, interval: string, limit: number): Promise<Candle[]> {
  const params = new URLSearchParams({ interval });
  if (limit > 0) params.set("limit", String(limit));
  const res = await fetch(`http://localhost:8000/candles/${coin}?${params}`);
  if (!res.ok) return [];
  return res.json();
}

export default function ChartPanel({ liveCandles, prices, entryPrice }: Props) {
  const [coin, setCoin] = useState<Coin>("BTC");
  const [tf, setTf] = useState<Timeframe>("1h");
  const [loading, setLoading] = useState(false);
  const [historicalCandles, setHistoricalCandles] = useState<Candle[]>([]);

  const chartRef   = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chartInst  = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const seriesInst = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entryLine  = useRef<any>(null);

  const currentPrice = prices
    ? coin === "BTC" ? prices.btc : coin === "ETH" ? prices.eth : prices.sol
    : 0;

  // Candles to display: 1m uses live WS, others use historical REST fetch
  const displayCandles: Candle[] = tf === "1m"
    ? (liveCandles?.[coin] ?? [])
    : historicalCandles;

  // Fetch historical candles when coin or timeframe changes (non-1m)
  const loadHistorical = useCallback(async () => {
    if (tf === "1m") return;
    setLoading(true);
    const data = await fetchCandles(coin, TF_INTERVAL[tf], TF_LIMIT[tf]);
    setHistoricalCandles(data);
    setLoading(false);
  }, [coin, tf]);

  useEffect(() => {
    loadHistorical();
  }, [loadHistorical]);

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
            textColor: "#333",
          },
          grid: {
            vertLines: { color: "rgba(255,255,255,0.03)" },
            horzLines: { color: "rgba(255,255,255,0.03)" },
          },
          crosshair: {
            vertLine: { color: "rgba(255,255,255,0.15)", labelBackgroundColor: "#111" },
            horzLine: { color: "rgba(255,255,255,0.15)", labelBackgroundColor: "#111" },
          },
          rightPriceScale: { borderColor: "transparent", textColor: "#2a2a2a" },
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

        const ro = new ResizeObserver(() => {
          if (chartRef.current && chartInst.current) {
            chartInst.current.applyOptions({
              width:  chartRef.current.clientWidth,
              height: chartRef.current.clientHeight,
            });
          }
        });
        ro.observe(chartRef.current);
      });
    });
    return () => {
      destroyed = true;
      if (chartInst.current) {
        chartInst.current.remove();
        chartInst.current = null;
        seriesInst.current = null;
        entryLine.current = null;
      }
    };
  }, []);

  // Load candles into chart when displayCandles changes
  useEffect(() => {
    if (!seriesInst.current || displayCandles.length === 0) return;
    seriesInst.current.setData(displayCandles);
    chartInst.current?.timeScale().fitContent();
  }, [displayCandles]);

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
              color: coin === c ? "#e8e8e8" : "#333",
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
              color: tf === t ? "#4e8ecf" : "#333",
              padding: "2px 5px",
              borderRadius: 2,
            }}
          >
            {t}
          </button>
        ))}

        <div style={{ flex: 1 }} />

        {loading && (
          <span style={{ fontSize: 9, color: "#333" }}>loading...</span>
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

      {/* Chart */}
      <div ref={chartRef} style={{ flex: 1, minHeight: 0 }} />
    </div>
  );
}
