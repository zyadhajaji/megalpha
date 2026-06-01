"use client";

import { useState, useCallback } from "react";
import { BRIDGE_HTTP as BASE } from "@/lib/bridge";

export interface TradeResult {
  ok: boolean;
  error?: string;
  coin?: string;
  size?: number;
  price?: number;
  slippage_warning?: { fill_px: number; mid_px: number; slippage_bps: number; threshold_bps: number };
}

export interface TradeOptions {
  slippage_tolerance_bps?: number;
  max_position_pct?: number;
  max_drawdown_pct?: number;
  stop_loss_pct?: number;
  take_profit_pct?: number;
  post_only?: boolean;
}

interface TradingState {
  loading: boolean;
  lastResult: TradeResult | null;
  lastError: string | null;
}

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
    (coin: string, is_buy: boolean, size_usd: number, leverage = 5, opts?: TradeOptions) =>
      post("/trade/hl/open", { coin, is_buy, size_usd, leverage, ...opts }),
    [post]
  );

  const hlClose = useCallback(
    (coin: string) => post("/trade/hl/close", { coin }),
    [post]
  );

  const hlCancel = useCallback(
    (coin: string, oid: number) => post("/trade/hl/cancel", { coin, oid }),
    [post]
  );

  return {
    loading:    state.loading,
    lastResult: state.lastResult,
    lastError:  state.lastError,
    hlOpen,
    hlClose,
    hlCancel,
  };
}
