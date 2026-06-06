"""
CORTISOL — AI Signal Generator
Generates trading signals using OpenRouter LLM with market context.
Falls back gracefully when OPENROUTER_API_KEY is not set.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from typing import Optional

log = logging.getLogger("cortisol.ai_signals")

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "").strip()
OPENROUTER_MODEL   = os.getenv("OPENROUTER_MODEL", "anthropic/claude-haiku-4-5-20251001")
OPENROUTER_URL     = "https://openrouter.ai/api/v1/chat/completions"

_SYSTEM = """\
You are CORTISOL's quantitative signal engine. Given OHLCV candle data, produce a
trading signal in strict JSON format. Analyse price action, momentum, and structure.

Respond ONLY with a JSON object — no prose, no markdown:
{
  "signal": "LONG" | "SHORT" | "HOLD",
  "confidence": <integer 0-100>,
  "reasoning": "<one sentence>",
  "entry": <float>,
  "sl": <float>,
  "tp": <float>,
  "support": <float>,
  "resistance": <float>
}
"""


async def generate_signal(
    coin: str,
    interval: str,
    candles: list[dict],
    context: dict,
) -> Optional[dict]:
    """
    Generate a trading signal for the given coin/interval using the last N candles.
    Returns a signal dict compatible with db.save_signal(), or None on failure.
    """
    if not OPENROUTER_API_KEY:
        log.debug("ai_signals: OPENROUTER_API_KEY not set — signal generation disabled")
        return None

    if not candles:
        return None

    recent = candles[-50:]
    last   = recent[-1]
    closes = [c["close"] for c in recent]

    # Build compact candle summary for the prompt
    summary_rows = []
    for c in recent[-20:]:
        summary_rows.append(
            f"t={c['time']} O={c['open']:.2f} H={c['high']:.2f} "
            f"L={c['low']:.2f} C={c['close']:.2f} V={c.get('volume', 0):.0f}"
        )

    price_now = last["close"]
    prompt = (
        f"Asset: {coin}  Interval: {interval}  Current price: {price_now:.4f}\n"
        f"Last 20 candles (oldest→newest):\n" + "\n".join(summary_rows)
    )

    payload = {
        "model": OPENROUTER_MODEL,
        "max_tokens": 256,
        "messages": [
            {"role": "system", "content": _SYSTEM},
            {"role": "user",   "content": prompt},
        ],
    }
    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "CORTISOL",
    }

    def _call() -> Optional[dict]:
        import urllib.request as _req
        data = json.dumps(payload).encode()
        req  = _req.Request(OPENROUTER_URL, data=data, headers=headers)
        try:
            with _req.urlopen(req, timeout=30) as resp:
                body = json.loads(resp.read())
            content = body["choices"][0]["message"]["content"].strip()
            # strip markdown fences if present
            if content.startswith("```"):
                content = "\n".join(
                    l for l in content.splitlines()
                    if not l.startswith("```")
                ).strip()
            sig = json.loads(content)
            return sig
        except Exception as exc:
            log.debug("ai_signals call failed: %s", exc)
            return None

    try:
        sig = await asyncio.to_thread(_call)
    except Exception as exc:
        log.warning("ai_signals generate_signal error: %s", exc)
        return None

    if not sig:
        return None

    # Normalise and validate
    signal_val = str(sig.get("signal", "HOLD")).upper()
    if signal_val not in ("LONG", "SHORT", "HOLD"):
        signal_val = "HOLD"

    now = int(time.time())
    return {
        "coin":       coin.upper(),
        "interval":   interval,
        "time":       last["time"],
        "signal":     signal_val,
        "confidence": max(0, min(100, int(sig.get("confidence", 50) or 50))),
        "reasoning":  str(sig.get("reasoning", ""))[:500],
        "price":      float(sig.get("entry") or price_now),
        "support":    float(sig.get("support") or 0),
        "resistance": float(sig.get("resistance") or 0),
        "summary":    {
            "entry": sig.get("entry"),
            "sl":    sig.get("sl"),
            "tp":    sig.get("tp"),
        },
        "created_at": now,
    }
