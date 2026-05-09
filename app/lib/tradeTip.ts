import { Candle } from "./pattern";
import { analyzeDowTheory, DowTheoryResult } from "./dowTheory";

export type TipSignal = "BUY" | "NEAR" | "WATCH" | "NONE";
export type TipConfidence = "high" | "medium" | "low";

export interface DemandZoneInfo {
  top: number;
  bottom: number;
  anchorDate: string;
}

export interface TradeTip {
  signal: TipSignal;
  confidence: TipConfidence;

  demandZone: DemandZoneInfo;

  entry: number;
  target: number;
  stopLoss: number;
  riskReward: number;

  distToZonePct: number;
  touchedZone: boolean;
  bouncingFromZone: boolean;

  lastSwingHigh: number;
  secondLastSwingHigh: number;
  lastSwingLow: number;

  dow: DowTheoryResult;
}

/**
 * Demand-zone pullback tip (wave-based swing trade):
 *
 *  Context: uptrend confirmed by HH+HL wave sequence.
 *
 *  Setup:
 *   - Most recent confirmed HH (wave top) is the TARGET.
 *   - Prior HH (one wave back) is the DEMAND ZONE top — old resistance
 *     that flips to support on the pullback.
 *   - The HL that formed between those two HH (the trough of the prior
 *     correction wave) defines the ZONE BOTTOM — the structural low of the
 *     demand area.
 *   - Stop is 1% below zone bottom; entry is at zone top.
 *   - Minimum R:R of 1:3 enforced: (target-entry)/(entry-stop) ≥ 3.
 *
 *  Key design decisions:
 *   - Gate is relaxed from strict isUptrend to hhCount ≥ 2 && hlCount ≥ 2
 *     so stocks mid-pullback (where a recent LH tips isUptrend off) still fire.
 *   - "Last HH" is found by scanning backwards through swingHighs for the
 *     most recent pair where sh[i].price > sh[i-1].price — not just sh[last].
 *     This handles the common case where a LH formed during the current
 *     pullback becomes the most-recent swing high.
 */
export function generateTradeTip(candles: Candle[]): TradeTip | null {
  const dow = analyzeDowTheory(candles);

  // Need underlying wave uptrend structure.
  // Deliberately NOT requiring strict isUptrend: stocks currently pulling back
  // often form a LH that raises lhCount and breaks the strict gate, even though
  // the wave structure is entirely intact.
  if (dow.hhCount < 2 || dow.hlCount < 2) return null;
  if (dow.isDowntrend) return null;

  const sh = dow.swingHighs;
  const sl = dow.swingLows;

  if (sh.length < 3 || sl.length < 2) return null;

  // ── Find the last confirmed HH pair ──────────────────────────────────────
  // Scan backwards: find the highest index i where sh[i].price > sh[i-1].price.
  // This skips any LH pivots that may have formed during the current pullback.
  let lastHHIdx = -1;
  for (let i = sh.length - 1; i >= 1; i--) {
    if (sh[i].price > sh[i - 1].price) {
      lastHHIdx = i;
      break;
    }
  }
  if (lastHHIdx < 1) return null;

  const lastHH = sh[lastHHIdx];      // wave top — target
  const prevHH = sh[lastHHIdx - 1];  // prior HH — demand zone top

  // ── Zone boundaries ───────────────────────────────────────────────────────
  // Zone top = prevHH (old resistance → new support).
  // Zone bottom = the HL that formed between prevHH and lastHH, i.e. the
  // trough of the correction wave that preceded the rally to lastHH.
  // We take the FIRST such HL (earliest in time after prevHH) because that
  // is where the correction wave bottomed — the natural floor of the zone.
  const zoneTop = prevHH.price;

  const hlBetween = sl.find(
    (l) => l.index > prevHH.index && l.index < lastHH.index && l.price < zoneTop
  );
  const zoneBottom = hlBetween ? hlBetween.price : zoneTop * 0.97;

  if (zoneTop <= zoneBottom) return null;

  const entry    = zoneTop;
  const target   = lastHH.price;
  const stopLoss = zoneBottom * 0.99;

  if (stopLoss >= entry || target <= entry) return null;

  // ── Enforce minimum 1:3 R:R ───────────────────────────────────────────────
  const riskReward = +((target - entry) / (entry - stopLoss)).toFixed(2);
  if (riskReward < 3) return null;

  const lastCandle   = candles[candles.length - 1];
  const currentPrice = lastCandle.c;

  // Zone blown — price already broke well below the demand area
  if (currentPrice < zoneBottom * 0.985) return null;

  // Still at the wave top or above it — pullback hasn't started, no setup yet
  if (currentPrice > lastHH.price * 1.005) return null;

  const distToZonePct = +((currentPrice - zoneTop) / zoneTop * 100).toFixed(2);

  const last3 = candles.slice(-3);
  const touchedZone = last3.some(
    (c) => c.l <= zoneTop * 1.01 && c.l >= zoneBottom * 0.97
  );
  const bouncingFromZone =
    touchedZone &&
    lastCandle.c > lastCandle.o &&
    lastCandle.l <= zoneTop * 1.01 &&
    currentPrice > zoneBottom;

  let signal: TipSignal;
  let confidence: TipConfidence;

  if (bouncingFromZone || (distToZonePct >= -1.5 && distToZonePct <= 2.0)) {
    signal = "BUY";
    confidence = bouncingFromZone && dow.strength !== "weak" ? "high" : "medium";
  } else if (distToZonePct > 2.0 && distToZonePct <= 5.0) {
    signal = "NEAR";
    confidence = "medium";
  } else if (distToZonePct > 5.0 && distToZonePct <= 15.0) {
    signal = "WATCH";
    confidence = "low";
  } else {
    return null; // Too far from zone, no actionable setup
  }

  const lastSL = sl[sl.length - 1];

  return {
    signal,
    confidence,
    demandZone: { top: zoneTop, bottom: zoneBottom, anchorDate: prevHH.date },
    entry,
    target,
    stopLoss,
    riskReward,
    distToZonePct,
    touchedZone,
    bouncingFromZone,
    lastSwingHigh: lastHH.price,
    secondLastSwingHigh: prevHH.price,
    lastSwingLow: lastSL.price,
    dow,
  };
}
