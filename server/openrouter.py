"""
MEGALPHA — OpenRouter streaming AI client for the Journal AI Analyst.

Model   : OPENROUTER_MODEL env var (default: openrouter/auto — lets OpenRouter pick the best model per request)
Streaming: yes — async generator yields text chunks
"""
import json
import os
from typing import AsyncGenerator

import httpx

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
OPENROUTER_MODEL   = os.getenv("OPENROUTER_MODEL", "openrouter/auto")
OPENROUTER_URL     = "https://openrouter.ai/api/v1/chat/completions"

_SYSTEM = """\
You are MEGALPHA's AI trading analyst — a sharp, concise quant with deep knowledge
of crypto perpetuals, Hyperliquid, reinforcement-learning trading agents, and risk
management. You have access to live market data shown below.

When the user asks questions:
- Be direct and data-driven. Reference the live numbers when relevant.
- Keep responses concise. This is a terminal-style interface, not a blog.
- If asked about a journal entry, help the user reflect on their trade logic, risk, and lessons.
- Never hallucinate prices or data. Say so if unsure.
"""


async def stream_chat(
    messages: list[dict],
    market_context: str = "",
) -> AsyncGenerator[str, None]:
    """
    Stream an OpenRouter chat completion.

    Args:
        messages: list of {role, content} dicts (full conversation history)
        market_context: injected into the system prompt as live market state

    Yields:
        Text chunks as they arrive from the API.
    """
    if not OPENROUTER_API_KEY:
        yield "[MEGALPHA] OPENROUTER_API_KEY is not set in server/.env — add it to enable the AI analyst."
        return

    system = _SYSTEM
    if market_context:
        system += f"\n\n--- LIVE MARKET CONTEXT ---\n{market_context}\n---"

    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "MEGALPHA",
    }
    payload = {
        "model": OPENROUTER_MODEL,
        "stream": True,
        "messages": [{"role": "system", "content": system}, *messages],
    }

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            async with client.stream(
                "POST", OPENROUTER_URL, json=payload, headers=headers
            ) as resp:
                if resp.status_code != 200:
                    body = await resp.aread()
                    yield f"[ERROR] OpenRouter {resp.status_code}: {body.decode()[:300]}"
                    return
                async for line in resp.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    data = line[6:]
                    if data.strip() == "[DONE]":
                        return
                    try:
                        chunk = json.loads(data)
                        delta = chunk["choices"][0]["delta"].get("content", "")
                        if delta:
                            yield delta
                    except (json.JSONDecodeError, KeyError, IndexError):
                        continue
    except httpx.TimeoutException:
        yield "\n[MEGALPHA] Request timed out — OpenRouter took too long."
    except Exception as exc:
        yield f"\n[MEGALPHA] Unexpected error: {exc}"
