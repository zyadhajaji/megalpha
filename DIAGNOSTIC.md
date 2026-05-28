# MEGALPHA — Project Diagnostic
**Date:** May 27, 2026  
**Project path:** `C:\Users\anakin\s-tier\megalpha`  
**Stack:** Next.js 15 (frontend) + FastAPI + Python (bridge server) + Hyperliquid WebSocket API

---

## 1. MAIN GOALS

The MEGALPHA project is a **quantitative crypto trading dashboard and signal engine** built for algorithmic trading on Hyperliquid — a decentralized perpetuals exchange (DEX). The vision is a professional terminal that:

1. **Streams live market data** — real-time prices, candles, and order book for BTC, ETH, and SOL directly from Hyperliquid's WebSocket feed
2. **Generates ICT/SMC trading signals** — implements the "From Zero to Sniper" methodology (FU Candles, Orderblocks, Fair Value Gaps, Liquidity Levels, Market Structure analysis) from the user's trading ebook into a programmatic signal engine
3. **Executes trades automatically** — uses the Hyperliquid API to open and close perpetual futures positions based on signal engine output
4. **Displays everything on a clean dashboard** — an authentic, non-flashy terminal-style UI that is easy to read and understand
5. **Runs 24/7 unattended** — the bridge server connects to Hyperliquid, processes signals every cycle, and can be deployed on a Linux VPS for continuous operation

---

## 2. WHAT WAS BUILT

### A. Bridge Server (`server/`)

| File | Purpose |
|------|---------|
| `server/main.py` | FastAPI app — WebSocket broadcaster, Hyperliquid WS listener, REST trading endpoints, historical candle pre-loader |
| `server/sniper_signals.py` | Full ICT/SMC signal engine — detects FU candles, orderblocks, FVGs, liquidity levels, market structure, computes Sniper Score |
| `server/hl_trader.py` | Hyperliquid trading module — market open/close/cancel via the HL Python SDK |
| `server/.env` | Credentials file — HL private key (when set), formerly MT5 credentials |

**Bridge server does:**
- Connects to `wss://api.hyperliquid.xyz/ws` and subscribes to `allMids`, `trades`, and `l2Book` for BTC/ETH/SOL
- Builds 1-minute OHLC candles in real-time from the trade feed
- Pre-loads 100 candles of real historical data from Hyperliquid REST API on every startup
- Runs the ICT signal engine on every broadcast cycle (every 500ms)
- Broadcasts the full payload (prices + candles + order book + sniper signals) to the Next.js dashboard via WebSocket at `ws://localhost:8000/ws`
- Exposes REST endpoints: `POST /trade/hl/open`, `POST /trade/hl/close`, `GET /account/hl`, `GET /health`

### B. ICT/SMC Signal Engine (`server/sniper_signals.py`)

Built entirely from the user's "From Zero to Sniper" ebook. Detects:

- **FU Candles (Fake-Out / Liquidity Sweep)** — wick sweeps a key level then closes back through it, entry at 50% of the wick
- **Orderblocks** — last opposing candle before a strong institutional move; zone = body only (open to close)
- **Fair Value Gaps (FVG / Imbalances)** — 3-candle pattern where candle 1's high < candle 3's low (bullish) or vice versa
- **Liquidity Levels** — swing highs/lows (2 candles each side), equal highs/lows (within 0.05% tolerance)
- **Market Structure** — BULLISH / BEARISH / RANGING / EXPANDING bias + Break of Structure (BoS) detection
- **Sniper Score** — composite 0–100 score from 8-point checklist: trend alignment (+15), FU candle present (+25), price at orderblock (+20), FVG present (+15), liquidity target visible (+15), BoS confirmed (+10)
- **Active Signal** — when score is high enough: entry price, stop loss (wick extreme), TP at 1:5 RR minimum

### C. Next.js Dashboard (`app/`, `components/`, `hooks/`)

