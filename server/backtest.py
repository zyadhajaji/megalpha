"""
MEGALPHA — Backtest engine (Phase 2 + 3.5 rigor)

Pure-Python, event-driven backtester. Every strategy can go LONG and SHORT,
fills happen at the next candle's open, taker fees are charged on entry and exit,
and breakout trades use ATR brackets checked against the next candle's range.

Phase 3.5 rigor adds:
  • realistic cost model — taker fees + slippage + perpetual funding drag
  • a shared risk layer (risk.py) — % sizing, stop-loss, max-drawdown kill switch
  • a buy-and-hold benchmark (curve + alpha) on every run
  • walk-forward validation across sequential out-of-sample folds

Strategies (all long + short):
  momentum        RSI + EMA20 trend follow
  breakout        20-bar range break, 2xATR take-profit / 1xATR stop
  mean_reversion  fade RSI extremes back toward the mean
  ema_cross       EMA9 / EMA21 crossover (always in the market, flips)
  macd            MACD line / signal crossover (always in the market, flips)
  bollinger       fade 2-sigma band touches back to the basis
  stop_hunt_a     liquidity sweep sniper with 4-condition scoring (Strategy A)
  trend_follow_b  EMA21/55 cross + ADX filter + EMA200 macro filter (Strategy B)
  sniper_c        FU candle pattern with 50% wick entry, 3:1 min R:R (Strategy C)
  unified_d       8-condition unified sniper combining A+C logic (Strategy D)
"""

from __future__ import annotations
import math
from typing import Literal, Optional

from risk import RiskConfig, position_margin, stop_levels, kill_switch_triggered

# ─── indicator helpers (also imported by rl_features.py) ──────────────────────

def _ema(values: list[float], period: int) -> list[float]:
    k = 2 / (period + 1)
    out = [0.0] * len(values)
    if not values:
        return out
    out[0] = values[0]
    for i in range(1, len(values)):
        out[i] = values[i] * k + out[i - 1] * (1 - k)
    return out


def _rsi(closes: list[float], period: int = 14) -> list[float]:
    out = [50.0] * len(closes)
    if len(closes) < period + 1:
        return out
    gains, losses = [], []
    for i in range(1, len(closes)):
        delta = closes[i] - closes[i - 1]
        gains.append(max(delta, 0.0))
        losses.append(max(-delta, 0.0))
    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period
    for i in range(period, len(closes)):
        idx = i - 1  # index into gains/losses (they start at closes[1])
        avg_gain = (avg_gain * (period - 1) + gains[idx]) / period
        avg_loss = (avg_loss * (period - 1) + losses[idx]) / period
        rs = avg_gain / (avg_loss + 1e-9)
        out[i] = 100 - 100 / (1 + rs)
    return out


def _atr(candles: list[dict], period: int = 14) -> list[float]:
    out = [0.0] * len(candles)
    trs = []
    for i, c in enumerate(candles):
        if i == 0:
            trs.append(c["high"] - c["low"])
        else:
            prev = candles[i - 1]["close"]
            tr = max(c["high"] - c["low"], abs(c["high"] - prev), abs(c["low"] - prev))
            trs.append(tr)
    if len(trs) < period:
        return out
    out[period - 1] = sum(trs[:period]) / period
    for i in range(period, len(candles)):
        out[i] = (out[i - 1] * (period - 1) + trs[i]) / period
    return out


def _sma(values: list[float], period: int) -> list[float]:
    out = [0.0] * len(values)
    s = 0.0
    for i, v in enumerate(values):
        s += v
        if i >= period:
            s -= values[i - period]
        if i >= period - 1:
            out[i] = s / period
    return out


def _rolling_std(values: list[float], period: int) -> list[float]:
    out = [0.0] * len(values)
    for i in range(period - 1, len(values)):
        window = values[i - period + 1 : i + 1]
        m = sum(window) / period
        out[i] = math.sqrt(sum((x - m) ** 2 for x in window) / period)
    return out


def _macd(closes: list[float]) -> tuple[list[float], list[float]]:
    ema12 = _ema(closes, 12)
    ema26 = _ema(closes, 26)
    line = [a - b for a, b in zip(ema12, ema26)]
    signal = _ema(line, 9)
    return line, signal


def _adx(candles: list[dict], period: int = 14) -> list[float]:
    """
    Wilder's ADX (Average Directional Index).
    Needed for regime detection and Strategy B trend confirmation.
    Returns per-bar ADX values (0-100).
    """
    n = len(candles)
    out = [0.0] * n
    if n < period + 1:
        return out

    trs: list[float] = []
    plus_dms: list[float] = []
    minus_dms: list[float] = []

    for i in range(1, n):
        high       = candles[i]["high"]
        low        = candles[i]["low"]
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

    atr_w = sum(trs[:period])
    pdm_w = sum(plus_dms[:period])
    mdm_w = sum(minus_dms[:period])

    dxs: list[float] = []

    def _di(pdm: float, mdm: float, atr_val: float):
        if atr_val <= 0:
            return 0.0, 0.0
        return (pdm / atr_val) * 100, (mdm / atr_val) * 100

    plus_di, minus_di = _di(pdm_w, mdm_w, atr_w)
    dx_sum = abs(plus_di - minus_di) / (plus_di + minus_di + 1e-9) * 100
    dxs.append(dx_sum)

    for i in range(period, len(trs)):
        atr_w = atr_w - atr_w / period + trs[i]
        pdm_w = pdm_w - pdm_w / period + plus_dms[i]
        mdm_w = mdm_w - mdm_w / period + minus_dms[i]
        plus_di, minus_di = _di(pdm_w, mdm_w, atr_w)
        dx = abs(plus_di - minus_di) / (plus_di + minus_di + 1e-9) * 100
        dxs.append(dx)

    if len(dxs) < period:
        return out

    adx_val = sum(dxs[:period]) / period
    adx_start = period * 2

    if adx_start - 1 < n:
        out[adx_start - 1] = adx_val

    for j in range(period, len(dxs)):
        adx_val = (adx_val * (period - 1) + dxs[j]) / period
        candle_idx = j + period
        if candle_idx < n:
            out[candle_idx] = adx_val

    return out


