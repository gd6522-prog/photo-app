import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useEffect, useRef, useState } from "react";
import { Stack, useRootNavigationState, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as Notifications from "expo-notifications";
import { LogBox, Text, TextInput } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { AuthProvider, useAuth } from "../src/lib/auth";

// 시스템 글꼴 크기 설정에 영향받지 않도록 전역 적용
(Text as any).defaultProps = { ...(Text as any).defaultProps, allowFontScaling: false };
(TextInput as any).defaultProps = { ...(TextInput as any).defaultProps, allowFontScaling: false };

const POST_SIGNUP_LOGIN_KEY = "hx_post_signup_login_redirect";

SplashScreen.preventAutoHideAsync().catch(() => {});
LogBox.ignoreLogs([
  "AuthApiError: Invalid Refresh Token",
  "Invalid Refresh Token: Refresh Token Not Found",
]);

function AuthGate() {
  const router = useRouter();
  const segments = useSegments();
  const navState = useRootNavigationState();
  const { user, loading } = useAuth();

  const lastRedirectRef = useRef<string | null>(null);
  const redirectLockRef = useRef(false);
  const splashHiddenRef = useRef(false);

  const [readyToRender, setReadyToRender] = useState(false);
  const [postSignupRedirect, setPostSignupRedirect] = useState(false);

  const hideSplashOnce = () => {
    if (splashHiddenRef.current) return;
    splashHiddenRef.current = true;
    SplashScreen.hideAsync().catch(() => {});
  };

  useEffect(() => {
    (async () => {
      try {
        const flag = await AsyncStorage.getItem(POST_SIGNUP_LOGIN_KEY);
        setPostSignupRedirect(flag === "1");
      } catch {
        setPostSignupRedirect(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!navState?.key) return;
    if (loading) return;

    const group = segments?.[0];
    const inAuth = group === "(auth)";
    const inTabs = group === "(tabs)";

    let target: string | null = null;

    if (postSignupRedirect) {
      if (!inAuth) target = "/(auth)/login";
    } else if (!user) {
      if (!inAuth) target = "/(auth)/login";
    } else {
      if (!inTabs) target = "/(tabs)";
    }

    if (!target) {
      redirectLockRef.current = false;
      lastRedirectRef.current = null;

      if (!readyToRender) {
        setReadyToRender(true);
        requestAnimationFrame(() => {
          hideSplashOnce();
        });
      }
      return;
    }

    if (lastRedirectRef.current === target) return;
    if (redirectLockRef.current) return;

    redirectLockRef.current = true;
    lastRedirectRef.current = target;
    router.replace(target as any);

    requestAnimationFrame(() => {
      setTimeout(() => {
        setReadyToRender(true);
        hideSplashOnce();
      }, 50);
    });
  }, [user?.id, loading, postSignupRedirect, segments?.[0], navState?.key, router, readyToRender]);

  // 알림 탭 → 해당 화면으로 자동 이동 (cold-start / warm 양쪽 모두)
  // 기존 구현은 cold-start 시 navigation 이 준비되기 전에 push 가 발사되어
  // 검은 빈 화면으로 머무는 사례가 있었음. pendingTarget 으로 큐잉했다가
  // navState/user/readyToRender 가 모두 준비된 뒤에 한 번만 navigate 한다.
  const [pendingNavTarget, setPendingNavTarget] = useState<string | null>(null);

  useEffect(() => {
    const handleResponse = (
      response: Notifications.NotificationResponse | null | undefined
    ) => {
      const data = response?.notification?.request?.content?.data as { type?: string } | undefined;
      if (data?.type === "parking_request_new") {
        setPendingNavTarget("/(tabs)/approve");
      }
    };

    // cold-start: 앱이 알림으로 열렸을 때
    Notifications.getLastNotificationResponseAsync()
      .then(handleResponse)
      .catch(() => {});

    // warm: 앱이 떠 있는 동안 알림을 탭한 경우
    const sub = Notifications.addNotificationResponseReceivedListener(handleResponse);
    return () => sub.remove();
  }, []);

  // pendingNavTarget 이 있고 navigation/auth/렌더가 모두 준비됐을 때만 실제 push
  useEffect(() => {
    if (!pendingNavTarget) return;
    if (!navState?.key) return;     // navigator 미준비
    if (loading) return;            // auth 로딩 중
    if (!user) return;              // 로그인 전엔 이동하지 않음 (auth 게이트가 처리)
    if (!readyToRender) return;     // 첫 렌더 전엔 이동하지 않음

    const target = pendingNavTarget;
    setPendingNavTarget(null);
    // 다음 프레임에 push (현재 mount 흐름 끝난 뒤)
    const id = setTimeout(() => {
      try {
        router.push(target as any);
      } catch (e) {
        console.warn("[notif nav] push failed", e);
      }
    }, 50);
    return () => clearTimeout(id);
  }, [pendingNavTarget, navState?.key, loading, user, readyToRender, router]);

  if (!readyToRender) return null;

  return <Stack screenOptions={{ headerShown: false }} />;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <AuthGate />
      </AuthProvider>
    </GestureHandlerRootView>
  );
}
