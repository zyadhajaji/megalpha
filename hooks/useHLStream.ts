"use client";

import { useState, useEffect, useRef } from "react";
import type { Candle, HLAccount, HLPosition, RLAgentState } from "@/lib/types";

// Re-export types components use via this hook
export type { HLAccount, HLPosition, Candle };

interface HLPrices {
  btc: number;
  eth: number;
  sol: number;
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

export interface HLStreamData {
  connected: boolean;
  prices: HLPrices | null;
  candles: Record<string, Candle[]> | null;  // live 1m candles per coin
  momentum: number | null;
  orderBook: Record<string, OrderBookMetrics> | null;
  hlAccount: HLAccount | null;
  rlAgent: RLAgentState | null;
}

const EMPTY: HLStreamData = {
  connected: false,
  prices: null,
  candles: null,
  momentum: null,
  orderBook: null,
  hlAccount: null,
  rlAgent: null,
};

const WS_URL = "ws://localhost:8000/ws";
const RECONNECT_DELAY_MS = 3_000;

export function useHLStream(): HLStreamData {
  const [data, setData] = useState<HLStreamData>(EMPTY);
  const wsRef    = useRef<WebSocket | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;

    function connect() {
      if (!aliveRef.current) return;
      let ws: WebSocket;
      try {
        ws = new WebSocket(WS_URL);
      } catch {
        timerRef.current = setTimeout(connect, RECONNECT_DELAY_MS);
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        if (!aliveRef.current) { ws.close(); return; }
        setData((prev) => ({ ...prev, connected: true }));
      };

      ws.onmessage = (event: MessageEvent) => {
        if (!aliveRef.current) return;
        try {
          const p = JSON.parse(event.data as string);
          setData({
            connected:  true,
            prices:     p.prices     ?? null,
            candles:    p.candles    ?? null,
            momentum:   typeof p.momentum === "number" ? p.momentum : null,
            orderBook:  p.orderBook  ?? null,
            hlAccount:  p.hlAccount  ?? null,
            rlAgent:    p.rl_agent   ?? null,
          });
        } catch {
          // ignore malformed frames
        }
      };

      ws.onclose = () => {
        if (!aliveRef.current) return;
        wsRef.current = null;
        setData((prev) => ({ ...prev, connected: false }));
        timerRef.current = setTimeout(connect, RECONNECT_DELAY_MS);
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
