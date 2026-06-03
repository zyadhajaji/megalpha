"""
MEGALPHA — RL agent backtest / replay.

Runs a trained PPO policy over historical candles and produces the SAME
{trades, equity_curve, buy_hold_curve, stats} shape as the strategy backtester
(backtest.py), so the agent's decisions can be inspected as a trade log + equity
curve in the UI. Same cost model (fee + slippage + funding) and the shared risk
layer (risk.py), so agent and strategy results are directly comparable.
"""

from __future__ import annotations
from pathlib import Path
from typing import Optional

from risk import RiskConfig, position_margin, stop_levels, kill_switch_triggered
from backtest import _calc_stats, _empty_stats
from rl_features import compute_indicators, observation, WARMUP

MODELS_DIR = Path(__file__).parent / "models"
_ACTION_TO_POS = {0: 0, 1: 1, 2: -1}


def _load_model(coin: str, interval: str):
    """Load rl_{COIN}_{interval}.zip → (model, error)."""
    try:
        from stable_baselines3 import PPO
    except ImportError:
        return None, "stable-baselines3 / torch not installed on the bridge"
    p = MODELS_DIR / f"rl_{coin.upper()}_{interval}.zip"
    if not p.exists():
        return None, f"No trained model for {coin.upper()} {interval} — train it first (server/train_rl.py)"
    try:
        return PPO.load(str(p.with_suffix("")), device="cpu"), None
    except Exception as exc:
        return None, f"failed to load model: {exc}"


def run_agent_backtest(
    candles: list[dict],
    coin: str,
    interval: str,
    starting_balance: float,
    size_usd: float,
    leverage: int,
    fee_bps: float = 3.5,
    slippage_bps: float = 0.0,
    funding_apr: float = 0.0,
    risk: Optional[RiskConfig] = None,
) -> dict:
    """Replay the trained policy over `candles`, recording every trade + equity."""
    model, err = _load_model(coin, interval)
    if err:
        return {"error": err}
    if len(candles) < WARMUP + 10:
        return {"trades": [], "equity_curve": [], "buy_hold_curve": [], "stats": _empty_stats()}

    risk = risk or RiskConfig()
    ind  = compute_indicators(candles)
    closes = ind["closes"]
    slip = slippage_bps / 10_000.0
    bar_secs  = (candles[1]["time"] - candles[0]["time"]) if len(candles) > 1 else 3600
    bar_hours = max(bar_secs / 3600.0, 1e-9)
    funding_rate_bar = funding_apr * (bar_hours / (365 * 24))

    def fill(px: float, is_buy: bool) -> float:
        return px * (1 + slip) if is_buy else px * (1 - slip)

    balance = peak = starting_balance
    max_dd = 0.0
    position = 0
    entry_px = entry_notional = 0.0
    open_time = None
    sl = tp = None
    halted = False
    trades, equity_curve, buy_hold_curve, returns = [], [], [], []
    total_fees = total_funding = total_slip = 0.0
    bars_in_pos = n_eval = 0
    bh_entry = closes[WARMUP]

    def close_position(exit_px_raw: float, t: int) -> None:
        nonlocal balance, position, entry_px, entry_notional, sl, tp, open_time, total_fees, total_slip
        if position == 0:
            return
        exit_px = fill(exit_px_raw, is_buy=(position == -1))
        pnl_pct = (exit_px - entry_px) / entry_px if position == 1 else (entry_px - exit_px) / entry_px
        fees    = 2 * entry_notional * (fee_bps / 10_000.0)
        pnl     = pnl_pct * entry_notional - fees
        margin  = entry_notional / leverage
        balance     += pnl
        total_fees  += fees
        total_slip  += 2 * slip * entry_notional
        returns.append(pnl / margin if margin else 0.0)
        trades.append({
            "open_time": open_time, "close_time": t,
            "direction": "long" if position == 1 else "short",
            "entry_px": round(entry_px, 4), "exit_px": round(exit_px, 4),
            "pnl_usd": round(pnl, 2), "pnl_pct": round(pnl_pct * leverage * 100, 2),
            "fees": round(fees, 2),
        })
        position, sl, tp, entry_px, entry_notional, open_time = 0, None, None, 0.0, 0.0, None

    for i in range(WARMUP, len(candles) - 1):
        n_eval += 1
        nxt = candles[i + 1]
        next_open = nxt["open"]

        # risk stop / take-profit brackets vs next candle range
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

        if halted:
            if position != 0:
                close_position(next_open, nxt["time"])
        else:
            obs = observation(ind, i, position)
            action, _ = model.predict(obs, deterministic=True)
            target = _ACTION_TO_POS[int(action)]
            if target != position:
                if position != 0:
                    close_position(next_open, nxt["time"])
                if target != 0 and balance > 0:
                    margin         = position_margin(balance, size_usd, risk)
                    position       = target
                    entry_px       = fill(next_open, is_buy=(target == 1))
                    entry_notional = margin * leverage
                    open_time      = nxt["time"]
                    sl, tp = stop_levels(entry_px, position, leverage, risk)

        if position != 0:
            f = entry_notional * funding_rate_bar
            balance       -= f
            total_funding += f
            bars_in_pos   += 1

        close_i = closes[i]
        unreal  = position * ((close_i - entry_px) / entry_px) * entry_notional if (position != 0 and entry_px > 0) else 0.0
        equity  = balance + unreal
        peak    = max(peak, equity)
        max_dd  = max(max_dd, (peak - equity) / peak if peak > 0 else 0.0)
        if not halted and kill_switch_triggered(equity, peak, risk):
            halted = True
        equity_curve.append({"time": candles[i]["time"], "value": round(equity, 2)})
        bh_val = starting_balance + ((close_i / bh_entry) - 1) * size_usd * leverage
        buy_hold_curve.append({"time": candles[i]["time"], "value": round(bh_val, 2)})

    if position != 0:
        close_position(candles[-1]["close"], candles[-1]["time"])
    final_close = closes[-1]
    equity_curve.append({"time": candles[-1]["time"], "value": round(balance, 2)})
    buy_hold_curve.append({"time": candles[-1]["time"],
                           "value": round(starting_balance + ((final_close / bh_entry) - 1) * size_usd * leverage, 2)})

    bh_return     = final_close / bh_entry - 1
    bh_pnl        = bh_return * size_usd * leverage
    bh_return_pct = (bh_pnl / starting_balance * 100) if starting_balance else 0.0
    stats = _calc_stats(trades, returns, balance, starting_balance, max_dd, total_fees,
                        total_funding, total_slip, bars_in_pos, n_eval, bh_pnl, bh_return_pct, halted)
    return {"trades": trades, "equity_curve": equity_curve, "buy_hold_curve": buy_hold_curve, "stats": stats}
