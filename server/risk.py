"""
MEGALPHA — shared risk module.

Pure functions + a config object used by BOTH the backtester (backtest.py) and,
later, the live-execution path (Task #19). Keeping the sizing / stop / kill-switch
logic here means simulated and live risk can never silently diverge.
"""

from __future__ import annotations
from dataclasses import dataclass


@dataclass
class RiskConfig:
    # Per-trade protective exits, expressed as a fraction of MARGIN at risk
    # (e.g. stop_loss_pct=0.20 → close when the trade is down 20% of its margin).
    stop_loss_pct: float = 0.0        # 0 = disabled
    take_profit_pct: float = 0.0      # 0 = disabled
    # Account-level kill switch: halt + flatten if equity draws down this fraction
    # from its peak (e.g. 0.25 → stop after a 25% drawdown).
    max_drawdown_pct: float = 0.0     # 0 = disabled
    # Position sizing: cap the MARGIN per trade at this fraction of current equity
    # (e.g. 0.10 → never risk more than 10% of equity as margin on one position).
    max_position_pct: float = 0.0     # 0 = use the fixed base size

    @classmethod
    def from_dict(cls, d: dict | None) -> "RiskConfig":
        d = d or {}
        return cls(
            stop_loss_pct=max(0.0, float(d.get("stop_loss_pct", 0.0) or 0.0)),
            take_profit_pct=max(0.0, float(d.get("take_profit_pct", 0.0) or 0.0)),
            max_drawdown_pct=max(0.0, float(d.get("max_drawdown_pct", 0.0) or 0.0)),
            max_position_pct=max(0.0, float(d.get("max_position_pct", 0.0) or 0.0)),
        )

    @property
    def active(self) -> bool:
        return any((self.stop_loss_pct, self.take_profit_pct,
                    self.max_drawdown_pct, self.max_position_pct))


def position_margin(equity: float, base_size_usd: float, cfg: RiskConfig) -> float:
    """Margin to allocate to the next trade (equity-based cap, else the fixed size)."""
    if cfg.max_position_pct > 0 and equity > 0:
        return min(base_size_usd, equity * cfg.max_position_pct)
    return base_size_usd


def stop_levels(entry_px: float, position: int, leverage: float,
                cfg: RiskConfig) -> tuple[float | None, float | None]:
    """
    Convert margin-fraction SL/TP into absolute price levels. A stop of X% of
    margin maps to a price move of X%/leverage. Returns (stop_px, take_px).
    """
    lev = max(leverage, 1e-9)
    sl = tp = None
    if cfg.stop_loss_pct > 0:
        move = cfg.stop_loss_pct / lev
        sl = entry_px * (1 - move) if position == 1 else entry_px * (1 + move)
    if cfg.take_profit_pct > 0:
        move = cfg.take_profit_pct / lev
        tp = entry_px * (1 + move) if position == 1 else entry_px * (1 - move)
    return sl, tp


def kill_switch_triggered(equity: float, peak: float, cfg: RiskConfig) -> bool:
    """True when equity has drawn down past the configured fraction from its peak."""
    if cfg.max_drawdown_pct <= 0 or peak <= 0:
        return False
    return (peak - equity) / peak >= cfg.max_drawdown_pct
