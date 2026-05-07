import { NextRequest, NextResponse } from "next/server";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json",
  "Accept-Language": "en-US,en;q=0.9",
};

function toYahooSymbol(sym: string): string {
  const s = sym.trim().toUpperCase();
  if (s === "NIFTY50" || s === "NIFTY") return "^NSEI";
  if (s === "BANKNIFTY") return "^NSEBANK";
  if (s === "FINNIFTY") return "^CNXFIN";
  if (s === "MIDCPNIFTY") return "^NIFMDCP50";
  return `${s}.NS`;
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("symbols") || "";
  if (!raw) return NextResponse.json({ error: "symbols required" }, { status: 400 });

  const symbols = raw.split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
  const yahooSyms = symbols.map(toYahooSymbol).join(",");

  try {
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${yahooSyms}&fields=regularMarketPrice,chartPreviousClose,regularMarketChange,regularMarketChangePercent,regularMarketVolume,regularMarketTime`;
    const res = await fetch(url, { headers: HEADERS, cache: "no-store" });
    if (!res.ok) throw new Error(`Yahoo ${res.status}`);

    const json = await res.json();
    const items: any[] = json?.quoteResponse?.result ?? [];

    // Build a reverse map: yahoo symbol → original symbol
    const yahooToOrig: Record<string, string> = {};
    for (const s of symbols) yahooToOrig[toYahooSymbol(s)] = s;

    const out: Record<string, { price: number; prevClose: number; change: number; changePct: number }> = {};
    for (const item of items) {
      const orig = yahooToOrig[item.symbol] ?? item.symbol.replace(".NS", "");
      out[orig] = {
        price:     item.regularMarketPrice ?? 0,
        prevClose: item.chartPreviousClose ?? item.regularMarketPreviousClose ?? 0,
        change:    item.regularMarketChange ?? 0,
        changePct: item.regularMarketChangePercent ?? 0,
      };
    }

    return NextResponse.json(out);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
