# -*- coding: utf-8 -*-
"""
MEGALPHA — Strategy Framework (4-strategy suite)

Strategies A-D: stop-hunt sniper, trend follower, FU candle sniper, unified sniper.
Also contains: ADX helper, BB width helper, regime detection, position sizing,
and phase detection. All pure functions — no side effects.

Import indicator helpers from backtest.py (they are also used by rl_features.py).
"""

from __future__ import annotations
import math
from typing import Optional

from backtest import _ema, _atr, _sma, _rolling_std, _rsi, _macd

# ─── pip floors per asset (fraction of price) ─────────────────────────────────

PIP_FLOORS = {
    "BTC": 0.001,   # 0.1%
    "ETH": 0.0006,  # 0.06%
    "SOL": 0.0004,  # 0.04%
    "GOLD": 0.0003,
    "DEFAULT": 0.0005,
}


def _pip_floor(coin: str) -> float:
    return PIP_FLOORS.get(coin.upper(), PIP_FLOORS["DEFAULT"])


# ─── ADX (Wilder's Average Directional Index) ─────────────────────────────────

def _adx(candles: list[dict], period: int = 14) -> list[float]:
    """
    Wilder's ADX. Returns per-bar ADX values (0-100).
    Needs at least 2*period bars to produce a meaningful result.
    """
    n = len(candles)
    out = [0.0] * n
    if n < period + 1:
        return out

    # True Range and directional movement
    trs: list[float] = []
    plus_dms: list[float] = []
    minus_dms: list[float] = []

    for i in range(1, n):
        high  = candles[i]["high"]
        low   = candles[i]["low"]
        prev_high  = candles[i - 1]["high"]
        prev_low   = candles[i - 1]["low"]
        prev_close = candles[i - 1]["close"]

        tr = max(high - low, abs(high - prev_close), abs(low - prev_close))
        trs.append(tr)

        up_move   = high - prev_high
        down_move = prev_low - low
        plus_dm  = up_move   if (up_move > down_move and up_move > 0)   else 0.0
        minus_dm = down_move if (down_move > up_move and down_move > 0) else 0.0
        plus_dms.append(plus_dm)
        minus_dms.append(minus_dm)

    if len(trs) < period:
        return out

    # Wilder smoothing (seed with simple average of first `period` bars)
    atr_w  = sum(trs[:period])
    pdm_w  = sum(plus_dms[:period])
    mdm_w  = sum(minus_dms[:period])

    dxs: list[float] = []

    def _di(pdm, mdm, atr_val):
        if atr_val <= 0:
            return 0.0, 0.0
        return (pdm / atr_val) * 100, (mdm / atr_val) * 100

    plus_di, minus_di = _di(pdm_w, mdm_w, atr_w)
    dx_sum = abs(plus_di - minus_di) / (plus_di + minus_di + 1e-9) * 100
    dxs.append(dx_sum)

    for i in range(period, len(trs)):
        # Wilder smoothing: new = old - old/period + new_raw
        atr_w  = atr_w  - atr_w  / period + trs[i]
        pdm_w  = pdm_w  - pdm_w  / period + plus_dms[i]
        mdm_w  = mdm_w  - mdm_w  / period + minus_dms[i]
        plus_di, minus_di = _di(pdm_w, mdm_w, atr_w)
        dx = abs(plus_di - minus_di) / (plus_di + minus_di + 1e-9) * 100
        dxs.append(dx)

    # ADX = Wilder smooth of DX (seed with first `period` DX values)
    if len(dxs) < period:
        return out

    adx_val = sum(dxs[:period]) / period
    # Map back to candles array: dxs[0] corresponds to candle[period] (0-indexed)
    adx_start = period * 2  # first meaningful candle index

    if adx_start < n:
        out[adx_start - 1] = adx_val   # index of last candle used for seed

    for j in range(period, len(dxs)):
        adx_val = (adx_val * (period - 1) + dxs[j]) / period
        candle_idx = j + period  # dxs[j] corresponds to candles[j + period]
        if candle_idx < n:
            out[candle_idx] = adx_val

    return out


