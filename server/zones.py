"""
MEGALPHA — Supply & Demand Zone Detection + Liquidity Sweep / SL Hunt Analysis

Supply/demand zones are the origin of strong impulsive moves. Institutional orders
cluster at these levels. When price returns, the unfilled orders absorb it.

Liquidity sweeps (SL hunts) are the most reliable setup trigger:
  • Smart money needs liquidity (stop orders) to fill large positions
  • They sweep the obvious stop cluster below swing lows (to go LONG)
    or above swing highs (to go SHORT), then reverse hard
  • A sweep that closes back inside structure = stops hunted, clean reversal setup

Used by:
  ai_signals.py  — enriches the prompt with structural context
  main.py        — /ai/zones/{coin} endpoint for chart overlays
"""
from __future__ import annotations

import math
from typing import Optional


# ─── helpers ──────────────────────────────────────────────────────────────────

def _atr_simple(candles: list[dict], period: int = 14) -> list[float]:
    trs = []
    for i, c in enumerate(candles):
        if i == 0:
            trs.append(c["high"] - c["low"])
        else:
            prev = candles[i - 1]["close"]
            trs.append(max(c["high"] - c["low"],
                           abs(c["high"] - prev),
                           abs(c["low"] - prev)))
    out = [0.0] * len(candles)
    if len(trs) < period:
        return out
    out[period - 1] = sum(trs[:period]) / period
    for i in range(period, len(candles)):
        out[i] = (out[i - 1] * (period - 1) + trs[i]) / period
    return out


def _body_size(c: dict) -> float:
    return abs(c["close"] - c["open"])


def _is_bullish(c: dict) -> bool:
    return c["close"] > c["open"]


def _is_bearish(c: dict) -> bool:
    return c["close"] < c["open"]


# ─── Supply / Demand Zones ────────────────────────────────────────────────────

def find_demand_zones(
    candles: list[dict],
    lookback: int = 300,
    n: int = 4,
    impulse_multiplier: float = 1.8,
    base_candles: int = 4,
) -> list[dict]:
    """
    Find demand zones: consolidation bases before a strong bullish impulse.

    Returns list of dicts sorted by freshness (untested zones first):
      {high, low, time, fresh, impulse_pct, strength}
    """
    if len(candles) < lookback:
        lookback = len(candles)
    recent  = candles[-lookback:]
    atr_arr = _atr_simple(recent)
    zones   = []
    current_price = recent[-1]["close"]

    for i in range(base_candles, len(recent) - 1):
        c   = recent[i]
        atr = atr_arr[i] or 1

        # Must be a strong bullish impulse (large body, bullish, body > 1.8× ATR)
        if not _is_bullish(c):
            continue
        body = _body_size(c)
        if body < impulse_multiplier * atr:
            continue

        # Base = the up-to-4 candles before this impulse
        base = recent[max(0, i - base_candles): i]
        if not base:
            continue

        zone_low  = min(b["low"]  for b in base)
        zone_high = max(b["high"] for b in base)

        # Avoid flat / zero-range zones
        if zone_high - zone_low < atr * 0.3:
            continue

        # Freshness: price has not closed inside the zone since the impulse
        future_closes = [recent[j]["close"] for j in range(i + 1, len(recent))]
        fresh = all(fc > zone_low for fc in future_closes)

        # Zone is only useful if price is approaching from above
        # (i.e., current price is within 8% of the zone top)
        if current_price > zone_high * 1.08:
            continue

        impulse_pct = body / c["open"] * 100

        zones.append({
            "type":         "demand",
            "high":         round(zone_high, 6),
            "low":          round(zone_low,  6),
            "mid":          round((zone_high + zone_low) / 2, 6),
            "time":         c["time"],
            "fresh":        fresh,
            "impulse_pct":  round(impulse_pct, 3),
            "strength":     round(impulse_pct * (1.5 if fresh else 0.6), 3),
            "dist_pct":     round((current_price - zone_high) / current_price * 100, 3),
        })

    # Deduplicate overlapping zones (keep strongest)
    zones = _dedup_zones(zones, tolerance=0.005)

    # Sort: fresh first, then strength
    zones.sort(key=lambda z: (z["fresh"], z["strength"]), reverse=True)
    return zones[:n]


