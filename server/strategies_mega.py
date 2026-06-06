# -*- coding: utf-8 -*-
"""
MEGALPHA — Strategy Framework

Contains: regime detection, position sizing, and phase detection.
All pure functions — no side effects.

Import indicator helpers from backtest.py.
"""

from __future__ import annotations
import math
from typing import Optional

from backtest import _ema, _atr, _sma, _rolling_std, _rsi, _macd, _adx, _bb_width

# ─── pip floors per asset (fraction of price) ─────────────────────────────────

PIP_FLOORS = {
    "BTC": 0.001,   # 0.1%
    "ETH": 0.0006,  # 0.06%
    "SOL": 0.0004,  # 0.04%
    "GOLD": 0.0003,
    "XAUUSD": 0.0003,
    "DEFAULT": 0.0005,
}


def _pip_floor(coin: str) -> float:
    return PIP_FLOORS.get(coin.upper(), PIP_FLOORS["DEFAULT"])


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
    bbw_sma = _sma(bb_widths, 20)

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
            l1 = (adx - 20) / 10.0

        # Layer 2 (35%): BB width vs its own 20-bar SMA
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


# ─── Strategy Wrappers (main.py interface) ────────────────────────────────────

def _sig_to_dict(sig) -> Optional[dict]:
    """Convert a strategy dataclass/namedtuple/object to a plain dict."""
    if sig is None:
        return None
    if isinstance(sig, dict):
        return sig
    try:
        import dataclasses
        if dataclasses.is_dataclass(sig):
            d = dataclasses.asdict(sig)
            for k, v in d.items():
                if hasattr(v, 'isoformat'):
                    d[k] = v.isoformat()
            return d
    except Exception:
        pass
    try:
        return vars(sig)
    except Exception:
        return None


def score_strategy_a(candle_data: list[dict], coin: str) -> Optional[dict]:
    """Wrapper: run strategy_a.scan() and return normalised dict or None."""
    try:
        from strategy_a import scan as _scan_a
        from session_engine import current_session as _sess
        from zones import detect_orderblocks
        candles_4h: list[dict] = []
        try:
            import candle_cache as _cc
            import time as _t
            import asyncio as _aio
            from backtest import _ema as _ema_fn
        except Exception:
            pass
        session = _sess()
        sig = _scan_a(candle_data, candles_4h, [], coin, session)
        d = _sig_to_dict(sig)
        if d is None:
            return None
        return {
            "direction":   d.get("direction", "").lower(),
            "entry":       d.get("entry"),
            "sl":          d.get("sl"),
            "tp1":         d.get("tp1"),
            "score":       d.get("score", 0),
            "confidence":  int(float(d.get("confidence", 0)) * 100) if float(d.get("confidence", 0) or 0) <= 1.0
                           else int(d.get("confidence", 0)),
            "volume_ratio":   d.get("volume_ratio"),
            "wick_breach_pct": d.get("wick_breach_pct"),
            "close_reclaim":   d.get("close_reclaim"),
            "htf_aligned":     d.get("htf_aligned"),
            "rr":          d.get("rr"),
            "conditions": {
                "cond1_wick":    bool(d.get("wick_breach_pct", 0) and float(d.get("wick_breach_pct", 0)) > 0.15),
                "cond2_vol":     bool(d.get("volume_ratio", 0) and float(d.get("volume_ratio", 0)) >= 2.0),
                "cond3_reclaim": bool(d.get("close_reclaim")),
                "cond4_htf":     bool(d.get("htf_aligned")),
            },
        }
    except Exception as exc:
        return None


def signal_strategy_b(candle_data: list[dict], candle_4h: list[dict]) -> Optional[dict]:
    """Wrapper: run strategy_b.scan() and return normalised dict or None."""
    try:
        from strategy_b import scan as _scan_b
        sig = _scan_b(candle_data, candle_4h, "")
        d = _sig_to_dict(sig)
        if d is None:
            return None
        return {
            "direction":  d.get("direction", "").lower(),
            "entry":      d.get("entry"),
            "sl":         d.get("sl"),
            "tp1":        d.get("entry"),   # B doesn't have explicit TP — use entry as placeholder
            "score":      d.get("score", 0),
            "confidence": d.get("score", 0),
            "ema_cross":  True,
            "adx_ok":     bool(d.get("trend_strength", 0) and float(d.get("trend_strength", 0)) > 25),
            "ema200_ok":  d.get("above_200", False),
            "rr":         None,
        }
    except Exception:
        return None