# ─── Bollinger Band Width ──────────────────────────────────────────────────────

def _bb_width(closes: list[float], period: int = 20) -> list[float]:
    """BB width = (upper - lower) / middle * 100. Returns per-bar list."""
    n = len(closes)
    out = [0.0] * n
    sma = _sma(closes, period)
    std = _rolling_std(closes, period)
    for i in range(period - 1, n):
        mid = sma[i]
        if mid <= 0:
            continue
        upper = mid + 2 * std[i]
        lower = mid - 2 * std[i]
        out[i] = (upper - lower) / mid * 100
    return out


# ─── Swing high / low detector (rolling) ──────────────────────────────────────

def _swing_levels(candles: list[dict], lookback: int = 20) -> tuple[list, list]:
    """Rolling swing high and swing low over the last `lookback` bars."""
    n = len(candles)
    highs = [c["high"]  for c in candles]
    lows  = [c["low"]   for c in candles]
    swing_hi = [0.0] * n
    swing_lo = [0.0] * n
    for i in range(lookback, n):
        swing_hi[i] = max(highs[i - lookback : i])
        swing_lo[i] = min(lows[i  - lookback : i])
    return swing_hi, swing_lo


# ─── Regime Detection ─────────────────────────────────────────────────────────

def detect_regime(candles_4h: list[dict], _prev_state: Optional[dict] = None) -> dict:
    """
    Detect current market regime from 4h candles.

    Layers:
      1. ADX(14): < 20 → ranging (score 0), > 30 → trending (score 1) — weight 40%
      2. BB width vs 20-bar SMA of BB width: below avg → ranging, above → trending — weight 35%
      3. 21/55 EMA gap: < 0.8% → ranging, > 1.2% → trending — weight 25%

    Anti-whipsaw: requires 2 consecutive 4h candles at new threshold.
    Black swan: if last 1h candle > 4% move → HALTED.

    Returns dict with: state, adx, bb_width, ma_sep, score, consecutive
    """
    n = len(candles_4h)
    if n < 60:
        return {"state": "TRANSITION", "adx": 0.0, "bb_width": 0.0, "ma_sep": 0.0, "score": 0.5, "consecutive": 0}

    closes = [c["close"] for c in candles_4h]

    # Black swan check: last candle move > 4%
    last_c = candles_4h[-1]
    last_move = abs(last_c["close"] - last_c["open"]) / (last_c["open"] + 1e-9)
    if last_move > 0.04:
        return {"state": "HALTED", "adx": 0.0, "bb_width": 0.0, "ma_sep": 0.0, "score": 0.0, "consecutive": 0}

    adx_vals = _adx(candles_4h, 14)
    bb_widths = _bb_width(closes, 20)
    ema21 = _ema(closes, 21)
    ema55 = _ema(closes, 55)

    # Current and previous bar values (anti-whipsaw)
    def _score_bar(idx: int) -> float:
        adx = adx_vals[idx]
        bbw = bb_widths[idx]
        e21 = ema21[idx]
        e55 = ema55[idx]

        # Layer 1 (40%): ADX
        if adx < 20:
            l1 = 0.0
        elif adx > 30:
            l1 = 1.0
        else:
            l1 = (adx - 20) / 10.0  # linear interpolation

        # Layer 2 (35%): BB width vs its own 20-bar SMA
        bbw_sma = _sma(bb_widths, 20)
        bbw_avg = bbw_sma[idx]
        if bbw_avg > 0:
            if bbw < bbw_avg:
                l2 = 0.0
            elif bbw > bbw_avg * 1.1:
                l2 = 1.0
            else:
                l2 = (bbw - bbw_avg) / (bbw_avg * 0.1 + 1e-9)
        else:
            l2 = 0.5

        # Layer 3 (25%): EMA21/55 gap
        if e55 > 0:
            gap_pct = abs(e21 - e55) / e55 * 100
            if gap_pct < 0.8:
                l3 = 0.0
            elif gap_pct > 1.2:
                l3 = 1.0
            else:
                l3 = (gap_pct - 0.8) / 0.4
        else:
            l3 = 0.5

        return l1 * 0.40 + l2 * 0.35 + l3 * 0.25

    score_cur  = _score_bar(n - 1)
    score_prev = _score_bar(n - 2) if n >= 2 else score_cur

    # Anti-whipsaw: both bars must agree on the classification
    def _classify(s: float) -> str:
        if s < 0.35:   return "RANGING"
        if s > 0.65:   return "TRENDING"
        return "TRANSITION"

    cls_cur  = _classify(score_cur)
    cls_prev = _classify(score_prev)

    if cls_cur == cls_prev:
        state = cls_cur
        consecutive = 2
    else:
        state = "TRANSITION"
        consecutive = 1

    return {
        "state":       state,
        "adx":         round(adx_vals[n - 1], 2),
        "bb_width":    round(bb_widths[n - 1], 2),
        "ma_sep":      round(abs(ema21[n - 1] - ema55[n - 1]) / (ema55[n - 1] + 1e-9) * 100, 3),
        "score":       round(score_cur, 3),
        "consecutive": consecutive,
    }


