"""
MEGALPHA — Institutional-Grade AI Signal Generator
Produces LONG/SHORT/HOLD signals with real edge:
  • Swing high/low structure (actual S/R, not EMA offsets)
  • 4h trend bias resampled from 1h candles
  • Stop placement AT swing levels (not ATR guesses)
  • Enforced 2.5:1 minimum R:R — HOLD if not achievable
  • Session filter — avoid Asia noise
  • Confidence floor: 75 for LONG/SHORT, else HOLD
"""
from __future__ import annotations

import datetime
import json
import logging
import os
import time
from typing import Optional

import httpx

from openrouter import OPENROUTER_API_KEY, OPENROUTER_MODEL, OPENROUTER_URL

SIGNAL_CONFIDENCE_FLOOR = int(os.getenv("SIGNAL_CONFIDENCE_FLOOR", "65"))

log = logging.getLogger("megalpha.ai_signals")

# ─── system prompt ────────────────────────────────────────────────────────────

_SYSTEM = """\
You are a professional institutional swing trader specialising in crypto perpetual
futures on Hyperliquid. Your only job is to find HIGH-PROBABILITY setups with REAL EDGE,
or clearly say HOLD. You are NOT paid to generate signals — you are paid to be RIGHT.

Core philosophy:
- Trade price structure (swing highs/lows), NOT just indicator readings
- Stop losses must go BEHIND actual swing structure, not arbitrary ATR distances
- Only enter on PULLBACKS to key levels — never chase breakouts mid-candle
- Minimum 2.5:1 risk-reward. If structure does not support it → HOLD
- Session matters: London (08-16 UTC) and NY (13-21 UTC) are tradeable.
  Asia (00-08 UTC) is noise — only trade there on RSI < 25 or > 75 extremes.

Respond ONLY with valid JSON. No markdown. No explanation outside the JSON.
"""

# ─── prompt template ──────────────────────────────────────────────────────────

_PROMPT = """\
ASSET: {coin}/USDC PERPETUAL · ENTRY TF: {interval}

━━━ 4H TREND BIAS (direction filter) ━━━
Bias: {bias_4h}
4h EMA20: ${ema20_4h:.4f}  |  4h EMA50: ${ema50_4h:.4f}
Price vs 4h EMA20: {pct_vs_ema20_4h:+.2f}%
Last 4h candle: O{open_4h:.4f} H{high_4h:.4f} L{low_4h:.4f} C{close_4h:.4f}

━━━ PRICE STRUCTURE (swing S/R) ━━━
Current price: ${price:.4f}
Key SUPPORTS (swing lows, strongest first): {swing_lows}
Key RESISTANCES (swing highs, strongest first): {swing_highs}
Nearest support  → ${nearest_sup:.4f}  ({sup_dist:+.2f}% from price)
Nearest resist   → ${nearest_res:.4f}  ({res_dist:+.2f}% from price)
Previous day high: ${pdh:.4f}  |  Previous day low: ${pdl:.4f}

━━━ ENTRY TF INDICATORS ━━━
RSI(14):      {rsi:.1f}  [{rsi_zone}]
MACD hist:    {macd_hist:+.6f}  [{macd_dir}]
Bollinger %B: {bb_pct:.2f}  (0=lower, 0.5=mid, 1=upper band)
ATR(14):      ${atr:.4f}  ({atr_pct:.2f}% of price)
Vol vs SMA20: {vol_ratio:.1f}x

━━━ RECENT CANDLES (last {n} bars, oldest→newest) ━━━
UTC              | open      | high      | low       | close     | vol
{candle_table}

━━━ MARKET SESSION ━━━
Current session: {session}
Session quality: {session_quality}

━━━ SUPPLY / DEMAND ZONES (base-then-impulse) ━━━
{sd_zones}

━━━ LIQUIDITY SWEEPS (stop-hunts in last 30 bars) ━━━
{sweeps}

━━━ RL AGENT BIAS ━━━
Decision: {rl_action}  (L:{rl_long:.0%} H:{rl_hold:.0%} S:{rl_short:.0%})

━━━ TRADE RULES — ALL MUST PASS ━━━
LONG valid when:
  • 4h bias BULLISH, price pulling back toward nearest support (within 2%)
  • RSI between 32-58 (oversold recovery, not chasing)
  • MACD histogram ≥ 0 or just turned positive
  • Stop at 0.2% below nearest swing LOW → TP at next resistance above
  • R:R ≥ 2.5:1 — else HOLD

SHORT valid when:
  • 4h bias BEARISH, price rejecting from nearest resistance (within 2%)
  • RSI between 42-68 (overbought rejection, not chasing)
  • MACD histogram ≤ 0 or just turned negative
  • Stop at 0.2% above nearest swing HIGH → TP at next support below
  • R:R ≥ 2.5:1 — else HOLD

HOLD when:
  • Setup does not meet ALL criteria above
  • Price is mid-range with no structure confluence
  • Asia session AND RSI between 25-75
  • R:R < 2.5:1 with logical SL/TP

━━━ REQUIRED JSON OUTPUT ━━━
{{
  "signal":       "LONG" | "SHORT" | "HOLD",
  "confidence":   <integer 75-100 for LONG/SHORT, 50-74 for HOLD>,
  "entry":        <entry price — ideally at or just above/below structure>,
  "stop_loss":    <price — MUST be at/below swing low for LONG, at/above swing high for SHORT>,
  "take_profit":  <price — at next structural target, ≥2.5:1 R:R>,
  "risk_reward":  "<actual ratio, e.g. 1:3.2>",
  "key_factors":  ["<specific reading 1>", "<specific reading 2>", "<specific reading 3>"],
  "reasoning":    "<4-6 sentences: (1) trend context, (2) structure level being tested, (3) momentum confirmation, (4) exact SL rationale, (5) TP target rationale, (6) risk note>",
  "support":      <strongest nearby support>,
  "resistance":   <strongest nearby resistance>
}}
"""