def _bb_width(closes: list[float], period: int = 20) -> list[float]:
    """Bollinger Band width = (upper - lower) / middle * 100."""
    n = len(closes)
    out = [0.0] * n
    sma_vals = _sma(closes, period)
    std_vals  = _rolling_std(closes, period)
    for i in range(period - 1, n):
        mid = sma_vals[i]
        if mid <= 0:
            continue
        upper = mid + 2 * std_vals[i]
        lower = mid - 2 * std_vals[i]
        out[i] = (upper - lower) / mid * 100
    return out


# ─── strategy layer ───────────────────────────────────────────────────────────

STRATEGIES = (
    "momentum", "breakout", "mean_reversion", "ema_cross", "macd", "bollinger",
    "supply_demand", "sl_hunt", "valued_risk",
    "stop_hunt_a", "trend_follow_b", "sniper_c", "unified_d",
)
Strategy = Literal[
    "momentum", "breakout", "mean_reversion", "ema_cross", "macd", "bollinger",
    "supply_demand", "sl_hunt", "valued_risk",
    "stop_hunt_a", "trend_follow_b", "sniper_c", "unified_d",
]

WARMUP  = 35     # candles needed before slow indicators (EMA26 + MACD signal) settle
FEE_BPS = 3.5    # HL taker fee per side


def _supply_demand_zones(
    closes: list[float],
    highs: list[float],
    lows: list[float],
    atr14: list[float],
    base_bars: int = 4,
) -> tuple[list, list, list, list]:
    """
    Identify supply/demand zones using the "base-then-impulse" pattern.

    A demand zone forms when a tight consolidation (base_bars candles with
    combined range < 0.7 × ATR) is followed by a strong bullish impulse candle
    (body > 1.1 × ATR). The base range becomes the demand zone — price tends to
    return there to mitigate unfilled orders.

    A supply zone forms symmetrically after a bearish impulse.

    Zones are invalidated when price CLOSES through them (demand: below zone_lo;
    supply: above zone_hi).

    Returns four per-bar lists: (dz_hi, dz_lo, sz_hi, sz_lo).
    None entries mean no active zone at that bar.
    """
    n = len(closes)
    dz_hi: list = [None] * n
    dz_lo: list = [None] * n
    sz_hi: list = [None] * n
    sz_lo: list = [None] * n

    cur_dz: tuple = (None, None)   # (hi, lo)
    cur_sz: tuple = (None, None)

    for i in range(base_bars + 2, n):
        a = max(atr14[i] or 0.0, 1e-9)
        c = closes[i]

        # Invalidate on close-through
        if cur_dz[1] is not None and c < cur_dz[1]:
            cur_dz = (None, None)
        if cur_sz[0] is not None and c > cur_sz[0]:
            cur_sz = (None, None)

        # Impulse detection: large body in one direction
        body   = abs(closes[i] - closes[i - 1])
        range_ = highs[i] - lows[i]
        if body > 1.1 * a and range_ > 0.9 * a:
            base_hi = max(highs[i - base_bars : i])
            base_lo = min(lows[i - base_bars : i])
            base_range = base_hi - base_lo
            # Confirm it was actually a tight base (consolidation)
            if base_range < 0.75 * a:
                if closes[i] > closes[i - 1]:   # bullish impulse → demand below
                    cur_dz = (base_hi, base_lo)
                else:                            # bearish impulse → supply above
                    cur_sz = (base_hi, base_lo)

        dz_hi[i], dz_lo[i] = cur_dz
        sz_hi[i], sz_lo[i] = cur_sz

    return dz_hi, dz_lo, sz_hi, sz_lo


def _rolling_swing(highs: list[float], lows: list[float], lookback: int = 15) -> tuple[list, list]:
    """Per-bar rolling highest-high and lowest-low over the last `lookback` bars.

    Used for SL-hunt detection (identifying the liquidity pools that institutions
    target) and for structural R:R calculations.
    """
    n = len(highs)
    swing_hi = [0.0] * n
    swing_lo = [0.0] * n
    for i in range(lookback, n):
        swing_hi[i] = max(highs[i - lookback : i])
        swing_lo[i] = min(lows[i - lookback : i])
    return swing_hi, swing_lo


