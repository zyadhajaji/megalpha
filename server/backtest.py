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

# ─── strategy layer ───────────────────────────────────────────────────────────

STRATEGIES = ("momentum", "breakout", "mean_reversion", "ema_cross", "macd", "bollinger")
Strategy = Literal["momentum", "breakout", "mean_reversion", "ema_cross", "macd", "bollinger"]

WARMUP  = 35     # candles needed before slow indicators (EMA26 + MACD signal) settle
FEE_BPS = 3.5    # HL taker fee per side


def _indicators(candles: list[dict]) -> dict:
    closes = [c["close"] for c in candles]
    highs  = [c["high"]  for c in candles]
    lows   = [c["low"]   for c in candles]
    macd_line, macd_sig = _macd(closes)
    return {
        "closes":   closes,
        "highs":    highs,
        "lows":     lows,
        "ema9":     _ema(closes, 9),
        "ema20":    _ema(closes, 20),
        "ema21":    _ema(closes, 21),
        "rsi14":    _rsi(closes, 14),
        "atr14":    _atr(candles, 14),
        "sma20":    _sma(closes, 20),
        "std20":    _rolling_std(closes, 20),
        "macd":     macd_line,
        "macd_sig": macd_sig,
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