| Component | What it shows |
|-----------|---------------|
| `Header` | Logo, server connection status (LIVE/OFFLINE), live clock |
| `HeroPnl` | Account value, open P&L, margin used (real HL data) — or a "wallet not connected" guide |
| `StatsTicker` | Live BTC/ETH/SOL prices in plain English, connection status |
| `LiveSpotFeed` | Full 100-candle chart, current price, market strength gauge |
| `SniperPanel` | Coin selector (BTC/ETH/SOL), Sniper Score, active signal (entry/SL/TP), tabs for signals/levels/structure |
| `TradingPanel` | Order form — coin, long/short, size in USD, leverage slider, executes via HL API |
| `Pipeline` | Visual 6-step algo cycle (Scan → Predict → Validate → Size → Fill → Settle) |
| `WinStack` | Daily win/loss bar chart |
| `PnlCurve` | Cumulative P&L curve over time |
| `BottomPanels` | Monthly stats, active trade tracker |
| `FooterTicker` | Scrolling price ticker at the bottom |

**Hooks:**
- `useHLStream` — WebSocket client that connects to `ws://localhost:8000/ws`, parses all incoming data, handles reconnection automatically every 3 seconds
- `useTrading` — Wraps REST calls to `/trade/hl/open` and `/trade/hl/close`
- `useDashboard` — Manages pipeline simulation and mock fallback state

### D. Design System

- **Font:** IBM Plex Mono (replaced Orbitron — too cyberpunk)
- **Background:** `#0c0c0c` (near-black)
- **Panels:** `#111111` with `#1c1c1c` borders
- **Colors:** Muted green `#4a9e6e`, muted red `#a85555`, amber `#9c8040`, blue `#4a7aaa`
- **Philosophy:** No neon, no glows, no scanlines, no animations that distract — clean terminal aesthetic

---

## 3. ISSUES ENCOUNTERED AND HOW THEY WERE HANDLED

### Issue 1 — MT5 blocking the entire server on startup
**Problem:** `MetaTrader5.initialize()` was being called at Python module-import time, synchronously, before uvicorn's event loop could start. This call blocks the main thread for the full IPC timeout duration (up to 10 seconds). The result: the server started, logged "Application startup complete", but couldn't respond to any HTTP or WebSocket request until MT5 gave up trying.

**Fix:** Moved MT5Bridge construction out of module-level and into an `asyncio.create_task(_init_mt5())` inside the startup handler. Used `asyncio.to_thread()` so the blocking IPC call runs in a thread pool, not on the event loop. Also added `timeout=1000` to `mt5.initialize()` to fail fast.

**Status:** ✅ Fixed (and then MT5 was removed entirely — see Issue 5)

---

### Issue 2 — Port 8000 conflicts from stale processes
**Problem:** Background server processes launched during debugging were not properly killed. Multiple Python processes held port 8000 simultaneously. New server instances failed with `[WinError 10048] only one usage of each socket address`.

**Fix:** PowerShell script to enumerate PIDs on port 8000 via `netstat -ano` and `Stop-Process` them before each server restart.

**Status:** ✅ Fixed

---

### Issue 3 — MT5 account expired
**Problem:** The original demo account (11108421 on MetaQuotes-Demo) had expired. The terminal could not authorize.

**Fix:** User created a new VTMarkets-Demo account. Credentials updated in `server/.env`.

**Status:** ✅ Fixed (then MT5 dropped entirely)

---

### Issue 4 — MT5 connecting to wrong server
**Problem:** Even with new credentials (1105513 on VTMarkets-Demo), the MT5 terminal was still trying to authorize on MetaQuotes-Demo (the old server). The terminal's saved session pointed to the old server. Python's `mt5.initialize()` was returning error `-6 Authorization failed` because the terminal couldn't reach VTMarkets-Demo — it was still dialing MetaQuotes-Demo.

**Root cause discovered via screenshot:** MT5 terminal journal showed: `'1105513': authorization on MetaQuotes-Demo failed (Invalid account)` — proving the terminal hadn't switched servers.

**Fix attempted:** Asked user to manually log into VTMarkets-Demo via MT5 File → Login to Trade Account.

**Status:** Partially resolved — superseded by the decision to drop MT5 entirely.

