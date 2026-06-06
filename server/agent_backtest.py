"""
MEGALPHA — RL Agent Backtest stub.
Returns a not-implemented error until a trained model is available.
"""


def run_agent_backtest(
    candles,
    coin: str,
    interval: str,
    starting_balance: float,
    size_usd: float,
    leverage: int,
    fee_bps: float,
    slippage_bps: float,
    funding_apr: float,
    risk,
) -> dict:
    return {"error": "RL agent not trained yet — select a different strategy (e.g. Momentum or Stop Hunt A)"}
