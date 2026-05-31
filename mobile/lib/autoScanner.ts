import { FNO_STOCKS } from "./fnoStocks";
import { fetchCandles } from "./api";
import { generateTradeTip } from "./tradeTip";
import { logTips } from "./tipLog";

// Prevents overlapping scans if a previous run is still in progress
let _scanning = false;

export function isAutoScanning(): boolean {
  return _scanning;
}

/**
 * Scans all FNO stocks and logs a tip ONLY when price is currently inside
 * the entry zone (signal === "BUY", within ±2% of entry).
 *
 * delayMs: pause between stock fetches.
 *   - 150ms in foreground (smooth, avoids hammering the server)
 *   - 50ms  in background (faster, fits within OS time limits ~30s for iOS)
 *
 * onNewTip: called for each newly logged tip (used to send notifications).
 */
export async function runAutoScan(
  delayMs = 150,
  onNewTip?: (sym: string, direction: "long" | "short", entry: number, price: number) => void
): Promise<void> {
  if (_scanning) return;
  _scanning = true;

  try {
    for (const sym of FNO_STOCKS) {
      try {
        const data = await fetchCandles(sym);
        if (data.candles.length < 15) continue;

        const tip = generateTradeTip(data.candles);
        if (!tip || tip.signal !== "BUY") continue;
        if (Math.abs(tip.distToZonePct) > 2) continue;

        const added = await logTips([{ symbol: sym, tip }]);
        if (added > 0 && onNewTip) {
          onNewTip(sym, tip.direction, tip.entry, data.price);
        }
      } catch { /* skip this stock silently */ }

      await new Promise<void>((r) => setTimeout(r, delayMs));
    }
  } finally {
    _scanning = false;
  }
}
