import * as Notifications from "expo-notifications";

// Show alerts even when app is foregrounded
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function requestPermissions(): Promise<void> {
  await Notifications.requestPermissionsAsync();
}

export async function sendEntryAlert(
  symbol: string,
  direction: "long" | "short",
  entryPrice: number,
  currentPrice: number
): Promise<void> {
  const emoji = direction === "long" ? "🟢" : "🔴";
  const action = direction === "long" ? "Buy Zone" : "Sell Zone";
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `${emoji} ${symbol} — ${action} Reached!`,
      body: `Price ₹${currentPrice.toFixed(2)} · Entry ₹${entryPrice.toFixed(2)} · Take the trade!`,
      sound: true,
      data: { symbol, type: "entry" },
    },
    trigger: null,
  });
}

export async function sendTargetAlert(
  symbol: string,
  direction: "long" | "short",
  exitPrice: number
): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `✅ ${symbol} — Target Hit!`,
      body: `${direction === "long" ? "Long" : "Short"} closed at ₹${exitPrice.toFixed(2)}`,
      sound: true,
      data: { symbol, type: "target" },
    },
    trigger: null,
  });
}

export async function sendSLAlert(
  symbol: string,
  direction: "long" | "short",
  exitPrice: number
): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `🚫 ${symbol} — Stop Loss Hit`,
      body: `${direction === "long" ? "Long" : "Short"} stopped out at ₹${exitPrice.toFixed(2)}`,
      sound: true,
      data: { symbol, type: "sl" },
    },
    trigger: null,
  });
}
