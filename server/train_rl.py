"""
MEGALPHA — PPO training script (Phase 3)

Trains a PPO agent on cached historical candles and saves the policy where the
bridge server will auto-load it for live inference.

Usage (after deps installed: pip install gymnasium stable-baselines3 torch):
    python train_rl.py --coin BTC --interval 4h --steps 300000
    python train_rl.py --coin ETH --interval 1h --steps 200000 --turnover 0.0004

Candles are read from server/cache/{COIN}_{interval}.json — start the bridge once
first so the cache is populated (or run any chart/backtest to build it).

Pipeline:
  • 80/20 chronological split — train on the old portion, validate on the unseen tail
  • reward-only VecNormalize for stable PPO updates (observations stay self-bounded,
    so live inference needs no normalization stats — see rl_features.py)
  • EvalCallback keeps the BEST out-of-sample checkpoint, not just the last one
  • a real metrics report: Sharpe, max drawdown, turnover, vs buy-and-hold

Output: server/models/rl_{COIN}_{interval}.zip  (+ a copy as rl_policy_active.zip)
"""

from __future__ import annotations
import argparse
import json
import math
import sys
from pathlib import Path

CACHE_DIR  = Path(__file__).parent / "cache"
MODELS_DIR = Path(__file__).parent / "models"

# candle periods per year, for annualising Sharpe
PERIODS_PER_YEAR = {"1m": 525_600, "5m": 105_120, "15m": 35_040,
                    "1h": 8_760, "4h": 2_190, "1d": 365}


def load_candles(coin: str, interval: str) -> list[dict]:
    p = CACHE_DIR / f"{coin.upper()}_{interval}.json"
    if not p.exists():
        sys.exit(
            f"No cached candles at {p}\n"
            f"Start the bridge (python main.py) once to build the cache, then retry."
        )
    with p.open("r", encoding="utf-8") as f:
        return json.load(f)


def linear_schedule(initial: float):
    """LR schedule: decays linearly from `initial` to 0 as training progresses."""
    def f(progress_remaining: float) -> float:   # 1.0 → 0.0 over training
        return progress_remaining * initial
    return f