---

### Issue 5 — MT5 is not the right tool for this project
**Problem:** After diagnosing the full MT5 integration (Windows-only Python API, IPC-based connection, Algo Trading toggle, `common.ini` settings, `Api=0` blocking the Python API, account/server mismatch), it became clear that MT5 adds enormous complexity for zero trading benefit. The signal engine runs on Hyperliquid data. The real trades happen on Hyperliquid. MT5 was only used for paper trading on a demo account — redundant and unreliable.

**Decision:** Removed MT5 entirely from the architecture.

**What was cleaned up:**
- `server/main.py` — removed all MT5 initialization, account polling, REST endpoints (`/trade/mt5/open`, `/trade/mt5/close`, `/account/mt5`)
- `hooks/useHLStream.ts` — removed `MT5Account`, `MT5Position` interfaces and `mt5Account` state
- `hooks/useTrading.ts` — removed `mt5Open`, `mt5Close` actions
- `app/page.tsx` — removed `MT5Panel` import and usage
- `server/.env` — MT5 credentials left in file but no longer read

**Status:** ✅ Fully removed. Server startup is now instant (no IPC blocking).

---

### Issue 6 — Dashboard showing fake data ($600,000 balance)
**Problem:** `useDashboard.ts` was initialized with `realizedPnl: 652582` — a hardcoded fake balance. A `setInterval` running every 100ms was adding ~$12 to it continuously, making it look like the algo was printing money when in reality nothing was connected. The user (and anyone looking at the dashboard) would see a fake "$654,308 profit" number that had no relationship to any real account.

**Fix:**
- Rewrote `HeroPnl.tsx` with three clear states:
  1. **Server offline** — clear message to start the server
  2. **Server running, no wallet** — "Wallet not connected" with 3-step instructions to add private key
  3. **Wallet connected** — real account value, real open P&L, real margin from Hyperliquid
- Rewrote `StatsTicker.tsx` to show real live prices (Bitcoin/Ethereum/Solana) in plain English labels, not fake trade statistics

**Status:** ✅ Fixed

---

### Issue 7 — Charts completely empty on startup
**Problem:** The server started with `candle_counts: {BTC: 0, ETH: 0, SOL: 0}`. The candle builder only fills up as live trades come in — one trade per second means one data point per second, and a full 1-minute candle takes 60 seconds to close. The chart would be visually empty for minutes after startup.

**Fix:** Added `fetch_historical_candles()` async task that runs at server startup. It calls the Hyperliquid REST API (`POST https://api.hyperliquid.xyz/info` with `{"type": "candleSnapshot"}`) to fetch 100 real 1-minute candles per coin from the last 2 hours. Added a 500ms delay between each coin request to respect rate limits.

**Result:** Server now starts with 100 real candles per coin immediately:
```
candle_counts: {BTC: 100, ETH: 100, SOL: 100}
```

**Status:** ✅ Fixed

---

### Issue 8 — Dashboard UI labels were confusing jargon
**Problem:** The dashboard used terminology that was incomprehensible to anyone not already familiar with quant trading: "REALIZED P&L", "WIN STREAK", "EXECUTION PIPELINE", "MOMENTUM", "SITARA", "Kelly · cap", etc. Numbers like "$4,402/sec" and "85% WIN RATE" were fabricated and meaningless.

**Fix:**
- `StatsTicker` now shows "Bitcoin (BTC)", "Ethereum (ETH)", "Solana (SOL)" — clear and literal
- `HeroPnl` uses "YOUR ACCOUNT VALUE", "OPEN PROFIT / LOSS", "MARGIN IN USE"
- Connection status says "Live ✓" or "Offline" in plain English
- Instructions use numbered steps written simply

**Status:** ✅ Fixed (ongoing — more components can be improved)

---

## 4. CURRENT STATE (as of May 27, 2026)