def find_supply_zones(
    candles: list[dict],
    lookback: int = 300,
    n: int = 4,
    impulse_multiplier: float = 1.8,
    base_candles: int = 4,
) -> list[dict]:
    """
    Find supply zones: consolidation bases before a strong bearish impulse.
    """
    if len(candles) < lookback:
        lookback = len(candles)
    recent  = candles[-lookback:]
    atr_arr = _atr_simple(recent)
    zones   = []
    current_price = recent[-1]["close"]

    for i in range(base_candles, len(recent) - 1):
        c   = recent[i]
        atr = atr_arr[i] or 1

        if not _is_bearish(c):
            continue
        body = _body_size(c)
        if body < impulse_multiplier * atr:
            continue

        base = recent[max(0, i - base_candles): i]
        if not base:
            continue

        zone_low  = min(b["low"]  for b in base)
        zone_high = max(b["high"] for b in base)

        if zone_high - zone_low < atr * 0.3:
            continue

        future_closes = [recent[j]["close"] for j in range(i + 1, len(recent))]
        fresh = all(fc < zone_high for fc in future_closes)

        # Zone is only useful if price is approaching from below
        if current_price < zone_low * 0.92:
            continue

        impulse_pct = abs(body / c["open"]) * 100

        zones.append({
            "type":         "supply",
            "high":         round(zone_high, 6),
            "low":          round(zone_low,  6),
            "mid":          round((zone_high + zone_low) / 2, 6),
            "time":         c["time"],
            "fresh":        fresh,
            "impulse_pct":  round(impulse_pct, 3),
            "strength":     round(impulse_pct * (1.5 if fresh else 0.6), 3),
            "dist_pct":     round((zone_low - current_price) / current_price * 100, 3),
        })

    zones = _dedup_zones(zones, tolerance=0.005)
    zones.sort(key=lambda z: (z["fresh"], z["strength"]), reverse=True)
    return zones[:n]


def _dedup_zones(zones: list[dict], tolerance: float = 0.005) -> list[dict]:
    """Remove zones whose midpoints are within `tolerance` of a stronger zone."""
    kept = []
    for z in zones:
        overlap = False
        for k in kept:
            if abs(z["mid"] - k["mid"]) / k["mid"] < tolerance:
                overlap = True
                break
        if not overlap:
            kept.append(z)
    return kept


# ─── Liquidity Sweeps (SL Hunts) ─────────────────────────────────────────────

def find_liquidity_sweeps(
    candles: list[dict],
    swing_window: int = 5,
    lookback: int = 80,
    min_wick_ratio: float = 0.4,
) -> list[dict]:
    """
    Detect liquidity sweeps (SL hunts): price briefly breaks a swing level
    then closes back inside — classic institutional stop-raid signature.

    Returns list of:
      {type, time, swept_level, wick_size, recovery_close, candle_idx}

    type: "bullish_sweep" (swept low → likely LONG setup)
          "bearish_sweep" (swept high → likely SHORT setup)

    min_wick_ratio: the wick beyond the swept level must be ≥ this fraction
    of the candle range (filters tiny noise wicks)
    """
    if len(candles) < swing_window * 2 + lookback:
        lookback = max(20, len(candles) - swing_window * 2)

    recent  = candles[-(lookback + swing_window):]
    sweeps  = []

    for i in range(swing_window, len(recent)):
        c = recent[i]
        candle_range = c["high"] - c["low"]
        if candle_range <= 0:
            continue

        # ── Bullish sweep: wicked below swing low, closed above it ──
        local_lows = [recent[j]["low"] for j in range(i - swing_window, i)]
        swing_low  = min(local_lows)

        wick_below = swing_low - c["low"]    # positive = broke below
        if wick_below > 0 and c["close"] > swing_low:
            wick_ratio = wick_below / candle_range
            if wick_ratio >= min_wick_ratio:
                sweeps.append({
                    "type":           "bullish_sweep",
                    "time":           c["time"],
                    "swept_level":    round(swing_low, 6),
                    "wick_low":       round(c["low"], 6),
                    "recovery_close": round(c["close"], 6),
                    "wick_size":      round(wick_below, 6),
                    "wick_ratio":     round(wick_ratio, 3),
                    "bars_ago":       len(recent) - 1 - i,
                })

        # ── Bearish sweep: wicked above swing high, closed below it ──
        local_highs = [recent[j]["high"] for j in range(i - swing_window, i)]
        swing_high  = max(local_highs)

        wick_above = c["high"] - swing_high   # positive = broke above
        if wick_above > 0 and c["close"] < swing_high:
            wick_ratio = wick_above / candle_range
            if wick_ratio >= min_wick_ratio:
                sweeps.append({
                    "type":           "bearish_sweep",
                    "time":           c["time"],
                    "swept_level":    round(swing_high, 6),
                    "wick_high":      round(c["high"], 6),
                    "recovery_close": round(c["close"], 6),
                    "wick_size":      round(wick_above, 6),
                    "wick_ratio":     round(wick_ratio, 3),
                    "bars_ago":       len(recent) - 1 - i,
                })

    # Most recent 8 sweeps, most recent first
    return sorted(sweeps, key=lambda s: s["time"], reverse=True)[:8]


