"""
Tests for the /candles/{coin} endpoint.
Run from the megalpha root: pytest server/tests/test_candles.py -v
"""
import sys
import os

import pytest
from fastapi.testclient import TestClient

# Add server/ to path so we can import main
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Prevent sniper_signals import from failing (it may not be on the path)
import importlib
import unittest.mock as mock

# Import the FastAPI app
with mock.patch.dict("sys.modules", {"sniper_signals": mock.MagicMock()}):
    import main as server_main

client = TestClient(server_main.app)


def test_health_check():
    """Server is up and returns status ok."""
    resp = client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert "prices" in data
    assert "candle_counts" in data


def test_candles_invalid_coin():
    """Unknown coin returns empty list."""
    resp = client.get("/candles/FAKE?interval=1h&limit=10")
    assert resp.status_code == 200
    assert resp.json() == []


def test_candles_invalid_interval():
    """Unknown interval returns empty list."""
    resp = client.get("/candles/BTC?interval=99x&limit=10")
    assert resp.status_code == 200
    assert resp.json() == []


def test_candles_known_coins():
    """All three coins are accepted."""
    for coin in ["BTC", "ETH", "SOL"]:
        resp = client.get(f"/candles/{coin}?interval=1h&limit=5")
        assert resp.status_code == 200
        # May return fewer if HL is unreachable in test env, but should not error
        data = resp.json()
        assert isinstance(data, list)


def test_candle_shape():
    """Each candle has the required OHLC fields."""
    resp = client.get("/candles/BTC?interval=1d&limit=3")
    assert resp.status_code == 200
    candles = resp.json()
    if len(candles) > 0:
        c = candles[0]
        assert "time" in c
        assert "open" in c
        assert "high" in c
        assert "low" in c
        assert "close" in c
        assert c["high"] >= c["low"]
        assert c["time"] > 0


def test_candles_sorted_ascending():
    """Candles are returned in ascending time order."""
    resp = client.get("/candles/BTC?interval=1d&limit=10")
    assert resp.status_code == 200
    candles = resp.json()
    if len(candles) > 1:
        times = [c["time"] for c in candles]
        assert times == sorted(times), "Candles must be sorted ascending by time"
