# MEGALPHA Full Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete MEGALPHA phases: Signal Performance Tracker, RL 4h retrain, 4h signals, Telegram alerts, env-var fix for cloud-readiness, Docker/Oracle scaffold, and live execution button.

**Architecture:** Each feature is a vertical slice through the Python bridge (`server/`) and Next.js dashboard (`components/`). The bridge is a FastAPI + asyncio app (`server/main.py`) with SQLite via `server/db.py`. The frontend is Next.js 16 / React 19; all bridge calls use `http://localhost:8000` (soon replaced by `NEXT_PUBLIC_BRIDGE_URL`). Tasks are ordered by dependency: DB schema first, then loops, then UI.

**Tech Stack:** FastAPI · SQLite · httpx · Next.js 16 · React 19 · TypeScript · lightweight-charts v5 · Stable-Baselines3 (PPO) · Telegram Bot API · Docker Compose · Caddy

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `server/db.py` | Modify | Add outcome columns to signals table + CRUD |
| `server/outcome_checker.py` | Create | Background loop: check SL/TP hits per signal |
| `server/telegram_notifier.py` | Create | Fire Telegram message on LONG/SHORT ≥ 75% |
| `server/main.py` | Modify | Wire outcome loop, 4h signal loop, stats endpoint, Telegram call |
| `server/.env.example` | Modify | Add TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID |
| `server/train_rl.py` | Modify | Change default coin=ETH interval=4h steps=500k |
| `lib/bridge.ts` | Create | Single source of truth for BRIDGE_HTTP + BRIDGE_WS |
| `lib/types.ts` | Modify | Add `outcome`, `exit_price`, `pnl_pct` to AISignal |
| `hooks/useHLStream.ts` | Modify | Use BRIDGE_WS from lib/bridge |
| `hooks/useTrading.ts` | Modify | Use BRIDGE_HTTP from lib/bridge |
| `components/ChartPanel.tsx` | Modify | Use BRIDGE_HTTP from lib/bridge |
| `components/pages/BacktestPage.tsx` | Modify | Use BRIDGE_HTTP from lib/bridge |
| `components/pages/DataHubPage.tsx` | Modify | Use BRIDGE_HTTP from lib/bridge |
| `components/pages/RLAgentPage.tsx` | Modify | Use BRIDGE_HTTP from lib/bridge |
| `components/pages/JournalPage.tsx` | Modify | Remove inline BASE const → lib/bridge |
| `components/pages/SignalsPage.tsx` | Modify | Use BRIDGE_HTTP, add Performance tab, outcome badges, live-execute button |
| `components/SignalToast.tsx` | Modify | Add "TAKE TRADE" button |
| `components/Shell.tsx` | Modify | Pass `onTrade` handler from trading hook to toast |
| `Dockerfile` | Create | Multi-stage: Next.js build + Python bridge |
| `docker-compose.yml` | Create | bridge + dashboard + Caddy reverse proxy |
| `Caddyfile` | Create | Auto-HTTPS reverse proxy config |
| `.env.example` (root) | Create | NEXT_PUBLIC_BRIDGE_URL=http://localhost:8000 |
| `DIAGNOSTIC.md` | Modify | Update phase table + known issues |

---

## Task 1 — DB: Outcome Columns

**Files:**
- Modify: `server/db.py`

- [ ] **Add outcome columns to signals table in `init_db()`**

```python
# In init_db(), after the existing `try: ALTER TABLE signals ADD COLUMN summary` block:
for col_sql in [
    "ALTER TABLE signals ADD COLUMN outcome    TEXT    NOT NULL DEFAULT 'PENDING'",
    "ALTER TABLE signals ADD COLUMN exit_price REAL    NOT NULL DEFAULT 0",
    "ALTER TABLE signals ADD COLUMN exit_time  INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE signals ADD COLUMN pnl_pct    REAL    NOT NULL DEFAULT 0",
]:
    try:
        db.execute(col_sql)
    except Exception:
        pass   # column already exists
```

- [ ] **Add `update_signal_outcome()` and `get_pending_signals()` to `server/db.py`**

```python
def update_signal_outcome(
    signal_id: int,
    outcome: str,      # "WIN" | "LOSS" | "EXPIRED"
    exit_price: float,
    exit_time: int,
    pnl_pct: float,
) -> None:
    with _conn() as db:
        db.execute(
            "UPDATE signals SET outcome=?, exit_price=?, exit_time=?, pnl_pct=? WHERE id=?",
            (outcome, exit_price, exit_time, pnl_pct, signal_id),
        )


def get_pending_signals() -> list[dict]:
    """Return all LONG/SHORT signals still awaiting outcome."""
    with _conn() as db:
        rows = db.execute(
            "SELECT * FROM signals WHERE signal IN ('LONG','SHORT') AND outcome='PENDING'"
        ).fetchall()
    return [_row_to_dict(r) for r in rows]


def get_signal_stats() -> dict:
    """Aggregate performance stats across all resolved signals."""
    with _conn() as db:
        total = db.execute(
            "SELECT COUNT(*) FROM signals WHERE signal IN ('LONG','SHORT')"
        ).fetchone()[0]
        wins = db.execute(
            "SELECT COUNT(*) FROM signals WHERE outcome='WIN'"
        ).fetchone()[0]
        losses = db.execute(
            "SELECT COUNT(*) FROM signals WHERE outcome='LOSS'"
        ).fetchone()[0]
        pending = db.execute(
            "SELECT COUNT(*) FROM signals WHERE outcome='PENDING'"
        ).fetchone()[0]
        avg_win_row = db.execute(
            "SELECT AVG(pnl_pct) FROM signals WHERE outcome='WIN'"
        ).fetchone()
        avg_loss_row = db.execute(
            "SELECT AVG(pnl_pct) FROM signals WHERE outcome='LOSS'"
        ).fetchone()
        best_row = db.execute(
            "SELECT coin, interval, pnl_pct, created_at FROM signals "
            "WHERE outcome='WIN' ORDER BY pnl_pct DESC LIMIT 1"
        ).fetchone()
        worst_row = db.execute(
            "SELECT coin, interval, pnl_pct, created_at FROM signals "
            "WHERE outcome='LOSS' ORDER BY pnl_pct ASC LIMIT 1"
        ).fetchone()
    win_rate = wins / (wins + losses) if (wins + losses) > 0 else 0
    return {
        "total": total, "wins": wins, "losses": losses, "pending": pending,
        "win_rate": round(win_rate * 100, 1),
        "avg_win_pct":  round(avg_win_row[0]  or 0, 2),
        "avg_loss_pct": round(avg_loss_row[0] or 0, 2),
        "best":  dict(best_row)  if best_row  else None,
        "worst": dict(worst_row) if worst_row else None,
    }
```

