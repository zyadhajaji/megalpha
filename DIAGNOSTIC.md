# MEGALPHA — Project Diagnostic
**Last updated:** May 28, 2026  
**Project path:** `C:\Users\anakin\s-tier\megalpha`  
**Stack:** Next.js 16 · React 19 · TypeScript · Tailwind CSS v4 · IBM Plex Mono + Inter · FastAPI · Python 3.12 · Hyperliquid WebSocket + REST API

---

## 1. WHAT MEGALPHA IS

MEGALPHA is a **professional quantitative trading platform** built around a locally-trained reinforcement learning agent that trades Hyperliquid perpetual futures (BTC, ETH, SOL).

The platform has 5 phases, each building on the last:

| Phase | What | Status |
|---|---|---|
| **1** | Layout redesign + full historical charts | ✅ **Complete** |
| **2** | Backtest engine | 🔲 Next |
| **3** | RL agent (PPO, local, no API cost) | 🔲 Planned |
| **4** | Data hub (funding, OI, liquidations, news) | 🔲 Planned |
| **5** | Journal (Notion-style, SQLite) | 🔲 Planned |

---

## 2. CURRENT STATE (May 28, 2026)

### What is running right now

```
localhost:3000   Next.js dashboard (Phase 1 UI complete)
localhost:8000   Python bridge server
  prices:        BTC $73,406 · ETH $2,018 · SOL $82.34   (live from HL WS)
  candles:       120 per coin                              (pre-loaded + live)
  hl_configured: true                                      (private key in .env)
```

### What works

| Feature | Status |
|---|---|
| Live BTC/ETH/SOL prices from Hyperliquid WS | ✅ |
| 1m candle builder (real trades → OHLC) | ✅ |
| 120 candles pre-loaded on server startup | ✅ |
| Full-history candle fetch via `/candles/{coin}` (Nov 2022 → now) | ✅ |
| Hyperliquid private key loaded — live account data available | ✅ |
| Shell layout: Topbar + Sidebar + 6-page navigation | ✅ |
| Overview page: HeroRow · ChartPanel · RLNetworkPanel · PnlCard · TradeLog · BottomBar | ✅ |
| ChartPanel: 5 timeframes (1m/15m/1h/4h/1d), coin selector, entry price line | ✅ |
| RLNetworkPanel: animated SVG neural net, LONG/HOLD/SHORT probability bars | ✅ (display only — no real inference yet) |
| ChartsPage: full-screen chart with coin + timeframe selector | ✅ |
| Backtest · RL Agent · Data Hub · Journal pages | 🔲 Stub only |
| Pytest suite: 6/6 tests passing | ✅ |
| Zero TypeScript errors | ✅ |

### What is NOT built yet

| Feature | Phase |
|---|---|
| Backtest engine — run strategy on historical data | Phase 2 |
| Paper trading with auto-execution | Phase 2 |
| RL agent training (PPO, stable-baselines3, PyTorch) | Phase 3 |
| Live RL inference in broadcast loop | Phase 3 |
| Funding rate / OI / liquidation data | Phase 4 |
| News feed | Phase 4 |
| Journal (Notion-style rich text, SQLite) | Phase 5 |

---

## 3. ARCHITECTURE

```
┌──────────────────────────────────────────────────────────────┐
│                        YOUR MACHINE                           │
│                                                               │
│  ┌─────────────────────────┐    ┌──────────────────────────┐ │
│  │  Python Bridge           │    │  Next.js Dashboard        │ │
│  │  server/main.py          │◄───│  localhost:3000           │ │
│  │  localhost:8000          │    │                           │ │
│  │                          │    │  Topbar (logo + prices)   │ │
│  │  • HL WS listener        │    │  Sidebar (6 pages)        │ │
│  │  • 1m candle builder     │    │  Overview:                │ │
│  │  • WS broadcaster 500ms  │    │   ├ HeroRow (4 cards)     │ │
│  │  • /candles/{coin} REST  │    │   ├ ChartPanel (full TF)  │ │
│  │  • HL trade endpoints    │    │   ├ RLNetworkPanel (anim) │ │
│  │  • Account poller 5s     │    │   ├ PnlCard + TradeLog    │ │
│  └──────────┬───────────────┘    │   └ BottomBar             │ │
│             │                    │  Charts (full-screen)      │ │
│             │                    │  Backtest / RL / Hub / ... │ │
│             │                    └──────────────────────────┘ │
└─────────────┼────────────────────────────────────────────────┘
              │
              ▼
    ┌──────────────────────┐
    │   Hyperliquid L1     │
    │                      │
    │  WS: prices + trades │
    │  REST: candles       │
    │  REST: place orders  │
    └──────────────────────┘
```

**Data flow:**
1. Hyperliquid WS → bridge server (prices + trades, ~50ms cadence)
2. Bridge server builds 1m OHLC candles in real-time
3. Bridge broadcasts full payload to dashboard WebSocket at 500ms
4. Dashboard hooks (useHLStream) parse and distribute to all components
5. ChartPanel fetches historical candles from `/candles/{coin}` on timeframe switch
6. Live trading: user/agent → POST `/trade/hl/open` → bridge signs + submits to HL

