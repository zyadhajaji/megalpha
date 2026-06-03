"use client";

import type { HLStreamData } from "@/hooks/useHLStream";
import HeroRow from "@/components/HeroRow";
import ChartPanel from "@/components/ChartPanel";
import RLNetworkPanel from "@/components/RLNetworkPanel";
import OrderBook from "@/components/OrderBook";
import PnlCard from "@/components/PnlCard";
import TradeLog from "@/components/TradeLog";
import BottomBar from "@/components/BottomBar";

// useTrading return type — kept loose to avoid tight coupling
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

export default function OverviewPage({ hl, trading: _trading }: Props) {
  // Entry price: use the first open position's entry, if any
  const entryPrice = hl.hlAccount?.positions[0]?.entry_px;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        padding: 10,
        gap: 8,
        overflow: "hidden",
      }}
    >
      {/* Hero stat cards */}
      <HeroRow
        hlAccount={hl.hlAccount}
        connected={hl.connected}
        rlAgent={hl.rlAgent}
        regime={hl.regime}
      />

      {/* Main content: left column (chart + RL) | right column (PnL + trades) */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 310px", gap: 8, flex: 1, minHeight: 0 }}>

        {/* Left column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>
          {/* Chart — takes ~60% of left col height */}
          <div style={{ flex: 1.4, minHeight: 0 }}>
            <ChartPanel
              liveCandles={hl.candles}
              prices={hl.prices}
              entryPrice={entryPrice}
            />
          </div>
          {/* RL neural network — takes ~40% */}
          <div style={{ flex: 1, minHeight: 0 }}>
            <RLNetworkPanel rlAgent={hl.rlAgent} />
          </div>
        </div>

        {/* Right column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>
          <PnlCard hlAccount={hl.hlAccount} />
          <div style={{ flex: 1.3, minHeight: 0, display: "flex" }}>
            <OrderBook orderBook={hl.orderBook} connected={hl.connected} />
          </div>
          <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
            <TradeLog />
          </div>
        </div>
      </div>

      {/* Bottom strip */}
      <BottomBar hlAccount={hl.hlAccount} />
    </div>
  );
}
