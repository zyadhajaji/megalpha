"use client";

// Trade log — shows paper trades when available, falls back to illustrative placeholder rows.
// Phase 2 wires this to real /paper/history endpoint.

interface Trade {
  id: string;
  coin: string;
  direction: "LONG" | "SHORT";
  reason: string;
  pnl: number;
  time: string;
  strategy?: string;
}

const PLACEHOLDER_TRADES: Trade[] = [
  { id: "1", coin: "BTC",  direction: "LONG",  strategy: "A", reason: "Stop hunt + vol spike + 4H aligned",    pnl:  94,  time: "08:12" },
  { id: "2", coin: "ETH",  direction: "SHORT", strategy: "B", reason: "EMA cross · ADX 38 · below EMA200",     pnl: -18,  time: "06:44" },
  { id: "3", coin: "SOL",  direction: "LONG",  strategy: "D", reason: "Breakout confirm · 91% confluence",     pnl:  41,  time: "03:20" },
  { id: "4", coin: "BTC",  direction: "SHORT", strategy: "A", reason: "Liquidity sweep at 4H resistance",       pnl: 128,  time: "01:05" },
  { id: "5", coin: "ETH",  direction: "LONG",  strategy: "C", reason: "Range expansion · London open",         pnl: -32,  time: "00:18" },
  { id: "6", coin: "BTC",  direction: "LONG",  strategy: "D", reason: "Vol squeeze breakout · 87% conf",       pnl:  76,  time: "Yest." },
];

interface Props {
  // Phase 2: pass real paper trade history here
  trades?: Trade[];
}

const COIN_COLOR: Record<string, string> = {
  BTC: "#cfad4e", ETH: "#4e8ecf", SOL: "#8a4ecf", PAXG: "#4ecf8a",
};

const STRATEGY_COLOR: Record<string, { bg: string; text: string }> = {
  A: { bg: "rgba(207,173,78,0.08)",  text: "#cfad4e" },
  B: { bg: "rgba(78,142,207,0.08)", text: "#4e8ecf" },
  C: { bg: "rgba(78,207,138,0.08)", text: "#4ecf8a" },
  D: { bg: "rgba(138,78,207,0.08)", text: "#8a4ecf" },
};

export default function TradeLog({ trades }: Props) {
  const displayTrades = trades && trades.length > 0 ? trades : PLACEHOLDER_TRADES;
  const isPlaceholder = !trades || trades.length === 0;

  return (
    <div
      className="panel"
      style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "hidden" }}
    >
      {/* Header */}
      <div
        style={{
          padding: "7px 12px",
          borderBottom: "1px solid #141414",
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexShrink: 0,
        }}
      >
        <span style={{
          fontSize: 9,
          color: "#555",
          letterSpacing: "0.10em",
          textTransform: "uppercase",
          fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace",
          fontWeight: 500,
        }}>
          Trade Log
        </span>
        <div style={{ flex: 1 }} />
        {isPlaceholder && (
          <span style={{
            fontSize: 8,
            color: "#333",
            fontFamily: "var(--font-mono)",
            fontStyle: "italic",
          }}>
            placeholder
          </span>
        )}
      </div>

      {/* Rows */}
      <div className="scroll-y" style={{ flex: 1 }}>
        {displayTrades.map((t) => {
          const isWin = t.pnl >= 0;
          const coinCol = COIN_COLOR[t.coin] ?? "#999";
          const stratStyle = t.strategy ? STRATEGY_COLOR[t.strategy] : null;

          return (
            <div
              key={t.id}
              style={{
                display: "grid",
                gridTemplateColumns: "30px 42px auto 54px 30px",
                alignItems: "center",
                padding: "6px 12px",
                borderBottom: "1px solid #0e0e0e",
                gap: 6,
                transition: "background 0.1s",
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = "#0e0e0e"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
            >
              {/* Coin */}
              <span style={{
                fontSize: 10,
                fontWeight: 700,
                color: coinCol,
                fontFamily: "var(--font-sans, Inter, sans-serif)",
                letterSpacing: "0.02em",
              }}>
                {t.coin}
              </span>

              {/* Direction */}
              <span style={{
                fontSize: 8,
                padding: "2px 5px",
                borderRadius: 2,
                textAlign: "center",
                fontWeight: 600,
                letterSpacing: "0.04em",
                fontFamily: "var(--font-mono)",
                background: t.direction === "LONG" ? "rgba(78,207,138,0.1)" : "rgba(207,78,78,0.1)",
                color:      t.direction === "LONG" ? "#4ecf8a" : "#cf4e4e",
                border: `1px solid ${t.direction === "LONG" ? "rgba(78,207,138,0.2)" : "rgba(207,78,78,0.2)"}`,
              }}>
                {t.direction === "LONG" ? "↑ L" : "↓ S"}
              </span>

              {/* Reason */}
              <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
                {stratStyle && t.strategy && (
                  <span style={{
                    fontSize: 7,
                    padding: "1px 4px",
                    borderRadius: 2,
                    fontFamily: "var(--font-mono)",
                    fontWeight: 700,
                    background: stratStyle.bg,
                    color: stratStyle.text,
                    flexShrink: 0,
                    letterSpacing: "0.04em",
                  }}>
                    {t.strategy}
                  </span>
                )}
                <span style={{
                  fontSize: 9,
                  color: "#777",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  fontFamily: "var(--font-mono)",
                }}>
                  {t.reason}
                </span>
              </div>

              {/* P&L */}
              <span style={{
                fontFamily: "var(--font-sans, Inter, sans-serif)",
                fontWeight: 700,
                fontSize: 11,
                textAlign: "right",
                color: isWin ? "#4ecf8a" : "#cf4e4e",
                fontVariantNumeric: "tabular-nums",
              }}>
                {isWin ? "+" : ""}${Math.abs(t.pnl)}
              </span>

              {/* Time */}
              <span style={{
                fontSize: 8,
                color: "#444",
                textAlign: "right",
                fontFamily: "var(--font-mono)",
                fontVariantNumeric: "tabular-nums",
              }}>
                {t.time}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
