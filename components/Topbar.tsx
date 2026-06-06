"use client";

import { useEffect, useRef, useState } from "react";
import type { HLAccount } from "@/lib/types";

interface Prices {
  btc: number;
  eth: number;
  sol: number;
  paxg: number;
  xauusd?: number;
}

interface Props {
  prices: Prices | null;
  connected: boolean;
  hlAccount: HLAccount | null;
  unreadSignals?: number;
  onSignalBell?: () => void;
  isMobile?: boolean;
}

function BellIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2a4 4 0 0 1 4 4v3l1 1.5H3L4 9V6a4 4 0 0 1 4-4z"/>
      <path d="M6.5 12.5a1.5 1.5 0 0 0 3 0"/>
      {active && <circle cx="12" cy="4" r="2.5" fill="#cf4e4e" stroke="#070707" strokeWidth="1"/>}
    </svg>
  );
}

function PriceChip({ label, price, dayChangePct }: {
  label: string;
  price: number;
  dayChangePct?: number;
}) {
  const prevPriceRef = useRef<number>(price);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (price === 0 || prevPriceRef.current === 0) { prevPriceRef.current = price; return; }
    if (Math.abs(price - prevPriceRef.current) / prevPriceRef.current < 0.00005) return;
    const dir = price > prevPriceRef.current ? "up" : "down";
    prevPriceRef.current = price;
    setFlash(dir);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setFlash(null), 600);
  }, [price]);

  const pct   = dayChangePct ?? 0;
  const isPos = pct >= 0;

  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
      <span style={{ fontSize: 9, color: "#444", letterSpacing: "0.10em", fontFamily: "var(--font-mono)" }}>
        {label}
      </span>
      <span
        className={flash === "up" ? "price-up" : flash === "down" ? "price-down" : ""}
        style={{
          fontFamily: "var(--font-sans, Inter, sans-serif)",
          fontWeight: 600,
          fontSize: 12,
          letterSpacing: "-0.01em",
          fontVariantNumeric: "tabular-nums",
          color: "#e8e8e8",
          transition: "color 0.1s",
        }}
      >
        {price > 0
          ? price.toLocaleString("en-US", { maximumFractionDigits: price > 1000 ? 0 : 2 })
          : "—"}
      </span>
      {price > 0 && (
        <span style={{
          fontSize: 9,
          color: isPos ? "#4ecf8a" : "#cf4e4e",
          fontVariantNumeric: "tabular-nums",
        }}>
          {isPos ? "+" : ""}{pct.toFixed(1)}%
        </span>
      )}
    </div>
  );
}

