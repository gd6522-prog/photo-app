import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import "react-native-url-polyfill/auto";

const SUPABASE_URL = "https://grgakvlagldqyporzbwe.supabase.co";
// ✅ 여기에 Settings → API → anon public (eyJ... 로 시작하는 키) 넣기
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdyZ2FrdmxhZ2xkcXlwb3J6YndlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg5MjMyMDQsImV4cCI6MjA4NDQ5OTIwNH0.2K2_Ons7dMByVR7-azh_2XW5Dl5mpN-MmrVWUYqYuhw";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

// ✅ 앱 시작 시 “깨진 refresh token”이면 자동 정리 (Invalid Refresh Token 로그박스 방지)
(async () => {
  const cleanIfBadRefreshToken = async (msg: string) => {
    if (!msg) return false;
    const hit =
      msg.includes("Invalid Refresh Token") ||
      msg.includes("Refresh Token Not Found") ||
      msg.includes("Refresh token not found") ||
      msg.includes("refresh token") ||
      msg.includes("refresh_token");
    if (!hit) return false;

    // 세션 정리 + 스토리지 정리
    try {
      await supabase.auth.signOut();
    } catch {}

    try {
      const keys = await AsyncStorage.getAllKeys();
      // supabase-js 버전에 따라 키 패턴이 다름 → 넓게 제거
      const targets = keys.filter((k) => k.includes("sb-") || k.includes("supabase"));
      if (targets.length) await AsyncStorage.multiRemove(targets);
    } catch {}

    return true;
  };

  try {
    const { error } = await supabase.auth.getSession();
    await cleanIfBadRefreshToken((error as any)?.message || "");
  } catch (e: any) {
    await cleanIfBadRefreshToken(e?.message || "");
  }
})();