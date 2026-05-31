import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { Alert, Clipboard } from "react-native";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { requestPermissions } from "../lib/notifications";
import { registerBackgroundTask } from "../lib/backgroundTask";
import { runAutoScan } from "../lib/autoScanner";
import { sendEntryAlert } from "../lib/notifications";

const SCAN_INTERVAL_MS = 5 * 60 * 1000;

function onNewTip(sym: string, direction: "long" | "short", entry: number, price: number) {
  sendEntryAlert(sym, direction, entry, price).catch(() => {});
}

async function showPushToken() {
  try {
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId;
    const { data: token } = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    console.log("Expo Push Token:", token);
    Alert.alert(
      "Your Push Token",
      token,
      [
        {
          text: "Copy",
          onPress: () => {
            Clipboard.setString(token);
          },
        },
        { text: "OK" },
      ]
    );
  } catch {
    // Fails in Expo Go simulator — works in production build
  }
}

export default function RootLayout() {
  useEffect(() => {
    requestPermissions();
    registerBackgroundTask();
    showPushToken();

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