def _structural_rr(
    closes: list[float],
    highs: list[float],
    lows: list[float],
    lookback: int = 25,
) -> tuple[list, list]:
    """
    Per-bar structural R:R for hypothetical LONG and SHORT entries.

    LONG R:R  = (swing_hi − close) / (close − swing_lo)
    SHORT R:R = (close − swing_lo) / (swing_hi − close)

    Uses rolling swing high/low as the structural SL and TP levels —
    the same levels smart money watches — rather than arbitrary ATR multiples.
    Returns (long_rr, short_rr) per-bar lists.
    """
    n = len(closes)
    long_rr  = [0.0] * n
    short_rr = [0.0] * n
    for i in range(lookback, n):
        c     = closes[i]
        sl_lo = min(lows[i - lookback : i])    # structural SL for long
        tp_hi = max(highs[i - lookback : i])   # structural TP for long
        sl_hi = tp_hi                           # structural SL for short
        tp_lo = sl_lo                           # structural TP for short

        long_risk   = c - sl_lo
        long_reward = tp_hi - c
        if long_risk > 1e-9 and long_reward > 0:
            long_rr[i] = long_reward / long_risk

        short_risk   = sl_hi - c
        short_reward = c - tp_lo
        if short_risk > 1e-9 and short_reward > 0:
            short_rr[i] = short_reward / short_risk

    return long_rr, short_rr


def _indicators(candles: list[dict]) -> dict:
    closes = [c["close"] for c in candles]
    highs  = [c["high"]  for c in candles]
    lows   = [c["low"]   for c in candles]
    vols   = [c.get("volume", 0.0) for c in candles]
    macd_line, macd_sig = _macd(closes)
    atr14 = _atr(candles, 14)

    dz_hi, dz_lo, sz_hi, sz_lo = _supply_demand_zones(closes, highs, lows, atr14)
    swing_hi, swing_lo = _rolling_swing(highs, lows, lookback=15)
    # Extended swing for strategy A/D (20-bar window)
    swing_hi20, swing_lo20 = _rolling_swing(highs, lows, lookback=20)
    long_rr, short_rr  = _structural_rr(closes, highs, lows, lookback=25)

    opens = [c["open"] for c in candles]

    return {
        "closes":      closes,
        "highs":       highs,
        "lows":        lows,
        "opens":       opens,
        "volumes":     vols,
        "ema9":        _ema(closes, 9),
        "ema20":       _ema(closes, 20),
        "ema21":       _ema(closes, 21),
        "ema50":       _ema(closes, 50),
        "ema55":       _ema(closes, 55),
        "ema200":      _ema(closes, 200),
        "rsi14":       _rsi(closes, 14),
        "atr14":       atr14,
        "sma20":       _sma(closes, 20),
        "std20":       _rolling_std(closes, 20),
        "macd":        macd_line,
        "macd_sig":    macd_sig,
        "adx14":       _adx(candles, 14),
        "bb_width":    _bb_width(closes, 20),
        # Supply / demand zones
        "dz_hi":       dz_hi,
        "dz_lo":       dz_lo,
        "sz_hi":       sz_hi,
        "sz_lo":       sz_lo,
        # Structural levels for SL-hunt and R:R validation
        "swing_hi":    swing_hi,
        "swing_lo":    swing_lo,
        "swing_hi20":  swing_hi20,
        "swing_lo20":  swing_lo20,
        "long_rr":     long_rr,
        "short_rr":    short_rr,
    }