# ─── market session ───────────────────────────────────────────────────────────

def _session_info() -> tuple[str, str]:
    """Return (session_name, session_quality)."""
    h = datetime.datetime.utcnow().hour
    if 13 <= h < 16:
        return "LONDON/NY OVERLAP", "HIGHEST — peak institutional liquidity"
    if 8 <= h < 13:
        return "LONDON", "HIGH — major session, valid for setups"
    if 16 <= h < 21:
        return "NEW YORK", "HIGH — major session, valid for setups"
    return "ASIA / OFF-HOURS", "LOW — wait for London open unless RSI extreme"

# ─── swing structure ──────────────────────────────────────────────────────────

def _swing_lows(candles: list[dict], window: int = 3, n: int = 6) -> list[float]:
    lows = []
    for i in range(window, len(candles) - window):
        lo = candles[i]["low"]
        if all(lo <= candles[i-j]["low"] for j in range(1, window+1)) and \
           all(lo <= candles[i+j]["low"] for j in range(1, window+1)):
            lows.append(lo)
    # Return most recent n, sorted descending (strongest nearest to price)
    recent = lows[-(n * 3):]   # search last 3n candidates
    return sorted(set(round(x, 6) for x in recent), reverse=True)[:n]


def _swing_highs(candles: list[dict], window: int = 3, n: int = 6) -> list[float]:
    highs = []
    for i in range(window, len(candles) - window):
        hi = candles[i]["high"]
        if all(hi >= candles[i-j]["high"] for j in range(1, window+1)) and \
           all(hi >= candles[i+j]["high"] for j in range(1, window+1)):
            highs.append(hi)
    recent = highs[-(n * 3):]
    return sorted(set(round(x, 6) for x in recent))[:n]


def _prev_day(candles: list[dict]) -> tuple[float, float]:
    """Previous calendar day's high and low from 1h candles."""
    now_ts = candles[-1]["time"]
    today_midnight = now_ts - (now_ts % 86400)
    yest_start = today_midnight - 86400
    yest_candles = [c for c in candles if yest_start <= c["time"] < today_midnight]
    if not yest_candles:
        return candles[-1]["high"], candles[-1]["low"]
    return max(c["high"] for c in yest_candles), min(c["low"] for c in yest_candles)

# ─── 4h bias ─────────────────────────────────────────────────────────────────

