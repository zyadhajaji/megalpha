// lib/indicators.ts
// Pure client-side indicator math over Candle[]. Returns lightweight-charts-ready
// point arrays. Each indicator skips its warmup window so the line starts where
// the value is first mathematically defined (no misleading flat lead-in).

import type { Candle } from "@/lib/types";

export interface LinePoint { time: number; value: number; }
export interface HistPoint { time: number; value: number; color: string; }
export interface FibLevel { ratio: number; price: number; label: string; color: string; }

const UP = "rgba(58,170,114,0.55)";
const DOWN = "rgba(170,58,58,0.55)";

// Exponential moving average, seeded with the SMA of the first `period` closes.
export function ema(candles: Candle[], period: number): LinePoint[] {
  if (candles.length < period) return [];
  const k = 2 / (period + 1);
  const out: LinePoint[] = [];
  let seed = 0;
  for (let i = 0; i < period; i++) seed += candles[i].close;
  let prev = seed / period;
  out.push({ time: candles[period - 1].time, value: prev });
  for (let i = period; i < candles.length; i++) {
    prev = candles[i].close * k + prev * (1 - k);
    out.push({ time: candles[i].time, value: prev });
  }
  return out;
}

// Simple moving average.
export function sma(candles: Candle[], period: number): LinePoint[] {
  if (candles.length < period) return [];
  const out: LinePoint[] = [];
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].close;
    if (i >= period) sum -= candles[i - period].close;
    if (i >= period - 1) out.push({ time: candles[i].time, value: sum / period });
  }
  return out;
}

// Wilder's RSI (smoothed).
export function rsi(candles: Candle[], period = 14): LinePoint[] {
  if (candles.length <= period) return [];
  const out: LinePoint[] = [];
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = candles[i].close - candles[i - 1].close;
    if (ch >= 0) gain += ch; else loss -= ch;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  const first = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  out.push({ time: candles[period].time, value: first });
  for (let i = period + 1; i < candles.length; i++) {
    const ch = candles[i].close - candles[i - 1].close;
    const g = ch > 0 ? ch : 0;
    const l = ch < 0 ? -ch : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    const v = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    out.push({ time: candles[i].time, value: v });
  }
  return out;
}

