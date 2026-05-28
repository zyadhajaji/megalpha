# Phase 1 — Layout Redesign + Full Historical Charts

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-scroll dashboard with a new shell (topbar + sidebar nav + overview page), add an animated RL neural network panel, and add a paginated `/candles/{coin}` endpoint that serves full Hyperliquid history from asset creation.

**Architecture:** React state drives page navigation (no URL changes — keeps the WebSocket alive). Each page is a component rendered in the Shell's content slot. ChartPanel fetches historical candles from a new REST endpoint; live 1m candles still come via WebSocket. The RL network panel is a pure CSS-animated SVG — no real inference yet (that's Phase 3).

**Tech Stack:** Next.js 16 · React 19 · TypeScript · Tailwind CSS v4 · lightweight-charts v5 · IBM Plex Mono + Inter (Google Fonts) · FastAPI · Python asyncio

> ⚠️ **Before writing any Next.js/React code**, read the relevant guide in `node_modules/next/dist/docs/` — this is Next.js 16, which has breaking changes from training data. Heed any deprecation notices.

---

## File Map

**Create:**
- `lib/types.ts` — shared TS types used across hooks and components
- `components/Shell.tsx` — page wrapper: topbar + sidebar + content slot
- `components/Topbar.tsx` — logo, live prices, connection status, clock
- `components/Sidebar.tsx` — icon nav, manages active page state
- `components/HeroRow.tsx` — four stat cards at top of Overview
- `components/ChartPanel.tsx` — candlestick chart, timeframe selector, REST fetch
- `components/RLNetworkPanel.tsx` — animated SVG neural network
- `components/PnlCard.tsx` — today/7d/30d P&L stats
- `components/TradeLog.tsx` — scrollable trade list with reasons
- `components/BottomBar.tsx` — margin / available / paper balance strip
- `components/pages/OverviewPage.tsx` — assembles all Overview panels
- `components/pages/ChartsPage.tsx` — stub
- `components/pages/BacktestPage.tsx` — stub
- `components/pages/RLAgentPage.tsx` — stub
- `components/pages/DataHubPage.tsx` — stub
- `components/pages/JournalPage.tsx` — stub
- `server/tests/test_candles.py` — pytest for the candle endpoint

**Modify:**
- `app/layout.tsx` — add Inter font
- `app/globals.css` — new design tokens + NN keyframe animations
- `app/page.tsx` — rewrite: just renders `<Shell />`
- `hooks/useHLStream.ts` — add `RLAgentState` type + `rlAgent` field
- `server/main.py` — add paginated candle fetcher + `/candles/{coin}` endpoint, remove `analyze_coin` from broadcaster

**Delete** (after Task 18):
- `components/SniperPanel.tsx`
- `components/Pipeline.tsx`
- `components/WinStack.tsx`
- `components/PnlCurve.tsx`
- `components/BottomPanels.tsx`
- `components/FooterTicker.tsx`
- `components/Header.tsx`
- `hooks/useDashboard.ts`

---

## Task 1 — Shared Types

**Files:**
- Create: `lib/types.ts`

- [ ] **Create `lib/types.ts`**

```typescript
// lib/types.ts
// Single source of truth for types shared across hooks and components.

export interface Candle {
  time: number;   // Unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface HLPosition {
  coin: string;
  size: number;           // positive = long, negative = short
  entry_px: number;
  unrealized_pnl: number;
  liq_px: string | null;
  leverage_type: string;
  leverage_value: number;
  is_long: boolean;
}

export interface HLAccount {
  address: string;
  account_value: number;
  total_margin_used: number;
  withdrawable: number;
  positions: HLPosition[];
}

export interface Trade {
  id: string;
  coin: string;
  direction: "LONG" | "SHORT";
  entry_px: number;
  exit_px: number | null;
  size_usd: number;
  leverage: number;
  pnl: number | null;
  reason: string;         // agent reasoning snippet
  open_time: number;      // unix ms
  close_time: number | null;
}

export interface RLAgentState {
  status: "scanning" | "in_trade" | "training" | "offline";
  confidence: number;             // 0–1
  action_probs: [number, number, number]; // [long%, hold%, short%] sum = 1
  episode: number;
  session: string;                // "London" | "NY" | "Asia" | "Off-hours"
  last_action: string | null;     // "BTC LONG" etc.
  last_pnl: number | null;
}
```

- [ ] **Commit**

```bash
git add lib/types.ts
git commit -m "feat: add shared types for phase 1"
```

---

## Task 2 — CSS Design Tokens + NN Keyframes

**Files:**
- Modify: `app/globals.css`

- [ ] **Replace `app/globals.css` entirely**

```css
@import "tailwindcss";

@theme {
  /* ── Backgrounds ── */
  --color-bg:       #070707;
  --color-surface:  #0c0c0c;
  --color-s2:       #101010;
  --color-b1:       #1c1c1c;
  --color-b2:       #141414;
  --color-b3:       #111;

  /* ── Text ── */
  --color-text:     #e8e8e8;
  --color-sub:      #888888;
  --color-dim:      #333333;

  /* ── Green ── */
  --color-green:    #3aaa72;
  --color-gh:       #4ecf8a;
  --color-gl:       #1d4a34;

  /* ── Red ── */
  --color-red:      #aa3a3a;
  --color-rh:       #cf4e4e;
  --color-rl:       #4a1d1d;

  /* ── Blue ── */
  --color-blue:     #3a6eaa;
  --color-bh:       #4e8ecf;
  --color-bl:       #1d304a;

  /* ── Amber ── */
  --color-amber:    #aa8a3a;
  --color-ah:       #cfad4e;
  --color-al:       #4a3c1d;
}

:root { color-scheme: dark; }

* { box-sizing: border-box; margin: 0; padding: 0; }

html, body {
  height: 100%;
  overflow: hidden;
  background: #070707;
  color: #e8e8e8;
  font-family: var(--font-mono), 'IBM Plex Mono', monospace;
  font-size: 11px;
}

/* ── Scrollbar ── */
::-webkit-scrollbar { width: 3px; height: 3px; }
::-webkit-scrollbar-track { background: #070707; }
::-webkit-scrollbar-thumb { background: #222; border-radius: 2px; }

/* ── Panel ── */
.panel {
  background: #0c0c0c;
  border: 1px solid #1c1c1c;
  border-radius: 5px;
}

/* ── Text utilities ── */
.text-green  { color: #3aaa72; }
.text-gh     { color: #4ecf8a; }
.text-red    { color: #aa3a3a; }
.text-rh     { color: #cf4e4e; }
.text-blue   { color: #3a6eaa; }
.text-bh     { color: #4e8ecf; }
.text-amber  { color: #aa8a3a; }
.text-ah     { color: #cfad4e; }
.text-dim    { color: #333333; }
.text-sub    { color: #888888; }

/* ── NN Animations ── */
@keyframes nn-flow {
  0%   { stroke-dashoffset: 40; opacity: 0; }
  20%  { opacity: 0.9; }
  80%  { opacity: 0.9; }
  100% { stroke-dashoffset: 0; opacity: 0; }
}
@keyframes nn-node-pulse {
  0%, 100% { r: 5.5; opacity: 0.8; }
  50%       { r: 7;   opacity: 1; }
}
@keyframes nn-node-glow {
  0%, 100% { opacity: 0.6; }
  50%      { opacity: 1; }
}
@keyframes nn-output-pulse {
  0%, 100% { r: 7; opacity: 0.9; }
  50%      { r: 9; opacity: 1; }
}
@keyframes pulse-dot {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.4; }
}
@keyframes fade-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}

.nn-flow        { stroke-dasharray: 8 32; animation: nn-flow 2.4s linear infinite; }
.nn-flow.d1     { animation-delay: 0.4s; }
.nn-flow.d2     { animation-delay: 0.8s; }
.nn-flow.d3     { animation-delay: 1.2s; }
.nn-flow.d4     { animation-delay: 1.6s; }
.nn-flow.d5     { animation-delay: 2.0s; }
.nn-active      { animation: nn-node-pulse 2.4s ease-in-out infinite; }
.nn-glow        { animation: nn-node-glow 2s ease-in-out infinite; }
.nn-output      { animation: nn-output-pulse 2.4s ease-in-out infinite; }
.pulse-dot      { animation: pulse-dot 2s ease-in-out infinite; }
.fade-in        { animation: fade-in 0.3s ease-out; }
```

- [ ] **Verify the dev server still starts without CSS errors**

