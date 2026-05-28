"""
MEGALPHA — Sniper Signal Engine
Based on: "From Zero to Sniper" (WealthyBruvs) — ICT/SMC methodology

Detects:
  • FU Candles      — liquidity sweep + structure break (the core entry trigger)
  • Orderblocks     — last opposing candle before a strong institutional move
  • Fair Value Gaps — imbalance zones price is compelled to fill
  • Liquidity Lvls  — swing highs/lows and equal highs/lows (bank targets)
  • Market Structure — bias direction (bullish / bearish / ranging)
  • Sniper Score    — composite setup quality 0-100
"""

from __future__ import annotations
from typing import TypedDict

# ─── types ────────────────────────────────────────────────────────────────────

class Candle(TypedDict):
    time:  int    # unix seconds (minute bar)
    open:  float
    high:  float
    low:   float
    close: float

# ─── helpers ──────────────────────────────────────────────────────────────────

def _body_top(c: Candle) -> float:
    return max(c["open"], c["close"])

def _body_bot(c: Candle) -> float:
    return min(c["open"], c["close"])

def _bullish(c: Candle) -> bool:
    return c["close"] > c["open"]

def _bearish(c: Candle) -> bool:
    return c["close"] < c["open"]

def _size(c: Candle) -> float:
    """Total candle range as % of price."""
    return (c["high"] - c["low"]) / (c["close"] + 1e-9)

def _body_size(c: Candle) -> float:
    return abs(c["close"] - c["open"]) / (c["close"] + 1e-9)

# ─── 1 · FU Candles ──────────────────────────────────────────────────────────
# Definition (ebook Chapter 5):
#   A single candle that:
#     1. Wicks through a prior key level (takes liquidity)
#     2. Closes on the opposite side of that level (breaks structure)
#
# Simplified pattern for live detection on 1-min/5-min bars:
#   Bullish FU: low wicks below the prior candle's low, then closes ABOVE it.
#   Bearish FU: high wicks above the prior candle's high, then closes BELOW it.
#
# Entry   = 50 % of the liquidity wick
# Stop    = extreme of the wick
# Min RR  = 1:5 (validated by caller / UI)

def detect_fu_candles(candles: list[Candle], min_wick_pct: float = 0.0003) -> list[dict]:
    """
    Returns FU candle signals from the last N candles.
    `min_wick_pct` = minimum wick extension past the prior level, as fraction of price.
    """
    if len(candles) < 2:
        return []

    signals: list[dict] = []

    for i in range(1, len(candles)):
        prev = candles[i - 1]
        curr = candles[i]
        price = curr["close"]

        # ── Bullish FU ──────────────────────────────────────────────────────
        # Wick swept below prev.low AND closed back above prev.low
        wick_below = prev["low"] - curr["low"]
        if wick_below > min_wick_pct * price and curr["close"] > prev["low"]:
            wick_pct   = wick_below / price * 100
            entry      = curr["low"] + wick_below * 0.50   # 50 % into wick
            sl         = curr["low"] - price * 0.0001      # just below wick
            strength   = min(100, int(wick_pct * 400))

            signals.append({
                "type":      "FU_BULL",
                "time":      curr["time"],
                "price":     price,
                "entry":     round(entry, 6),
                "sl":        round(sl, 6),
                "wick_high": round(curr["high"], 6),
                "wick_low":  round(curr["low"], 6),
                "wick_pct":  round(wick_pct, 3),
                "strength":  strength,
                "label":     f"Bullish FU — {wick_pct:.2f}% sweep",
            })

        # ── Bearish FU ──────────────────────────────────────────────────────
        # Wick swept above prev.high AND closed back below prev.high
        wick_above = curr["high"] - prev["high"]
        if wick_above > min_wick_pct * price and curr["close"] < prev["high"]:
            wick_pct   = wick_above / price * 100
            entry      = curr["high"] - wick_above * 0.50
            sl         = curr["high"] + price * 0.0001
            strength   = min(100, int(wick_pct * 400))

            signals.append({
                "type":      "FU_BEAR",
                "time":      curr["time"],
                "price":     price,
                "entry":     round(entry, 6),
                "sl":        round(sl, 6),
                "wick_high": round(curr["high"], 6),
                "wick_low":  round(curr["low"], 6),
                "wick_pct":  round(wick_pct, 3),
                "strength":  strength,
                "label":     f"Bearish FU — {wick_pct:.2f}% sweep",
            })

    return signals