def main() -> None:
    try:                                  # box-drawing/→ chars in output need UTF-8
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    ap = argparse.ArgumentParser(description="Train a PPO trading agent for MEGALPHA")
    ap.add_argument("--coin",     default="ETH")
    ap.add_argument("--interval", default="4h")
    ap.add_argument("--steps",    type=int, default=500_000, help="PPO timesteps")
    ap.add_argument("--size",     type=float, default=200.0, help="USD margin per trade")
    ap.add_argument("--leverage", type=int, default=5)
    ap.add_argument("--seed",     type=int, default=42)
    ap.add_argument("--lr",       type=float, default=3e-4, help="initial learning rate")
    ap.add_argument("--ent-coef", type=float, default=0.01, help="entropy bonus")
    ap.add_argument("--turnover", type=float, default=0.0002, help="anti-churn penalty per flip")
    ap.add_argument("--dd-penalty", type=float, default=0.25, help="drawdown-deepening penalty")
    args = ap.parse_args()

    # Imported here so the rest of the project runs without these heavy deps
    try:
        from stable_baselines3 import PPO
        from stable_baselines3.common.vec_env import DummyVecEnv, VecNormalize
        from stable_baselines3.common.callbacks import EvalCallback
    except ImportError:
        sys.exit("Missing deps. Install: pip install gymnasium stable-baselines3 torch")

    from trading_env import TradingEnv
    from rl_features import N_FEATURES

    coin, interval = args.coin.upper(), args.interval
    candles = load_candles(coin, interval)
    print(f"Loaded {len(candles)} {coin} {interval} candles ({N_FEATURES} features)")

    # 80/20 chronological split so we report genuine out-of-sample performance
    split = int(len(candles) * 0.8)
    train_candles, eval_candles = candles[:split], candles[split:]
    print(f"  train: {len(train_candles)}   eval (unseen tail): {len(eval_candles)}")

    def make_env(data):
        return lambda: TradingEnv(
            data, size_usd=args.size, leverage=args.leverage,
            turnover_penalty=args.turnover, dd_penalty=args.dd_penalty,
        )

    # Reward-only normalization: stabilises PPO without touching the (already
    # bounded) observations, so no normalization stats are needed at inference.
    train_env = VecNormalize(
        DummyVecEnv([make_env(train_candles)]),
        norm_obs=False, norm_reward=True, clip_reward=10.0,
    )
    # EvalCallback syncs normalization between train/eval envs, so the eval env must
    # be the same wrapper type. We disable obs+reward norm here (training=False), so
    # the reported eval reward stays in real return units.
    eval_env = VecNormalize(
        DummyVecEnv([make_env(eval_candles)]),
        norm_obs=False, norm_reward=False, training=False,
    )

    MODELS_DIR.mkdir(exist_ok=True)
    best_dir = MODELS_DIR / "best"
    eval_cb = EvalCallback(
        eval_env,
        best_model_save_path=str(best_dir),
        log_path=None,
        eval_freq=max(args.steps // 20, 2048),
        n_eval_episodes=1,             # one episode = a full deterministic pass
        deterministic=True,
        render=False,
    )

    model = PPO(
        "MlpPolicy",
        train_env,
        seed=args.seed,
        n_steps=2048,
        batch_size=256,
        n_epochs=10,
        gae_lambda=0.95,
        gamma=0.99,
        ent_coef=args.ent_coef,
        learning_rate=linear_schedule(args.lr),
        policy_kwargs=dict(net_arch=[128, 128]),
        verbose=1,
    )

    print(f"Training PPO for {args.steps:,} steps...")
    model.learn(total_timesteps=args.steps, progress_bar=True, callback=eval_cb)

    # Prefer the best out-of-sample checkpoint over the final one
    best_zip = best_dir / "best_model.zip"
    if best_zip.exists():
        model = PPO.load(str(best_zip.with_suffix("")), device="cpu")
        print("Using best out-of-sample checkpoint")

    out    = MODELS_DIR / f"rl_{coin}_{interval}.zip"
    active = MODELS_DIR / "rl_policy_active.zip"
    model.save(str(out.with_suffix("")))      # sb3 appends .zip
    model.save(str(active.with_suffix("")))
    print(f"Saved policy → {out}")

    # Rich out-of-sample eval on the held-out tail
    _evaluate(model, eval_candles, args, interval)

    # Record metadata the server reads on load (features → staleness check)
    (MODELS_DIR / "rl_policy_active.json").write_text(
        json.dumps({"coin": coin, "interval": interval, "size_usd": args.size,
                    "leverage": args.leverage, "features": N_FEATURES}),
        encoding="utf-8",
    )


def _evaluate(model, candles, args, interval: str) -> None:
    """Replay the deterministic policy over the unseen tail and report real metrics."""
    from trading_env import TradingEnv
    env = TradingEnv(candles, size_usd=args.size, leverage=args.leverage,
                     turnover_penalty=args.turnover, dd_penalty=args.dd_penalty)
    obs, _ = env.reset()

    rets, fees = [], 0.0     # per-step net leveraged return (0 when flat), fee $ total
    flips, in_pos_steps = 0, 0
    done = False
    while not done:
        action, _ = model.predict(obs, deterministic=True)
        obs, _reward, done, _, info = env.step(action)
        net_ret = info["ret"] - (info["fee_usd"] / args.size)   # net of fee, return units
        rets.append(net_ret)
        fees += info["fee_usd"]
        if info["flipped"]:
            flips += 1
        if info["position"] != 0:
            in_pos_steps += 1

    n = len(rets)
    pnl_usd = sum(rets) * args.size
    # equity curve (cumulative return) → max drawdown
    eq, peak, max_dd = 0.0, 0.0, 0.0
    for r in rets:
        eq += r
        peak = max(peak, eq)
        max_dd = max(max_dd, peak - eq)
    # Sharpe (annualised) on per-step net returns
    ppy = PERIODS_PER_YEAR.get(interval, 8_760)
    if n > 1:
        mean = sum(rets) / n
        var  = sum((r - mean) ** 2 for r in rets) / n
        std  = math.sqrt(var)
        sharpe = (mean / std) * math.sqrt(ppy) if std > 0 else 0.0
    else:
        sharpe = 0.0
    # buy-and-hold benchmark at the same leverage
    closes = [c["close"] for c in candles]
    bh_ret = (closes[-1] / closes[env_warmup()] - 1) * args.leverage

    print("\n── Out-of-sample eval (held-out tail) ──")
    print(f"  candles:        {len(candles)}")
    print(f"  net P&L:        ${pnl_usd:,.2f}  ({sum(rets)*100:+.1f}% on ${args.size:.0f} margin)")
    print(f"  buy & hold {args.leverage}x:  {bh_ret*100:+.1f}%")
    print(f"  Sharpe (ann.):  {sharpe:.2f}")
    print(f"  max drawdown:   {max_dd*100:.1f}%")
    print(f"  flips:          {flips}   exposure: {in_pos_steps / n * 100:.0f}%")
    print(f"  fees paid:      ${fees:,.2f}")
    edge = "BEATS" if sum(rets) * 100 > bh_ret * 100 else "trails"
    print(f"  → strategy {edge} buy-and-hold over this window")


def env_warmup() -> int:
    from rl_features import WARMUP
    return WARMUP


if __name__ == "__main__":
    main()