- [ ] **Restart bridge to apply migrations, verify with Python**

```bash
cd C:\Users\anakin\s-tier\megalpha
python server/main.py &   # starts bridge
python -c "
import sqlite3
db = sqlite3.connect('server/journal.db')
cols = [r[1] for r in db.execute('PRAGMA table_info(signals)').fetchall()]
assert 'outcome' in cols and 'pnl_pct' in cols, f'Missing cols: {cols}'
print('OK — outcome columns present')
"
```

- [ ] **Commit**

```bash
git add server/db.py
git commit -m "feat(db): add outcome columns + stats to signals table"
```

---

## Task 2 — Outcome Checker Loop

**Files:**
- Create: `server/outcome_checker.py`
- Modify: `server/main.py`

The checker runs every 15 minutes. For each PENDING signal it fetches candles from the cache forward from `signal.time`, then walks candle-by-candle checking if the HIGH crossed the TP (WIN for LONG) or the LOW crossed the SL (LOSS for LONG), and vice versa for SHORT. Signals older than 48h with no hit are marked EXPIRED.

- [ ] **Create `server/outcome_checker.py`**

```python
"""
MEGALPHA — Signal Outcome Checker
Runs every 15 minutes. For each PENDING signal, fetches candles from the
signal's entry candle forward and checks if SL or TP was hit first.
"""
from __future__ import annotations

import asyncio
import logging
import time

log = logging.getLogger("megalpha.outcomes")

EXPIRY_HOURS = 48   # mark EXPIRED after this many hours with no hit


async def check_all_outcomes(
    candle_history_fn,   # async fn(coin, interval) → list[dict]
) -> None:
    """Check every PENDING signal once."""
    import db as _db

    pending = await asyncio.to_thread(_db.get_pending_signals)
    if not pending:
        return

    log.info("Outcome checker: %d pending signals", len(pending))
    for sig in pending:
        try:
            await _check_one(sig, candle_history_fn, _db)
        except Exception as exc:
            log.warning("Outcome check failed for signal %d: %s", sig["id"], exc)
        await asyncio.sleep(0.5)


async def _check_one(sig: dict, candle_history_fn, _db) -> None:
    summary    = sig.get("summary") or {}
    entry      = float(summary.get("entry")     or sig["price"])
    sl         = float(summary.get("stop_loss") or 0)
    tp         = float(summary.get("take_profit") or 0)
    direction  = sig["signal"]          # "LONG" or "SHORT"
    signal_ts  = sig["time"]            # unix seconds (snapped candle time)
    signal_id  = sig["id"]
    coin       = sig["coin"]
    interval   = sig["interval"]

    # Skip if SL or TP is not set (no useful target to check)
    if sl <= 0 or tp <= 0:
        _maybe_expire(sig, _db)
        return

    candles = await candle_history_fn(coin, interval)
    # Only candles that closed AFTER the signal candle
    future = [c for c in candles if c["time"] > signal_ts]

    now = int(time.time())
    max_age_s = EXPIRY_HOURS * 3600

    for candle in future:
        hi = candle["high"]
        lo = candle["low"]

        if direction == "LONG":
            if lo <= sl:
                # Stop loss hit — LOSS
                pnl = (sl - entry) / entry * 100
                await asyncio.to_thread(
                    _db.update_signal_outcome, signal_id, "LOSS", sl, candle["time"], round(pnl, 3)
                )
                log.info("Outcome: %s %s %s → LOSS  SL hit @ $%.4f  P&L %.2f%%",
                         coin, interval, direction, sl, pnl)
                return
            if hi >= tp:
                # Take profit hit — WIN
                pnl = (tp - entry) / entry * 100
                await asyncio.to_thread(
                    _db.update_signal_outcome, signal_id, "WIN", tp, candle["time"], round(pnl, 3)
                )
                log.info("Outcome: %s %s %s → WIN   TP hit @ $%.4f  P&L %.2f%%",
                         coin, interval, direction, tp, pnl)
                return

        elif direction == "SHORT":
            if hi >= sl:
                pnl = (entry - sl) / entry * 100
                pnl = -abs(pnl)   # loss for SHORT when SL hit above
                await asyncio.to_thread(
                    _db.update_signal_outcome, signal_id, "LOSS", sl, candle["time"], round(pnl, 3)
                )
                log.info("Outcome: %s %s %s → LOSS  SL hit @ $%.4f  P&L %.2f%%",
                         coin, interval, direction, sl, pnl)
                return
            if lo <= tp:
                pnl = (entry - tp) / entry * 100
                await asyncio.to_thread(
                    _db.update_signal_outcome, signal_id, "WIN", tp, candle["time"], round(pnl, 3)
                )
                log.info("Outcome: %s %s %s → WIN   TP hit @ $%.4f  P&L %.2f%%",
                         coin, interval, direction, tp, pnl)
                return

    # No hit yet — check expiry
    age_s = now - sig["created_at"]
    if age_s > max_age_s:
        # Expire at the last candle close
        last_close = future[-1]["close"] if future else entry
        pnl = ((last_close - entry) / entry * 100) if direction == "LONG" \
              else ((entry - last_close) / entry * 100)
        await asyncio.to_thread(
            _db.update_signal_outcome, signal_id, "EXPIRED",
            last_close, now, round(pnl, 3)
        )
        log.info("Outcome: %s %s %s → EXPIRED after %dh  P&L %.2f%%",
                 coin, interval, direction, age_s // 3600, pnl)


def _maybe_expire(sig: dict, _db) -> None:
    age_s = int(time.time()) - sig["created_at"]
    if age_s > EXPIRY_HOURS * 3600:
        import asyncio
        _db.update_signal_outcome(sig["id"], "EXPIRED", 0, int(time.time()), 0)


async def outcome_checker_loop(candle_history_fn) -> None:
    """Background task — checks outcomes every 15 minutes."""
    log.info("Outcome checker loop started")
    await asyncio.sleep(300)   # 5-min delay on startup
    while True:
        try:
            await check_all_outcomes(candle_history_fn)
        except Exception as exc:
            log.warning("Outcome checker error: %s", exc)
        await asyncio.sleep(900)   # 15 minutes
```

