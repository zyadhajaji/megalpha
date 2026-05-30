# MEGALPHA — Project Diagnostic
**Last updated:** May 29, 2026
**Project path:** `C:\Users\anakin\s-tier\megalpha`
**Stack:** Next.js 16 · React 19 · TypeScript · Tailwind CSS v4 · IBM Plex Mono + Inter · FastAPI · Python 3.12 · Stable-Baselines3 (PPO) + PyTorch + Gymnasium · Hyperliquid WebSocket + REST API

---

## 1. WHAT MEGALPHA IS

MEGALPHA is a **professional quantitative trading platform** built around a locally-trained reinforcement-learning agent that trades Hyperliquid perpetual futures (BTC, ETH, SOL). Everything runs on your machine — no paid API, no cloud dependency (a 24/7 cloud deploy is planned but optional).

| Phase | What | Status |
|---|---|---|
| **1** | Layout redesign + full historical charts | ✅ **Complete** |
| **2** | Backtest engine + live order book + 1m chart fix | ✅ **Complete** |
| **2.5** | Chart indicators (MA/BB/Vol/RSI/MACD/Fib) + crosshair legend | ✅ **Complete** |
| **3** | RL agent (PPO, local) + live paper-forward + dashboard | ✅ **Complete** |
| **3.5** | Backtest rigor (slippage/funding, walk-forward, kill-switch) | 🔲 In progress |
| **4** | Data hub (funding, OI, liquidations, news) | 🔲 Planned |
| **5** | Journal (Notion-style, SQLite) | 🔲 Planned |
| **6** | 24/7 cloud deployment (Oracle free VM) | ⏸ Paused (scaffold pending) |

---

## 2. CURRENT STATE (May 29, 2026)

### What is running

```
localhost:3000   Next.js dashboard
localhost:8000   Python bridge server
  prices:        live BTC/ETH/SOL from HL WS allMids
  candles:       disk cache — 15m/1h/4h ~5,000 each · 1d ~1,250–1,300 (HL retention cap)
  order book:    12 bid + 12 ask levels per coin (live l2Book)
  RL agent:      PPO policy loaded · 12-feature obs · paper-forward every 10s
  hl_configured: true (private key in server/.env — gitignored, never committed)
```

### What works

| Feature | Status |
|---|---|
| Live BTC/ETH/SOL prices + 1m candle builder + 12-level order book | ✅ |
| Disk candle cache with volume (BTC/ETH/SOL × 15m/1h/4h/1d) | ✅ |
| ChartPanel: 5 timeframes, coin selector, entry line, crosshair OHLC legend | ✅ |
| **Charts page indicators**: MA(EMA9/20/50), Bollinger, Volume, RSI, MACD, Fibonacci — toggle chips + multi-pane | ✅ |
| Overview stays clean (indicators only on Charts via `advanced` prop) | ✅ |
| Backtest engine: 6 strategies, long+short, fees, equity curve + 18 stats | ✅ |
| **RL agent — PPO, 12 normalized features, risk-adjusted reward** | ✅ |
| **RL training pipeline**: 80/20 split, best-checkpoint, reward VecNormalize, rich eval | ✅ |
| **Live paper-forward**: agent trades simulated $ on real live prices, equity path | ✅ |
| **RL Agent dashboard**: live decision, prob bars, paper P&L + equity sparkline, 12-feature gauges | ✅ |
| Live-inference staleness guard (rejects a model whose feature width ≠ current) | ✅ |
| Pytest suite: candle endpoint | ✅ |

### What is NOT built yet

