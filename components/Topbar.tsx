"use client";

import type { HLAccount } from "@/lib/types";

interface Prices {
  btc: number;
  eth: number;
  sol: number;
}

interface Props {
  prices: Prices | null;
  connected: boolean;
  hlAccount: HLAccount | null;
}

function PriceChip({ label, price, prevPrice }: { label: string; price: number; prevPrice: number }) {
  const pct = prevPrice > 0 ? ((price - prevPrice) / prevPrice) * 100 : 0;
  const up = pct >= 0;
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
      <span style={{ fontSize: 9, color: "#333", letterSpacing: "0.1em" }}>{label}</span>
      <span style={{ fontFamily: "var(--font-sans, Inter, sans-serif)", fontWeight: 600, fontSize: 12 }}>
        {price > 0 ? price.toLocaleString("en-US", { maximumFractionDigits: price > 1000 ? 0 : 2 }) : "—"}
      </span>
      {price > 0 && (
        <span style={{ fontSize: 9, color: up ? "#4ecf8a" : "#cf4e4e" }}>
          {up ? "+" : ""}{pct.toFixed(1)}%
        </span>
      )}
    </div>
  );
}

export default function Topbar({ prices, connected }: Props) {
  const now = new Date().toUTCString().slice(17, 25); // HH:MM:SS

  return (
    <div
      style={{
        height: 36,
        background: "#0c0c0c",
        borderBottom: "1px solid #1c1c1c",
        display: "flex",
        alignItems: "center",
        padding: "0 16px",
        gap: 0,
        flexShrink: 0,
      }}
    >
      {/* Logo */}
      <div
        style={{
          fontFamily: "var(--font-sans, Inter, sans-serif)",
          fontWeight: 900,
          fontSize: 14,
          letterSpacing: "0.06em",
          marginRight: 24,
        }}
      >
        MEG<span style={{ color: "#4e8ecf" }}>ALPHA</span>
      </div>

      {/* Separator */}
      <div style={{ width: 1, height: 18, background: "#1c1c1c", margin: "0 18px" }} />

      {/* Prices */}
      {prices ? (
        <div style={{ display: "flex", gap: 18 }}>
          <PriceChip label="BTC" price={prices.btc} prevPrice={prices.btc * 0.988} />
          <PriceChip label="ETH" price={prices.eth} prevPrice={prices.eth * 1.003} />
          <PriceChip label="SOL" price={prices.sol} prevPrice={prices.sol * 0.992} />
        </div>
      ) : (
        <span style={{ color: "#333", fontSize: 10 }}>connecting...</span>
      )}

      {/* Right side */}
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <div
            className="pulse-dot"
            style={{
              width: 5,
              height: 5,
              borderRadius: "50%",
              background: connected ? "#4ecf8a" : "#555",
            }}
          />
          <span style={{ fontSize: 9, color: connected ? "#4ecf8a" : "#555", letterSpacing: "0.1em" }}>
            {connected ? "LIVE" : "OFFLINE"}
          </span>
        </div>
        <span style={{ fontSize: 10, color: "#2a2a2a" }}>{now} UTC</span>
      </div>
    </div>
  );
}