# ─── Strategy A: Stop-Hunt / Liquidity Sweep Sniper ───────────────────────────

def score_strategy_a(candles: list[dict], coin: str = "BTC") -> Optional[dict]:
    """
    4-condition scoring. Need >= 75 points out of 100 to fire.

    1. Wick breach 0.15%-1.5% beyond swing level (25 pts) — outside range = skip
    2. Volume spike >= 2x 20-bar avg (25 pts) — if > 5x, genuine break, return None
    3. Close reclaim — candle closes back inside level (30 pts) — NON-NEGOTIABLE
    4. HTF alignment — EMA20 > EMA50 agrees with reversal direction (20 pts)

    Adaptive SL: max(ATR14 * 0.6, asset_pip_floor * entry_price)
    3-part TP: tp1=2R, tp2=3.5R, tp3=5R
    """
    n = len(candles)
    if n < 25:
        return None

    closes = [c["close"] for c in candles]
    highs  = [c["high"]  for c in candles]
    lows   = [c["low"]   for c in candles]
    vols   = [c.get("volume", 0.0) for c in candles]

    atr14  = _atr(candles, 14)
    ema20  = _ema(closes, 20)
    ema50  = _ema(closes, 50)

    i = n - 1
    candle = candles[i]
    close  = closes[i]
    high   = highs[i]
    low    = lows[i]
    atr    = atr14[i]

    # Swing levels from 20-bar rolling window
    if i < 20:
        return None
    swing_hi = max(highs[i - 20 : i])
    swing_lo = min(lows[i  - 20 : i])

    # Volume context
    vol_avg = sum(vols[i - 20 : i]) / 20 if i >= 20 else 1.0

    score = 0
    conditions: dict = {}
    direction = None
    sweep_level = 0.0

    # --- Check LONG setup (sweep below swing_lo then reclaim) ---
    long_valid = False
    if low < swing_lo and close > swing_lo:
        breach_pct = (swing_lo - low) / (swing_lo + 1e-9) * 100
        conditions["wick_breach_pct"] = round(breach_pct, 3)
        if 0.15 <= breach_pct <= 1.5:
            score += 25
            conditions["cond1_wick"] = True
            direction = "long"
            sweep_level = swing_lo

            # Cond 3: close reclaim (NON-NEGOTIABLE)
            if close > swing_lo:
                score += 30
                conditions["cond3_reclaim"] = True
            else:
                return None  # non-negotiable

            # Cond 2: volume spike
            vol_cur = vols[i] if vols[i] > 0 else vol_avg
            vol_ratio = vol_cur / (vol_avg + 1e-9)
            conditions["vol_ratio"] = round(vol_ratio, 2)
            if vol_ratio > 5.0:
                return None  # genuine breakdown, not a sweep
            if vol_ratio >= 2.0:
                score += 25
                conditions["cond2_vol"] = True

            # Cond 4: HTF EMA alignment (EMA20 > EMA50 = bullish bias agrees with long reversal)
            if ema20[i] > ema50[i]:
                score += 20
                conditions["cond4_htf"] = True

            long_valid = True

    # --- Check SHORT setup (sweep above swing_hi then reclaim) ---
    short_valid = False
    if not long_valid and high > swing_hi and close < swing_hi:
        breach_pct = (high - swing_hi) / (swing_hi + 1e-9) * 100
        conditions["wick_breach_pct"] = round(breach_pct, 3)
        if 0.15 <= breach_pct <= 1.5:
            score += 25
            conditions["cond1_wick"] = True
            direction = "short"
            sweep_level = swing_hi

            # Cond 3: close reclaim (NON-NEGOTIABLE)
            if close < swing_hi:
                score += 30
                conditions["cond3_reclaim"] = True
            else:
                return None  # non-negotiable

            # Cond 2: volume spike
            vol_cur = vols[i] if vols[i] > 0 else vol_avg
            vol_ratio = vol_cur / (vol_avg + 1e-9)
            conditions["vol_ratio"] = round(vol_ratio, 2)
            if vol_ratio > 5.0:
                return None  # genuine breakout
            if vol_ratio >= 2.0:
                score += 25
                conditions["cond2_vol"] = True

            # Cond 4: HTF EMA alignment (EMA20 < EMA50 = bearish agrees with short reversal)
            if ema20[i] < ema50[i]:
                score += 20
                conditions["cond4_htf"] = True

            short_valid = True

    if not (long_valid or short_valid):
        return None

    if score < 75:
        return None

    # Adaptive SL
    pip_fl = _pip_floor(coin)
    sl_atr = atr * 0.6
    sl_pip = close * pip_fl
    sl_dist = max(sl_atr, sl_pip)

    entry = close
    if direction == "long":
        sl = entry - sl_dist
        tp1 = entry + 2.0   * sl_dist
        tp2 = entry + 3.5   * sl_dist
        tp3 = entry + 5.0   * sl_dist
    else:
        sl = entry + sl_dist
        tp1 = entry - 2.0   * sl_dist
        tp2 = entry - 3.5   * sl_dist
        tp3 = entry - 5.0   * sl_dist

    return {
        "strategy":    "stop_hunt_a",
        "direction":   direction,
        "score":       score,
        "conditions":  conditions,
        "entry":       round(entry, 6),
        "sl":          round(sl, 6),
        "tp1":         round(tp1, 6),
        "tp2":         round(tp2, 6),
        "tp3":         round(tp3, 6),
        "sweep_level": round(sweep_level, 6),
        "atr":         round(atr, 6),
        "sl_dist":     round(sl_dist, 6),
    }


