import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import "react-native-url-polyfill/auto";

export const SUPABASE_URL = "https://grgakvlagldqyporzbwe.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_ufmRSlOaUPZZrTZARfD-hg_y7P-5gDz";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
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
