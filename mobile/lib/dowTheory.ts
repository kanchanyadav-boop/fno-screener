import { Candle, SwingPoint, DowTheoryResult } from "./types";

function findSwings(candles: Candle[], lookback: number): { highs: SwingPoint[]; lows: SwingPoint[] } {
  const highs: SwingPoint[] = [];
  const lows: SwingPoint[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const c = candles[i];
    let isHigh = true, isLow = true;
    for (let j = 1; j <= lookback; j++) {
      if (candles[i - j].h >= c.h || candles[i + j].h >= c.h) isHigh = false;
      if (candles[i - j].l <= c.l || candles[i + j].l <= c.l) isLow = false;
    }
    if (isHigh) highs.push({ date: c.date, price: c.h, index: i });
    if (isLow)  lows.push({ date: c.date, price: c.l, index: i });
  }
  return { highs, lows };
}

export function analyzeDowTheory(candles: Candle[], lookback = 5): DowTheoryResult {
  const none: DowTheoryResult = {
    isUptrend: false, isDowntrend: false,
    swingHighs: [], swingLows: [],
    hhCount: 0, hlCount: 0, lhCount: 0, llCount: 0,
    strength: "none", downStrength: "none",
    score: 0, downScore: 0,
  };
  if (candles.length < lookback * 2 + 3) return none;
  const { highs, lows } = findSwings(candles, lookback);
  if (highs.length < 3 || lows.length < 3) return none;

  const recentH = highs.slice(-5);
  const recentL = lows.slice(-5);

  let hhCount = 0, lhCount = 0;
  for (let i = 1; i < recentH.length; i++) {
    if (recentH[i].price > recentH[i - 1].price) hhCount++; else lhCount++;
  }
  let hlCount = 0, llCount = 0;
  for (let i = 1; i < recentL.length; i++) {
    if (recentL[i].price > recentL[i - 1].price) hlCount++; else llCount++;
  }

  let hhStreak = 0;
  for (let i = recentH.length - 1; i >= 1; i--) {
    if (recentH[i].price > recentH[i - 1].price) hhStreak++; else break;
  }
  let hlStreak = 0;
  for (let i = recentL.length - 1; i >= 1; i--) {
    if (recentL[i].price > recentL[i - 1].price) hlStreak++; else break;
  }
  let lhStreak = 0;
  for (let i = recentH.length - 1; i >= 1; i--) {
    if (recentH[i].price < recentH[i - 1].price) lhStreak++; else break;
  }
  let llStreak = 0;
  for (let i = recentL.length - 1; i >= 1; i--) {
    if (recentL[i].price < recentL[i - 1].price) llStreak++; else break;
  }

  const overallHighsUp   = recentH[recentH.length - 1].price > recentH[0].price;
  const overallLowsUp    = recentL[recentL.length - 1].price > recentL[0].price;
  const overallHighsDown = recentH[recentH.length - 1].price < recentH[0].price;
  const overallLowsDown  = recentL[recentL.length - 1].price < recentL[0].price;

  const isUptrend   = overallHighsUp  && overallLowsUp   && hhCount > lhCount && hlCount > llCount && hhCount >= 2 && hlCount >= 2;
  const isDowntrend = overallHighsDown && overallLowsDown && lhCount > hhCount && llCount > hlCount && lhCount >= 2 && llCount >= 2;

  let strength: DowTheoryResult["strength"] = "none";
  if (hhStreak >= 2 && hlStreak >= 2)      strength = "strong";
  else if (hhStreak >= 1 && hlStreak >= 1) strength = "moderate";
  else if (hhCount >= 2 && hlCount >= 2)   strength = "weak";

  let downStrength: DowTheoryResult["downStrength"] = "none";
  if (lhStreak >= 2 && llStreak >= 2)      downStrength = "strong";
  else if (lhStreak >= 1 && llStreak >= 1) downStrength = "moderate";
  else if (lhCount >= 2 && llCount >= 2)   downStrength = "weak";

  return {
    isUptrend, isDowntrend,
    swingHighs: recentH, swingLows: recentL,
    hhCount, hlCount, lhCount, llCount,
    strength, downStrength,
    score: Math.min(10, Math.round(((hhCount + hlCount) / 8) * 10)),
    downScore: Math.min(10, Math.round(((lhCount + llCount) / 8) * 10)),
  };
}