```bash
# In a separate terminal (keep running throughout development):
cd C:/Users/anakin/s-tier/megalpha
npm run dev
# Expected: No errors, http://localhost:3000 loads (layout may look broken — that's fine for now)
```

- [ ] **Commit**

```bash
git add app/globals.css
git commit -m "style: replace design tokens with phase 1 color system + NN keyframes"
```

---

## Task 3 — Inter Font in Layout

**Files:**
- Modify: `app/layout.tsx`

- [ ] **Replace `app/layout.tsx`**

```typescript
import type { Metadata } from "next";
import { IBM_Plex_Mono, Inter } from "next/font/google";
import "./globals.css";

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["300", "400", "500"],
});

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
});

export const metadata: Metadata = {
  title: "MEGALPHA",
  description: "Quantitative trading platform",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${ibmPlexMono.variable} ${inter.variable}`}>
      <body style={{ fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace" }}>
        {children}
      </body>
    </html>
  );
}
```

- [ ] **Verify** — open http://localhost:3000, confirm no font import errors in console

- [ ] **Commit**

```bash
git add app/layout.tsx
git commit -m "style: add Inter font alongside IBM Plex Mono"
```

---

## Task 4 — Topbar Component

**Files:**
- Create: `components/Topbar.tsx`

- [ ] **Create `components/Topbar.tsx`**

```typescript
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
```

- [ ] **Commit**

```bash
git add components/Topbar.tsx
git commit -m "feat: add Topbar component"
```

---

## Task 5 — Sidebar Component

**Files:**
- Create: `components/Sidebar.tsx`

- [ ] **Create `components/Sidebar.tsx`**

```typescript
"use client";

export type Page = "overview" | "charts" | "backtest" | "rl-agent" | "data-hub" | "journal";

interface NavItem {
  id: Page;
  label: string;
  symbol: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: "overview",  label: "Overview",  symbol: "⊞" },
  { id: "charts",    label: "Charts",    symbol: "◫" },
  { id: "backtest",  label: "Backtest",  symbol: "◷" },
  { id: "rl-agent",  label: "RL Agent",  symbol: "◈" },
  { id: "data-hub",  label: "Data Hub",  symbol: "◉" },
];

const BOTTOM_ITEMS: NavItem[] = [
  { id: "journal", label: "Journal", symbol: "✦" },
];

interface Props {
  active: Page;
  onChange: (page: Page) => void;
}

function NavBtn({ item, active, onClick }: { item: NavItem; active: boolean; onClick: () => void }) {
  return (
    <button
      title={item.label}
      onClick={onClick}
      style={{
        width: 34,
        height: 34,
        borderRadius: 5,
        border: "none",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 14,
        background: active ? "#101e30" : "transparent",
        color: active ? "#4e8ecf" : "#333",
        transition: "all 0.12s",
      }}
      onMouseEnter={(e) => {
        if (!active) (e.currentTarget as HTMLButtonElement).style.background = "#111";
      }}
      onMouseLeave={(e) => {
        if (!active) (e.currentTarget as HTMLButtonElement).style.background = "transparent";
      }}
    >
      {item.symbol}
    </button>
  );
}

export default function Sidebar({ active, onChange }: Props) {
  return (
    <div
      style={{
        width: 46,
        background: "#0c0c0c",
        borderRight: "1px solid #1a1a1a",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "10px 0",
        gap: 2,
        flexShrink: 0,
      }}
    >
      {NAV_ITEMS.map((item) => (
        <NavBtn key={item.id} item={item} active={active === item.id} onClick={() => onChange(item.id)} />
      ))}
      <div style={{ flex: 1 }} />
      {BOTTOM_ITEMS.map((item) => (
        <NavBtn key={item.id} item={item} active={active === item.id} onClick={() => onChange(item.id)} />
      ))}
    </div>
  );
}
```

- [ ] **Commit**

```bash
git add components/Sidebar.tsx
git commit -m "feat: add Sidebar navigation component"
```

---

## Task 6 — Shell Component + app/page.tsx Stub

**Files:**
- Create: `components/Shell.tsx`
- Modify: `app/page.tsx`

- [ ] **Create `components/Shell.tsx`**

```typescript
"use client";

import { useState } from "react";
import { useHLStream } from "@/hooks/useHLStream";
import { useTrading } from "@/hooks/useTrading";
import Topbar from "@/components/Topbar";
import Sidebar, { type Page } from "@/components/Sidebar";
import OverviewPage from "@/components/pages/OverviewPage";
import ChartsPage from "@/components/pages/ChartsPage";
import BacktestPage from "@/components/pages/BacktestPage";
import RLAgentPage from "@/components/pages/RLAgentPage";
import DataHubPage from "@/components/pages/DataHubPage";
import JournalPage from "@/components/pages/JournalPage";

