"""
MEGALPHA — RL feature engineering
Shared by training (train_rl.py) and live inference (main.py) so the observation
vector is IDENTICAL in both. 12 candle-derived features, each clipped into a fixed
bounded range (mostly [-1, 1], a couple in [0, 1]).

Why self-normalizing features instead of VecNormalize on observations?
Live inference (main.py) calls model.predict(obs) directly. If we relied on
VecNormalize's running mean/std for observations, we'd have to serialize those
stats and re-apply them identically at inference — any drift silently feeds the
policy out-of-distribution inputs. Bounding every feature here keeps train and
live observations bit-for-bit consistent with zero extra plumbing. (Reward
normalization, which is training-only, is still handled in train_rl.py.)

Order-book features (bid/ask ratio, spread) are intentionally excluded: they don't
exist in historical candles, so including them would make training and live
inference inconsistent.
"""

from __future__ import annotations
import math
import numpy as np

from backtest import _ema, _rsi, _atr, _sma, _rolling_std, _macd

N_FEATURES = 12
WARMUP = 50   # cover EMA50 settling, MACD signal (26+9), Bollinger/vol SMA(20), ret10

# Human-readable labels for each observation slot — order MUST match observation().
# Shared with the dashboard so the UI can show "what the agent sees".
FEATURE_LABELS = [
    ("trend_fast", "Trend vs EMA9"),
    ("trend_slow", "Trend vs EMA50"),
    ("regime",     "Regime EMA20/50"),
    ("rsi",        "RSI"),
    ("macd",       "MACD histogram"),
    ("bbands",     "Bollinger %B"),
    ("volatility", "Volatility (ATR)"),
    ("ret1",       "Return (1 bar)"),
    ("mom5",       "Momentum (5 bar)"),
    ("mom10",      "Momentum (10 bar)"),
    ("volume",     "Volume surge"),
    ("position",   "Position held"),
]

_EPS = 1e-9


def compute_indicators(candles: list[dict]) -> dict:
    closes  = [c["close"] for c in candles]
    volumes = [float(c.get("volume", 0.0) or 0.0) for c in candles]
    macd_line, macd_sig = _macd(closes)
    return {
        "closes":   closes,
        "highs":    [c["high"] for c in candles],
        "lows":     [c["low"]  for c in candles],
        "ema9":     _ema(closes, 9),
        "ema20":    _ema(closes, 20),
        "ema50":    _ema(closes, 50),
        "rsi14":    _rsi(closes, 14),
        "atr14":    _atr(candles, 14),
        "sma20":    _sma(closes, 20),
        "std20":    _rolling_std(closes, 20),
        "macd":     macd_line,
        "macd_sig": macd_sig,
        "volumes":  volumes,
        "vol_sma20": _sma(volumes, 20),
    }


def _clip(x: float, lo: float, hi: float) -> float:
    return float(max(lo, min(hi, x)))


def observation(ind: dict, i: int, position: int) -> np.ndarray:
    """
    Build the 12-feature observation at candle index i.
    position: -1 short, 0 flat, +1 long.
    """
    closes = ind["closes"]
    close  = closes[i] or _EPS
    ema9   = ind["ema9"][i]  or close
    ema20  = ind["ema20"][i] or close
    ema50  = ind["ema50"][i] or close
    rsi    = ind["rsi14"][i]
    atr    = ind["atr14"][i]
    sma20  = ind["sma20"][i]
    std20  = ind["std20"][i]
    hist   = ind["macd"][i] - ind["macd_sig"][i]
    vol    = ind["volumes"][i]
    vsma   = ind["vol_sma20"][i]

    ret1  = (close / closes[i - 1]  - 1) if i >= 1  else 0.0
    ret5  = (close / closes[i - 5]  - 1) if i >= 5  else 0.0
    ret10 = (close / closes[i - 10] - 1) if i >= 10 else 0.0

    # Bollinger %B mapped to [-1, 1]; neutral when the band is degenerate
    if std20 > 0:
        upper, lower = sma20 + 2 * std20, sma20 - 2 * std20
        pctb = _clip(((close - lower) / (upper - lower)) * 2 - 1, -1, 1)
    else:
        pctb = 0.0

    # Volume surge: log-ratio vs its own 20-bar SMA; neutral when missing
    if vol > 0 and vsma > 0:
        vol_z = _clip(math.log(vol / vsma), -1, 1)
    else:
        vol_z = 0.0

    return np.array([
        _clip((close / ema9  - 1) * 50, -1, 1),    # 0: fast trend (vs EMA9)
        _clip((close / ema50 - 1) * 20, -1, 1),    # 1: slow trend (vs EMA50)
        _clip((ema20 / ema50 - 1) * 50, -1, 1),    # 2: trend regime (EMA20 vs EMA50)
        _clip((rsi / 100) * 2 - 1, -1, 1),          # 3: RSI oscillator
        _clip(hist / (atr + _EPS), -1, 1),          # 4: MACD histogram (ATR units)
        pctb,                                        # 5: Bollinger %B
        _clip((atr / close) * 50, 0, 1),            # 6: volatility (ATR/price)
        _clip(ret1  * 50, -1, 1),                   # 7: last-candle return
        _clip(ret5  * 20, -1, 1),                   # 8: 5-candle momentum
        _clip(ret10 * 12, -1, 1),                   # 9: 10-candle momentum
        vol_z,                                       # 10: volume surge (log vs SMA20)
        float(position),                             # 11: current position state
    ], dtype=np.float32)
