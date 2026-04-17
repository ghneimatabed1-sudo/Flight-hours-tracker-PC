import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { supabase, supabaseConfigured } from "./supabase";

// Resolve the EAS project id used to scope Expo push tokens. Reads from the
// EAS config first (set automatically in EAS builds) then falls back to a
// public env var so dev clients can still register a token without a build.
export function resolveProjectId(): string | undefined {
  const fromEas =
    (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)
      ?.eas?.projectId ??
    (
      Constants.easConfig as { projectId?: string } | undefined
    )?.projectId;
  if (fromEas) return fromEas;
  return process.env.EXPO_PUBLIC_EAS_PROJECT_ID || undefined;
}

export type CurrencyKey = "day" | "night" | "irt" | "medical" | "sim";

export type ReminderThresholds = Partial<Record<CurrencyKey, number[]>>;

export interface ReminderPrefs {
  thresholds: ReminderThresholds;
  pushEnabled: boolean;
  expoPushToken: string | null;
  platform: string | null;
}

export const DEFAULT_PREFS: ReminderPrefs = {
  thresholds: {},
  pushEnabled: false,
  expoPushToken: null,
  platform: null,
};

// Suggested chip values shown in the reminders UI. Pilot taps to toggle each
// in/out of their per-currency list. Order matches what looks natural on a
// row (most-imminent on the left).
export const THRESHOLD_PRESETS: number[] = [1, 3, 7, 10, 14, 21, 30];

// Set up the foreground handler once per app launch. Without this, taps on
// notifications received while the app is open do not surface to the user.
let handlerConfigured = false;
export function configureNotificationHandler(): void {
  if (handlerConfigured) return;
  handlerConfigured = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

interface RegisterResult {
  ok: boolean;
  token?: string;
  error?:
    | "unsupported_platform"
    | "permission_denied"
    | "no_project_id"
    | "expo_error";
}

// Acquires (or refreshes) the Expo push token for this device, after
// requesting OS-level notification permission. Returns the token string the
// caller can persist to Supabase. Web is a no-op since the mobile app does
// not run real push there.
export async function registerForPushNotifications(
  projectId?: string
): Promise<RegisterResult> {
  if (Platform.OS === "web") return { ok: false, error: "unsupported_platform" };
  if (!Device.isDevice) {
    // Simulator / emulator cannot receive real Expo pushes; treat as an
    // unsupported environment so the UI can show a friendly notice instead
    // of looping the permission dialog.
    return { ok: false, error: "unsupported_platform" };
  }

  if (Platform.OS === "android") {
    try {
      await Notifications.setNotificationChannelAsync("currency-expiry", {
        name: "Currency expiry reminders",
        importance: Notifications.AndroidImportance.HIGH,
        sound: "default",
        vibrationPattern: [0, 250, 250, 250],
      });
    } catch {
      // Channel creation failures should not block token retrieval.
    }
  }

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== "granted") {
    const req = await Notifications.requestPermissionsAsync();
    status = req.status;
  }
  if (status !== "granted") return { ok: false, error: "permission_denied" };

  if (!projectId) return { ok: false, error: "no_project_id" };

  try {
    const tokenResp = await Notifications.getExpoPushTokenAsync({ projectId });
    return { ok: true, token: tokenResp.data };
  } catch {
    return { ok: false, error: "expo_error" };
  }
}

export async function loadReminderPrefs(): Promise<ReminderPrefs> {
  if (!supabaseConfigured || !supabase) return DEFAULT_PREFS;
  const { data, error } = await supabase.rpc("get_pilot_reminder_prefs");
  if (error || !data) return DEFAULT_PREFS;
  const obj = data as {
    thresholds?: ReminderThresholds;
    pushEnabled?: boolean;
    expoPushToken?: string | null;
    platform?: string | null;
  };
  return {
    thresholds: obj.thresholds ?? {},
    pushEnabled: Boolean(obj.pushEnabled),
    expoPushToken: obj.expoPushToken ?? null,
    platform: obj.platform ?? null,
  };
}

export async function saveReminderPrefs(prefs: ReminderPrefs): Promise<boolean> {
  if (!supabaseConfigured || !supabase) return false;
  const { error } = await supabase.rpc("save_pilot_reminder_prefs", {
    p_thresholds: prefs.thresholds,
    p_push_enabled: prefs.pushEnabled,
    p_expo_push_token: prefs.expoPushToken,
    p_platform: prefs.platform,
  });
  return !error;
}

// Normalise a per-currency threshold list: dedupe, drop nonsense, sort
// descending so the most-distant reminder shows first.
export function normaliseThresholds(values: number[]): number[] {
  const seen = new Set<number>();
  for (const v of values) {
    const n = Math.trunc(Number(v));
    if (Number.isFinite(n) && n >= 0 && n <= 365) seen.add(n);
  }
  return Array.from(seen).sort((a, b) => b - a);
}
