"use client";

// Trade log component.
// In Phase 1, shows placeholder rows since paper trading isn't built yet.
// Phase 2 will replace MOCK_TRADES with real data from /paper/history.

const MOCK_TRADES = [
  { id: "1", coin: "BTC", direction: "LONG" as const,  reason: "High vol breakout · NY open",     pnl: 94,   time: "08:12" },
  { id: "2", coin: "ETH", direction: "SHORT" as const, reason: "Mean reversion signal",            pnl: -18,  time: "06:44" },
  { id: "3", coin: "SOL", direction: "LONG" as const,  reason: "Breakout confirm · 91% conf",     pnl: 41,   time: "03:20" },
  { id: "4", coin: "BTC", direction: "SHORT" as const, reason: "Liquidity sweep detected",         pnl: 128,  time: "01:05" },
  { id: "5", coin: "ETH", direction: "LONG" as const,  reason: "Range expansion · session open",  pnl: -32,  time: "00:18" },
  { id: "6", coin: "BTC", direction: "LONG" as const,  reason: "Vol squeeze breakout",             pnl: 76,   time: "Yest." },
];

export default function TradeLog() {
  return (
    <div className="panel" style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "hidden" }}>
      <div
        style={{
          padding: "7px 12px",
          borderBottom: "1px solid #141414",
          display: "flex",
          alignItems: "center",
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 9, color: "#333", letterSpacing: "0.1em", textTransform: "uppercase" }}>
          Trade Log
        </span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 9, color: "#1a1a1a" }}>agent reasoning</span>
      </div>

      <div style={{ overflowY: "auto", flex: 1 }}>
        {MOCK_TRADES.map((t) => (
          <div
            key={t.id}
            style={{
              display: "grid",
              gridTemplateColumns: "26px 44px 1fr 50px 34px",
              alignItems: "center",
              padding: "6px 12px",
              borderBottom: "1px solid #0f0f0f",
              gap: 5,
            }}
          >
            <span style={{ fontSize: 10, color: "#555" }}>{t.coin}</span>
            <span
              style={{
                fontSize: 8,
                padding: "2px 5px",
                borderRadius: 2,
                textAlign: "center",
                fontWeight: 500,
                letterSpacing: "0.04em",
                background: t.direction === "LONG" ? "#1d4a34" : "#4a1d1d",
                color:      t.direction === "LONG" ? "#4ecf8a" : "#cf4e4e",
              }}
            >
              {t.direction}
            </span>
            <span style={{ fontSize: 9, color: "#2a2a2a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {t.reason}
            </span>
            <span
              style={{
                fontFamily: "var(--font-sans, Inter, sans-serif)",
                fontWeight: 700,
                fontSize: 11,
                textAlign: "right",
                color: t.pnl >= 0 ? "#4ecf8a" : "#cf4e4e",
              }}
            >
              {t.pnl >= 0 ? "+" : ""}${Math.abs(t.pnl)}
            </span>
            <span style={{ fontSize: 8, color: "#1e1e1e", textAlign: "right" }}>{t.time}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
