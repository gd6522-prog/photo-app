import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import "react-native-url-polyfill/auto";

export const SUPABASE_URL = "https://grgakvlagldqyporzbwe.supabase.co";
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdyZ2FrdmxhZ2xkcXlwb3J6YndlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg5MjMyMDQsImV4cCI6MjA4NDQ5OTIwNH0.2K2_Ons7dMByVR7-azh_2XW5Dl5mpN-MmrVWUYqYuhw";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    persistSession: true,
    // Keep auto refresh off so a broken saved refresh token does not keep retrying on app startup.
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

export function isRefreshTokenError(msg: string) {
  const lower = String(msg ?? "").toLowerCase();
  return (
    lower.includes("invalid refresh token") ||
    lower.includes("refresh token not found") ||
    lower.includes("refresh token") ||
    lower.includes("refresh_token")
  );
}

export async function clearSupabaseAuthStorage() {
  try {
    await supabase.auth.signOut();
  } catch {}

  try {
    const keys = await AsyncStorage.getAllKeys();
    const targets = keys.filter((k) => k.includes("sb-") || k.includes("supabase"));
    if (targets.length) await AsyncStorage.multiRemove(targets);
  } catch {}
}

export async function cleanupInvalidSavedSession() {
  try {
    const { error } = await supabase.auth.getSession();
    if (isRefreshTokenError((error as any)?.message || "")) {
      await clearSupabaseAuthStorage();
    }
  } catch (e: any) {
    if (isRefreshTokenError(e?.message || "")) {
      await clearSupabaseAuthStorage();
    }
  }
}

void cleanupInvalidSavedSession();
