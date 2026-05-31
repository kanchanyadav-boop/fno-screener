import { NextRequest, NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import { FNO_STOCKS } from "@/app/lib/fnoStocks";
import { generateTradeTip } from "@/app/lib/tradeTip";
import { Candle } from "@/app/lib/pattern";

// ─── Redis ────────────────────────────────────────────────────────────────────

function getRedis() {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("Upstash Redis not configured");
  return new Redis({ url, token });
}

// ─── Yahoo Finance ────────────────────────────────────────────────────────────

const YAHOO_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json",
};

function toYahooSymbol(sym: string): string {
  if (sym === "NIFTY50")   return "^NSEI";
  if (sym === "BANKNIFTY") return "^NSEBANK";
  return `${sym.toUpperCase()}.NS`;
}

async function fetchCandles(sym: string): Promise<{ candles: Candle[]; price: number } | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${toYahooSymbol(sym)}?interval=1d&range=6mo`;
    const res = await fetch(url, { headers: YAHOO_HEADERS, next: { revalidate: 0 } });
    if (!res.ok) return null;
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) return null;

    const timestamps: number[] = result.timestamp || [];
    const q = result.indicators.quote[0];
    const candles: Candle[] = timestamps
      .map((t: number, i: number) => ({
        date: new Date(t * 1000).toISOString().split("T")[0],
        o: q.open?.[i],
        h: q.high?.[i],
        l: q.low?.[i],
        c: q.close?.[i],
        v: q.volume?.[i] ?? 0,
      }))
      .filter((c) => c.h != null && c.l != null && c.c != null);

    return { candles, price: result.meta.regularMarketPrice };
  } catch {
    return null;
  }
}

// ─── Expo Push ────────────────────────────────────────────────────────────────

interface PushMessage {
  to: string;
  title: string;
  body: string;
  sound: "default";
  data?: Record<string, unknown>;
}

async function sendPushBatch(messages: PushMessage[]) {
  // Expo Push API accepts up to 100 messages per request
  const CHUNK = 100;
  for (let i = 0; i < messages.length; i += CHUNK) {
    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
      },
      body: JSON.stringify(messages.slice(i, i + CHUNK)),
    });
  }
}

// ─── Cron handler ─────────────────────────────────────────────────────────────

export const maxDuration = 60; // seconds (Vercel Pro)

// Returns true if current time is within NSE market hours (Mon–Fri, 9:00–16:00 IST)
function isMarketOpen(): boolean {
  const now = new Date();
  // IST = UTC + 5h 30m
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const day  = ist.getUTCDay();                              // 0=Sun … 6=Sat
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const isWeekday     = day >= 1 && day <= 5;
  const isDuringHours = mins >= 9 * 60 && mins < 16 * 60;  // 09:00–16:00
  return isWeekday && isDuringHours;
}

export async function GET(req: NextRequest) {
  // Vercel automatically sets Authorization: Bearer <CRON_SECRET> on cron calls
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isMarketOpen()) {
    return NextResponse.json({ message: "Market closed — scan skipped", skipped: true });
  }

  const redis = getRedis();

  // Load registered device tokens
  const tokens: string[] = await redis.smembers("fno:push_tokens");
  if (!tokens.length) {
    return NextResponse.json({ message: "No devices registered", scanned: 0, newTips: 0 });
  }

  // Scan all FNO stocks in batches of 10 (avoids Yahoo rate limits)
  const newTips: { symbol: string; direction: "long" | "short"; entry: number; price: number }[] = [];
  const BATCH = 10;

  for (let i = 0; i < FNO_STOCKS.length; i += BATCH) {
    const batch = FNO_STOCKS.slice(i, i + BATCH);
    await Promise.all(
      batch.map(async (sym) => {
        const data = await fetchCandles(sym);
        if (!data || data.candles.length < 15) return;

        const tip = generateTradeTip(data.candles);
        if (!tip || tip.signal !== "BUY") return;
        if (Math.abs(tip.distToZonePct) > 2) return;

        // 24-hour dedup — don't re-notify for the same zone entry
        const key = `fno:sent:${sym}_${tip.zone.anchorDate}_${tip.direction}`;
        const already = await redis.get(key);
        if (already) return;

        await redis.set(key, "1", { ex: 86400 });
        newTips.push({ symbol: sym, direction: tip.direction, entry: tip.entry, price: data.price });
      })
    );
  }

  // Send push notifications to all registered devices
  if (newTips.length > 0) {
    const messages: PushMessage[] = tokens.flatMap((to) =>
      newTips.map((tip) => ({
        to,
        title: `${tip.direction === "long" ? "🟢" : "🔴"} ${tip.symbol} — ${tip.direction === "long" ? "Buy" : "Sell"} Zone!`,
        body: `Price ₹${tip.price.toFixed(2)} · Entry ₹${tip.entry.toFixed(2)} · Take the trade!`,
        sound: "default" as const,
        data: { symbol: tip.symbol, type: "entry" },
      }))
    );
    await sendPushBatch(messages);
  }

  return NextResponse.json({
    scanned: FNO_STOCKS.length,
    newTips: newTips.length,
    tips: newTips.map((t) => `${t.symbol} ${t.direction}`),
  });
}