# ─── Context summary for AI prompt ───────────────────────────────────────────

def build_zone_context(
    candles: list[dict],
    current_price: float,
) -> str:
    """
    Build the structured zone + sweep context block that goes into the AI prompt.
    """
    demand_zones = find_demand_zones(candles)
    supply_zones = find_supply_zones(candles)
    sweeps       = find_liquidity_sweeps(candles)

    lines = []

    # Demand zones
    lines.append("DEMAND ZONES (buy zones — institutional buy orders resting here):")
    if demand_zones:
        for z in demand_zones:
            freshness = "✦ FRESH (untested)" if z["fresh"] else "touched"
            dist = z["dist_pct"]
            dist_str = f"{dist:+.2f}% from price" if dist != 0 else "AT PRICE"
            lines.append(
                f"  ${z['low']:.4f} – ${z['high']:.4f}  "
                f"[impulse {z['impulse_pct']:+.2f}%  {freshness}  {dist_str}]"
            )
    else:
        lines.append("  None identified in lookback window")

    lines.append("")

    # Supply zones
    lines.append("SUPPLY ZONES (sell zones — institutional sell orders resting here):")
    if supply_zones:
        for z in supply_zones:
            freshness = "✦ FRESH (untested)" if z["fresh"] else "touched"
            dist = z["dist_pct"]
            dist_str = f"{dist:+.2f}% from price" if dist != 0 else "AT PRICE"
            lines.append(
                f"  ${z['low']:.4f} – ${z['high']:.4f}  "
                f"[impulse {z['impulse_pct']:+.1f}%  {freshness}  {dist_str}]"
            )
    else:
        lines.append("  None identified in lookback window")

    lines.append("")

    # Sweeps
    lines.append("RECENT LIQUIDITY SWEEPS (SL hunts — most recent first):")
    actionable = [s for s in sweeps if s["bars_ago"] <= 24]
    if actionable:
        for s in actionable[:4]:
            direction = "↑ BULLISH SWEEP" if s["type"] == "bullish_sweep" else "↓ BEARISH SWEEP"
            implication = (
                "→ Stops cleared BELOW — long setup if demand zone nearby"
                if s["type"] == "bullish_sweep"
                else "→ Stops cleared ABOVE — short setup if supply zone nearby"
            )
            lines.append(
                f"  {direction}  {s['bars_ago']} bars ago  "
                f"swept ${s['swept_level']:.4f}  "
                f"wick ratio {s['wick_ratio']:.0%}  {implication}"
            )
    else:
        lines.append("  No sweeps in last 24 bars")

    # Zone proximity alert
    lines.append("")
    nearest_demand = min(demand_zones, key=lambda z: abs(z["mid"] - current_price), default=None)
    nearest_supply = min(supply_zones, key=lambda z: abs(z["mid"] - current_price), default=None)

    if nearest_demand:
        dist = (current_price - nearest_demand["high"]) / current_price * 100
        if abs(dist) < 2:
            lines.append(
                f"⚡ PRICE IS {dist:+.2f}% FROM NEAREST DEMAND ZONE "
                f"(${nearest_demand['low']:.4f}–${nearest_demand['high']:.4f}) — "
                f"{'INSIDE ZONE' if dist <= 0 else 'APPROACHING'}"
            )

    if nearest_supply:
        dist = (nearest_supply["low"] - current_price) / current_price * 100
        if abs(dist) < 2:
            lines.append(
                f"⚡ PRICE IS {dist:+.2f}% FROM NEAREST SUPPLY ZONE "
                f"(${nearest_supply['low']:.4f}–${nearest_supply['high']:.4f}) — "
                f"{'INSIDE ZONE' if dist <= 0 else 'APPROACHING'}"
            )

    return "\n".join(lines)


def get_zones_for_chart(candles: list[dict]) -> dict:
    """
    Returns demand + supply zones + recent sweeps for chart rendering.
    """
    return {
        "demand": find_demand_zones(candles),
        "supply": find_supply_zones(candles),
        "sweeps": find_liquidity_sweeps(candles),
    }
