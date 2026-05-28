"use client";

import { useState, useCallback } from "react";

const BASE = "http://localhost:8000";

// ─── types ────────────────────────────────────────────────────────────────────

export interface TradeResult {
  ok: boolean;
  error?: string;
  coin?: string;
  size?: number;
  ticket?: number;
  price?: number;
  volume?: number;
}

interface TradingState {
  loading: boolean;
  lastResult: TradeResult | null;
  lastError: string | null;
}

// ─── hook ─────────────────────────────────────────────────────────────────────

export function useTrading() {
  const [state, setState] = useState<TradingState>({
    loading: false,
    lastResult: null,
    lastError: null,
  });

  const post = useCallback(async (path: string, body: object): Promise<TradeResult> => {
    setState((prev) => ({ ...prev, loading: true, lastError: null }));
    try {
      const res = await fetch(`${BASE}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data: TradeResult = await res.json();
      setState({ loading: false, lastResult: data, lastError: data.ok ? null : (data.error ?? "Unknown error") });
      return data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error";
      setState({ loading: false, lastResult: null, lastError: msg });
      return { ok: false, error: msg };
    }
  }, []);

  const hlOpen = useCallback(
    (coin: string, is_buy: boolean, size_usd: number, leverage = 5) =>
      post("/trade/hl/open", { coin, is_buy, size_usd, leverage }),
    [post]
  );

  const hlClose = useCallback(
    (coin: string) => post("/trade/hl/close", { coin }),
    [post]
  );

  return {
    loading:    state.loading,
    lastResult: state.lastResult,
    lastError:  state.lastError,
    hlOpen,
    hlClose,
  };
}