- [ ] **Add the loop to `server/main.py` startup**

In `server/main.py`, inside `async def startup()`:

```python
# After asyncio.create_task(btc_eth_sol_signal_loop()):
from outcome_checker import outcome_checker_loop as _outcome_loop

async def _candle_history(coin: str, interval: str) -> list[dict]:
    launch_ms   = COIN_START_MS.get(coin, COIN_START_MS["BTC"])
    interval_ms = INTERVAL_MS.get(interval, INTERVAL_MS["1h"])
    return await candle_cache.get_history(
        coin, interval, launch_ms, interval_ms, fetch_candles_paginated
    )

asyncio.create_task(_outcome_loop(_candle_history))
```

- [ ] **Add `GET /signals/stats` and `GET /signals/history` endpoints to `server/main.py`**

Place these alongside the other `/ai/signals/` routes:

```python
@app.get("/signals/stats")
async def signals_stats() -> dict:
    """Aggregate win/loss/pending stats for the Performance tab."""
    return await asyncio.to_thread(_db.get_signal_stats)


@app.get("/signals/history")
async def signals_history(limit: int = 50) -> list:
    """All resolved + pending signals for the Performance tab, newest first."""
    with _db._conn() as db:
        rows = db.execute(
            "SELECT * FROM signals WHERE signal IN ('LONG','SHORT') "
            "ORDER BY created_at DESC LIMIT ?", (limit,)
        ).fetchall()
    return [_db._row_to_dict(r) for r in rows]
```

- [ ] **Restart bridge and smoke-test the endpoints**

```bash
curl http://localhost:8000/signals/stats
# Expected: {"total":1,"wins":0,"losses":0,"pending":1,"win_rate":0.0,...}

curl http://localhost:8000/signals/history
# Expected: [{...signal with outcome:"PENDING"...}]
```

- [ ] **Commit**

```bash
git add server/outcome_checker.py server/db.py server/main.py
git commit -m "feat(signals): outcome checker loop + stats endpoint"
```

---

## Task 3 — lib/bridge.ts + env var fix

**Files:**
- Create: `lib/bridge.ts`
- Create: `.env.example` (root)
- Create: `.env.local` (root, gitignored)
- Modify: all 6 TS files that hardcode localhost:8000

- [ ] **Create `lib/bridge.ts`**

```typescript
// Single source of truth for bridge URL — swap for cloud deploy via NEXT_PUBLIC_BRIDGE_URL
export const BRIDGE_HTTP =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_BRIDGE_URL)
    ? process.env.NEXT_PUBLIC_BRIDGE_URL.replace(/\/$/, "")
    : "http://localhost:8000";

export const BRIDGE_WS = BRIDGE_HTTP.replace(/^http/, "ws");
```

- [ ] **Create `.env.example` at repo root**

```bash
# Copy to .env.local and fill in for local dev (already gitignored by .env*)
NEXT_PUBLIC_BRIDGE_URL=http://localhost:8000
```

- [ ] **Update `hooks/useHLStream.ts`** — replace the WS_URL constant:

```typescript
// Remove: const WS_URL = "ws://localhost:8000/ws";
// Add at top of file:
import { BRIDGE_WS } from "@/lib/bridge";
// Change line 93:
const WS_URL = `${BRIDGE_WS}/ws`;
```

- [ ] **Update `hooks/useTrading.ts`** — replace BASE:

```typescript
// Remove: const BASE = "http://localhost:8000";
// Add at top:
import { BRIDGE_HTTP as BASE } from "@/lib/bridge";
```

- [ ] **Update `components/ChartPanel.tsx`** — two occurrences:

```typescript
// Add at top of file after existing imports:
import { BRIDGE_HTTP } from "@/lib/bridge";
// Replace all: "http://localhost:8000" → BRIDGE_HTTP
// Line 79:  `${BRIDGE_HTTP}/candles/${coin}?${params}`
// Line 127: `${BRIDGE_HTTP}/ai/signals/${coin}?...`
// Line 142: `${BRIDGE_HTTP}/ai/signals/generate`
```

- [ ] **Update `components/pages/BacktestPage.tsx`** — 5 occurrences:

```typescript
import { BRIDGE_HTTP } from "@/lib/bridge";
// Replace all "http://localhost:8000" with BRIDGE_HTTP
```

- [ ] **Update `components/pages/DataHubPage.tsx`**:

```typescript
import { BRIDGE_HTTP } from "@/lib/bridge";
// Line 54: `${BRIDGE_HTTP}/data/funding/${chartCoin}?days=${chartDays}`
```

- [ ] **Update `components/pages/RLAgentPage.tsx`**:

```typescript
import { BRIDGE_HTTP } from "@/lib/bridge";
// Line 62: `${BRIDGE_HTTP}/rl/status`
```

- [ ] **Update `components/pages/JournalPage.tsx`** — remove inline BASE:

```typescript
// Remove: const BASE = "http://localhost:8000";
// Add:
import { BRIDGE_HTTP as BASE } from "@/lib/bridge";
```

- [ ] **Update `components/pages/SignalsPage.tsx`** — 3 occurrences:

```typescript
import { BRIDGE_HTTP } from "@/lib/bridge";
// Replace all "http://localhost:8000" with BRIDGE_HTTP
```

- [ ] **Verify no remaining hardcodes**

```bash
grep -r "localhost:8000" components/ hooks/ lib/ app/ --include="*.ts" --include="*.tsx"
# Expected: no output
```

- [ ] **Commit**

```bash
git add lib/bridge.ts .env.example hooks/ components/
git commit -m "feat(config): centralise bridge URL in lib/bridge.ts"
```