# ─── Strategy B: EMA Cross Trend Follower ─────────────────────────────────────

def signal_strategy_b(
    candles_1h: list[dict],
    candles_4h: list[dict],
) -> Optional[dict]:
    """
    Trend-following strategy. Returns signal dict or None.

    Primary: EMA21 crosses EMA55 on 1h.
    Confirmation: ADX(14) on 4h > 25.
    Macro filter: price above EMA200 on 4h for longs, below for shorts.
    Initial stop: 2.5 * ATR14.
    Tighten at 2R: reduce to 1.5 * ATR14.
    """
    n1 = len(candles_1h)
    n4 = len(candles_4h)
    if n1 < 60 or n4 < 60:
        return None

    closes_1h  = [c["close"] for c in candles_1h]
    ema21_1h   = _ema(closes_1h, 21)
    ema55_1h   = _ema(closes_1h, 55)
    atr14_1h   = _atr(candles_1h, 14)

    closes_4h  = [c["close"] for c in candles_4h]
    adx_4h     = _adx(candles_4h, 14)
    ema200_4h  = _ema(closes_4h, 200)

    i1 = n1 - 1
    i4 = n4 - 1

    # EMA cross on 1h
    prev_cross = ema21_1h[i1 - 1] - ema55_1h[i1 - 1]
    curr_cross = ema21_1h[i1]     - ema55_1h[i1]

    bullish_cross = prev_cross <= 0 < curr_cross
    bearish_cross = prev_cross >= 0 > curr_cross

    if not (bullish_cross or bearish_cross):
        return None

    direction = "long" if bullish_cross else "short"

    # ADX filter on 4h
    adx_now = adx_4h[i4]
    if adx_now < 25:
        return None

    # Macro EMA200 filter on 4h
    ema200_now = ema200_4h[i4]
    close_4h   = closes_4h[i4]
    if direction == "long"  and close_4h < ema200_now:
        return None
    if direction == "short" and close_4h > ema200_now:
        return None

    entry = closes_1h[i1]
    atr   = atr14_1h[i1]

    sl_init  = 2.5 * atr
    sl_tight = 1.5 * atr

    if direction == "long":
        sl         = entry - sl_init
        partial_1r5 = entry + 1.5 * sl_init
        partial_3r  = entry + 3.0 * sl_init
    else:
        sl         = entry + sl_init
        partial_1r5 = entry - 1.5 * sl_init
        partial_3r  = entry - 3.0 * sl_init

    return {
        "strategy":         "trend_follow_b",
        "direction":        direction,
        "entry":            round(entry, 6),
        "sl":               round(sl, 6),
        "sl_tight":         round(sl_tight, 6),
        "partial_close_at_1r5": round(partial_1r5, 6),
        "partial_close_at_3r":  round(partial_3r, 6),
        "atr_trail_mult":   2.5,
        "atr_tight_mult":   1.5,
        "conditions": {
            "ema_cross":   direction,
            "adx_4h":      round(adx_now, 1),
            "ema200_4h":   round(ema200_now, 2),
            "price_4h":    round(close_4h, 2),
        },
    }


