"use client";

import ChartPanel from "@/components/ChartPanel";
import type { HLStreamData } from "@/hooks/useHLStream";

interface Props {
  hl: HLStreamData;
}

export default function ChartsPage({ hl }: Props) {
  return (
    <div style={{ height: "100%", padding: 10 }}>
      <ChartPanel
        liveCandles={hl.candles}
        prices={hl.prices}
        advanced
      />
    </div>
  );
}
