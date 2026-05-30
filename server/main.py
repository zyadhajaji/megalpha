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
from pathlib import Path
from typing import Optional

import uvicorn
import websockets
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import candle_cache
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

# ─── constants ────────────────────────────────────────────────────────────────

HL_WS_URL          = "wss://api.hyperliquid.xyz/ws"

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
COINS              = ["BTC", "ETH", "SOL"]
BROADCAST_INTERVAL = 0.5   # seconds — market data push cadence
ACCOUNT_POLL_SECS  = 5.0   # seconds — account state refresh cadence

# ─── shared in-memory state ───────────────────────────────────────────────────

prices: dict[str, float]           = {"btc": 0.0, "eth": 0.0, "sol": 0.0}
candles: dict[str, list]           = {c: [] for c in COINS}
open_candle: dict[str, Optional[dict]] = {c: None for c in COINS}
price_history: dict[str, list[float]]  = {c: [] for c in COINS}
order_books: dict[str, dict]       = {}
clients: list[WebSocket]           = []
hl_account_cache: dict             = {}

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
    return payload

# ─── FastAPI app ──────────────────────────────────────────────────────────────

app = FastAPI(title="MEGALPHA Bridge")
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",  # any local dev port
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── background tasks ─────────────────────────────────────────────────────────

async def hl_listener() -> None:
    while True:
        try:
            async with websockets.connect(
                HL_WS_URL, ping_interval=20, ping_timeout=30, open_timeout=15
            ) as ws:
                log.info("Connected to Hyperliquid WS")
                await ws.send(json.dumps({"method": "subscribe", "subscription": {"type": "allMids"}}))
                for coin in COINS:
                    await ws.send(json.dumps({"method": "subscribe", "subscription": {"type": "trades",  "coin": coin}}))
                    await ws.send(json.dumps({"method": "subscribe", "subscription": {"type": "l2Book", "coin": coin}}))

                async for raw in ws:
                    try:
                        msg  = json.loads(raw)
                        ch   = msg.get("channel")
                        data = msg.get("data", {})

                        if ch == "allMids":
                            mids = data.get("mids", {})
                            for k, v in [("BTC", "btc"), ("ETH", "eth"), ("SOL", "sol")]:
                                if k in mids:
                                    prices[v] = float(mids[k])

                        elif ch == "trades":
                            for t in (data if isinstance(data, list) else []):
                                if t.get("coin") in COINS:
                                    push_trade(t["coin"], float(t.get("px", 0)),
                                               int(t.get("time", time.time() * 1000)))

                        elif ch == "l2Book":
                            coin = data.get("coin", "")
                            if coin in COINS:
                                order_books[coin] = data

                    except Exception as exc:
                        log.debug("WS parse error: %s", exc)

        except Exception as exc:
            log.warning("HL WS disconnected (%s), retry in 5s", exc)
            await asyncio.sleep(5)


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
    while True:
        await asyncio.sleep(ACCOUNT_POLL_SECS)
        if hl_trader:
            try:
                state = await asyncio.to_thread(hl_trader.get_account_state)
                hl_account_cache.clear()
                hl_account_cache.update(state)
            except Exception as exc:
                log.debug("HL account poll error: %s", exc)


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


@app.on_event("startup")
async def startup() -> None:
    load_rl_policy()
    asyncio.create_task(fetch_historical_candles())
    asyncio.create_task(hl_listener())
    asyncio.create_task(broadcaster())
    asyncio.create_task(account_poller())
    asyncio.create_task(prewarm_history_cache())
    asyncio.create_task(rl_inference_loop())

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

class HLCloseRequest(BaseModel):
    coin: str

class HLCancelRequest(BaseModel):
    coin: str
    oid: int


@app.post("/trade/hl/open")
async def hl_open(req: HLOpenRequest) -> dict:
    if not hl_trader:
        return {"ok": False, "error": "Add HL_PRIVATE_KEY to server/.env to enable live trading"}
    return await asyncio.to_thread(
        hl_trader.market_open, req.coin, req.is_buy, req.size_usd, req.leverage
    )


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
    strategy: str = "momentum"   # see backtest.STRATEGIES
    fee_bps: float = 3.5         # taker fee per side
    limit: int = 0               # 0 = full history


@app.post("/backtest")
async def run_backtest_endpoint(req: BacktestRequest) -> dict:
    from backtest import run_backtest, STRATEGIES

    coin = req.coin.upper()
    if coin not in COINS:
        return {"error": f"Unknown coin: {coin}"}
    if req.strategy not in STRATEGIES:
        return {"error": f"Unknown strategy: {req.strategy}. Options: {', '.join(STRATEGIES)}"}

    if req.interval not in INTERVAL_MS:
        return {"error": f"Unknown interval: {req.interval}"}

    interval_ms = INTERVAL_MS[req.interval]
    launch_ms   = COIN_START_MS.get(coin, COIN_START_MS["BTC"])

    # Full history from cache (complete from day 1, fast after first load)
    candle_data = await candle_cache.get_history(
        coin, req.interval, launch_ms, interval_ms, fetch_candles_paginated
    )
    if req.limit > 0:
        candle_data = candle_data[-req.limit:]
    if not candle_data:
        return {"error": "No candle data returned"}

    result = await asyncio.to_thread(
        run_backtest,
        candle_data,
        req.starting_balance,
        req.size_usd,
        req.leverage,
        req.strategy,
        req.fee_bps,
    )
    result["meta"] = {
        "coin":     coin,
        "interval": req.interval,
        "strategy": req.strategy,
        "candles":  len(candle_data),
    }
    return result


# ─── health check ─────────────────────────────────────────────────────────────

@app.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "prices": prices,
        "candle_counts": {c: len(candles[c]) for c in COINS},
        "clients": len(clients),
        "hl_configured": hl_trader is not None,
        "rl_loaded": rl_model is not None,
        "rl_meta": rl_meta,
    }


@app.get("/rl/status")
async def rl_status() -> dict:
    return {
        "loaded":  rl_model is not None,
        "meta":    rl_meta,
        "state":   rl_state,
        "history": rl_history,
    }


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
