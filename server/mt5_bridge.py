"""
MetaTrader 5 bridge for MEGALPHA.
Connects to the running MT5 terminal on this machine and exposes
account info, positions, and order placement for the demo account.

All methods are synchronous — call them inside asyncio.to_thread() from async code.
The MT5 Python API is Windows-only, which is fine for this setup.
"""
import logging
import os
from datetime import datetime, timedelta
from typing import Optional

import MetaTrader5 as mt5

log = logging.getLogger("megalpha.mt5")

# Default symbol mapping. Override with MT5_SYMBOL_* env vars.
_DEFAULT_SYMBOLS = {
    "BTC": "BTCUSD",
    "ETH": "ETHUSD",
    "SOL": "SOLUSD",
}

MAGIC = 235001  # magic number to tag MEGALPHA trades


class MT5Bridge:
    def __init__(self, login: int, password: str, server: str) -> None:
        self.login = login
        self.password = password
        self.server = server
        self.connected = False

        # Allow broker-specific symbol overrides
        self.symbols = {
            "BTC": os.getenv("MT5_SYMBOL_BTC", _DEFAULT_SYMBOLS["BTC"]),
            "ETH": os.getenv("MT5_SYMBOL_ETH", _DEFAULT_SYMBOLS["ETH"]),
            "SOL": os.getenv("MT5_SYMBOL_SOL", _DEFAULT_SYMBOLS["SOL"]),
        }

        self.connect()

    # ─── connection ────────────────────────────────────────────────────────────

    def connect(self) -> bool:
        if not mt5.initialize(timeout=10000):
            log.error("MT5 initialize() failed: %s", mt5.last_error())
            return False
        if not mt5.login(self.login, self.password, self.server):
            log.error("MT5 login failed: %s", mt5.last_error())
            mt5.shutdown()
            return False
        self.connected = True
        info = mt5.account_info()
        if info:
            log.info(
                "MT5 connected — %s #%d  balance=%.2f %s",
                info.server, info.login, info.balance, info.currency,
            )
        return True

    def _ensure(self) -> bool:
        """Re-connect if the terminal has gone away."""
        if not self.connected:
            return self.connect()
        if mt5.account_info() is None:
            self.connected = False
            return self.connect()
        return True

    def shutdown(self) -> None:
        mt5.shutdown()
        self.connected = False

    # ─── read ──────────────────────────────────────────────────────────────────

    def get_account_info(self) -> dict:
        if not self._ensure():
            return {"connected": False}
        info = mt5.account_info()
        if info is None:
            return {"connected": False}
        return {
            "connected": True,
            "name": info.name,
            "login": int(info.login),
            "server": info.server,
            "balance": info.balance,
            "equity": info.equity,
            "margin": info.margin,
            "free_margin": info.margin_free,
            "margin_level": info.margin_level,
            "profit": info.profit,
            "currency": info.currency,
        }

    def get_positions(self) -> list[dict]:
        if not self._ensure():
            return []
        raw = mt5.positions_get()
        if raw is None:
            return []
        out = []
        for p in raw:
            out.append({
                "ticket": int(p.ticket),
                "symbol": p.symbol,
                "type": "BUY" if p.type == mt5.POSITION_TYPE_BUY else "SELL",
                "volume": p.volume,
                "open_price": p.price_open,
                "current_price": p.price_current,
                "sl": p.sl,
                "tp": p.tp,
                "profit": p.profit,
                "swap": p.swap,
                "comment": p.comment,
                "open_time": int(p.time),
            })
        return out

    def get_history(self, days: int = 7, max_deals: int = 30) -> list[dict]:
        if not self._ensure():
            return []
        from_dt = datetime.now() - timedelta(days=days)
        to_dt = datetime.now()
        history = mt5.history_deals_get(from_dt, to_dt)
        if history is None:
            return []
        out = []
        for h in sorted(history, key=lambda x: x.time, reverse=True)[:max_deals]:
            out.append({
                "ticket": int(h.ticket),
                "order": int(h.order),
                "symbol": h.symbol,
                "type": "BUY" if h.type == mt5.DEAL_TYPE_BUY else "SELL",
                "volume": h.volume,
                "price": h.price,
                "profit": h.profit,
                "commission": h.commission,
                "swap": h.swap,
                "time": int(h.time),
            })
        return out

    # ─── trade ─────────────────────────────────────────────────────────────────

    def market_order(
        self,
        coin: str,
        is_buy: bool,
        volume: float,
        sl: float = 0.0,
        tp: float = 0.0,
        comment: str = "MEGALPHA",
    ) -> dict:
        if not self._ensure():
            return {"ok": False, "error": "MT5 not connected"}

        symbol = self.symbols.get(coin.upper(), coin.upper() + "USD")

        # Activate symbol in Market Watch if needed
        if not mt5.symbol_select(symbol, True):
            return {"ok": False, "error": f"Symbol '{symbol}' not available on this broker"}

        tick = mt5.symbol_info_tick(symbol)
        if tick is None:
            return {"ok": False, "error": f"No tick data for {symbol}"}

        info = mt5.symbol_info(symbol)
        if info is None:
            return {"ok": False, "error": f"No symbol info for {symbol}"}

        order_type = mt5.ORDER_TYPE_BUY if is_buy else mt5.ORDER_TYPE_SELL
        price = tick.ask if is_buy else tick.bid

        # Round volume to broker step
        vol_step = info.volume_step
        volume = round(round(volume / vol_step) * vol_step, 8)
        volume = max(info.volume_min, min(info.volume_max, volume))

        request = {
            "action": mt5.TRADE_ACTION_DEAL,
            "symbol": symbol,
            "volume": volume,
            "type": order_type,
            "price": price,
            "sl": sl,
            "tp": tp,
            "deviation": 30,
            "magic": MAGIC,
            "comment": comment,
            "type_time": mt5.ORDER_TIME_GTC,
            "type_filling": mt5.ORDER_FILLING_IOC,
        }

        result = mt5.order_send(request)
        if result is None:
            return {"ok": False, "error": f"order_send failed: {mt5.last_error()}"}

        if result.retcode != mt5.TRADE_RETCODE_DONE:
            return {
                "ok": False,
                "error": f"MT5 error {result.retcode}: {result.comment}",
                "retcode": result.retcode,
            }

        log.info(
            "MT5 %s %s vol=%.4f @ %.5f  ticket=%d",
            "BUY" if is_buy else "SELL", symbol, result.volume, result.price, result.order,
        )
        return {
            "ok": True,
            "ticket": int(result.order),
            "symbol": symbol,
            "price": result.price,
            "volume": result.volume,
        }

    def close_position(self, ticket: int) -> dict:
        if not self._ensure():
            return {"ok": False, "error": "MT5 not connected"}

        positions = mt5.positions_get(ticket=ticket)
        if not positions:
            return {"ok": False, "error": f"Position #{ticket} not found"}

        pos = positions[0]
        symbol = pos.symbol
        order_type = (
            mt5.ORDER_TYPE_SELL
            if pos.type == mt5.POSITION_TYPE_BUY
            else mt5.ORDER_TYPE_BUY
        )
        tick = mt5.symbol_info_tick(symbol)
        if tick is None:
            return {"ok": False, "error": f"No tick for {symbol}"}
        price = tick.bid if order_type == mt5.ORDER_TYPE_SELL else tick.ask

        request = {
            "action": mt5.TRADE_ACTION_DEAL,
            "symbol": symbol,
            "volume": pos.volume,
            "type": order_type,
            "position": ticket,
            "price": price,
            "deviation": 30,
            "magic": MAGIC,
            "comment": "MEGALPHA close",
            "type_time": mt5.ORDER_TIME_GTC,
            "type_filling": mt5.ORDER_FILLING_IOC,
        }

        result = mt5.order_send(request)
        if result is None:
            return {"ok": False, "error": f"order_send failed: {mt5.last_error()}"}

        if result.retcode != mt5.TRADE_RETCODE_DONE:
            return {
                "ok": False,
                "error": f"MT5 error {result.retcode}: {result.comment}",
            }

        log.info("MT5 closed position #%d @ %.5f", ticket, result.price)
        return {"ok": True, "ticket": ticket, "price": result.price}

    def close_all_positions(self) -> dict:
        positions = self.get_positions()
        results = []
        for p in positions:
            r = self.close_position(p["ticket"])
            results.append({"ticket": p["ticket"], **r})
        return {"ok": True, "closed": len([r for r in results if r.get("ok")]), "results": results}