# ─── 2 · Orderblocks ─────────────────────────────────────────────────────────
# Definition (ebook Chapter 4):
#   Last opposing candle before a strong institutional move.
#   Bullish OB = last BEARISH candle before a strong bullish leg.
#   Bearish OB = last BULLISH candle before a strong bearish leg.
#   Zone drawn using BODY only (no wicks).
#
# Strong move threshold: next candle range > `strong_move_pct` of price.

def detect_orderblocks(candles: list[Candle], strong_move_pct: float = 0.0015) -> list[dict]:
    """
    Returns up to 6 most recent orderblocks.
    """
    if len(candles) < 4:
        return []

    obs: list[dict] = []

    for i in range(len(candles) - 2):
        ob_candle  = candles[i]
        trigger    = candles[i + 1]

        move = abs(trigger["close"] - ob_candle["close"]) / (ob_candle["close"] + 1e-9)
        if move < strong_move_pct:
            continue

        bullish_move = trigger["close"] > ob_candle["close"]

        # Bullish OB: ob_candle is bearish before bullish move
        if _bearish(ob_candle) and bullish_move:
            obs.append({
                "type":     "OB_BULL",
                "time":     ob_candle["time"],
                "top":      round(_body_top(ob_candle), 6),
                "bottom":   round(_body_bot(ob_candle), 6),
                "midpoint": round((_body_top(ob_candle) + _body_bot(ob_candle)) / 2, 6),
                "strength": min(100, int(move * 800)),
                "label":    f"Bullish OB — {move*100:.2f}% move",
            })

        # Bearish OB: ob_candle is bullish before bearish move
        elif _bullish(ob_candle) and not bullish_move:
            obs.append({
                "type":     "OB_BEAR",
                "time":     ob_candle["time"],
                "top":      round(_body_top(ob_candle), 6),
                "bottom":   round(_body_bot(ob_candle), 6),
                "midpoint": round((_body_top(ob_candle) + _body_bot(ob_candle)) / 2, 6),
                "strength": min(100, int(move * 800)),
                "label":    f"Bearish OB — {move*100:.2f}% move",
            })

    # Return last 6 (most recent / most relevant)
    return obs[-6:]


# ─── 3 · Fair Value Gaps (Imbalances) ────────────────────────────────────────
# Definition (ebook Chapter 6):
#   A 3-candle pattern where candle[n-1].high < candle[n+1].low  (bullish FVG)
#   or                       candle[n-1].low  > candle[n+1].high (bearish FVG).
#   The gap zone is between those two extremes. Price is compelled to fill it.

def detect_fair_value_gaps(candles: list[Candle], min_gap_pct: float = 0.0002) -> list[dict]:
    """
    Returns up to 6 most recent FVGs.
    """
    if len(candles) < 3:
        return []

    fvgs: list[dict] = []

    for i in range(1, len(candles) - 1):
        prev = candles[i - 1]
        curr = candles[i]
        nxt  = candles[i + 1]

        # Bullish FVG: gap between prev.high and next.low
        if prev["high"] < nxt["low"]:
            gap = nxt["low"] - prev["high"]
            if gap / curr["close"] >= min_gap_pct:
                fvgs.append({
                    "type":     "FVG_BULL",
                    "time":     curr["time"],
                    "top":      round(nxt["low"],   6),
                    "bottom":   round(prev["high"],  6),
                    "midpoint": round((nxt["low"] + prev["high"]) / 2, 6),
                    "gap_pct":  round(gap / curr["close"] * 100, 3),
                    "label":    f"Bull FVG — {gap / curr['close']*100:.2f}%",
                })

        # Bearish FVG: gap between prev.low and next.high
        elif prev["low"] > nxt["high"]:
            gap = prev["low"] - nxt["high"]
            if gap / curr["close"] >= min_gap_pct:
                fvgs.append({
                    "type":     "FVG_BEAR",
                    "time":     curr["time"],
                    "top":      round(prev["low"],  6),
                    "bottom":   round(nxt["high"],  6),
                    "midpoint": round((prev["low"] + nxt["high"]) / 2, 6),
                    "gap_pct":  round(gap / curr["close"] * 100, 3),
                    "label":    f"Bear FVG — {gap / curr['close']*100:.2f}%",
                })

    return fvgs[-6:]


