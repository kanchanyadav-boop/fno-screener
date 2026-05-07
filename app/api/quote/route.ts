import { NextRequest, NextResponse } from "next/server";

function toYahooSymbol(sym: string): string {
  const s = sym.trim().toUpperCase();
  if (s === "NIFTY50") return "^NSEI";
  if (s === "BANKNIFTY") return "^NSEBANK";
  return `${s}.NS`;
}

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json",
  "Accept-Language": "en-US,en;q=0.9",
};

async function fetchYahoo(yahooSym: string, interval: string, range: string) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSym}?interval=${interval}&range=${range}`;
  const res = await fetch(url, { headers: HEADERS, next: { revalidate: 300 } });
  if (!res.ok) throw new Error(`Yahoo ${res.status} for ${yahooSym}`);
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error("No data");
  return result;
}

export async function GET(req: NextRequest) {
  const sym = req.nextUrl.searchParams.get("symbol") || "";
  const mode = req.nextUrl.searchParams.get("mode") || "screen"; // screen | chart
  const interval = req.nextUrl.searchParams.get("interval") || "1d";

  if (!sym) return NextResponse.json({ error: "No symbol" }, { status: 400 });
  const yahooSym = toYahooSymbol(sym);

  try {
    if (mode === "screen") {
      // For screener: daily candles, 6 months
      const result = await fetchYahoo(yahooSym, "1d", "6mo");
      const meta = result.meta;
      const timestamps: number[] = result.timestamp || [];
      const quote = result.indicators.quote[0];

      const candles = timestamps.map((t: number, i: number) => ({
        date: new Date(t * 1000).toISOString().split("T")[0],
        o: quote.open?.[i],
        h: quote.high?.[i],
        l: quote.low?.[i],
        c: quote.close?.[i],
        v: quote.volume?.[i] ?? 0,
      })).filter((c) => c.h != null && c.l != null && c.c != null);

      return NextResponse.json({
        symbol: sym.toUpperCase(),
        yahooSymbol: yahooSym,
        price: meta.regularMarketPrice,
        prevClose: meta.chartPreviousClose,
        currency: meta.currency,
        exchangeName: meta.exchangeName,
        candles,
      });
    }

    if (mode === "chart") {
      // For chart modal: fetch 1h, 4h (via 60m + 240m), 1d for last 10 days
      const [r1h, r1d] = await Promise.all([
        fetchYahoo(yahooSym, "60m", "10d"),
        fetchYahoo(yahooSym, "1d", "30d"),
      ]);

      const parseCandles = (result: any, agg = 1) => {
        const ts: number[] = result.timestamp || [];
        const q = result.indicators.quote[0];
        const raw = ts.map((t: number, i: number) => ({
          time: t,
          o: q.open?.[i],
          h: q.high?.[i],
          l: q.low?.[i],
          c: q.close?.[i],
          v: q.volume?.[i] ?? 0,
        })).filter((c) => c.h != null && c.l != null && c.c != null);

        if (agg <= 1) return raw;

        // Aggregate 1h → 4h
        const out: typeof raw = [];
        for (let i = 0; i < raw.length; i += agg) {
          const slice = raw.slice(i, i + agg);
          if (!slice.length) continue;
          out.push({
            time: slice[0].time,
            o: slice[0].o,
            h: Math.max(...slice.map((c) => c.h)),
            l: Math.min(...slice.map((c) => c.l)),
            c: slice[slice.length - 1].c,
            v: slice.reduce((sum, c) => sum + c.v, 0),
          });
        }
        return out;
      };

      return NextResponse.json({
        symbol: sym.toUpperCase(),
        price: r1d.meta.regularMarketPrice,
        prevClose: r1d.meta.chartPreviousClose,
        candles1h: parseCandles(r1h, 1),
        candles4h: parseCandles(r1h, 4),
        candles1d: parseCandles(r1d, 1).slice(-30),
      });
    }

    return NextResponse.json({ error: "Unknown mode" }, { status: 400 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
