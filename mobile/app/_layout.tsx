import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { Alert, Share } from "react-native";
import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { requestPermissions } from "../lib/notifications";
import { registerBackgroundTask } from "../lib/backgroundTask";
import { runAutoScan } from "../lib/autoScanner";
import { sendEntryAlert } from "../lib/notifications";

const SCAN_INTERVAL_MS = 5 * 60 * 1000;
const TOKEN_SHOWN_KEY = "fno_push_token_shown_v1";

function onNewTip(sym: string, direction: "long" | "short", entry: number, price: number) {
  sendEntryAlert(sym, direction, entry, price).catch(() => {});
}

async function showPushTokenOnce() {
  try {
    const alreadyShown = await AsyncStorage.getItem(TOKEN_SHOWN_KEY);
    if (alreadyShown) return;

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId;
    const { data: token } = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    console.log("Expo Push Token:", token);

    Alert.alert(
      "Your Push Token",
      `Copy this token and add it as PUSH_TOKEN in Vercel:\n\n${token}`,
      [
        {
          text: "Share / Copy",
          onPress: () => Share.share({ message: token }),
        },
        {
          text: "Done",
          onPress: () => AsyncStorage.setItem(TOKEN_SHOWN_KEY, "1"),
        },
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
    showPushTokenOnce();

    runAutoScan(150, onNewTip);
    const id = setInterval(() => runAutoScan(150, onNewTip), SCAN_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }} />
    </>
  );
}
