"""
Hyperliquid agent-wallet trader.
Uses hyperliquid-python-sdk to sign and submit orders via the HL REST API.
All methods are synchronous — call them inside asyncio.to_thread() from async code.
"""
import logging
from typing import Optional

from eth_account import Account
from hyperliquid.exchange import Exchange
from hyperliquid.info import Info
from hyperliquid.utils import constants

log = logging.getLogger("megalpha.hl_trader")

BASE_URL = constants.MAINNET_API_URL  # "https://api.hyperliquid.xyz"


class HLTrader:
    def __init__(self, private_key: str, vault_address: Optional[str] = None) -> None:
        self.account  = Account.from_key(private_key)
        self.agent_address: str = self.account.address
        # vault_address = your main HL wallet. If not set, the agent IS the account.
        self.address: str = vault_address or self.agent_address
        self.info     = Info(BASE_URL, skip_ws=True)
        self.exchange = Exchange(
            self.account, BASE_URL,
            vault_address=vault_address if vault_address else None,
        )
        log.info(
            "HLTrader ready — agent: %s  account: %s",
            self.agent_address, self.address,
        )

    # ─── read ──────────────────────────────────────────────────────────────────

    def get_account_state(self) -> dict:
        """Returns balance, margin, and all open positions."""
        try:
            state = self.info.user_state(self.address)
            positions = []
            for entry in state.get("assetPositions", []):
                p = entry.get("position", {})
                sz = float(p.get("szi", "0") or "0")
                if sz == 0.0:
                    continue
                lev = p.get("leverage", {})
                positions.append({
                    "coin": p.get("coin", ""),
                    "size": sz,
                    "entry_px": float(p.get("entryPx") or 0),
                    "unrealized_pnl": float(p.get("unrealizedPnl") or 0),
                    "liq_px": p.get("liquidationPx"),
                    "leverage_type": lev.get("type", "cross"),
                    "leverage_value": lev.get("value", 1),
                    "is_long": sz > 0,
                })

            cross = state.get("crossMarginSummary", {})
            return {
                "address": self.address,
                "account_value": float(cross.get("accountValue") or 0),
                "total_margin_used": float(cross.get("totalMarginUsed") or 0),
                "withdrawable": float(state.get("withdrawable") or 0),
                "positions": positions,
            }
        except Exception as exc:
            log.warning("get_account_state: %s", exc)
            return {
                "address": self.address,
                "account_value": 0,
                "total_margin_used": 0,
                "withdrawable": 0,
                "positions": [],
            }

    def get_open_orders(self) -> list:
        try:
            return self.info.open_orders(self.address) or []
        except Exception as exc:
            log.warning("get_open_orders: %s", exc)
            return []

    # ─── trade ─────────────────────────────────────────────────────────────────

    def market_open(
        self,
        coin: str,
        is_buy: bool,
        size_usd: float,
        leverage: int = 5,
        slippage_tolerance_bps: float = 0.0,
    ) -> dict:
        """
        Open a position at market price.
        size_usd = USDC margin to use (server converts to coin qty via leverage).
        slippage_tolerance_bps: if >0 and the fill deviates beyond this, logs a warning.
        """
        try:
            self.exchange.update_leverage(leverage, coin, is_cross=True)

            mids = self.info.all_mids()
            mid = float(mids.get(coin, 0))
            if mid <= 0:
                return {"ok": False, "error": f"No price data for {coin}"}

            sz = round((size_usd * leverage) / mid, 6)
            if sz <= 0:
                return {"ok": False, "error": "Computed size is zero"}

            result = self.exchange.market_open(coin, is_buy, sz)
            log.info(
                "market_open %s %s $%.0f×%dx = %.6f coins  result=%s",
                "LONG" if is_buy else "SHORT", coin, size_usd, leverage, sz, result,
            )

            slippage_warning = None
            if slippage_tolerance_bps > 0:
                try:
                    statuses = result.get("response", {}).get("data", {}).get("statuses", [])
                    if statuses:
                        avg_px = float((statuses[0].get("filled") or {}).get("avgPx", 0))
                        if avg_px > 0:
                            slip_bps = abs(avg_px - mid) / mid * 10_000
                            if slip_bps > slippage_tolerance_bps:
                                log.warning(
                                    "SLIPPAGE EXCEEDED %s: fill=%.4f mid=%.4f slip=%.2fbps (tol=%.2fbps)",
                                    coin, avg_px, mid, slip_bps, slippage_tolerance_bps,
                                )
                                slippage_warning = {
                                    "fill_px": avg_px, "mid_px": mid,
                                    "slippage_bps": round(slip_bps, 2),
                                    "threshold_bps": slippage_tolerance_bps,
                                }
                except Exception:
                    pass

            out = {"ok": True, "coin": coin, "size": sz, "result": result}
            if slippage_warning:
                out["slippage_warning"] = slippage_warning
            return out

        except Exception as exc:
            log.error("market_open error: %s", exc)
            return {"ok": False, "error": str(exc)}

    def limit_open(
        self,
        coin: str,
        is_buy: bool,
        size_usd: float,
        leverage: int,
        limit_px: float,
    ) -> dict:
        """
        Post-only limit order at limit_px (Add Liquidity Only).
        The order is rejected by HL if it would immediately cross the spread.
        """
        try:
            self.exchange.update_leverage(leverage, coin, is_cross=True)

            mids = self.info.all_mids()
            mid = float(mids.get(coin, 0))
            if mid <= 0:
                return {"ok": False, "error": f"No price data for {coin}"}

            sz = round((size_usd * leverage) / mid, 6)
            if sz <= 0:
                return {"ok": False, "error": "Computed size is zero"}

            px = round(limit_px, 6)
            result = self.exchange.order(coin, is_buy, sz, px, {"limit": {"tif": "Alo"}})
            log.info(
                "limit_open (ALO) %s %s $%.0f×%dx @ %.4f = %.6f coins  result=%s",
                "LONG" if is_buy else "SHORT", coin, size_usd, leverage, px, sz, result,
            )
            return {"ok": True, "coin": coin, "size": sz, "price": px, "result": result}

        except Exception as exc:
            log.error("limit_open error: %s", exc)
            return {"ok": False, "error": str(exc)}

    def market_close(self, coin: str) -> dict:
        """Close the full position in coin at market price."""
        try:
            result = self.exchange.market_close(coin)
            log.info("market_close %s  result=%s", coin, result)
            return {"ok": True, "coin": coin, "result": result}
        except Exception as exc:
            log.error("market_close error: %s", exc)
            return {"ok": False, "error": str(exc)}

    def cancel_order(self, coin: str, oid: int) -> dict:
        try:
            result = self.exchange.cancel(coin, oid)
            return {"ok": True, "result": result}
        except Exception as exc:
            log.error("cancel_order error: %s", exc)
            return {"ok": False, "error": str(exc)}

    def cancel_all_orders(self, coin: Optional[str] = None) -> dict:
        """Cancel all open orders, optionally filtered to one coin."""
        try:
            orders = self.get_open_orders()
            if coin:
                orders = [o for o in orders if o.get("coin") == coin]
            results = []
            for o in orders:
                r = self.exchange.cancel(o["coin"], o["oid"])
                results.append(r)
            return {"ok": True, "cancelled": len(results)}
        except Exception as exc:
            log.error("cancel_all_orders error: %s", exc)
            return {"ok": False, "error": str(exc)}
