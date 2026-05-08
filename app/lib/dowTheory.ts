import { Candle } from "./pattern";

export interface SwingPoint {
  date: string;
  price: number;
  index: number;
}

export interface DowTheoryResult {
  isUptrend: boolean;
  swingHighs: SwingPoint[];  // last 5 confirmed swing highs
  swingLows: SwingPoint[];   // last 5 confirmed swing lows
  hhCount: number;           // consecutive HH from most recent backwards
  hlCount: number;           // consecutive HL from most recent backwards
  strength: "strong" | "moderate" | "weak" | "none";
  score: number;             // 0-10
}

function findSwings(
  candles: Candle[],
  lookback: number
): { highs: SwingPoint[]; lows: SwingPoint[] } {
  const highs: SwingPoint[] = [];
  const lows: SwingPoint[] = [];

  for (let i = lookback; i < candles.length - lookback; i++) {
    const c = candles[i];
    let isHigh = true;
    let isLow = true;

    for (let j = 1; j <= lookback; j++) {
      if (candles[i - j].h >= c.h || candles[i + j].h >= c.h) isHigh = false;
      if (candles[i - j].l <= c.l || candles[i + j].l <= c.l) isLow = false;
    }

    if (isHigh) highs.push({ date: c.date, price: c.h, index: i });
    if (isLow) lows.push({ date: c.date, price: c.l, index: i });
  }

  return { highs, lows };
}

export function analyzeDowTheory(candles: Candle[], lookback = 5): DowTheoryResult {
  const none: DowTheoryResult = {
    isUptrend: false,
    swingHighs: [],
    swingLows: [],
    hhCount: 0,
    hlCount: 0,
    strength: "none",
    score: 0,
  };

  if (candles.length < lookback * 2 + 3) return none;

  const { highs, lows } = findSwings(candles, lookback);

  if (highs.length < 3 || lows.length < 3) return none;

  const recentH = highs.slice(-5);
  const recentL = lows.slice(-5);

  // Count consecutive HH from most recent swing high backwards
  // Stops at first Lower High — Dow Theory requires an unbroken series
  let hhCount = 0;
  for (let i = recentH.length - 1; i >= 1; i--) {
    if (recentH[i].price > recentH[i - 1].price) hhCount++;
    else break;
  }

  // Count consecutive HL from most recent swing low backwards
  let hlCount = 0;
  for (let i = recentL.length - 1; i >= 1; i--) {
    if (recentL[i].price > recentL[i - 1].price) hlCount++;
    else break;
  }

  // Dow Theory confirmed uptrend: at least 2 consecutive HH AND 2 consecutive HL
  const isUptrend = hhCount >= 2 && hlCount >= 2;

  let strength: DowTheoryResult["strength"] = "none";
  if (hhCount >= 3 && hlCount >= 3) strength = "strong";
  else if (hhCount >= 2 && hlCount >= 2) strength = "moderate";
  else if (hhCount >= 1 && hlCount >= 1) strength = "weak";

  // Score: 0–10 based on HH+HL depth (4+4 max = full score)
  const score = Math.min(10, Math.round(((hhCount + hlCount) / 8) * 10));

  return {
    isUptrend,
    swingHighs: recentH,
    swingLows: recentL,
    hhCount,
    hlCount,
    strength,
    score,
  };
}