### What's working right now:
- ✅ Bridge server at `localhost:8000` — starts in ~3 seconds, fully responsive
- ✅ Live BTC/ETH/SOL prices streaming from Hyperliquid WebSocket
- ✅ 100 real candle bars loaded on startup for all 3 coins
- ✅ ICT/SMC signal engine running — FU candles, orderblocks, FVGs, liquidity levels, Sniper Score
- ✅ Next.js dashboard at `localhost:3000`
- ✅ Clean authentic design — IBM Plex Mono, muted palette, no fake neon
- ✅ "Wallet not connected" state with clear step-by-step setup instructions
- ✅ MT5 fully removed — zero extra complexity

### What's NOT working yet:
- ❌ Live trading — requires Hyperliquid agent wallet private key in `server/.env`
- ❌ Real account balance / positions panel — requires private key
- ❌ WinStack and PnlCurve still show mock/simulated data (not real trade history)
- ❌ Pipeline component shows simulated cycle (conceptually correct, not real algo execution)

---

## 5. WHAT'S NEXT

### Step 1 — Connect the Hyperliquid wallet (15 minutes)
1. Go to `app.hyperliquid.xyz`
2. Connect main wallet
3. Settings → API → Generate API Wallet
4. Copy the private key
5. Paste into `server/.env` as `HL_PRIVATE_KEY=0x...`
6. Restart server
7. Dashboard hero panel switches to real account data

---

## 5b. PLATFORM REDESIGN — NEW DIRECTION (Session 3, May 27 2026)

The project scope expanded significantly. MEGALPHA is now a full quantitative trading platform built around a locally-trained RL agent. Full design spec: `docs/superpowers/specs/2026-05-27-megalpha-platform-design.md`

### What changed
- **No more ICT/SMC signal overlays on the dashboard** — SniperPanel, Pipeline, WinStack, PnlCurve, BottomPanels, FooterTicker are all removed
- **RL agent replaces manual signal engine** — PPO neural net trained on raw OHLCV + order book data via stable-baselines3 + PyTorch, runs 100% locally, no API costs
- **Full historical charts** — from asset creation on Hyperliquid (Nov 2022), not just 100 candles
- **6-page navigation** — Overview · Charts · Backtest · RL Agent · Data Hub · Journal

### New build sequence (replaces old Tasks 1–6)

| Phase | What | Key deliverable |
|---|---|---|
| **1** | Layout redesign + full historical charts | New shell, sidebar nav, neural net panel, paginated candle endpoint |
| **2** | Backtest engine | `server/backtest.py`, `/backtest` endpoint, BacktestPanel |
| **3** | RL agent | `server/train_rl.py`, PPO policy, live inference in broadcast loop |
| **4** | Data hub | Funding rates, OI, liquidations, news feed |
| **5** | Journal | Notion-style rich text editor via Tiptap, SQLite persistence |

Implementation plan for Phase 1 is next (writing-plans output).

---

## 5c. ORIGINAL NEXT ENGINEERING SESSION TASKS (superseded)

These are the 4 features requested at the end of Session 2. They must be built in order — each one is a foundation for the next.

---

### TASK 1 — Paper Trading Engine (Priority: CRITICAL)

**What:** Trade with fake money ($10,000 starting balance) using 100% real Hyperliquid market prices. No real money at risk. Validate the strategy before going live.

**Why:** The signal engine has never been tested on live markets. You must verify it makes money on paper before trusting it with real USDC.

**Files to create:**
- `server/paper_trader.py` — Full in-memory paper trading engine

**What it needs to do:**
```
- Start with $10,000 virtual USDC
- open_position(coin, is_buy, size_usd, leverage, entry_px, sl, tp)
  → deducts margin from balance, records position
- close_position(coin, exit_px, reason)
  → returns margin + P&L to balance, logs trade to history
- tick(prices)
  → called every 500ms on each broadcast cycle
  → auto-closes positions if current price hits SL or TP
- get_account(prices) → current equity, unrealized PnL, open positions
- get_stats() → win rate, profit factor, avg win/loss, max drawdown
```