| Feature | Phase |
|---|---|
| Realistic backtest cost model (slippage + funding) | 3.5 |
| Walk-forward validation + buy-and-hold benchmark in the backtest engine | 3.5 |
| Risk / kill-switch layer (stop-loss, max-DD, sizing) in backtest | 3.5 |
| Save/load **named** strategies + forward-test a saved one | 3.5 |
| Manual-confirm Hyperliquid order screen (per-order confirm; no auto-execution) | 3.5 |
| Deeper chart history (BTC/ETH/SOL from launch, beyond HL's ~5k cap) | 3.5 |
| Funding / OI / liquidations / news (Data Hub) | 4 |
| Journal (Tiptap + SQLite) | 5 |
| 24/7 cloud deploy artifacts (Docker, Caddy, configurable bridge URL) | 6 |

---

## 3. ARCHITECTURE

```
┌──────────────────────────────────────────────────────────────┐
│                        YOUR MACHINE                            │
│                                                                │
│  ┌─────────────────────────┐    ┌──────────────────────────┐  │
│  │  Python Bridge           │    │  Next.js Dashboard        │ │
│  │  server/main.py :8000    │◄───│  localhost:3000           │ │
│  │                          │    │                           │ │
│  │  • HL WS listener        │    │  Topbar (logo + prices)   │ │
│  │  • 1m candle builder     │    │  Sidebar (6 pages)        │ │
│  │  • WS broadcaster 500ms  │    │  Overview · Charts ·      │ │
│  │  • /candles · /backtest  │    │  Backtest · RL Agent ·    │ │
│  │  • RL paper-forward 10s  │    │  Data Hub · Journal       │ │
│  │  • /rl/status            │    │                           │ │
│  └──────────┬───────────────┘    └──────────────────────────┘ │
└─────────────┼──────────────────────────────────────────────────┘
              ▼
    ┌──────────────────────┐        ┌──────────────────────────┐
    │   Hyperliquid L1     │        │  RL training (offline)   │
    │  WS: prices + trades │        │  server/train_rl.py      │
    │  REST: candles       │        │  PPO → models/*.zip      │
    └──────────────────────┘        └──────────────────────────┘
```

**Live data flow:** HL WS → bridge builds candles + order book → broadcasts to dashboard WS at 500ms → `useHLStream` distributes to components. Charts fetch history from `/candles/{coin}`.

**RL flow:** `train_rl.py` trains a PPO policy offline on cached candles → saves `rl_policy_active.zip`. On bridge startup `load_rl_policy()` loads it (with a feature-width guard). Every 10s `rl_inference_loop()` builds the 12-feature observation, predicts an action, and runs a **paper trade on the live price** — exposing decision, probabilities, the feature vector, and the equity path via `/rl/status`. **No real orders are ever placed.**

---

## 4. FILE MAP

### Bridge server (`server/`)

| File | Purpose |
|---|---|
| `main.py` | FastAPI app — WS listener (prices/trades/l2Book), 500ms broadcaster, `/candles/{coin}`, `/backtest`, `/rl/status`, HL trade REST. `load_rl_policy()` (staleness guard), `rl_inference_loop()` (paper-forward sim). **No auto-reload — restart after edits.** |
| `rl_features.py` | **Single source of truth for the observation.** `N_FEATURES=12`, `WARMUP=50`, `FEATURE_LABELS` (shared with the dashboard). 12 self-bounded features; `compute_indicators()` + `observation()`. Imports `_ema/_rsi/_atr/_sma/_rolling_std/_macd` from `backtest.py`. |
| `trading_env.py` | Gymnasium env. Reward = leveraged return − fees − **turnover penalty** − **drawdown-deepening penalty** (all tunable). Obs space = `Box(-1,1, (12,))`. |
| `train_rl.py` | PPO training: 80/20 chronological split, reward-only `VecNormalize`, `EvalCallback` keeps the **best out-of-sample checkpoint**, `net_arch=[128,128]`, LR decay, CLI knobs (`--turnover --dd-penalty --lr --ent-coef`). Rich eval: Sharpe, max DD, turnover, exposure, vs buy-and-hold. Saves `rl_{COIN}_{interval}.zip` + `rl_policy_active.zip` + `rl_policy_active.json`. |
| `backtest.py` | Pure-Python engine — 6 strategies (all long+short), taker fees, next-open fills, ATR brackets, 18 stats. Indicator helpers reused by `rl_features.py`. |
| `candle_cache.py` | Disk-backed full-history cache — `server/cache/{COIN}_{interval}.json` (gitignored). |
| `hl_trader.py` | Hyperliquid trading module (market open/close/cancel). Not auto-invoked. |
| `.env` | `HL_PRIVATE_KEY` — **gitignored, never committed.** |
| `models/` | Trained policies (`rl_policy_active.zip` + meta json). **Gitignored** — retrain after cloning. |

### Frontend (`app/`, `components/`, `hooks/`, `lib/`)

| File | Purpose |
|---|---|
| `lib/types.ts` | Candle (incl. `volume?`), HLAccount, HLPosition, Trade, RLAgentState |
| `lib/indicators.ts` | Pure client-side indicator math: `ema/sma/rsi/macd/bollinger/volume/fib` → lightweight-charts point arrays |
| `hooks/useHLStream.ts` | Bridge WebSocket client (prices, candles, order book, rl_agent) |
| `components/ChartPanel.tsx` | Candlestick chart, 5 TFs. `advanced` prop adds the indicator toolbar, sub-panes (RSI/MACD), volume, Fibonacci ladder, crosshair legend |
| `components/OrderBook.tsx` | Live L2 ladder, depth bars, mid/spread, imbalance, coin selector |
| `components/pages/ChartsPage.tsx` | Full-screen ChartPanel with `advanced` (indicators on) |
| `components/pages/OverviewPage.tsx` | Overview panels — ChartPanel **without** `advanced` (clean) |
| `components/pages/BacktestPage.tsx` | Backtest UI — controls, equity curve, stat grid, trade log |
| `components/pages/RLAgentPage.tsx` | **Rebuilt** — polls `/rl/status`; live decision + confidence, LONG/HOLD/SHORT bars, paper-forward stats + equity sparkline, 12-feature ±1 gauges |
| `components/pages/DataHubPage.tsx` / `JournalPage.tsx` | Stubs — Phase 4 / 5 |

---

## 5. RL AGENT — DELIVERED (Phase 3)

### Observation (12 features, each clipped to a fixed range)
fast trend (vs EMA9) · slow trend (vs EMA50) · trend regime (EMA20/50) · RSI · MACD histogram (ATR units) · Bollinger %B · volatility (ATR/price) · 1-bar return · 5-bar momentum · 10-bar momentum · **volume surge** (log vs SMA20) · position held.

**Why self-bounded, not VecNormalize-on-obs:** live inference calls `model.predict(obs)` directly. Bounding every feature here keeps train/live observations identical with zero normalization plumbing — avoiding the #1 RL deployment bug (train/live drift). VecNormalize is used for **reward only** (training-time).

### Reward (risk-adjusted, return-scaled)
`leveraged return − taker fee − turnover penalty − drawdown-deepening penalty`. Turnover/DD penalties discourage fee-bleeding churn and large losing streaks — the core of a *quant* objective, not a raw P&L chase.

### Training
```bash
python server/train_rl.py --coin BTC --interval 1h --steps 200000
# optional: --interval 4h (deeper history) --turnover 0.0004 --dd-penalty 0.4 --lr 3e-4
```
Then **restart the bridge** so it loads the new policy.

### Honest performance note
The current BTC 1h / 200k policy **learned to abstain (HOLD)** — once realistic fees + risk penalties are applied, it could not find a pattern that reliably beats costs, so it stays in cash (which "beat" a −10% buy-and-hold by not trading). This is the agent being honest, not a bug. The undertrained 5k version *did* trade and lost −31% to churn. The fundamental tension: **do nothing, or trade and bleed** — no penalty setting manufactures an edge. Tuning levers: try `--interval 4h`, loosen penalties for selective trades, or accept abstention.

### Live paper-forward
`rl_inference_loop()` runs the policy every 10s and paper-trades on the live mark price (simulated money, self-consistent position feature). Tracks equity / realized / unrealized / trades / win-rate / max-DD + a rolling equity path, all on `/rl/status`. Resets on bridge restart (in-memory).

---

## 6. BACKTEST ENGINE (Phase 2) — unchanged this pass

`run_backtest(candles, starting_balance, size_usd, leverage, strategy, fee_bps=3.5)` → `{trades, equity_curve, stats}`. 6 strategies (momentum, breakout, mean_reversion, ema_cross, macd, bollinger), all long+short, next-open fills, ATR brackets for breakout, 18 stats. `POST /backtest` validates against `STRATEGIES`.

**Phase 3.5 will add:** slippage + funding cost model, walk-forward validation, an in-engine buy-and-hold benchmark, and a stop-loss / max-drawdown kill-switch with sizing.

---

## 7. DESIGN SYSTEM

| Token | Value | Use |
|---|---|---|
| Background | `#070707` | Page |
| Surface | `#0c0c0c` | Panels |
| Border | `#1c1c1c` | Edges |
| Text / Sub / Dim | `#e8e8e8` / `#888` / `#333` | Text scale |
| Green | `#3aaa72` / `#4ecf8a` | Profit · LONG · online |
| Red | `#aa3a3a` / `#cf4e4e` | Loss · SHORT · error |
| Blue | `#3a6eaa` / `#4e8ecf` | Agent · selected · entry line |
| Amber | `#cfad4e` | Scanning · warnings |

**Fonts:** IBM Plex Mono (labels/data) · Inter (big bold numbers).
**Philosophy:** no neon, no fake data — every element shows real data or a clear "not built yet" placeholder.

---

## 8. RUNNING IT

```bash
# 1) Bridge (terminal A) — connects HL, serves data + RL paper-forward
python server/main.py            # http://localhost:8000

# 2) Dashboard (terminal B)
npm run dev                      # http://localhost:3000
```
Edit Python in `server/` → **restart the bridge** (no auto-reload). Edit frontend → Turbopack hot-reloads.

---

## 9. DEPLOYMENT (Phase 6 — paused)

Goal: run the bridge + agent 24/7. Chosen host: **Oracle Cloud Always-Free ARM VM** ($0, always-on). Prerequisite (user): create the Oracle account + Ubuntu ARM VM. To-build: Linux/ARM requirements (drop Windows-only `MetaTrader5`, add torch/sb3/gymnasium), Docker Compose + Caddy (auto-HTTPS), and a **configurable bridge URL** (currently hardcoded to `localhost:8000` in 5 client files — see Known Issues).

---

## 10. KNOWN ISSUES / THINGS TO WATCH

| Issue | Severity | Notes |
|---|---|---|
| Frontend hardcodes `http://localhost:8000` / `ws://localhost:8000` | Medium | In `useHLStream.ts`, `ChartPanel.tsx`, `useTrading.ts`, `BacktestPage.tsx`, `RLAgentPage.tsx`. Must become an env var before any remote/cloud deploy. |
| Python bridge has no auto-reload | Medium | Restart after editing `server/*.py`. |
| RL agent currently abstains (HOLD) | Info | Expected with risk-adjusted reward + no learnable edge on BTC 1h. Retrain on 4h / tune penalties to change behavior. |
| Paper-forward state is in-memory | Low | Resets on bridge restart. Persist to disk in 3.5 if a durable forward test is wanted. |
| `on_event("startup")` deprecation in FastAPI | Low | Migrate to `lifespan` in a cleanup pass. |
| Browser "Cannot redefine property: ethereum" overlay | Info | **Not an app bug** — two crypto wallet extensions (e.g., Exodus + another) collide over `window.ethereum`. Disable one, or use Incognito. The app never touches `window.ethereum`. |
| `models/` + `server/cache/` gitignored | Info | Regenerable. After cloning, run the bridge once (cache) and `train_rl.py` (model). |
| `mt5_bridge.py` / `sniper_signals.py` on disk | Info | Dead code; safe to delete. |

---

*Diagnostic updated May 29, 2026 — Phases 1–3 complete (charts + indicators, backtest engine, RL agent with live paper-forward + rebuilt dashboard). Next: backtest rigor (3.5).*
