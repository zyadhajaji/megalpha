"use client";

import type { HLAccount } from "@/lib/types";

interface Props {
  hlAccount: HLAccount | null;
  paperBalance?: number;  // Phase 2 will pass the real paper balance
}

export default function BottomBar({ hlAccount, paperBalance = 10_000 }: Props) {
  const margin    = hlAccount?.total_margin_used ?? 0;
  const available = hlAccount?.withdrawable ?? 0;

  return (
    <div
      style={{
        height: 24,
        background: "#0c0c0c",
        border: "1px solid #1c1c1c",
        borderRadius: 4,
        display: "flex",
        alignItems: "center",
        padding: "0 12px",
        gap: 20,
        flexShrink: 0,
      }}
    >
      <span style={{ fontSize: 9, color: "#2a2a2a" }}>
        Margin <span style={{ color: "#333" }}>${margin.toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
      </span>
      <span style={{ fontSize: 9, color: "#2a2a2a" }}>
        Available <span style={{ color: "#333" }}>${available.toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
      </span>
      <span style={{ fontSize: 9, color: "#2a2a2a" }}>
        Paper <span style={{ color: "#333" }}>${paperBalance.toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
      </span>
      <div style={{ flex: 1 }} />
      <span style={{ fontSize: 9, color: "#1e1e1e" }}>Hyperliquid · Mainnet · Perps</span>
    </div>
  );
}
