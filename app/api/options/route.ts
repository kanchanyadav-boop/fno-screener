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
  expiryDates: string[];
  selectedExpiry: string;
  strikes: StrikeOI[];
  maxCallOIStrike: number;
  maxPutOIStrike: number;
  maxCallOI: number;
  maxPutOI: number;
  totalCallOI: number;
  totalPutOI: number;
  pcr: number; // Put-Call Ratio
  maxPainStrike: number;
}

const NSE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  Connection: "keep-alive",
  Referer: "https://www.nseindia.com/option-chain",
  "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
};

async function getNSECookie(): Promise<string> {
  // Step 1: hit main site to get initial cookies
  const r1 = await fetch("https://www.nseindia.com", {
    headers: {
      "User-Agent": NSE_HEADERS["User-Agent"],
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
    cache: "no-store",
  });

  // Step 2: hit option-chain page with those cookies to get session cookies
  const jar1 = parseCookieHeader(r1.headers);
  const r2 = await fetch("https://www.nseindia.com/option-chain", {
    headers: {
      "User-Agent": NSE_HEADERS["User-Agent"],
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: "https://www.nseindia.com",
      Cookie: jar1,
    },
    cache: "no-store",
  });

  const jar2 = parseCookieHeader(r2.headers);
  // Merge: jar2 values override jar1
  const merged = new Map<string, string>();
  for (const part of [...jar1.split("; "), ...jar2.split("; ")]) {
    const key = part.split("=")[0].trim();
    if (key) merged.set(key, part.trim());
  }
  return Array.from(merged.values()).join("; ");
}

function parseCookieHeader(headers: Headers): string {
  // getSetCookie() handles commas inside dates correctly (Node 18+)
  const raw: string[] = typeof (headers as any).getSetCookie === "function"
    ? (headers as any).getSetCookie()
    : (headers.get("set-cookie") || "").split(/,(?=\s*\w+=)/);
  return raw
    .map((c) => c.split(";")[0].trim())
    .filter((c) => c.includes("="))
    .join("; ");
}

function isIndex(symbol: string): boolean {
  const indices = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX"];
  return indices.includes(symbol.toUpperCase());
}

function calcMaxPain(strikes: StrikeOI[]): number {
  // Max pain = strike where total loss for option buyers is maximum (i.e. min for sellers)
  // = strike that minimizes sum of ITM option values
  let minPain = Infinity;
  let maxPainStrike = 0;

  for (const target of strikes) {
    let totalPain = 0;
    for (const s of strikes) {
      // Call OI pain: calls with strike < target are ITM for call holders
      if (s.strike < target.strike) {
        totalPain += s.callOI * (target.strike - s.strike);
      }
      // Put OI pain: puts with strike > target are ITM for put holders
      if (s.strike > target.strike) {
        totalPain += s.putOI * (s.strike - target.strike);
      }
    }
    if (totalPain < minPain) {
      minPain = totalPain;
      maxPainStrike = target.strike;
    }
  }
  return maxPainStrike;
}

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol")?.toUpperCase() || "";
  const expiry = req.nextUrl.searchParams.get("expiry") || "";

  if (!symbol) {
    return NextResponse.json({ error: "Symbol required" }, { status: 400 });
  }

  try {
    // Step 1: Get NSE session cookie
    let cookie = "";
    try {
      cookie = await getNSECookie();
    } catch {
      // Cookie fetch may fail, try without it
    }

    // Step 2: Fetch option chain
    const endpoint = isIndex(symbol)
      ? `https://www.nseindia.com/api/option-chain-indices?symbol=${encodeURIComponent(symbol)}`
      : `https://www.nseindia.com/api/option-chain-equities?symbol=${encodeURIComponent(symbol)}`;

    const res = await fetch(endpoint, {
      headers: {
        ...NSE_HEADERS,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      cache: "no-store",
    });

    if (!res.ok) {
      throw new Error(`NSE returned ${res.status}`);
    }

    const json = await res.json();

    if (!json?.records?.data) {
      const preview = JSON.stringify(json).slice(0, 120);
      throw new Error(`Invalid option chain response: ${preview}`);
    }

    const records = json.records;
    const expiryDates: string[] = records.expiryDates || [];
    const underlyingValue: number = records.underlyingValue || 0;

    // Use selected expiry or nearest
    const selectedExpiry = expiry && expiryDates.includes(expiry)
      ? expiry
      : expiryDates[0] || "";

    // Filter by selected expiry and build strike map
    const strikeMap = new Map<number, StrikeOI>();

    for (const row of records.data) {
      if (selectedExpiry && row.expiryDate !== selectedExpiry) continue;

      const strike: number = row.strikePrice;

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

      const entry = strikeMap.get(strike)!;

      if (row.CE) {
        entry.callOI = row.CE.openInterest || 0;
        entry.callOIChange = row.CE.changeinOpenInterest || 0;
        entry.callVolume = row.CE.totalTradedVolume || 0;
        entry.callIV = row.CE.impliedVolatility || 0;
        entry.callLTP = row.CE.lastPrice || 0;
      }

      if (row.PE) {
        entry.putOI = row.PE.openInterest || 0;
        entry.putOIChange = row.PE.changeinOpenInterest || 0;
        entry.putVolume = row.PE.totalTradedVolume || 0;
        entry.putIV = row.PE.impliedVolatility || 0;
        entry.putLTP = row.PE.lastPrice || 0;
      }
    }

    // Sort strikes
    const strikes = Array.from(strikeMap.values()).sort((a, b) => a.strike - b.strike);

    if (strikes.length === 0) {
      throw new Error("No option data for selected expiry");
    }

    // Find max OI strikes
    let maxCallOI = 0, maxPutOI = 0;
    let maxCallOIStrike = 0, maxPutOIStrike = 0;
    let totalCallOI = 0, totalPutOI = 0;

    for (const s of strikes) {
      totalCallOI += s.callOI;
      totalPutOI += s.putOI;
      if (s.callOI > maxCallOI) { maxCallOI = s.callOI; maxCallOIStrike = s.strike; }
      if (s.putOI > maxPutOI) { maxPutOI = s.putOI; maxPutOIStrike = s.strike; }
    }

    const pcr = totalCallOI > 0 ? totalPutOI / totalCallOI : 0;
    const maxPainStrike = calcMaxPain(strikes);

    const data: OptionsData = {
      symbol,
      underlyingValue,
      expiryDates,
      selectedExpiry,
      strikes,
      maxCallOIStrike,
      maxPutOIStrike,
      maxCallOI,
      maxPutOI,
      totalCallOI,
      totalPutOI,
      pcr,
      maxPainStrike,
    };

    return NextResponse.json(data);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
