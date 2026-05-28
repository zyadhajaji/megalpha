# MEGALPHA Platform Design
**Date:** 2026-05-27  
**Status:** Approved

---

## 1. Vision

MEGALPHA is evolving from a signal dashboard into a full quantitative trading platform. The core loop: a reinforcement learning agent trained on raw Hyperliquid price data scans markets 24/7, makes trading decisions, and the dashboard makes every decision visible and explainable.

The platform has five sub-projects built in sequence:

| Phase | Sub-project | Unlocks |
|---|---|---|
| 1 | Layout redesign + full historical charts | Foundation for everything |
| 2 | Backtest engine | Historical validation + RL training data |
| 3 | RL trading agent (PPO, local) | Autonomous trading |
| 4 | Data hub (HL native data + news) | Market context |
| 5 | Journal (Notion-style, no AI yet) | Personal log |

---

## 2. Layout

### Design system (unchanged)
- **Background:** `#070707`
- **Surface:** `#0c0c0c`, border `#1c1c1c`
- **Fonts:** Inter (numbers, headers) + IBM Plex Mono (labels, data, code)
- **Colors:** Green `#3aaa72` / `#4ecf8a`, Red `#aa3a3a` / `#cf4e4e`, Blue `#3a6eaa` / `#4e8ecf`, Amber `#aa8a3a` / `#cfad4e`
- **Philosophy:** No neon, no scanlines. High information density. Large impactful numbers for key metrics.

### Shell structure
```
┌─ topbar (36px) ─────────────────────────────────────────┐
│ MEGALPHA | BTC 107,420 +1.2% | ETH ... | SOL ...  LIVE  │
├─ nav ─┬─ main content ─────────────────────────────────┤
│  ⊞    │  hero row (4 stat cards)                        │
│  ◫    │─────────────────────────────────────────────────│
│  ◷    │  chart panel (left 70%)  │  PnL card (right)    │
│  ◈    │─────────────────────────│  trade log            │
│  ◉    │  RL neural net panel     │                      │
│       │  (left 70%)             │                      │
│  ✦    │─────────────────────────────────────────────────│
│       │  bottom bar (margin, available, paper balance)  │
└───────┴─────────────────────────────────────────────────┘
```

### Navigation pages (sidebar icons)
| Icon | Page | Content |
|---|---|---|
| ⊞ | Overview | Hero stats, chart, RL network, trade log |
| ◫ | Charts | Full-screen chart with all timeframes |
| ◷ | Backtest | Controls, equity curve, trade table |
| ◈ | RL Agent | Training stats, episode history, policy metrics |
| ◉ | Data Hub | Hyperliquid native data + news feed |
| ✦ | Journal | Notion-style rich text editor |

### Hero row (always visible on Overview)
Four stat cards across the top:
1. **Total Equity** — large Inter 900 number, open P&L sub-label
2. **RL Agent** — current state (SCANNING / IN TRADE / TRAINING), confidence %, session
3. **Open Position** — coin, direction, entry, unrealized P&L
4. **Backtest summary** — win rate %, profit factor, timeframe, date range

### Chart panel
- Coin selector (BTC / ETH / SOL)
- Timeframe buttons: 1m · 15m · 1H · 4H · 1D
- Live price tag pinned to current candle
- Entry line (dashed blue) when position is open
- RL agent trade markers on chart (entry/exit arrows, no ICT overlays)
- **Full history from asset creation** — see section 3

**Note:** ICT/SMC signal overlays are removed from the chart. The `SniperPanel` component is removed from the dashboard. `sniper_signals.py` stays in the server (kept for potential future use) but is no longer called in the broadcast cycle.

### RL Neural Network panel
- 7 inputs → 8 → 8 → 6 → 4 → 3 outputs (PPO policy network)
- CSS-animated pulses traveling along hot activation paths
- Node brightness = activation strength
- Output layer: LONG / HOLD / SHORT with probability bars
- Header: episode count, current state indicator

### Right column
- **P&L card** — today's P&L in large Inter 900, breakdown for 7d / 30d / all time
- **Trade log** — scrollable, every trade with coin, direction, agent reasoning snippet, P&L, time

### Bottom bar
Margin used · Available · Paper balance · Exchange label

---

## 3. Full Historical Chart Data

**Requirement:** Charts must show data from the creation of each asset on Hyperliquid, not just recent candles.

**Hyperliquid launch dates:**
- BTC: Nov 2022
- ETH/SOL: Dec 2022 – Jan 2023