**Files to modify:**
- `server/main.py`:
  - Add `paper_trader = PaperTrader()` at module level
  - Call `paper_trader.tick(prices)` inside `broadcaster()` every cycle
  - Add `paper_account` to broadcast payload
  - Add REST endpoints:
    - `POST /paper/open` — open a paper position
    - `POST /paper/close` — close a paper position
    - `POST /paper/reset` — reset to $10,000
    - `GET /paper/account` — current state
    - `GET /paper/history` — all completed trades
- `hooks/useHLStream.ts`:
  - Add `paperAccount` to `HLStreamData` interface
- `components/PaperTradingPanel.tsx` (new):
  - Shows: paper balance, equity, open P&L, positions list
  - Buttons: LONG / SHORT with size + leverage input
  - Shows last 20 completed paper trades with outcome

**Auto-trading integration (after paper trader works):**
```python
# In broadcaster(), after build_payload():
for coin in COINS:
    sig = sniper[coin].get("active_signal")
    if sig and sig["sniper_score"] >= 80 and coin not in paper_trader.positions:
        paper_trader.open_position(
            coin=coin,
            is_buy=(sig["type"] == "FU_BULL"),
            size_usd=200,       # $200 margin per trade
            leverage=5,
            entry_px=sig["entry"],
            sl=sig["sl"],
            tp=sig["tp_1r5"],
        )
```
This makes the algo automatically paper trade its own signals — real validation.

---

### TASK 2 — Multi-Timeframe Charts + All-Time Historical Data (Priority: HIGH)

**What:** Replace the fixed 100 x 1m candle chart with a full multi-timeframe chart. Add a timeframe selector. Fetch as much history as available.

**Why:** 100 candles of 1-minute data = 100 minutes of history. Useless for reading market structure. Need 1h/4h/1d charts to see the real picture.

**Available Hyperliquid intervals:** `1m`, `3m`, `5m`, `15m`, `30m`, `1h`, `2h`, `4h`, `6h`, `8h`, `12h`, `1d`, `3d`, `1w`

**Candle counts per timeframe at 500 candles:**
| Timeframe | History covered |
|-----------|----------------|
| 1m  | 8.3 hours |
| 15m | 5.2 days |
| 1h  | 20.8 days |
| 4h  | 83 days |
| 1d  | 500 days ← covers ALL of HL history (launched Nov 2022) |

**Files to create/modify:**

`server/main.py` — Add new endpoint:
```python
@app.get("/candles/{coin}")
async def get_candles(coin: str, interval: str = "1h", limit: int = 500) -> list:
    # Fetch from HL REST API with given interval + limit
    # Return list of {time, open, high, low, close}
    # Paginate if limit > 500 (for backtest use)
```

`components/LiveSpotFeed.tsx` — Add:
- Timeframe selector buttons: `1m | 15m | 1h | 4h | 1d`
- On click: fetch from `/candles/{coin}?interval=1h&limit=500`
- Chart re-renders with new candles
- Currently hardcoded to `1M` in the badge — make this dynamic

`hooks/useHLStream.ts` — Keep 1m candles for signal engine only. Chart uses separate fetch.

**For true "all-time" data (backtesting):**
- HL launched BTC Nov 2022, ETH/SOL shortly after
- 1d candles from Jan 2023 = ~870 candles = 2 requests of 500
- 1h candles from Jan 2023 = ~20,800 candles = 42 paginated requests
- Implement a `fetch_all_candles(coin, interval)` function that paginates automatically

---

### TASK 3 — Backtesting Engine (Priority: HIGH)

**What:** Run the ICT/SMC signal engine on historical Hyperliquid candle data. Simulate every trade it would have taken. Show real statistics: win rate, profit factor, drawdown, best/worst trades.

**Why:** Before trusting the algo with any money (even paper), you need to know: does it work? On what conditions? On what timeframes?

**Architecture:**

`server/backtest.py` (new file):
```python
def run_backtest(
    candles: list[dict],         # Historical OHLC data
    starting_balance: float,     # e.g. $10,000
    size_usd: float,             # Fixed margin per trade, e.g. $200
    leverage: int,               # e.g. 5x
    min_score: int,              # Minimum sniper score to take trade, e.g. 75
    lookback: int = 100,         # Candles to analyze at each step
) -> dict:
    # Slide a window across the candles
    # At each step: run analyze_coin(window)
    # If active_signal and score >= min_score and no position open: enter
    # Track open position: check SL/TP on each subsequent candle
    # Return: all trades list + aggregate stats
```

