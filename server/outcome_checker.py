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


async def check_all_outcomes(candle_history_fn) -> None:
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
    entry      = float(summary.get("entry")       or sig["price"])
    sl         = float(summary.get("stop_loss")   or 0)
    tp         = float(summary.get("take_profit") or 0)
    direction  = sig["signal"]
    signal_ts  = sig["time"]
    signal_id  = sig["id"]
    coin       = sig["coin"]
    interval   = sig["interval"]

    if sl <= 0 or tp <= 0:
        _maybe_expire(sig, _db)
        return

    candles = await candle_history_fn(coin, interval)
    future = [c for c in candles if c["time"] > signal_ts]
    now = int(time.time())
    max_age_s = EXPIRY_HOURS * 3600

    for candle in future:
        hi = candle["high"]
        lo = candle["low"]

        if direction == "LONG":
            if lo <= sl:
                pnl = round((sl - entry) / entry * 100, 3)
                await asyncio.to_thread(
                    _db.update_signal_outcome, signal_id, "LOSS", sl, candle["time"], pnl
                )
                log.info("Outcome: %s %s LONG → LOSS  SL @ $%.4f  P&L %.2f%%", coin, interval, sl, pnl)
                return
            if hi >= tp:
                pnl = round((tp - entry) / entry * 100, 3)
                await asyncio.to_thread(
                    _db.update_signal_outcome, signal_id, "WIN", tp, candle["time"], pnl
                )
                log.info("Outcome: %s %s LONG → WIN   TP @ $%.4f  P&L %.2f%%", coin, interval, tp, pnl)
                return

        elif direction == "SHORT":
            if hi >= sl:
                pnl = round(-abs((entry - sl) / entry * 100), 3)
                await asyncio.to_thread(
                    _db.update_signal_outcome, signal_id, "LOSS", sl, candle["time"], pnl
                )
                log.info("Outcome: %s %s SHORT → LOSS  SL @ $%.4f  P&L %.2f%%", coin, interval, sl, pnl)
                return
            if lo <= tp:
                pnl = round((entry - tp) / entry * 100, 3)
                await asyncio.to_thread(
                    _db.update_signal_outcome, signal_id, "WIN", tp, candle["time"], pnl
                )
                log.info("Outcome: %s %s SHORT → WIN   TP @ $%.4f  P&L %.2f%%", coin, interval, tp, pnl)
                return

    age_s = now - sig["created_at"]
    if age_s > max_age_s and future:
        last_close = future[-1]["close"]
        pnl = round(((last_close - entry) / entry * 100) if direction == "LONG"
                    else ((entry - last_close) / entry * 100), 3)
        await asyncio.to_thread(
            _db.update_signal_outcome, signal_id, "EXPIRED", last_close, now, pnl
        )
        log.info("Outcome: %s %s %s → EXPIRED after %dh  P&L %.2f%%",
                 coin, interval, direction, age_s // 3600, pnl)


def _maybe_expire(sig: dict, _db) -> None:
    age_s = int(time.time()) - sig["created_at"]
    if age_s > EXPIRY_HOURS * 3600:
        _db.update_signal_outcome(sig["id"], "EXPIRED", 0, int(time.time()), 0)


async def outcome_checker_loop(candle_history_fn) -> None:
    """Background task — checks outcomes every 15 minutes."""
    log.info("Outcome checker loop started")
    await asyncio.sleep(300)
    while True:
        try:
            await check_all_outcomes(candle_history_fn)
        except Exception as exc:
            log.warning("Outcome checker error: %s", exc)
        await asyncio.sleep(900)
