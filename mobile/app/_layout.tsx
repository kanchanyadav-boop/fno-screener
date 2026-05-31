import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { requestPermissions } from "../lib/notifications";
import { registerBackgroundTask } from "../lib/backgroundTask";
import { runAutoScan } from "../lib/autoScanner";
import { sendEntryAlert } from "../lib/notifications";
import { registerPushToken } from "../lib/api";

const SCAN_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

function onNewTip(sym: string, direction: "long" | "short", entry: number, price: number) {
  sendEntryAlert(sym, direction, entry, price).catch(() => {});
}

async function registerDeviceToken() {
  try {
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId;
    const { data: token } = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    await registerPushToken(token);
  } catch { /* fails in Expo Go or simulator — works in production build */ }
}

export default function RootLayout() {
  useEffect(() => {
    requestPermissions();
    registerBackgroundTask();
    registerDeviceToken();           // ← sends push token to Vercel backend

    // Foreground fallback: also scan locally every 5 min while app is open
    runAutoScan(150, onNewTip);
    const id = setInterval(() => runAutoScan(150, onNewTip), SCAN_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }} />
    </>
  );
}