`server/main.py` — Add endpoint:
```python
@app.post("/backtest")
async def run_backtest_endpoint(req: BacktestRequest) -> dict:
    # req: coin, interval, start_date, end_date, size_usd, leverage, min_score
    # 1. Fetch historical candles for date range
    # 2. Run backtest engine
    # 3. Return trades + stats
```

`components/BacktestPanel.tsx` (new):
- Controls: Coin selector, Timeframe (1h/4h/1d), Date range, Size $, Leverage, Min Score
- Run button → POST /backtest → show loading spinner
- Results section:
  - Summary: Total trades, Win rate %, Profit factor, Net P&L, Max drawdown
  - Equity curve chart (lightweight-charts line series)
  - Trade log table: Date, Coin, Direction, Entry, Exit, P&L, Duration, Reason (TP/SL/manual)

---

### TASK 4 — Full Trade Data & History (Priority: MEDIUM)

**What:** Store every paper trade, every backtest result, every signal fired — in a persistent database. Show complete history on the dashboard.

**Why:** Without a database, all trade history is lost when the server restarts. You need this to track performance over time.

**Technology:** SQLite (built into Python, zero config, single file)

`server/db.py` (new file):
```python
import sqlite3

def init_db(path="server/megalpha.db"):
    conn = sqlite3.connect(path)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS paper_trades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            coin TEXT, direction TEXT,
            entry_px REAL, exit_px REAL,
            size_usd REAL, leverage INTEGER,
            sl REAL, tp REAL,
            pnl REAL, pnl_pct REAL,
            open_time INTEGER, close_time INTEGER,
            duration_secs INTEGER,
            reason TEXT,
            signal_score INTEGER
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS backtest_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            coin TEXT, interval TEXT,
            start_date TEXT, end_date TEXT,
            trade_count INTEGER, win_rate REAL,
            total_pnl REAL, profit_factor REAL,
            max_drawdown REAL,
            run_time INTEGER,
            params TEXT  -- JSON of all input params
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS signals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            time INTEGER, coin TEXT,
            signal_type TEXT, score INTEGER,
            entry REAL, sl REAL, tp REAL,
            market_bias TEXT,
            acted_on INTEGER  -- 0 = no trade taken, 1 = paper trade opened
        )
    """)
    conn.commit()
    return conn
```

**Dashboard additions:**
- `components/TradeHistory.tsx` — Sortable/filterable table of all paper trades
- `components/SignalLog.tsx` — Every signal fired, whether a trade was taken, outcome

---

### TASK 5 — Connect Signal Engine to Paper Trader (Auto-Paper-Trading)

**What:** Make the algo trade itself automatically on paper. No manual clicking required.

**How it works:**
1. Every 500ms, `broadcaster()` builds the sniper payload
2. For each coin: if `sniper_score >= 80` AND no position open → auto open paper trade
3. `paper_trader.tick(prices)` checks SL/TP every cycle → auto closes
4. All results logged to SQLite

**This is the bridge between signal engine and execution.** Once this runs for a week and shows consistent paper profits, you flip the switch to real trading.

**Risk management guards to implement:**
- Max 2 paper positions open simultaneously
- Max position size: 20% of paper balance per trade
- No trading within 30 minutes of a loss (cooldown)
- Daily loss limit: stop trading if down 5% in one day
- Only trade during active sessions (London: 8am–4pm UTC, NY: 1pm–9pm UTC)

---

### TASK 6 — Deploy to Linux VPS (Final Step)

Once paper trading shows consistent profit over 2+ weeks:
1. Rent a Linux VPS (Hetzner CX22: $4.50/month, 2 vCPU, 4GB RAM — more than enough)
2. Deploy `server/` only (not the Next.js dashboard — that stays local or on Vercel)
3. The VPS runs 24/7, never misses a signal
4. Dashboard connects to VPS server instead of localhost

