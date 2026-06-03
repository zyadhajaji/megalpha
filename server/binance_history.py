"""
MEGALPHA — Binance historical backfill.

Hyperliquid only retains ~5,000 recent candles per interval, so fine-grained
history (15m/1h/4h) can't reach each coin's launch from HL — the data isn't there.
Binance has the full BTC/ETH/SOL history at near-identical prices, so we backfill
the OLDER portion from Binance and keep HL for the recent window (HL wins on any
overlap). Live/ongoing candle updates stay HL-only; this is a one-time deepen.
"""

from __future__ import annotations
import json
import time
import urllib.request

import candle_cache

BINANCE_URL = "https://api.binance.com/api/v3/klines"
SYMBOL = {"BTC": "BTCUSDT", "ETH": "ETHUSDT", "SOL": "SOLUSDT", "PAXG": "PAXGUSDT"}
_VALID = {"15m", "1h", "4h", "1d"}   # same interval labels on both venues


def fetch_klines(symbol: str, interval: str, start_ms: int, end_ms: int,
                 pause: float = 0.12) -> list[dict]:
    """Page Binance klines forward [start_ms, end_ms) → candle dicts
    {time(s), open, high, low, close, volume}, sorted + deduped."""
    out: list[dict] = []
    cursor = start_ms
    while cursor < end_ms:
        url = (f"{BINANCE_URL}?symbol={symbol}&interval={interval}"
               f"&startTime={cursor}&endTime={end_ms}&limit=1000")
        try:
            with urllib.request.urlopen(url, timeout=20) as r:
                rows = json.loads(r.read())
        except Exception as exc:
            print(f"  binance fetch error {symbol} {interval} @ {cursor}: {exc}")
            break
        if not rows:
            break
        for k in rows:
            out.append({
                "time":   int(k[0]) // 1000,
                "open":   float(k[1]),
                "high":   float(k[2]),
                "low":    float(k[3]),
                "close":  float(k[4]),
                "volume": float(k[5]),
            })
        if len(rows) < 1000:
            break
        nxt = int(rows[-1][0]) + 1
        if nxt <= cursor:
            break
        cursor = nxt
        time.sleep(pause)
    seen: set[int] = set()
    uniq: list[dict] = []
    for c in out:
        if c["time"] not in seen:
            seen.add(c["time"])
            uniq.append(c)
    return sorted(uniq, key=lambda c: c["time"])


def backfill(coin: str, interval: str, launch_ms: int) -> dict:
    """Prepend Binance history (launch → current cache earliest) to the HL cache."""
    coin = coin.upper()
    if interval not in _VALID:
        return {"coin": coin, "interval": interval, "skipped": "unsupported interval"}
    sym = SYMBOL.get(coin)
    if not sym:
        return {"coin": coin, "interval": interval, "skipped": "no symbol map"}

    existing = candle_cache._load(coin, interval)
    earliest_s = existing[0]["time"] if existing else int(time.time())
    binance = fetch_klines(sym, interval, launch_ms, earliest_s * 1000)
    older = [c for c in binance if c["time"] < earliest_s]   # HL keeps the recent window
    merged = candle_cache._merge(older, existing)            # existing (HL) wins on overlap
    if merged:
        candle_cache._save(coin, interval, merged)
    return {
        "coin": coin, "interval": interval,
        "added": len(older), "before": len(existing), "after": len(merged),
        "first": merged[0]["time"] if merged else 0,
    }