---

## 4. FILE MAP

### Bridge server (`server/`)

| File | Purpose |
|---|---|
| `main.py` | FastAPI app — WS listener, broadcaster, `/candles/{coin}` endpoint, HL trade REST |
| `hl_trader.py` | Hyperliquid trading module (market open/close/cancel) |
| `sniper_signals.py` | Old ICT/SMC engine — kept on disk, NOT called from main.py |
| `tests/test_candles.py` | 6 pytest tests for candle endpoint |
| `.env` | `HL_PRIVATE_KEY` (configured) |

### Frontend (`app/`, `components/`, `hooks/`, `lib/`)

| File | Purpose |
|---|---|
| `lib/types.ts` | Single source of truth: Candle, HLAccount, HLPosition, Trade, RLAgentState |
| `hooks/useHLStream.ts` | WebSocket client — connects to bridge, streams all live data |
| `hooks/useTrading.ts` | REST wrapper for HL trade endpoints |
| `app/layout.tsx` | IBM Plex Mono (`--font-mono`) + Inter (`--font-sans`) |
| `app/globals.css` | Design tokens + NN animation keyframes |
| `app/page.tsx` | Renders `<Shell />` |
| `components/Shell.tsx` | Topbar + Sidebar + page switcher |
| `components/Topbar.tsx` | Logo, prices, LIVE/OFFLINE dot, clock |
| `components/Sidebar.tsx` | 6-icon navigation |
| `components/ChartPanel.tsx` | Candlestick chart, 5 TFs, REST fetch for history |
| `components/RLNetworkPanel.tsx` | Animated SVG neural network, probability bars |
| `components/HeroRow.tsx` | 4 stat cards (equity, RL status, position, backtest) |
| `components/PnlCard.tsx` | Open P&L, equity/margin/available |
| `components/TradeLog.tsx` | Trade list (mock data — Phase 2 wires real data) |
| `components/BottomBar.tsx` | Margin · available · paper balance |
| `components/pages/OverviewPage.tsx` | Assembles all Overview panels |
| `components/pages/ChartsPage.tsx` | Full-screen ChartPanel |
| `components/pages/BacktestPage.tsx` | Stub — Phase 2 |
| `components/pages/RLAgentPage.tsx` | Stub — Phase 3 |
| `components/pages/DataHubPage.tsx` | Stub — Phase 4 |
| `components/pages/JournalPage.tsx` | Stub — Phase 5 |

---

## 5. DESIGN SYSTEM

| Token | Value | Use |
|---|---|---|
| Background | `#070707` | Page background |
| Surface | `#0c0c0c` | Panels, topbar, sidebar |
| Border | `#1c1c1c` | Panel edges |
| Text | `#e8e8e8` | Primary text |
| Sub | `#888888` | Secondary labels |
| Dim | `#333333` | Muted / disabled |
| Green | `#3aaa72` / `#4ecf8a` | Profit, LONG, connected |
| Red | `#aa3a3a` / `#cf4e4e` | Loss, SHORT, error |
| Blue | `#3a6eaa` / `#4e8ecf` | Agent, selected nav, entry line |
| Amber | `#aa8a3a` / `#cfad4e` | Scanning, warnings |

**Fonts:** IBM Plex Mono (`--font-mono`) for all labels/data · Inter (`--font-sans`) for large bold numbers  
**Philosophy:** No neon, no fake animations — every element shows real data or a clear "not built yet" placeholder

---

## 6. NEXT STEPS — PHASE 2: BACKTEST ENGINE

Phase 2 turns the historical candle data (already flowing via the `/candles/{coin}` endpoint) into a backtest engine. This is the prerequisite for training the RL agent in Phase 3 — the agent needs labeled training data (what happened after each state) that only a backtest can produce.

### 2a. Server: `server/backtest.py`

A pure-Python sliding-window backtester:

```python
def run_backtest(
    candles: list[dict],     # full history (4H or 1D recommended)
    starting_balance: float, # e.g. 10_000
    size_usd: float,         # margin per trade, e.g. 200
    leverage: int,           # e.g. 5
    strategy: str,           # "momentum" | "breakout" | "mean_reversion"
) -> dict:
    # slide a window, apply strategy, simulate fills at open of next candle
    # track equity curve, all trades, drawdown
    # return: trades list + {win_rate, profit_factor, max_drawdown, sharpe, net_pnl}
```

**Phase 2 strategies to implement (simple, no ICT):**
- `momentum` — buy when RSI > 55 and price above 20 EMA, sell when RSI < 45
- `breakout` — buy on break of 20-candle high, exit at 2× ATR TP or 1× ATR SL

### 2b. Server: `/backtest` REST endpoint

```python
@app.post("/backtest")
async def run_backtest_endpoint(req: BacktestRequest) -> dict:
    # 1. Fetch full history from /candles/{coin}?interval=1h
    # 2. Run backtest engine
    # 3. Return trades + stats
```