```bash
# On VPS (Ubuntu 22.04):
git clone <your-repo>
cd megalpha
pip install -r requirements.txt
cp server/.env.example server/.env
nano server/.env  # add HL_PRIVATE_KEY
python server/main.py &

# Or with systemd for auto-restart:
# sudo systemctl enable megalpha
# sudo systemctl start megalpha
```

### Step 2 — Wire real trading to the signal engine
Currently the signal engine detects signals but takes no action. The next engineering task is:

```python
# In server/main.py — after build_payload():
for coin in COINS:
    sig = sniper[coin].get("active_signal")
    if sig and sig["sniper_score"] >= 75 and hl_trader:
        hl_trader.market_open(
            coin=coin,
            is_buy=(sig["type"] == "FU_BULL"),
            size_usd=500,
            leverage=5,
        )
```

Needs proper risk management guards before enabling:
- Max concurrent positions (e.g., 2 at once)
- Per-trade risk cap (e.g., max $100 loss)
- Cooldown after a loss
- Daily loss limit

### Step 3 — Real P&L history tracking
Replace the fake PnlCurve and WinStack data with real trade history fetched from the Hyperliquid fills endpoint:
```
POST https://api.hyperliquid.xyz/info
{"type": "userFills", "user": "0x..."}
```

### Step 4 — Deploy to Linux VPS
The entire server (`server/main.py` + `sniper_signals.py` + `hl_trader.py`) runs perfectly on Linux with no changes. Deploy to a $6/month VPS (Hetzner CX22 or DigitalOcean Droplet):

```bash
# On VPS:
git clone your-repo
pip install -r requirements.txt
echo "HL_PRIVATE_KEY=0x..." > server/.env
python server/main.py &

# Dashboard can be accessed via ngrok or deployed on Vercel
```

Running 24/7 on Linux means the algo never misses a signal because your Windows machine rebooted.

### Step 5 — Expand signal quality
- Add higher timeframe confluence (check 15m/1h structure before taking 1m entry)
- Add volume filter (require above-average volume on signal candle)
- Add session filter (London/NY open only — avoid low-liquidity hours)
- Backtest the signal engine on historical Hyperliquid data

### Step 6 — Add more coins
The server supports any Hyperliquid perpetual. Adding ETH and SOL execution is a one-line change in `COINS`. Could also add ARB, MATIC, AVAX.

---

## 6. ARCHITECTURE SUMMARY

```
┌─────────────────────────────────────────────────────────┐
│                    YOUR MACHINE                         │
│                                                         │
│  ┌─────────────────────┐    ┌──────────────────────┐   │
│  │  Python Bridge       │    │  Next.js Dashboard   │   │
│  │  server/main.py      │◄───│  localhost:3000       │   │
│  │  localhost:8000      │    │                      │   │
│  │                      │    │  - HeroPnl           │   │
│  │  - HL WS listener    │    │  - LiveSpotFeed      │   │
│  │  - Candle builder    │    │  - SniperPanel       │   │
│  │  - Signal engine     │    │  - TradingPanel      │   │
│  │  - WS broadcaster    │    │  - Pipeline          │   │
│  │  - REST trade API    │    └──────────────────────┘   │
│  └─────────┬───────────┘                                │
│            │                                            │
└────────────┼────────────────────────────────────────────┘
             │
             ▼
   ┌─────────────────────┐
   │   Hyperliquid L1    │
   │                     │
   │  WS: prices/trades  │
   │  REST: candles/fills│
   │  REST: place orders │
   └─────────────────────┘
```

**Data flow:**
1. Hyperliquid WS → bridge server (prices + trades every ~50ms)
2. Bridge server builds candles, runs ICT signal engine
3. Bridge server broadcasts full payload to dashboard every 500ms
4. Dashboard renders live — prices, charts, signals, account
5. User clicks "LONG BTC" → dashboard POSTs to bridge → bridge signs + submits to Hyperliquid

---

*Diagnostic generated May 27, 2026*
