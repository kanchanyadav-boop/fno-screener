// ─── Types ────────────────────────────────────────────────────────────────────

export interface Candle {
  time: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface EMAPoint {
  time: number;
  value: number;
}

export interface SRLevel {
  price: number;
  type: "support" | "resistance";
  strength: number; // 1-5 touches
  label: string;
}

export type ManipulationType =
  | "bear_trap"      // Sudden drop below support → fast recovery (long signal)
  | "bull_trap"      // Sudden spike above resistance → fast reversal (short signal)
  | "stop_hunt_low"  // Long wick down, close near open (stop hunt below lows)
  | "stop_hunt_high" // Long wick up, close near open (stop hunt above highs)
  | "fakeout_down"   // Break below S/R then snap back
  | "fakeout_up";    // Break above S/R then snap back

export interface ManipulationEvent {
  time: number;
  type: ManipulationType;
  price: number;       // candle close
  wickExtreme: number; // lowest/highest point of the spike
  label: string;
  description: string;
  severity: "low" | "medium" | "high"; // based on wick size, volume, recovery speed
  recoveryBars: number; // how many bars to recover
  volumeSpike: boolean; // was volume above avg?
}

// ─── EMA ─────────────────────────────────────────────────────────────────────

export function calcEMA(candles: Candle[], period: number): EMAPoint[] {
  if (period < 1 || candles.length < period) return [];
  const k = 2 / (period + 1);
  const result: EMAPoint[] = [];
  let ema = candles.slice(0, period).reduce((s, c) => s + c.c, 0) / period;
  result.push({ time: candles[period - 1].time, value: ema });
  for (let i = period; i < candles.length; i++) {
    ema = candles[i].c * k + ema * (1 - k);
    result.push({ time: candles[i].time, value: ema });
  }
  return result;
}

// ─── Support & Resistance ─────────────────────────────────────────────────────

function isSwingHigh(candles: Candle[], i: number, lookback = 3): boolean {
  if (i < lookback || i >= candles.length - lookback) return false;
  const h = candles[i].h;
  for (let j = i - lookback; j <= i + lookback; j++) {
    if (j !== i && candles[j].h >= h) return false;
  }
  return true;
}

function isSwingLow(candles: Candle[], i: number, lookback = 3): boolean {
  if (i < lookback || i >= candles.length - lookback) return false;
  const l = candles[i].l;
  for (let j = i - lookback; j <= i + lookback; j++) {
    if (j !== i && candles[j].l <= l) return false;
  }
  return true;
}

export function calcSRLevels(candles: Candle[], maxLevels = 5): SRLevel[] {
  if (candles.length < 10) return [];

  const lookback = 3;
  const tolerance = 0.004; // 0.4% clustering tolerance
  const recent = candles.slice(-Math.min(candles.length, 60));

  // Find all swing highs and lows
  const highs: number[] = [];
  const lows: number[] = [];

  for (let i = 0; i < recent.length; i++) {
    if (isSwingHigh(recent, i, lookback)) highs.push(recent[i].h);
    if (isSwingLow(recent, i, lookback)) lows.push(recent[i].l);
  }

  // Cluster nearby levels
  const cluster = (prices: number[]): { price: number; count: number }[] => {
    const clusters: { price: number; count: number; sum: number }[] = [];
    for (const p of prices) {
      if (p <= 0) continue;
      const existing = clusters.find(c => Math.abs(c.price - p) / p < tolerance);
      if (existing) { existing.sum += p; existing.count++; existing.price = existing.sum / existing.count; }
      else clusters.push({ price: p, count: 1, sum: p });
    }
    return clusters.sort((a, b) => b.count - a.count);
  };

  const resClusters = cluster(highs);
  const supClusters = cluster(lows);

  const lastClose = candles[candles.length - 1].c;

  const levels: SRLevel[] = [];

  // Add resistance levels (above price)
  resClusters
    .filter(c => c.price > lastClose * 1.001)
    .slice(0, maxLevels)
    .forEach(c => levels.push({
      price: Math.round(c.price * 20) / 20, // round to nearest 0.05
      type: "resistance",
      strength: Math.min(5, c.count),
      label: `R${levels.filter(l => l.type === "resistance").length + 1}`,
    }));

  // Add support levels (below price)
  supClusters
    .filter(c => c.price < lastClose * 0.999)
    .slice(0, maxLevels)
    .forEach(c => levels.push({
      price: Math.round(c.price * 20) / 20,
      type: "support",
      strength: Math.min(5, c.count),
      label: `S${levels.filter(l => l.type === "support").length + 1}`,
    }));

  // Sort by closeness to price
  return levels.sort((a, b) => Math.abs(a.price - lastClose) - Math.abs(b.price - lastClose));
}

// ─── Manipulation Detection ───────────────────────────────────────────────────

function avgVolume(candles: Candle[], endIdx: number, period = 20): number {
  const from = Math.max(0, endIdx - period);
  const slice = candles.slice(from, endIdx);
  if (!slice.length) return 1;
  return slice.reduce((s, c) => s + c.v, 0) / slice.length;
}

export function detectManipulation(candles: Candle[]): ManipulationEvent[] {
  const events: ManipulationEvent[] = [];
  if (candles.length < 10) return events;

  for (let i = 5; i < candles.length - 1; i++) {
    const c = candles[i];
    const body = Math.abs(c.c - c.o);
    const totalRange = c.h - c.l;
    const lowerWick = Math.min(c.o, c.c) - c.l;
    const upperWick = c.h - Math.max(c.o, c.c);
    const avgVol = avgVolume(candles, i);
    const volSpike = c.v > avgVol * 1.5;

    if (totalRange === 0) continue;

    // ── Bear Trap / Stop Hunt Low ──────────────────────────────────────────
    // Criteria: long lower wick (>50% of range), body is small, close near top
    const lowerWickDominant = lowerWick > totalRange * 0.55 && lowerWick > body * 2;

    if (lowerWickDominant) {
      // Check if this broke below recent lows (last 5 candles) then recovered
      const recentLow = Math.min(...candles.slice(i - 5, i).map(x => x.l));
      const brokeBelow = c.l < recentLow * 0.9985; // broke at least 0.15% below

      // Check next 1-3 candles recover above open
      let recoveryBars = 0;
      for (let k = 1; k <= Math.min(3, candles.length - i - 1); k++) {
        if (candles[i + k].c > c.o) { recoveryBars = k; break; }
      }

      const wickPct = lowerWick / totalRange;
      const severity: ManipulationEvent["severity"] =
        wickPct > 0.75 && brokeBelow && volSpike ? "high"
        : wickPct > 0.6 && (brokeBelow || recoveryBars > 0) ? "medium"
        : "low";

      if (severity !== "low" || (lowerWickDominant && brokeBelow)) {
        const type: ManipulationType = brokeBelow ? "bear_trap" : "stop_hunt_low";
        events.push({
          time: c.time,
          type,
          price: c.c,
          wickExtreme: c.l,
          severity,
          recoveryBars,
          volumeSpike: volSpike,
          label: type === "bear_trap" ? "🐻 Bear Trap" : "🎯 Stop Hunt Low",
          description: brokeBelow
            ? `Price broke below recent low (₹${recentLow.toFixed(2)}), wick=${(lowerWick / c.c * 100).toFixed(1)}%${volSpike ? ", vol spike" : ""}`
            : `Long lower wick (${(wickPct * 100).toFixed(0)}% of range), likely stop hunt below lows`,
        });
      }
    }

    // ── Bull Trap / Stop Hunt High ─────────────────────────────────────────
    // Criteria: long upper wick (>50%), body small, close near bottom
    const upperWickDominant = upperWick > totalRange * 0.55 && upperWick > body * 2;

    if (upperWickDominant) {
      const recentHigh = Math.max(...candles.slice(i - 5, i).map(x => x.h));
      const brokeAbove = c.h > recentHigh * 1.0015;

      let recoveryBars = 0;
      for (let k = 1; k <= Math.min(3, candles.length - i - 1); k++) {
        if (candles[i + k].c < c.o) { recoveryBars = k; break; }
      }

      const wickPct = upperWick / totalRange;
      const severity: ManipulationEvent["severity"] =
        wickPct > 0.75 && brokeAbove && volSpike ? "high"
        : wickPct > 0.6 && (brokeAbove || recoveryBars > 0) ? "medium"
        : "low";

      if (severity !== "low" || (upperWickDominant && brokeAbove)) {
        const type: ManipulationType = brokeAbove ? "bull_trap" : "stop_hunt_high";
        events.push({
          time: c.time,
          type,
          price: c.c,
          wickExtreme: c.h,
          severity,
          recoveryBars,
          volumeSpike: volSpike,
          label: type === "bull_trap" ? "🐂 Bull Trap" : "🎯 Stop Hunt High",
          description: brokeAbove
            ? `Price broke above recent high (₹${recentHigh.toFixed(2)}), wick=${(upperWick / c.c * 100).toFixed(1)}%${volSpike ? ", vol spike" : ""}`
            : `Long upper wick (${(wickPct * 100).toFixed(0)}% of range), likely stop hunt above highs`,
        });
      }
    }

    // ── Fakeout — break and snap back (2-bar pattern) ──────────────────────
    if (i >= 2) {
      const prev = candles[i - 1];
      const prev2 = candles[i - 2];

      // Fakeout down: prev bar broke below prev2 low, current bar closes back above prev2 low
      const prev2Low = prev2.l;
      const fakeoutDown = prev.l < prev2Low && c.c > prev2Low && c.c > c.o;
      if (fakeoutDown && Math.abs(prev.c - prev.o) / (prev.h - prev.l || 1) < 0.4) {
        events.push({
          time: c.time,
          type: "fakeout_down",
          price: c.c,
          wickExtreme: prev.l,
          severity: volSpike ? "high" : "medium",
          recoveryBars: 1,
          volumeSpike: volSpike,
          label: "⚡ Fakeout Down",
          description: `Fakeout: broke below ₹${prev2Low.toFixed(2)}, recovered in 1 bar. Entry: current bar close`,
        });
      }

      // Fakeout up: prev broke above prev2 high, current closes back below prev2 high
      const prev2High = prev2.h;
      const fakeoutUp = prev.h > prev2High && c.c < prev2High && c.c < c.o;
      if (fakeoutUp && Math.abs(prev.c - prev.o) / (prev.h - prev.l || 1) < 0.4) {
        events.push({
          time: c.time,
          type: "fakeout_up",
          price: c.c,
          wickExtreme: prev.h,
          severity: volSpike ? "high" : "medium",
          recoveryBars: 1,
          volumeSpike: volSpike,
          label: "⚡ Fakeout Up",
          description: `Fakeout: broke above ₹${prev2High.toFixed(2)}, reversed in 1 bar. Entry: current bar close`,
        });
      }
    }
  }

  // Deduplicate — keep highest severity if same candle appears multiple times
  const seen = new Map<number, ManipulationEvent>();
  for (const e of events) {
    const existing = seen.get(e.time);
    if (!existing || severityRank(e.severity) > severityRank(existing.severity)) {
      seen.set(e.time, e);
    }
  }

  return Array.from(seen.values()).sort((a, b) => a.time - b.time);
}

function severityRank(s: ManipulationEvent["severity"]): number {
  return s === "high" ? 3 : s === "medium" ? 2 : 1;
}

// ─── Supply & Demand Zones ─────────────────────────────────────────────────────

export interface SDZone {
  top: number;
  bottom: number;
  type: "supply" | "demand";
  strength: number; // 1–3 based on explosion candle size relative to ATR
  startTime: number;
  fresh: boolean; // price has not re-entered the zone since formation
}

export function calcSDZones(candles: Candle[], maxZones = 3): SDZone[] {
  if (candles.length < 10) return [];

  const recent = candles.slice(-Math.min(candles.length, 100));
  const lastClose = recent[recent.length - 1].c;
  const atr = recent.slice(-14).reduce((s, c) => s + (c.h - c.l), 0) / Math.min(14, recent.length);
  if (atr === 0) return [];

  type Raw = SDZone & { dist: number };
  const rawZones: Raw[] = [];

  for (let i = 0; i < recent.length - 1; i++) {
    const base = recent[i];
    const exp = recent[i + 1];
    const expBody = Math.abs(exp.c - exp.o);
    const baseBody = Math.abs(base.c - base.o);

    // Explosion candle must be large; base candle must be smaller
    if (expBody < atr * 0.75) continue;
    if (baseBody >= expBody * 0.75) continue;

    const top = base.h;
    const bottom = base.l;
    if (top - bottom < atr * 0.1) continue;

    const isBull = exp.c > exp.o;
    const strength: 1 | 2 | 3 = expBody > atr * 2 ? 3 : expBody > atr * 1.3 ? 2 : 1;
    const later = recent.slice(i + 2);

    if (isBull && top < lastClose) {
      // Demand zone (Drop-Base-Rally): below current price
      const fresh = !later.some(c => c.l < bottom);
      rawZones.push({ top, bottom, type: "demand", strength, startTime: base.time, fresh, dist: lastClose - (top + bottom) / 2 });
    } else if (!isBull && bottom > lastClose) {
      // Supply zone (Rally-Base-Drop): above current price
      const fresh = !later.some(c => c.h > top);
      rawZones.push({ top, bottom, type: "supply", strength, startTime: base.time, fresh, dist: (top + bottom) / 2 - lastClose });
    }
  }

  const pick = (type: SDZone["type"]) =>
    rawZones.filter(z => z.type === type).sort((a, b) => a.dist - b.dist).slice(0, maxZones);

  return [...pick("supply"), ...pick("demand")].map(({ dist, ...z }) => z);
}