def _target(strategy: str, ind: dict, i: int, position: int) -> int:
    """Desired position at candle i given the current one. Returns -1, 0, or +1.

    Returning the current `position` means "no change" (hold). Breakout only opens
    here; its exits are driven by ATR brackets in the main loop.
    """
    close = ind["closes"][i]

    if strategy == "momentum":
        ema = ind["ema20"][i] or close
        rsi = ind["rsi14"][i]
        if rsi > 55 and close > ema:
            return 1
        if rsi < 45 and close < ema:
            return -1
        return 0

    if strategy == "mean_reversion":
        rsi = ind["rsi14"][i]
        if rsi < 30:
            return 1
        if rsi > 70:
            return -1
        if 45 <= rsi <= 55:      # mean reached → flatten
            return 0
        return position

    if strategy == "ema_cross":
        return 1 if ind["ema9"][i] >= ind["ema21"][i] else -1

    if strategy == "macd":
        return 1 if ind["macd"][i] >= ind["macd_sig"][i] else -1

    if strategy == "bollinger":
        sma = ind["sma20"][i]
        std = ind["std20"][i]
        if std <= 0:
            return position
        upper, lower = sma + 2 * std, sma - 2 * std
        if close < lower:
            return 1
        if close > upper:
            return -1
        if position == 1 and close >= sma:
            return 0
        if position == -1 and close <= sma:
            return 0
        return position

    if strategy == "breakout":
        atr = ind["atr14"][i]
        if atr <= 0 or position != 0:
            return position
        roll_high = max(ind["highs"][i - 20 : i])
        roll_low  = min(ind["lows"][i - 20 : i])
        if close > roll_high:
            return 1
        if close < roll_low:
            return -1
        return 0

    # ── SUPPLY & DEMAND ──────────────────────────────────────────────────────
    # Enter when price re-tests a fresh institutional zone formed by a
    # "base-then-impulse" sequence. Demand zones attract long entries; supply
    # zones attract short entries. Zone is invalidated by a closing breach.
    if strategy == "supply_demand":
        dz_h = ind["dz_hi"][i]
        dz_l = ind["dz_lo"][i]
        sz_h = ind["sz_hi"][i]
        sz_l = ind["sz_lo"][i]
        atr  = ind["atr14"][i] or 1e-9

        in_demand = dz_h is not None and dz_l <= close <= dz_h
        in_supply = sz_h is not None and sz_l <= close <= sz_h

        # Confirm re-test with RSI: avoid entering on initial impulse leg
        rsi = ind["rsi14"][i]

        if in_demand and position <= 0 and rsi < 60:
            return 1    # long from demand zone
        if in_supply and position >= 0 and rsi > 40:
            return -1   # short from supply zone
        # Trail inside a position: exit when zone on the other side activates
        if position == 1 and in_supply:
            return -1   # flip to short at supply
        if position == -1 and in_demand:
            return 1    # flip to long at demand
        return position

    # ── STOP-LOSS HUNT (Liquidity Sweep) ────────────────────────────────────
    # Institutions often drive price beyond obvious stop clusters (equal highs /
    # lows, swing pivots) to trigger retail stops and grab liquidity before
    # reversing. We detect this as a candle whose wick sweeps a key level but
    # whose close returns back inside — then trade the reversal.
    #
    # Entry criteria:
    #   LONG sweep: low < rolling_swing_lo AND close > rolling_swing_lo
    #               AND sweep extension < 0.6 × ATR (quick wick, not a break)
    #   SHORT sweep: high > rolling_swing_hi AND close < rolling_swing_hi
    #                AND extension < 0.6 × ATR
    if strategy == "sl_hunt":
        if i < 15:
            return 0
        atr      = ind["atr14"][i] or 1e-9
        sw_lo    = ind["swing_lo"][i]
        sw_hi    = ind["swing_hi"][i]
        c_low    = ind["lows"][i]
        c_high   = ind["highs"][i]
        rsi      = ind["rsi14"][i]

        long_sweep  = (c_low  < sw_lo and close > sw_lo and (sw_lo - c_low)  < 0.6 * atr)
        short_sweep = (c_high > sw_hi and close < sw_hi and (c_high - sw_hi) < 0.6 * atr)

        if long_sweep  and position <= 0 and rsi < 55:
            return 1    # reversal long after liquidity grab below
        if short_sweep and position >= 0 and rsi > 45:
            return -1   # reversal short after liquidity grab above
        # Once in a sweep trade, hold until the opposite sweep fires
        return position

    # ── VALUED RISK (Structure-Based R:R Filter) ─────────────────────────────
    # Most strategies enter regardless of the trade's actual risk-reward profile.
    # This strategy adds a mandatory structural R:R gate: it uses real swing
    # highs/lows as the SL and TP reference, and only enters when the natural
    # R:R ≥ 2.5 — matching the institutional standard used in the AI signal engine.
    #
    # Direction: EMA20 trend filter + RSI confirmation
    # Entry gate: pre-computed structural long_rr / short_rr ≥ 2.5
    if strategy == "valued_risk":
        if i < 25:
            return 0
        rsi  = ind["rsi14"][i]
        ema  = ind["ema20"][i] or close
        lrr  = ind["long_rr"][i]
        srr  = ind["short_rr"][i]

        # Trend and momentum pre-filter
        bullish = close > ema and 35 < rsi < 68
        bearish = close < ema and 32 < rsi < 65

        if bullish and lrr >= 2.5 and position <= 0:
            return 1
        if bearish and srr >= 2.5 and position >= 0:
            return -1
        # Hold the position until trend flips or R:R gate closes
        if position == 1 and (close < ema or lrr < 1.0):
            return 0
        if position == -1 and (close > ema or srr < 1.0):
            return 0
        return position

    # ── STOP HUNT A (Liquidity Sweep Sniper with 4-condition scoring) ───────────
    # Refined version of sl_hunt with full A-strategy scoring.
    # Detects wick breaches 0.15-1.5% beyond 20-bar swing levels followed by
    # reclaim on close. Needs 3/4 conditions: wick, reclaim, volume, EMA align.
    if strategy == "stop_hunt_a":
        if i < 22:
            return 0
        close  = ind["closes"][i]
        high   = ind["highs"][i]
        low    = ind["lows"][i]
        atr    = ind["atr14"][i] or 1e-9
        sw_hi  = ind["swing_hi20"][i]
        sw_lo  = ind["swing_lo20"][i]
        ema20_v = ind["ema20"][i]
        ema50_v = ind["ema50"][i]
        vols    = ind["volumes"]
        vol_avg = sum(vols[i - 20 : i]) / 20 if i >= 20 else 1.0
        vol_cur = vols[i] if vols[i] > 0 else vol_avg
        vol_ratio = vol_cur / (vol_avg + 1e-9)

        # Genuine breakout (> 5x vol) → skip
        if vol_ratio > 5.0:
            return 0

        # Long setup: wick below swing_lo + close reclaim
        if low < sw_lo and close > sw_lo and position <= 0:
            breach_pct = (sw_lo - low) / (sw_lo + 1e-9) * 100
            if 0.15 <= breach_pct <= 1.5:
                score = 30   # reclaim is non-negotiable
                if vol_ratio >= 2.0:
                    score += 25
                if ema20_v > ema50_v:
                    score += 20
                score += 25  # wick breach already confirmed above
                if score >= 75:
                    return 1

        # Short setup: wick above swing_hi + close reclaim
        if high > sw_hi and close < sw_hi and position >= 0:
            breach_pct = (high - sw_hi) / (sw_hi + 1e-9) * 100
            if 0.15 <= breach_pct <= 1.5:
                score = 30
                if vol_ratio >= 2.0:
                    score += 25
                if ema20_v < ema50_v:
                    score += 20
                score += 25
                if score >= 75:
                    return -1

        return position

    # ── TREND FOLLOW B (EMA21/55 Cross + ADX Filter + EMA200 Macro) ──────────
    # Primary: EMA21 crosses EMA55. Confirmation: ADX > 25. Macro: price vs EMA200.
    # Exit: EMA21/55 re-cross OR ADX < 20 for 2 consecutive bars.
    if strategy == "trend_follow_b":
        if i < 60:
            return 0
        ema21_v  = ind["ema21"][i]
        ema55_v  = ind["ema55"][i]
        ema21_p  = ind["ema21"][i - 1]
        ema55_p  = ind["ema55"][i - 1]
        adx      = ind["adx14"][i]
        adx_prev = ind["adx14"][i - 1]
        ema200_v = ind["ema200"][i]
        close    = ind["closes"][i]

        bullish_cross = ema21_p <= ema55_p and ema21_v > ema55_v
        bearish_cross = ema21_p >= ema55_p and ema21_v < ema55_v

        # Exit: ADX < 20 for 2 bars
        if position != 0 and adx < 20 and adx_prev < 20:
            return 0

        # Exit: EMA re-cross
        if position == 1 and ema21_v < ema55_v:
            return 0
        if position == -1 and ema21_v > ema55_v:
            return 0

        # Entry: cross + ADX + macro filter
        if bullish_cross and adx > 25 and close > ema200_v:
            return 1
        if bearish_cross and adx > 25 and close < ema200_v:
            return -1

        return position

    # ── SNIPER C (FU Candle with 50% wick entry) ─────────────────────────────
    # FU candle = wick sweeps a swing level + closes back in opposite direction.
    # Backtester entry simulated at 50% wick midpoint (limit order simulation:
    # we enter if the next candle touches the wick midpoint level).
    # R:R minimum 3:1 (simplified for backtesting, vs 6:1 in live execution).
    if strategy == "sniper_c":
        if i < 22:
            return 0
        close  = ind["closes"][i]
        high   = ind["highs"][i]
        low    = ind["lows"][i]
        open_v = ind["opens"][i]
        atr    = ind["atr14"][i] or 1e-9
        sw_hi  = ind["swing_hi20"][i]
        sw_lo  = ind["swing_lo20"][i]

        # FU long: wick below swing_lo, closes above open (bullish close)
        if low < sw_lo and close > open_v and close > sw_lo and position <= 0:
            # Wick midpoint entry
            wick_mid  = (low + sw_lo) / 2
            sl_dist   = wick_mid - (low * 0.995)
            if sl_dist > 0:
                rr = (sw_hi - wick_mid) / sl_dist
                if rr >= 3.0:
                    return 1

        # FU short: wick above swing_hi, closes below open (bearish close)
        if high > sw_hi and close < open_v and close < sw_hi and position >= 0:
            wick_mid = (high + sw_hi) / 2
            sl_dist  = (high * 1.005) - wick_mid
            if sl_dist > 0:
                rr = (wick_mid - sw_lo) / sl_dist
                if rr >= 3.0:
                    return -1

        # Hold existing position until opposite FU fires
        return position

    # ── UNIFIED D (8-condition scoring, requires A+C logic) ──────────────────
    # FU candle confirmed AND volume spike AND close reclaim AND orderblock.
    # Entry at 50% wick midpoint. R:R >= 4:1.
    if strategy == "unified_d":
        if i < 25:
            return 0
        close  = ind["closes"][i]
        high   = ind["highs"][i]
        low    = ind["lows"][i]
        open_v = ind["opens"][i]
        atr    = ind["atr14"][i] or 1e-9
        sw_hi  = ind["swing_hi20"][i]
        sw_lo  = ind["swing_lo20"][i]
        ema20_v = ind["ema20"][i]
        ema50_v = ind["ema50"][i]
        vols    = ind["volumes"]
        vol_avg = sum(vols[i - 20 : i]) / 20 if i >= 20 else 1.0
        vol_cur = vols[i] if vols[i] > 0 else vol_avg
        vol_ratio = vol_cur / (vol_avg + 1e-9)

        if vol_ratio > 5.0:
            return 0

        score = 0

        # Long unified setup
        if low < sw_lo and close > sw_lo and position <= 0:
            breach_pct = (sw_lo - low) / (sw_lo + 1e-9) * 100
            if 0.15 <= breach_pct <= 1.5:
                score += 10                    # cond 1: wick breach
            if vol_ratio >= 2.0:
                score += 15                    # cond 2: vol spike
            if close > sw_lo:
                score += 15                    # cond 3: reclaim (non-negotiable)
            else:
                score = 0
            if ema20_v > ema50_v:
                score += 10                    # cond 4: htf bias
            # cond 5: FU candle (wick + structure broken in same candle)
            if low < sw_lo and close > open_v:
                score += 20
            # simplified conds 6/7/8: combine as bonus block
            if breach_pct < 0.5 and vol_ratio >= 2.5:
                score += 10 + 10 + 10          # OB + FVG + liq density

            if score >= 60:
                wick_mid = (low + sw_lo) / 2
                sl_dist  = wick_mid - (low * 0.995)
                if sl_dist > 0:
                    rr = (sw_hi - wick_mid) / sl_dist
                    if rr >= 4.0:
                        return 1

        # Short unified setup
        elif high > sw_hi and close < sw_hi and position >= 0:
            breach_pct = (high - sw_hi) / (sw_hi + 1e-9) * 100
            if 0.15 <= breach_pct <= 1.5:
                score += 10
            if vol_ratio >= 2.0:
                score += 15
            if close < sw_hi:
                score += 15
            else:
                score = 0
            if ema20_v < ema50_v:
                score += 10
            if high > sw_hi and close < open_v:
                score += 20
            if breach_pct < 0.5 and vol_ratio >= 2.5:
                score += 30

            if score >= 60:
                wick_mid = (high + sw_hi) / 2
                sl_dist  = (high * 1.005) - wick_mid
                if sl_dist > 0:
                    rr = (wick_mid - sw_lo) / sl_dist
                    if rr >= 4.0:
                        return -1

        return position

    return 0

