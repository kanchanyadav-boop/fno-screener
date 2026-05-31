import * as BackgroundFetch from "expo-background-fetch";
import * as TaskManager from "expo-task-manager";
import { fetchPrices } from "./api";
import { loadSetups, updateSetupPrices, getAlertedIds, markAlerted, clearAlert } from "./storage";
import { loadTipLog, updateTipLogPrices } from "./tipLog";
import {
  sendEntryAlert,
  sendTargetAlert,
  sendSLAlert,
} from "./notifications";

export const PRICE_CHECK_TASK = "fno-price-check";

// Runs every ~15 min when app is closed.
// Only checks watchlist + tip log prices — full FNO scan runs via Vercel cron.

TaskManager.defineTask(PRICE_CHECK_TASK, async () => {
  try {
    // 1. Update watchlist setup prices + notify on target/SL hits
    const setups = await loadSetups();
    const activeSetups = setups.filter((s) => s.status === "active");
    if (activeSetups.length > 0) {
      const syms = [...new Set(activeSetups.map((s) => s.symbol))];
      const prices = await fetchPrices(syms);
      if (Object.keys(prices).length > 0) {
        const alerted = await getAlertedIds();
        for (const setup of activeSetups) {
          const pd = prices[setup.symbol];
          if (!pd?.price) continue;
          const distPct = Math.abs((pd.price - setup.entryPrice) / setup.entryPrice * 100);
          if (distPct <= 2 && !alerted.has(setup.id)) {
            await sendEntryAlert(setup.symbol, setup.direction, setup.entryPrice, pd.price);
            await markAlerted(setup.id);
          } else if (distPct > 5) {
            await clearAlert(setup.id);
          }
        }

        const updated = await updateSetupPrices(prices);
        for (const prev of activeSetups) {
          const next = updated.find((s) => s.id === prev.id);
          if (!next?.exitPrice) continue;
          if (next.status === "target_hit") {
            await sendTargetAlert(next.symbol, next.direction, next.exitPrice);
          } else if (next.status === "sl_hit") {
            await sendSLAlert(next.symbol, next.direction, next.exitPrice);
          }
        }
      }
    }

    // 2. Update tip log prices
    const tipLog = await loadTipLog();
    const activeSyms = [...new Set(
      tipLog.filter((e) => e.status === "active").map((e) => e.symbol)
    )];
    if (activeSyms.length > 0) {
      const prices = await fetchPrices(activeSyms);
      if (Object.keys(prices).length > 0) {
        await updateTipLogPrices(prices);
      }
    }

    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

export async function registerBackgroundTask(): Promise<void> {
  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(PRICE_CHECK_TASK);
    if (!isRegistered) {
      await BackgroundFetch.registerTaskAsync(PRICE_CHECK_TASK, {
        minimumInterval: 15 * 60,
        stopOnTerminate: false,
        startOnBoot: true,
      });
    }
  } catch { /* silently fails in Expo Go — works in production build */ }
}
