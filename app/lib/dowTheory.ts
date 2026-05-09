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
  hhCount: number;           // total HH transitions in recent window (up to 4)
  hlCount: number;           // total HL transitions in recent window (up to 4)
  lhCount: number;           // total LH transitions in recent window (up to 4)
  llCount: number;           // total LL transitions in recent window (up to 4)
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

  // Count ALL HH/HL/LH/LL transitions across the recent window.
  // Total count (not just consecutive from end) avoids missing uptrends where one
  // consolidation swing formed a slightly lower high before resuming.
  let hhCount = 0, lhCount = 0;
  for (let i = 1; i < recentH.length; i++) {
    if (recentH[i].price > recentH[i - 1].price) hhCount++;
    else lhCount++;
  }

  let hlCount = 0, llCount = 0;
  for (let i = 1; i < recentL.length; i++) {
    if (recentL[i].price > recentL[i - 1].price) hlCount++;
    else llCount++;
  }

  // Consecutive streak from most recent (used only for strength label, not detection).
  // Stops at first reversal — reflects how "fresh" the current run is.
  let hhStreak = 0;
  for (let i = recentH.length - 1; i >= 1; i--) {
    if (recentH[i].price > recentH[i - 1].price) hhStreak++;
    else break;
  }
  let hlStreak = 0;
  for (let i = recentL.length - 1; i >= 1; i--) {
    if (recentL[i].price > recentL[i - 1].price) hlStreak++;
    else break;
  }
  let lhStreak = 0;
  for (let i = recentH.length - 1; i >= 1; i--) {
    if (recentH[i].price < recentH[i - 1].price) lhStreak++;
    else break;
  }
  let llStreak = 0;
  for (let i = recentL.length - 1; i >= 1; i--) {
    if (recentL[i].price < recentL[i - 1].price) llStreak++;
    else break;
  }

  // Gate 1 — overall direction: most recent confirmed swing must be higher/lower
  //          than the oldest in the window (net move in claimed direction).
  const overallHighsUp   = recentH[recentH.length - 1].price > recentH[0].price;
  const overallLowsUp    = recentL[recentL.length - 1].price > recentL[0].price;
  const overallHighsDown = recentH[recentH.length - 1].price < recentH[0].price;
  const overallLowsDown  = recentL[recentL.length - 1].price < recentL[0].price;

  // Gate 2 — majority: HH transitions must outnumber LH (and HL must outnumber LL).
  // More robust than requiring the last swing to be in trend direction — handles
  // stocks that paused/consolidated near a high before continuing up.
  const isUptrend   = overallHighsUp  && overallLowsUp
                    && hhCount > lhCount && hlCount > llCount
                    && hhCount >= 2     && hlCount >= 2;

  const isDowntrend = overallHighsDown && overallLowsDown
                    && lhCount > hhCount && llCount > hlCount
                    && lhCount >= 2     && llCount >= 2;

  // Strength uses the consecutive streak from the most recent swing —
  // "strong" means the uptrend is clean right now, not just overall.
  let strength: DowTheoryResult["strength"] = "none";
  if (hhStreak >= 2 && hlStreak >= 2)       strength = "strong";
  else if (hhStreak >= 1 && hlStreak >= 1)  strength = "moderate";
  else if (hhCount >= 2 && hlCount >= 2)    strength = "weak";

  let downStrength: DowTheoryResult["downStrength"] = "none";
  if (lhStreak >= 2 && llStreak >= 2)       downStrength = "strong";
  else if (lhStreak >= 1 && llStreak >= 1)  downStrength = "moderate";
  else if (lhCount >= 2 && llCount >= 2)    downStrength = "weak";

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
