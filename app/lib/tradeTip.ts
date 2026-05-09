import { Candle } from "./pattern";
import { analyzeDowTheory, DowTheoryResult, SwingPoint } from "./dowTheory";

export type TipSignal     = "BUY" | "NEAR" | "WATCH";
export type TipConfidence = "high" | "medium" | "low";
export type TipDirection  = "long" | "short";

export interface ZoneInfo {
  top: number;
  bottom: number;
  anchorDate: string;
}

export interface TradeTip {
  direction: TipDirection;
  signal: TipSignal;
  confidence: TipConfidence;

  zone: ZoneInfo;

  entry: number;      // zone top (long) | zone bottom (short)
  target: number;     // last wave high (long) | last wave low (short)
  stopLoss: number;
  riskReward: number;

  // positive = approaching zone from outside; negative = inside zone
  distToZonePct: number;
  touchedZone: boolean;
  bouncingFromZone: boolean; // long: bullish candle off zone; short: bearish rejection

  waveHighPrice: number;
  waveLowPrice: number;

  dow: DowTheoryResult;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Scan backwards for the last i where compare(arr[i], arr[i-1]) is true. */
function lastPairIdx<T>(arr: T[], compare: (curr: T, prev: T) => boolean): number {
  for (let i = arr.length - 1; i >= 1; i--) {
    if (compare(arr[i], arr[i - 1])) return i;
  }
  return -1;
}

/**
 * Wave-trough low between two swing-high candle indices.
 * Uses ALL candles in the range — not just the last-5 swing lows from
 * analyzeDowTheory — so the trough is always found even when older than
 * the 5-swing window that Dow Theory analysis keeps.
 */
function waveTroughLow(candles: Candle[], fromIdx: number, toIdx: number): number | null {
  if (toIdx <= fromIdx + 1) return null;
  const slice = candles.slice(fromIdx + 1, toIdx);
  if (!slice.length) return null;
  return Math.min(...slice.map(c => c.l));
}

/**
 * Wave-peak high between two swing-low candle indices (mirror of waveTroughLow).
 */
function wavePeakHigh(candles: Candle[], fromIdx: number, toIdx: number): number | null {
  if (toIdx <= fromIdx + 1) return null;
  const slice = candles.slice(fromIdx + 1, toIdx);
  if (!slice.length) return null;
  return Math.max(...slice.map(c => c.h));
}

// ─── Long tip ─────────────────────────────────────────────────────────────────

/**
 * Demand-zone pullback (long).
 *
 * Wave structure:
 *   prevHH → wave-trough-low → lastHH   (the last confirmed impulse wave up)
 *   Now pulling back from lastHH toward prevHH.
 *
 * Zone:
 *   top    = prevHH  (old resistance → support on pullback)
 *   bottom = minimum candle low between prevHH and lastHH
 *            (the structural trough of the correction wave — the wave start point)
 *
 * Stop = 1% below zone bottom (structural), capped so stop is never more than
 *        3.6% below entry, preserving ≥1:3 R:R for swings ≥10.8%.
 *        Math.max picks the HIGHER price = tighter stop = better R:R.
 *
 * Why cap stop at 3.6%:
 *   Deep wave troughs (10–15% below prevHH) would produce a stop that is so
 *   far away that the R:R drops below 3. A swing trader doesn't hold through a
 *   full wave retracement — they exit if the zone fails to hold.
 */
function tryLong(
  dow: DowTheoryResult,
  sh: SwingPoint[],
  sl: SwingPoint[],
  candles: Candle[]
): TradeTip | null {
  // Gate: need HH+HL wave structure.
  // Relaxed from strict isUptrend so stocks mid-pullback (where a recent LH
  // tips the strict gate) still qualify.
  if (dow.hhCount < 2 || dow.hlCount < 2) return null;
  if (dow.isDowntrend) return null;
  if (sh.length < 3 || sl.length < 2) return null;

  // Last confirmed HH pair — skips LH pivots formed during current pullback
  const lastHHIdx = lastPairIdx(sh, (a, b) => a.price > b.price);
  if (lastHHIdx < 1) return null;

  const lastHH = sh[lastHHIdx];
  const prevHH = sh[lastHHIdx - 1];

  const zoneTop = prevHH.price;

  // Wave trough: minimum candle low in the range between the two HH.
  // Searching all candles (not just sl.slice(-5)) ensures we always find the
  // trough even when it is older than the Dow Theory window.
  const troughLow = waveTroughLow(candles, prevHH.index, lastHH.index);
  const zoneBottom = troughLow !== null ? troughLow : zoneTop * 0.97;

  if (zoneTop <= zoneBottom) return null;

  const entry  = zoneTop;
  const target = lastHH.price;
  if (target <= entry) return null;

  // Practical stop — tighter of structural (1% below zone bottom) vs 3.6% cap
  const stopLoss = Math.max(zoneBottom * 0.99, entry * 0.964);

  const riskReward = +((target - entry) / (entry - stopLoss)).toFixed(2);
  if (riskReward < 3) return null;

  const last = candles[candles.length - 1];
  const price = last.c;

  if (price > lastHH.price * 1.005) return null; // pullback not started yet
  if (price < stopLoss * 0.998)     return null; // stop already breached

  // % above zone top (negative = inside zone)
  const distToZonePct = +((price - zoneTop) / zoneTop * 100).toFixed(2);

  const last3 = candles.slice(-3);
  const touchedZone = last3.some(c => c.l <= zoneTop * 1.01 && c.l >= stopLoss * 0.99);
  const bouncingFromZone =
    touchedZone && last.c > last.o && last.l <= zoneTop * 1.01 && price > stopLoss;

  let signal: TipSignal;
  let confidence: TipConfidence;

  if (bouncingFromZone || (distToZonePct >= -2.0 && distToZonePct <= 2.0)) {
    signal = "BUY";
    confidence = bouncingFromZone && dow.strength !== "weak" ? "high" : "medium";
  } else if (distToZonePct > 2.0 && distToZonePct <= 6.0) {
    signal = "NEAR";
    confidence = "medium";
  } else if (distToZonePct > 6.0 && distToZonePct <= 20.0) {
    signal = "WATCH";
    confidence = "low";
  } else {
    return null;
  }

  return {
    direction: "long",
    signal,
    confidence,
    zone: { top: zoneTop, bottom: zoneBottom, anchorDate: prevHH.date },
    entry,
    target,
    stopLoss,
    riskReward,
    distToZonePct,
    touchedZone,
    bouncingFromZone,
    waveHighPrice: lastHH.price,
    waveLowPrice: zoneBottom,
    dow,
  };
}

// ─── Short tip ────────────────────────────────────────────────────────────────

/**
 * Supply-zone pullback (short) — mirror of the long setup.
 *
 * Wave structure:
 *   prevLL → wave-peak-high → lastLL   (last confirmed impulse wave down)
 *   Now bouncing from lastLL toward prevLL.
 *
 * Zone:
 *   bottom = prevLL  (old support → resistance on bounce)
 *   top    = maximum candle high between prevLL and lastLL
 *            (the peak of the bounce wave — the wave start point)
 *
 * Stop = 1% above zone top (structural), capped at 3.6% above entry.
 *        Math.min picks the LOWER price = tighter stop = better R:R.
 */
function tryShort(
  dow: DowTheoryResult,
  sh: SwingPoint[],
  sl: SwingPoint[],
  candles: Candle[]
): TradeTip | null {
  if (dow.lhCount < 2 || dow.llCount < 2) return null;
  if (dow.isUptrend) return null;
  if (sl.length < 3 || sh.length < 2) return null;

  // Last confirmed LL pair — skips HH pivots formed during current bounce
  const lastLLIdx = lastPairIdx(sl, (a, b) => a.price < b.price);
  if (lastLLIdx < 1) return null;

  const lastLL = sl[lastLLIdx];
  const prevLL = sl[lastLLIdx - 1];

  const zoneBottom = prevLL.price;

  const peakHigh = wavePeakHigh(candles, prevLL.index, lastLL.index);
  const zoneTop = peakHigh !== null ? peakHigh : zoneBottom * 1.03;

  if (zoneTop <= zoneBottom) return null;

  const entry  = zoneBottom; // short when price rallies back to prevLL
  const target = lastLL.price;
  if (target >= entry) return null;

  // Practical stop — tighter of structural (1% above zone top) vs 3.6% cap
  const stopLoss = Math.min(zoneTop * 1.01, entry * 1.036);

  const riskReward = +((entry - target) / (stopLoss - entry)).toFixed(2);
  if (riskReward < 3) return null;

  const last = candles[candles.length - 1];
  const price = last.c;

  if (price < lastLL.price * 0.995) return null; // bounce not started yet
  if (price > stopLoss * 1.002)     return null; // stop already blown

  // % below zone bottom (positive = approaching from below; negative = inside/above zone)
  const distToZonePct = +((zoneBottom - price) / zoneBottom * 100).toFixed(2);

  const last3 = candles.slice(-3);
  const touchedZone = last3.some(c => c.h >= zoneBottom * 0.99 && c.h <= stopLoss * 1.002);
  const bouncingFromZone = // bearish rejection from zone
    touchedZone && last.c < last.o && last.h >= zoneBottom * 0.99 && price < zoneBottom;

  let signal: TipSignal;
  let confidence: TipConfidence;

  if (bouncingFromZone || (distToZonePct >= -2.0 && distToZonePct <= 2.0)) {
    signal = "BUY"; // action-level "at zone" — UI renders as SELL for shorts
    confidence = bouncingFromZone && dow.downStrength !== "weak" ? "high" : "medium";
  } else if (distToZonePct > 2.0 && distToZonePct <= 6.0) {
    signal = "NEAR";
    confidence = "medium";
  } else if (distToZonePct > 6.0 && distToZonePct <= 20.0) {
    signal = "WATCH";
    confidence = "low";
  } else {
    return null;
  }

  return {
    direction: "short",
    signal,
    confidence,
    zone: { top: zoneTop, bottom: zoneBottom, anchorDate: prevLL.date },
    entry,
    target,
    stopLoss,
    riskReward,
    distToZonePct,
    touchedZone,
    bouncingFromZone,
    waveHighPrice: zoneTop,
    waveLowPrice: lastLL.price,
    dow,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Tries long (demand-zone pullback) first; falls back to short (supply-zone
 * bounce) if no long setup qualifies.  Returns null when neither applies.
 * Both directions enforce minimum 1:3 R:R.
 */
export function generateTradeTip(candles: Candle[]): TradeTip | null {
  const dow = analyzeDowTheory(candles);
  const { swingHighs: sh, swingLows: sl } = dow;
  return tryLong(dow, sh, sl, candles) ?? tryShort(dow, sh, sl, candles);
}
