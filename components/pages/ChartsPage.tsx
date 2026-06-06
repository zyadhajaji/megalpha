"use client";

import ChartPanel from "@/components/ChartPanel";
import type { HLStreamData } from "@/hooks/useHLStream";
import { useIsMobile } from "@/hooks/useIsMobile";

interface Props {
  hl: HLStreamData;
}

export default function ChartsPage({ hl }: Props) {
  const isMobile = useIsMobile();
  return (
    <div style={{
      height: "100%",
      padding: isMobile ? "8px 8px 0" : 10,
      paddingBottom: isMobile ? "calc(var(--bottom-nav-h, 56px) + env(safe-area-inset-bottom, 0px) + 4px)" : 10,
      boxSizing: "border-box",
    }}>
      <ChartPanel
        liveCandles={hl.candles}
        prices={hl.prices}
        advanced
        hl={hl}
      />
    </div>
  );
}
