"use client";

import { useCallback, useEffect, useState } from "react";
import { BRIDGE_HTTP } from "@/lib/bridge";
import type { HLStreamData } from "@/hooks/useHLStream";

const mono = "var(--font-mono, 'IBM Plex Mono', monospace)";
const sans = "var(--font-sans, Inter, sans-serif)";
const GREEN = "#4ecf8a";
const RED   = "#cf4e4e";
const BLUE  = "#4e8ecf";
const AMBER = "#cfad4e";

// ── Types ─────────────────────────────────────────────────────────────────────

interface MT5Status {
  connected:   boolean;
  name:        string;
  login:       number | string;
  server:      string;
  balance:     number;
  equity:      number;
  margin:      number;
  free_margin: number;
  profit:      number;
  currency:    string;
}

interface MT5Position {
  ticket:        number;
  symbol:        string;
  type:          number; // 0 = BUY, 1 = SELL
  volume:        number;
  open_price:    number;
  current_price: number;
  sl:            number;
  tp:            number;
  profit:        number;
  comment:       string;
}

interface Props {
  hl: HLStreamData;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtMoney(n: number | null | undefined, decimals = 2): string {
  if (n == null || !isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function timeAgo(ms: number) {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60)  return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusDot({ on }: { on: boolean }) {
  return (
    <div style={{
      width: 6, height: 6, borderRadius: "50%",
      background: on ? GREEN : "#333",
      boxShadow: on ? `0 0 5px ${GREEN}` : "none",
      flexShrink: 0,
    }} />
  );
}

function MT5PositionCard({
  pos,
  onClose,
  closing,
}: {
  pos: MT5Position;
  onClose: (ticket: number) => void;
  closing: boolean;
}) {
  const isBuy    = pos.type === 0;
  const typeStr  = isBuy ? "BUY" : "SELL";
  const typeCol  = isBuy ? GREEN : RED;
  const pnlPos   = pos.profit >= 0;
  const pnlCol   = pnlPos ? GREEN : RED;

  return (
    <div style={{
      borderRadius: 5,
      border: `1px solid ${pnlPos ? "rgba(78,207,138,0.18)" : "rgba(207,78,78,0.18)"}`,
      borderLeft: `3px solid ${typeCol}`,
      background: pnlPos ? "rgba(78,207,138,0.04)" : "rgba(207,78,78,0.04)",
      padding: "10px 12px",
      display: "flex", flexDirection: "column", gap: 7,
    }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontFamily: mono, fontSize: 11, fontWeight: 700, color: "#e8e8e8" }}>
          {pos.symbol}
        </span>
        <span style={{
          fontFamily: mono, fontSize: 9, fontWeight: 700, color: typeCol,
          background: `${typeCol}18`, border: `1px solid ${typeCol}33`,
          borderRadius: 2, padding: "1px 7px",
        }}>
          {isBuy ? "↑" : "↓"} {typeStr}
        </span>
        <span style={{ fontFamily: mono, fontSize: 9, color: "#555" }}>
          {pos.volume} lot
        </span>
        <div style={{ flex: 1 }} />
        <span style={{
          fontFamily: sans, fontSize: 13, fontWeight: 700, color: pnlCol,
        }}>
          {pnlPos ? "+" : ""}{fmtMoney(pos.profit)}
        </span>
      </div>

      {/* Price row */}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontFamily: mono, fontSize: 7, color: "#555", marginBottom: 1 }}>OPEN</div>
          <div style={{ fontFamily: mono, fontSize: 10, color: "#888" }}>
            ${fmtMoney(pos.open_price, 5)}
          </div>
        </div>
        <div>
          <div style={{ fontFamily: mono, fontSize: 7, color: "#555", marginBottom: 1 }}>CURRENT</div>
          <div style={{ fontFamily: mono, fontSize: 10, color: "#e8e8e8" }}>
            ${fmtMoney(pos.current_price, 5)}
          </div>
        </div>
        {pos.sl > 0 && (
          <div>
            <div style={{ fontFamily: mono, fontSize: 7, color: "#555", marginBottom: 1 }}>SL</div>
            <div style={{ fontFamily: mono, fontSize: 10, color: RED }}>
              ${fmtMoney(pos.sl, 5)}
            </div>
          </div>
        )}
        {pos.tp > 0 && (
          <div>
            <div style={{ fontFamily: mono, fontSize: 7, color: "#555", marginBottom: 1 }}>TP</div>
            <div style={{ fontFamily: mono, fontSize: 10, color: GREEN }}>
              ${fmtMoney(pos.tp, 5)}
            </div>
          </div>
        )}
        <div style={{ flex: 1 }} />
        <button
          onClick={() => onClose(pos.ticket)}
          disabled={closing}
          style={{
            fontFamily: mono, fontSize: 8, fontWeight: 600,
            padding: "4px 11px", borderRadius: 3,
            cursor: closing ? "not-allowed" : "pointer",
            background: closing ? "#0a0a0a" : "rgba(207,78,78,0.08)",
            border: `1px solid ${closing ? "#1c1c1c" : "rgba(207,78,78,0.25)"}`,
            color: closing ? "#333" : RED,
            minHeight: 28,
          }}
        >
          {closing ? "…" : "Close →"}
        </button>
      </div>
    </div>
  );
}

