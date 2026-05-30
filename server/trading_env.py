"""
MEGALPHA — Trading Gym environment (Phase 3)
A Gymnasium env that lets a PPO agent trade a single coin on historical candles.

State:   12 candle-derived features (see rl_features.py)
Actions: 0 = HOLD · 1 = LONG · 2 = SHORT
Reward:  risk-adjusted, expressed in RETURN units (not raw dollars) so PPO sees a
         well-scaled signal:
           + leveraged return of the position held into the next candle
           − taker fee (return units) whenever the position changes
           − turnover penalty on every flip   (discourages fee-bleeding churn)
           − drawdown penalty on each *deepening* of the equity drawdown
                                          (discourages large losing streaks)
"""

from __future__ import annotations
import numpy as np
import gymnasium as gym
from gymnasium import spaces

from rl_features import compute_indicators, observation, N_FEATURES, WARMUP

HOLD, LONG, SHORT = 0, 1, 2
_ACTION_TO_POS = {HOLD: 0, LONG: 1, SHORT: -1}


class TradingEnv(gym.Env):
    metadata = {"render_modes": []}

    def __init__(
        self,
        candles: list[dict],
        size_usd: float = 200.0,
        leverage: int = 5,
        fee_bps: float = 4.0,             # per side; HL taker ~3.5bps
        turnover_penalty: float = 0.0002,  # extra return penalty per flip (anti-churn)
        dd_penalty: float = 0.25,          # coefficient on drawdown deepening
    ):
        super().__init__()
        if len(candles) < WARMUP + 10:
            raise ValueError("Not enough candles to build a trading environment")

        self.candles   = candles
        self.ind       = compute_indicators(candles)
        self.size_usd  = size_usd
        self.leverage  = leverage
        self.fee       = fee_bps / 10_000.0
        self.turnover_penalty = turnover_penalty
        self.dd_penalty = dd_penalty

        self.action_space      = spaces.Discrete(3)
        self.observation_space = spaces.Box(low=-1.0, high=1.0, shape=(N_FEATURES,), dtype=np.float32)

        self.position = 0     # -1, 0, +1
        self.i        = WARMUP
        self.equity   = 0.0   # cumulative leveraged return, net of fees (shaping only)
        self.peak     = 0.0
        self.prev_dd  = 0.0

    def reset(self, *, seed=None, options=None):
        super().reset(seed=seed)
        self.position = 0
        self.i        = WARMUP
        self.equity   = 0.0
        self.peak     = 0.0
        self.prev_dd  = 0.0
        return observation(self.ind, self.i, self.position), {}

    def step(self, action: int):
        new_pos = _ACTION_TO_POS[int(action)]

        close      = self.ind["closes"][self.i]
        next_close = self.ind["closes"][self.i + 1]
        ret        = (next_close - close) / close
        flipped    = new_pos != self.position

        # Everything in RETURN units (fraction of margin), then PPO-friendly scale.
        leveraged_ret = new_pos * ret * self.leverage
        fee_ret  = self.fee * self.leverage if flipped else 0.0
        turn_ret = self.turnover_penalty if flipped else 0.0

        # Drawdown shaping on a running equity proxy: only penalize when the
        # drawdown deepens, so the agent learns to avoid prolonged losing runs.
        self.equity += leveraged_ret - fee_ret
        self.peak    = max(self.peak, self.equity)
        dd           = self.peak - self.equity
        dd_inc       = max(0.0, dd - self.prev_dd)
        self.prev_dd = dd

        reward = leveraged_ret - fee_ret - turn_ret - self.dd_penalty * dd_inc

        self.position = new_pos
        self.i += 1

        terminated = self.i >= len(self.candles) - 1
        obs  = observation(self.ind, self.i, self.position)
        info = {
            "ret":      leveraged_ret,
            "pnl_usd":  leveraged_ret * self.size_usd,
            "fee_usd":  (fee_ret * self.size_usd) if flipped else 0.0,
            "position": self.position,
            "flipped":  flipped,
        }
        return obs, float(reward), terminated, False, info