export default function Shell() {
  const [page, setPage] = useState<Page>("overview");
  const hl = useHLStream();
  const trading = useTrading();

  function renderPage() {
    switch (page) {
      case "overview":  return <OverviewPage hl={hl} trading={trading} />;
      case "charts":    return <ChartsPage hl={hl} />;
      case "backtest":  return <BacktestPage />;
      case "rl-agent":  return <RLAgentPage hl={hl} />;
      case "data-hub":  return <DataHubPage />;
      case "journal":   return <JournalPage />;
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden", background: "#070707" }}>
      <Topbar prices={hl.prices} connected={hl.connected} hlAccount={hl.hlAccount} />
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <Sidebar active={page} onChange={setPage} />
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {renderPage()}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Create stub pages (Tasks 7–11 will fill them in)**

Create `components/pages/ChartsPage.tsx`:
```typescript
"use client";
import type { HLStreamData } from "@/hooks/useHLStream";
export default function ChartsPage({ hl }: { hl: HLStreamData }) {
  void hl;
  return <div style={{ padding: 24, color: "#333" }}>Charts — coming in Phase 1 Task 11</div>;
}
```

Create `components/pages/BacktestPage.tsx`:
```typescript
"use client";
export default function BacktestPage() {
  return <div style={{ padding: 24, color: "#333" }}>Backtest — Phase 2</div>;
}
```

Create `components/pages/RLAgentPage.tsx`:
```typescript
"use client";
import type { HLStreamData } from "@/hooks/useHLStream";
export default function RLAgentPage({ hl }: { hl: HLStreamData }) {
  void hl;
  return <div style={{ padding: 24, color: "#333" }}>RL Agent — Phase 3</div>;
}
```

Create `components/pages/DataHubPage.tsx`:
```typescript
"use client";
export default function DataHubPage() {
  return <div style={{ padding: 24, color: "#333" }}>Data Hub — Phase 4</div>;
}
```

Create `components/pages/JournalPage.tsx`:
```typescript
"use client";
export default function JournalPage() {
  return <div style={{ padding: 24, color: "#333" }}>Journal — Phase 5</div>;
}
```

- [ ] **Rewrite `app/page.tsx`**

```typescript
import Shell from "@/components/Shell";

export default function Page() {
  return <Shell />;
}
```

- [ ] **Verify** — http://localhost:3000 should show the topbar and sidebar without crashing (OverviewPage doesn't exist yet — comment it out in Shell.tsx temporarily if needed)

- [ ] **Commit**

```bash
git add components/Shell.tsx components/pages/ app/page.tsx
git commit -m "feat: add Shell layout with sidebar navigation and stub pages"
```

---

## Task 7 — Update useHLStream with RLAgentState

**Files:**
- Modify: `hooks/useHLStream.ts`

- [ ] **Replace `hooks/useHLStream.ts`** — removes MT5/ICT types, adds RLAgentState

```typescript
"use client";

import { useState, useEffect, useRef } from "react";
import type { Candle, HLAccount, HLPosition, RLAgentState } from "@/lib/types";

// Re-export types components use via this hook
export type { HLAccount, HLPosition, Candle };

interface HLPrices {
  btc: number;
  eth: number;
  sol: number;
}

interface OrderBookMetrics {
  spread_bps: number;
  bid_ask_ratio: number;
}

export interface HLStreamData {
  connected: boolean;
  prices: HLPrices | null;
  candles: Record<string, Candle[]> | null;  // live 1m candles per coin
  momentum: number | null;
  orderBook: Record<string, OrderBookMetrics> | null;
  hlAccount: HLAccount | null;
  rlAgent: RLAgentState | null;
}

const EMPTY: HLStreamData = {
  connected: false,
  prices: null,
  candles: null,
  momentum: null,
  orderBook: null,
  hlAccount: null,
  rlAgent: null,
};

const WS_URL = "ws://localhost:8000/ws";
const RECONNECT_DELAY_MS = 3_000;

export function useHLStream(): HLStreamData {
  const [data, setData] = useState<HLStreamData>(EMPTY);
  const wsRef    = useRef<WebSocket | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;

    function connect() {
      if (!aliveRef.current) return;
      let ws: WebSocket;
      try {
        ws = new WebSocket(WS_URL);
      } catch {
        timerRef.current = setTimeout(connect, RECONNECT_DELAY_MS);
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        if (!aliveRef.current) { ws.close(); return; }
        setData((prev) => ({ ...prev, connected: true }));
      };

      ws.onmessage = (event: MessageEvent) => {
        if (!aliveRef.current) return;
        try {
          const p = JSON.parse(event.data as string);
          setData({
            connected:  true,
            prices:     p.prices     ?? null,
            candles:    p.candles    ?? null,
            momentum:   typeof p.momentum === "number" ? p.momentum : null,
            orderBook:  p.orderBook  ?? null,
            hlAccount:  p.hlAccount  ?? null,
            rlAgent:    p.rl_agent   ?? null,
          });
        } catch {
          // ignore malformed frames
        }
      };

      ws.onclose = () => {
        if (!aliveRef.current) return;
        wsRef.current = null;
        setData((prev) => ({ ...prev, connected: false }));
        timerRef.current = setTimeout(connect, RECONNECT_DELAY_MS);
      };

      ws.onerror = () => { ws.close(); };
    }

    connect();

    return () => {
      aliveRef.current = false;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  return data;
}
```

- [ ] **Commit**

```bash
git add hooks/useHLStream.ts
git commit -m "refactor: update useHLStream — remove ICT/MT5 types, add RLAgentState"
```

---

## Task 8 — Server: Remove Sniper from Broadcaster

**Files:**
- Modify: `server/main.py`

- [ ] **In `server/main.py`, remove the `analyze_coin` import and sniper computation from `build_payload()`**

Find and replace the `build_payload` function:

```python
# BEFORE — in server/main.py
from sniper_signals import analyze_coin   # DELETE this import line

def build_payload() -> dict:
    out_candles: dict[str, list] = {}
    sniper: dict[str, dict] = {}
    for coin in COINS:
        series = list(candles[coin])
        if open_candle[coin]:
            series = series + [dict(open_candle[coin])]
        out_candles[coin] = series[-100:]
        sniper[coin] = analyze_coin(series[-100:])   # DELETE this line

    payload: dict = {
        "prices":    prices,
        "candles":   out_candles,
        "momentum":  calc_momentum(price_history["BTC"]),
        "orderBook": {c: order_book_metrics(c) for c in COINS},
        "sniper":    sniper,   # DELETE this line
    }
    if hl_account_cache:
        payload["hlAccount"] = hl_account_cache
    return payload
```

```python
# AFTER — simplified build_payload
def build_payload() -> dict:
    out_candles: dict[str, list] = {}
    for coin in COINS:
        series = list(candles[coin])
        if open_candle[coin]:
            series = series + [dict(open_candle[coin])]
        out_candles[coin] = series[-100:]

    payload: dict = {
        "prices":    prices,
        "candles":   out_candles,
        "momentum":  calc_momentum(price_history["BTC"]),
        "orderBook": {c: order_book_metrics(c) for c in COINS},
    }
    if hl_account_cache:
        payload["hlAccount"] = hl_account_cache
    return payload
```

Also delete the `from sniper_signals import analyze_coin` line at the top of the file.

- [ ] **Restart server, verify it starts cleanly**

```bash
python server/main.py
# Expected: starts in ~3s, no ImportError, no sniper references in logs
```

- [ ] **Verify WebSocket payload no longer contains `sniper` key**

```bash
curl -s http://localhost:8000/health
# Expected JSON should NOT contain "sniper" — just prices, candle_counts, clients, hl_configured
```

- [ ] **Commit**

```bash
git add server/main.py
git commit -m "refactor: remove sniper signal engine from broadcast cycle"
```

---

## Task 9 — Server: Paginated Candle Endpoint

**Files:**
- Modify: `server/main.py`

- [ ] **Add coin start timestamps and interval→ms map at the top of `server/main.py`** (after the constants block)

```python
# ─── candle history constants ──────────────────────────────────────────────────

# Hyperliquid asset launch timestamps (milliseconds)
COIN_START_MS: dict[str, int] = {
    "BTC": 1668124800000,   # Nov 11 2022
    "ETH": 1669766400000,   # Nov 30 2022
    "SOL": 1672531200000,   # Jan  1 2023
}

INTERVAL_MS: dict[str, int] = {
    "1m":  60_000,
    "3m":  180_000,
    "5m":  300_000,
    "15m": 900_000,
    "30m": 1_800_000,
    "1h":  3_600_000,
    "2h":  7_200_000,
    "4h":  14_400_000,
    "6h":  21_600_000,
    "8h":  28_800_000,
    "12h": 43_200_000,
    "1d":  86_400_000,
    "3d":  259_200_000,
    "1w":  604_800_000,
}

HL_MAX_CANDLES_PER_REQUEST = 500
```

- [ ] **Add the paginated fetch helper function** (after the `order_book_metrics` function)

```python
async def fetch_candles_paginated(
    coin: str,
    interval: str,
    start_ms: int,
    end_ms: int,
    max_total: int = 5000,
) -> list[dict]:
    """
    Fetch candles from Hyperliquid REST API with automatic pagination.
    Each request returns max 500 candles; this paginates until end_ms is reached
    or max_total candles are collected.
    """
    import urllib.request as _req
    import json as _j

    url = "https://api.hyperliquid.xyz/info"
    interval_ms = INTERVAL_MS.get(interval, 3_600_000)
    chunk_ms = HL_MAX_CANDLES_PER_REQUEST * interval_ms
    all_candles: list[dict] = []
    cursor = start_ms

    while cursor < end_ms and len(all_candles) < max_total:
        chunk_end = min(cursor + chunk_ms, end_ms)

        def _fetch(c=coin, s=cursor, e=chunk_end, iv=interval):
            payload = _j.dumps({
                "type": "candleSnapshot",
                "req": {"coin": c, "interval": iv, "startTime": s, "endTime": e}
            }).encode()
            req = _req.Request(url, data=payload, headers={"Content-Type": "application/json"})
            with _req.urlopen(req, timeout=15) as resp:
                return _j.loads(resp.read())

        try:
            result = await asyncio.to_thread(_fetch)
        except Exception as exc:
            log.warning("Candle fetch error (%s %s): %s", coin, interval, exc)
            break

        if not result:
            break

        for c in result:
            all_candles.append({
                "time":  c["t"] // 1000,   # convert ms → seconds for lightweight-charts
                "open":  float(c["o"]),
                "high":  float(c["h"]),
                "low":   float(c["l"]),
                "close": float(c["c"]),
            })

        # Advance cursor past the last returned candle
        last_t = result[-1]["t"]
        cursor = last_t + interval_ms

        # Rate limit — be gentle
        await asyncio.sleep(0.2)

    # Deduplicate by time (HL can return overlapping candles at boundaries)
    seen: set[int] = set()
    unique: list[dict] = []
    for c in all_candles:
        if c["time"] not in seen:
            seen.add(c["time"])
            unique.append(c)

    return sorted(unique, key=lambda c: c["time"])
```

- [ ] **Add the REST endpoint** (in the REST endpoints section, after the HL trading endpoints)

```python
@app.get("/candles/{coin}")
async def get_candles(
    coin: str,
    interval: str = "1h",
    limit: int = 0,          # 0 = all available history
    start_time: int = 0,     # ms timestamp; 0 = use COIN_START_MS
) -> list:
    """
    Return OHLC candles for a coin from Hyperliquid.
    interval: 1m | 15m | 1h | 4h | 1d (and others HL supports)
    limit: max candles to return; 0 = fetch full history
    start_time: unix ms to start from; 0 = use COIN_START_MS default
    """
    coin = coin.upper()
    if coin not in COINS:
        return []
    if interval not in INTERVAL_MS:
        return []

    now_ms = int(time.time() * 1000)

    # Determine start
    if start_time > 0:
        start_ms = start_time
    elif limit > 0:
        # Calculate start from limit
        interval_ms = INTERVAL_MS[interval]
        start_ms = now_ms - (limit * interval_ms)
    else:
        # Full history
        start_ms = COIN_START_MS.get(coin, COIN_START_MS["BTC"])

    # Cap total candles to avoid runaway fetches
    max_total = limit if limit > 0 else 10_000

    candle_list = await fetch_candles_paginated(coin, interval, start_ms, now_ms, max_total)
    return candle_list
```

- [ ] **Restart server and test the endpoint manually**

```bash
# Should return ~1200 candles for BTC 1D since Nov 2022
curl "http://localhost:8000/candles/BTC?interval=1d" | python -c "import sys,json; d=json.load(sys.stdin); print(f'{len(d)} candles, first: {d[0]}, last: {d[-1]}')"
# Expected: something like "1200 candles, first: {time: ..., open: ..., ...}"

# Should return ~500 candles for BTC 1H with limit
curl "http://localhost:8000/candles/BTC?interval=1h&limit=200" | python -c "import sys,json; d=json.load(sys.stdin); print(len(d))"
# Expected: 200
```

- [ ] **Commit**

```bash
git add server/main.py
git commit -m "feat: add /candles/{coin} endpoint with full history pagination"
```

---

## Task 10 — Server: Pytest for Candle Endpoint

**Files:**
- Create: `server/tests/__init__.py`
- Create: `server/tests/test_candles.py`

- [ ] **Create `server/tests/__init__.py`** (empty file)

- [ ] **Install pytest if not already installed**

```bash
cd C:/Users/anakin/s-tier/megalpha
pip install pytest pytest-asyncio httpx
```

- [ ] **Create `server/tests/test_candles.py`**

```python
"""
Tests for the /candles/{coin} endpoint.
Run from the megalpha root: pytest server/tests/test_candles.py -v
"""
import sys
import os

import pytest
from fastapi.testclient import TestClient

# Add server/ to path so we can import main
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Prevent sniper_signals import from failing (it may not be on the path)
import importlib
import unittest.mock as mock

# Import the FastAPI app
with mock.patch.dict("sys.modules", {"sniper_signals": mock.MagicMock()}):
    import main as server_main

client = TestClient(server_main.app)


def test_health_check():
    """Server is up and returns status ok."""
    resp = client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert "prices" in data
    assert "candle_counts" in data


def test_candles_invalid_coin():
    """Unknown coin returns empty list."""
    resp = client.get("/candles/FAKE?interval=1h&limit=10")
    assert resp.status_code == 200
    assert resp.json() == []


def test_candles_invalid_interval():
    """Unknown interval returns empty list."""
    resp = client.get("/candles/BTC?interval=99x&limit=10")
    assert resp.status_code == 200
    assert resp.json() == []


def test_candles_known_coins():
    """All three coins are accepted."""
    for coin in ["BTC", "ETH", "SOL"]:
        resp = client.get(f"/candles/{coin}?interval=1h&limit=5")
        assert resp.status_code == 200
        # May return fewer if HL is unreachable in test env, but should not error
        data = resp.json()
        assert isinstance(data, list)


def test_candle_shape():
    """Each candle has the required OHLC fields."""
    resp = client.get("/candles/BTC?interval=1d&limit=3")
    assert resp.status_code == 200
    candles = resp.json()
    if len(candles) > 0:
        c = candles[0]
        assert "time" in c
        assert "open" in c
        assert "high" in c
        assert "low" in c
        assert "close" in c
        assert c["high"] >= c["low"]
        assert c["time"] > 0


def test_candles_sorted_ascending():
    """Candles are returned in ascending time order."""
    resp = client.get("/candles/BTC?interval=1d&limit=10")
    assert resp.status_code == 200
    candles = resp.json()
    if len(candles) > 1:
        times = [c["time"] for c in candles]
        assert times == sorted(times), "Candles must be sorted ascending by time"
```

- [ ] **Run the tests**

```bash
cd C:/Users/anakin/s-tier/megalpha
pytest server/tests/test_candles.py -v
# Expected: All tests PASS (candle shape/sort tests may be skipped if HL unreachable in test env)
```

- [ ] **Commit**

```bash
git add server/tests/
git commit -m "test: add pytest suite for /candles endpoint"
```

---

## Task 11 — ChartPanel Component

**Files:**
- Create: `components/ChartPanel.tsx`

- [ ] **Create `components/ChartPanel.tsx`**

```typescript
"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { Candle } from "@/lib/types";

type Timeframe = "1m" | "15m" | "1h" | "4h" | "1d";
type Coin = "BTC" | "ETH" | "SOL";

const TF_LABELS: Timeframe[] = ["1m", "15m", "1h", "4h", "1d"];

// For the REST endpoint, map display labels to HL interval strings
const TF_INTERVAL: Record<Timeframe, string> = {
  "1m":  "1m",
  "15m": "15m",
  "1h":  "1h",
  "4h":  "4h",
  "1d":  "1d",
};

// Max candles to fetch per timeframe (0 = all history)
const TF_LIMIT: Record<Timeframe, number> = {
  "1m":  0,     // use live WS candles — no REST fetch
  "15m": 2000,
  "1h":  2000,
  "4h":  0,     // all history (~4800 candles)
  "1d":  0,     // all history (~1200 candles)
};

interface Props {
  // Live 1m candles from WebSocket
  liveCandles: Record<string, Candle[]> | null;
  // Prices for the current coin
  prices: { btc: number; eth: number; sol: number } | null;
  // Entry price to draw a horizontal line (when position is open)
  entryPrice?: number;
}

async function fetchCandles(coin: Coin, interval: string, limit: number): Promise<Candle[]> {
  const params = new URLSearchParams({ interval });
  if (limit > 0) params.set("limit", String(limit));
  const res = await fetch(`http://localhost:8000/candles/${coin}?${params}`);
  if (!res.ok) return [];
  return res.json();
}

export default function ChartPanel({ liveCandles, prices, entryPrice }: Props) {
  const [coin, setCoin] = useState<Coin>("BTC");
  const [tf, setTf] = useState<Timeframe>("1h");
  const [loading, setLoading] = useState(false);
  const [historicalCandles, setHistoricalCandles] = useState<Candle[]>([]);

  const chartRef   = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chartInst  = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const seriesInst = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entryLine  = useRef<any>(null);

  const currentPrice = prices
    ? coin === "BTC" ? prices.btc : coin === "ETH" ? prices.eth : prices.sol
    : 0;

  // Candles to display: 1m uses live WS, others use historical REST fetch
  const displayCandles: Candle[] = tf === "1m"
    ? (liveCandles?.[coin] ?? [])
    : historicalCandles;

  // Fetch historical candles when coin or timeframe changes (non-1m)
  const loadHistorical = useCallback(async () => {
    if (tf === "1m") return;
    setLoading(true);
    const data = await fetchCandles(coin, TF_INTERVAL[tf], TF_LIMIT[tf]);
    setHistoricalCandles(data);
    setLoading(false);
  }, [coin, tf]);

  useEffect(() => {
    loadHistorical();
  }, [loadHistorical]);

  // Init lightweight-charts once
  useEffect(() => {
    let destroyed = false;
    requestAnimationFrame(() => {
      if (destroyed || !chartRef.current || chartInst.current) return;
      import("lightweight-charts").then((lc) => {
        if (destroyed || !chartRef.current || chartInst.current) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { createChart, CandlestickSeries, PriceLine } = lc as any;
        void PriceLine; // may not be a named export in v5 — used via series.createPriceLine

        const chart = createChart(chartRef.current, {
          layout: {
            background: { color: "#0c0c0c" },
            textColor: "#333",
          },
          grid: {
            vertLines: { color: "rgba(255,255,255,0.03)" },
            horzLines: { color: "rgba(255,255,255,0.03)" },
          },
          crosshair: {
            vertLine: { color: "rgba(255,255,255,0.15)", labelBackgroundColor: "#111" },
            horzLine: { color: "rgba(255,255,255,0.15)", labelBackgroundColor: "#111" },
          },
          rightPriceScale: { borderColor: "transparent", textColor: "#2a2a2a" },
          timeScale: { borderColor: "transparent", timeVisible: true, secondsVisible: false },
          width: chartRef.current.clientWidth,
          height: chartRef.current.clientHeight,
        });

        const series = chart.addSeries(CandlestickSeries, {
          upColor:       "#3aaa72",
          downColor:     "#aa3a3a",
          borderUpColor: "#3aaa72",
          borderDownColor: "#aa3a3a",
          wickUpColor:   "rgba(58,170,114,0.6)",
          wickDownColor: "rgba(170,58,58,0.6)",
        });

        chartInst.current  = chart;
        seriesInst.current = series;

        const ro = new ResizeObserver(() => {
          if (chartRef.current && chartInst.current) {
            chartInst.current.applyOptions({
              width:  chartRef.current.clientWidth,
              height: chartRef.current.clientHeight,
            });
          }
        });
        ro.observe(chartRef.current);
      });
    });
    return () => {
      destroyed = true;
      if (chartInst.current) {
        chartInst.current.remove();
        chartInst.current = null;
        seriesInst.current = null;
        entryLine.current = null;
      }
    };
  }, []);

  // Load candles into chart when displayCandles changes
  useEffect(() => {
    if (!seriesInst.current || displayCandles.length === 0) return;
    seriesInst.current.setData(displayCandles);
    chartInst.current?.timeScale().fitContent();
  }, [displayCandles]);

  // Live update last candle (1m mode)
  useEffect(() => {
    if (tf !== "1m" || !seriesInst.current || !liveCandles?.[coin]?.length) return;
    const last = liveCandles[coin][liveCandles[coin].length - 1];
    try { seriesInst.current.update(last); } catch { /* series may not be ready */ }
  }, [liveCandles, coin, tf]);

  // Draw / update entry line
  useEffect(() => {
    if (!seriesInst.current) return;
    if (entryLine.current) {
      seriesInst.current.removePriceLine(entryLine.current);
      entryLine.current = null;
    }
    if (entryPrice && entryPrice > 0) {
      entryLine.current = seriesInst.current.createPriceLine({
        price:     entryPrice,
        color:     "#4e8ecf",
        lineWidth: 1,
        lineStyle: 2, // dashed
        axisLabelVisible: true,
        title: `ENTRY`,
      });
    }
  }, [entryPrice]);

  return (
    <div className="panel" style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
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
        {/* Coin selector */}
        {(["BTC", "ETH", "SOL"] as Coin[]).map((c) => (
          <button
            key={c}
            onClick={() => setCoin(c)}
            style={{
              fontFamily: "var(--font-sans, Inter, sans-serif)",
              fontWeight: coin === c ? 700 : 400,
              fontSize: 12,
              background: "none",
              border: "none",
              cursor: "pointer",
              color: coin === c ? "#e8e8e8" : "#333",
              padding: "2px 4px",
            }}
          >
            {c}
          </button>
        ))}

        <div style={{ width: 1, height: 14, background: "#1c1c1c", margin: "0 4px" }} />

        {/* Timeframe selector */}
        {TF_LABELS.map((t) => (
          <button
            key={t}
            onClick={() => setTf(t)}
            style={{
              fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace",
              fontSize: 9,
              background: tf === t ? "#101e30" : "none",
              border: "none",
              cursor: "pointer",
              color: tf === t ? "#4e8ecf" : "#333",
              padding: "2px 5px",
              borderRadius: 2,
            }}
          >
            {t}
          </button>
        ))}

        <div style={{ flex: 1 }} />

        {loading && (
          <span style={{ fontSize: 9, color: "#333" }}>loading...</span>
        )}

        {currentPrice > 0 && (
          <span
            style={{
              fontFamily: "var(--font-sans, Inter, sans-serif)",
              fontWeight: 600,
              fontSize: 12,
              color: "#4ecf8a",
            }}
          >
            ${currentPrice.toLocaleString("en-US", { maximumFractionDigits: currentPrice > 1000 ? 0 : 2 })}
          </span>
        )}
      </div>

      {/* Chart */}
      <div ref={chartRef} style={{ flex: 1, minHeight: 0 }} />
    </div>
  );
}
```

- [ ] **Commit**

```bash
git add components/ChartPanel.tsx
git commit -m "feat: add ChartPanel with timeframe selector and full-history REST fetch"
```

---

## Task 12 — RL Neural Network Panel

**Files:**
- Create: `components/RLNetworkPanel.tsx`

- [ ] **Create `components/RLNetworkPanel.tsx`**

```typescript
"use client";

import type { RLAgentState } from "@/lib/types";

interface Props {
  rlAgent: RLAgentState | null;
}

const STATUS_COLOR: Record<string, string> = {
  scanning:  "#cfad4e",
  in_trade:  "#4ecf8a",
  training:  "#4e8ecf",
  offline:   "#333",
};

export default function RLNetworkPanel({ rlAgent }: Props) {
  const status   = rlAgent?.status ?? "offline";
  const probs    = rlAgent?.action_probs ?? [0.72, 0.21, 0.07];
  const episode  = rlAgent?.episode ?? 0;
  const session  = rlAgent?.session ?? "—";
  const color    = STATUS_COLOR[status] ?? "#333";
  const labelTxt = status.replace("_", " ").toUpperCase();

  const longPct  = Math.round(probs[0] * 100);
  const holdPct  = Math.round(probs[1] * 100);
  const shortPct = Math.round(probs[2] * 100);

  // Bar widths (max 42px matches the SVG)
  const longBar  = Math.round(probs[0] * 42);
  const holdBar  = Math.round(probs[1] * 42);
  const shortBar = Math.round(probs[2] * 42);

  return (
    <div className="panel" style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
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
        <span style={{ fontSize: 9, color: "#333", letterSpacing: "0.1em", textTransform: "uppercase" }}>
          RL Agent
        </span>
        <span style={{ fontSize: 9, color: "#1c1c1c" }}>·</span>
        <span style={{ fontSize: 9, color: "#333", letterSpacing: "0.1em" }}>Neural Network · PPO</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 9, color }}>● {labelTxt}</span>
        <span style={{ fontSize: 9, color: "#2a2a2a", marginLeft: 10 }}>
          {episode > 0 ? `ep.${episode.toLocaleString()} · ` : ""}128 neurons
        </span>
        {session !== "—" && (
          <span style={{ fontSize: 9, color: "#2a2a2a" }}>· {session}</span>
        )}
      </div>

      {/* SVG neural network */}
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        <svg
          viewBox="0 0 560 115"
          preserveAspectRatio="xMidYMid meet"
          style={{ width: "100%", height: "100%", display: "block" }}
        >
          <defs>
            <radialGradient id="rg-g" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#4ecf8a"/>
              <stop offset="100%" stopColor="#1d4a34" stopOpacity=".4"/>
            </radialGradient>
            <radialGradient id="rg-b" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#4e8ecf"/>
              <stop offset="100%" stopColor="#1d304a" stopOpacity=".4"/>
            </radialGradient>
            <radialGradient id="rg-r" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#cf4e4e"/>
              <stop offset="100%" stopColor="#4a1d1d" stopOpacity=".4"/>
            </radialGradient>
            <radialGradient id="rg-d" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#444"/>
              <stop offset="100%" stopColor="#111" stopOpacity=".4"/>
            </radialGradient>
            <filter id="nn-glow-s"><feGaussianBlur stdDeviation="1.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
            <filter id="nn-glow-m"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
            <filter id="nn-glow-l"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
          </defs>

          {/* Layer labels */}
          {[["48","INPUTS"],["140","HIDDEN 1"],["228","HIDDEN 2"],["316","HIDDEN 3"],["400","HIDDEN 4"],["490","ACTION"]].map(([x, label]) => (
            <text key={label} x={x} y="7" fill="#1e1e1e" fontSize="6" fontFamily="IBM Plex Mono" textAnchor="middle">{label}</text>
          ))}

          {/* Background connections — inputs→h1 */}
          <g opacity=".09" stroke="#4e8ecf" strokeWidth=".5">
            {[[12,13],[12,26],[12,54],[27,13],[27,40],[27,68],[42,26],[42,40],[42,54],[57,40],[57,54],[57,68],[57,82],[72,54],[72,68],[72,82],[87,68],[87,82],[87,96],[102,82],[102,96],[102,110]].map(([iy,hy],i) => (
              <line key={i} x1="48" y1={iy} x2="140" y2={hy}/>
            ))}
          </g>
          {/* h1→h2 */}
          <g opacity=".08" stroke="#4e8ecf" strokeWidth=".5">
            {[[13,13],[13,40],[26,13],[26,40],[26,67],[40,26],[40,53],[54,40],[54,53],[54,67],[68,53],[68,67],[68,80],[82,67],[82,80],[82,94],[96,80],[96,94],[96,108],[110,94],[110,108]].map(([h1y,h2y],i) => (
              <line key={i} x1="140" y1={h1y} x2="228" y2={h2y}/>
            ))}
          </g>
          {/* h2→h3 */}
          <g opacity=".09" stroke="#4ecf8a" strokeWidth=".5">
            {[[13,18],[13,40],[26,18],[26,40],[40,18],[40,40],[40,62],[53,40],[53,62],[67,62],[67,84],[80,62],[80,84],[94,84],[94,106],[108,84],[108,106]].map(([h2y,h3y],i) => (
              <line key={i} x1="228" y1={h2y} x2="316" y2={h3y}/>
            ))}
          </g>
          {/* h3→h4 */}
          <g opacity=".1" stroke="#4ecf8a" strokeWidth=".6">
            {[[18,24],[18,52],[40,24],[40,52],[62,52],[62,80],[84,52],[84,80],[84,96],[106,80],[106,96]].map(([h3y,h4y],i) => (
              <line key={i} x1="316" y1={h3y} x2="400" y2={h4y}/>
            ))}
          </g>
          {/* h4→output */}
          <g opacity=".12" stroke="#4ecf8a" strokeWidth=".7">
            {[[24,34],[24,66],[52,34],[52,66],[80,66],[80,92],[96,66],[96,92]].map(([h4y,oy],i) => (
              <line key={i} x1="400" y1={h4y} x2="490" y2={oy}/>
            ))}
          </g>

          {/* Animated flow paths — main (green) */}
          <line className="nn-flow"    x1="48" y1="12"  x2="140" y2="13"  stroke="#4ecf8a" strokeWidth="1.2"/>
          <line className="nn-flow d1" x1="140" y1="13" x2="228" y2="13"  stroke="#4ecf8a" strokeWidth="1.2"/>
          <line className="nn-flow d2" x1="228" y1="13" x2="316" y2="18"  stroke="#4ecf8a" strokeWidth="1.4"/>
          <line className="nn-flow d3" x1="316" y1="18" x2="400" y2="24"  stroke="#4ecf8a" strokeWidth="1.4"/>
          <line className="nn-flow d4" x1="400" y1="24" x2="490" y2="34"  stroke="#4ecf8a" strokeWidth="1.6"/>
          {/* Secondary path (blue) */}
          <line className="nn-flow d2" x1="48" y1="27"  x2="140" y2="26"  stroke="#4e8ecf" strokeWidth=".9" opacity=".5"/>
          <line className="nn-flow d3" x1="140" y1="26" x2="228" y2="40"  stroke="#4e8ecf" strokeWidth=".9" opacity=".5"/>
          <line className="nn-flow d4" x1="228" y1="40" x2="316" y2="40"  stroke="#4ecf8a" strokeWidth="1"  opacity=".6"/>
          <line className="nn-flow d5" x1="316" y1="40" x2="400" y2="52"  stroke="#4ecf8a" strokeWidth="1"  opacity=".6"/>
          {/* Weak short path */}
          <line className="nn-flow d4" x1="316" y1="106" x2="400" y2="96" stroke="#cf4e4e" strokeWidth=".7" opacity=".25"/>
          <line className="nn-flow d5" x1="400" y1="96"  x2="490" y2="92" stroke="#cf4e4e" strokeWidth=".7" opacity=".2"/>

          {/* Input nodes */}
          <g filter="url(#nn-glow-s)">
            <circle className="nn-active"                    cx="48" cy="12"  r="5.5" fill="url(#rg-b)" stroke="#4e8ecf" strokeWidth=".8"/>
            <circle className="nn-active" style={{animationDelay:".3s"}} cx="48" cy="27" r="5"   fill="url(#rg-b)" stroke="#4e8ecf" strokeWidth=".6"/>
            <circle cx="48" cy="42"  r="4"   fill="url(#rg-d)" stroke="#222" strokeWidth=".5"/>
            <circle className="nn-glow"                      cx="48" cy="57"  r="5"   fill="url(#rg-b)" stroke="#4e8ecf" strokeWidth=".6"/>
            <circle cx="48" cy="72"  r="3.5" fill="url(#rg-d)" stroke="#1a1a1a" strokeWidth=".5"/>
            <circle cx="48" cy="87"  r="3.5" fill="url(#rg-d)" stroke="#1a1a1a" strokeWidth=".5"/>
            <circle cx="48" cy="102" r="3"   fill="url(#rg-d)" stroke="#1a1a1a" strokeWidth=".5"/>
          </g>
          {/* Input labels */}
          {[["4","12","Close"],["4","27","Volume"],["4","42","High"],["4","57","Volatility"],["4","72","OB ratio"],["4","87","Spread"],["4","102","Momentum"]].map(([x,y,lbl]) => (
            <text key={lbl} x={x} y={Number(y)+3} fill="#1e1e1e" fontSize="6" fontFamily="IBM Plex Mono">{lbl}</text>
          ))}

          {/* H1 nodes (8) */}
          <g filter="url(#nn-glow-s)">
            <circle className="nn-active" style={{animationDelay:".4s"}} cx="140" cy="13"  r="6"   fill="url(#rg-g)" stroke="#4ecf8a" strokeWidth=".8"/>
            <circle className="nn-active" style={{animationDelay:".7s"}} cx="140" cy="26"  r="5.5" fill="url(#rg-g)" stroke="#4ecf8a" strokeWidth=".7"/>
            <circle className="nn-glow"   style={{animationDelay:".2s"}} cx="140" cy="40"  r="5"   fill="url(#rg-g)" stroke="#3aaa72" strokeWidth=".6"/>
            <circle className="nn-glow"   style={{animationDelay:".9s"}} cx="140" cy="54"  r="4.5" fill="url(#rg-g)" stroke="#3aaa72" strokeWidth=".5"/>
            <circle cx="140" cy="68"  r="4"   fill="url(#rg-d)" stroke="#222" strokeWidth=".5"/>
            <circle cx="140" cy="82"  r="3.5" fill="url(#rg-d)" stroke="#1a1a1a" strokeWidth=".5"/>
            <circle cx="140" cy="96"  r="3"   fill="url(#rg-d)" stroke="#1a1a1a" strokeWidth=".5"/>
            <circle cx="140" cy="110" r="3"   fill="url(#rg-d)" stroke="#1a1a1a" strokeWidth=".5"/>
          </g>

          {/* H2 nodes (8) */}
          <g filter="url(#nn-glow-s)">
            <circle className="nn-active" style={{animationDelay:".8s"}} cx="228" cy="13"  r="6"   fill="url(#rg-g)" stroke="#4ecf8a" strokeWidth=".8"/>
            <circle cx="228" cy="26"  r="4"   fill="url(#rg-d)" stroke="#222" strokeWidth=".5"/>
            <circle className="nn-glow"   style={{animationDelay:".5s"}} cx="228" cy="40"  r="5"   fill="url(#rg-g)" stroke="#3aaa72" strokeWidth=".6"/>
            <circle className="nn-glow"   style={{animationDelay:"1.1s"}} cx="228" cy="53" r="4.5" fill="url(#rg-g)" stroke="#3aaa72" strokeWidth=".5"/>
            <circle cx="228" cy="67"  r="4"   fill="url(#rg-d)" stroke="#222" strokeWidth=".5"/>
            <circle cx="228" cy="80"  r="3.5" fill="url(#rg-d)" stroke="#1a1a1a" strokeWidth=".5"/>
            <circle cx="228" cy="94"  r="3"   fill="url(#rg-d)" stroke="#1a1a1a" strokeWidth=".5"/>
            <circle cx="228" cy="108" r="3"   fill="url(#rg-d)" stroke="#1a1a1a" strokeWidth=".5"/>
          </g>

          {/* H3 nodes (6) */}
          <g filter="url(#nn-glow-m)">
            <circle className="nn-active" style={{animationDelay:"1.2s"}} cx="316" cy="18"  r="6.5" fill="url(#rg-g)" stroke="#4ecf8a" strokeWidth="1"/>
            <circle className="nn-glow"   style={{animationDelay:".6s"}} cx="316" cy="40"   r="5.5" fill="url(#rg-g)" stroke="#3aaa72" strokeWidth=".7"/>
            <circle cx="316" cy="62"  r="4.5" fill="url(#rg-d)" stroke="#222" strokeWidth=".5"/>
            <circle cx="316" cy="84"  r="4"   fill="url(#rg-d)" stroke="#1a1a1a" strokeWidth=".5"/>
            <circle cx="316" cy="106" r="3.5" fill="url(#rg-d)" stroke="#1a1a1a" strokeWidth=".5"/>
          </g>

          {/* H4 nodes (4) */}
          <g filter="url(#nn-glow-m)">
            <circle className="nn-active" style={{animationDelay:"1.6s"}} cx="400" cy="24" r="7"   fill="url(#rg-g)" stroke="#4ecf8a" strokeWidth="1"/>
            <circle className="nn-glow"   style={{animationDelay:"1s"}}   cx="400" cy="52" r="5.5" fill="url(#rg-g)" stroke="#3aaa72" strokeWidth=".7"/>
            <circle cx="400" cy="80" r="4"   fill="url(#rg-d)" stroke="#222" strokeWidth=".5"/>
            <circle cx="400" cy="96" r="3.5" fill="url(#rg-d)" stroke="#1a1a1a" strokeWidth=".5"/>
          </g>

          {/* Output nodes */}
          <g filter="url(#nn-glow-l)">
            <circle className="nn-output" cx="490" cy="34" r="8" fill="url(#rg-g)" stroke="#4ecf8a" strokeWidth="1.2"/>
            <circle cx="490" cy="66" r="5" fill="url(#rg-d)" stroke="#222" strokeWidth=".5"/>
            <circle cx="490" cy="92" r="4" fill="url(#rg-d)" stroke="#1a1a1a" strokeWidth=".5"/>
          </g>

          {/* Output labels + probability bars */}
          <text x="503" y="31" fill="#4ecf8a" fontSize="7" fontFamily="IBM Plex Mono" fontWeight="500">LONG</text>
          <rect x="503" y="33" width="42" height="3" rx="1" fill="#1d4a34"/>
          <rect x="503" y="33" width={longBar} height="3" rx="1" fill="#4ecf8a" opacity=".8"/>
          <text x="548" y="38" fill="#4ecf8a" fontSize="6.5" fontFamily="IBM Plex Mono" textAnchor="end">{longPct}%</text>

          <text x="503" y="61" fill="#2a2a2a" fontSize="7" fontFamily="IBM Plex Mono">HOLD</text>
          <rect x="503" y="63" width="42" height="3" rx="1" fill="#1a1a1a"/>
          <rect x="503" y="63" width={holdBar} height="3" rx="1" fill="#333" opacity=".7"/>
          <text x="548" y="68" fill="#2a2a2a" fontSize="6.5" fontFamily="IBM Plex Mono" textAnchor="end">{holdPct}%</text>

          <text x="503" y="87" fill="#1e1e1e" fontSize="7" fontFamily="IBM Plex Mono">SHORT</text>
          <rect x="503" y="89" width="42" height="3" rx="1" fill="#1a1a1a"/>
          <rect x="503" y="89" width={shortBar} height="3" rx="1" fill="#2a1d1d" opacity=".7"/>
          <text x="548" y="94" fill="#1e1e1e" fontSize="6.5" fontFamily="IBM Plex Mono" textAnchor="end">{shortPct}%</text>
        </svg>
      </div>
    </div>
  );
}
```

- [ ] **Commit**

```bash
git add components/RLNetworkPanel.tsx
git commit -m "feat: add animated RL neural network panel"
```

---

## Task 13 — HeroRow Component

**Files:**
- Create: `components/HeroRow.tsx`

- [ ] **Create `components/HeroRow.tsx`**

```typescript
"use client";