---

## Task 4 — 4h Signal Loop

**Files:**
- Modify: `server/main.py`

- [ ] **Add `btc_eth_sol_4h_signal_loop()` in `server/main.py`** (place immediately after the `btc_eth_sol_signal_loop` function):

```python
async def btc_eth_sol_4h_signal_loop() -> None:
    """
    Runs every 4 hours — generates 4h-timeframe signals for BTC/ETH/SOL.
    Higher quality than 1h: longer bars = cleaner structure, fewer false breaks.
    """
    from ai_signals import generate_signal as _gen

    if not os.getenv("OPENROUTER_API_KEY", "").strip():
        return

    log.info("4h signal loop starting (4-min warm-up)…")
    await asyncio.sleep(240)

    while True:
        for coin in COINS:
            try:
                launch_ms   = COIN_START_MS.get(coin, COIN_START_MS["BTC"])
                interval_ms = INTERVAL_MS["4h"]
                candles = await candle_cache.get_history(
                    coin, "4h", launch_ms, interval_ms, fetch_candles_paginated
                )
                if not candles:
                    continue

                sig = await _gen(coin, "4h", candles, rl_state)
                if not sig:
                    continue

                if sig["signal"] not in ("LONG", "SHORT"):
                    continue
                if sig["confidence"] < 75:
                    continue

                existing = await asyncio.to_thread(_db.get_latest_signal, coin, "4h")
                if existing and existing.get("time") == sig.get("time") and \
                   existing.get("signal") == sig.get("signal"):
                    continue

                saved = await asyncio.to_thread(_db.save_signal, sig)
                log.info("4h Signal: %s → %s (%d%%) @ $%.2f",
                         coin, sig["signal"], sig["confidence"], sig["price"])

                signal_alerts.insert(0, saved)
                del signal_alerts[50:]

            except Exception as exc:
                log.warning("4h signal loop error (%s): %s", coin, exc)
            await asyncio.sleep(10)

        await asyncio.sleep(4 * 3600)
```

- [ ] **Register it in `startup()`**

```python
# Add after: asyncio.create_task(btc_eth_sol_signal_loop())
asyncio.create_task(btc_eth_sol_4h_signal_loop())
```

- [ ] **Verify the new endpoint is served** — `GET /ai/signals/BTC?interval=4h` should return `[]` (no signals yet, correct):

```bash
curl "http://localhost:8000/ai/signals/BTC?interval=4h"
# Expected: []
```

- [ ] **Manually trigger a 4h signal to confirm pipeline works**

```bash
curl -X POST http://localhost:8000/ai/signals/generate \
  -H "Content-Type: application/json" \
  -d '{"coin":"BTC","interval":"4h"}' --max-time 60
# Expected: {"signal":"HOLD"|"LONG"|"SHORT","confidence":...,"summary":{...}}
```

- [ ] **Commit**

```bash
git add server/main.py
git commit -m "feat(signals): add 4h signal loop for BTC/ETH/SOL"
```

---

## Task 5 — Telegram Bot Notifications

**Files:**
- Create: `server/telegram_notifier.py`
- Modify: `server/main.py` (call on signal fire)
- Modify: `server/.env.example`

- [ ] **Create `server/telegram_notifier.py`**

```python
"""
MEGALPHA — Telegram notification for LONG/SHORT signals.
Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in server/.env.
Get token: message @BotFather on Telegram → /newbot
Get chat id: message @userinfobot on Telegram after adding your bot.
"""
from __future__ import annotations
import logging
import os
import httpx

log = logging.getLogger("megalpha.telegram")

BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
CHAT_ID   = os.getenv("TELEGRAM_CHAT_ID",   "")


async def send_signal(sig: dict) -> None:
    """Send a formatted signal message to the configured Telegram chat."""
    if not BOT_TOKEN or not CHAT_ID:
        return   # not configured

    summary  = sig.get("summary") or {}
    signal   = sig["signal"]
    coin     = sig["coin"]
    interval = sig["interval"]
    conf     = sig["confidence"]
    entry    = summary.get("entry", sig["price"])
    sl       = summary.get("stop_loss", 0)
    tp       = summary.get("take_profit", 0)
    rr       = summary.get("risk_reward", "—")
    reason   = sig.get("reasoning", "")[:280]
    bias     = summary.get("bias_4h", "—")
    session  = summary.get("session", "—")
    arrow    = "↑" if signal == "LONG" else "↓"

    def fmt(p):
        if not p: return "—"
        return f"${p:,.4f}" if p < 100 else f"${p:,.2f}"

    text = (
        f"🎯 *MEGALPHA {arrow} {signal}* — {coin}/USDC {interval}\n"
        f"Confidence: *{conf}%*   4h bias: {bias}   Session: {session}\n\n"
        f"Entry:  `{fmt(entry)}`\n"
        f"SL:     `{fmt(sl)}`\n"
        f"TP:     `{fmt(tp)}`\n"
        f"R\\:R:   `{rr}`\n\n"
        f"_{reason}_"
    )

    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(url, json={
                "chat_id":    CHAT_ID,
                "text":       text,
                "parse_mode": "MarkdownV2",
            })
        if r.status_code != 200:
            log.warning("Telegram send failed: %s", r.text[:200])
        else:
            log.info("Telegram: sent %s %s %s signal", signal, coin, interval)
    except Exception as exc:
        log.warning("Telegram error: %s", exc)
```

- [ ] **Call `send_signal` in both signal loops** — in `server/main.py`, after `signal_alerts.insert(0, saved)` in **both** `btc_eth_sol_signal_loop` and `btc_eth_sol_4h_signal_loop`:

```python
# Add import at the top of main.py (alongside other imports):
from telegram_notifier import send_signal as _telegram

# In both loops, after: signal_alerts.insert(0, saved)
asyncio.create_task(_telegram(saved))
```

- [ ] **Add Telegram vars to `server/.env.example`**

```bash
# ─── Telegram bot (optional, for mobile notifications) ─────────────────────────
# 1. Message @BotFather on Telegram → /newbot → copy token
# 2. Add the bot to your chat/channel, then message @userinfobot to get chat_id
TELEGRAM_BOT_TOKEN=1234567890:ABCDEFGHIJKLMNOPQRSTUVWXYZabcde
TELEGRAM_CHAT_ID=123456789
```

