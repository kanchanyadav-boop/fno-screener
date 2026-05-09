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

  // Trade levels
  entry: number;
  target: number;
  stopLoss: number;
  riskReward: number;

  // Position relative to zone
  distToZonePct: number;   // % above zone top (negative = inside zone)
  touchedZone: boolean;    // any of last 3 candles touched zone
  bouncingFromZone: boolean;

  // Reference swing prices
  lastSwingHigh: number;
  secondLastSwingHigh: number;
  lastSwingLow: number;

  dow: DowTheoryResult;
}

/**
 * Demand-zone pullback tip:
 *  1. Dow Theory uptrend confirmed (HH + HL sequence on daily).
 *  2. Last confirmed swing high is a fresh HH.
 *  3. Second-to-last swing high (prior HH, now flipped to support) is the demand zone.
 *  4. The swing low that formed between the two most recent swing highs defines the zone bottom.
 *  5. Signal fires when current price is pulling back into / near the demand zone.
 */
export function generateTradeTip(candles: Candle[]): TradeTip | null {
  const dow = analyzeDowTheory(candles);

  if (!dow.isUptrend) return null;

  const sh = dow.swingHighs;
  const sl = dow.swingLows;

  if (sh.length < 2 || sl.length < 1) return null;

  const lastSH       = sh[sh.length - 1];
  const secondLastSH = sh[sh.length - 2];

  // The last swing must be a genuine HH above the prior one
  if (lastSH.price <= secondLastSH.price) return null;

  // Zone bottom = swing low that formed between the two most recent swing highs.
  // This HL anchors the demand zone from below.
  const hlBetween = sl.find(
    (l) => l.index > secondLastSH.index && l.index < lastSH.index
  );
  const lastSL = sl[sl.length - 1];

  const zoneTop    = secondLastSH.price;
  const zoneBottom = hlBetween ? hlBetween.price : zoneTop * 0.97;

  const entry    = zoneTop;
  const target   = lastSH.price;
  const stopLoss = zoneBottom * 0.99;

  const riskReward =
    entry > stopLoss
      ? +((target - entry) / (entry - stopLoss)).toFixed(2)
      : 0;

  const lastCandle  = candles[candles.length - 1];
  const currentPrice = lastCandle.c;

  // If price has already broken well below the zone, the setup has failed
  if (currentPrice < zoneBottom * 0.985) return null;

  // % above zone top (negative means inside or below zone)
  const distToZonePct = +((currentPrice - zoneTop) / zoneTop * 100).toFixed(2);

  // Touch: any of the last 3 candles brought their low into the zone
  const last3 = candles.slice(-3);
  const touchedZone = last3.some(
    (c) => c.l <= zoneTop * 1.01 && c.l >= zoneBottom * 0.97
  );

  // Bounce: touched zone AND last candle is bullish off it
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
    confidence = dow.strength === "strong" ? "medium" : "low";
  } else if (distToZonePct > 5.0 && distToZonePct <= 10.0) {
    signal = "WATCH";
    confidence = "low";
  } else {
    signal = "NONE";
    confidence = "low";
  }

  return {
    signal,
    confidence,
    demandZone: {
      top: zoneTop,
      bottom: zoneBottom,
      anchorDate: secondLastSH.date,
    },
    entry,
    target,
    stopLoss,
    riskReward,
    distToZonePct,
    touchedZone,
    bouncingFromZone,
    lastSwingHigh: lastSH.price,
    secondLastSwingHigh: secondLastSH.price,
    lastSwingLow: lastSL.price,
    dow,
  };
}
