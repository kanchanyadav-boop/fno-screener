import AsyncStorage from "@react-native-async-storage/async-storage";
import { SavedSetup, TipDirection, TipSignal, TipConfidence } from "./types";

const KEY = "fno_setups_v2";
const ALERTED_KEY = "fno_alerted_v1";

export async function loadSetups(): Promise<SavedSetup[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function persist(setups: SavedSetup[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(setups));
}

export async function addSetup(params: {
  symbol: string;
  direction: TipDirection;
  entryPrice: number;
  stopLoss: number;
  target: number;
  notes?: string;
  fromAutoTip?: boolean;
  tipSignal?: TipSignal;
  tipConfidence?: TipConfidence;
}): Promise<SavedSetup> {
  const rr = params.entryPrice > 0 && params.stopLoss > 0 && params.target > 0
    ? Math.abs((params.target - params.entryPrice) / (params.entryPrice - params.stopLoss))
    : 0;

  const setup: SavedSetup = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    symbol: params.symbol,
    direction: params.direction,
    entryPrice: params.entryPrice,
    stopLoss: params.stopLoss,
    target: params.target,
    riskReward: +rr.toFixed(2),
    savedAt: new Date().toISOString(),
    notes: params.notes ?? "",
    status: "active",
    lastPrice: null,
    lastChecked: null,
    currentPnlPct: null,
    maxFavorablePct: 0,
    maxAdversePct: 0,
    exitPrice: null,
    exitDate: null,
    fromAutoTip: params.fromAutoTip ?? false,
    tipSignal: params.tipSignal,
    tipConfidence: params.tipConfidence,
  };

  const setups = await loadSetups();
  setups.unshift(setup); // newest first
  await persist(setups);
  return setup;
}

// ─── Alert de-duplication ─────────────────────────────────────────────────────

export async function getAlertedIds(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(ALERTED_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

export async function markAlerted(id: string): Promise<void> {
  const alerted = await getAlertedIds();
  alerted.add(id);
  await AsyncStorage.setItem(ALERTED_KEY, JSON.stringify([...alerted]));
}

export async function clearAlert(id: string): Promise<void> {
  const alerted = await getAlertedIds();
  alerted.delete(id);
  await AsyncStorage.setItem(ALERTED_KEY, JSON.stringify([...alerted]));
}

// ─────────────────────────────────────────────────────────────────────────────

export async function deleteSetup(id: string): Promise<void> {
  const setups = await loadSetups();
  await persist(setups.filter((s) => s.id !== id));
}

export async function updateSetupPrices(
  prices: Record<string, { price: number; changePct: number }>
): Promise<SavedSetup[]> {
  const setups = await loadSetups();
  const now = new Date().toISOString();
  let changed = false;

  const updated = setups.map((s) => {
    if (s.status !== "active") return s;
    const d = prices[s.symbol];
    if (!d?.price) return s;

    const price = d.price;
    const { direction, entryPrice, stopLoss, target } = s;

    let status = s.status as SavedSetup["status"];
    let exitPrice: number | null = null;
    let exitDate: string | null = null;

    if (direction === "long") {
      if (price >= target)  { status = "target_hit"; exitPrice = price; exitDate = now; }
      else if (price <= stopLoss) { status = "sl_hit"; exitPrice = price; exitDate = now; }
    } else {
      if (price <= target)  { status = "target_hit"; exitPrice = price; exitDate = now; }
      else if (price >= stopLoss) { status = "sl_hit"; exitPrice = price; exitDate = now; }
    }

    // Expire after 30 days
    const daysSaved = (Date.now() - new Date(s.savedAt).getTime()) / 86400000;
    if (status === "active" && daysSaved > 30) status = "expired";

    const pnl = direction === "long"
      ? ((price - entryPrice) / entryPrice) * 100
      : ((entryPrice - price) / entryPrice) * 100;

    const favorable = direction === "long"
      ? Math.max(0, ((price - entryPrice) / entryPrice) * 100)
      : Math.max(0, ((entryPrice - price) / entryPrice) * 100);
    const adverse = direction === "long"
      ? Math.max(0, ((entryPrice - price) / entryPrice) * 100)
      : Math.max(0, ((price - entryPrice) / entryPrice) * 100);

    changed = true;
    return {
      ...s,
      status,
      lastPrice: price,
      lastChecked: now,
      currentPnlPct: +pnl.toFixed(2),
      maxFavorablePct: Math.max(s.maxFavorablePct, +favorable.toFixed(2)),
      maxAdversePct: Math.max(s.maxAdversePct, +adverse.toFixed(2)),
      exitPrice: exitPrice ?? s.exitPrice,
      exitDate: exitDate ?? s.exitDate,
    };
  });

  if (changed) await persist(updated);
  return updated;
}