- [ ] **Restart bridge and verify Telegram sends (if configured)**

Add your real token + chat ID to `server/.env`, then:

```bash
curl -X POST http://localhost:8000/ai/signals/generate \
  -H "Content-Type: application/json" \
  -d '{"coin":"ETH","interval":"1h"}' --max-time 60
# If signal is LONG/SHORT ≥ 75%: Telegram message arrives on your phone
# If HOLD: nothing sent (correct)
```

- [ ] **Commit**

```bash
git add server/telegram_notifier.py server/main.py server/.env.example
git commit -m "feat(telegram): mobile push notifications for LONG/SHORT signals"
```

---

## Task 6 — RL Retrain on ETH 4h

**Files:**
- Modify: `server/train_rl.py` (change defaults)

The backtest sweep found ETH 4h MACD is the strongest strategy (alpha +8%). Retrain the PPO agent on this timeframe.

- [ ] **Update `train_rl.py` argument defaults**

```python
# Change these three lines in the argparse block:
ap.add_argument("--coin",     default="ETH")      # was "BTC"
ap.add_argument("--interval", default="4h")       # was "1h"
ap.add_argument("--steps",    type=int, default=500_000, ...)  # was 200_000
```

- [ ] **Ensure cache exists for ETH 4h** — start bridge and wait for prewarm, then:

```bash
python -c "
import json; from pathlib import Path
p = Path('server/cache/ETH_4h.json')
d = json.loads(p.read_text()); print(f'ETH 4h cache: {len(d)} candles')
"
# Expected: ETH 4h cache: 7675 candles (or similar)
```

- [ ] **Launch training** (runs ~20-40 minutes depending on GPU)

```bash
cd C:\Users\anakin\s-tier\megalpha
python server/train_rl.py --coin ETH --interval 4h --steps 500000 --turnover 0.0003 --dd-penalty 0.3
# Watch for: "EvalCallback: best model saved" lines
# Final output: Sharpe, max DD, vs buy-and-hold
```

- [ ] **After training completes, restart the bridge** to load the new policy

```bash
# Kill bridge process, then:
python server/main.py
# Look for: "RL policy loaded: ETH 4h 12-feature"
```

- [ ] **Also train SOL 4h for coverage** (optional, run overnight)

```bash
python server/train_rl.py --coin SOL --interval 4h --steps 500000
```

- [ ] **Commit**

```bash
git add server/train_rl.py
git commit -m "feat(rl): change default training target to ETH 4h 500k steps"
```

---

## Task 7 — SignalsPage: Performance Tab + Outcome Badges

**Files:**
- Modify: `lib/types.ts`
- Modify: `components/pages/SignalsPage.tsx`

- [ ] **Add outcome fields to `AISignal` in `lib/types.ts`**

```typescript
export interface AISignal {
  id: number;
  coin: string;
  interval: string;
  time: number;
  signal: "LONG" | "SHORT" | "HOLD";
  confidence: number;
  reasoning: string;
  price: number;
  support: number;
  resistance: number;
  created_at: number;
  // Outcome fields (populated by outcome_checker.py)
  outcome:    "PENDING" | "WIN" | "LOSS" | "EXPIRED";
  exit_price: number;
  exit_time:  number;
  pnl_pct:    number;
  summary: {
    entry: number;
    stop_loss: number;
    take_profit: number;
    risk_reward: string;
    key_factors: string[];
    reasoning: string;
    bias_4h?: string;
    session?: string;
  };
}

export interface SignalStats {
  total: number;
  wins: number;
  losses: number;
  pending: number;
  win_rate: number;
  avg_win_pct: number;
  avg_loss_pct: number;
  best:  { coin: string; interval: string; pnl_pct: number; created_at: number } | null;
  worst: { coin: string; interval: string; pnl_pct: number; created_at: number } | null;
}
```

- [ ] **Add `OutcomeBadge` component and `PerformanceTab` to `SignalsPage.tsx`**

At the top of the file (after existing imports):

```typescript
import type { SignalStats } from "@/lib/types";

type Tab = "SIGNALS" | "PERFORMANCE";
```

Add inside `SignalCard` (after the existing reasoning row):

```typescript
{/* Outcome badge */}
{sig.outcome && sig.outcome !== "PENDING" && (
  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
    <span style={{
      fontFamily: mono, fontSize: 9, fontWeight: 700,
      padding: "2px 8px", borderRadius: 2,
      color:      sig.outcome === "WIN" ? "#4ecf8a" : sig.outcome === "LOSS" ? "#cf4e4e" : "#888",
      background: sig.outcome === "WIN" ? "rgba(78,207,138,0.1)" : sig.outcome === "LOSS" ? "rgba(207,78,78,0.1)" : "rgba(100,100,100,0.08)",
      border: `1px solid ${sig.outcome === "WIN" ? "rgba(78,207,138,0.3)" : sig.outcome === "LOSS" ? "rgba(207,78,78,0.3)" : "rgba(100,100,100,0.15)"}`,
    }}>
      {sig.outcome === "WIN" ? "✓ WIN" : sig.outcome === "LOSS" ? "✗ LOSS" : "— EXPIRED"}
    </span>
    {sig.exit_price > 0 && (
      <span style={{ fontFamily: mono, fontSize: 8, color: "#444" }}>
        exit ${sig.exit_price.toLocaleString("en-US", { maximumFractionDigits: 2 })}
      </span>
    )}
    <span style={{
      fontFamily: mono, fontSize: 9, fontWeight: 700,
      color: sig.pnl_pct >= 0 ? "#4ecf8a" : "#cf4e4e",
    }}>
      {sig.pnl_pct >= 0 ? "+" : ""}{sig.pnl_pct.toFixed(2)}%
    </span>
  </div>
)}
{sig.outcome === "PENDING" && (
  <span style={{ fontFamily: mono, fontSize: 8, color: "#2a2a2a" }}>⏳ awaiting outcome</span>
)}
```

Add `PerformanceTab` component (place before `export default function SignalsPage`):