# ─── Strategy C: FU Candle Sniper ─────────────────────────────────────────────

def _detect_orderblocks(candles: list[dict], lookback: int = 20) -> list[dict]:
    """
    Detect orderblocks: last opposing candle before a big move (body only, no wicks).
    An orderblock is a bullish candle just before a bearish expansion or vice versa.
    """
    n = len(candles)
    obs: list[dict] = []
    for i in range(max(1, n - lookback), n - 1):
        c = candles[i]
        nxt = candles[i + 1]
        body_c   = abs(c["close"]   - c["open"])
        body_nxt = abs(nxt["close"] - nxt["open"])
        if body_nxt < body_c * 1.5:
            continue
        # Bullish OB (before bearish expansion): last green candle before red expansion
        if c["close"] > c["open"] and nxt["close"] < nxt["open"]:
            obs.append({"type": "supply", "top": c["close"], "bot": c["open"], "idx": i})
        # Bearish OB (before bullish expansion): last red candle before green expansion
        elif c["close"] < c["open"] and nxt["close"] > nxt["open"]:
            obs.append({"type": "demand", "top": c["open"], "bot": c["close"], "idx": i})
    return obs


def _detect_fvg(candles: list[dict], lookback: int = 20) -> list[dict]:
    """
    Fair Value Gap (Imbalance): gap between prev candle high and next candle low (or vice versa).
    Three-candle pattern: FVG = gap between candles[i-1] and candles[i+1] not covered by candles[i].
    """
    n = len(candles)
    fvgs: list[dict] = []
    start = max(1, n - lookback - 1)
    for i in range(start, n - 1):
        prev = candles[i - 1]
        curr = candles[i]     # noqa: F841
        nxt  = candles[i + 1]
        # Bullish FVG: prev high < next low → gap above
        if prev["high"] < nxt["low"]:
            fvgs.append({"type": "bullish", "top": nxt["low"], "bot": prev["high"], "idx": i})
        # Bearish FVG: prev low > next high → gap below
        elif prev["low"] > nxt["high"]:
            fvgs.append({"type": "bearish", "top": prev["low"], "bot": nxt["high"], "idx": i})
    return fvgs


