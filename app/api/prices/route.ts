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

async function fetchOnePrice(sym: string) {
  const yahooSym = toYahooSymbol(sym);
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSym}?interval=1d&range=2d`;
    const res = await fetch(url, { headers: HEADERS, cache: "no-store" });
    if (!res.ok) return null;
    const json = await res.json();
    const meta = json?.chart?.result?.[0]?.meta;
    if (!meta?.regularMarketPrice) return null;
    const price: number = meta.regularMarketPrice;
    const prevClose: number = meta.regularMarketPreviousClose ?? meta.chartPreviousClose ?? 0;
    const change = price - prevClose;
    const changePct = prevClose ? (change / prevClose) * 100 : 0;
    return { price, prevClose, change, changePct };
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("symbols") || "";
  if (!raw) return NextResponse.json({ error: "symbols required" }, { status: 400 });

  const symbols = raw.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);

  const results = await Promise.all(
    symbols.map(async (sym) => [sym, await fetchOnePrice(sym)] as const)
  );

  const out: Record<string, { price: number; prevClose: number; change: number; changePct: number }> = {};
  for (const [sym, data] of results) {
    if (data) out[sym] = data;
  }

  return NextResponse.json(out);
}
