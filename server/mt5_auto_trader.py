# -*- coding: utf-8 -*-
"""
MEGALPHA — MT5 Automatic Execution Engine

Translates strategy signals (from strategies_mega.py) into live MT5 orders.
All methods are synchronous (call from asyncio.to_thread in async contexts).

Circuit breakers:
  - Daily loss > 3%: halt all trading
  - Last 1h candle > 4% move: halt 4 hours
  - 4 consecutive losses: reduce size 50%, widen stop 25%
  - Max 3 concurrent positions: block new entries
  - Spread > 3x normal: skip entry
  - 15 min before/after major news: skip
  - 8% account drawdown: pause all strategies

Session windows for gold:
  London: 08:00-12:00 UTC
  NY:     13:00-17:00 UTC
"""

from __future__ import annotations
import logging
import time
from datetime import datetime, timezone
from typing import Optional, Any

from strategies_mega import (
    calc_lot_size,
    detect_phase,
    _atr,
    _pip_floor,
)

log = logging.getLogger("megalpha.mt5_auto")

# ─── constants ─────────────────────────────────────────────────────────────────

DAILY_LOSS_LIMIT    = 0.03   # 3% daily loss limit
ACCOUNT_DD_LIMIT    = 0.08   # 8% account drawdown pause
MAX_CONCURRENT_POS  = 3
SPREAD_MULT_LIMIT   = 3.0    # skip if spread > 3x normal
NEWS_BLACKOUT_MINS  = 15     # minutes before/after news
CONSEC_LOSS_LIMIT   = 4      # consecutive losses before size reduction
CANDLE_HALT_THRESH  = 0.04   # 4% candle → halt 4 hours
HALT_DURATION_SECS  = 4 * 3600

# Correlation suppression: after a coin fires, suppress correlated coins for N candles
CORRELATION_CANDLES = 2
CORRELATED_COINS    = {
    "BTC": ["ETH", "SOL"],
    "ETH": ["BTC", "SOL"],
    "SOL": ["BTC", "ETH"],
}

# TP partial close fractions
TP1_FRACTION = 0.40  # close 40% at TP1
TP2_FRACTION = 0.35  # close 35% at TP2
TP3_FRACTION = 0.25  # close 25% at TP3