def detect_fu_candle(candles: list[dict], min_rr: float = 6.0) -> Optional[dict]:
    """
    FU Candle (Fake-out / Liquidity Grab):
      1. Wick sweeps through a key level (swing high/low or round number)
      2. Candle closes back in opposite direction (structure broken)

    Entry: 50% midpoint of the wick.
    Stop: just beyond full wick extreme + 0.5-pip buffer.
    Minimum 6:1 R:R enforced.
    """
    n = len(candles)
    if n < 25:
        return None

    highs  = [c["high"]  for c in candles]
    lows   = [c["low"]   for c in candles]
    closes = [c["close"] for c in candles]
    opens  = [c["open"]  for c in candles]

    # Swing levels from 20-bar lookback (excluding last candle)
    i = n - 1
    if i < 20:
        return None
    swing_hi = max(highs[i - 20 : i])
    swing_lo = min(lows[i  - 20 : i])

    candle = candles[i]
    high   = candle["high"]
    low    = candle["low"]
    close  = candle["close"]
    open_  = candle["open"]

    direction = None
    wick_extreme = 0.0
    wick_entry   = 0.0
    swept_level  = 0.0

    # Long FU: wick sweeps below swing_lo, candle closes above open (or above swing_lo)
    if low < swing_lo and close > open_ and close > swing_lo:
        direction   = "long"
        wick_extreme = low
        swept_level  = swing_lo
        # Entry at 50% midpoint of wick: from extreme to swing_lo
        wick_entry = (wick_extreme + swept_level) / 2

    # Short FU: wick sweeps above swing_hi, candle closes below open (or below swing_hi)
    elif high > swing_hi and close < open_ and close < swing_hi:
        direction   = "short"
        wick_extreme = high
        swept_level  = swing_hi
        # Entry at 50% midpoint of wick: from extreme to swing_hi
        wick_entry = (wick_extreme + swept_level) / 2

    if direction is None:
        return None

    # SL: just beyond full wick extreme + 0.5% buffer
    buffer = abs(wick_extreme) * 0.005
    if direction == "long":
        sl    = wick_extreme - buffer
        entry = wick_entry
        # TP targets: structural targets above entry
        sl_dist = entry - sl
        tp1     = entry + sl_dist * 3.0
        tp2     = entry + sl_dist * 6.0
        tp3     = entry + sl_dist * 10.0
    else:
        sl    = wick_extreme + buffer
        entry = wick_entry
        sl_dist = sl - entry
        tp1     = entry - sl_dist * 3.0
        tp2     = entry - sl_dist * 6.0
        tp3     = entry - sl_dist * 10.0

    if sl_dist <= 0:
        return None

    # Verify minimum R:R
    rr = abs(tp2 - entry) / sl_dist  # use tp2 as baseline R:R check
    if rr < min_rr:
        return None

    # Orderblocks and FVG
    obs  = _detect_orderblocks(candles)
    fvgs = _detect_fvg(candles)

    return {
        "strategy":       "sniper_c",
        "direction":      direction,
        "entry":          round(entry, 6),
        "sl":             round(sl, 6),
        "tp1":            round(tp1, 6),
        "tp2":            round(tp2, 6),
        "tp3":            round(tp3, 6),
        "min_rr":         min_rr,
        "rr":             round(rr, 2),
        "wick_extreme":   round(wick_extreme, 6),
        "swept_level":    round(swept_level, 6),
        "fu_candle_idx":  i,
        "orderblocks":    obs,
        "fvg_zones":      fvgs,
    }


# ─── Strategy D: Unified Sniper ────────────────────────────────────────────────

