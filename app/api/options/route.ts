import { NextRequest, NextResponse } from "next/server";

export interface StrikeOI {
  strike: number;
  callOI: number;
  putOI: number;
  callOIChange: number;
  putOIChange: number;
  callVolume: number;
  putVolume: number;
  callIV: number;
  putIV: number;
  callLTP: number;
  putLTP: number;
}

export interface OptionsData {
  symbol: string;
  underlyingValue: number;
  expiryDates: string[];   // Unix timestamp strings e.g. "1748995200"
  selectedExpiry: string;  // Unix timestamp string
  strikes: StrikeOI[];
  maxCallOIStrike: number;
  maxPutOIStrike: number;
  maxCallOI: number;
  maxPutOI: number;
  totalCallOI: number;
  totalPutOI: number;
  pcr: number;
  maxPainStrike: number;
}

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json",
  "Accept-Language": "en-US,en;q=0.9",
};

function toYahooSymbol(sym: string): string {
  const s = sym.trim().toUpperCase();
  if (s === "NIFTY50" || s === "NIFTY") return "%5ENSEI";
  if (s === "BANKNIFTY") return "%5ENSEBANK";
  if (s === "FINNIFTY") return "%5ECNXFIN";
  if (s === "MIDCPNIFTY") return "%5ENIFMDCP50";
  return `${s}.NS`;
}

function calcMaxPain(strikes: StrikeOI[]): number {
  if (strikes.length === 0) return 0;
  let minPain = Infinity;
  let maxPainStrike = strikes[0].strike;
  for (const target of strikes) {
    let pain = 0;
    for (const s of strikes) {
      if (s.strike < target.strike) pain += s.callOI * (target.strike - s.strike);
      if (s.strike > target.strike) pain += s.putOI * (s.strike - target.strike);
    }
    if (pain < minPain) { minPain = pain; maxPainStrike = target.strike; }
  }
  return maxPainStrike;
}

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol")?.toUpperCase() || "";
  const expiry = req.nextUrl.searchParams.get("expiry") || ""; // Unix timestamp string

  if (!symbol) return NextResponse.json({ error: "Symbol required" }, { status: 400 });

  try {
    const yahooSym = toYahooSymbol(symbol);
    // Fetch specific expiry if provided, otherwise nearest
    const url = expiry
      ? `https://query1.finance.yahoo.com/v7/finance/options/${yahooSym}?date=${expiry}`
      : `https://query1.finance.yahoo.com/v7/finance/options/${yahooSym}`;

    const res = await fetch(url, { headers: HEADERS, cache: "no-store" });
    if (!res.ok) throw new Error(`Yahoo returned ${res.status} for ${symbol}`);

    const json = await res.json();
    const chain = json?.optionChain?.result?.[0];
    if (!chain) throw new Error("No option chain data from Yahoo Finance");

    const expirationDates: number[] = chain.expirationDates || [];
    if (!expirationDates.length) throw new Error("No expiry dates available");

    const opts = chain.options?.[0];
    if (!opts) throw new Error("No options data in response");

    const selectedExpiryTs: number = opts.expirationDate ?? expirationDates[0];
    const underlyingValue: number = chain.quote?.regularMarketPrice ?? 0;

    // Build strike map from calls and puts
    const strikeMap = new Map<number, StrikeOI>();
    const ensure = (strike: number): StrikeOI => {
      if (!strikeMap.has(strike)) {
        strikeMap.set(strike, {
          strike,
          callOI: 0, putOI: 0,
          callOIChange: 0, putOIChange: 0,
          callVolume: 0, putVolume: 0,
          callIV: 0, putIV: 0,
          callLTP: 0, putLTP: 0,
        });
      }
      return strikeMap.get(strike)!;
    };

    for (const c of opts.calls ?? []) {
      const e = ensure(c.strike);
      e.callOI = c.openInterest ?? 0;
      e.callVolume = c.volume ?? 0;
      e.callIV = c.impliedVolatility ? Math.round(c.impliedVolatility * 100 * 10) / 10 : 0;
      e.callLTP = c.lastPrice ?? 0;
    }
    for (const p of opts.puts ?? []) {
      const e = ensure(p.strike);
      e.putOI = p.openInterest ?? 0;
      e.putVolume = p.volume ?? 0;
      e.putIV = p.impliedVolatility ? Math.round(p.impliedVolatility * 100 * 10) / 10 : 0;
      e.putLTP = p.lastPrice ?? 0;
    }

    const strikes = Array.from(strikeMap.values()).sort((a, b) => a.strike - b.strike);
    if (!strikes.length) throw new Error("No strikes found for this expiry");

    let maxCallOI = 0, maxPutOI = 0, maxCallOIStrike = 0, maxPutOIStrike = 0;
    let totalCallOI = 0, totalPutOI = 0;
    for (const s of strikes) {
      totalCallOI += s.callOI;
      totalPutOI += s.putOI;
      if (s.callOI > maxCallOI) { maxCallOI = s.callOI; maxCallOIStrike = s.strike; }
      if (s.putOI > maxPutOI) { maxPutOI = s.putOI; maxPutOIStrike = s.strike; }
    }

    const data: OptionsData = {
      symbol,
      underlyingValue,
      expiryDates: expirationDates.map(String),
      selectedExpiry: String(selectedExpiryTs),
      strikes,
      maxCallOIStrike,
      maxPutOIStrike,
      maxCallOI,
      maxPutOI,
      totalCallOI,
      totalPutOI,
      pcr: totalCallOI > 0 ? totalPutOI / totalCallOI : 0,
      maxPainStrike: calcMaxPain(strikes),
    };

    return NextResponse.json(data);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