def _resample_4h(candles_1h: list[dict]) -> list[dict]:
    out = []
    # Align to 4h boundaries
    start_idx = 0
    for i, c in enumerate(candles_1h):
        if (c["time"] % (4 * 3600)) == 0:
            start_idx = i
            break
    chunk = []
    for c in candles_1h[start_idx:]:
        chunk.append(c)
        if len(chunk) == 4:
            out.append({
                "time":   chunk[0]["time"],
                "open":   chunk[0]["open"],
                "high":   max(x["high"]  for x in chunk),
                "low":    min(x["low"]   for x in chunk),
                "close":  chunk[-1]["close"],
                "volume": sum(x.get("volume", 0) for x in chunk),
            })
            chunk = []
    return out


def _4h_bias(candles_1h: list[dict]) -> dict:
    from backtest import _ema
    c4h = _resample_4h(candles_1h)
    if len(c4h) < 10:
        return {"bias": "SIDEWAYS", "ema20": 0, "ema50": 0,
                "open": 0, "high": 0, "low": 0, "close": 0, "pct_vs_ema20": 0}
    closes = [c["close"] for c in c4h]
    ema20 = _ema(closes, min(20, len(closes)))[-1]
    ema50 = _ema(closes, min(50, len(closes)))[-1]
    price = closes[-1]
    bias = "BULLISH" if price > ema20 > ema50 else \
           "BEARISH" if price < ema20 < ema50 else "SIDEWAYS"
    last = c4h[-1]
    return {
        "bias": bias, "ema20": ema20, "ema50": ema50,
        "open": last["open"], "high": last["high"],
        "low": last["low"], "close": last["close"],
        "pct_vs_ema20": (price - ema20) / ema20 * 100,
    }

# ─── indicators ───────────────────────────────────────────────────────────────

def _indicators(candles: list[dict]) -> dict:
    from backtest import _ema, _rsi, _atr, _sma, _rolling_std, _macd
    closes  = [c["close"] for c in candles]
    vols    = [c.get("volume", 0) for c in candles]
    n = len(closes)

    ema9  = _ema(closes, 9)[-1]  if n >= 9  else closes[-1]
    ema20 = _ema(closes, 20)[-1] if n >= 20 else closes[-1]
    ema50 = _ema(closes, 50)[-1] if n >= 50 else closes[-1]
    rsi   = _rsi(closes, 14)[-1] if n >= 15 else 50.0
    atr   = _atr(candles, 14)[-1] if n >= 14 else 0.0

    macd_hist = 0.0
    if n >= 35:
        ml, ms = _macd(closes)
        if ml and ms:
            macd_hist = ml[-1] - ms[-1]

    price  = closes[-1]
    bb_pct = 0.5
    vol_ratio = 1.0
    if n >= 20:
        mid = _sma(closes, 20)[-1]
        std = _rolling_std(closes, 20)[-1]
        if std > 0:
            upper = mid + 2 * std
            lower = mid - 2 * std
            bb_pct = (price - lower) / (upper - lower) if (upper - lower) > 0 else 0.5
        vol_sma = _sma(vols, 20)[-1]
        if vol_sma > 0:
            vol_ratio = vols[-1] / vol_sma

    rsi_zone = ("OVERSOLD" if rsi < 32 else "OVERBOUGHT" if rsi > 68 else "NEUTRAL")
    macd_dir  = ("BULLISH" if macd_hist > 0 else "BEARISH")

    return {
        "price": price, "ema9": ema9, "ema20": ema20, "ema50": ema50,
        "rsi": rsi, "rsi_zone": rsi_zone,
        "macd_hist": macd_hist, "macd_dir": macd_dir,
        "atr": atr, "atr_pct": atr / price * 100 if price > 0 else 0,
        "bb_pct": max(0.0, min(1.0, bb_pct)),
        "vol_ratio": vol_ratio,
    }

# ─── candle table ─────────────────────────────────────────────────────────────

