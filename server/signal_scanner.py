"""
MEGALPHA — 24/7 AI Signal Scanner
Discovers every Hyperliquid perpetual market, sorts by 24h volume,
takes the top MAX_SCAN_MARKETS, fetches recent 1h candles for each,
and runs the AI signal generator. High-confidence LONG/SHORT signals
are saved to SQLite and pushed as WS alert payloads.

Env vars:
  MAX_SCAN_MARKETS  – how many markets to scan per cycle  (default 30)
  MIN_CONFIDENCE    – minimum confidence to save/alert    (default 65)
  SCAN_INTERVAL_MIN – minutes between full scan cycles    (default 30)
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
import urllib.request
from typing import Optional

log = logging.getLogger("megalpha.scanner")

HL_INFO_URL      = "https://api.hyperliquid.xyz/info"
MAX_SCAN_MARKETS = int(os.getenv("MAX_SCAN_MARKETS", "30"))
MIN_CONFIDENCE   = int(os.getenv("MIN_CONFIDENCE", "65"))
SCAN_INTERVAL_S  = int(os.getenv("SCAN_INTERVAL_MIN", "30")) * 60
CANDLE_LIMIT     = 200   # recent window per market (enough for all indicators)

# ─── market discovery ──────────────────────────────────────────────────────────

def _fetch_markets_sync() -> list[dict]:
    """Return all perp markets sorted by 24h volume descending."""
    payload = json.dumps({"type": "metaAndAssetCtxs"}).encode()
    req = urllib.request.Request(
        HL_INFO_URL, data=payload,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        result = json.loads(resp.read())

    meta_obj, ctxs = result[0], result[1]
    universe = meta_obj.get("universe", [])
    markets: list[dict] = []
    for i, asset in enumerate(universe):
        if i >= len(ctxs):
            break
        ctx  = ctxs[i]
        vol  = float(ctx.get("dayNtlVlm") or 0)
        mark = float(ctx.get("markPx") or ctx.get("midPx") or 0)
        if mark <= 0 or vol <= 0:
            continue
        markets.append({
            "coin":     asset.get("name", ""),
            "mark_px":  mark,
            "day_vol":  vol,
            "oi_usd":   float(ctx.get("openInterest") or 0) * mark,
        })

    markets.sort(key=lambda m: m["day_vol"], reverse=True)
    return markets


async def get_markets() -> list[dict]:
    return await asyncio.to_thread(_fetch_markets_sync)


# ─── candle fetcher ────────────────────────────────────────────────────────────

def _fetch_candles_sync(coin: str, interval: str, limit: int) -> list[dict]:
    """Fetch recent candles for any HL market (bypass the cache for non-core coins)."""
    now_ms   = int(time.time() * 1000)
    interval_ms_map = {
        "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000,
        "15m": 900_000,  "1m": 60_000,
    }
    iv_ms    = interval_ms_map.get(interval, 3_600_000)
    start_ms = now_ms - limit * iv_ms

    payload = json.dumps({
        "type": "candleSnapshot",
        "req":  {"coin": coin, "interval": interval,
                 "startTime": start_ms, "endTime": now_ms},
    }).encode()
    req = urllib.request.Request(
        HL_INFO_URL, data=payload,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        raw = json.loads(resp.read())

    candles = []
    for c in raw[-limit:]:
        candles.append({
            "time":   c["t"] // 1000,
            "open":   float(c["o"]),
            "high":   float(c["h"]),
            "low":    float(c["l"]),
            "close":  float(c["c"]),
            "volume": float(c.get("v", 0)),
        })
    return candles


async def fetch_market_candles(coin: str, interval: str = "1h") -> list[dict]:
    try:
        return await asyncio.to_thread(_fetch_candles_sync, coin, interval, CANDLE_LIMIT)
    except Exception as exc:
        log.debug("Candle fetch failed for %s: %s", coin, exc)
        return []


# ─── main scan cycle ───────────────────────────────────────────────────────────

async def run_scan(rl_state: dict, on_signal) -> list[dict]:
    """
    Run one full scan cycle.

    Args:
        rl_state:  live rl_state dict from main.py (for AI context)
        on_signal: async callback(signal_dict) called for each saved signal

    Returns:
        List of saved signal dicts.
    """
    from ai_signals import generate_signal
    import db as _db

    log.info("Scanner: starting scan (max %d markets)", MAX_SCAN_MARKETS)
    t0 = time.time()

    try:
        markets = await get_markets()
    except Exception as exc:
        log.warning("Scanner: market discovery failed: %s", exc)
        return []

    top_markets = markets[:MAX_SCAN_MARKETS]
    log.info("Scanner: %d markets queued (top by vol: %s)",
             len(top_markets), [m["coin"] for m in top_markets[:5]])

    saved: list[dict] = []

    for mkt in top_markets:
        coin = mkt["coin"]
        try:
            candles = await fetch_market_candles(coin, "1h")
            if len(candles) < 50:
                log.debug("Scanner: skipping %s — only %d candles", coin, len(candles))
                continue

            sig = await generate_signal(coin, "1h", candles, rl_state)
            if not sig:
                continue

            # Skip HOLD or low-confidence signals for alerts (still save all)
            is_actionable = (
                sig["signal"] in ("LONG", "SHORT")
                and sig["confidence"] >= MIN_CONFIDENCE
            )

            # Dedup: skip if same direction within last 4 hours for this coin
            latest = await asyncio.to_thread(_db.get_latest_signal, coin, "1h")
            if latest and latest["signal"] == sig["signal"]:
                age_h = (time.time() - latest["created_at"]) / 3600
                if age_h < 4:
                    log.debug("Scanner: %s same direction < 4h ago — skipping", coin)
                    continue

            saved_sig = await asyncio.to_thread(_db.save_signal, sig)
            saved.append(saved_sig)
            log.info("Scanner: %s 1h → %s (%d%% conf)", coin, sig["signal"], sig["confidence"])

            if is_actionable and on_signal:
                await on_signal(saved_sig)

        except Exception as exc:
            log.warning("Scanner: error on %s: %s", coin, exc)

        await asyncio.sleep(1.5)   # gentle pacing — avoid HL rate limits

    elapsed = time.time() - t0
    log.info("Scanner: cycle complete — %d signals in %.1fs", len(saved), elapsed)
    return saved


# ─── background loop ───────────────────────────────────────────────────────────

async def scanner_loop(rl_state_ref: dict, signal_alerts_ref: list,
                       on_signal_cb) -> None:
    """
    Background task — runs every SCAN_INTERVAL_S seconds.
    rl_state_ref: the live rl_state dict (mutated in-place by main.py)
    signal_alerts_ref: list to prepend new alert dicts into
    on_signal_cb: async callback(sig) called for each alert-worthy signal
    """
    from openrouter import OPENROUTER_API_KEY
    if not OPENROUTER_API_KEY:
        log.info("Scanner loop disabled — OPENROUTER_API_KEY not set")
        return

    log.info("Scanner loop starting (5-min warm-up delay)…")
    await asyncio.sleep(300)   # wait for candle cache to warm

    async def _on_signal(sig: dict):
        signal_alerts_ref.insert(0, sig)
        del signal_alerts_ref[50:]   # keep last 50
        if on_signal_cb:
            await on_signal_cb(sig)

    while True:
        try:
            await run_scan(rl_state_ref, _on_signal)
        except Exception as exc:
            log.warning("Scanner loop error: %s", exc)
        await asyncio.sleep(SCAN_INTERVAL_S)