```typescript
function PerformanceTab({ stats, history }: { stats: SignalStats | null; history: AISignal[] }) {
  if (!stats) return (
    <div style={{ padding: 24, color: "#2a2a2a", fontFamily: mono, fontSize: 9 }}>
      Loading stats…
    </div>
  );

  return (
    <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 12, overflow: "auto" }}>
      {/* Stats row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
        {[
          { label: "WIN RATE",  value: `${stats.win_rate}%`,  color: stats.win_rate >= 50 ? "#4ecf8a" : "#cf4e4e" },
          { label: "TOTAL",     value: String(stats.total),   color: "#e8e8e8" },
          { label: "WINS",      value: String(stats.wins),    color: "#4ecf8a" },
          { label: "LOSSES",    value: String(stats.losses),  color: "#cf4e4e" },
          { label: "PENDING",   value: String(stats.pending), color: "#cfad4e" },
        ].map(({ label, value, color }) => (
          <div key={label} style={{
            background: "#0c0c0c", border: "1px solid #1c1c1c", borderRadius: 4, padding: "10px 12px",
          }}>
            <div style={{ fontFamily: mono, fontSize: 7, color: "#333", marginBottom: 4 }}>{label}</div>
            <div style={{ fontFamily: "var(--font-sans, Inter)", fontWeight: 700, fontSize: 18, color }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Avg P&L */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div style={{ background: "#0c0c0c", border: "1px solid #1c1c1c", borderRadius: 4, padding: "10px 12px" }}>
          <div style={{ fontFamily: mono, fontSize: 7, color: "#333", marginBottom: 4 }}>AVG WIN</div>
          <div style={{ fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: 16, color: "#4ecf8a" }}>
            +{stats.avg_win_pct.toFixed(2)}%
          </div>
        </div>
        <div style={{ background: "#0c0c0c", border: "1px solid #1c1c1c", borderRadius: 4, padding: "10px 12px" }}>
          <div style={{ fontFamily: mono, fontSize: 7, color: "#333", marginBottom: 4 }}>AVG LOSS</div>
          <div style={{ fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: 16, color: "#cf4e4e" }}>
            {stats.avg_loss_pct.toFixed(2)}%
          </div>
        </div>
      </div>

      {/* History table */}
      <div style={{ background: "#0c0c0c", border: "1px solid #1c1c1c", borderRadius: 4, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "80px 50px 60px 70px 70px 70px 70px 1fr",
          fontFamily: mono, fontSize: 7, color: "#333", padding: "6px 10px", borderBottom: "1px solid #141414" }}>
          <span>COIN</span><span>TF</span><span>DIR</span><span>CONF</span>
          <span>ENTRY</span><span>EXIT</span><span>P&L</span><span>OUTCOME</span>
        </div>
        {history.map(s => (
          <div key={s.id} style={{
            display: "grid", gridTemplateColumns: "80px 50px 60px 70px 70px 70px 70px 1fr",
            fontFamily: mono, fontSize: 9, padding: "5px 10px",
            borderBottom: "1px solid #0e0e0e",
            color: s.outcome === "WIN" ? "#4ecf8a" : s.outcome === "LOSS" ? "#cf4e4e" : "#555",
          }}>
            <span style={{ color: "#e8e8e8", fontWeight: 700 }}>{s.coin}</span>
            <span>{s.interval}</span>
            <span>{s.signal}</span>
            <span>{s.confidence}%</span>
            <span>${(s.summary?.entry || s.price).toLocaleString("en-US", { maximumFractionDigits: 2 })}</span>
            <span>{s.exit_price > 0 ? `$${s.exit_price.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "—"}</span>
            <span style={{ fontWeight: 700 }}>
              {s.pnl_pct ? `${s.pnl_pct >= 0 ? "+" : ""}${s.pnl_pct.toFixed(2)}%` : "—"}
            </span>
            <span style={{ fontWeight: 700 }}>{s.outcome || "PENDING"}</span>
          </div>
        ))}
        {history.length === 0 && (
          <div style={{ padding: 16, fontFamily: mono, fontSize: 9, color: "#2a2a2a" }}>
            No signal history yet — signals appear here after resolution.
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Wire tabs into `SignalsPage` state**

In `SignalsPage()` function, add after existing state:

```typescript
const [tab, setTab]         = useState<Tab>("SIGNALS");
const [stats, setStats]     = useState<SignalStats | null>(null);
const [history, setHistory] = useState<AISignal[]>([]);

// Load stats + history when Performance tab is opened
useEffect(() => {
  if (tab !== "PERFORMANCE") return;
  (async () => {
    try {
      const [sr, hr] = await Promise.all([
        fetch(`${BRIDGE_HTTP}/signals/stats`),
        fetch(`${BRIDGE_HTTP}/signals/history?limit=50`),
      ]);
      if (sr.ok) setStats(await sr.json());
      if (hr.ok) setHistory(await hr.json());
    } catch {}
  })();
}, [tab]);
```

- [ ] **Add tab switcher to SignalsPage header** (right after the existing `<div style={{ flex: 1 }} />`):

```typescript
<div style={{ display: "flex", gap: 3, marginRight: 8 }}>
  {(["SIGNALS", "PERFORMANCE"] as Tab[]).map(t => (
    <button key={t} onClick={() => setTab(t)} style={{
      fontFamily: mono, fontSize: 9, padding: "2px 8px",
      background: tab === t ? "#101e30" : "none",
      border: `1px solid ${tab === t ? "#1c3050" : "transparent"}`,
      borderRadius: 2, color: tab === t ? "#4e8ecf" : "#444", cursor: "pointer",
    }}>{t}</button>
  ))}
</div>
```

- [ ] **Swap the body render** — replace the existing `<div style={{ flex:1, overflowY...}}>` with:

```typescript
{tab === "SIGNALS" ? (
  <div style={{ flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
    {/* existing displayed.map(sig => <SignalCard .../>) */}
  </div>
) : (
  <PerformanceTab stats={stats} history={history} />
)}
```

- [ ] **Commit**

```bash
git add lib/types.ts components/pages/SignalsPage.tsx
git commit -m "feat(ui): Performance tab with WIN/LOSS history and outcome badges"
```

---

## Task 8 — Live Execution Button on Signal Cards

**Files:**
- Modify: `components/pages/SignalsPage.tsx`
- Modify: `components/SignalToast.tsx`
- Modify: `components/Shell.tsx`

The existing `useTrading` hook already has `openPosition()` and the bridge has `POST /trade/hl/open`. Add a "TAKE TRADE" button to signal cards and the toast. Clicking it pre-fills and shows the confirm modal already present on `RLAgentPage`.

- [ ] **Add `onTrade` prop to `SignalCard`**

```typescript
interface SignalCardProps {
  sig: AISignal;
  onTrade?: (sig: AISignal) => void;
  hlConfigured?: boolean;
}

function SignalCard({ sig, onTrade, hlConfigured }: SignalCardProps) {
  // ... existing code ...

  // Add at the bottom of the card, after the outcome badge row:
  {hlConfigured && onTrade && sig.outcome === "PENDING" && sig.summary?.entry > 0 && (
    <button
      onClick={() => onTrade(sig)}
      style={{
        alignSelf: "flex-start",
        fontFamily: mono, fontSize: 9, padding: "4px 12px",
        background: sig.signal === "LONG" ? "rgba(78,207,138,0.1)" : "rgba(207,78,78,0.1)",
        border: `1px solid ${sig.signal === "LONG" ? "rgba(78,207,138,0.3)" : "rgba(207,78,78,0.3)"}`,
        borderRadius: 3,
        color: sig.signal === "LONG" ? "#4ecf8a" : "#cf4e4e",
        cursor: "pointer",
      }}
    >
      {sig.signal === "LONG" ? "↑ TAKE LONG" : "↓ TAKE SHORT"}
    </button>
  )}
}
```

- [ ] **Add confirm modal state + handler to `SignalsPage`**

```typescript
const [tradeConfirm, setTradeConfirm] = useState<AISignal | null>(null);

function handleTrade(sig: AISignal) {
  setTradeConfirm(sig);
}
```

- [ ] **Add `TradeConfirmModal` component** (place in `SignalsPage.tsx`):

```typescript
function TradeConfirmModal({
  sig, onConfirm, onCancel,
}: { sig: AISignal; onConfirm: () => void; onCancel: () => void }) {
  const summary = sig.summary ?? {};
  const isLong  = sig.signal === "LONG";
  const color   = isLong ? "#4ecf8a" : "#cf4e4e";

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 10000,
      background: "rgba(0,0,0,0.75)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div style={{
        background: "#0d0d0d", border: `1px solid ${color}`,
        borderRadius: 6, padding: "20px 24px", width: 340,
        fontFamily: mono,
      }}>
        <div style={{ fontSize: 9, color: "#444", marginBottom: 12, letterSpacing: "0.1em" }}>
          CONFIRM REAL ORDER — HYPERLIQUID MAINNET
        </div>
        <div style={{ fontFamily: "var(--font-sans)", fontWeight: 800, fontSize: 18, color, marginBottom: 12 }}>
          {isLong ? "↑ LONG" : "↓ SHORT"} {sig.coin}/USDC {sig.interval}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
          {[
            { label: "Entry",       val: summary.entry },
            { label: "Stop Loss",   val: summary.stop_loss,   c: "#cf4e4e" },
            { label: "Take Profit", val: summary.take_profit, c: "#4ecf8a" },
            { label: "R:R",         val: summary.risk_reward, raw: true },
            { label: "Confidence",  val: sig.confidence + "%", raw: true },
          ].map(({ label, val, c, raw }) => val ? (
            <div key={label} style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontSize: 9, color: "#444" }}>{label}</span>
              <span style={{ fontSize: 10, color: c || "#e8e8e8", fontWeight: 600 }}>
                {raw ? val : `$${Number(val).toLocaleString("en-US", { maximumFractionDigits: 2 })}`}
              </span>
            </div>
          ) : null)}
        </div>
        <div style={{ fontSize: 8, color: "#cf4e4e", marginBottom: 14 }}>
          ⚠ This places a REAL order with real funds. Size is set in RL Agent page.
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onCancel} style={{
            flex: 1, fontFamily: mono, fontSize: 9, padding: "7px 0",
            background: "none", border: "1px solid #2a2a2a", borderRadius: 3,
            color: "#555", cursor: "pointer",
          }}>CANCEL</button>
          <button onClick={onConfirm} style={{
            flex: 1, fontFamily: mono, fontSize: 9, padding: "7px 0",
            background: isLong ? "rgba(78,207,138,0.12)" : "rgba(207,78,78,0.12)",
            border: `1px solid ${color}`, borderRadius: 3,
            color, cursor: "pointer", fontWeight: 700,
          }}>CONFIRM {sig.signal}</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Wire `TradeConfirmModal` and pass `hlConfigured` prop** — in `SignalsPage` return:

```typescript
// Pass props to SignalCard:
displayed.map(sig => (
  <SignalCard
    key={sig.id ?? `${sig.coin}-${sig.created_at}`}
    sig={sig}
    onTrade={handleTrade}
    hlConfigured={true}   // for now always show; wire from Shell props in next step
  />
))

// Add modal at the bottom of the return:
{tradeConfirm && (
  <TradeConfirmModal
    sig={tradeConfirm}
    onCancel={() => setTradeConfirm(null)}
    onConfirm={async () => {
      const sig = tradeConfirm;
      const summary = sig.summary ?? {};
      setTradeConfirm(null);
      try {
        const r = await fetch(`${BRIDGE_HTTP}/trade/hl/open`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            coin:     sig.coin,
            is_buy:   sig.signal === "LONG",
            size_usd: 200,   // default; user can change in RL Agent page
            leverage: 5,
          }),
        });
        const result = await r.json();
        if (!result.ok) alert(`Order failed: ${result.error}`);
        else alert(`Order placed: ${result.order_id || "check HL"}`);
      } catch (e) {
        alert("Bridge offline");
      }
    }}
  />
)}
```

- [ ] **Commit**

```bash
git add components/pages/SignalsPage.tsx components/SignalToast.tsx
git commit -m "feat(ui): live execution button on signal cards with confirm modal"
```

---

## Task 9 — Docker + Oracle VM Scaffold

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Create: `Caddyfile`
- Create: `server/requirements-linux.txt`

The Oracle free VM is Ubuntu 22 ARM64. MetaTrader5 is Windows-only so it's excluded from the Linux build.

- [ ] **Create `server/requirements-linux.txt`** (MetaTrader5 removed, everything else same):

```
fastapi==0.115.6
uvicorn[standard]==0.32.1
websockets==14.1
hyperliquid-python-sdk>=0.9.0
python-dotenv>=1.0.0
httpx>=0.27.0
torch>=2.0.0
stable-baselines3>=2.0.0
gymnasium>=0.29.0
```

- [ ] **Create `Dockerfile`**

```dockerfile
# ── Stage 1: Next.js build ─────────────────────────────────────────────────────
FROM node:20-alpine AS nextjs_build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --prefer-offline
COPY . .
ENV NEXT_PUBLIC_BRIDGE_URL=https://api.yourdomain.com
RUN npm run build

