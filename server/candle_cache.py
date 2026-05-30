"""
MEGALPHA — Disk-backed candle cache
Stores full OHLC history per (coin, interval) on disk so charts load instantly
and are complete from each token's launch date.

Flow:
  • First request  → fetch full history from launch → save to disk → return
  • Later requests → load disk → fetch only the delta (new candles) → merge → save → return

Cache files live in server/cache/{COIN}_{interval}.json
"""

from __future__ import annotations
import asyncio
import json
import os
import tempfile
import time
from pathlib import Path
from typing import Awaitable, Callable

CACHE_DIR = Path(__file__).parent / "cache"
CACHE_DIR.mkdir(exist_ok=True)

# One lock per (coin, interval) to avoid concurrent fetch/write races
_locks: dict[str, asyncio.Lock] = {}


def _lock_for(key: str) -> asyncio.Lock:
    if key not in _locks:
        _locks[key] = asyncio.Lock()
    return _locks[key]


def _path(coin: str, interval: str) -> Path:
    return CACHE_DIR / f"{coin.upper()}_{interval}.json"


def _load(coin: str, interval: str) -> list[dict]:
    p = _path(coin, interval)
    if not p.exists():
        return []
    try:
        with p.open("r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _save(coin: str, interval: str, candles: list[dict]) -> None:
    p = _path(coin, interval)
    # Atomic write: temp file then replace, so a crash never leaves a corrupt cache
    fd, tmp = tempfile.mkstemp(dir=CACHE_DIR, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(candles, f, separators=(",", ":"))
        os.replace(tmp, p)
    except Exception:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise


def _merge(old: list[dict], new: list[dict]) -> list[dict]:
    """Merge two candle lists, deduped by time (newer overwrites), sorted ascending."""
    by_time: dict[int, dict] = {c["time"]: c for c in old}
    for c in new:                       # new wins on overlap (updates last open candle)
        by_time[c["time"]] = c
    return [by_time[t] for t in sorted(by_time)]


# Fetcher signature: async (coin, interval, start_ms, end_ms, max_total) -> list[dict]
Fetcher = Callable[[str, str, int, int, int], Awaitable[list[dict]]]


async def get_history(
    coin: str,
    interval: str,
    launch_ms: int,
    interval_ms: int,
    fetcher: Fetcher,
) -> list[dict]:
    """
    Return full candle history for (coin, interval), using disk cache + delta updates.
    """
    coin = coin.upper()
    key = f"{coin}_{interval}"

    async with _lock_for(key):
        cached = await asyncio.to_thread(_load, coin, interval)
        now_ms = int(time.time() * 1000)

        if cached:
            # Re-fetch from the last cached candle so the final (possibly open) candle updates
            last_time_ms = cached[-1]["time"] * 1000
            start_ms = last_time_ms
            # Nothing new to fetch if last candle is already current
            if now_ms - last_time_ms < interval_ms:
                return cached
            delta = await fetcher(coin, interval, start_ms, now_ms, 10_000)
            merged = _merge(cached, delta)
        else:
            # Cold cache — fetch everything from token launch (one-time cost)
            merged = await fetcher(coin, interval, launch_ms, now_ms, 1_000_000)

        if merged:
            await asyncio.to_thread(_save, coin, interval, merged)
        return merged