export default function Topbar({ prices, connected, hlAccount: _hlAccount, unreadSignals = 0, onSignalBell, isMobile = false }: Props) {
  const [now, setNow] = useState<string>("");
  useEffect(() => {
    const tick = () => setNow(new Date().toUTCString().slice(17, 25));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <header
      role="banner"
      style={{
        height: isMobile ? 44 : 36,
        background: "#0a0a0a",
        borderBottom: "1px solid #161616",
        display: "flex",
        alignItems: "center",
        padding: isMobile ? "0 16px" : "0 14px",
        paddingTop: isMobile ? "var(--safe-top, 0px)" : 0,
        flexShrink: 0,
        position: "relative",
        zIndex: 10,
      }}
    >
      {/* Logo */}
      <div style={{ flexShrink: 0, marginRight: isMobile ? 12 : 20, userSelect: "none", display: "flex", alignItems: "center" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/cortisol-logo.png"
          alt="CORTISOL"
          style={{ height: isMobile ? 26 : 22, width: "auto", objectFit: "contain" }}
          onError={(e) => {
            // Fallback to text if image not found
            const el = e.currentTarget.parentElement!;
            e.currentTarget.style.display = "none";
            el.innerHTML = `<span style="font-family:var(--font-sans,Inter,sans-serif);font-weight:900;font-size:${isMobile ? 15 : 13}px;letter-spacing:0.08em;color:#e8e8e8">COR<span style="color:#4e8ecf">TISOL</span></span>`;
          }}
        />
      </div>

      {/* Separator — desktop only */}
      {!isMobile && (
        <div className="topbar-sep" style={{ width: 1, height: 16, background: "#1c1c1c", marginRight: 20, flexShrink: 0 }} />
      )}

      {/* Live prices — desktop only */}
      {!isMobile && (
        prices ? (
          <div className="topbar-prices" style={{ display: "flex", gap: 16, alignItems: "center" }}>
            <PriceChip label="BTC"  price={prices.btc}                dayChangePct={1.24} />
            <PriceChip label="ETH"  price={prices.eth}                dayChangePct={-0.87} />
            <PriceChip label="SOL"  price={prices.sol}                dayChangePct={2.15} />
            <PriceChip label="GOLD" price={prices.xauusd ?? prices.paxg} dayChangePct={0.32} />
          </div>
        ) : (
          <span style={{ fontSize: 10, color: "#333", fontFamily: "var(--font-mono)" }}>
            connecting<span className="blink">_</span>
          </span>
        )
      )}

      {/* Mobile: live price ticker — compact single coin */}
      {isMobile && prices && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", overflow: "hidden" }}>
          <PriceChip label="BTC" price={prices.btc} />
          <PriceChip label="ETH" price={prices.eth} />
          <PriceChip label="SOL" price={prices.sol} />
        </div>
      )}
      {isMobile && !prices && (
        <span style={{ fontSize: 10, color: "#333", fontFamily: "var(--font-mono)" }}>
          connecting<span className="blink">_</span>
        </span>
      )}

      {/* Right side */}
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: isMobile ? 12 : 16 }}>
        {/* Signal bell */}
        <button
          onClick={onSignalBell}
          aria-label={unreadSignals > 0 ? `${unreadSignals} unread signal alerts` : "Signal alerts"}
          style={{
            position: "relative",
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: isMobile ? "0 4px" : 0,
            lineHeight: 1,
            color: unreadSignals > 0 ? "#cfad4e" : "#333",
            display: "flex",
            alignItems: "center",
            minWidth: 44,
            minHeight: 44,
            justifyContent: "center",
            WebkitTapHighlightColor: "transparent",
            transition: "color 0.12s",
          }}
        >
          <BellIcon active={unreadSignals > 0} />
          {unreadSignals > 0 && (
            <span style={{
              position: "absolute",
              top: 6, right: 4,
              background: "#cf4e4e",
              borderRadius: "50%",
              width: 13, height: 13,
              fontSize: 7,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "var(--font-mono)",
              color: "#fff",
              fontWeight: 700,
              border: "1px solid #070707",
            }}>
              {unreadSignals > 9 ? "9+" : unreadSignals}
            </span>
          )}
        </button>

        {/* Separator — desktop only */}
        {!isMobile && <div className="topbar-sep" style={{ width: 1, height: 14, background: "#1c1c1c" }} />}

        {/* Connection status */}
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <div
            className={connected ? "pulse-dot" : ""}
            style={{
              width: 5, height: 5,
              borderRadius: "50%",
              background: connected ? "#4ecf8a" : "#333",
              boxShadow: connected ? "0 0 5px rgba(78,207,138,0.6)" : "none",
              flexShrink: 0,
            }}
          />
          <span style={{
            fontSize: 9,
            color: connected ? "#4ecf8a" : "#444",
            letterSpacing: "0.10em",
            fontFamily: "var(--font-mono)",
            fontWeight: 600,
          }}>
            {connected ? "LIVE" : "OFFLINE"}
          </span>
        </div>

        {/* UTC clock — desktop only */}
        {!isMobile && (
          <span
            className="topbar-clock"
            style={{ fontSize: 10, color: "#444", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", letterSpacing: "0.03em" }}
            suppressHydrationWarning
          >
            {now ? `${now} UTC` : ""}
          </span>
        )}
      </div>
    </header>
  );
}