def score_strategy_d(candles: list[dict], coin: str = "BTC") -> Optional[dict]:
    """
    8-condition scoring system (max 100 pts, need >= 60 to fire):
      1. Wick breach 0.15-1.5% (10 pts)
      2. Volume spike >= 2x (15 pts) — if > 5x, skip
      3. Close reclaim (15 pts) — NON-NEGOTIABLE
      4. HTF bias alignment (10 pts)
      5. FU candle confirmed — liquidity taken + structure broken same candle (20 pts) — highest weight
      6. Orderblock present at the level (10 pts)
      7. Imbalance / FVG target visible above/below (10 pts)
      8. Liquidation density (round number or recent equal highs/lows within 0.3%) (10 pts)

    Entry: 50% of FU wick midpoint.
    R:R minimum: 5:1.
    If 8/8 (100 pts): size_multiplier=1.5.
    """
    n = len(candles)
    if n < 30:
        return None

    closes = [c["close"] for c in candles]
    highs  = [c["high"]  for c in candles]
    lows   = [c["low"]   for c in candles]
    vols   = [c.get("volume", 0.0) for c in candles]

    atr14 = _atr(candles, 14)
    ema20 = _ema(closes, 20)
    ema50 = _ema(closes, 50)

    i = n - 1
    candle = candles[i]
    close  = closes[i]
    high   = highs[i]
    low    = lows[i]
    open_  = candle["open"]
    atr    = atr14[i]

    # Swing levels
    if i < 20:
        return None
    swing_hi = max(highs[i - 20 : i])
    swing_lo = min(lows[i  - 20 : i])

    # Volume
    vol_avg = sum(vols[i - 20 : i]) / 20 if i >= 20 else 1.0
    vol_cur = vols[i] if vols[i] > 0 else vol_avg
    vol_ratio = vol_cur / (vol_avg + 1e-9)

    score = 0
    conditions: dict = {}
    direction = None
    wick_extreme  = 0.0
    swept_level   = 0.0

    # Determine direction from wick sweep
    if low < swing_lo and close > swing_lo:
        direction    = "long"
        wick_extreme = low
        swept_level  = swing_lo
        breach_pct   = (swing_lo - low) / (swing_lo + 1e-9) * 100
    elif high > swing_hi and close < swing_hi:
        direction    = "short"
        wick_extreme = high
        swept_level  = swing_hi
        breach_pct   = (high - swing_hi) / (swing_hi + 1e-9) * 100
    else:
        return None

    conditions["breach_pct"] = round(breach_pct, 3)

    # Cond 1: wick breach 0.15-1.5% (10 pts)
    if 0.15 <= breach_pct <= 1.5:
        score += 10
        conditions["cond1_wick"] = True

    # Cond 2: volume spike (15 pts) — if > 5x, skip
    conditions["vol_ratio"] = round(vol_ratio, 2)
    if vol_ratio > 5.0:
        return None
    if vol_ratio >= 2.0:
        score += 15
        conditions["cond2_vol"] = True

    # Cond 3: close reclaim (15 pts) — NON-NEGOTIABLE
    if direction == "long"  and close > swept_level:
        score += 15
        conditions["cond3_reclaim"] = True
    elif direction == "short" and close < swept_level:
        score += 15
        conditions["cond3_reclaim"] = True
    else:
        return None  # non-negotiable

    # Cond 4: HTF bias alignment (10 pts)
    if direction == "long"  and ema20[i] > ema50[i]:
        score += 10
        conditions["cond4_htf"] = True
    elif direction == "short" and ema20[i] < ema50[i]:
        score += 10
        conditions["cond4_htf"] = True

    # Cond 5: FU candle — liquidity taken + structure broken in same candle (20 pts)
    fu_confirmed = False
    if direction == "long":
        # Wick below swing_lo AND close above open (bullish close = structure broken)
        if low < swing_lo and close > open_:
            fu_confirmed = True
    else:
        # Wick above swing_hi AND close below open (bearish close = structure broken)
        if high > swing_hi and close < open_:
            fu_confirmed = True
    if fu_confirmed:
        score += 20
        conditions["cond5_fu_candle"] = True

    # Cond 6: orderblock present at the level (10 pts)
    obs = _detect_orderblocks(candles)
    ob_at_level = False
    for ob in obs:
        if direction == "long"  and ob["type"] == "demand" and ob["bot"] <= swept_level <= ob["top"] * 1.005:
            ob_at_level = True; break
        if direction == "short" and ob["type"] == "supply" and ob["bot"] * 0.995 <= swept_level <= ob["top"]:
            ob_at_level = True; break
    if ob_at_level:
        score += 10
        conditions["cond6_orderblock"] = True

    # Cond 7: FVG target visible (10 pts)
    fvgs = _detect_fvg(candles)
    fvg_target = False
    for fvg in fvgs:
        if direction == "long"  and fvg["type"] == "bullish" and fvg["bot"] > close:
            fvg_target = True; break
        if direction == "short" and fvg["type"] == "bearish" and fvg["top"] < close:
            fvg_target = True; break
    if fvg_target:
        score += 10
        conditions["cond7_fvg"] = True

    # Cond 8: liquidation density — round number or equal highs/lows within 0.3% (10 pts)
    liq_density = False
    # Round number check: price within 0.3% of a round number
    round_levels = [round(swept_level / magnitude) * magnitude
                    for magnitude in [1, 10, 100, 1000, 10000]]
    for rl in round_levels:
        if rl > 0 and abs(swept_level - rl) / rl < 0.003:
            liq_density = True; break
    # Equal highs/lows: find 2+ highs/lows within 0.3% of swept_level in last 20 bars
    if not liq_density:
        near_count = 0
        for j in range(max(0, i - 20), i):
            if direction == "long":
                if abs(lows[j] - swept_level) / (swept_level + 1e-9) < 0.003:
                    near_count += 1
            else:
                if abs(highs[j] - swept_level) / (swept_level + 1e-9) < 0.003:
                    near_count += 1
        if near_count >= 2:
            liq_density = True
    if liq_density:
        score += 10
        conditions["cond8_liq_density"] = True

    if score < 60:
        return None

    # Entry at 50% wick midpoint (same as Strategy C precision)
    entry = (wick_extreme + swept_level) / 2

    # SL: beyond wick extreme + buffer
    buffer = abs(wick_extreme) * 0.005
    if direction == "long":
        sl      = wick_extreme - buffer
        sl_dist = entry - sl
        tp1     = entry + sl_dist * 2.5
        tp2     = entry + sl_dist * 5.0
        tp3     = entry + sl_dist * 8.0
    else:
        sl      = wick_extreme + buffer
        sl_dist = sl - entry
        tp1     = entry - sl_dist * 2.5
        tp2     = entry - sl_dist * 5.0
        tp3     = entry - sl_dist * 8.0

    if sl_dist <= 0:
        return None

    rr = abs(tp2 - entry) / sl_dist
    if rr < 5.0:
        return None

    size_multiplier = 1.5 if score == 100 else 1.0

    return {
        "strategy":        "unified_d",
        "direction":       direction,
        "score":           score,
        "conditions":      conditions,
        "entry":           round(entry, 6),
        "sl":              round(sl, 6),
        "tp1":             round(tp1, 6),
        "tp2":             round(tp2, 6),
        "tp3":             round(tp3, 6),
        "size_multiplier": size_multiplier,
        "rr":              round(rr, 2),
        "wick_extreme":    round(wick_extreme, 6),
        "swept_level":     round(swept_level, 6),
        "orderblocks":     obs,
        "fvg_zones":       fvgs,
        "fu_candle_idx":   i,
    }


