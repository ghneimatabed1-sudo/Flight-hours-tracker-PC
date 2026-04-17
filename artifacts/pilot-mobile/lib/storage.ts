import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

import type { PilotSnapshot } from "./types";

const LINK_KEY = "rjaf.link.v1";
const SNAPSHOT_KEY = "rjaf.snapshot.v1";
const PREFS_KEY = "rjaf.prefs.v1";

export interface LinkRecord {
  militaryNumber: string;
  pilotId: string;
  linkedAt: string;
  squadronId?: string;
  // Legacy: opaque device token from the pre-RLS-per-pilot link path. The
  // current flow uses a real Supabase auth session (persisted by the
  // supabase client into SecureStore under `rjaf.auth.v1`) instead, so new
  // links no longer set this. Kept optional for backward-compat reads of
  // already-linked devices.
  token?: string;
}

export interface UserPrefs {
  language: "en" | "ar";
}

// SecureStore is unavailable on web; fall back to AsyncStorage so the demo
// preview still works in the browser.
async function secureGet(key: string): Promise<string | null> {
  if (Platform.OS === "web") return AsyncStorage.getItem(key);
  return SecureStore.getItemAsync(key);
}

async function secureSet(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    await AsyncStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function secureDelete(key: string): Promise<void> {
  if (Platform.OS === "web") {
    await AsyncStorage.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

export async function loadLink(): Promise<LinkRecord | null> {
  try {
    const raw = await secureGet(LINK_KEY);
    return raw ? (JSON.parse(raw) as LinkRecord) : null;
  } catch {
    return null;
  }
}

export async function saveLink(link: LinkRecord): Promise<void> {
  await secureSet(LINK_KEY, JSON.stringify(link));
}

export async function clearLink(): Promise<void> {
  await secureDelete(LINK_KEY);
  await secureDelete(SNAPSHOT_KEY);
}

export async function loadSnapshot(): Promise<PilotSnapshot | null> {
  try {
    const raw = await secureGet(SNAPSHOT_KEY);
    return raw ? (JSON.parse(raw) as PilotSnapshot) : null;
  } catch {
    return null;
  }
}

export async function saveSnapshot(snap: PilotSnapshot): Promise<void> {
  await secureSet(SNAPSHOT_KEY, JSON.stringify(snap));
}

export async function loadPrefs(): Promise<UserPrefs> {
  try {
    const raw = await AsyncStorage.getItem(PREFS_KEY);
    if (!raw) return { language: "en" };
    return { language: "en", ...(JSON.parse(raw) as Partial<UserPrefs>) };
  } catch {
    return { language: "en" };
  }
}

export async function savePrefs(prefs: UserPrefs): Promise<void> {
  await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}