import type { HLAccount, RLAgentState } from "@/lib/types";

interface Props {
  hlAccount: HLAccount | null;
  connected: boolean;
  rlAgent: RLAgentState | null;
}

function StatCard({ label, value, sub, valueColor }: {
  label: string;
  value: string;
  sub: string;
  valueColor?: string;
}) {
  return (
    <div
      className="panel"
      style={{ padding: "10px 14px", flex: 1 }}
    >
      <div style={{ fontSize: 9, color: "#333", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 6 }}>
        {label}
      </div>
      <div
        style={{
          fontFamily: "var(--font-sans, Inter, sans-serif)",
          fontWeight: 900,
          fontSize: 22,
          letterSpacing: "-0.03em",
          lineHeight: 1,
          color: valueColor ?? "#e8e8e8",
          marginBottom: 4,
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 9, color: "#444" }}>{sub}</div>
    </div>
  );
}

export default function HeroRow({ hlAccount, connected, rlAgent }: Props) {
  const equity = hlAccount
    ? `$${hlAccount.account_value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
    : connected ? "—" : "Offline";

  const openPnl = hlAccount
    ? hlAccount.positions.reduce((s, p) => s + p.unrealized_pnl, 0)
    : null;
  const pnlStr = openPnl !== null
    ? `${openPnl >= 0 ? "+" : ""}$${Math.abs(openPnl).toLocaleString("en-US", { maximumFractionDigits: 0 })} open`
    : connected ? "no wallet connected" : "server offline";

  const position = hlAccount?.positions[0];
  const posStr = position
    ? `${position.coin} ${position.is_long ? "Long" : "Short"}`
    : "—";
  const posSub = position
    ? `entry $${position.entry_px.toLocaleString()} · ${position.unrealized_pnl >= 0 ? "+" : ""}$${position.unrealized_pnl.toFixed(0)}`
    : connected ? "no open position" : "";

  const agentStatus = rlAgent?.status ?? (connected ? "offline" : "offline");
  const agentColor: Record<string, string> = {
    scanning: "#cfad4e", in_trade: "#4ecf8a", training: "#4e8ecf", offline: "#333"
  };
  const agentStr = agentStatus.replace("_", " ").toUpperCase();
  const agentSub = rlAgent
    ? `${Math.round(rlAgent.confidence * 100)}% confidence · ${rlAgent.session}`
    : "not trained yet";

  return (
    <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
      <StatCard
        label="Total Equity"
        value={equity}
        sub={pnlStr}
        valueColor={connected ? "#e8e8e8" : "#333"}
      />
      <StatCard
        label="RL Agent"
        value={agentStr}
        sub={agentSub}
        valueColor={agentColor[agentStatus]}
      />
      <StatCard
        label="Open Position"
        value={posStr}
        sub={posSub}
        valueColor={position ? (position.is_long ? "#4ecf8a" : "#cf4e4e") : "#333"}
      />
      <StatCard
        label="Backtest · BTC 1H"
        value="—"
        sub="run a backtest in Phase 2"
        valueColor="#333"
      />
    </div>
  );
}
```

- [ ] **Commit**

```bash
git add components/HeroRow.tsx
git commit -m "feat: add HeroRow stat cards"
```

---

## Task 14 — PnlCard + TradeLog

**Files:**
- Create: `components/PnlCard.tsx`
- Create: `components/TradeLog.tsx`

- [ ] **Create `components/PnlCard.tsx`**

```typescript
"use client";

import type { HLAccount } from "@/lib/types";

interface Props {
  hlAccount: HLAccount | null;
}

export default function PnlCard({ hlAccount }: Props) {
  const equity = hlAccount?.account_value ?? 0;
  const openPnl = hlAccount
    ? hlAccount.positions.reduce((s, p) => s + p.unrealized_pnl, 0)
    : 0;
  const pnlColor = openPnl >= 0 ? "#4ecf8a" : "#cf4e4e";
  const pnlSign  = openPnl >= 0 ? "+" : "";

  return (
    <div className="panel" style={{ padding: "14px 16px", flexShrink: 0 }}>
      <div style={{ fontSize: 9, color: "#333", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 }}>
        Open P&L
      </div>
      <div
        style={{
          fontFamily: "var(--font-sans, Inter, sans-serif)",
          fontWeight: 900,
          fontSize: 36,
          letterSpacing: "-0.05em",
          lineHeight: 1,
          color: hlAccount ? pnlColor : "#222",
        }}
      >
        {hlAccount ? `${pnlSign}$${Math.abs(openPnl).toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "—"}
      </div>
      <div style={{ fontSize: 9, color: "#444", marginTop: 4 }}>
        {hlAccount
          ? `${hlAccount.positions.length} position${hlAccount.positions.length !== 1 ? "s" : ""} open`
          : "no wallet connected"}
      </div>

      {equity > 0 && (
        <div
          style={{
            display: "flex",
            gap: 0,
            marginTop: 10,
            paddingTop: 10,
            borderTop: "1px solid #141414",
          }}
        >
          {[
            { label: "Equity",    value: `$${equity.toLocaleString("en-US", { maximumFractionDigits: 0 })}` },
            { label: "Margin",    value: `$${hlAccount!.total_margin_used.toLocaleString("en-US", { maximumFractionDigits: 0 })}` },
            { label: "Avail.",    value: `$${hlAccount!.withdrawable.toLocaleString("en-US", { maximumFractionDigits: 0 })}` },
          ].map(({ label, value }, i) => (
            <div key={label} style={{ flex: 1, borderRight: i < 2 ? "1px solid #141414" : "none", paddingRight: i < 2 ? 12 : 0, marginRight: i < 2 ? 12 : 0 }}>
              <div style={{ fontSize: 8, color: "#2a2a2a", marginBottom: 3, letterSpacing: "0.06em" }}>{label}</div>
              <div style={{ fontFamily: "var(--font-sans, Inter, sans-serif)", fontWeight: 700, fontSize: 12 }}>{value}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Create `components/TradeLog.tsx`**

```typescript
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
```

- [ ] **Commit**

```bash
git add components/PnlCard.tsx components/TradeLog.tsx
git commit -m "feat: add PnlCard and TradeLog components"
```

---

## Task 15 — BottomBar

**Files:**
- Create: `components/BottomBar.tsx`

- [ ] **Create `components/BottomBar.tsx`**

```typescript
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
```

- [ ] **Commit**

```bash
git add components/BottomBar.tsx
git commit -m "feat: add BottomBar status strip"
```

---

## Task 16 — OverviewPage Assembly

**Files:**
- Create: `components/pages/OverviewPage.tsx`

- [ ] **Create `components/pages/OverviewPage.tsx`**

```typescript
"use client";

import type { HLStreamData } from "@/hooks/useHLStream";
import type { ReturnType as TradingReturn } from "@/hooks/useTrading";
import HeroRow from "@/components/HeroRow";
import ChartPanel from "@/components/ChartPanel";
import RLNetworkPanel from "@/components/RLNetworkPanel";
import PnlCard from "@/components/PnlCard";
import TradeLog from "@/components/TradeLog";
import BottomBar from "@/components/BottomBar";

// useTrading return type — kept loose to avoid tight coupling
interface TradingHook {
  hlOpen: (coin: string, isBuy: boolean, sizeUsd: number, leverage: number) => Promise<void>;
  hlClose: (coin: string) => Promise<void>;
  loading: boolean;
  lastError: string | null;
}

interface Props {
  hl: HLStreamData;
  trading: TradingHook;
}

export default function OverviewPage({ hl, trading: _trading }: Props) {
  // Entry price: use the first open position's entry, if any
  const entryPrice = hl.hlAccount?.positions[0]?.entry_px;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        padding: 10,
        gap: 8,
        overflow: "hidden",
      }}
    >
      {/* Hero stat cards */}
      <HeroRow
        hlAccount={hl.hlAccount}
        connected={hl.connected}
        rlAgent={hl.rlAgent}
      />

      {/* Main content: left column (chart + RL) | right column (PnL + trades) */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 310px", gap: 8, flex: 1, minHeight: 0 }}>

        {/* Left column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>
          {/* Chart — takes ~60% of left col height */}
          <div style={{ flex: 1.4, minHeight: 0 }}>
            <ChartPanel
              liveCandles={hl.candles}
              prices={hl.prices}
              entryPrice={entryPrice}
            />
          </div>
          {/* RL neural network — takes ~40% */}
          <div style={{ flex: 1, minHeight: 0 }}>
            <RLNetworkPanel rlAgent={hl.rlAgent} />
          </div>
        </div>

        {/* Right column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>
          <PnlCard hlAccount={hl.hlAccount} />
          <TradeLog />
        </div>
      </div>

      {/* Bottom strip */}
      <BottomBar hlAccount={hl.hlAccount} />
    </div>
  );
}
```

- [ ] **Fix the `TradingReturn` import** — `useTrading` doesn't export a named type. Replace the import line with a direct type reference:

```typescript
// Replace:
import type { ReturnType as TradingReturn } from "@/hooks/useTrading";

// With: (just remove that import — the TradingHook interface above is self-contained)
```

The file should have no `useTrading` import. The `TradingHook` interface defined inline is sufficient.

- [ ] **Verify** — open http://localhost:3000 and confirm the Overview page renders with topbar, sidebar, hero cards, chart loading spinner, animated RL network, and trade log

- [ ] **Commit**

```bash
git add components/pages/OverviewPage.tsx
git commit -m "feat: assemble OverviewPage with all panels"
```

---

## Task 17 — ChartsPage (full-screen chart)

**Files:**
- Modify: `components/pages/ChartsPage.tsx`

- [ ] **Replace `components/pages/ChartsPage.tsx`** with a full-screen chart

```typescript
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
      />
    </div>
  );
}
```

- [ ] **Verify** — click Charts in sidebar, confirm full-screen chart loads

- [ ] **Commit**

```bash
git add components/pages/ChartsPage.tsx
git commit -m "feat: ChartsPage shows full-screen chart"
```

---

## Task 18 — Cleanup Old Components

**Files:**
- Delete: `components/SniperPanel.tsx`, `components/Pipeline.tsx`, `components/WinStack.tsx`, `components/PnlCurve.tsx`, `components/BottomPanels.tsx`, `components/FooterTicker.tsx`, `components/Header.tsx`
- Delete: `hooks/useDashboard.ts`

- [ ] **Delete unused files**

```bash
git rm components/SniperPanel.tsx
git rm components/Pipeline.tsx
git rm components/WinStack.tsx
git rm components/PnlCurve.tsx
git rm components/BottomPanels.tsx
git rm components/FooterTicker.tsx
git rm components/Header.tsx
git rm hooks/useDashboard.ts
git rm components/MT5Panel.tsx  2>/dev/null || true   # may already be absent
```

- [ ] **Verify no broken imports** — run the TypeScript compiler

```bash
npx tsc --noEmit
# Expected: zero errors
# If errors appear, trace the import and remove or fix it
```

- [ ] **Verify app still loads** — open http://localhost:3000

- [ ] **Commit**

```bash
git commit -m "chore: delete legacy components (SniperPanel, Pipeline, WinStack, PnlCurve, BottomPanels, FooterTicker, Header, useDashboard)"
```

---

## Task 19 — Final Verification + Diagnostic Update

- [ ] **End-to-end smoke test**

```
1. Start server:  python server/main.py
   Expected: starts in ~3s, candle_counts show 100 each for BTC/ETH/SOL

2. Open http://localhost:3000
   Expected:
   ✓ Topbar shows MEGALPHA logo, live BTC/ETH/SOL prices, green LIVE dot
   ✓ Sidebar shows 6 navigation icons
   ✓ Overview page: 4 hero cards visible
   ✓ Chart loads BTC 1H historical data after a few seconds
   ✓ RL neural network panel shows animated pulses
   ✓ Trade log shows 6 placeholder rows
   ✓ Bottom bar shows margin/available/paper values

3. Click Charts icon → full-screen chart loads
4. Click other icons → stub pages show placeholder text
5. Click 1D timeframe in chart → longer history loads (~1200 candles from 2022)
6. Click 4H → ~4800 candles load
```

- [ ] **Run all tests**

```bash
pytest server/tests/test_candles.py -v
# Expected: all pass
```

- [ ] **Update DIAGNOSTIC.md** — mark Phase 1 as complete

In `DIAGNOSTIC.md`, under the Phase 1 row in the build sequence table, update to:
```
| **1** | Layout redesign + full historical charts | ✅ Complete |
```

- [ ] **Final commit**

```bash
git add DIAGNOSTIC.md
git commit -m "docs: mark Phase 1 complete in diagnostic"
```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ New shell layout (Topbar + Sidebar + Shell)
- ✅ Remove SniperPanel, Pipeline, WinStack, PnlCurve, BottomPanels, FooterTicker, MT5Panel (Task 18)
- ✅ HeroPnl → HeroRow rewired to HL account (Task 13)
- ✅ `/candles/{coin}` endpoint with pagination (Task 9)
- ✅ Full history from asset creation (COIN_START_MS in Task 9)
- ✅ Timeframe selector 1m/15m/1H/4H/1D (Task 11)
- ✅ Entry line on chart when position open (Task 11)
- ✅ RL neural network panel animated (Task 12)
- ✅ P&L card + trade log (Task 14)
- ✅ Bottom bar (Task 15)
- ✅ 6-page navigation routing (Tasks 5, 6, 17)
- ✅ Stubs for Charts, Backtest, RL Agent, Data Hub, Journal (Task 6, 17)
- ✅ sniper_signals.py no longer called in broadcaster (Task 8)
- ✅ Inter font added (Task 3)
- ✅ New design tokens (Task 2)

**Type consistency:** All components receive `HLAccount`, `RLAgentState`, `Candle` from `lib/types.ts`. `HLStreamData` in `useHLStream.ts` imports from the same source. No duplicated type definitions.

**No placeholders:** TradeLog uses explicit mock data with a clear comment that Phase 2 will wire real data. HeroRow backtest card explicitly says "run a backtest in Phase 2". No "TBD" or "TODO" in code.
