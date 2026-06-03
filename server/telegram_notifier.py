"""Optional Telegram push notifications. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in server/.env."""
import os
import logging
import httpx

log = logging.getLogger("megalpha.telegram")

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID   = os.getenv("TELEGRAM_CHAT_ID", "")
TELEGRAM_URL       = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"

def is_configured() -> bool:
    return bool(TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID)

async def send(text: str) -> None:
    if not is_configured():
        return
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(TELEGRAM_URL, json={"chat_id": TELEGRAM_CHAT_ID, "text": text, "parse_mode": "HTML"})
    except Exception as exc:
        log.warning("Telegram send failed: %s", exc)