def _supply_demand_context(candles: list[dict], atr: float, base_bars: int = 4) -> str:
    """
    Detect active supply/demand zones from recent price action using the
    base-then-impulse model: tight consolidation followed by explosive move.
    Returns a formatted string for the AI prompt.
    """
    if len(candles) < base_bars + 5 or atr <= 0:
        return "none detected"

    closes = [c["close"] for c in candles]
    highs  = [c["high"]  for c in candles]
    lows   = [c["low"]   for c in candles]
    price  = closes[-1]

    demand_zones = []
    supply_zones = []

    for i in range(base_bars + 2, len(candles)):
        body   = abs(closes[i] - closes[i - 1])
        range_ = highs[i] - lows[i]
        if body < 1.1 * atr or range_ < 0.9 * atr:
            continue
        base_hi = max(highs[i - base_bars : i])
        base_lo = min(lows[i - base_bars : i])
        base_range = base_hi - base_lo
        if base_range >= 0.75 * atr:
            continue

        # Only zones that haven't been breached (price never closed through them)
        closes_since = closes[i + 1:]
        if closes[i] > closes[i - 1]:   # bullish impulse → demand zone
            if not closes_since or min(closes_since) > base_lo:   # zone intact
                dist_pct = (price - base_hi) / price * 100 if price > base_hi else (price - base_lo) / price * 100
                demand_zones.append((base_lo, base_hi, dist_pct))
        else:                            # bearish impulse → supply zone
            if not closes_since or max(closes_since) < base_hi:   # zone intact
                dist_pct = (base_lo - price) / price * 100 if price < base_lo else (base_hi - price) / price * 100
                supply_zones.append((base_lo, base_hi, dist_pct))

    lines = []
    # Show nearest 3 of each type
    demand_zones.sort(key=lambda z: abs(z[2]))
    supply_zones.sort(key=lambda z: abs(z[2]))
    for lo, hi, dist in demand_zones[:3]:
        lines.append(f"  DEMAND ${lo:.4f}–${hi:.4f}  ({dist:+.2f}% from price)")
    for lo, hi, dist in supply_zones[:3]:
        lines.append(f"  SUPPLY ${lo:.4f}–${hi:.4f}  ({dist:+.2f}% from price)")
    return "\n".join(lines) if lines else "none detected in last 150 bars"


def _liquidity_sweep_context(candles: list[dict], atr: float, lookback: int = 20) -> str:
    """
    Detect recent stop-hunt (liquidity sweep) events.
    A sweep = candle wick extends past a swing level by < 0.6 × ATR,
    then closes back inside — classic institutional stop-grab pattern.
    """
    if len(candles) < lookback + 2 or atr <= 0:
        return "none detected"

    closes = [c["close"] for c in candles]
    highs  = [c["high"]  for c in candles]
    lows   = [c["low"]   for c in candles]
    events = []

    for i in range(lookback, len(candles)):
        sw_lo = min(lows[i - lookback : i])
        sw_hi = max(highs[i - lookback : i])
        c     = closes[i]
        lo    = lows[i]
        hi    = highs[i]

        # Downside sweep (wick below swing low, close above it)
        if lo < sw_lo and c > sw_lo and (sw_lo - lo) < 0.6 * atr:
            bars_ago = len(candles) - 1 - i
            events.append(f"  BULLISH SWEEP at ${sw_lo:.4f} ({bars_ago} bars ago) — wick ${lo:.4f}, closed ${c:.4f}")
        # Upside sweep (wick above swing high, close below it)
        elif hi > sw_hi and c < sw_hi and (hi - sw_hi) < 0.6 * atr:
            bars_ago = len(candles) - 1 - i
            events.append(f"  BEARISH SWEEP at ${sw_hi:.4f} ({bars_ago} bars ago) — wick ${hi:.4f}, closed ${c:.4f}")

    if not events:
        return "none in last 30 bars"
    return "\n".join(events[-3:])   # most recent 3 sweeps


def _candle_table(candles: list[dict], n: int = 25) -> str:
    rows = []
    for c in candles[-n:]:
        dt = datetime.datetime.utcfromtimestamp(c["time"]).strftime("%m/%d %H:%M")
        rows.append(
            f"{dt:<16} | {c['open']:<9.4f} | {c['high']:<9.4f} | "
            f"{c['low']:<9.4f} | {c['close']:<9.4f} | {c.get('volume', 0):.0f}"
        )
    return "\n".join(rows)


