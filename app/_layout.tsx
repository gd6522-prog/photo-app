import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useEffect, useRef, useState } from "react";
import { Stack, useRootNavigationState, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { LogBox } from "react-native";
import { AuthProvider, useAuth } from "../src/lib/auth";

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

  const [readyToRender, setReadyToRender] = useState(false);
  const [postSignupRedirect, setPostSignupRedirect] = useState(false);

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
          SplashScreen.hideAsync().catch(() => {});
        });
      } else {
        SplashScreen.hideAsync().catch(() => {});
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
        SplashScreen.hideAsync().catch(() => {});
      }, 50);
    });
  }, [user?.id, loading, postSignupRedirect, segments?.[0], navState?.key, router, readyToRender]);

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
