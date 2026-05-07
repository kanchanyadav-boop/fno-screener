export interface Candle {
  date: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface Segment {
  h: number;
  l: number;
  c: number;
  avgVol: number;
  dates: string[];
}

export type PatternType = "breakdown" | "watch" | "uptrend" | "neutral";

export interface PatternResult {
  pattern: PatternType;
  label: string;
  segments: Segment[];
  hh: boolean[];
  hl: boolean[];
  hv: boolean[];        // higher volume on up moves
  breakdown: boolean;
  strongBreakdown: boolean;
  breakdownVolSpike: boolean; // volume spike on breakdown
  score: number;        // out of 9 (6 price + 3 volume)
}

export function detectPattern(candles: Candle[]): PatternResult {
  if (candles.length < 6) throw new Error("Need at least 6 candles");

  const last = candles.slice(-10);
  const segCount = 5;
  const segSize = Math.floor(last.length / segCount);

  const segments: Segment[] = [];
  for (let i = 0; i < segCount; i++) {
    const start = i * segSize;
    const end = i === segCount - 1 ? last.length : (i + 1) * segSize;
    const sl = last.slice(start, end);
    const avgVol = sl.reduce((s, c) => s + (c.v || 0), 0) / sl.length;
    segments.push({
      h: Math.max(...sl.map((c) => c.h)),
      l: Math.min(...sl.map((c) => c.l)),
      c: sl[sl.length - 1].c,
      avgVol,
      dates: sl.map((c) => c.date),
    });
  }

  const [s1, s2, s3, s4, s5] = segments;

  const hh = [s2.h > s1.h, s3.h > s2.h, s4.h > s3.h];
  const hl = [s2.l > s1.l, s3.l > s2.l, s4.l > s3.l];

  // Volume should expand on up moves (confirms bullish momentum)
  const hv = [s2.avgVol > s1.avgVol, s3.avgVol > s2.avgVol, s4.avgVol > s3.avgVol];

  const breakdown = s5.l < s4.l && s5.l < s3.l;
  const strongBreakdown = breakdown && s5.c < s4.l;

  // Volume spike on breakdown = distribution / panic selling = strong signal
  const avgUpVol = (s2.avgVol + s3.avgVol + s4.avgVol) / 3;
  const breakdownVolSpike = breakdown && s5.avgVol > avgUpVol * 1.2;

  const priceScore = [...hh, ...hl].filter(Boolean).length; // 0-6
  const volScore = hv.filter(Boolean).length;               // 0-3
  const score = priceScore + volScore;                      // 0-9

  const isUptrend = priceScore >= 4; // price structure is primary gate

  let pattern: PatternType = "neutral";
  let label = "No Pattern";

  if (isUptrend && strongBreakdown) {
    pattern = "breakdown";
    label = "Breakdown ↓";
  } else if (isUptrend && breakdown) {
    pattern = "watch";
    label = "Breaking Down";
  } else if (isUptrend) {
    pattern = "uptrend";
    label = "Uptrend ↑";
  }

  return { pattern, label, segments, hh, hl, hv, breakdown, strongBreakdown, breakdownVolSpike, score };
}