// EMA over a raw numeric sequence; nulls before warmup. Used internally for MACD.
function emaVals(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  let prev = seed / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export interface MacdResult { macd: LinePoint[]; signal: LinePoint[]; hist: HistPoint[]; }

export function macd(candles: Candle[], fast = 12, slow = 26, signalPeriod = 9): MacdResult {
  const closes = candles.map((c) => c.close);
  const fe = emaVals(closes, fast);
  const se = emaVals(closes, slow);
  const macdLine: LinePoint[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (fe[i] != null && se[i] != null) macdLine.push({ time: candles[i].time, value: fe[i]! - se[i]! });
  }
  const sigVals = emaVals(macdLine.map((p) => p.value), signalPeriod);
  const signal: LinePoint[] = [];
  const hist: HistPoint[] = [];
  for (let j = 0; j < macdLine.length; j++) {
    if (sigVals[j] == null) continue;
    signal.push({ time: macdLine[j].time, value: sigVals[j]! });
    const h = macdLine[j].value - sigVals[j]!;
    hist.push({ time: macdLine[j].time, value: h, color: h >= 0 ? UP : DOWN });
  }
  return { macd: macdLine, signal, hist };
}

export interface BollingerResult { upper: LinePoint[]; mid: LinePoint[]; lower: LinePoint[]; }

export function bollinger(candles: Candle[], period = 20, mult = 2): BollingerResult {
  const upper: LinePoint[] = [], mid: LinePoint[] = [], lower: LinePoint[] = [];
  if (candles.length < period) return { upper, mid, lower };
  for (let i = period - 1; i < candles.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += candles[j].close;
    const m = sum / period;
    let v = 0;
    for (let j = i - period + 1; j <= i; j++) { const d = candles[j].close - m; v += d * d; }
    const sd = Math.sqrt(v / period);
    const t = candles[i].time;
    mid.push({ time: t, value: m });
    upper.push({ time: t, value: m + mult * sd });
    lower.push({ time: t, value: m - mult * sd });
  }
  return { upper, mid, lower };
}

// Volume histogram, colored by candle direction. Drops candles without volume.
export function volume(candles: Candle[]): HistPoint[] {
  const out: HistPoint[] = [];
  for (const c of candles) {
    if (c.volume == null) continue;
    out.push({ time: c.time, value: c.volume, color: c.close >= c.open ? UP : DOWN });
  }
  return out;
}

// Fibonacci retracement levels from the high/low of the given candle slice.
// 0% sits at the swing high, 100% at the swing low.
const FIB_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const FIB_COLORS = ["#666", "#cfad4e", "#cf8a4e", "#4e8ecf", "#8a4ecf", "#cf4e8a", "#666"];

export function fib(candles: Candle[]): FibLevel[] {
  if (!candles.length) return [];
  let hi = -Infinity, lo = Infinity;
  for (const c of candles) { if (c.high > hi) hi = c.high; if (c.low < lo) lo = c.low; }
  const range = hi - lo;
  if (range <= 0) return [];
  return FIB_RATIOS.map((r, i) => ({
    ratio: r,
    price: hi - range * r,
    label: `${(r * 100).toFixed(1)}%`,
    color: FIB_COLORS[i],
  }));
}

// ADX — Average Directional Index (Wilder's method).
// Returns per-bar ADX values (0-100). Needs at least 2*period candles to produce values.
export function adx(candles: Candle[], period = 14): LinePoint[] {
  if (candles.length < period * 2 + 1) return [];
  const n = candles.length;

  const trs: number[] = [];
  const plusDMs: number[] = [];
  const minusDMs: number[] = [];

  for (let i = 1; i < n; i++) {
    const high = candles[i].high;
    const low  = candles[i].low;
    const prevHigh  = candles[i - 1].high;
    const prevLow   = candles[i - 1].low;
    const prevClose = candles[i - 1].close;

    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trs.push(tr);

    const upMove   = high - prevHigh;
    const downMove = prevLow - low;
    const plusDM  = (upMove   > downMove && upMove   > 0) ? upMove   : 0;
    const minusDM = (downMove > upMove   && downMove > 0) ? downMove : 0;
    plusDMs.push(plusDM);
    minusDMs.push(minusDM);
  }

  if (trs.length < period) return [];

  let atrW  = trs.slice(0, period).reduce((a, b) => a + b, 0);
  let pdmW  = plusDMs.slice(0, period).reduce((a, b) => a + b, 0);
  let mdmW  = minusDMs.slice(0, period).reduce((a, b) => a + b, 0);

  const dxs: number[] = [];
  const dxTimes: number[] = [];

  const computeDX = (pdm: number, mdm: number, atr: number): number => {
    if (atr <= 0) return 0;
    const pdi = (pdm / atr) * 100;
    const mdi = (mdm / atr) * 100;
    const denom = pdi + mdi;
    return denom > 0 ? (Math.abs(pdi - mdi) / denom) * 100 : 0;
  };

  dxs.push(computeDX(pdmW, mdmW, atrW));
  dxTimes.push(candles[period].time);

  for (let i = period; i < trs.length; i++) {
    atrW = atrW - atrW / period + trs[i];
    pdmW = pdmW - pdmW / period + plusDMs[i];
    mdmW = mdmW - mdmW / period + minusDMs[i];
    dxs.push(computeDX(pdmW, mdmW, atrW));
    dxTimes.push(candles[i + 1].time);
  }

  if (dxs.length < period) return [];

  let adxVal = dxs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const out: LinePoint[] = [];

  for (let j = period; j < dxs.length; j++) {
    adxVal = (adxVal * (period - 1) + dxs[j]) / period;
    out.push({ time: dxTimes[j], value: adxVal });
  }

  return out;
}

// Bollinger Band Width = (upper - lower) / middle * 100.
// Useful for regime detection: low width = ranging, high width = trending.
export function bbWidth(candles: Candle[], period = 20): LinePoint[] {
  if (candles.length < period) return [];
  const out: LinePoint[] = [];
  for (let i = period - 1; i < candles.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += candles[j].close;
    const m = sum / period;
    let v = 0;
    for (let j = i - period + 1; j <= i; j++) { const d = candles[j].close - m; v += d * d; }
    const sd = Math.sqrt(v / period);
    if (m > 0) {
      const upper = m + 2 * sd;
      const lower = m - 2 * sd;
      out.push({ time: candles[i].time, value: (upper - lower) / m * 100 });
    }
  }
  return out;
}

// Named EMA wrappers for chart display convenience.
export function ema21(candles: Candle[]): LinePoint[] { return ema(candles, 21); }
export function ema55(candles: Candle[]): LinePoint[] { return ema(candles, 55); }
export function ema200(candles: Candle[]): LinePoint[] { return ema(candles, 200); }