# ─── engine ───────────────────────────────────────────────────────────────────

def run_backtest(
    candles: list[dict],
    starting_balance: float,
    size_usd: float,
    leverage: int,
    strategy: str,
    fee_bps: float = FEE_BPS,
    slippage_bps: float = 0.0,
    funding_apr: float = 0.0,
    risk: Optional[RiskConfig] = None,
) -> dict:
    """Simulate `strategy` over `candles`. Fills at next-candle open.

    Costs: taker `fee_bps` per side, `slippage_bps` per side baked into fills, and
    a perpetual `funding_apr` drag charged per bar held (conservative — always a cost).
    `risk` (risk.py) optionally adds % sizing, stop-loss/take-profit, and a
    max-drawdown kill switch. Returns {trades, equity_curve, buy_hold_curve, stats}.
    """
    if strategy not in STRATEGIES or len(candles) < WARMUP + 10:
        return {"trades": [], "equity_curve": [], "buy_hold_curve": [], "stats": _empty_stats()}

    risk = risk or RiskConfig()
    ind  = _indicators(candles)
    slip = slippage_bps / 10_000.0

    # bar duration → per-bar funding fraction of notional
    bar_secs  = (candles[1]["time"] - candles[0]["time"]) if len(candles) > 1 else 3600
    bar_hours = max(bar_secs / 3600.0, 1e-9)
    funding_rate_bar = funding_apr * (bar_hours / (365 * 24))

    def fill(px: float, is_buy: bool) -> float:
        return px * (1 + slip) if is_buy else px * (1 - slip)

    balance  = starting_balance
    peak     = starting_balance
    max_dd   = 0.0
    position = 0                 # -1 short, 0 flat, +1 long
    entry_px = 0.0
    entry_notional = 0.0
    open_time = None
    sl = tp = None
    halted   = False

    trades, equity_curve, buy_hold_curve, returns = [], [], [], []
    total_fees = total_funding = total_slip = 0.0
    bars_in_pos = n_eval = 0

    bh_entry = candles[WARMUP]["close"]      # buy & hold reference entry

    def close_position(exit_px_raw: float, t: int) -> None:
        nonlocal balance, position, entry_px, entry_notional, sl, tp, open_time, total_fees, total_slip
        if position == 0:
            return
        exit_px = fill(exit_px_raw, is_buy=(position == -1))   # closing a short = buy
        pnl_pct = (exit_px - entry_px) / entry_px if position == 1 else (entry_px - exit_px) / entry_px
        fees    = 2 * entry_notional * (fee_bps / 10_000.0)    # entry + exit taker
        pnl     = pnl_pct * entry_notional - fees
        margin  = entry_notional / leverage
        balance     += pnl
        total_fees  += fees
        total_slip  += 2 * slip * entry_notional               # approx slippage drag
        returns.append(pnl / margin if margin else 0.0)
        trades.append({
            "open_time":  open_time,
            "close_time": t,
            "direction":  "long" if position == 1 else "short",
            "entry_px":   round(entry_px, 4),
            "exit_px":    round(exit_px, 4),
            "pnl_usd":    round(pnl, 2),
            "pnl_pct":    round(pnl_pct * leverage * 100, 2),
            "fees":       round(fees, 2),
        })
        position, sl, tp, entry_px, entry_notional, open_time = 0, None, None, 0.0, 0.0, None

    for i in range(WARMUP, len(candles) - 1):
        n_eval += 1
        nxt       = candles[i + 1]
        next_open = nxt["open"]

        # 1) protective bracket exits (breakout ATR and/or risk SL/TP), vs next range
        if position != 0 and (sl is not None or tp is not None):
            hit = None
            if position == 1:
                if   sl is not None and nxt["low"]  <= sl: hit = sl
                elif tp is not None and nxt["high"] >= tp: hit = tp
            else:
                if   sl is not None and nxt["high"] >= sl: hit = sl
                elif tp is not None and nxt["low"]  <= tp: hit = tp
            if hit is not None:
                close_position(hit, nxt["time"])

        # 1b) ATR trailing stop update for trend_follow_b
        if strategy == "trend_follow_b" and position != 0 and sl is not None:
            atr_now = ind["atr14"][i]
            if atr_now > 0:
                close_i_tb = ind["closes"][i]
                initial_sl_dist = abs(entry_px - sl)
                # Tighten: if price moved 2*initial_sl from entry, use 1.5x ATR
                if position == 1:
                    if close_i_tb >= entry_px + 2 * initial_sl_dist:
                        new_trail = close_i_tb - 1.5 * atr_now
                    else:
                        new_trail = close_i_tb - 2.5 * atr_now
                    if new_trail > sl:
                        sl = new_trail
                else:
                    if close_i_tb <= entry_px - 2 * initial_sl_dist:
                        new_trail = close_i_tb + 1.5 * atr_now
                    else:
                        new_trail = close_i_tb + 2.5 * atr_now
                    if new_trail < sl:
                        sl = new_trail

        # 2) signal → target; or, if the kill switch fired, stay flat
        if halted:
            if position != 0:
                close_position(next_open, nxt["time"])
        else:
            target = _target(strategy, ind, i, position)
            if target != position:
                if position != 0:
                    close_position(next_open, nxt["time"])
                if target != 0 and balance > 0:
                    margin         = position_margin(balance, size_usd, risk)
                    position       = target
                    entry_px       = fill(next_open, is_buy=(target == 1))
                    entry_notional = margin * leverage
                    open_time      = nxt["time"]
                    # build protective brackets (tightest of ATR + risk levels)
                    stops, takes = [], []
                    if strategy == "breakout":
                        atr = ind["atr14"][i]
                        if target == 1:
                            takes.append(next_open + 2 * atr); stops.append(next_open - 1 * atr)
                        else:
                            takes.append(next_open - 2 * atr); stops.append(next_open + 1 * atr)
                    if strategy == "trend_follow_b":
                        atr = ind["atr14"][i]
                        if atr > 0:
                            if target == 1:
                                stops.append(next_open - 2.5 * atr)
                            else:
                                stops.append(next_open + 2.5 * atr)
                    if strategy in ("sniper_c", "unified_d", "stop_hunt_a"):
                        # Use swing-based structural stop
                        sw_hi = ind["swing_hi20"][i]
                        sw_lo = ind["swing_lo20"][i]
                        atr   = ind["atr14"][i]
                        if target == 1 and sw_lo > 0:
                            stops.append(sw_lo - atr * 0.5)
                        elif target == -1 and sw_hi > 0:
                            stops.append(sw_hi + atr * 0.5)
                    rsl, rtp = stop_levels(entry_px, position, leverage, risk)
                    if rsl is not None: stops.append(rsl)
                    if rtp is not None: takes.append(rtp)
                    if position == 1:
                        sl = max(stops) if stops else None
                        tp = min(takes) if takes else None
                    else:
                        sl = min(stops) if stops else None
                        tp = max(takes) if takes else None

        # 3) funding drag while holding into the next bar
        if position != 0:
            f = entry_notional * funding_rate_bar
            balance       -= f
            total_funding += f
            bars_in_pos   += 1

        # 4) mark-to-market equity → drawdown → kill switch
        close_i = candles[i]["close"]
        unreal  = position * ((close_i - entry_px) / entry_px) * entry_notional if (position != 0 and entry_px > 0) else 0.0
        equity  = balance + unreal
        peak    = max(peak, equity)
        dd      = (peak - equity) / peak if peak > 0 else 0.0
        max_dd  = max(max_dd, dd)
        if not halted and kill_switch_triggered(equity, peak, risk):
            halted = True
        equity_curve.append({"time": candles[i]["time"], "value": round(equity, 2)})
        bh_val = starting_balance + ((close_i / bh_entry) - 1) * size_usd * leverage
        buy_hold_curve.append({"time": candles[i]["time"], "value": round(bh_val, 2)})

    # close any runner at the final candle
    if position != 0:
        close_position(candles[-1]["close"], candles[-1]["time"])
    final_close = candles[-1]["close"]
    equity_curve.append({"time": candles[-1]["time"], "value": round(balance, 2)})
    buy_hold_curve.append({"time": candles[-1]["time"],
                           "value": round(starting_balance + ((final_close / bh_entry) - 1) * size_usd * leverage, 2)})

    # Buy & hold of the SAME position notional, measured on the SAME account base
    # as the strategy's return_pct — so alpha is a fair, apples-to-apples comparison.
    bh_return     = final_close / bh_entry - 1
    bh_pnl        = bh_return * size_usd * leverage
    bh_return_pct = (bh_pnl / starting_balance * 100) if starting_balance else 0.0
    stats = _calc_stats(trades, returns, balance, starting_balance, max_dd,
                        total_fees, total_funding, total_slip, bars_in_pos, n_eval,
                        bh_pnl, bh_return_pct, halted)
    return {"trades": trades, "equity_curve": equity_curve,
            "buy_hold_curve": buy_hold_curve, "stats": stats}

