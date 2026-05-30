"use client";

import { useState } from "react";
import type { OrderBookMetrics } from "@/hooks/useHLStream";

const mono = "var(--font-mono, 'IBM Plex Mono', monospace)";
const sans = "var(--font-sans, Inter, sans-serif)";

type Coin = "BTC" | "ETH" | "SOL";
const COINS: Coin[] = ["BTC", "ETH", "SOL"];

// Levels nearest the mid to render per side (server sends more)
const LEVELS = 9;

function fmtPx(px: number): string {
  if (px >= 1000) return px.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  if (px >= 1)    return px.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 3 });
  return px.toFixed(5);
}

function fmtSz(sz: number): string {
  if (sz >= 1000) return `${(sz / 1000).toFixed(1)}k`;
  if (sz >= 1)    return sz.toFixed(2);
  return sz.toFixed(4);
}

export default function OrderBook({
  orderBook,
  connected,
}: {
  orderBook: Record<string, OrderBookMetrics> | null;
  connected: boolean;
}) {
  const [coin, setCoin] = useState<Coin>("BTC");
  const book = orderBook?.[coin];

  const hasDepth = !!book && book.bids?.length > 0 && book.asks?.length > 0;

  // Nearest-mid levels; asks render worst→best (top→down) so best sits next to the mid row
  const asks = hasDepth ? book!.asks.slice(0, LEVELS).slice().reverse() : [];
  const bids = hasDepth ? book!.bids.slice(0, LEVELS) : [];
  const maxSz = hasDepth
    ? Math.max(...asks.map((a) => a.sz), ...bids.map((b) => b.sz), 1e-9)
    : 1;

  const imbalance = book?.imbalance ?? 0;
  const imbPct = Math.round(((imbalance + 1) / 2) * 100); // -1..1 → 0..100

  return (
    <div className="panel" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "7px 12px", borderBottom: "1px solid #141414", flexShrink: 0,
      }}>
        <span style={{ fontFamily: mono, fontSize: 9, color: "#444", letterSpacing: "0.08em" }}>ORDER BOOK</span>
        <div style={{ display: "flex", gap: 2 }}>
          {COINS.map((c) => (
            <button
              key={c}
              onClick={() => setCoin(c)}
              style={{
                fontFamily: mono, fontSize: 9, padding: "1px 5px", borderRadius: 2, cursor: "pointer",
                background: coin === c ? "#101e30" : "none",
                border: coin === c ? "1px solid #1c3050" : "1px solid transparent",
                color: coin === c ? "#4e8ecf" : "#555",
              }}
            >
              {c}
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        {hasDepth && (
          <span style={{ fontFamily: mono, fontSize: 9, color: "#666" }}>
            {book!.spread_bps.toFixed(1)} bps
          </span>
        )}
      </div>

      {/* Ladder */}
      {!hasDepth ? (
        <div style={{
          flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
          fontFamily: mono, fontSize: 10, color: "#333", padding: 16, textAlign: "center",
        }}>
          {connected ? "waiting for L2 book…" : "bridge offline"}
        </div>
      ) : (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, padding: "4px 0" }}>
          {/* column headers */}
          <Row label="PRICE" mid="SIZE" header />

          {/* asks (sells) — red */}
          {asks.map((a, i) => (
            <DepthRow key={`a${i}`} px={a.px} sz={a.sz} maxSz={maxSz} side="ask" />
          ))}

          {/* mid / spread */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "4px 12px", margin: "2px 0",
            borderTop: "1px solid #141414", borderBottom: "1px solid #141414",
          }}>
            <span style={{ fontFamily: sans, fontWeight: 700, fontSize: 13, color: "#e8e8e8" }}>
              {fmtPx(book!.mid)}
            </span>
            <span style={{ fontFamily: mono, fontSize: 9, color: "#555" }}>
              spread {fmtPx(book!.spread)}
            </span>
          </div>

          {/* bids (buys) — green */}
          {bids.map((b, i) => (
            <DepthRow key={`b${i}`} px={b.px} sz={b.sz} maxSz={maxSz} side="bid" />
          ))}

          {/* imbalance */}
          <div style={{ padding: "8px 12px 4px", marginTop: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontFamily: mono, fontSize: 8, color: "#444", letterSpacing: "0.08em" }}>IMBALANCE</span>
              <span style={{ fontFamily: mono, fontSize: 9, color: imbalance >= 0 ? "#4ecf8a" : "#cf4e4e" }}>
                {imbalance >= 0 ? "+" : ""}{imbalance.toFixed(2)}
              </span>
            </div>
            <div style={{ display: "flex", height: 4, borderRadius: 2, overflow: "hidden", background: "#141414" }}>
              <div style={{ width: `${imbPct}%`, background: "#3aaa72" }} />
              <div style={{ width: `${100 - imbPct}%`, background: "#aa3a3a" }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DepthRow({ px, sz, maxSz, side }: { px: number; sz: number; maxSz: number; side: "bid" | "ask" }) {
  const pct = Math.max(2, Math.round((sz / maxSz) * 100));
  const color = side === "bid" ? "#4ecf8a" : "#cf4e4e";
  const barBg = side === "bid" ? "rgba(58,170,114,0.12)" : "rgba(170,58,58,0.12)";
  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "2px 12px", height: 17 }}>
      {/* depth bar grows from the right */}
      <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: `${pct}%`, background: barBg }} />
      <span style={{ position: "relative", fontFamily: mono, fontSize: 10, color }}>{fmtPx(px)}</span>
      <span style={{ position: "relative", fontFamily: mono, fontSize: 10, color: "#888" }}>{fmtSz(sz)}</span>
    </div>
  );
}

function Row({ label, mid, header }: { label: string; mid: string; header?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "1px 12px 4px" }}>
      <span style={{ fontFamily: mono, fontSize: 8, color: "#3a3a3a", letterSpacing: "0.08em" }}>{header ? label : ""}</span>
      <span style={{ fontFamily: mono, fontSize: 8, color: "#3a3a3a", letterSpacing: "0.08em" }}>{header ? mid : ""}</span>
    </div>
  );
}
