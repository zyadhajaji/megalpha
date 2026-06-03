"""
MEGALPHA — Hyperliquid live data bridge + trading server
• Streams BTC/ETH/SOL market data from wss://api.hyperliquid.xyz/ws
• Broadcasts to Next.js dashboard at ws://localhost:8000/ws every 500ms
• Provides REST endpoints for Hyperliquid trading

Configure HL_PRIVATE_KEY in server/.env to enable live trading.
"""
import asyncio
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import uvicorn
import websockets
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

import candle_cache
import strategies as _strategies
import db as _db
from telegram_notifier import send as _tg
from ai_signals import SIGNAL_CONFIDENCE_FLOOR

# ── signal alert state (populated by scanner_loop, broadcast via WS) ─────────
signal_alerts: list[dict] = []   # most recent first, capped at 50

# ── regime detection state (updated every 30 min from 4h candle cache) ───────
regime_states: dict[str, dict] = {}   # keyed by coin e.g. "BTC" → {state, adx, ...}
# ─── env / logging ────────────────────────────────────────────────────────────

load_dotenv(Path(__file__).parent / ".env")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("megalpha")

# ─── optional HL trader (graceful if private key missing) ────────────────────

hl_trader = None

HL_PRIVATE_KEY   = os.getenv("HL_PRIVATE_KEY", "").strip()
HL_VAULT_ADDRESS = os.getenv("HL_VAULT_ADDRESS", "").strip() or None

if HL_PRIVATE_KEY and HL_PRIVATE_KEY != "0xyour_private_key_here":
    try:
        from hl_trader import HLTrader
        hl_trader = HLTrader(HL_PRIVATE_KEY, vault_address=HL_VAULT_ADDRESS)
        log.info("HL trader initialized — account: %s", hl_trader.address)
    except Exception as exc:
        log.warning("HL trader disabled: %s", exc)

# ─── optional MT5 bridge ─────────────────────────────────────────────────────

mt5_bridge = None
mt5_auto_trader = None

MT5_LOGIN    = int(os.getenv("MT5_LOGIN", "0"))
MT5_PASSWORD = os.getenv("MT5_PASSWORD", "")
MT5_SERVER   = os.getenv("MT5_SERVER", "")

if MT5_LOGIN and MT5_PASSWORD and MT5_SERVER:
    try:
        from mt5_bridge import MT5Bridge
        from mt5_auto_trader import MT5AutoTrader
        mt5_bridge = MT5Bridge(MT5_LOGIN, MT5_PASSWORD, MT5_SERVER)
        _mt5_info  = mt5_bridge.get_account_info()
        _mt5_equity = float(_mt5_info.get("equity", 100.0))
        mt5_auto_trader = MT5AutoTrader(mt5_bridge, account_equity=_mt5_equity)
        log.info("MT5 bridge initialized — equity=%.2f %s",
                 _mt5_equity, _mt5_info.get("currency", ""))
    except Exception as exc:
        log.warning("MT5 bridge disabled: %s", exc)

# ─── constants ────────────────────────────────────────────────────────────────

HL_WS_URL          = "wss://api.hyperliquid.xyz/ws"

# ─── candle history constants ──────────────────────────────────────────────────