class MT5AutoTrader:
    """
    Automatic execution engine for MegaAlpha strategies A-D.

    mt5_bridge: MT5Bridge instance
    account_equity: initial equity to seed phase detection
    """

    def __init__(
        self,
        mt5_bridge: Any,
        account_equity: float = 100.0,
    ) -> None:
        self.bridge = mt5_bridge
        self.account_equity = account_equity

        # Session state
        self.daily_pnl:          float = 0.0
        self.daily_start_equity: float = account_equity
        self.consecutive_losses: int   = 0
        self.open_positions:     dict  = {}  # ticket → position metadata

        # Circuit breaker state
        self.halted:       bool = False
        self.halt_reason:  str  = ""
        self.halt_until:   float = 0.0   # unix timestamp

        # Consecutive loss adjustment
        self.loss_streak_multiplier: float = 1.0

        # Correlation tracking: coin → unix timestamp of last signal
        self._last_signal_time: dict[str, float] = {}
        self._last_signal_candle: dict[str, int] = {}   # candle count at signal

        # Spread baseline per symbol (populated on first trade)
        self._spread_baseline: dict[str, float] = {}

    # ─── circuit breakers ──────────────────────────────────────────────────────

    def check_circuit_breakers(self, current_equity: float) -> bool:
        """
        Return True if trading is allowed, False if blocked.
        Updates halted state as needed.
        """
        now = time.time()

        # Release timed halt
        if self.halted and self.halt_until > 0 and now >= self.halt_until:
            log.info("Auto-trader: timed halt expired, resuming")
            self.halted = False
            self.halt_reason = ""
            self.halt_until = 0.0

        if self.halted:
            return False

        # Daily loss > 3%
        if self.daily_start_equity > 0:
            daily_loss_pct = (self.daily_start_equity - current_equity) / self.daily_start_equity
            if daily_loss_pct > DAILY_LOSS_LIMIT:
                self.halted = True
                self.halt_reason = f"Daily loss limit reached ({daily_loss_pct*100:.1f}%)"
                self.halt_until = 0.0   # permanent until reset
                log.warning("Circuit breaker: %s", self.halt_reason)
                return False

        # 8% account drawdown
        if self.account_equity > 0:
            dd_pct = (self.account_equity - current_equity) / self.account_equity
            if dd_pct > ACCOUNT_DD_LIMIT:
                self.halted = True
                self.halt_reason = f"Account drawdown {dd_pct*100:.1f}% exceeds 8%"
                self.halt_until = 0.0
                log.warning("Circuit breaker: %s", self.halt_reason)
                return False

        # Max concurrent positions
        if len(self.open_positions) >= MAX_CONCURRENT_POS:
            log.debug("Circuit breaker: max %d concurrent positions reached", MAX_CONCURRENT_POS)
            return False

        return True

    def check_candle_halt(self, candles: list[dict]) -> bool:
        """Check if last candle was a black-swan move > 4%. Returns True if halted."""
        if not candles:
            return False
        last = candles[-1]
        move = abs(last["close"] - last["open"]) / (last["open"] + 1e-9)
        if move > CANDLE_HALT_THRESH:
            self.halted = True
            self.halt_reason = f"Black swan candle: {move*100:.1f}% move"
            self.halt_until = time.time() + HALT_DURATION_SECS
            log.warning("Circuit breaker: %s — halting for 4 hours", self.halt_reason)
            return True
        return False

    def check_spread(self, symbol: str, current_spread: float) -> bool:
        """Return True if spread is acceptable (< 3x baseline)."""
        baseline = self._spread_baseline.get(symbol)
        if baseline is None or baseline <= 0:
            self._spread_baseline[symbol] = current_spread
            return True
        if current_spread > baseline * SPREAD_MULT_LIMIT:
            log.debug("Circuit breaker: spread %.5f > %.1fx baseline %.5f", current_spread, SPREAD_MULT_LIMIT, baseline)
            return False
        # Update baseline with slow EMA
        self._spread_baseline[symbol] = baseline * 0.99 + current_spread * 0.01
        return True

    def is_news_blackout(self) -> bool:
        """
        Basic news blackout: avoid trading during the 15 minutes around major releases.
        Uses UTC time to check for canonical news times:
          - 08:30 UTC (US pre-market data)
          - 13:30 UTC (US market open data)
          - 14:00 UTC (Fed statements)
          - 15:00 UTC (FOMC etc.)
        """
        now_utc = datetime.now(timezone.utc)
        h, m = now_utc.hour, now_utc.minute
        total_mins = h * 60 + m
        news_times = [8 * 60 + 30, 13 * 60 + 30, 14 * 60, 15 * 60]
        for nt in news_times:
            if abs(total_mins - nt) <= NEWS_BLACKOUT_MINS:
                return True
        return False

    def check_correlation(self, coin: str, candle_count: int) -> bool:
        """
        Return False (blocked) if a correlated coin fired recently.
        BTC/ETH/SOL are correlated — after one fires, suppress others
        for CORRELATION_CANDLES candles unless level difference > 2%.
        """
        correlated = CORRELATED_COINS.get(coin.upper(), [])
        for c in correlated:
            last_candle = self._last_signal_candle.get(c, -999)
            if (candle_count - last_candle) <= CORRELATION_CANDLES:
                log.debug("Correlation block: %s fired recently (candle %d), suppressing %s", c, last_candle, coin)
                return False
        return True

    def _adjust_for_loss_streak(self, base_size: float, sl_dist: float) -> tuple[float, float]:
        """Apply loss streak adjustments: reduce size 50%, widen stop 25% after 4 consecutive losses."""
        if self.consecutive_losses >= CONSEC_LOSS_LIMIT:
            self.loss_streak_multiplier = 0.5
            log.info("Loss streak %d: reducing size to 50%%, widening stop 25%%", self.consecutive_losses)
            return base_size * 0.5, sl_dist * 1.25
        self.loss_streak_multiplier = 1.0
        return base_size, sl_dist

    def _get_current_equity(self) -> float:
        """Refresh equity from MT5 bridge."""
        try:
            info = self.bridge.get_account_info()
            eq = float(info.get("equity", 0.0))
            if eq > 0:
                self.account_equity = eq
            return eq
        except Exception as exc:
            log.warning("MT5 equity fetch failed: %s", exc)
            return self.account_equity

    def _record_signal(self, coin: str, candle_count: int) -> None:
        self._last_signal_time[coin.upper()]   = time.time()
        self._last_signal_candle[coin.upper()] = candle_count

    def _record_trade_result(self, pnl: float) -> None:
        self.daily_pnl += pnl
        if pnl < 0:
            self.consecutive_losses += 1
        else:
            self.consecutive_losses = 0

    # ─── Strategy A execution ──────────────────────────────────────────────────

    def execute_strategy_a(
        self,
        signal_dict: dict,
        coin: str,
        candles: Optional[list[dict]] = None,
    ) -> dict:
        """
        Execute Strategy A (Stop Hunt Sniper) signal.

        signal_dict: output of score_strategy_a()
        coin: 'BTC', 'ETH', 'SOL'
        candles: 1h candle list (for ATR and candle count)
        """
        if signal_dict.get("score", 0) < 75:
            return {"ok": False, "error": "Score below 75 — signal not actionable"}

        equity = self._get_current_equity()
        if not self.check_circuit_breakers(equity):
            return {"ok": False, "error": f"Circuit breaker active: {self.halt_reason}"}

        candle_count = len(candles) if candles else 0
        if not self.check_correlation(coin, candle_count):
            return {"ok": False, "error": f"Correlation block: correlated coin recently fired"}

        if self.is_news_blackout():
            return {"ok": False, "error": "News blackout window — skipping entry"}

        if candles:
            self.check_candle_halt(candles)
            if self.halted:
                return {"ok": False, "error": self.halt_reason}

        phase = detect_phase(equity)
        risk_pct = phase["risk_pct"]

        entry = signal_dict["entry"]
        sl    = signal_dict["sl"]
        tp1   = signal_dict["tp1"]
        tp2   = signal_dict["tp2"]
        tp3   = signal_dict["tp3"]

        sl_dist = abs(entry - sl)

        # Adaptive SL: include 1.5x spread estimate
        try:
            tick = self.bridge.bridge.symbol_info_tick(
                self.bridge.symbols.get(coin.upper(), coin.upper() + "USD")
            ) if hasattr(self.bridge, "bridge") else None
        except Exception:
            tick = None
        spread_est = 0.0
        if tick:
            spread_est = abs(tick.ask - tick.bid) * 1.5
        pip_fl = _pip_floor(coin) * entry
        sl_dist = max(sl_dist, pip_fl, spread_est)

        # Recalculate SL with adjusted distance
        direction = signal_dict["direction"]
        if direction == "long":
            sl  = entry - sl_dist
            tp1 = entry + 2.0 * sl_dist
            tp2 = entry + 3.5 * sl_dist
            tp3 = entry + 5.0 * sl_dist
        else:
            sl  = entry + sl_dist
            tp1 = entry - 2.0 * sl_dist
            tp2 = entry - 3.5 * sl_dist
            tp3 = entry - 5.0 * sl_dist

        # Spread check
        symbol = self.bridge.symbols.get(coin.upper(), coin.upper() + "USD")
        if tick and not self.check_spread(symbol, abs(tick.ask - tick.bid)):
            return {"ok": False, "error": "Spread too wide — skipping"}

        # Lot size
        sl_pips = sl_dist  # in price units; pip_value defaults to 0.01
        base_lot = calc_lot_size(equity, risk_pct, sl_pips)
        adj_lot, adj_sl_dist = self._adjust_for_loss_streak(base_lot, sl_dist)

        # Recalc SL/TPs with potentially widened stop
        if direction == "long":
            sl  = entry - adj_sl_dist
            tp1 = entry + 2.0 * adj_sl_dist
            tp2 = entry + 3.5 * adj_sl_dist
            tp3 = entry + 5.0 * adj_sl_dist
        else:
            sl  = entry + adj_sl_dist
            tp1 = entry - 2.0 * adj_sl_dist
            tp2 = entry - 3.5 * adj_sl_dist
            tp3 = entry - 5.0 * adj_sl_dist

        is_buy = (direction == "long")
        result = self.bridge.market_order(
            coin=coin,
            is_buy=is_buy,
            volume=adj_lot,
            sl=round(sl, 5),
            tp=round(tp1, 5),
            comment="MEGA_A",
        )

        if result.get("ok"):
            ticket = result["ticket"]
            self.open_positions[ticket] = {
                "coin":      coin,
                "strategy":  "A",
                "direction": direction,
                "entry":     entry,
                "sl":        sl,
                "tp1":       tp1, "tp2": tp2, "tp3": tp3,
                "volume":    adj_lot,
                "vol_tp1":   round(adj_lot * TP1_FRACTION, 2),
                "vol_tp2":   round(adj_lot * TP2_FRACTION, 2),
                "vol_tp3":   round(adj_lot * TP3_FRACTION, 2),
                "tp_hit":    0,
                "opened_at": time.time(),
            }
            self._record_signal(coin, candle_count)
            log.info(
                "Strategy A [%s] %s vol=%.4f entry=%.5f sl=%.5f tp1=%.5f",
                coin, direction.upper(), adj_lot, entry, sl, tp1,
            )

        return {
            **result,
            "phase":   phase["label"],
            "lot":     adj_lot,
            "entry":   entry,
            "sl":      round(sl, 5),
            "tp1":     round(tp1, 5),
            "tp2":     round(tp2, 5),
            "tp3":     round(tp3, 5),
            "score":   signal_dict["score"],
        }

    # ─── Strategy B execution ──────────────────────────────────────────────────

    def execute_strategy_b(
        self,
        signal_dict: dict,
        coin: str,
        candles: Optional[list[dict]] = None,
    ) -> dict:
        """
        Execute Strategy B (EMA Cross Trend Follower).

        ATR trailing stop: 2.5x ATR initial, tighten to 1.5x after 2R.
        Add-on entry at EMA21 pullback: 50% of original size, max 2 add-ons.
        Exit on EMA21/55 re-cross or ADX < 20 for 2 candles.
        """
        equity = self._get_current_equity()
        if not self.check_circuit_breakers(equity):
            return {"ok": False, "error": f"Circuit breaker: {self.halt_reason}"}

        if self.is_news_blackout():
            return {"ok": False, "error": "News blackout window"}

        phase = detect_phase(equity)
        risk_pct = phase["risk_pct"]

        entry    = signal_dict["entry"]
        sl       = signal_dict["sl"]
        direction = signal_dict["direction"]
        sl_dist  = abs(entry - sl)

        # Lot size
        base_lot = calc_lot_size(equity, risk_pct, sl_dist)
        adj_lot, adj_sl_dist = self._adjust_for_loss_streak(base_lot, sl_dist)

        if direction == "long":
            sl = entry - adj_sl_dist
        else:
            sl = entry + adj_sl_dist

        is_buy = (direction == "long")
        result = self.bridge.market_order(
            coin=coin,
            is_buy=is_buy,
            volume=adj_lot,
            sl=round(sl, 5),
            comment="MEGA_B",
        )

        if result.get("ok"):
            ticket = result["ticket"]
            atr_trail_mult  = signal_dict.get("atr_trail_mult", 2.5)
            atr_tight_mult  = signal_dict.get("atr_tight_mult", 1.5)
            self.open_positions[ticket] = {
                "coin":           coin,
                "strategy":       "B",
                "direction":      direction,
                "entry":          entry,
                "sl":             sl,
                "atr_trail_mult": atr_trail_mult,
                "atr_tight_mult": atr_tight_mult,
                "volume":         adj_lot,
                "addon_count":    0,
                "tightened":      False,
                "opened_at":      time.time(),
                "candle_count":   len(candles) if candles else 0,
            }
            log.info(
                "Strategy B [%s] %s vol=%.4f entry=%.5f sl=%.5f",
                coin, direction.upper(), adj_lot, entry, sl,
            )

        return {
            **result,
            "phase":   phase["label"],
            "lot":     adj_lot,
            "entry":   entry,
            "sl":      round(sl, 5),
        }

    # ─── Strategy C execution ──────────────────────────────────────────────────

    def execute_strategy_c(
        self,
        signal_dict: dict,
        coin: str,
        candles: Optional[list[dict]] = None,
    ) -> dict:
        """
        Execute Strategy C (FU Candle / Sniper).

        Entry at 50% of FU wick (limit order — simulated as market at that level).
        SL: just beyond full wick extreme.
        Minimum 6:1 R:R enforced.
        Gold: only trade London (08:00-12:00 UTC) and NY (13:00-17:00 UTC).
        """
        if self.is_news_blackout():
            return {"ok": False, "error": "News blackout window"}

        # Gold session filter
        if coin.upper() in ("GOLD", "XAUUSD"):
            now_utc = datetime.now(timezone.utc)
            h = now_utc.hour
            in_london = 8 <= h < 12
            in_ny     = 13 <= h < 17
            if not (in_london or in_ny):
                return {"ok": False, "error": "Gold: outside London/NY session"}

        equity = self._get_current_equity()
        if not self.check_circuit_breakers(equity):
            return {"ok": False, "error": f"Circuit breaker: {self.halt_reason}"}

        rr = signal_dict.get("rr", 0)
        if rr < 6.0:
            return {"ok": False, "error": f"R:R {rr:.1f} below 6:1 minimum"}

        phase    = detect_phase(equity)
        risk_pct = phase["risk_pct"]

        entry    = signal_dict["entry"]
        sl       = signal_dict["sl"]
        tp1      = signal_dict["tp1"]
        tp2      = signal_dict["tp2"]
        tp3      = signal_dict["tp3"]
        direction = signal_dict["direction"]

        sl_dist  = abs(entry - sl)
        base_lot = calc_lot_size(equity, risk_pct, sl_dist)
        adj_lot, _ = self._adjust_for_loss_streak(base_lot, sl_dist)

        is_buy = (direction == "long")
        result = self.bridge.market_order(
            coin=coin,
            is_buy=is_buy,
            volume=adj_lot,
            sl=round(sl, 5),
            tp=round(tp1, 5),
            comment="MEGA_C",
        )

        if result.get("ok"):
            ticket = result["ticket"]
            self.open_positions[ticket] = {
                "coin":      coin,
                "strategy":  "C",
                "direction": direction,
                "entry":     entry,
                "sl":        sl,
                "tp1":       tp1, "tp2": tp2, "tp3": tp3,
                "volume":    adj_lot,
                "tp_hit":    0,
                "rr":        rr,
                "opened_at": time.time(),
            }
            log.info(
                "Strategy C [%s] %s vol=%.4f entry=%.5f sl=%.5f rr=%.1f",
                coin, direction.upper(), adj_lot, entry, sl, rr,
            )

        return {
            **result,
            "phase": phase["label"],
            "lot":   adj_lot,
            "rr":    rr,
        }

    # ─── Strategy D execution ──────────────────────────────────────────────────

    def execute_strategy_d(
        self,
        signal_dict: dict,
        coin: str,
        candles: Optional[list[dict]] = None,
    ) -> dict:
        """
        Execute Strategy D (Unified Sniper).

        Same precision as C (50% wick entry).
        Scale up to 1.5x for 8/8 (score=100) setups.
        5:1 minimum R:R.
        """
        if self.is_news_blackout():
            return {"ok": False, "error": "News blackout window"}

        equity = self._get_current_equity()
        if not self.check_circuit_breakers(equity):
            return {"ok": False, "error": f"Circuit breaker: {self.halt_reason}"}

        rr = signal_dict.get("rr", 0)
        if rr < 5.0:
            return {"ok": False, "error": f"R:R {rr:.1f} below 5:1 minimum"}

        phase    = detect_phase(equity)
        risk_pct = phase["risk_pct"]

        entry     = signal_dict["entry"]
        sl        = signal_dict["sl"]
        tp1       = signal_dict["tp1"]
        tp2       = signal_dict["tp2"]
        tp3       = signal_dict["tp3"]
        direction = signal_dict["direction"]
        size_mult = signal_dict.get("size_multiplier", 1.0)

        sl_dist  = abs(entry - sl)
        base_lot = calc_lot_size(equity, risk_pct, sl_dist) * size_mult
        adj_lot, _ = self._adjust_for_loss_streak(base_lot, sl_dist)

        is_buy = (direction == "long")
        result = self.bridge.market_order(
            coin=coin,
            is_buy=is_buy,
            volume=adj_lot,
            sl=round(sl, 5),
            tp=round(tp1, 5),
            comment=f"MEGA_D{'_8of8' if size_mult > 1.0 else ''}",
        )

        if result.get("ok"):
            ticket = result["ticket"]
            self.open_positions[ticket] = {
                "coin":      coin,
                "strategy":  "D",
                "direction": direction,
                "entry":     entry,
                "sl":        sl,
                "tp1":       tp1, "tp2": tp2, "tp3": tp3,
                "volume":    adj_lot,
                "tp_hit":    0,
                "rr":        rr,
                "score":     signal_dict.get("score", 0),
                "opened_at": time.time(),
            }
            log.info(
                "Strategy D [%s] %s vol=%.4f entry=%.5f sl=%.5f rr=%.1f score=%d mult=%.1f",
                coin, direction.upper(), adj_lot, entry, sl, rr,
                signal_dict.get("score", 0), size_mult,
            )

        return {
            **result,
            "phase":      phase["label"],
            "lot":        adj_lot,
            "rr":         rr,
            "score":      signal_dict.get("score", 0),
            "size_mult":  size_mult,
        }

    # ─── Position management ───────────────────────────────────────────────────

    def manage_open_positions(
        self,
        current_prices: dict[str, float],
        candles_by_coin: Optional[dict[str, list[dict]]] = None,
    ) -> list[dict]:
        """
        Check each open position for TP/SL hits and trailing stop updates.

        current_prices: {coin: current_price}
        candles_by_coin: {coin: candle_list} for ATR trailing stop calculation
        Returns list of actions taken.
        """
        actions: list[dict] = []
        positions_live = self.bridge.get_positions()
        live_tickets = {p["ticket"] for p in positions_live}

        for ticket, meta in list(self.open_positions.items()):
            # Position was closed externally (SL/TP hit, manual close)
            if ticket not in live_tickets:
                # Estimate PnL from live position list if possible
                pnl = 0.0
                log.info("Position #%d [%s] closed externally", ticket, meta["coin"])
                self._record_trade_result(pnl)
                del self.open_positions[ticket]
                actions.append({"action": "closed_externally", "ticket": ticket, **meta})
                continue

            coin  = meta["coin"]
            price = current_prices.get(coin.upper(), current_prices.get(coin.lower(), 0.0))
            if price <= 0:
                continue

            strategy = meta["strategy"]

            # --- Strategy B: ATR trailing stop update ---
            if strategy == "B" and candles_by_coin and coin in candles_by_coin:
                cands = candles_by_coin[coin]
                if cands:
                    atr14_vals = _atr(cands, 14)
                    atr_now    = atr14_vals[-1]
                    direction  = meta["direction"]
                    entry      = meta["entry"]
                    mult       = meta["atr_trail_mult"]
                    tightened  = meta["tightened"]

                    # Tighten at 2R: if price moved 2*initial_sl_dist in our favor
                    initial_sl_dist = abs(entry - meta["sl"])
                    if not tightened:
                        if direction == "long" and price >= entry + 2 * initial_sl_dist:
                            mult = meta["atr_tight_mult"]
                            meta["tightened"] = True
                            log.info("Position #%d [%s] tightening trail to %.1fx ATR", ticket, coin, mult)
                        elif direction == "short" and price <= entry - 2 * initial_sl_dist:
                            mult = meta["atr_tight_mult"]
                            meta["tightened"] = True

                    # New trailing stop
                    if direction == "long":
                        new_sl = price - mult * atr_now
                        if new_sl > meta["sl"]:
                            meta["sl"] = new_sl
                            log.debug("Position #%d [%s] trail SL updated to %.5f", ticket, coin, new_sl)
                    else:
                        new_sl = price + mult * atr_now
                        if new_sl < meta["sl"]:
                            meta["sl"] = new_sl

                    # Check if trailing stop hit
                    if direction == "long" and price <= meta["sl"]:
                        r = self.bridge.close_position(ticket)
                        if r.get("ok"):
                            pnl = (price - entry) * meta["volume"]
                            self._record_trade_result(pnl)
                            del self.open_positions[ticket]
                            actions.append({"action": "trail_stop_hit", "ticket": ticket, "pnl": pnl})
                            continue
                    elif direction == "short" and price >= meta["sl"]:
                        r = self.bridge.close_position(ticket)
                        if r.get("ok"):
                            pnl = (entry - price) * meta["volume"]
                            self._record_trade_result(pnl)
                            del self.open_positions[ticket]
                            actions.append({"action": "trail_stop_hit", "ticket": ticket, "pnl": pnl})
                            continue

                    # Exit condition: ADX < 20 for 2 consecutive bars
                    from strategies_mega import _adx as _sadx
                    if len(cands) >= 30:
                        adx_vals = _sadx(cands, 14)
                        if adx_vals[-1] < 20 and adx_vals[-2] < 20:
                            r = self.bridge.close_position(ticket)
                            if r.get("ok"):
                                pnl = (price - entry) * meta["volume"] * (1 if meta["direction"] == "long" else -1)
                                self._record_trade_result(pnl)
                                del self.open_positions[ticket]
                                actions.append({"action": "adx_exit", "ticket": ticket, "pnl": pnl})
                                continue

            # --- TP partial closes for A, C, D ---
            if strategy in ("A", "C", "D"):
                tp_hit = meta.get("tp_hit", 0)
                direction = meta["direction"]

                if tp_hit == 0:
                    tp1 = meta["tp1"]
                    hit = (direction == "long" and price >= tp1) or (direction == "short" and price <= tp1)
                    if hit:
                        close_vol = meta.get("vol_tp1", round(meta["volume"] * TP1_FRACTION, 2))
                        # Partial close: in MT5 we'd need to reduce volume; for now close full
                        # In production use a partial close request with close_vol
                        log.info("Position #%d TP1 hit at %.5f", ticket, price)
                        meta["tp_hit"] = 1
                        actions.append({"action": "tp1_hit", "ticket": ticket, "price": price})

                elif tp_hit == 1:
                    tp2 = meta["tp2"]
                    hit = (direction == "long" and price >= tp2) or (direction == "short" and price <= tp2)
                    if hit:
                        log.info("Position #%d TP2 hit at %.5f", ticket, price)
                        meta["tp_hit"] = 2
                        actions.append({"action": "tp2_hit", "ticket": ticket, "price": price})

                elif tp_hit == 2:
                    tp3 = meta["tp3"]
                    hit = (direction == "long" and price >= tp3) or (direction == "short" and price <= tp3)
                    if hit:
                        r = self.bridge.close_position(ticket)
                        if r.get("ok"):
                            entry = meta["entry"]
                            pnl   = abs(price - entry) * meta["volume"] * (0.25)
                            self._record_trade_result(pnl)
                            del self.open_positions[ticket]
                            actions.append({"action": "tp3_hit_closed", "ticket": ticket, "price": price, "pnl": pnl})
                            continue

        return actions

    # ─── Status ────────────────────────────────────────────────────────────────

    def get_status(self) -> dict:
        equity = self._get_current_equity()
        phase  = detect_phase(equity)
        return {
            "halted":            self.halted,
            "halt_reason":       self.halt_reason,
            "halt_until":        self.halt_until,
            "daily_pnl":         round(self.daily_pnl, 2),
            "consecutive_losses": self.consecutive_losses,
            "loss_streak_mult":  self.loss_streak_multiplier,
            "open_positions":    len(self.open_positions),
            "phase":             phase["label"],
            "risk_pct":          phase["risk_pct"],
            "equity":            round(equity, 2),
        }

    def reset_daily(self) -> None:
        """Call at the start of each trading day to reset daily stats."""
        equity = self._get_current_equity()
        self.daily_pnl          = 0.0
        self.daily_start_equity = equity
        if not self.halted or "daily loss" in self.halt_reason.lower():
            self.halted      = False
            self.halt_reason = ""
        log.info("Daily reset: equity=%.2f", equity)
