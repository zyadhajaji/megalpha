"use client";

import type { HLStreamData } from "@/hooks/useHLStream";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useMT5Status } from "@/hooks/useMT5Status";
import HeroRow from "@/components/HeroRow";
import ChartPanel from "@/components/ChartPanel";
import OrderBook from "@/components/OrderBook";
import PnlCard from "@/components/PnlCard";
import TradeLog from "@/components/TradeLog";
import BottomBar from "@/components/BottomBar";
import SignalSummaryPanel from "@/components/SignalSummaryPanel";

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
  const isMobile  = useIsMobile();
  const mt5       = useMT5Status(5000);
  const entryPrice = hl.hlAccount?.positions[0]?.entry_px;

  // ── Mobile layout ────────────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflowY: "auto",
        overflowX: "hidden",
        WebkitOverflowScrolling: "touch",
        background: "#070707",
        paddingBottom: "calc(var(--bottom-nav-h, 56px) + env(safe-area-inset-bottom, 0px) + 8px)",
      }}>
        {/* Hero stat cards — 2×2 grid on mobile */}
        <div style={{ padding: "8px 10px 0" }}>
          <HeroRow
            hlAccount={hl.hlAccount}
            connected={hl.connected}
            regime={hl.regime}
            mt5={mt5}
            isMobile
          />
        </div>

        {/* Chart — full width, fixed height on mobile */}
        <div style={{ padding: "8px 10px 0", height: 280, flexShrink: 0 }}>
          <ChartPanel
            liveCandles={hl.candles}
            prices={hl.prices}
            entryPrice={entryPrice}
            hl={hl}
          />
        </div>

        {/* Signal Summary */}
        <div style={{ padding: "8px 10px 0", height: 200, flexShrink: 0 }}>
          <SignalSummaryPanel hl={hl} />
        </div>

        {/* Order Book + PnL — side by side */}
        <div style={{ padding: "8px 10px 0", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, flexShrink: 0 }}>
          <div style={{ height: 220 }}>
            <PnlCard hlAccount={hl.hlAccount} />
          </div>
          <div style={{ height: 220 }}>
            <OrderBook orderBook={hl.orderBook} connected={hl.connected} />
          </div>
        </div>

        {/* Trade Log */}
        <div style={{ padding: "8px 10px 0", height: 200, flexShrink: 0 }}>
          <TradeLog />
        </div>
      </div>
    );
  }

  // ── Desktop layout ───────────────────────────────────────────────────────────
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      height: "100%",
      padding: 10,
      gap: 8,
      overflow: "hidden",
    }}>
      {/* Hero stat cards */}
      <HeroRow
        hlAccount={hl.hlAccount}
        connected={hl.connected}
        regime={hl.regime}
        mt5={mt5}
      />

      {/* Main grid: left column (chart + signals) | right column (PnL + OB + trades) */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 308px", gap: 8, flex: 1, minHeight: 0 }}>

        {/* Left column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>
          <div style={{ flex: 1.6, minHeight: 0 }}>
            <ChartPanel
              liveCandles={hl.candles}
              prices={hl.prices}
              entryPrice={entryPrice}
              hl={hl}
            />
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <SignalSummaryPanel hl={hl} />
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