function HLPositionCard({ pos }: { pos: import("@/lib/types").HLPosition }) {
  const isLong  = pos.is_long;
  const typeCol = isLong ? GREEN : RED;
  const pnlPos  = pos.unrealized_pnl >= 0;
  const pnlCol  = pnlPos ? GREEN : RED;

  return (
    <div style={{
      borderRadius: 5,
      border: `1px solid ${pnlPos ? "rgba(78,207,138,0.18)" : "rgba(207,78,78,0.18)"}`,
      borderLeft: `3px solid ${typeCol}`,
      background: pnlPos ? "rgba(78,207,138,0.04)" : "rgba(207,78,78,0.04)",
      padding: "10px 12px",
      display: "flex", flexDirection: "column", gap: 7,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontFamily: mono, fontSize: 11, fontWeight: 700, color: "#e8e8e8" }}>
          {pos.coin}
        </span>
        <span style={{
          fontFamily: mono, fontSize: 9, fontWeight: 700, color: typeCol,
          background: `${typeCol}18`, border: `1px solid ${typeCol}33`,
          borderRadius: 2, padding: "1px 7px",
        }}>
          {isLong ? "↑ LONG" : "↓ SHORT"}
        </span>
        <span style={{ fontFamily: mono, fontSize: 9, color: "#555" }}>
          {Math.abs(pos.size)} {pos.leverage_type} {pos.leverage_value}×
        </span>
        <div style={{ flex: 1 }} />
        <span style={{ fontFamily: sans, fontSize: 13, fontWeight: 700, color: pnlCol }}>
          {pnlPos ? "+" : ""}{fmtMoney(pos.unrealized_pnl)}
        </span>
      </div>

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontFamily: mono, fontSize: 7, color: "#555", marginBottom: 1 }}>ENTRY</div>
          <div style={{ fontFamily: mono, fontSize: 10, color: "#888" }}>
            ${fmtMoney(pos.entry_px, 1)}
          </div>
        </div>
        {pos.liq_px && (
          <div>
            <div style={{ fontFamily: mono, fontSize: 7, color: "#555", marginBottom: 1 }}>LIQ</div>
            <div style={{ fontFamily: mono, fontSize: 10, color: RED }}>
              ${fmtMoney(Number(pos.liq_px), 1)}
            </div>
          </div>
        )}
        <div style={{ flex: 1 }} />
        <span style={{ fontFamily: mono, fontSize: 8, color: "#444", alignSelf: "flex-end" }}>
          HL — close via exchange
        </span>
      </div>
    </div>
  );
}

