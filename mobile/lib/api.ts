import { Platform } from "react-native";
import { Candle } from "./types";

/**
 * Production URL: your Vercel deployment (e.g. https://fno-screener.vercel.app)
 * Set this after deploying with `vercel deploy`.
 */
const VERCEL_URL = "https://fno-screener.vercel.app";

const DEV_URL =
  Platform.OS === "android" ? "http://10.0.2.2:3000" : "http://localhost:3000";

// Use Vercel in production builds, local server in dev
const API_BASE = __DEV__ ? DEV_URL : VERCEL_URL;

export interface QuoteResult {
  symbol: string;
  price: number;
  prevClose: number;
  changePct: number;
  candles: Candle[];
}

export async function fetchCandles(symbol: string): Promise<QuoteResult> {
  const res = await fetch(
    `${API_BASE}/api/quote?symbol=${encodeURIComponent(symbol)}&interval=1d&mode=screen`
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return {
    symbol,
    price: data.price,
    prevClose: data.prevClose,
    changePct: data.changePct ?? 0,
    candles: data.candles as Candle[],
  };
}

export async function fetchPrice(symbol: string): Promise<{ price: number; changePct: number }> {
  const res = await fetch(
    `${API_BASE}/api/quote?symbol=${encodeURIComponent(symbol)}&mode=price`
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return { price: data.price, changePct: data.changePct ?? 0 };
}


export async function fetchPrices(
  symbols: string[]
): Promise<Record<string, { price: number; changePct: number }>> {
  if (!symbols.length) return {};
  const res = await fetch(
    `${API_BASE}/api/prices?symbols=${symbols.map(encodeURIComponent).join(",")}`
  );
  if (!res.ok) return {};
  return res.json();
}