# ─── walk-forward validation ──────────────────────────────────────────────────

def run_walk_forward(
    candles: list[dict],
    starting_balance: float,
    size_usd: float,
    leverage: int,
    strategy: str,
    folds: int = 5,
    **costs,
) -> dict:
    """Run the strategy on `folds` sequential out-of-sample segments and report
    per-fold stats + a consistency summary. For rule-based strategies this exposes
    whether an edge holds across regimes or was just one lucky window.
    """
    n = len(candles)
    folds = max(2, min(folds, max(2, n // (WARMUP + 20))))
    seg_len = n // folds
    results = []
    for k in range(folds):
        lo = k * seg_len
        hi = n if k == folds - 1 else (k + 1) * seg_len
        seg = candles[lo:hi]
        if len(seg) < WARMUP + 10:
            continue
        s = run_backtest(seg, starting_balance, size_usd, leverage, strategy, **costs)["stats"]
        results.append({
            "fold":                k + 1,
            "candles":             len(seg),
            "return_pct":          s["return_pct"],
            "buy_hold_return_pct": s["buy_hold_return_pct"],
            "alpha_pct":           s["alpha_pct"],
            "sharpe":              s["sharpe"],
            "max_drawdown":        s["max_drawdown"],
            "trades":              s["total_trades"],
            "win_rate":            s["win_rate"],
        })

    rets   = [f["return_pct"] for f in results]
    alphas = [f["alpha_pct"]  for f in results]
    mean   = sum(rets) / len(rets) if rets else 0.0
    std    = math.sqrt(sum((x - mean) ** 2 for x in rets) / len(rets)) if rets else 0.0
    summary = {
        "folds":                 len(results),
        "profitable_folds":      sum(1 for x in rets if x > 0),
        "beats_buy_hold_folds":  sum(1 for a in alphas if a > 0),
        "mean_return_pct":       round(mean, 2),
        "return_std_pct":        round(std, 2),
        "mean_alpha_pct":        round(sum(alphas) / len(alphas), 2) if alphas else 0.0,
        "best_fold_pct":         round(max(rets), 2) if rets else 0.0,
        "worst_fold_pct":        round(min(rets), 2) if rets else 0.0,
        "consistency":           round(sum(1 for x in rets if x > 0) / len(results), 2) if results else 0.0,
    }
    return {"folds": results, "summary": summary}

# ─── stats ──────────────────────────────────────────────────────────────────

def _empty_stats() -> dict:
    return {
        "total_trades": 0, "win_rate": 0.0, "profit_factor": 0.0, "max_drawdown": 0.0,
        "sharpe": 0.0, "sortino": 0.0, "net_pnl": 0.0, "return_pct": 0.0,
        "avg_win": 0.0, "avg_loss": 0.0, "expectancy": 0.0, "max_consec_losses": 0,
        "best_trade": 0.0, "worst_trade": 0.0, "total_fees": 0.0,
        "long_trades": 0, "short_trades": 0, "exposure": 0.0,
        "buy_hold_return_pct": 0.0, "buy_hold_pnl": 0.0, "alpha_pct": 0.0,
        "total_funding": 0.0, "slippage_cost": 0.0, "halted": False,
    }


def _calc_stats(trades, returns, final_bal, start_bal, max_dd, total_fees, total_funding,
                total_slip, bars_in_pos, n_eval, bh_pnl, bh_return_pct, halted) -> dict:
    stats = _empty_stats()
    net = final_bal - start_bal
    return_pct = (net / start_bal * 100) if start_bal else 0.0
    stats.update({
        "net_pnl":             round(net, 2),
        "return_pct":          round(return_pct, 2),
        "max_drawdown":        round(max_dd * 100, 2),
        "total_fees":          round(total_fees, 2),
        "total_funding":       round(total_funding, 2),
        "slippage_cost":       round(total_slip, 2),
        "exposure":            round(bars_in_pos / n_eval * 100, 1) if n_eval else 0.0,
        "buy_hold_return_pct": round(bh_return_pct, 2),
        "buy_hold_pnl":        round(bh_pnl, 2),
        "alpha_pct":           round(return_pct - bh_return_pct, 2),
        "halted":              halted,
    })
    if not trades:
        return stats

    wins   = [t for t in trades if t["pnl_usd"] > 0]
    losses = [t for t in trades if t["pnl_usd"] <= 0]
    gross_profit = sum(t["pnl_usd"] for t in wins)
    gross_loss   = abs(sum(t["pnl_usd"] for t in losses))

    win_rate   = len(wins) / len(trades)
    avg_win    = gross_profit / len(wins) if wins else 0.0
    avg_loss   = gross_loss / len(losses) if losses else 0.0
    expectancy = win_rate * avg_win - (1 - win_rate) * avg_loss

    max_consec = cur = 0
    for t in trades:
        if t["pnl_usd"] <= 0:
            cur += 1
            max_consec = max(max_consec, cur)
        else:
            cur = 0

    if len(returns) > 1:
        mean_r = sum(returns) / len(returns)
        std_r  = math.sqrt(sum((r - mean_r) ** 2 for r in returns) / len(returns))
        sharpe = (mean_r / (std_r + 1e-9)) * math.sqrt(252)
        downside = [r for r in returns if r < 0]
        dstd = math.sqrt(sum(r * r for r in downside) / len(downside)) if downside else 0.0
        sortino = (mean_r / dstd) * math.sqrt(252) if dstd > 0 else 0.0
    else:
        sharpe = sortino = 0.0

    longs = sum(1 for t in trades if t["direction"] == "long")
    stats.update({
        "total_trades":      len(trades),
        "win_rate":          round(win_rate * 100, 1),
        "profit_factor":     round(gross_profit / (gross_loss + 1e-9), 2),
        "sharpe":            round(sharpe, 2),
        "sortino":           round(sortino, 2),
        "avg_win":           round(avg_win, 2),
        "avg_loss":          round(avg_loss, 2),
        "expectancy":        round(expectancy, 2),
        "max_consec_losses": max_consec,
        "best_trade":        round(max(t["pnl_usd"] for t in trades), 2),
        "worst_trade":       round(min(t["pnl_usd"] for t in trades), 2),
        "long_trades":       longs,
        "short_trades":      len(trades) - longs,
    })
    return stats