### 2c. Frontend: `BacktestPage.tsx`

Replace the stub with a real panel:
- Controls: coin · interval · date range · starting balance · position size · leverage · strategy
- Run button → POST `/backtest` → loading state
- Results: equity curve (lightweight-charts line) + trade log + summary stats

### 2d. TradeLog: replace mock data

`components/TradeLog.tsx` currently shows 6 hardcoded rows. Phase 2 wires it to real completed paper trades from a `/paper/history` endpoint.

### 2e. HeroRow backtest card

The 4th hero card currently shows "— run a backtest in Phase 2". After Phase 2 it shows the latest backtest result: strategy · coin · timeframe · net P&L · win rate.

---

## 7. NEXT STEPS — PHASE 3: RL AGENT

Phase 3 trains a PPO agent on the backtest data and runs live inference in the broadcast loop.

### Dependencies
- Phase 2 backtest must be done first — the backtest produces the labeled episodes (state → action → reward) used for training
- Python packages: `stable-baselines3`, `torch`, `gymnasium`

### Architecture

```
server/
  train_rl.py       # Custom Gym env + PPO training loop
  rl_policy.pkl     # Saved policy after training (gitignored)
  main.py           # Loads policy on startup, runs inference every broadcast
```

**Gym environment:**
- **State** (7 features per candle): close, volume, high, volatility (ATR), order book bid/ask ratio, spread_bps, momentum
- **Actions**: 0 = HOLD · 1 = LONG · 2 = SHORT
- **Reward**: realized P&L of the position (risk-adjusted)
- **Episode**: one trading session (London or NY open)

**Training:**
```bash
python server/train_rl.py --coin BTC --interval 1h --episodes 2000
# runs on CPU — expect 30–60 min for 2000 episodes on BTC 1H history
```

**Live inference** (in `broadcaster()`):
```python
if rl_policy:
    obs = build_observation(candles["BTC"][-1], order_book_metrics("BTC"))
    action, _ = rl_policy.predict(obs, deterministic=True)
    probs = rl_policy.policy.get_distribution(obs).distribution.probs
    rl_state = {"status": "scanning", "action_probs": probs.tolist(), ...}
```

The `RLNetworkPanel` already receives and displays `rlAgent` data — it will show real probabilities the moment inference is wired up.

---

## 8. NEXT STEPS — PHASE 4: DATA HUB

Real quantitative edge comes from context the price chart alone doesn't show.

### What to add

| Data | Source | Update cadence |
|---|---|---|
| Funding rate (current + 8h predicted) | HL REST `/info` → `{"type": "meta"}` | Every 5 min |
| Open Interest (BTC/ETH/SOL) | HL REST `/info` → `{"type": "openInterest"}` | Every 1 min |
| Liquidation heatmap | HL REST `/info` → `{"type": "liquidations"}` | Every 30s |
| Perp vs spot basis | HL WS allMids vs spot price | Live |
| News feed | CoinGecko free API or Cryptopanic RSS | Every 10 min |

### Frontend: `DataHubPage.tsx`

Replace the stub with a grid of live data cards — funding rate gauge, OI chart (lightweight-charts), recent liquidations, news ticker.

---

## 9. NEXT STEPS — PHASE 5: JOURNAL

A Notion-style personal trading journal with SQLite persistence. No AI required initially.

### Stack
- Rich text editor: **Tiptap** (MIT, works inside Next.js, no backend required)
- Storage: **SQLite** via `better-sqlite3` (Node.js) or a simple REST endpoint in the Python bridge
- Structure: entries have date, tags (e.g. "BTC", "review", "mistake"), body (rich text JSON), linked trade IDs

### Frontend: `JournalPage.tsx`

- Left rail: list of journal entries (date + first line)
- Right: Tiptap editor — bold, italic, headers, code blocks, checklists
- "+ New Entry" creates a blank entry with today's date pre-filled
- Tags system: filter by coin, session, outcome

---

## 10. KNOWN ISSUES / THINGS TO WATCH

| Issue | Severity | Notes |
|---|---|---|
| `on_event("startup")` deprecation in FastAPI | Low | Use `lifespan` handler in a future cleanup pass |
| `PriceChip` in Topbar uses a fixed fake `prevPrice` (coin × 0.988) | Medium | Should track previous price in state for accurate % change — Phase 2 fix |
| TradeLog shows hardcoded mock data | Medium | Phase 2 wires to real `/paper/history` |
| RL Network Panel shows hardcoded `[0.72, 0.21, 0.07]` probs when rlAgent is null | Low | Intended — makes the panel look live even before Phase 3. Replace in Phase 3. |
| `sniper_signals.py` still on disk | Info | Not called anywhere. Can be deleted or repurposed for Phase 2 strategy code. |
| `mt5_bridge.py` still on disk | Info | Dead code. Can be deleted. |
| `.superpowers/` brainstorm files committed | Info | Should be in `.gitignore` |

---

*Diagnostic updated May 28, 2026 — Phase 1 complete, Phase 2 ready to begin*
