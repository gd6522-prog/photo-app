import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import "react-native-url-polyfill/auto";

const SUPABASE_URL = "https://grgakvlagldqyporzbwe.supabase.co";
// ✅ 여기에 Settings → API → anon public (eyJ... 로 시작하는 키) 넣기
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdyZ2FrdmxhZ2xkcXlwb3J6YndlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg5MjMyMDQsImV4cCI6MjA4NDQ5OTIwNH0.2K2_Ons7dMByVR7-azh_2XW5Dl5mpN-MmrVWUYqYuhw";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});
