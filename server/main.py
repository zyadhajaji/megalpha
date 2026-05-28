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


def order_book_metrics(coin: str) -> dict:
    ob = order_books.get(coin)
    if not ob:
        return {}
    levels = ob.get("levels", [[], []])
    bids = levels[0][:5] if levels else []
    asks = levels[1][:5] if levels else []
    if not bids or not asks:
        return {}
    best_bid, best_ask = float(bids[0][0]), float(asks[0][0])
    mid = (best_bid + best_ask) / 2
    spread_bps = round(((best_ask - best_bid) / mid) * 10_000, 2) if mid else 0
    bid_vol = sum(float(b[1]) for b in bids)
    ask_vol = sum(float(a[1]) for a in asks)
    return {"spread_bps": spread_bps, "bid_ask_ratio": round(bid_vol / (ask_vol + 1e-9), 3)}

# ─── paginated candle fetch ───────────────────────────────────────────────────

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
    return payload

# ─── FastAPI app ──────────────────────────────────────────────────────────────

app = FastAPI(title="MEGALPHA Bridge")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
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
                })
            log.info("Pre-loaded %d candles for %s", len(candles[coin]), coin)
        except Exception as exc:
            log.warning("Historical candles failed for %s: %s", coin, exc)
        await asyncio.sleep(0.5)  # be gentle with HL rate limits


@app.on_event("startup")
async def startup() -> None:
    asyncio.create_task(fetch_historical_candles())
    asyncio.create_task(hl_listener())
    asyncio.create_task(broadcaster())
    asyncio.create_task(account_poller())

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

# ─── health check ─────────────────────────────────────────────────────────────

@app.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "prices": prices,
        "candle_counts": {c: len(candles[c]) for c in COINS},
        "clients": len(clients),
        "hl_configured": hl_trader is not None,
    }


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
