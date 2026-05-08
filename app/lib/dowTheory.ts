import { Candle } from "./pattern";

// ─── Chart marker type (works with RawCandle time:number) ──────────────────────
export interface DowRawMarker {
  time: number;
  price: number;
  isHigh: boolean; // true = swing high, false = swing low
  isUp: boolean;   // true = HH or HL (up move), false = LH or LL (down move)
}

/**
 * Detects swing high/low pivot points and labels each as HH/LH or HL/LL.
 * Designed for RawCandle data (time: number) used by lightweight-charts.
 * `limit` controls how many recent markers to return (avoids clutter).
 */
export function findDowMarkers(
  candles: { time: number; h: number; l: number }[],
  lookback = 5,
  limit = 10
): DowRawMarker[] {
  const allHighs: { time: number; price: number }[] = [];
  const allLows: { time: number; price: number }[] = [];

  for (let i = lookback; i < candles.length - lookback; i++) {
    const c = candles[i];
    let isHigh = true;
    let isLow = true;
    for (let j = 1; j <= lookback; j++) {
      if (candles[i - j].h >= c.h || candles[i + j].h >= c.h) isHigh = false;
      if (candles[i - j].l <= c.l || candles[i + j].l <= c.l) isLow = false;
    }
    if (isHigh) allHighs.push({ time: c.time, price: c.h });
    if (isLow) allLows.push({ time: c.time, price: c.l });
  }

  // Take limit+1 so every visible point has a prior to compare against
  const recentH = allHighs.slice(-(limit + 1));
  const recentL = allLows.slice(-(limit + 1));

  const markers: DowRawMarker[] = [];

  for (let i = 1; i < recentH.length; i++) {
    markers.push({
      time: recentH[i].time,
      price: recentH[i].price,
      isHigh: true,
      isUp: recentH[i].price > recentH[i - 1].price,
    });
  }

  for (let i = 1; i < recentL.length; i++) {
    markers.push({
      time: recentL[i].time,
      price: recentL[i].price,
      isHigh: false,
      isUp: recentL[i].price > recentL[i - 1].price,
    });
  }

  return markers.sort((a, b) => a.time - b.time);
}

export interface SwingPoint {
  date: string;
  price: number;
  index: number;
}

export interface DowTheoryResult {
  isUptrend: boolean;
  isDowntrend: boolean;
  swingHighs: SwingPoint[];  // last 5 confirmed swing highs
  swingLows: SwingPoint[];   // last 5 confirmed swing lows
  hhCount: number;           // consecutive HH from most recent backwards
  hlCount: number;           // consecutive HL from most recent backwards
  lhCount: number;           // consecutive LH from most recent backwards
  llCount: number;           // consecutive LL from most recent backwards
  strength: "strong" | "moderate" | "weak" | "none";
  downStrength: "strong" | "moderate" | "weak" | "none";
  score: number;             // 0-10 uptrend score
  downScore: number;         // 0-10 downtrend score
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
    isDowntrend: false,
    swingHighs: [],
    swingLows: [],
    hhCount: 0,
    hlCount: 0,
    lhCount: 0,
    llCount: 0,
    strength: "none",
    downStrength: "none",
    score: 0,
    downScore: 0,
  };

  if (candles.length < lookback * 2 + 3) return none;

  const { highs, lows } = findSwings(candles, lookback);

  if (highs.length < 3 || lows.length < 3) return none;

  const recentH = highs.slice(-5);
  const recentL = lows.slice(-5);

  // Count ALL HH transitions in the recent window (not just consecutive from end).
  // Using total count avoids false negatives from a single pullback/consolidation LH
  // that interrupts an otherwise clear uptrend.
  let hhCount = 0;
  for (let i = 1; i < recentH.length; i++) {
    if (recentH[i].price > recentH[i - 1].price) hhCount++;
  }

  let hlCount = 0;
  for (let i = 1; i < recentL.length; i++) {
    if (recentL[i].price > recentL[i - 1].price) hlCount++;
  }

  let lhCount = 0;
  for (let i = 1; i < recentH.length; i++) {
    if (recentH[i].price < recentH[i - 1].price) lhCount++;
  }

  let llCount = 0;
  for (let i = 1; i < recentL.length; i++) {
    if (recentL[i].price < recentL[i - 1].price) llCount++;
  }

  // Directional gates — prevent detecting topping/bottoming patterns:
  // 1. Overall direction must be up/down across the full recent window.
  // 2. The most recent transition must agree with the claimed direction.
  const overallHighsUp  = recentH.length >= 2 && recentH[recentH.length - 1].price > recentH[0].price;
  const overallLowsUp   = recentL.length >= 2 && recentL[recentL.length - 1].price > recentL[0].price;
  const lastHighIsHH    = recentH.length >= 2 && recentH[recentH.length - 1].price > recentH[recentH.length - 2].price;
  const lastLowIsHL     = recentL.length >= 2 && recentL[recentL.length - 1].price > recentL[recentL.length - 2].price;

  const overallHighsDown = recentH.length >= 2 && recentH[recentH.length - 1].price < recentH[0].price;
  const overallLowsDown  = recentL.length >= 2 && recentL[recentL.length - 1].price < recentL[0].price;
  const lastHighIsLH     = recentH.length >= 2 && recentH[recentH.length - 1].price < recentH[recentH.length - 2].price;
  const lastLowIsLL      = recentL.length >= 2 && recentL[recentL.length - 1].price < recentL[recentL.length - 2].price;

  const isUptrend   = overallHighsUp  && overallLowsUp  && lastHighIsHH && lastLowIsHL && hhCount >= 2 && hlCount >= 2;
  const isDowntrend = overallHighsDown && overallLowsDown && lastHighIsLH && lastLowIsLL && lhCount >= 2 && llCount >= 2;

  let strength: DowTheoryResult["strength"] = "none";
  if (hhCount >= 3 && hlCount >= 3) strength = "strong";
  else if (hhCount >= 2 && hlCount >= 2) strength = "moderate";
  else if (hhCount >= 1 && hlCount >= 1) strength = "weak";

  let downStrength: DowTheoryResult["downStrength"] = "none";
  if (lhCount >= 3 && llCount >= 3) downStrength = "strong";
  else if (lhCount >= 2 && llCount >= 2) downStrength = "moderate";
  else if (lhCount >= 1 && llCount >= 1) downStrength = "weak";

  const score     = Math.min(10, Math.round(((hhCount + hlCount) / 8) * 10));
  const downScore = Math.min(10, Math.round(((lhCount + llCount) / 8) * 10));

  return {
    isUptrend,
    isDowntrend,
    swingHighs: recentH,
    swingLows: recentL,
    hhCount,
    hlCount,
    lhCount,
    llCount,
    strength,
    downStrength,
    score,
    downScore,
  };
}