**Candle counts by timeframe (from Jan 2023 to present):**
| Timeframe | Candles | Fetch strategy |
|---|---|---|
| 1D | ~1,200 | Single request |
| 4H | ~4,800 | 2–3 paginated requests |
| 1H | ~29,000 | ~60 paginated requests |
| 15m | ~116,000 | too many for chart; limit to 2,000 (20 days) |
| 1m | ~1.7M | use only for live signal engine, not chart |

**New endpoint:** `GET /candles/{coin}?interval=1h&limit=500&start_time=<ms>`

The endpoint paginates automatically: if `limit > 500`, it makes multiple sequential requests to Hyperliquid REST, concatenates, and returns the full series. The frontend requests all available candles on timeframe change.

**Frontend:** On timeframe change, fetch from `/candles/{coin}?interval=X` (no explicit limit — server returns everything available). Chart re-renders. 1D and 4H fetch full history on every load; 1H and below fetch the last 2,000 candles by default with a "load more" mechanism.

---

## 4. Backtest Engine (Phase 2)

**Purpose:** Run any strategy on full Hyperliquid historical data. Validate signal quality before paper trading. Generate the dataset the RL agent trains on.

**Architecture:**
- `server/backtest.py` — sliding window simulation, pluggable strategy function
- `POST /backtest` endpoint — accepts coin, interval, date range, strategy params
- `components/BacktestPanel.tsx` — controls, equity curve, trade table, summary stats

**Output metrics:** Win rate, profit factor, net P&L, max drawdown, avg win/loss, total trades, Sharpe ratio.

---

## 5. RL Trading Agent (Phase 3)

**Model:** PPO (Proximal Policy Optimization) via `stable-baselines3` + PyTorch. Runs entirely locally — no API calls, no credits.

**State space (raw market data only — no ICT signals):**
- Last N candles of OHLCV (N=60 by default)
- Order book bid/ask ratio and spread
- Current position state (flat / long / short, size, unrealized P&L)
- Session indicator (London / NY / Asia / off-hours)

**Action space:** Discrete — LONG, SHORT, HOLD (with position sizing as a separate head, or fixed % of balance per trade)

**Reward function:** Risk-adjusted P&L — reward profitable trades, penalize drawdown, penalize overtrading (too many trades in a session).

**Training:** On historical Hyperliquid OHLCV data fetched by the backtest infrastructure. Training script (`server/train_rl.py`) runs offline; trained policy saved to `server/models/policy.zip`.

**Inference:** Policy loaded at server startup. Every 500ms broadcast cycle, `rl_agent.predict(state)` returns action + probability distribution → broadcast in payload as `rl_agent` field.

**Dashboard integration:** Neural network panel shows live activations. Trade log shows "agent reasoning" = dominant input feature contributing to the decision (computed via gradient saliency or simpler input attribution).

---

## 6. Data Hub (Phase 4)

**Hyperliquid native data:**
- Funding rates (8h) per coin
- Open interest history
- Liquidation events (large liquidations as market context)
- Top trader positions

**News:** Free crypto news RSS feeds (CryptoPanic API free tier or direct RSS from CoinDesk/Decrypt).

---

## 7. Journal (Phase 5)

**Notion-style rich text editor.** No AI at this stage.

**Tech:** Tiptap (headless rich text framework for React, free, well-maintained). Persists entries to SQLite via `server/db.py`. Entries are date-stamped; sidebar shows recent entries.

---

## 8. Build Sequence

Each phase has its own spec → plan → implementation cycle. This document covers the full platform vision. Implementation starts with **Phase 1: Layout redesign + full historical charts**.

Phase 1 deliverables:
1. New shell layout (topbar, sidebar nav, hero row, main grid, bottom bar) replacing the current single-scroll page
2. Remove: `SniperPanel`, `Pipeline`, `WinStack`, `PnlCurve`, `BottomPanels`, `FooterTicker`, `MT5Panel`
3. Keep and rewire: `HeroPnl` → hero stat cards, `StatsTicker` → topbar prices, `TradingPanel` → keep for manual trades
4. `/candles/{coin}` endpoint with automatic pagination + full history from asset creation
5. Chart component: timeframe selector (1m/15m/1H/4H/1D), full-history fetch, RL trade entry/exit markers
6. RL neural network panel (static animated visualization; real PPO inference wired in Phase 3)
7. P&L card and trade log wired to real HL account data and paper trading history
8. Sidebar navigation routing: full Overview page; stub pages for Charts, Backtest, RL Agent, Data Hub, Journal
