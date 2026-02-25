// app/index.tsx
import React, { useEffect, useRef } from "react";
import { ActivityIndicator, View } from "react-native";
import { useRouter } from "expo-router";
import { supabase } from "../src/lib/supabase";

export default function Index() {
  const router = useRouter();
  const didRun = useRef(false);

  useEffect(() => {
    if (didRun.current) return;
    didRun.current = true;

    let alive = true;

    (async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (!alive) return;

        if (error) {
          router.replace("/(auth)/login");
          return;
        }

        if (data?.session) {
          router.replace("/(tabs)");
        } else {
          router.replace("/(auth)/login");
        }
      } catch {
        if (!alive) return;
        router.replace("/(auth)/login");
      }
    })();

    return () => {
      alive = false;
    };
  }, [router]);

  // ✅ 루트에서 “메인메뉴 UI”를 절대 그리지 않게 -> 플래시 제거
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#FFFFFF" }}>
      <ActivityIndicator />
    </View>
  );
}
