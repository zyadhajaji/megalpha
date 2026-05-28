"use client";

import type { HLStreamData } from "@/hooks/useHLStream";

interface TradingHook {
  hlOpen: (coin: string, isBuy: boolean, sizeUsd: number, leverage: number) => Promise<unknown>;
  hlClose: (coin: string) => Promise<unknown>;
  loading: boolean;
  lastError: string | null;
}

interface Props {
  hl: HLStreamData;
  trading: TradingHook;
}

// Stub — Task 16 will assemble all panels here
export default function OverviewPage({ hl, trading: _trading }: Props) {
  void hl;
  return <div style={{ padding: 24, color: "#333" }}>Overview — assembling in Task 16</div>;
}