def _fmt_levels(levels: list[float]) -> str:
    return "  ".join(f"${x:.4f}" for x in levels) if levels else "none found"

# ─── JSON parser ──────────────────────────────────────────────────────────────

def _parse_json(text: str) -> dict:
    text = text.strip()
    if "```" in text:
        for part in text.split("```"):
            part = part.strip().lstrip("json").strip()
            try:
                return json.loads(part)
            except json.JSONDecodeError:
                continue
    # find first { … } block
    start = text.find("{")
    end   = text.rfind("}") + 1
    if start >= 0 and end > start:
        return json.loads(text[start:end])
    return json.loads(text)

# ─── main entry ───────────────────────────────────────────────────────────────

async def generate_signal(
    coin: str,
    interval: str,
    candles: list[dict],
    rl_state: dict,
) -> Optional[dict]:
    """
    Generate an institutional-grade signal.
    Returns a dict ready for db.save_signal(), or None on failure.
    """
    if not OPENROUTER_API_KEY:
        return None
    if len(candles) < 60:
        log.debug("Too few candles for %s %s (%d)", coin, interval, len(candles))
        return None

    try:
        ind    = _indicators(candles)
        bias4h = _4h_bias(candles)
        slows  = _swing_lows(candles[-150:],  window=3, n=5)
        shighs = _swing_highs(candles[-150:], window=3, n=5)
        pdh, pdl = _prev_day(candles)
        session, sq = _session_info()
    except Exception as exc:
        log.warning("Pre-compute error for %s %s: %s", coin, interval, exc)
        return None

    price = ind["price"]

    # Nearest support/resistance
    nearest_sup = max((x for x in slows  if x < price), default=price * 0.97)
    nearest_res = min((x for x in shighs if x > price), default=price * 1.03)
    sup_dist = (nearest_sup - price) / price * 100
    res_dist = (nearest_res - price) / price * 100

    # ── Decode RL agent state ─────────────────────────────────────────────
    # main.py stores action_probs as [long, hold, short] list and last_action
    # as "BTC LONG" / "ETH SHORT" etc. Map to the format the prompt expects.
    rl_state = rl_state or {}
    probs_list = rl_state.get("action_probs") or [0.17, 0.72, 0.11]
    rl_long_p  = float(probs_list[0]) if len(probs_list) > 0 else 0.17
    rl_hold_p  = float(probs_list[1]) if len(probs_list) > 1 else 0.72
    rl_short_p = float(probs_list[2]) if len(probs_list) > 2 else 0.11
    last_act   = rl_state.get("last_action") or ""
    rl_action  = last_act.split()[-1] if last_act else "HOLD"
    if rl_action not in ("LONG", "SHORT", "HOLD"):
        rl_action = "HOLD"

    # Supply/demand zone and liquidity sweep context
    sd_zones = _supply_demand_context(candles[-150:], ind["atr"])
    sweeps   = _liquidity_sweep_context(candles[-35:], ind["atr"])

    prompt = _PROMPT.format(
        coin=coin, interval=interval,
        # 4h
        bias_4h=bias4h["bias"],
        ema20_4h=bias4h["ema20"], ema50_4h=bias4h["ema50"],
        pct_vs_ema20_4h=bias4h["pct_vs_ema20"],
        open_4h=bias4h["open"], high_4h=bias4h["high"],
        low_4h=bias4h["low"],  close_4h=bias4h["close"],
        # structure
        price=price,
        swing_lows=_fmt_levels(slows),
        swing_highs=_fmt_levels(shighs),
        nearest_sup=nearest_sup, sup_dist=sup_dist,
        nearest_res=nearest_res, res_dist=res_dist,
        pdh=pdh, pdl=pdl,
        # indicators
        rsi=ind["rsi"], rsi_zone=ind["rsi_zone"],
        macd_hist=ind["macd_hist"], macd_dir=ind["macd_dir"],
        bb_pct=ind["bb_pct"],
        atr=ind["atr"], atr_pct=ind["atr_pct"],
        vol_ratio=ind["vol_ratio"],
        # candles
        n=25, candle_table=_candle_table(candles, 25),
        # session
        session=session, session_quality=sq,
        # rl — now reading the actual rl_state format from main.py
        rl_action=rl_action,
        rl_long=rl_long_p,
        rl_hold=rl_hold_p,
        rl_short=rl_short_p,
        # supply/demand zones and liquidity sweeps
        sd_zones=sd_zones,
        sweeps=sweeps,
    )

    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type":  "application/json",
        "HTTP-Referer":  "http://localhost:3000",
        "X-Title":       "MEGALPHA",
    }
    payload = {
        "model":       OPENROUTER_MODEL,
        "temperature": 0.1,        # low temp = consistent, rules-following
        "stream":      False,
        "messages": [
            {"role": "system", "content": _SYSTEM},
            {"role": "user",   "content": prompt},
        ],
    }

    try:
        async with httpx.AsyncClient(timeout=45.0) as client:
            resp = await client.post(OPENROUTER_URL, json=payload, headers=headers)
        if resp.status_code != 200:
            log.warning("OpenRouter %d: %s", resp.status_code, resp.text[:200])
            return None
        text   = resp.json()["choices"][0]["message"]["content"]
        parsed = _parse_json(text)
    except Exception as exc:
        log.warning("Signal gen failed %s %s: %s", coin, interval, exc)
        return None

    signal = str(parsed.get("signal", "HOLD")).upper()
    if signal not in ("LONG", "SHORT", "HOLD"):
        signal = "HOLD"

    confidence = min(100, max(0, int(parsed.get("confidence", 50))))
    # Enforce: LONG/SHORT require confidence >= SIGNAL_CONFIDENCE_FLOOR
    if signal in ("LONG", "SHORT") and confidence < SIGNAL_CONFIDENCE_FLOOR:
        signal = "HOLD"

    # Enforce: R:R >= MIN_RR — recalculate from entry/sl/tp
    MIN_RR = float(os.getenv("MIN_RISK_REWARD", "2.5"))
    entry = float(parsed.get("entry") or price)
    sl    = float(parsed.get("stop_loss") or 0)
    tp    = float(parsed.get("take_profit") or 0)
    if signal in ("LONG", "SHORT") and sl > 0 and tp > 0 and entry > 0:
        risk   = abs(entry - sl)
        reward = abs(tp - entry)
        if risk > 0 and reward / risk < MIN_RR:
            log.debug("%s %s: R:R %.1f < %.1f — downgrading to HOLD",
                      coin, interval, reward / risk, MIN_RR)
            signal = "HOLD"

    # RL gate removed — RL model currently HOLDs ~99% of the time and was
    # suppressing valid AI signals. Retrain RL before re-enabling.

    summary = {
        "entry":       entry,
        "stop_loss":   sl,
        "take_profit": tp,
        "risk_reward": str(parsed.get("risk_reward") or ""),
        "key_factors": list(parsed.get("key_factors") or [])[:5],
        "reasoning":   str(parsed.get("reasoning") or "")[:1200],
        "bias_4h":     bias4h["bias"],
        "session":     session,
        "rl_action":   rl_action,
        "rl_probs":    {"LONG": round(rl_long_p, 3), "HOLD": round(rl_hold_p, 3), "SHORT": round(rl_short_p, 3)},
        "sd_zones":    sd_zones,
    }

    # Snap created_at to the nearest 1h candle boundary so each hourly signal
    # lands on its own candle, preventing vertical stacking on the chart.
    now_ts   = int(time.time())
    iv_secs  = {"1m": 60, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400}
    iv_s     = iv_secs.get(interval, 3600)
    snap_ts  = (now_ts // iv_s) * iv_s   # floor to current candle boundary

    return {
        "coin":       coin,
        "interval":   interval,
        "time":       snap_ts,            # snapped to candle boundary — no stacking
        "signal":     signal,
        "confidence": confidence,
        "reasoning":  summary["reasoning"],
        "price":      price,
        "support":    float(parsed.get("support") or nearest_sup),
        "resistance": float(parsed.get("resistance") or nearest_res),
        "summary":    summary,
        "created_at": int(time.time()),
    }