# ─── 4 · Liquidity Levels ────────────────────────────────────────────────────
# Definition (ebook Chapter 3):
#   Swing highs / swing lows = buy-side and sell-side liquidity.
#   Equal highs / equal lows (within tolerance) = highest-probability targets.

def detect_liquidity_levels(candles: list[Candle], lookback: int = 60, eq_tol: float = 0.0005) -> list[dict]:
    """
    Identify swing H/L and equal H/L over the last `lookback` candles.
    """
    if len(candles) < 5:
        return []

    window = candles[-lookback:] if len(candles) > lookback else candles
    levels: list[dict] = []

    # Swing highs and lows (must be higher/lower than 2 candles on each side)
    for i in range(2, len(window) - 2):
        c = window[i]
        left2, left1   = window[i - 2], window[i - 1]
        right1, right2 = window[i + 1], window[i + 2]

        if (c["high"] > left1["high"] and c["high"] > left2["high"] and
                c["high"] > right1["high"] and c["high"] > right2["high"]):
            levels.append({
                "type":  "SWING_HIGH",
                "time":  c["time"],
                "price": round(c["high"], 6),
                "label": "Swing High (BSL)",
            })

        if (c["low"] < left1["low"] and c["low"] < left2["low"] and
                c["low"] < right1["low"] and c["low"] < right2["low"]):
            levels.append({
                "type":  "SWING_LOW",
                "time":  c["time"],
                "price": round(c["low"], 6),
                "label": "Swing Low (SSL)",
            })

    # Equal highs — within eq_tol % of each other
    swing_highs = [l for l in levels if l["type"] == "SWING_HIGH"]
    swing_lows  = [l for l in levels if l["type"] == "SWING_LOW"]

    for i, a in enumerate(swing_highs):
        for b in swing_highs[i + 1:]:
            if abs(a["price"] - b["price"]) / (a["price"] + 1e-9) < eq_tol:
                mid = (a["price"] + b["price"]) / 2
                levels.append({
                    "type":  "EQ_HIGHS",
                    "time":  max(a["time"], b["time"]),
                    "price": round(mid, 6),
                    "label": "Equal Highs (premium BSL)",
                })

    for i, a in enumerate(swing_lows):
        for b in swing_lows[i + 1:]:
            if abs(a["price"] - b["price"]) / (a["price"] + 1e-9) < eq_tol:
                mid = (a["price"] + b["price"]) / 2
                levels.append({
                    "type":  "EQ_LOWS",
                    "time":  max(a["time"], b["time"]),
                    "price": round(mid, 6),
                    "label": "Equal Lows (discount SSL)",
                })

    # Deduplicate levels that are very close together
    unique: list[dict] = []
    for lvl in sorted(levels, key=lambda x: x["time"], reverse=True):
        if not any(abs(lvl["price"] - u["price"]) / (lvl["price"] + 1e-9) < eq_tol * 2 for u in unique):
            unique.append(lvl)

    return unique[:10]


# ─── 5 · Market Structure ────────────────────────────────────────────────────
# Definition (ebook Chapter 2 & 10):
#   Bullish:  higher highs + higher lows
#   Bearish:  lower highs  + lower lows
#   Break of Structure (BoS): price closes beyond the most recent opposite swing