# ─── Position Sizing ───────────────────────────────────────────────────────────

def calc_lot_size(
    equity: float,
    risk_pct: float,
    sl_pips: float,
    pip_value: float = 0.01,
) -> float:
    """
    Formula: Lot Size = (equity * risk_pct) / (sl_pips * pip_value)
    Minimum: 0.01 micro lots.
    """
    if sl_pips <= 0 or pip_value <= 0:
        return 0.01
    lot = (equity * risk_pct) / (sl_pips * pip_value)
    return max(0.01, round(lot, 2))


# ─── Phase Detection ──────────────────────────────────────────────────────────

def detect_phase(equity: float) -> dict:
    """
    Phase 1: equity < 300    → risk_pct=0.05, label='AGGRESSIVE'
    Phase 2: 300 <= eq < 1000 → risk_pct=0.03, label='CONTROLLED'
    Phase 3: equity >= 1000  → risk_pct=0.02, label='COMPOUNDING'
    """
    if equity < 300:
        return {"phase": 1, "risk_pct": 0.05, "label": "AGGRESSIVE"}
    if equity < 1000:
        return {"phase": 2, "risk_pct": 0.03, "label": "CONTROLLED"}
    return {"phase": 3, "risk_pct": 0.02, "label": "COMPOUNDING"}
