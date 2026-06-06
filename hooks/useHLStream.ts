"use client";

import { useState, useEffect, useRef } from "react";
import type { Candle, HLAccount, HLPosition, RLAgentState, AISignal } from "@/lib/types";
import { BRIDGE_WS } from "@/lib/bridge";

// Re-export types components use via this hook
export type { HLAccount, HLPosition, Candle };

interface HLPrices {
  btc: number;
  eth: number;
  sol: number;
  paxg: number;
  xauusd?: number;
}

export interface OrderBookLevel {
  px: number;
  sz: number;
}

export interface OrderBookMetrics {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  mid: number;
  spread: number;
  spread_bps: number;
  bid_ask_ratio: number;
  imbalance: number;
}

export interface HLFill {
  coin: string;
  side: string;
  px: number;
  sz: number;
  time: number;
  oid: number;
  fee: number;
}

export interface MarketMetric {
  funding_rate:   number;   // raw per-period rate (hourly on HL)
  funding_apr:    number;   // annualised %
  open_interest:  number;   // in coin units
  oi_usd:         number;   // in USD
  mark_px:        number;
  prev_day_px:    number;
  day_ntl_vol:    number;   // 24h notional volume USD
  day_change_pct: number;
}

export interface HLLiquidation {
  time:     number;
  coin:     string;
  side:     string;   // "LONG" or "SHORT" (the liquidated side)
  px:       number;
  sz:       number;
  notional: number;
  user:     string;
}

export interface RegimeCoin {
  state:       "RANGING" | "TRENDING" | "TRANSITION" | "HALTED";
  adx:         number;
  bb_width:    number;
  ma_sep:      number;
  score:       number;
  consecutive: number;
}

export interface HLStreamData {
  connected: boolean;
  prices: HLPrices | null;
  candles: Record<string, Candle[]> | null;
  momentum: number | null;
  orderBook: Record<string, OrderBookMetrics> | null;
  hlAccount: HLAccount | null;
  rlAgent: RLAgentState | null;
  hlConfigured:  boolean;
  liveHalted:    boolean;
  recentFills:   HLFill[];
  marketMetrics: Record<string, MarketMetric> | null;
  liquidations:  HLLiquidation[];
  signalAlert:   AISignal | null;
  regime:        Record<string, RegimeCoin> | null;
}

const EMPTY: HLStreamData = {
  connected:    false,
  prices:       null,
  candles:      null,
  momentum:     null,
  orderBook:    null,
  hlAccount:    null,
  rlAgent:      null,
  hlConfigured:  false,
  liveHalted:    false,
  recentFills:   [],
  marketMetrics: null,
  liquidations:  [],
  signalAlert:   null,
  regime:        null,
};

const WS_URL           = `${BRIDGE_WS}/ws`;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS  = 30_000;

export function useHLStream(): HLStreamData {
  const [data, setData]  = useState<HLStreamData>(EMPTY);
  const wsRef      = useRef<WebSocket | null>(null);
  const timerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aliveRef   = useRef(true);
  const backoffRef = useRef(RECONNECT_BASE_MS);

  useEffect(() => {
    aliveRef.current   = true;
    backoffRef.current = RECONNECT_BASE_MS;

    function connect() {
      if (!aliveRef.current) return;
      let ws: WebSocket;
      try {
        ws = new WebSocket(WS_URL);
      } catch {
        const delay = backoffRef.current;
        backoffRef.current = Math.min(backoffRef.current * 2, RECONNECT_MAX_MS);
        timerRef.current = setTimeout(connect, delay);
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        if (!aliveRef.current) { ws.close(); return; }
        backoffRef.current = RECONNECT_BASE_MS;
        setData((prev) => ({ ...prev, connected: true }));
      };

      ws.onmessage = (event: MessageEvent) => {
        if (!aliveRef.current) return;
        try {
          const p = JSON.parse(event.data as string);
          setData({
            connected:    true,
            prices:       p.prices       ?? null,
            candles:      p.candles      ?? null,
            momentum:     typeof p.momentum === "number" ? p.momentum : null,
            orderBook:    p.orderBook    ?? null,
            hlAccount:    p.hlAccount    ?? null,
            rlAgent:      p.rl_agent     ?? null,
            hlConfigured:  p.hl_configured   ?? false,
            liveHalted:    p.live_halted     ?? false,
            recentFills:   Array.isArray(p.recent_fills)  ? p.recent_fills  : [],
            marketMetrics: p.market_metrics  ?? null,
            liquidations:  Array.isArray(p.liquidations)  ? p.liquidations  : [],
            signalAlert:   p.signal_alert    ?? null,
            regime:        p.regime          ?? null,
          });
        } catch {
          // ignore malformed frames
        }
      };

      ws.onclose = () => {
        if (!aliveRef.current) return;
        wsRef.current = null;
        setData((prev) => ({ ...prev, connected: false }));
        const delay = backoffRef.current;
        backoffRef.current = Math.min(backoffRef.current * 2, RECONNECT_MAX_MS);
        timerRef.current = setTimeout(connect, delay);
      };

      ws.onerror = () => { ws.close(); };
    }

    connect();

    return () => {
      aliveRef.current = false;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  return data;
}