def detect_fu_candle(candle_data: list[dict]) -> Optional[dict]:
    """Wrapper: run fu_candle.detect_latest() and return normalised dict or None."""
    try:
        from fu_candle import detect_latest as _detect
        if len(candle_data) < 21:
            return None
        closes = [c["close"] for c in candle_data]
        price = closes[-1]
        mag = 10 ** (len(str(int(price))) - 2) if price > 0 else 1
        levels = [round(price / mag) * mag * i / 10 for i in range(9, 12)]
        fu = _detect(candle_data, levels, lookback=3)
        if fu is None:
            return None
        d = _sig_to_dict(fu)
        if d is None:
            return None
        direction = "long" if d.get("direction", "").upper() == "LONG" else "short"
        return {
            "direction":     direction,
            "entry":         d.get("entry_50pct"),
            "sl":            d.get("sl_price"),
            "tp1":           d.get("tp1"),
            "score":         int(float(d.get("confidence", 0.5)) * 100),
            "confidence":    int(float(d.get("confidence", 0.5)) * 100),
            "fu_candle":     True,
            "fu_candle_index": d.get("candle_index"),
            "rr":            d.get("rr"),
        }
    except Exception:
        return None


def score_strategy_d(candle_data: list[dict], coin: str) -> Optional[dict]:
    """Wrapper: run strategy_d.score() via the signal scanner path and return dict or None."""
    try:
        from strategy_d import score as _score_d
        from risk import RiskConfig
        from zones import detect_orderblocks, detect_fvgs
        # Run A and C first as inputs to D
        sig_a_raw = None
        sig_c_raw = None
        try:
            from strategy_a import scan as _scan_a
            from session_engine import current_session as _sess
            sig_a_raw = _scan_a(candle_data, [], [], coin, _sess())
        except Exception:
            pass
        obs = []
        fvgs = []
        try:
            obs  = detect_orderblocks(candle_data, "1h")
            fvgs = detect_fvgs(candle_data, "1h")
        except Exception:
            pass
        sig = _score_d(
            signal_a=sig_a_raw,
            signal_c=sig_c_raw,
            orderblocks=obs,
            fvgs=fvgs,
            liq_clusters=[],
            candles_4h=[],
            risk_config=RiskConfig(),
            asset=coin,
        )
        d = _sig_to_dict(sig)
        if d is None:
            return None
        total = d.get("total_score", 0)
        return {
            "direction":  d.get("direction", "").lower(),
            "entry":      d.get("entry"),
            "sl":         d.get("sl"),
            "tp1":        d.get("tp1"),
            "score":      total,
            "confidence": total,
            "rr":         d.get("rr"),
            "priority":   d.get("priority", "WEAK"),
            "scores":     d.get("scores", {}),
        }
    except Exception:
        return None


def _make_analysis(sig_dict: Optional[dict], strategy: str) -> dict:
    """Build a standard analysis response dict from a signal dict."""
    if sig_dict is None:
        return {"fired": False, "direction": None, "score": 0, "entry": None, "sl": None, "tp1": None}
    return {
        "fired":     True,
        "strategy":  strategy,
        "direction": sig_dict.get("direction"),
        "score":     sig_dict.get("score", 0),
        "confidence": sig_dict.get("confidence", 0),
        "entry":     sig_dict.get("entry"),
        "sl":        sig_dict.get("sl"),
        "tp1":       sig_dict.get("tp1"),
        "rr":        sig_dict.get("rr"),
        "conditions": sig_dict.get("conditions", {}),
    }


def analyze_strategy_a(candle_data: list[dict], coin: str) -> dict:
    return _make_analysis(score_strategy_a(candle_data, coin), "A")


def analyze_strategy_b(candle_data: list[dict], candle_4h: list[dict]) -> dict:
    return _make_analysis(signal_strategy_b(candle_data, candle_4h), "B")


def analyze_strategy_c(candle_data: list[dict]) -> dict:
    return _make_analysis(detect_fu_candle(candle_data), "C")


def analyze_strategy_d(candle_data: list[dict], coin: str) -> dict:
    return _make_analysis(score_strategy_d(candle_data, coin), "D")