function EmptyPositions() {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "32px 0",
      fontFamily: mono, fontSize: 9, color: "#555", letterSpacing: "0.08em",
    }}>
      No open positions
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function WalletPage({ hl }: Props) {
  const [activeTab, setActiveTab] = useState<"mt5" | "hl">("mt5");
  const [mt5Status,    setMt5Status]    = useState<MT5Status | null>(null);
  const [mt5Positions, setMt5Positions] = useState<MT5Position[]>([]);
  const [closingTicket, setClosingTicket] = useState<number | null>(null);
  const [closeMsg, setCloseMsg] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);

  const fetchMT5 = useCallback(async () => {
    try {
      const [statusRes, posRes] = await Promise.all([
        fetch(`${BRIDGE_HTTP}/mt5/status`),
        fetch(`${BRIDGE_HTTP}/mt5/positions`),
      ]);
      if (statusRes.ok) {
        const d = await statusRes.json() as MT5Status;
        setMt5Status(d);
      }
      if (posRes.ok) {
        const d = await posRes.json() as MT5Position[];
        setMt5Positions(Array.isArray(d) ? d : []);
      }
      setFetchedAt(Date.now());
    } catch {
      // bridge offline
    }
  }, []);

  useEffect(() => {
    fetchMT5();
    const id = setInterval(fetchMT5, 10_000);
    return () => clearInterval(id);
  }, [fetchMT5]);

  async function closeMT5Position(ticket: number) {
    setClosingTicket(ticket);
    setCloseMsg(null);
    try {
      const r = await fetch(`${BRIDGE_HTTP}/mt5/close/${ticket}`, { method: "POST" });
      const d = await r.json() as { ok?: boolean; error?: string };
      if (d.ok) {
        setCloseMsg(`Closed #${ticket}`);
        await fetchMT5();
      } else {
        setCloseMsg(`Error: ${d.error ?? "Failed"}`);
      }
    } catch {
      setCloseMsg("Bridge offline");
    } finally {
      setClosingTicket(null);
    }
  }

  const hlAccount  = hl.hlAccount;
  const mt5Ok      = mt5Status?.connected ?? false;
  const hlOk       = hl.connected;

  // Derived MT5 numbers
  const mt5Pnl     = mt5Status ? mt5Status.equity - mt5Status.balance : null;
  const pnlPos     = mt5Pnl != null ? mt5Pnl >= 0 : true;

  // Estimated USD from CAD (rough 0.73 rate if currency is CAD)
  const currency   = mt5Status?.currency ?? "USD";
  const cadRate    = currency === "CAD" ? 0.73 : 1;
  const balanceUsd = mt5Status ? mt5Status.balance * cadRate : null;

  return (
    <div style={{
      height: "100%",
      overflow: "auto",
      background: "#070707",
      display: "flex",
      justifyContent: "center",
      paddingBottom: "calc(var(--bottom-nav-h, 56px) + env(safe-area-inset-bottom, 0px) + 8px)",
      WebkitOverflowScrolling: "touch",
    }}>
      <div style={{
        width: "100%",
        maxWidth: 520,
        display: "flex",
        flexDirection: "column",
      }}>

        {/* ── Header bar ─────────────────────────────────────────────────────── */}
        <div style={{
          display: "flex", alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 16px 10px",
          borderBottom: "1px solid #1a1a1a",
          flexShrink: 0,
        }}>
          <span style={{ fontFamily: mono, fontSize: 10, fontWeight: 700, color: "#e8e8e8", letterSpacing: "0.10em" }}>
            WALLET
          </span>
          <span style={{ fontFamily: mono, fontSize: 9, color: "#333", letterSpacing: "0.06em" }}>
            ⬡ CORTISOL
          </span>
        </div>

        {/* ── Account switcher ───────────────────────────────────────────────── */}
        <div style={{
          display: "flex", gap: 6,
          padding: "12px 16px 0",
          flexShrink: 0,
        }}>
          {/* MT5 tab */}
          <button
            onClick={() => setActiveTab("mt5")}
            style={{
              flex: 1, minHeight: 44,
              fontFamily: mono, fontSize: 9, fontWeight: 700,
              cursor: "pointer", borderRadius: 4,
              background: activeTab === "mt5"
                ? "rgba(207,173,78,0.10)"
                : "#0c0c0c",
              border: `1px solid ${activeTab === "mt5" ? "rgba(207,173,78,0.35)" : "#1c1c1c"}`,
              color: activeTab === "mt5" ? AMBER : "#444",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              transition: "all 0.12s",
            }}
          >
            <StatusDot on={mt5Ok} />
            MT5
          </button>

          {/* HL tab */}
          <button
            onClick={() => setActiveTab("hl")}
            style={{
              flex: 1, minHeight: 44,
              fontFamily: mono, fontSize: 9, fontWeight: 700,
              cursor: "pointer", borderRadius: 4,
              background: activeTab === "hl"
                ? "rgba(78,142,207,0.10)"
                : "#0c0c0c",
              border: `1px solid ${activeTab === "hl" ? "rgba(78,142,207,0.35)" : "#1c1c1c"}`,
              color: activeTab === "hl" ? BLUE : "#444",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              transition: "all 0.12s",
            }}
          >
            <StatusDot on={hlOk} />
            HL PERPS
          </button>
        </div>

        {/* ── Account Card ───────────────────────────────────────────────────── */}
        <div style={{ padding: "12px 16px 0", flexShrink: 0 }}>
          {activeTab === "mt5" ? (
            <div style={{
              borderRadius: 8,
              background: "rgba(207,173,78,0.08)",
              border: "1px solid rgba(207,173,78,0.15)",
              borderLeft: "3px solid " + AMBER,
              padding: "16px 18px",
              display: "flex", flexDirection: "column", gap: 12,
            }}>
              {/* Account name + login */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontFamily: mono, fontSize: 8, color: "#555", letterSpacing: "0.08em", marginBottom: 3 }}>
                    MT5 VT MARKETS
                  </div>
                  <div style={{ fontFamily: mono, fontSize: 9, color: "#888" }}>
                    #{mt5Status?.login ?? "—"}
                  </div>
                </div>
                {mt5Status?.server && (
                  <span style={{ fontFamily: mono, fontSize: 7, color: "#555" }}>
                    {mt5Status.server}
                  </span>
                )}
              </div>

              {/* Balance */}
              <div>
                <div style={{ fontFamily: mono, fontSize: 8, color: "#555", letterSpacing: "0.06em", marginBottom: 4 }}>
                  BALANCE
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontFamily: sans, fontWeight: 800, fontSize: 32, color: "#e8e8e8", lineHeight: 1 }}>
                    {mt5Status ? fmtMoney(mt5Status.balance) : "—"}
                  </span>
                  <span style={{ fontFamily: mono, fontSize: 10, color: "#888" }}>
                    {currency}
                  </span>
                </div>
                {currency !== "USD" && balanceUsd != null && (
                  <div style={{ fontFamily: mono, fontSize: 9, color: "#555", marginTop: 3 }}>
                    ≈ ${fmtMoney(balanceUsd)} USD est.
                  </div>
                )}
              </div>

              {/* Equity P&L chip */}
              {mt5Pnl != null && mt5Status && (
                <div style={{ display: "flex", gap: 8 }}>
                  <span style={{
                    fontFamily: sans, fontSize: 13, fontWeight: 700,
                    color: pnlPos ? GREEN : RED,
                    background: pnlPos ? "rgba(78,207,138,0.10)" : "rgba(207,78,78,0.10)",
                    border: `1px solid ${pnlPos ? "rgba(78,207,138,0.25)" : "rgba(207,78,78,0.25)"}`,
                    borderRadius: 4, padding: "4px 10px",
                  }}>
                    {pnlPos ? "+" : ""}{fmtMoney(mt5Pnl)} P&amp;L
                  </span>
                  <span style={{
                    fontFamily: mono, fontSize: 9, color: "#555",
                    alignSelf: "center",
                  }}>
                    Equity {fmtMoney(mt5Status.equity)}
                  </span>
                </div>
              )}

              {/* Performance row */}
              {mt5Status && (
                <div style={{
                  display: "flex", gap: 0,
                  borderTop: "1px solid rgba(207,173,78,0.12)",
                  paddingTop: 10, marginTop: 2,
                }}>
                  {[
                    { label: "BALANCE",     value: fmtMoney(mt5Status.balance),     color: "#e8e8e8" },
                    { label: "EQUITY",      value: fmtMoney(mt5Status.equity),      color: "#e8e8e8" },
                    { label: "FREE MARGIN", value: fmtMoney(mt5Status.free_margin), color: AMBER },
                  ].map((item, i) => (
                    <div key={i} style={{ flex: 1 }}>
                      <div style={{ fontFamily: mono, fontSize: 7, color: "#333", letterSpacing: "0.06em", marginBottom: 2 }}>
                        {item.label}
                      </div>
                      <div style={{ fontFamily: mono, fontSize: 10, fontWeight: 600, color: item.color }}>
                        {item.value}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Offline state */}
              {!mt5Ok && (
                <div style={{ fontFamily: mono, fontSize: 9, color: "#333" }}>
                  MT5 disconnected
                </div>
              )}
            </div>
          ) : (
            /* HL account card */
            <div style={{
              borderRadius: 8,
              background: "rgba(78,142,207,0.08)",
              border: "1px solid rgba(78,142,207,0.15)",
              borderLeft: "3px solid " + BLUE,
              padding: "16px 18px",
              display: "flex", flexDirection: "column", gap: 12,
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontFamily: mono, fontSize: 8, color: "#555", letterSpacing: "0.08em", marginBottom: 3 }}>
                    HYPERLIQUID PERPS
                  </div>
                  <div style={{ fontFamily: mono, fontSize: 8, color: "#888" }}>
                    {hlAccount?.address
                      ? `${hlAccount.address.slice(0, 6)}…${hlAccount.address.slice(-4)}`
                      : "—"}
                  </div>
                </div>
                <StatusDot on={hlOk} />
              </div>

              {/* Account value */}
              <div>
                <div style={{ fontFamily: mono, fontSize: 8, color: "#555", letterSpacing: "0.06em", marginBottom: 4 }}>
                  ACCOUNT VALUE
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontFamily: sans, fontWeight: 800, fontSize: 32, color: "#e8e8e8", lineHeight: 1 }}>
                    {hlAccount ? fmtMoney(hlAccount.account_value) : "—"}
                  </span>
                  <span style={{ fontFamily: mono, fontSize: 10, color: "#888" }}>USD</span>
                </div>
              </div>

              {/* Performance row */}
              {hlAccount && (
                <div style={{
                  display: "flex",
                  borderTop: "1px solid rgba(78,142,207,0.12)",
                  paddingTop: 10, marginTop: 2,
                }}>
                  {[
                    { label: "ACCOUNT VALUE",  value: fmtMoney(hlAccount.account_value),    color: "#e8e8e8" },
                    { label: "WITHDRAWABLE",   value: fmtMoney(hlAccount.withdrawable),      color: BLUE },
                    { label: "MARGIN USED",    value: fmtMoney(hlAccount.total_margin_used), color: AMBER },
                  ].map((item, i) => (
                    <div key={i} style={{ flex: 1 }}>
                      <div style={{ fontFamily: mono, fontSize: 7, color: "#333", letterSpacing: "0.06em", marginBottom: 2 }}>
                        {item.label}
                      </div>
                      <div style={{ fontFamily: mono, fontSize: 10, fontWeight: 600, color: item.color }}>
                        {item.value}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {!hlOk && (
                <div style={{ fontFamily: mono, fontSize: 9, color: "#333" }}>
                  HL stream disconnected
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Positions ──────────────────────────────────────────────────────── */}
        <div style={{ padding: "18px 16px 0", flexShrink: 0 }}>
          <div style={{
            fontFamily: mono, fontSize: 8, color: "#555",
            letterSpacing: "0.10em", marginBottom: 10,
          }}>
            POSITIONS
          </div>

          {/* Close message */}
          {closeMsg && (
            <div style={{
              fontFamily: mono, fontSize: 9,
              color: closeMsg.startsWith("Error") || closeMsg === "Bridge offline" ? RED : GREEN,
              background: closeMsg.startsWith("Error") || closeMsg === "Bridge offline"
                ? "rgba(207,78,78,0.08)" : "rgba(78,207,138,0.08)",
              border: `1px solid ${closeMsg.startsWith("Error") || closeMsg === "Bridge offline"
                ? "rgba(207,78,78,0.2)" : "rgba(78,207,138,0.2)"}`,
              borderRadius: 3, padding: "6px 10px",
              marginBottom: 8,
            }}>
              {closeMsg}
            </div>
          )}

          {activeTab === "mt5" ? (
            mt5Positions.length === 0 ? (
              <EmptyPositions />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {mt5Positions.map(pos => (
                  <MT5PositionCard
                    key={pos.ticket}
                    pos={pos}
                    onClose={closeMT5Position}
                    closing={closingTicket === pos.ticket}
                  />
                ))}
              </div>
            )
          ) : (
            !hlAccount || hlAccount.positions.length === 0 ? (
              <EmptyPositions />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {hlAccount.positions.map(pos => (
                  <HLPositionCard key={pos.coin} pos={pos} />
                ))}
              </div>
            )
          )}
        </div>

        {/* ── Footer: last updated ───────────────────────────────────────────── */}
        {fetchedAt && activeTab === "mt5" && (
          <div style={{
            padding: "12px 16px 0",
            fontFamily: mono, fontSize: 7, color: "#444",
          }}>
            MT5 updated {timeAgo(fetchedAt)}
          </div>
        )}
      </div>
    </div>
  );
}
