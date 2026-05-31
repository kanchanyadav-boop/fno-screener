import { Candle, TradeTip, DowTheoryResult, SwingPoint } from "./types";
import { analyzeDowTheory } from "./dowTheory";

function lastPairIdx<T>(arr: T[], compare: (curr: T, prev: T) => boolean): number {
  for (let i = arr.length - 1; i >= 1; i--) {
    if (compare(arr[i], arr[i - 1])) return i;
  }
  return -1;
}

function waveTroughLow(candles: Candle[], fromIdx: number, toIdx: number): number | null {
  if (toIdx <= fromIdx + 1) return null;
  const slice = candles.slice(fromIdx + 1, toIdx);
  return slice.length ? Math.min(...slice.map((c) => c.l)) : null;
}

function wavePeakHigh(candles: Candle[], fromIdx: number, toIdx: number): number | null {
  if (toIdx <= fromIdx + 1) return null;
  const slice = candles.slice(fromIdx + 1, toIdx);
  return slice.length ? Math.max(...slice.map((c) => c.h)) : null;
}

function tryLong(dow: DowTheoryResult, sh: SwingPoint[], sl: SwingPoint[], candles: Candle[]): TradeTip | null {
  if (dow.hhCount < 2 || dow.hlCount < 2) return null;
  if (dow.isDowntrend) return null;
  if (sh.length < 3 || sl.length < 2) return null;

  const lastHHIdx = lastPairIdx(sh, (a, b) => a.price > b.price);
  if (lastHHIdx < 1) return null;

  const lastHH = sh[lastHHIdx];
  const prevHH = sh[lastHHIdx - 1];
  const zoneTop = prevHH.price;
  const troughLow = waveTroughLow(candles, prevHH.index, lastHH.index);
  const zoneBottom = troughLow !== null ? troughLow : zoneTop * 0.97;
  if (zoneTop <= zoneBottom) return null;

  const entry = zoneTop;
  const target = lastHH.price;
  if (target <= entry) return null;

  const stopLoss = Math.max(zoneBottom * 0.99, entry * 0.964);
  const riskReward = +((target - entry) / (entry - stopLoss)).toFixed(2);
  if (riskReward < 3) return null;

  const last = candles[candles.length - 1];
  const price = last.c;
  if (price > lastHH.price * 1.005) return null;
  if (price < stopLoss * 0.998)     return null;

  const distToZonePct = +((price - zoneTop) / zoneTop * 100).toFixed(2);
  const last3 = candles.slice(-3);
  const touchedZone = last3.some((c) => c.l <= zoneTop * 1.01 && c.l >= stopLoss * 0.99);
  const bouncingFromZone = touchedZone && last.c > last.o && last.l <= zoneTop * 1.01 && price > stopLoss;

  let signal: TradeTip["signal"];
  let confidence: TradeTip["confidence"];
  if (bouncingFromZone || (distToZonePct >= -2.0 && distToZonePct <= 2.0)) {
    signal = "BUY"; confidence = bouncingFromZone && dow.strength !== "weak" ? "high" : "medium";
  } else if (distToZonePct > 2.0 && distToZonePct <= 6.0) {
    signal = "NEAR"; confidence = "medium";
  } else if (distToZonePct > 6.0 && distToZonePct <= 20.0) {
    signal = "WATCH"; confidence = "low";
  } else return null;

  return {
    direction: "long", signal, confidence,
    zone: { top: zoneTop, bottom: zoneBottom, anchorDate: prevHH.date },
    entry, target, stopLoss, riskReward, distToZonePct, touchedZone, bouncingFromZone,
    waveHighPrice: lastHH.price, waveLowPrice: zoneBottom, dow,
  };
}

function tryShort(dow: DowTheoryResult, sh: SwingPoint[], sl: SwingPoint[], candles: Candle[]): TradeTip | null {
  if (dow.lhCount < 2 || dow.llCount < 2) return null;
  if (dow.isUptrend) return null;
  if (sl.length < 3 || sh.length < 2) return null;

  const lastLLIdx = lastPairIdx(sl, (a, b) => a.price < b.price);
  if (lastLLIdx < 1) return null;

  const lastLL = sl[lastLLIdx];
  const prevLL = sl[lastLLIdx - 1];
  const zoneBottom = prevLL.price;
  const peakHigh = wavePeakHigh(candles, prevLL.index, lastLL.index);
  const zoneTop = peakHigh !== null ? peakHigh : zoneBottom * 1.03;
  if (zoneTop <= zoneBottom) return null;

  const entry = zoneBottom;
  const target = lastLL.price;
  if (target >= entry) return null;

  const stopLoss = Math.min(zoneTop * 1.01, entry * 1.036);
  const riskReward = +((entry - target) / (stopLoss - entry)).toFixed(2);
  if (riskReward < 3) return null;

  const last = candles[candles.length - 1];
  const price = last.c;
  if (price < lastLL.price * 0.995) return null;
  if (price > stopLoss * 1.002)     return null;

  const distToZonePct = +((zoneBottom - price) / zoneBottom * 100).toFixed(2);
  const last3 = candles.slice(-3);
  const touchedZone = last3.some((c) => c.h >= zoneBottom * 0.99 && c.h <= stopLoss * 1.002);
  const bouncingFromZone = touchedZone && last.c < last.o && last.h >= zoneBottom * 0.99 && price < zoneBottom;

  let signal: TradeTip["signal"];
  let confidence: TradeTip["confidence"];
  if (bouncingFromZone || (distToZonePct >= -2.0 && distToZonePct <= 2.0)) {
    signal = "BUY"; confidence = bouncingFromZone && dow.downStrength !== "weak" ? "high" : "medium";
  } else if (distToZonePct > 2.0 && distToZonePct <= 6.0) {
    signal = "NEAR"; confidence = "medium";
  } else if (distToZonePct > 6.0 && distToZonePct <= 20.0) {
    signal = "WATCH"; confidence = "low";
  } else return null;

  return {
    direction: "short", signal, confidence,
    zone: { top: zoneTop, bottom: zoneBottom, anchorDate: prevLL.date },
    entry, target, stopLoss, riskReward, distToZonePct, touchedZone, bouncingFromZone,
    waveHighPrice: zoneTop, waveLowPrice: lastLL.price, dow,
  };
}

export function generateTradeTip(candles: Candle[]): TradeTip | null {
  const dow = analyzeDowTheory(candles);
  const { swingHighs: sh, swingLows: sl } = dow;
  return tryLong(dow, sh, sl, candles) ?? tryShort(dow, sh, sl, candles);
}

export function calcEMA(candles: Candle[], period = 20): { time: number; value: number }[] {
  if (candles.length < period) return [];
  const k = 2 / (period + 1);
  const result: { time: number; value: number }[] = [];
  let ema = candles.slice(0, period).reduce((s, c) => s + c.c, 0) / period;

  candles.forEach((c, i) => {
    if (i < period - 1) return;
    if (i === period - 1) { ema = candles.slice(0, period).reduce((s, x) => s + x.c, 0) / period; }
    else { ema = c.c * k + ema * (1 - k); }
    const ts = Math.floor(new Date(c.date).getTime() / 1000);
    result.push({ time: ts, value: +ema.toFixed(2) });
  });
  return result;
}
