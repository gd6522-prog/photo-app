import { Stack, useRootNavigationState, useRouter, useSegments } from "expo-router";
import React, { useEffect } from "react";
import { AuthProvider, useAuth } from "../src/lib/auth";

function AuthGate() {
  const router = useRouter();
  const segments = useSegments();
  const navState = useRootNavigationState();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!navState?.key) return;     // 네비 준비 전 리다이렉트 금지
    if (loading) return;            // 세션 로딩 중엔 아무것도 하지 않기

    const group = segments[0];      // "(auth)" or "(tabs)" 등
    const inAuth = group === "(auth)";

    if (!user && !inAuth) {
      router.replace("/(auth)/login");
      return;
    }

    if (user && inAuth) {
      router.replace("/(tabs)");
      return;
    }
  }, [user, loading, segments, navState?.key, router]);

  return <Stack screenOptions={{ headerShown: false }} />;
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  );
}
