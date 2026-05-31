export interface Candle {
  date: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface SwingPoint {
  date: string;
  price: number;
  index: number;
}

export interface DowTheoryResult {
  isUptrend: boolean;
  isDowntrend: boolean;
  swingHighs: SwingPoint[];
  swingLows: SwingPoint[];
  hhCount: number;
  hlCount: number;
  lhCount: number;
  llCount: number;
  strength: "strong" | "moderate" | "weak" | "none";
  downStrength: "strong" | "moderate" | "weak" | "none";
  score: number;
  downScore: number;
}

export type TipSignal     = "BUY" | "NEAR" | "WATCH";
export type TipConfidence = "high" | "medium" | "low";
export type TipDirection  = "long" | "short";

export interface ZoneInfo {
  top: number;
  bottom: number;
  anchorDate: string;
}

export interface TradeTip {
  direction: TipDirection;
  signal: TipSignal;
  confidence: TipConfidence;
  zone: ZoneInfo;
  entry: number;
  target: number;
  stopLoss: number;
  riskReward: number;
  distToZonePct: number;
  touchedZone: boolean;
  bouncingFromZone: boolean;
  waveHighPrice: number;
  waveLowPrice: number;
  dow: DowTheoryResult;
}

export interface SavedSetup {
  id: string;
  symbol: string;
  direction: TipDirection;
  entryPrice: number;
  stopLoss: number;
  target: number;
  riskReward: number;
  savedAt: string;
  notes: string;
  status: "active" | "target_hit" | "sl_hit" | "expired";
  lastPrice: number | null;
  lastChecked: string | null;
  currentPnlPct: number | null;
  maxFavorablePct: number;
  maxAdversePct: number;
  exitPrice: number | null;
  exitDate: string | null;
  fromAutoTip: boolean;
  tipSignal?: TipSignal;
  tipConfidence?: TipConfidence;
}