# Hyperliquid asset launch timestamps (milliseconds)
COIN_START_MS: dict[str, int] = {
    "BTC":  1668124800000,   # Nov 11 2022
    "ETH":  1669766400000,   # Nov 30 2022
    "SOL":  1672531200000,   # Jan  1 2023
    "PAXG": 1706745600000,   # Feb  1 2024 (PAX Gold — tracks physical gold price, HL perp)
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
COINS              = ["BTC", "ETH", "SOL", "PAXG"]
BROADCAST_INTERVAL = 0.5   # seconds — market data push cadence
ACCOUNT_POLL_SECS  = 5.0   # seconds — account state refresh cadence

# ─── shared in-memory state ───────────────────────────────────────────────────

prices: dict[str, float]           = {"btc": 0.0, "eth": 0.0, "sol": 0.0, "paxg": 0.0}
candles: dict[str, list]           = {c: [] for c in COINS}
open_candle: dict[str, Optional[dict]] = {c: None for c in COINS}
price_history: dict[str, list[float]]  = {c: [] for c in COINS}
order_books: dict[str, dict]       = {}
clients: list[WebSocket]           = []
hl_account_cache: dict             = {}

# ─── live-trading runtime state ──────────────────────────────────────────────
live_peak_equity: float = 0.0   # high-water mark for account-level kill-switch
live_halted: bool       = False  # True once max-DD kill-switch fires; blocks new orders
recent_fills: list      = []     # last 50 fills from userFills WS subscription

# ─── data-hub state (Phase 4) ─────────────────────────────────────────────────
market_metrics: dict = {}        # current funding/OI/vol/mark per coin, polled every 30s
recent_liquidations: list = []   # last 100 liquidation events from WS trades

# ─── RL agent state (Phase 3) ─────────────────────────────────────────────────

rl_model = None          # loaded PPO policy, or None if not trained / deps missing
rl_meta: dict            = {}            # {coin, interval, size_usd, leverage}
rl_state: Optional[dict] = None          # latest inference result for the dashboard
RL_INFER_SECS = 10.0     # how often to run live inference

# Paper-forward trading: the agent trades simulated money on real live prices so we
# can watch a true out-of-sample equity path. Resets when the bridge restarts.
rl_history: list = []        # rolling path: [{t, price, position, equity}]
rl_paper: dict = {"position": 0, "entry_px": 0.0, "realized": 0.0,
                  "trades": 0, "wins": 0, "peak": 0.0, "max_dd": 0.0}
RL_HISTORY_MAX = 180

# ─── auto-execution state ─────────────────────────────────────────────────────
# mode: "stopped" (no auto trades) | "paper" (sim only) | "live" (real HL orders)
auto_exec_mode: str  = "stopped"
auto_exec_log:  list = []          # recent executions, newest first, capped 100
auto_exec_next_scan: float = 0.0   # unix timestamp of next scheduled scan

PAPER_START_EQUITY   = 10_000.0
AUTO_EXEC_SIZE_USD   = 50.0        # USD per auto trade (HL)
AUTO_EXEC_LEVERAGE   = 5
AUTO_EXEC_SCAN_COINS = ["BTC", "ETH", "SOL", "PAXG"]

# Broker routing: "hl" | "mt5" | "both"
auto_exec_broker: str = os.getenv("AUTO_EXEC_BROKER", "hl")

# MT5 coin → broker symbol map (PAXG tracks gold → XAUUSD on most CFD brokers)
_MT5_COIN_MAP: dict[str, str] = {
    "BTC":  os.getenv("MT5_SYMBOL_BTC",  "BTCUSD"),
    "ETH":  os.getenv("MT5_SYMBOL_ETH",  "ETHUSD"),
    "SOL":  os.getenv("MT5_SYMBOL_SOL",  "SOLUSD"),
    "PAXG": os.getenv("MT5_SYMBOL_PAXG", "XAUUSD"),
}

paper_equity:    float = PAPER_START_EQUITY
paper_positions: dict  = {}   # coin → {direction, entry, sl, tp, size_usd, leverage, opened_at, strategy}
paper_trades:    list  = []   # closed paper trades, newest first, capped 50

# ─── candle builder ───────────────────────────────────────────────────────────

def push_trade(coin: str, px: float, ts_ms: int) -> None:
    minute = (ts_ms // 60_000) * 60
    hist = price_history[coin]
    hist.append(px)
    if len(hist) > 60:
        del hist[0]
    oc = open_candle[coin]
    if oc is None or oc["time"] != minute:
        if oc is not None:
            candles[coin].append(dict(oc))
            if len(candles[coin]) > 120:
                del candles[coin][0]
        open_candle[coin] = {"time": minute, "open": px, "high": px, "low": px, "close": px}
    else:
        oc["close"] = px
        if px > oc["high"]: oc["high"] = px
        if px < oc["low"]:  oc["low"]  = px

# ─── analytics ────────────────────────────────────────────────────────────────

def calc_momentum(hist: list[float]) -> int:
    if len(hist) < 2:
        return 50
    n = min(20, len(hist))
    recent = hist[-n:]
    pct = (recent[-1] - recent[0]) / (recent[0] + 1e-9) * 100
    return int(max(0, min(100, 50 + pct * 10)))


def _level_px(lvl) -> float:
    # HL returns levels as {"px","sz","n"}; tolerate legacy [px, sz] lists too
    return float(lvl["px"]) if isinstance(lvl, dict) else float(lvl[0])


def _level_sz(lvl) -> float:
    return float(lvl["sz"]) if isinstance(lvl, dict) else float(lvl[1])


OB_DEPTH = 12   # ladder levels per side sent to the dashboard


def order_book_metrics(coin: str) -> dict:
    """Live L2 snapshot for a coin: top-N bid/ask ladder plus derived metrics.

    HL sends levels as ob["levels"] = [bids, asks], each a list of {"px","sz","n"},
    best price first. We tolerate legacy [px, sz] list rows too.
    """
    ob = order_books.get(coin)
    if not ob:
        return {}
    levels = ob.get("levels")
    if not isinstance(levels, (list, tuple)) or len(levels) < 2:
        return {}
    raw_bids = levels[0][:OB_DEPTH]
    raw_asks = levels[1][:OB_DEPTH]
    if not raw_bids or not raw_asks:
        return {}
    try:
        bids = [{"px": _level_px(b), "sz": _level_sz(b)} for b in raw_bids]
        asks = [{"px": _level_px(a), "sz": _level_sz(a)} for a in raw_asks]
        best_bid, best_ask = bids[0]["px"], asks[0]["px"]
        mid = (best_bid + best_ask) / 2
        spread = best_ask - best_bid
        spread_bps = round((spread / mid) * 10_000, 2) if mid else 0.0
        bid_vol = sum(b["sz"] for b in bids)
        ask_vol = sum(a["sz"] for a in asks)
        total_vol = bid_vol + ask_vol
    except (KeyError, IndexError, ValueError, TypeError):
        return {}
    return {
        "bids":          bids,
        "asks":          asks,
        "mid":           round(mid, 4),
        "spread":        round(spread, 4),
        "spread_bps":    spread_bps,
        "bid_ask_ratio": round(bid_vol / (ask_vol + 1e-9), 3),
        "imbalance":     round((bid_vol - ask_vol) / (total_vol + 1e-9), 3),
    }

# ─── RL inference (Phase 3) ───────────────────────────────────────────────────

def _trading_session() -> str:
    h = time.gmtime().tm_hour            # UTC
    if 7 <= h < 12:   return "London"
    if 12 <= h < 21:  return "NY"
    if 0 <= h < 7:    return "Asia"
    return "Off-hours"


def load_rl_policy() -> None:
    """Load the trained PPO policy if it exists and deps are installed. Safe to call always."""
    global rl_model, rl_meta
    models_dir = Path(__file__).parent / "models"
    active = models_dir / "rl_policy_active.zip"
    meta_f = models_dir / "rl_policy_active.json"
    if not active.exists():
        log.info("RL: no trained policy found (train with server/train_rl.py) — panel stays offline")
        return
    try:
        from stable_baselines3 import PPO
    except ImportError:
        log.info("RL: policy file present but stable-baselines3/torch not installed — skipping inference")
        return
    try:
        rl_model = PPO.load(str(active.with_suffix("")), device="cpu")
        # Staleness guard: a saved policy from an older feature set has a different
        # observation width. Feeding it the current observation would error every
        # cycle, so refuse to load and ask for a retrain instead.
        from rl_features import N_FEATURES
        model_dim = int(rl_model.observation_space.shape[0])
        if model_dim != N_FEATURES:
            log.warning("RL: saved policy expects %d features but the current feature set "
                        "has %d — retrain with server/train_rl.py. Inference disabled.",
                        model_dim, N_FEATURES)
            rl_model = None
            return
        if meta_f.exists():
            rl_meta = json.loads(meta_f.read_text(encoding="utf-8"))
        log.info("RL: policy loaded — %s", rl_meta or "(no meta)")
    except Exception as exc:
        log.warning("RL: failed to load policy: %s", exc)


async def rl_inference_loop() -> None:
    """Every RL_INFER_SECS: observe, predict, and paper-trade on real live prices.

    The agent trades simulated money so the dashboard can show a genuine forward
    (out-of-sample) equity path, the action probabilities, and the exact feature
    vector the policy is reading. No real orders are ever placed.
    """
    global rl_state
    if rl_model is None:
        return
    import time
    from rl_features import compute_indicators, observation, WARMUP, FEATURE_LABELS

    coin     = (rl_meta.get("coin") or "BTC").upper()
    interval = rl_meta.get("interval") or "1h"
    interval_ms = INTERVAL_MS.get(interval, 3_600_000)
    launch_ms   = COIN_START_MS.get(coin, COIN_START_MS["BTC"])
    size = float(rl_meta.get("size_usd") or 200.0)
    lev  = float(rl_meta.get("leverage") or 5)
    fee_per_side = (4.0 / 10_000.0) * size * lev   # HL taker ~3.5–4bps on notional
    episode = 0

    while True:
        await asyncio.sleep(RL_INFER_SECS)
        episode += 1
        try:
            candle_data = await candle_cache.get_history(
                coin, interval, launch_ms, interval_ms, fetch_candles_paginated
            )
            if len(candle_data) < WARMUP + 2:
                continue
            ind = compute_indicators(candle_data)
            i   = len(candle_data) - 1

            # Observe with the agent's OWN paper position so the forward test is
            # self-consistent (the policy sees the position it is actually holding).
            held = rl_paper["position"]
            obs  = observation(ind, i, held)
            action, _ = rl_model.predict(obs, deterministic=True)
            probs = _action_probs(obs)                  # [hold, long, short]
            action_probs = [probs[1], probs[0], probs[2]]   # frontend wants [long, hold, short]
            target = {0: 0, 1: 1, 2: -1}[int(action)]

            # Live mark price (fall back to the latest candle close)
            px = float(prices.get(coin.lower(), 0.0)) or float(ind["closes"][i])

            unreal = 0.0
            if px > 0:
                # Fill: close→open when the target position changes, charging fees per side
                if target != rl_paper["position"]:
                    if rl_paper["position"] != 0 and rl_paper["entry_px"] > 0:
                        move = (px - rl_paper["entry_px"]) / rl_paper["entry_px"]
                        realized = rl_paper["position"] * move * size * lev
                        rl_paper["realized"] += realized
                        rl_paper["trades"]   += 1
                        if realized > 0:
                            rl_paper["wins"] += 1
                    sides = (1 if rl_paper["position"] != 0 else 0) + (1 if target != 0 else 0)
                    rl_paper["realized"] -= sides * fee_per_side
                    rl_paper["position"]  = target
                    rl_paper["entry_px"]  = px if target != 0 else 0.0

                if rl_paper["position"] != 0 and rl_paper["entry_px"] > 0:
                    move = (px - rl_paper["entry_px"]) / rl_paper["entry_px"]
                    unreal = rl_paper["position"] * move * size * lev

                equity = rl_paper["realized"] + unreal
                rl_paper["peak"]   = max(rl_paper["peak"], equity)
                rl_paper["max_dd"] = max(rl_paper["max_dd"], rl_paper["peak"] - equity)
                rl_history.append({"t": int(time.time() * 1000), "price": round(px, 4),
                                   "position": rl_paper["position"], "equity": round(equity, 2)})
                if len(rl_history) > RL_HISTORY_MAX:
                    del rl_history[: len(rl_history) - RL_HISTORY_MAX]
            else:
                equity = rl_paper["realized"]

            features = [
                {"key": k, "label": lbl, "value": round(float(obs[idx]), 3)}
                for idx, (k, lbl) in enumerate(FEATURE_LABELS)
            ]
            trades = rl_paper["trades"]
            rl_state = {
                "status":       "in_trade" if rl_paper["position"] != 0 else "scanning",
                "confidence":   round(float(max(probs)), 3),
                "action_probs": [round(p, 3) for p in action_probs],
                "episode":      episode,
                "session":      _trading_session(),
                "last_action":  f"{coin} {['HOLD','LONG','SHORT'][int(action)]}",
                "position":     rl_paper["position"],
                "features":     features,
                "paper": {
                    "equity":     round(equity, 2),
                    "realized":   round(rl_paper["realized"], 2),
                    "unrealized": round(unreal, 2),
                    "trades":     trades,
                    "win_rate":   round(rl_paper["wins"] / trades * 100, 1) if trades else 0.0,
                    "max_dd":     round(rl_paper["max_dd"], 2),
                    "position":   rl_paper["position"],
                },
                "last_pnl":     round(equity, 2),
            }
        except Exception as exc:
            log.debug("RL inference error: %s", exc)


def _action_probs(obs) -> list[float]:
    """Return softmax action probabilities [hold, long, short] for an observation."""
    import numpy as np
    import torch
    obs_t = torch.as_tensor(obs).float().unsqueeze(0)
    with torch.no_grad():
        dist = rl_model.policy.get_distribution(obs_t)
        probs = dist.distribution.probs.squeeze(0).cpu().numpy()
    return [float(p) for p in probs]


# ─── paginated candle fetch ───────────────────────────────────────────────────

async def fetch_candles_paginated(
    coin: str,
    interval: str,
    start_ms: int,
    end_ms: int,
    max_total: int = 5000,
) -> list[dict]:
    """
    Fetch candles from Hyperliquid REST API.

    HL's candleSnapshot caps each response at ~5000 candles and returns the MOST
    RECENT window ending at endTime (it ignores how far back startTime is). So we
    page BACKWARD: each request asks for [start_ms, cursor_end], then we move
    cursor_end to just before the earliest candle returned and repeat — until we
    reach start_ms, HL runs out of retained history, or max_total is hit.
    """
    import urllib.request as _req
    import json as _j

    url = "https://api.hyperliquid.xyz/info"
    interval_ms = INTERVAL_MS.get(interval, 3_600_000)
    all_candles: list[dict] = []
    cursor_end = end_ms
    prev_earliest: Optional[int] = None

    while cursor_end > start_ms and len(all_candles) < max_total:
        def _fetch(c=coin, s=start_ms, e=cursor_end, iv=interval):
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
            break   # HL has no more retained history this far back

        for c in result:
            all_candles.append({
                "time":  c["t"] // 1000,   # convert ms → seconds for lightweight-charts
                "open":  float(c["o"]),
                "high":  float(c["h"]),
                "low":   float(c["l"]),
                "close": float(c["c"]),
                "volume": float(c.get("v", 0.0)),
            })

        earliest_t = result[0]["t"]
        # Stop if HL stopped giving us older data (no progress) or we reached the start
        if prev_earliest is not None and earliest_t >= prev_earliest:
            break
        prev_earliest = earliest_t
        if earliest_t <= start_ms:
            break

        cursor_end = earliest_t - interval_ms
        await asyncio.sleep(0.2)   # gentle on rate limits

    # Deduplicate by time (HL returns overlapping candles at window boundaries)
    seen: set[int] = set()
    unique: list[dict] = []
    for c in all_candles:
        if c["time"] not in seen:
            seen.add(c["time"])
            unique.append(c)

    return sorted(unique, key=lambda c: c["time"])

# ─── broadcast payload ────────────────────────────────────────────────────────

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
    if rl_state:
        payload["rl_agent"] = rl_state
    payload["hl_configured"] = hl_trader is not None
    payload["live_halted"]   = live_halted
    if recent_fills:
        payload["recent_fills"] = recent_fills[-10:]
    if market_metrics:
        payload["market_metrics"] = market_metrics
    if recent_liquidations:
        payload["liquidations"] = recent_liquidations[-30:]
    if signal_alerts:
        payload["signal_alert"] = signal_alerts[0]   # latest alert only
    if regime_states:
        payload["regime"] = regime_states
    payload["auto_exec"] = {
        "mode":      auto_exec_mode,
        "next_scan": auto_exec_next_scan,
        "paper": {
            "equity":    round(paper_equity, 2),
            "pnl":       round(paper_equity - PAPER_START_EQUITY, 2),
            "positions": paper_positions,
        },
    }
    return payload

# ─── FastAPI app ──────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    # startup
    global paper_equity, paper_positions, paper_trades
    _db.init_db()
    state = _db.load_paper_state()
    if state:
        paper_equity    = state["equity"]
        paper_positions = state["positions"]
        paper_trades    = state["trades"]
        log.info("Paper state restored — equity=%.2f, positions=%d",
                 paper_equity, len(paper_positions))
    load_rl_policy()
    asyncio.create_task(fetch_historical_candles())
    asyncio.create_task(hl_listener())
    asyncio.create_task(broadcaster())
    asyncio.create_task(account_poller())
    asyncio.create_task(prewarm_history_cache())
    # rl_inference_loop disabled — RL model HOLDs 99% of the time; retrain before re-enabling
    asyncio.create_task(market_metrics_poller())
    asyncio.create_task(btc_eth_sol_signal_loop())
    asyncio.create_task(btc_eth_sol_4h_signal_loop())
    asyncio.create_task(regime_detection_loop())
    asyncio.create_task(auto_exec_loop())

    from outcome_checker import outcome_checker_loop as _outcome_loop

    async def _candle_history(coin: str, interval: str) -> list[dict]:
        launch_ms   = COIN_START_MS.get(coin, COIN_START_MS["BTC"])
        interval_ms = INTERVAL_MS.get(interval, INTERVAL_MS["1h"])
        return await candle_cache.get_history(
            coin, interval, launch_ms, interval_ms, fetch_candles_paginated
        )

    asyncio.create_task(_outcome_loop(_candle_history))
    yield
    # shutdown (nothing needed currently)


app = FastAPI(title="MEGALPHA Bridge", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",  # any local dev port
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── background tasks ─────────────────────────────────────────────────────────

# Coins that support HL WS trades/l2Book subscriptions (GOLD candle API returns 500)
HL_TRADEABLE_COINS = ["BTC", "ETH", "SOL"]


async def hl_listener() -> None:
    backoff    = 1.0    # exponential reconnect backoff (1s → 30s cap)
    connect_ts = 0.0    # time of last successful connect

    while True:
        try:
            async with websockets.connect(
                HL_WS_URL,
                ping_interval=None,   # HL manages its own heartbeat; our pings cause drops
                open_timeout=15,
            ) as ws:
                connect_ts = time.time()
                log.info("Connected to Hyperliquid WS")

                # Subscribe allMids (prices for all coins including GOLD)
                await ws.send(json.dumps({"method": "subscribe", "subscription": {"type": "allMids"}}))

                # trades + l2Book only for supported coins
                for coin in HL_TRADEABLE_COINS:
                    await ws.send(json.dumps({"method": "subscribe", "subscription": {"type": "trades",  "coin": coin}}))
                    await ws.send(json.dumps({"method": "subscribe", "subscription": {"type": "l2Book", "coin": coin}}))

                if hl_trader:
                    await ws.send(json.dumps({"method": "subscribe", "subscription": {"type": "userFills", "user": hl_trader.address}}))
                    await ws.send(json.dumps({"method": "subscribe", "subscription": {"type": "webData2",  "user": hl_trader.address}}))

                async for raw in ws:
                    try:
                        msg  = json.loads(raw)
                        ch   = msg.get("channel")
                        data = msg.get("data", {})

                        if ch == "allMids":
                            mids = data.get("mids", {})
                            for k, v in [("BTC", "btc"), ("ETH", "eth"), ("SOL", "sol"), ("PAXG", "paxg")]:
                                if k in mids:
                                    prices[v] = float(mids[k])

                        elif ch == "trades":
                            for t in (data if isinstance(data, list) else []):
                                if t.get("coin") in COINS:
                                    push_trade(t["coin"], float(t.get("px", 0)),
                                               int(t.get("time", time.time() * 1000)))
                                    if t.get("liquidation"):
                                        liq = t["liquidation"]
                                        recent_liquidations.append({
                                            "time":     int(t.get("time", time.time() * 1000)),
                                            "coin":     t.get("coin", ""),
                                            "side":     "LONG" if t.get("side") == "A" else "SHORT",
                                            "px":       float(t.get("px", 0)),
                                            "sz":       float(t.get("sz", 0)),
                                            "notional": float(t.get("px", 0)) * float(t.get("sz", 0)),
                                            "user":     (str(liq.get("liquidatedUser") or ""))[:10],
                                        })
                                        if len(recent_liquidations) > 100:
                                            del recent_liquidations[: len(recent_liquidations) - 100]

                        elif ch == "l2Book":
                            coin = data.get("coin", "")
                            if coin in COINS:
                                order_books[coin] = data

                        elif ch == "userFills":
                            fills_raw = data if isinstance(data, list) else (data.get("fills", []) if isinstance(data, dict) else [])
                            for fill in (fills_raw if isinstance(fills_raw, list) else []):
                                if isinstance(fill, dict):
                                    recent_fills.append({
                                        "coin": fill.get("coin", ""),
                                        "side": fill.get("side", ""),
                                        "px":   float(fill.get("px", 0)),
                                        "sz":   float(fill.get("sz", 0)),
                                        "time": fill.get("time", 0),
                                        "oid":  fill.get("oid", 0),
                                        "fee":  float(fill.get("fee", 0)),
                                    })
                            if len(recent_fills) > 50:
                                del recent_fills[: len(recent_fills) - 50]
                            asyncio.create_task(_refresh_account())

                        elif ch == "webData2":
                            # Account state push — trigger immediate refresh
                            asyncio.create_task(_refresh_account())

                    except Exception as exc:
                        log.debug("WS parse error: %s", exc)

        except Exception as exc:
            uptime = time.time() - connect_ts
            # Only reset backoff if connection was stable (>10s); otherwise keep backing off
            if uptime > 10:
                backoff = 1.0
            log.warning("HL WS disconnected after %.0fs (%s), reconnecting in %.0fs",
                        uptime, exc, backoff)
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 30.0)


async def broadcaster() -> None:
    while True:
        await asyncio.sleep(BROADCAST_INTERVAL)
        if not clients:
            continue
        try:
            msg  = json.dumps(build_payload())
            dead = []
            for ws in list(clients):
                try:
                    await ws.send_text(msg)
                except Exception:
                    dead.append(ws)
            for ws in dead:
                if ws in clients:
                    clients.remove(ws)
        except Exception as exc:
            log.debug("Broadcast error: %s", exc)


async def account_poller() -> None:
    """Refresh HL account state every ACCOUNT_POLL_SECS."""
    global live_peak_equity
    while True:
        await asyncio.sleep(ACCOUNT_POLL_SECS)
        if hl_trader:
            try:
                state = await asyncio.to_thread(hl_trader.get_account_state)
                hl_account_cache.clear()
                hl_account_cache.update(state)
                equity = float(state.get("account_value") or 0)
                if equity > 0:
                    live_peak_equity = max(live_peak_equity, equity)
            except Exception as exc:
                log.debug("HL account poll error: %s", exc)


async def _refresh_account() -> None:
    """Immediate account-state refresh — triggered by fills or webData2 push."""
    global live_peak_equity
    if not hl_trader:
        return
    try:
        state = await asyncio.to_thread(hl_trader.get_account_state)
        hl_account_cache.clear()
        hl_account_cache.update(state)
        equity = float(state.get("account_value") or 0)
        if equity > 0:
            live_peak_equity = max(live_peak_equity, equity)
    except Exception as exc:
        log.debug("Account refresh error: %s", exc)


def _fetch_market_metrics_sync() -> dict:
    """Synchronous: call HL metaAndAssetCtxs and return per-coin metrics dict."""
    import urllib.request as _req
    import json as _j
    url = "https://api.hyperliquid.xyz/info"
    payload = _j.dumps({"type": "metaAndAssetCtxs"}).encode()
    req = _req.Request(url, data=payload, headers={"Content-Type": "application/json"})
    with _req.urlopen(req, timeout=10) as resp:
        result = _j.loads(resp.read())
    meta_obj, ctxs = result[0], result[1]
    universe = meta_obj.get("universe", [])
    out: dict = {}
    for i, asset in enumerate(universe):
        name = asset.get("name", "")
        if name not in COINS or i >= len(ctxs):
            continue
        ctx = ctxs[i]
        rate = float(ctx.get("funding") or 0)
        mark = float(ctx.get("markPx") or ctx.get("midPx") or 0)
        prev = float(ctx.get("prevDayPx") or 0)
        oi   = float(ctx.get("openInterest") or 0)
        vol  = float(ctx.get("dayNtlVlm") or 0)
        out[name] = {
            "funding_rate":  rate,
            "funding_apr":   rate * 24 * 365 * 100,   # assuming 1-hour periods
            "open_interest": oi,
            "oi_usd":        oi * mark,
            "mark_px":       mark,
            "prev_day_px":   prev,
            "day_ntl_vol":   vol,
            "day_change_pct": (mark - prev) / prev * 100 if prev > 0 else 0.0,
        }
    return out


async def market_metrics_poller() -> None:
    """Poll HL metaAndAssetCtxs every 30s for live funding, OI, and volume."""
    while True:
        try:
            result = await asyncio.to_thread(_fetch_market_metrics_sync)
            market_metrics.clear()
            market_metrics.update(result)
        except Exception as exc:
            log.debug("Market metrics poll error: %s", exc)
        await asyncio.sleep(30)


async def regime_detection_loop() -> None:
    """
    Compute market regime for each coin every 30 minutes from 4h cached candles.
    Stores results in global regime_states dict (broadcast via WS payload).
    """
    await asyncio.sleep(15)   # brief warm-up after startup
    while True:
        for coin in COINS:
            try:
                launch_ms   = COIN_START_MS.get(coin, COIN_START_MS["BTC"])
                interval_ms = INTERVAL_MS["4h"]
                candle_data = await candle_cache.get_history(
                    coin, "4h", launch_ms, interval_ms, fetch_candles_paginated
                )
                if not candle_data or len(candle_data) < 60:
                    continue
                from strategies_mega import detect_regime as _detect_regime
                regime = await asyncio.to_thread(_detect_regime, candle_data)
                regime_states[coin] = regime
                log.debug("Regime [%s]: %s (ADX=%.1f score=%.2f)", coin, regime["state"], regime["adx"], regime["score"])
            except Exception as exc:
                log.debug("Regime detection error (%s): %s", coin, exc)
            await asyncio.sleep(2)
        await asyncio.sleep(30 * 60)   # re-evaluate every 30 minutes


async def reconcile_after(coin: str, delay_secs: float = 60.0) -> None:
    """Post-trade reconciliation: refresh account state after delay and log the position."""
    await asyncio.sleep(delay_secs)
    await _refresh_account()
    pos = next(
        (p for p in hl_account_cache.get("positions", []) if p.get("coin") == coin.upper()),
        None,
    )
    log.info("Reconcile [%s] — position: %s", coin, pos or "none")


async def fetch_historical_candles() -> None:
    """Pre-fill 100 real 1-minute candles per coin from Hyperliquid REST API."""
    import urllib.request as _req
    url = "https://api.hyperliquid.xyz/info"
    now_ms = int(time.time() * 1000)
    start_ms = now_ms - 120 * 60 * 1000  # 2 hours back → gives ~100 candles

    for coin in COINS:
        try:
            def _fetch(c=coin):
                import json as _j
                payload = _j.dumps({
                    "type": "candleSnapshot",
                    "req": {"coin": c, "interval": "1m", "startTime": start_ms, "endTime": now_ms}
                }).encode()
                req = _req.Request(url, data=payload, headers={"Content-Type": "application/json"})
                with _req.urlopen(req, timeout=10) as resp:
                    return _j.loads(resp.read())

            result = await asyncio.to_thread(_fetch)
            for c in result[-100:]:
                candles[coin].append({
                    "time":  c["t"] // 1000,
                    "open":  float(c["o"]),
                    "high":  float(c["h"]),
                    "low":   float(c["l"]),
                    "close": float(c["c"]),
                    "volume": float(c.get("v", 0.0)),
                })
            log.info("Pre-loaded %d candles for %s", len(candles[coin]), coin)
        except Exception as exc:
            log.warning("Historical candles failed for %s: %s", coin, exc)
        await asyncio.sleep(0.5)  # be gentle with HL rate limits


async def prewarm_history_cache() -> None:
    """
    Build the full-history disk cache for the most-used timeframes in the background
    so the first chart load is instant. Cold (first ever) run fetches from each token's
    launch; later runs only fetch the delta. Runs sequentially to respect HL rate limits.
    """
    await asyncio.sleep(2)  # let the live listener connect first
    for interval in ("15m", "1h", "4h", "1d"):
        for coin in COINS:
            try:
                history = await candle_cache.get_history(
                    coin, interval,
                    COIN_START_MS.get(coin, COIN_START_MS["BTC"]),
                    INTERVAL_MS[interval],
                    fetch_candles_paginated,
                )
                log.info("Cache warm: %s %s → %d candles", coin, interval, len(history))
            except Exception as exc:
                log.warning("Cache warm failed (%s %s): %s", coin, interval, exc)


# ─── auto-execution engine ────────────────────────────────────────────────────

def _check_paper_sl_tp() -> None:
    """Check open paper positions against live prices; close on SL or TP hit."""
    global paper_equity, paper_positions, paper_trades
    for coin in list(paper_positions.keys()):
        pos = paper_positions[coin]
        current = prices.get(coin.lower(), 0.0)
        if not current:
            continue
        is_long = pos["direction"] == "LONG"
        hit_sl  = (is_long and current <= pos["sl"]) or (not is_long and current >= pos["sl"])
        hit_tp  = (is_long and current >= pos["tp"]) or (not is_long and current <= pos["tp"])
        if not (hit_sl or hit_tp):
            continue
        exit_px  = pos["sl"] if hit_sl else pos["tp"]
        pnl_pct  = (exit_px - pos["entry"]) / (pos["entry"] + 1e-9) * (1 if is_long else -1)
        pnl_usd  = pos["size_usd"] * pnl_pct * pos.get("leverage", AUTO_EXEC_LEVERAGE)
        paper_equity += pnl_usd
        trade = {
            "coin":      coin,
            "direction": pos["direction"],
            "entry":     pos["entry"],
            "exit":      round(exit_px, 6),
            "sl":        pos["sl"],
            "tp":        pos["tp"],
            "pnl_usd":   round(pnl_usd, 2),
            "result":    "TP" if hit_tp else "SL",
            "opened_at": pos["opened_at"],
            "closed_at": int(time.time()),
            "strategy":  pos.get("strategy", "?"),
        }
        paper_trades.insert(0, trade)
        if len(paper_trades) > 50:
            paper_trades.pop()
        del paper_positions[coin]
        log.info("Paper %s %s %s — PnL $%.2f (equity $%.2f)",
                 trade["result"], coin, pos["direction"], pnl_usd, paper_equity)


async def _auto_exec_coin(coin: str, interval: str) -> None:
    """Run strategy scan for one coin; execute if ≥2 strategies agree."""
    global auto_exec_log, live_peak_equity, paper_equity, paper_positions

    try:
        # Skip if already in a paper position for this coin
        if auto_exec_mode == "paper" and coin in paper_positions:
            return

        # Live mode pre-checks (per broker)
        acct = {}  # HL account state, populated below if needed
        if auto_exec_mode == "live":
            if auto_exec_broker in ("hl", "both"):
                if live_halted:
                    return
                if hl_trader:
                    acct = await asyncio.to_thread(hl_trader.get_account_state)
                    if next((p for p in acct.get("positions", [])
                             if p["coin"] == coin.upper()), None):
                        return  # already in HL position for this coin

        # Load candles from cache
        launch_ms   = COIN_START_MS.get(coin, COIN_START_MS["BTC"])
        interval_ms = INTERVAL_MS.get(interval, INTERVAL_MS["1h"])
        candle_data = await candle_cache.get_history(
            coin, interval, launch_ms, interval_ms, fetch_candles_paginated
        )
        candle_4h = await candle_cache.get_history(
            coin, "4h", launch_ms, INTERVAL_MS["4h"], fetch_candles_paginated
        )
        if len(candle_data) < 55:
            return

        # Run all 4 strategies in a thread
        from strategies_mega import (
            score_strategy_a, signal_strategy_b,
            detect_fu_candle, score_strategy_d,
        )

        def _run():
            return {
                "A": score_strategy_a(candle_data, coin),
                "B": signal_strategy_b(candle_data, candle_4h) if len(candle_4h) >= 60 else None,
                "C": detect_fu_candle(candle_data),
                "D": score_strategy_d(candle_data, coin),
            }

        results = await asyncio.to_thread(_run)

        # Compute consensus
        longs  = [k for k, v in results.items() if v and v.get("direction") == "long"]
        shorts = [k for k, v in results.items() if v and v.get("direction") == "short"]

        if len(longs) >= 2:
            direction, winners = "LONG", longs
        elif len(shorts) >= 2:
            direction, winners = "SHORT", shorts
        else:
            return  # no consensus

        # Optional triple-gate: require AI signal to agree before executing
        if os.getenv("REQUIRE_AI_CONFIRM", "0") == "1":
            recent_sig = await asyncio.to_thread(_db.get_latest_signal, coin, interval)
            if not recent_sig:
                log.info("Auto-exec %s %s: no AI signal yet — skipping", coin, direction)
                return
            sig_age = time.time() - recent_sig.get("created_at", 0)
            if recent_sig.get("signal") != direction or sig_age > 7200:  # 2h max age
                log.info("Auto-exec %s %s: AI signal disagrees or stale (%s, age=%.0fs) — skipping",
                         coin, direction, recent_sig.get("signal"), sig_age)
                return
            log.info("Auto-exec %s %s: AI+strategy consensus confirmed — executing", coin, direction)

        # Pick best signal (highest score or rr)
        best_key, best_result = sorted(
            [(k, results[k]) for k in winners],
            key=lambda x: x[1].get("score", x[1].get("rr", 0) or 0),
            reverse=True,
        )[0]

        entry = float(best_result.get("entry") or 0)
        sl    = float(best_result.get("sl")    or 0)
        tp    = float(best_result.get("tp1")   or 0)

        if not entry or not sl or not tp:
            return

        outcome: dict = {}

        if auto_exec_mode == "paper":
            paper_positions[coin] = {
                "direction": direction,
                "entry":     entry,
                "sl":        sl,
                "tp":        tp,
                "size_usd":  AUTO_EXEC_SIZE_USD,
                "leverage":  AUTO_EXEC_LEVERAGE,
                "opened_at": int(time.time()),
                "strategy":  ",".join(winners),
            }
            outcome = {"ok": True, "mode": "paper"}
            log.info("Auto-exec PAPER %s %s @%.4f [%s]", direction, coin, entry, ",".join(winners))
            asyncio.create_task(_save_paper())
            asyncio.create_task(_tg(
                f"<b>Auto-exec PAPER</b> {coin} {direction} @${entry:,.4f}\n"
                f"SL ${sl:,.4f} | TP ${tp:,.4f} | Strategies: {','.join(winners)}"
            ))

        elif auto_exec_mode == "live":
            outcomes: list[dict] = []

            # ── Hyperliquid ────────────────────────────────────────────────
            if auto_exec_broker in ("hl", "both") and hl_trader and not live_halted:
                hl_eq = float(acct.get("account_value") or 0)
                if hl_eq > 0:
                    live_peak_equity = max(live_peak_equity, hl_eq)
                ob   = order_books.get(coin.upper(), {})
                lvls = ob.get("levels", [[], []])
                bids, asks = lvls[0], lvls[1]
                limit_px = (float(bids[0]["px"]) if direction == "LONG" else float(asks[0]["px"])) \
                           if (bids and asks) else entry
                hl_res = await asyncio.to_thread(
                    hl_trader.limit_open, coin, direction == "LONG",
                    AUTO_EXEC_SIZE_USD, AUTO_EXEC_LEVERAGE, limit_px
                )
                log.info("Auto-exec HL %s %s @%.4f → %s", direction, coin, limit_px, hl_res)
                outcomes.append(hl_res)
                if hl_res.get("ok"):
                    asyncio.create_task(_tg(
                        f"<b>Auto-exec HL</b> {coin} {direction} @${limit_px:,.4f}\n"
                        f"SL ${sl:,.4f} | TP ${tp:,.4f} | {','.join(winners)}"
                    ))

            # ── MT5 / VT Markets ───────────────────────────────────────────
            if auto_exec_broker in ("mt5", "both") and mt5_bridge:
                mt5_sym = _MT5_COIN_MAP.get(coin.upper(), coin.upper() + "USD")
                # Skip if already in a position on this symbol
                existing_mt5 = await asyncio.to_thread(mt5_bridge.get_positions)
                if not any(p["symbol"] == mt5_sym for p in existing_mt5):
                    # Phase-based risk sizing (minimum 0.01 lots)
                    try:
                        from strategies_mega import detect_phase
                        mt5_info = await asyncio.to_thread(mt5_bridge.get_account_info)
                        # Convert broker equity to USD estimate (CAD account: ~0.73 rate)
                        broker_eq  = float(mt5_info.get("equity", 100.0))
                        eq_usd     = broker_eq * float(os.getenv("MT5_FX_RATE", "0.73"))
                        phase      = detect_phase(eq_usd)
                        risk_usd   = eq_usd * phase["risk_pct"]
                        sl_dist    = abs(entry - sl) / (entry + 1e-9)
                        lot        = round(risk_usd / (sl_dist * entry + 1e-9), 2)
                        lot        = max(0.01, min(lot, float(os.getenv("MT5_MAX_LOT", "0.10"))))
                    except Exception:
                        lot = 0.01
                    tag = f"MEGALPHA_{','.join(winners)}"
                    mt5_res = await asyncio.to_thread(
                        mt5_bridge.market_order,
                        coin, direction == "LONG", lot, sl, tp, tag
                    )
                    log.info("Auto-exec MT5 %s %s sym=%s lot=%.2f → %s",
                             direction, coin, mt5_sym, lot, mt5_res)
                    outcomes.append(mt5_res)
                    if mt5_res.get("ok"):
                        asyncio.create_task(_tg(
                            f"<b>Auto-exec MT5</b> {coin} {direction} lot={lot:.2f}\n"
                            f"SL ${sl:,.4f} | TP ${tp:,.4f} | {','.join(winners)}"
                        ))

            outcome = outcomes[0] if outcomes else {"ok": False, "error": "No broker available or all skipped"}

        # Log the execution
        auto_exec_log.insert(0, {
            "ts":         int(time.time()),
            "coin":       coin,
            "interval":   interval,
            "direction":  direction,
            "entry":      round(entry, 4),
            "sl":         round(sl, 4),
            "tp":         round(tp, 4),
            "strategies": winners,
            "mode":       auto_exec_mode,
            "ok":         outcome.get("ok", False),
            "error":      outcome.get("error"),
        })
        if len(auto_exec_log) > 100:
            auto_exec_log.pop()

    except Exception as exc:
        log.warning("auto_exec_coin(%s %s) error: %s", coin, interval, exc)


async def _save_paper() -> None:
    """Persist current paper-trading state to SQLite in a background thread."""
    await asyncio.to_thread(_db.save_paper_state, paper_equity, paper_positions, paper_trades)


async def auto_exec_loop() -> None:
    """Background loop: scans on every 1h candle close; executes on consensus."""
    global auto_exec_next_scan
    await asyncio.sleep(90)   # wait for cache prewarm before first scan

    while True:
        try:
            now = time.time()

            # Always check paper SL/TP regardless of mode
            if paper_positions:
                _check_paper_sl_tp()
                asyncio.create_task(_save_paper())

            # Run scan when the scheduled time arrives
            if now >= auto_exec_next_scan and auto_exec_mode != "stopped":
                # Schedule next scan at top of next hour
                auto_exec_next_scan = (int(now) // 3600 + 1) * 3600.0
                log.info("Auto-exec scan starting (mode=%s)", auto_exec_mode)
                for coin in AUTO_EXEC_SCAN_COINS:
                    await _auto_exec_coin(coin, "1h")

        except Exception as exc:
            log.warning("auto_exec_loop error: %s", exc)

        await asyncio.sleep(60)  # tick every minute



# ─── WebSocket endpoint ───────────────────────────────────────────────────────

@app.websocket("/ws")
async def ws_endpoint(websocket: WebSocket) -> None:
    await websocket.accept()
    clients.append(websocket)
    log.info("Dashboard client connected (%d total)", len(clients))
    try:
        await websocket.send_text(json.dumps(build_payload()))
        while True:
            try:
                await asyncio.wait_for(websocket.receive_text(), timeout=30)
            except asyncio.TimeoutError:
                pass
    except WebSocketDisconnect:
        pass
    finally:
        if websocket in clients:
            clients.remove(websocket)
        log.info("Dashboard client disconnected (%d total)", len(clients))

# ─── REST: Hyperliquid trading ────────────────────────────────────────────────

class HLOpenRequest(BaseModel):
    coin: str
    is_buy: bool
    size_usd: float
    leverage: int = 5
    # Execution quality
    slippage_tolerance_bps: float = 0.0   # warn when fill deviates beyond this (0 = off)
    post_only: bool = False                # place at best bid/ask (ALO) instead of market
    # Account-level risk controls (0 = disabled)
    max_position_pct: float = 0.0         # cap margin to this fraction of current equity
    max_drawdown_pct: float = 0.0         # block if equity drawdown from peak exceeds this
    stop_loss_pct: float = 0.0
    take_profit_pct: float = 0.0

class HLCloseRequest(BaseModel):
    coin: str

class HLCancelRequest(BaseModel):
    coin: str
    oid: int


@app.post("/trade/hl/open")
async def hl_open(req: HLOpenRequest) -> dict:
    if not hl_trader:
        return {"ok": False, "error": "Add HL_PRIVATE_KEY to server/.env to enable live trading"}

    global live_halted, live_peak_equity
    if live_halted:
        return {"ok": False, "error": "Max-drawdown kill-switch is active — bridge restart required to reset"}

    # ── 1. query position before order ───────────────────────────────────────
    account = await asyncio.to_thread(hl_trader.get_account_state)
    existing = next((p for p in account.get("positions", []) if p["coin"] == req.coin.upper()), None)
    if existing:
        return {"ok": False, "error": f"Position already open for {req.coin} (size={existing['size']:.4f}) — close it first"}

    equity = float(account.get("account_value") or 0)
    if equity > 0:
        live_peak_equity = max(live_peak_equity, equity)

    # ── 2. account-level max-DD kill-switch ──────────────────────────────────
    if req.max_drawdown_pct > 0 and live_peak_equity > 0:
        from risk import RiskConfig, kill_switch_triggered
        if kill_switch_triggered(equity, live_peak_equity, RiskConfig(max_drawdown_pct=req.max_drawdown_pct)):
            live_halted = True
            return {"ok": False, "error": f"Max-drawdown kill-switch triggered (peak=${live_peak_equity:.0f}, now=${equity:.0f})"}

    # ── 3. per-trade size cap ─────────────────────────────────────────────────
    if req.max_position_pct > 0 and equity > 0:
        from risk import RiskConfig, position_margin
        capped = position_margin(equity, req.size_usd, RiskConfig(max_position_pct=req.max_position_pct))
    else:
        capped = req.size_usd

    # ── 4. place order (market or post-only limit) ────────────────────────────
    if req.post_only:
        ob = order_books.get(req.coin.upper(), {})
        lvl = ob.get("levels", [[], []])
        bids = lvl[0] if len(lvl) > 0 else []
        asks = lvl[1] if len(lvl) > 1 else []
        if bids and asks:
            limit_px = float(bids[0]["px"]) if req.is_buy else float(asks[0]["px"])
        else:
            mid = float(prices.get(req.coin.lower(), 0))
            if mid <= 0:
                return {"ok": False, "error": f"No live price for {req.coin}"}
            limit_px = mid * (0.9999 if req.is_buy else 1.0001)
        result = await asyncio.to_thread(
            hl_trader.limit_open, req.coin, req.is_buy, capped, req.leverage, limit_px
        )
    else:
        result = await asyncio.to_thread(
            hl_trader.market_open, req.coin, req.is_buy, capped, req.leverage,
            req.slippage_tolerance_bps,
        )

    # ── 5. schedule 60-second reconciliation ─────────────────────────────────
    if result.get("ok"):
        asyncio.create_task(reconcile_after(req.coin, 60.0))

    return result


@app.post("/trade/hl/close")
async def hl_close(req: HLCloseRequest) -> dict:
    if not hl_trader:
        return {"ok": False, "error": "HL trader not configured"}
    return await asyncio.to_thread(hl_trader.market_close, req.coin)


@app.post("/trade/hl/cancel")
async def hl_cancel(req: HLCancelRequest) -> dict:
    if not hl_trader:
        return {"ok": False, "error": "HL trader not configured"}
    return await asyncio.to_thread(hl_trader.cancel_order, req.coin, req.oid)


@app.get("/account/hl")
async def account_hl() -> dict:
    if not hl_trader:
        return {"configured": False}
    return await asyncio.to_thread(hl_trader.get_account_state)

# ─── candle REST endpoint ─────────────────────────────────────────────────────

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

    interval_ms = INTERVAL_MS[interval]
    launch_ms   = COIN_START_MS.get(coin, COIN_START_MS["BTC"])
    now_ms      = int(time.time() * 1000)

    if limit > 0:
        # Bounded recent window — fetch directly (avoids a full cold fetch for fine intervals)
        start_ms = start_time if start_time > 0 else now_ms - (limit * interval_ms)
        return await fetch_candles_paginated(coin, interval, start_ms, now_ms, limit)

    # Full history from token launch — served from disk cache, delta-updated, complete from day 1
    history = await candle_cache.get_history(
        coin, interval, launch_ms, interval_ms, fetch_candles_paginated
    )
    if start_time > 0:
        cutoff = start_time // 1000   # cache stores time in seconds
        history = [c for c in history if c["time"] >= cutoff]
    return history

# ─── backtest endpoint ────────────────────────────────────────────────────────

class BacktestRequest(BaseModel):
    coin: str = "BTC"
    interval: str = "1h"
    starting_balance: float = 10_000.0
    size_usd: float = 200.0
    leverage: int = 5
    strategy: str = "momentum"      # see backtest.STRATEGIES
    fee_bps: float = 3.5            # taker fee per side
    slippage_bps: float = 2.0      # per side, baked into fills (realistic cost model)
    funding_apr: float = 0.10      # assumed avg perpetual funding drag (conservative)
    stop_loss_pct: float = 0.0     # risk layer — fraction of margin (0 = off)
    take_profit_pct: float = 0.0
    max_drawdown_pct: float = 0.0  # equity-drawdown kill switch (0 = off)
    max_position_pct: float = 0.0  # margin per trade as fraction of equity (0 = fixed size)
    folds: int = 5                 # walk-forward segments
    limit: int = 0                 # 0 = full history


def _risk_from(req: "BacktestRequest"):
    from risk import RiskConfig
    return RiskConfig(
        stop_loss_pct=req.stop_loss_pct, take_profit_pct=req.take_profit_pct,
        max_drawdown_pct=req.max_drawdown_pct, max_position_pct=req.max_position_pct,
    )


async def _backtest_candles(req: "BacktestRequest"):
    """Shared: validate + load full cached history. Returns (candles, coin, error)."""
    coin = req.coin.upper()
    if coin not in COINS:
        return None, coin, {"error": f"Unknown coin: {coin}"}
    if req.interval not in INTERVAL_MS:
        return None, coin, {"error": f"Unknown interval: {req.interval}"}
    interval_ms = INTERVAL_MS[req.interval]
    launch_ms   = COIN_START_MS.get(coin, COIN_START_MS["BTC"])
    data = await candle_cache.get_history(coin, req.interval, launch_ms, interval_ms, fetch_candles_paginated)
    if req.limit > 0:
        data = data[-req.limit:]
    if not data:
        return None, coin, {"error": "No candle data returned"}
    return data, coin, None


@app.post("/backtest")
async def run_backtest_endpoint(req: BacktestRequest) -> dict:
    from backtest import run_backtest, STRATEGIES
    if req.strategy not in STRATEGIES:
        return {"error": f"Unknown strategy: {req.strategy}. Options: {', '.join(STRATEGIES)}"}
    candle_data, coin, err = await _backtest_candles(req)
    if err:
        return err
    result = await asyncio.to_thread(
        run_backtest, candle_data, req.starting_balance, req.size_usd, req.leverage,
        req.strategy, req.fee_bps, req.slippage_bps, req.funding_apr, _risk_from(req),
    )
    result["meta"] = {
        "coin": coin, "interval": req.interval, "strategy": req.strategy,
        "candles": len(candle_data),
        "costs": {"fee_bps": req.fee_bps, "slippage_bps": req.slippage_bps, "funding_apr": req.funding_apr},
    }
    return result


@app.post("/backtest/walkforward")
async def run_walkforward_endpoint(req: BacktestRequest) -> dict:
    from backtest import run_walk_forward, STRATEGIES
    if req.strategy not in STRATEGIES:
        return {"error": f"Unknown strategy: {req.strategy}. Options: {', '.join(STRATEGIES)}"}
    candle_data, coin, err = await _backtest_candles(req)
    if err:
        return err
    result = await asyncio.to_thread(
        run_walk_forward, candle_data, req.starting_balance, req.size_usd, req.leverage,
        req.strategy, req.folds,
        fee_bps=req.fee_bps, slippage_bps=req.slippage_bps, funding_apr=req.funding_apr, risk=_risk_from(req),
    )
    result["meta"] = {
        "coin": coin, "interval": req.interval, "strategy": req.strategy,
        "candles": len(candle_data), "folds": req.folds,
    }
    return result


@app.post("/backtest/agent")
async def run_agent_backtest_endpoint(req: BacktestRequest) -> dict:
    """Replay the trained RL policy for (coin, interval) over history → trade log + equity."""
    from agent_backtest import run_agent_backtest
    candle_data, coin, err = await _backtest_candles(req)
    if err:
        return err
    result = await asyncio.to_thread(
        run_agent_backtest, candle_data, coin, req.interval, req.starting_balance,
        req.size_usd, req.leverage, req.fee_bps, req.slippage_bps, req.funding_apr, _risk_from(req),
    )
    if result.get("error"):
        return result
    split = int(len(candle_data) * 0.8)
    result["meta"] = {
        "coin": coin, "interval": req.interval, "strategy": "agent",
        "candles": len(candle_data),
        "split_time": candle_data[split]["time"] if split < len(candle_data) else 0,
        "costs": {"fee_bps": req.fee_bps, "slippage_bps": req.slippage_bps, "funding_apr": req.funding_apr},
    }
    return result


# ─── data hub endpoints (Phase 4) ────────────────────────────────────────────

@app.get("/data/metrics")
async def data_metrics_endpoint() -> dict:
    return market_metrics


@app.get("/data/liquidations")
async def data_liquidations_endpoint() -> list:
    return recent_liquidations


@app.get("/data/funding/{coin}")
async def data_funding_endpoint(coin: str, days: int = 7) -> list:
    """Historical funding rates for a coin — last `days` days, hourly resolution."""
    coin = coin.upper()
    if coin not in COINS:
        return []
    start_ms = int(time.time() * 1000) - days * 24 * 3_600_000

    def _fetch():
        import urllib.request as _req
        import json as _j
        url = "https://api.hyperliquid.xyz/info"
        payload = _j.dumps({"type": "fundingHistory", "coin": coin, "startTime": start_ms}).encode()
        req = _req.Request(url, data=payload, headers={"Content-Type": "application/json"})
        with _req.urlopen(req, timeout=15) as resp:
            return _j.loads(resp.read())

    try:
        records = await asyncio.to_thread(_fetch)
    except Exception as exc:
        log.warning("Funding history fetch failed (%s): %s", coin, exc)
        return []

    return [
        {
            "time":         r["time"] // 1000,          # seconds for lightweight-charts
            "funding_rate": float(r.get("fundingRate") or 0),
            "funding_apr":  float(r.get("fundingRate") or 0) * 24 * 365 * 100,
            "premium":      float(r.get("premium") or 0),
        }
        for r in records
        if isinstance(r, dict)
    ]


# ─── strategy CRUD ────────────────────────────────────────────────────────────

class StrategySaveRequest(BaseModel):
    name: str
    config: dict


@app.post("/strategy/save")
async def strategy_save(req: StrategySaveRequest) -> dict:
    return _strategies.save(req.name, req.config)


@app.get("/strategy/list")
async def strategy_list() -> list:
    return _strategies.list_all()


@app.get("/strategy/{slug}")
async def strategy_load(slug: str) -> dict:
    data = _strategies.load(slug)
    if data is None:
        return {"ok": False, "error": f"Strategy '{slug}' not found"}
    return {"ok": True, **data}


@app.delete("/strategy/{slug}")
async def strategy_delete(slug: str) -> dict:
    ok = _strategies.delete(slug)
    return {"ok": ok}


# ─── journal endpoints (Phase 5) ─────────────────────────────────────────────

class JournalCreate(BaseModel):
    date: str  = ""
    title: str = "Untitled"
    body: str  = ""

class JournalUpdate(BaseModel):
    date: str  = ""
    title: str = "Untitled"
    body: str  = ""

class JournalChatRequest(BaseModel):
    messages:   list[dict]
    entry_body: str = ""


@app.get("/journal")
async def journal_list_endpoint() -> list:
    return await asyncio.to_thread(_db.list_entries)


@app.get("/journal/{entry_id}")
async def journal_get_endpoint(entry_id: int) -> dict:
    entry = await asyncio.to_thread(_db.get_entry, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    return entry


@app.post("/journal")
async def journal_create_endpoint(req: JournalCreate) -> dict:
    return await asyncio.to_thread(_db.create_entry, req.date, req.title, req.body)


@app.put("/journal/{entry_id}")
async def journal_update_endpoint(entry_id: int, req: JournalUpdate) -> dict:
    entry = await asyncio.to_thread(_db.update_entry, entry_id, req.date, req.title, req.body)
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    return entry


@app.delete("/journal/{entry_id}")
async def journal_delete_endpoint(entry_id: int) -> dict:
    ok = await asyncio.to_thread(_db.delete_entry, entry_id)
    return {"ok": ok}


# ── AI signal endpoints (Phase 5.5) ──────────────────────────────────────────

class SignalGenerateRequest(BaseModel):
    coin:     str = "BTC"
    interval: str = "1h"


@app.get("/ai/signals/all")
async def ai_signals_all(interval: str = "1h") -> list:
    """Latest signal per coin across ALL scanned markets (used by SignalsPage).
    MUST be registered before /ai/signals/{coin} so FastAPI matches it first."""
    return await asyncio.to_thread(_db.get_all_latest_signals, interval)


@app.get("/ai/signals/{coin}")
async def ai_signals_get(coin: str, interval: str = "1h", limit: int = 100) -> list:
    """Return saved AI signals for a coin + interval (used as chart markers)."""
    coin = coin.upper()
    return await asyncio.to_thread(_db.get_signals, coin, interval, limit)


@app.get("/markets")
async def markets_list() -> list:
    """All Hyperliquid perp markets sorted by 24h volume."""
    from signal_scanner import get_markets
    try:
        return await get_markets()
    except Exception as exc:
        log.warning("Markets fetch failed: %s", exc)
        return []


@app.post("/ai/signals/scan")
async def ai_signals_scan_now() -> dict:
    """Trigger an immediate full scan (all top markets). Returns count of signals saved."""
    from signal_scanner import run_scan

    saved: list[dict] = []

    async def _collect(sig: dict):
        saved.append(sig)
        signal_alerts.insert(0, sig)
        del signal_alerts[50:]

    asyncio.create_task(run_scan(rl_state, _collect))
    return {"ok": True, "message": "Scan started — check /ai/signals/all in ~5 minutes"}


@app.post("/ai/signals/generate")
async def ai_signals_generate(req: SignalGenerateRequest) -> dict:
    """On-demand: generate a new AI signal and save it. Returns the signal or error."""
    from ai_signals import generate_signal

    coin = req.coin.upper()
    if coin not in COINS:
        return {"error": f"Unknown coin: {coin}"}
    if req.interval not in INTERVAL_MS:
        return {"error": f"Unknown interval: {req.interval}"}

    # Load candles from cache
    launch_ms   = COIN_START_MS.get(coin, COIN_START_MS["BTC"])
    interval_ms = INTERVAL_MS[req.interval]
    candles = await candle_cache.get_history(
        coin, req.interval, launch_ms, interval_ms, fetch_candles_paginated
    )
    if not candles:
        return {"error": "No candle data available — cache may still be warming"}

    sig = await generate_signal(coin, req.interval, candles, rl_state)
    if not sig:
        return {"error": "Signal generation failed — check OPENROUTER_API_KEY in server/.env"}

    saved = await asyncio.to_thread(_db.save_signal, sig)
    log.info("AI signal: %s %s → %s (%d%% conf) @ $%.2f",
             coin, req.interval, saved["signal"], saved["confidence"], saved["price"])
    return saved


async def btc_eth_sol_signal_loop() -> None:
    """
    Scans BTC, ETH, SOL on 1h every 60 minutes with the institutional-grade
    signal engine. High-confidence LONG/SHORT signals are pushed as WS alerts.
    """
    from ai_signals import generate_signal as _gen

    if not os.getenv("OPENROUTER_API_KEY", "").strip():
        log.info("Signal loop: OPENROUTER_API_KEY not set — disabled")
        return

    log.info("BTC/ETH/SOL signal loop starting (2-min warm-up)…")
    await asyncio.sleep(120)   # wait for cache to warm

    while True:
        for coin in COINS:
            try:
                launch_ms   = COIN_START_MS.get(coin, COIN_START_MS["BTC"])
                interval_ms = INTERVAL_MS["1h"]
                candles = await candle_cache.get_history(
                    coin, "1h", launch_ms, interval_ms, fetch_candles_paginated
                )
                if not candles:
                    continue

                sig = await _gen(coin, "1h", candles, rl_state)
                if not sig:
                    continue

                # Reject HOLD and sub-floor signals
                if sig["signal"] not in ("LONG", "SHORT"):
                    log.debug("Signal: %s 1h → HOLD — skipped", coin)
                    continue
                if sig["confidence"] < SIGNAL_CONFIDENCE_FLOOR:
                    log.debug("Signal: %s 1h → %s %d%% below threshold — skipped",
                              coin, sig["signal"], sig["confidence"])
                    continue

                # Dedup: skip if we already have a signal at this exact candle time
                existing = await asyncio.to_thread(_db.get_latest_signal, coin, "1h")
                if existing and existing.get("time") == sig.get("time") and \
                   existing.get("signal") == sig.get("signal"):
                    log.debug("Signal: %s 1h — same candle/direction, skipping", coin)
                    continue

                saved = await asyncio.to_thread(_db.save_signal, sig)
                log.info("Signal: %s 1h → %s (%d%%) @ $%.2f",
                         coin, sig["signal"], sig["confidence"], sig["price"])
                asyncio.create_task(_tg(
                    f"📡 <b>{coin} {sig['signal']}</b> {sig['confidence']}% @ ${sig['price']:,.0f}\n"
                    f"{sig.get('reasoning','')[:200]}"
                ))

                signal_alerts.insert(0, saved)
                del signal_alerts[50:]

            except Exception as exc:
                log.warning("Signal loop error (%s): %s", coin, exc)
            await asyncio.sleep(8)   # pace between coins

        await asyncio.sleep(3600)   # scan every 1 hour


async def btc_eth_sol_4h_signal_loop() -> None:
    """
    4h-timeframe signal loop for BTC/ETH/SOL. Runs every 4 hours.
    4h bars have cleaner structure and fewer false breaks than 1h.
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
                if sig["confidence"] < SIGNAL_CONFIDENCE_FLOOR:
                    continue

                existing = await asyncio.to_thread(_db.get_latest_signal, coin, "4h")
                if existing and existing.get("time") == sig.get("time") and \
                   existing.get("signal") == sig.get("signal"):
                    log.debug("4h Signal: %s — same candle/direction, skipping", coin)
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


@app.post("/journal/chat")
async def journal_chat_endpoint(req: JournalChatRequest) -> StreamingResponse:
    """Stream an OpenRouter AI response with live market context injected."""
    from openrouter import stream_chat

    # Build live market context for the AI
    ctx_lines: list[str] = []
    for coin in COINS:
        px = prices.get(coin)
        if px:
            m = market_metrics.get(coin, {})
            chg = m.get("day_change_pct", 0)
            sign = "+" if chg >= 0 else ""
            ctx_lines.append(f"{coin}: ${px:,.2f} ({sign}{chg:.2f}% today)")
    if ctx_lines:
        ctx_lines.insert(0, "Live prices:")

    action = rl_state.get("action", "HOLD")
    probs  = rl_state.get("probabilities", {})
    ctx_lines.append(
        f"\nRL agent: {action}  "
        f"(LONG {probs.get('LONG', 0):.0%} · HOLD {probs.get('HOLD', 0):.0%} · SHORT {probs.get('SHORT', 0):.0%})"
    )

    if req.entry_body.strip():
        ctx_lines.append(f"\nJournal entry being edited:\n{req.entry_body[:2000]}")

    market_context = "\n".join(ctx_lines)

    async def generate():
        async for chunk in stream_chat(req.messages, market_context=market_context):
            yield f"data: {json.dumps({'chunk': chunk})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


# ─── signal performance endpoints ─────────────────────────────────────────────

@app.get("/signals/debug")
async def signals_debug() -> dict:
    """Returns the last 10 saved signals including HOLD ones, for debugging AI output."""
    try:
        import sqlite3
        conn = sqlite3.connect(str(_db.DB_PATH))
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT * FROM signals ORDER BY created_at DESC LIMIT 10"
        ).fetchall()
        conn.close()
        return {"signals": [dict(r) for r in rows]}
    except Exception as exc:
        return {"error": str(exc)}


@app.get("/signals/stats")
async def signals_stats_endpoint() -> dict:
    """Aggregate win/loss/pending stats for the Performance tab."""
    return await asyncio.to_thread(_db.get_signal_stats)


@app.get("/signals/history")
async def signals_history_endpoint(limit: int = 50) -> list:
    """All resolved + pending LONG/SHORT signals, newest first."""
    import sqlite3 as _sqlite3
    with _db._conn() as db:
        rows = db.execute(
            "SELECT * FROM signals WHERE signal IN ('LONG','SHORT') "
            "ORDER BY created_at DESC LIMIT ?", (limit,)
        ).fetchall()
    return [_db._row_to_dict(r) for r in rows]


# ─── health check ─────────────────────────────────────────────────────────────

@app.get("/health")
async def health() -> dict:
    return {
        "status":        "ok",
        "prices":        prices,
        "candle_counts": {c: len(candles[c]) for c in COINS},
        "clients":       len(clients),
        "hl_configured": hl_trader is not None,
        "live_halted":   live_halted,
        "live_peak_equity": live_peak_equity,
        "rl_loaded":     rl_model is not None,
        "rl_meta":       rl_meta,
    }


@app.get("/rl/status")
async def rl_status() -> dict:
    return {
        "loaded":  rl_model is not None,
        "meta":    rl_meta,
        "state":   rl_state,
        "history": rl_history,
    }


# ─── regime endpoints ─────────────────────────────────────────────────────────

@app.get("/regime")
async def regime_endpoint() -> dict:
    """Current market regime for all coins (RANGING / TRENDING / TRANSITION / HALTED)."""
    return regime_states


# ─── auto-execution endpoints ─────────────────────────────────────────────────

@app.get("/auto-exec/status")
async def auto_exec_status_endpoint() -> dict:
    now = time.time()
    return {
        "mode":           auto_exec_mode,
        "broker":         auto_exec_broker,
        "hl_configured":  hl_trader is not None,
        "mt5_configured": mt5_bridge is not None,
        "live_halted":    live_halted,
        "next_scan_ts":   auto_exec_next_scan,
        "secs_to_scan":   max(0, int(auto_exec_next_scan - now)),
        "log":            auto_exec_log[:20],
        "paper": {
            "equity":    round(paper_equity, 2),
            "start":     PAPER_START_EQUITY,
            "pnl":       round(paper_equity - PAPER_START_EQUITY, 2),
            "positions": paper_positions,
            "trades":    paper_trades[:20],
        },
    }


class AutoExecModeRequest(BaseModel):
    mode: str   # "stopped" | "paper" | "live"


class AutoExecBrokerRequest(BaseModel):
    broker: str   # "hl" | "mt5" | "both"


@app.post("/auto-exec/broker")
async def set_auto_exec_broker(req: AutoExecBrokerRequest) -> dict:
    global auto_exec_broker
    if req.broker not in ("hl", "mt5", "both"):
        return {"ok": False, "error": "broker must be 'hl', 'mt5', or 'both'"}
    if req.broker in ("mt5", "both") and not mt5_bridge:
        return {"ok": False, "error": "MT5 not connected — set MT5_LOGIN/PASSWORD/SERVER in .env"}
    auto_exec_broker = req.broker
    log.info("Auto-exec broker set to: %s", req.broker)
    return {"ok": True, "broker": auto_exec_broker}


@app.post("/auto-exec/mode")
async def set_auto_exec_mode(req: AutoExecModeRequest) -> dict:
    global auto_exec_mode, auto_exec_next_scan
    if req.mode not in ("stopped", "paper", "live"):
        return {"ok": False, "error": "mode must be 'stopped', 'paper', or 'live'"}
    if req.mode == "live" and not hl_trader:
        return {"ok": False, "error": "HL_PRIVATE_KEY not configured — live mode unavailable"}
    if req.mode == "live" and live_halted:
        return {"ok": False, "error": "Max-drawdown kill-switch active — restart bridge to reset"}
    auto_exec_mode = req.mode
    # Trigger an immediate scan when switching to an active mode
    if req.mode != "stopped":
        auto_exec_next_scan = time.time()
    log.info("Auto-exec mode set to: %s", req.mode)
    return {"ok": True, "mode": auto_exec_mode}


# ─── MT5 endpoints ────────────────────────────────────────────────────────────

class MT5OrderRequest(BaseModel):
    coin: str
    strategy: str     # "A", "B", "C", or "D"
    signal: dict      # output of the relevant score_strategy_* function


@app.post("/mt5/open")
async def mt5_open(req: MT5OrderRequest) -> dict:
    """Trigger an MT5 order from a strategy signal dict."""
    if not mt5_auto_trader:
        return {"ok": False, "error": "MT5 not configured — set MT5_LOGIN, MT5_PASSWORD, MT5_SERVER in .env"}

    coin = req.coin.upper()
    # Load candles for ATR calculation
    try:
        launch_ms   = COIN_START_MS.get(coin, COIN_START_MS["BTC"])
        interval_ms = INTERVAL_MS["1h"]
        candle_data = await candle_cache.get_history(
            coin, "1h", launch_ms, interval_ms, fetch_candles_paginated
        )
    except Exception:
        candle_data = None

    strategy = req.strategy.upper()
    if strategy == "A":
        result = await asyncio.to_thread(mt5_auto_trader.execute_strategy_a, req.signal, coin, candle_data)
    elif strategy == "B":
        candle_data_4h = None
        try:
            launch_ms = COIN_START_MS.get(coin, COIN_START_MS["BTC"])
            candle_data_4h = await candle_cache.get_history(coin, "4h", launch_ms, INTERVAL_MS["4h"], fetch_candles_paginated)
        except Exception:
            pass
        result = await asyncio.to_thread(mt5_auto_trader.execute_strategy_b, req.signal, coin, candle_data)
    elif strategy == "C":
        result = await asyncio.to_thread(mt5_auto_trader.execute_strategy_c, req.signal, coin, candle_data)
    elif strategy == "D":
        result = await asyncio.to_thread(mt5_auto_trader.execute_strategy_d, req.signal, coin, candle_data)
    else:
        return {"ok": False, "error": f"Unknown strategy '{strategy}'. Use A, B, C, or D."}

    return result


class MT5TestTradeRequest(BaseModel):
    coin:    str   = "BTC"
    is_buy:  bool  = True
    volume:  float = 0.01
    comment: str   = "MEGALPHA_TEST"


@app.post("/mt5/test-trade")
async def mt5_test_trade(req: MT5TestTradeRequest) -> dict:
    """Place a raw minimum-lot market order on MT5 — for connectivity testing."""
    if not mt5_bridge:
        return {"ok": False, "error": "MT5 not configured"}
    result = await asyncio.to_thread(
        mt5_bridge.market_order,
        req.coin, req.is_buy, req.volume, 0.0, 0.0, req.comment,
    )
    return result


@app.post("/mt5/close-all")
async def mt5_close_all() -> dict:
    """Close all open MT5 positions (emergency / test cleanup)."""
    if not mt5_bridge:
        return {"ok": False, "error": "MT5 not configured"}
    positions = await asyncio.to_thread(mt5_bridge.get_positions)
    results = []
    for pos in positions:
        res = await asyncio.to_thread(mt5_bridge.close_position, pos["ticket"])
        results.append({"ticket": pos["ticket"], "symbol": pos["symbol"], **res})
    return {"closed": len(results), "results": results}


@app.get("/mt5/positions")
async def mt5_positions() -> list:
    """Get all open MT5 positions."""
    if not mt5_bridge:
        return []
    return await asyncio.to_thread(mt5_bridge.get_positions)


@app.post("/mt5/close/{ticket}")
async def mt5_close(ticket: int) -> dict:
    """Close a specific MT5 position by ticket number."""
    if not mt5_bridge:
        return {"ok": False, "error": "MT5 not configured"}
    result = await asyncio.to_thread(mt5_bridge.close_position, ticket)
    if result.get("ok") and mt5_auto_trader:
        mt5_auto_trader.open_positions.pop(ticket, None)
    return result


@app.get("/mt5/status")
async def mt5_status() -> dict:
    """MT5 connection status, account info, and auto-trader state."""
    if not mt5_bridge:
        return {"connected": False, "configured": False}
    account = await asyncio.to_thread(mt5_bridge.get_account_info)
    status = {"configured": True, **account}
    if mt5_auto_trader:
        status["auto_trader"] = mt5_auto_trader.get_status()
    return status


# ─── strategy scan endpoint ───────────────────────────────────────────────────

class StrategyScanRequest(BaseModel):
    coin: str = "BTC"
    interval: str = "1h"


@app.post("/strategies/scan")
async def strategies_scan(req: StrategyScanRequest) -> dict:
    """
    Run all 4 MegaAlpha strategies on the latest candles for the given coin/interval.
    Returns signals (or None) for each strategy.
    """
    coin = req.coin.upper()
    if coin not in COINS:
        return {"error": f"Unknown coin: {coin}"}
    if req.interval not in INTERVAL_MS:
        return {"error": f"Unknown interval: {req.interval}"}

    launch_ms   = COIN_START_MS.get(coin, COIN_START_MS["BTC"])
    interval_ms = INTERVAL_MS[req.interval]

    try:
        candle_data = await candle_cache.get_history(
            coin, req.interval, launch_ms, interval_ms, fetch_candles_paginated
        )
    except Exception as exc:
        return {"error": f"Failed to load candles: {exc}"}

    if not candle_data:
        return {"error": "No candle data available"}

    from strategies_mega import (
        score_strategy_a, signal_strategy_b, detect_fu_candle, score_strategy_d,
        detect_regime as _detect_regime,
    )

    # Load 4h candles for strategy B and regime
    try:
        candle_4h = await candle_cache.get_history(
            coin, "4h", launch_ms, INTERVAL_MS["4h"], fetch_candles_paginated
        )
    except Exception:
        candle_4h = []

    def _run_all():
        a_signal = score_strategy_a(candle_data, coin)
        b_signal = signal_strategy_b(candle_data, candle_4h) if candle_4h else None
        c_signal = detect_fu_candle(candle_data)
        d_signal = score_strategy_d(candle_data, coin)
        regime   = _detect_regime(candle_4h) if candle_4h else {}
        return {"A": a_signal, "B": b_signal, "C": c_signal, "D": d_signal, "regime": regime}

    result = await asyncio.to_thread(_run_all)
    result["coin"]     = coin
    result["interval"] = req.interval
    result["candles"]  = len(candle_data)
    return result


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
