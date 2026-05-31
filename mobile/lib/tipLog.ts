import AsyncStorage from "@react-native-async-storage/async-storage";
import { TradeTip, TipSignal, TipConfidence, TipDirection, ZoneInfo } from "./types";

const KEY = "fno_tip_log_v1";

export interface TipLogEntry {
  id: string;               // `${symbol}_${zone.anchorDate}_${direction}` — dedup key
  symbol: string;
  direction: TipDirection;
  signal: TipSignal;        // signal at time of logging
  confidence: TipConfidence;
  zone: ZoneInfo;
  entry: number;
  target: number;
  stopLoss: number;
  riskReward: number;
  distToZonePct: number;
  loggedAt: string;         // ISO timestamp of first scan that found this tip
  status: "active" | "success" | "failed" | "expired";
  lastPrice: number | null;
  lastChecked: string | null;
  currentPnlPct: number | null;
  maxFavorablePct: number;
  maxAdversePct: number;
  exitPrice: number | null;
  exitDate: string | null;
}

export async function loadTipLog(): Promise<TipLogEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function persist(entries: TipLogEntry[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(entries));
}

// Log tips from a completed scan — skips already-seen tip zones (same symbol+anchorDate+direction)
export async function logTips(
  tips: { symbol: string; tip: TradeTip }[]
): Promise<number> {
  const existing = await loadTipLog();
  const existingIds = new Set(existing.map((e) => e.id));
  const now = new Date().toISOString();
  let added = 0;

  const newEntries: TipLogEntry[] = [];
  for (const { symbol, tip } of tips) {
    const id = `${symbol}_${tip.zone.anchorDate}_${tip.direction}`;
    if (existingIds.has(id)) continue;

    newEntries.push({
      id,
      symbol,
      direction: tip.direction,
      signal: tip.signal,
      confidence: tip.confidence,
      zone: tip.zone,
      entry: tip.entry,
      target: tip.target,
      stopLoss: tip.stopLoss,
      riskReward: tip.riskReward,
      distToZonePct: tip.distToZonePct,
      loggedAt: now,
      status: "active",
      lastPrice: null,
      lastChecked: null,
      currentPnlPct: null,
      maxFavorablePct: 0,
      maxAdversePct: 0,
      exitPrice: null,
      exitDate: null,
    });
    added++;
  }

  if (added > 0) {
    // Newest first: prepend new entries
    await persist([...newEntries, ...existing]);
  }
  return added;
}

// Update live prices for active entries — detects target hit (success) or SL hit (failed)
export async function updateTipLogPrices(
  prices: Record<string, { price: number; changePct?: number }>
): Promise<TipLogEntry[]> {
  const entries = await loadTipLog();
  const now = new Date().toISOString();
  let changed = false;

  const updated = entries.map((e) => {
    if (e.status !== "active") return e;
    const d = prices[e.symbol];
    if (!d?.price) return e;

    const price = d.price;
    const { direction, entry, stopLoss, target } = e;

    let status = e.status as TipLogEntry["status"];
    let exitPrice: number | null = null;
    let exitDate: string | null = null;

    if (direction === "long") {
      if (price >= target)       { status = "success"; exitPrice = price; exitDate = now; }
      else if (price <= stopLoss){ status = "failed";  exitPrice = price; exitDate = now; }
    } else {
      if (price <= target)       { status = "success"; exitPrice = price; exitDate = now; }
      else if (price >= stopLoss){ status = "failed";  exitPrice = price; exitDate = now; }
    }

    const daysSaved = (Date.now() - new Date(e.loggedAt).getTime()) / 86400000;
    if (status === "active" && daysSaved > 30) status = "expired";

    const pnl = direction === "long"
      ? ((price - entry) / entry) * 100
      : ((entry - price) / entry) * 100;

    const favorable = direction === "long"
      ? Math.max(0, ((price - entry) / entry) * 100)
      : Math.max(0, ((entry - price) / entry) * 100);
    const adverse = direction === "long"
      ? Math.max(0, ((entry - price) / entry) * 100)
      : Math.max(0, ((price - entry) / entry) * 100);

    changed = true;
    return {
      ...e,
      status,
      lastPrice: price,
      lastChecked: now,
      currentPnlPct: +pnl.toFixed(2),
      maxFavorablePct: Math.max(e.maxFavorablePct, +favorable.toFixed(2)),
      maxAdversePct:   Math.max(e.maxAdversePct,   +adverse.toFixed(2)),
      exitPrice:  exitPrice  ?? e.exitPrice,
      exitDate:   exitDate   ?? e.exitDate,
    };
  });

  if (changed) await persist(updated);
  return updated;
}
