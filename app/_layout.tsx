// app/_layout.tsx
import React, { useEffect, useRef, useState } from "react";
import { Stack, useRootNavigationState, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { AuthProvider, useAuth } from "../src/lib/auth";

// ✅ 스플래시 자동 숨김 막기 (앱 시작하자마자 1번 실행)
SplashScreen.preventAutoHideAsync().catch(() => {});

function AuthGate() {
  const router = useRouter();
  const segments = useSegments();
  const navState = useRootNavigationState();
  const { user, loading } = useAuth();

  const lastRedirectRef = useRef<string | null>(null);
  const redirectLockRef = useRef(false);

  const [readyToRender, setReadyToRender] = useState(false);

  useEffect(() => {
    // 네비 준비 + 세션 로딩 끝날 때까지 대기
    if (!navState?.key) return;
    if (loading) return;

    const group = segments?.[0]; // "(auth)" | "(tabs)" | undefined
    const inAuth = group === "(auth)";
    const inTabs = group === "(tabs)";

    // ✅ target 계산을 명확히 (동시에 두 조건 걸리는 순간 방지)
    let target: string | null = null;

    if (!user) {
      // 비로그인 → auth 그룹에 없으면 login으로
      if (!inAuth) target = "/(auth)/login";
    } else {
      // 로그인 → tabs 그룹에 없으면 tabs로
      if (!inTabs) target = "/(tabs)";
    }

    // ✅ redirect 필요 없으면 이제 렌더 가능 + 스플래시 숨김
    if (!target) {
      // redirectLock 해제
      redirectLockRef.current = false;
      lastRedirectRef.current = null;

      if (!readyToRender) {
        setReadyToRender(true);
        requestAnimationFrame(() => {
          SplashScreen.hideAsync().catch(() => {});
        });
      } else {
        // 이미 렌더 중이면 스플래시는 그냥 안전하게 숨김 시도
        SplashScreen.hideAsync().catch(() => {});
      }
      return;
    }

    // ✅ 같은 target 중복 replace 방지
    if (lastRedirectRef.current === target) return;

    // ✅ redirect가 진행 중이면 또 replace 치지 않음 (두 번 싹싹 방지 핵심)
    if (redirectLockRef.current) return;

    redirectLockRef.current = true;
    lastRedirectRef.current = target;

    // ✅ 스플래시 유지한 상태에서 라우팅 먼저
    router.replace(target as any);

    // ✅ 라우팅이 “그려질 시간”까지 한 박자 기다렸다가 렌더 허용 + 스플래시 숨김
    requestAnimationFrame(() => {
      setTimeout(() => {
        setReadyToRender(true);
        SplashScreen.hideAsync().catch(() => {});
        // 다음 effect 사이클에서 target 없으면 lock 풀림
      }, 50);
    });
  }, [
    user?.id,
    loading,
    segments?.[0], // ✅ segments 전체 말고 그룹만
    navState?.key,
    router,
    readyToRender,
  ]);

  // ✅ 준비 전에는 우리 화면(로딩)도 안 보이게: 스플래시가 그대로 보여짐
  if (!readyToRender) return null;

  return <Stack screenOptions={{ headerShown: false }} />;
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  );
}