def market_structure(candles: list[Candle], lookback: int = 20) -> dict:
    """
    Returns structure bias + latest BoS signal.
    """
    if len(candles) < 6:
        return {"bias": "NEUTRAL", "bos": None}

    w = candles[-min(lookback, len(candles)):]
    mid = len(w) // 2

    fh_high = max(c["high"] for c in w[:mid])
    fh_low  = min(c["low"]  for c in w[:mid])
    sh_high = max(c["high"] for c in w[mid:])
    sh_low  = min(c["low"]  for c in w[mid:])

    hh = sh_high > fh_high
    hl = sh_low  > fh_low
    lh = sh_high < fh_high
    ll = sh_low  < fh_low

    if hh and hl:
        bias = "BULLISH"
    elif lh and ll:
        bias = "BEARISH"
    elif hh and ll:
        bias = "EXPANDING"
    else:
        bias = "RANGING"

    # Break of Structure: last close outside previous swing extreme
    bos = None
    last = w[-1]
    prev_high = max(c["high"] for c in w[:-1])
    prev_low  = min(c["low"]  for c in w[:-1])

    if last["close"] > prev_high:
        bos = {"direction": "BULL_BOS", "level": round(prev_high, 6), "time": last["time"]}
    elif last["close"] < prev_low:
        bos = {"direction": "BEAR_BOS", "level": round(prev_low, 6),  "time": last["time"]}

    return {"bias": bias, "bos": bos}


# ─── 6 · Sniper Score ────────────────────────────────────────────────────────
# Composite setup quality (0–100) per the ebook's "Ideal Setup Checklist":
#   ✓ Direction confirmed (structure)        +15
#   ✓ FU candle on latest bars               +25
#   ✓ Orderblock near current price          +20
#   ✓ FVG near current price                 +15
#   ✓ Liquidity level ahead as target        +15
#   ✓ Recent BoS                             +10

def sniper_score(
    candles: list[Candle],
    ms:    dict,
    fus:   list[dict],
    obs:   list[dict],
    fvgs:  list[dict],
    lvls:  list[dict],
) -> int:
    if not candles:
        return 0

    price = candles[-1]["close"]
    score = 0

    # Trend
    if ms["bias"] in ("BULLISH", "BEARISH"):
        score += 15

    # FU candle in last 5 bars
    if fus:
        strength = max(f["strength"] for f in fus[-3:])
        score += min(25, int(strength * 0.25))

    # Orderblock within 1 % of current price
    prox_ob = [ob for ob in obs if abs(ob["midpoint"] - price) / (price + 1e-9) < 0.01]
    if prox_ob:
        score += 20

    # FVG within 0.5 % of current price
    prox_fvg = [f for f in fvgs if abs(f["midpoint"] - price) / (price + 1e-9) < 0.005]
    if prox_fvg:
        score += 15

    # Liquidity target visible ahead
    if ms["bias"] == "BULLISH":
        targets = [l for l in lvls if l["price"] > price and l["type"] in ("SWING_HIGH", "EQ_HIGHS")]
    elif ms["bias"] == "BEARISH":
        targets = [l for l in lvls if l["price"] < price and l["type"] in ("SWING_LOW", "EQ_LOWS")]
    else:
        targets = lvls
    if targets:
        score += 15

    # Recent BoS
    if ms.get("bos"):
        score += 10

    return min(100, score)


# ─── Master: analyze_coin ────────────────────────────────────────────────────

def analyze_coin(candles: list[Candle]) -> dict:
    """
    Run all detectors on a single coin's candle series.
    Called once per broadcast cycle from main.py.
    """
    if not candles or len(candles) < 5:
        return {}

    ms   = market_structure(candles)
    fus  = detect_fu_candles(candles[-10:])
    obs  = detect_orderblocks(candles)
    fvgs = detect_fair_value_gaps(candles[-30:])
    lvls = detect_liquidity_levels(candles)
    score = sniper_score(candles, ms, fus, obs, fvgs, lvls)

    # Active signal: most recent FU (the trade trigger)
    active = None
    if fus:
        latest = fus[-1]
        price = candles[-1]["close"]
        if latest["type"] == "FU_BULL":
            tp_approx = latest["entry"] * 1.005 * 5  # placeholder RR 1:5
        else:
            tp_approx = latest["entry"] * 0.995 * 5
        rr_dist = abs(latest["entry"] - latest["sl"])
        active = {
            **latest,
            "rr_min": 5,
            "tp_1r5": round(latest["entry"] + (5 * rr_dist * (1 if latest["type"] == "FU_BULL" else -1)), 6),
        }

    return {
        "market_structure": ms,
        "fu_candles":       fus[-3:],   # last 3 FU signals
        "orderblocks":      obs,
        "fair_value_gaps":  fvgs,
        "liquidity_levels": lvls,
        "sniper_score":     score,
        "active_signal":    active,
    }