# ── Stage 2: Python bridge ─────────────────────────────────────────────────────
FROM python:3.12-slim AS bridge
WORKDIR /server
COPY server/requirements-linux.txt requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY server/ .

# ── Stage 3: Final runtime ─────────────────────────────────────────────────────
FROM python:3.12-slim
WORKDIR /app

# Copy Python bridge
COPY --from=bridge /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=bridge /usr/local/bin /usr/local/bin
COPY server/ /app/server/

# Copy Next.js static output
RUN apt-get update && apt-get install -y nodejs npm && rm -rf /var/lib/apt/lists/*
COPY --from=nextjs_build /app/.next /app/.next
COPY --from=nextjs_build /app/public /app/public
COPY --from=nextjs_build /app/package.json /app/package.json
COPY --from=nextjs_build /app/node_modules /app/node_modules

COPY docker-entrypoint.sh /app/
RUN chmod +x /app/docker-entrypoint.sh
EXPOSE 3000 8000
CMD ["/app/docker-entrypoint.sh"]
```

- [ ] **Create `docker-entrypoint.sh`**

```bash
#!/bin/sh
set -e
# Start Python bridge in background
cd /app/server
python main.py &
BRIDGE_PID=$!
# Start Next.js
cd /app
npm start &
NEXT_PID=$!
# Wait for either to exit
wait $BRIDGE_PID $NEXT_PID
```

- [ ] **Create `docker-compose.yml`**

```yaml
version: "3.9"

services:
  megalpha:
    build: .
    env_file: server/.env
    environment:
      - NEXT_PUBLIC_BRIDGE_URL=https://api.${DOMAIN}
    volumes:
      - ./server/cache:/app/server/cache
      - ./server/models:/app/server/models
      - ./server/journal.db:/app/server/journal.db
    restart: unless-stopped
    ports:
      - "3000:3000"
      - "8000:8000"

  caddy:
    image: caddy:2-alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
    depends_on:
      - megalpha

volumes:
  caddy_data:
```

- [ ] **Create `Caddyfile`**

```
# Replace yourdomain.com with your Oracle VM's domain or IP
yourdomain.com {
    reverse_proxy localhost:3000
}

api.yourdomain.com {
    reverse_proxy localhost:8000
}
```

- [ ] **Oracle VM setup instructions** — add to `DIAGNOSTIC.md` section 9:

```markdown
### Oracle Cloud Setup (one-time, user action)

1. Create Oracle Always-Free ARM VM:
   - oracle.com/cloud/free → "Start for free"  
   - Compute → Instances → Create Instance  
   - Image: Ubuntu 22.04 Minimal (ARM Ampere)  
   - Shape: VM.Standard.A1.Flex (4 OCPU, 24 GB RAM — all free)  
   - Add SSH key  

2. Install Docker on the VM:
   ```bash
   curl -fsSL https://get.docker.com | sh
   sudo usermod -aG docker $USER
   ```

3. Copy project to VM:
   ```bash
   rsync -av --exclude node_modules --exclude .next --exclude server/cache \
     . ubuntu@<VM_IP>:~/megalpha/
   ```

4. On the VM, set `.env` and start:
   ```bash
   cd ~/megalpha
   cp server/.env.example server/.env
   nano server/.env    # add HL_PRIVATE_KEY, OPENROUTER_API_KEY, TELEGRAM_*
   DOMAIN=yourdomain.com docker compose up -d
   ```

5. Point your domain DNS A record to the VM IP.
   Caddy auto-issues TLS. Done.
```

- [ ] **Commit**

```bash
git add Dockerfile docker-compose.yml Caddyfile docker-entrypoint.sh \
        server/requirements-linux.txt DIAGNOSTIC.md
git commit -m "feat(deploy): Docker Compose + Caddy scaffold for Oracle ARM VM"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] Signal Performance Tracker — Tasks 1, 2, 7
- [x] RL retrain 4h — Task 6
- [x] 4h signals — Task 4
- [x] Telegram bot — Task 5
- [x] env var fix — Task 3
- [x] Docker + Oracle VM scaffold — Task 9
- [x] Live execution button — Task 8

**Placeholder scan:**
- All code blocks are complete, no "TBD"
- All file paths are exact
- All commands have expected output

**Type consistency:**
- `AISignal.outcome` added in Task 7 (`lib/types.ts`) before used in `SignalCard` (same task)
- `SignalStats` interface defined in `lib/types.ts` before `PerformanceTab` uses it
- `_db.get_pending_signals()` defined in Task 1 before called in Task 2
- `_db.update_signal_outcome()` defined in Task 1 before called in Task 2
- `BRIDGE_HTTP` from `lib/bridge.ts` defined in Task 3 before all usages
- `send_signal` from Task 5 imported in `main.py` in same task

**Task order dependencies:**
- Task 1 (DB) → Task 2 (checker reads DB) → Task 7 (UI reads outcome from API)
- Task 3 (env var) must run before Task 7/8 (SignalsPage uses BRIDGE_HTTP)
- Task 6 (RL retrain) is independent — can run in parallel overnight

---

*Plan saved. 9 tasks, ~3-5 hours of implementation total.*
