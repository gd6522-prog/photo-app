import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { clearSupabaseAuthStorage, isRefreshTokenError, supabase } from "./supabase";
import { getOrCreateDeviceId } from "./deviceId";

type AuthValue = {
  session: any | null;
  user: any | null;
  loading: boolean;
};

const AuthContext = createContext<AuthValue>({
  session: null,
  user: null,
  loading: true,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error && isRefreshTokenError(error.message)) {
          await clearSupabaseAuthStorage();
          if (!mounted) return;
          setSession(null);
          return;
        }

        // 앱 재실행 시 기기 검증: 다른 기기에서 로그인됐으면 강제 로그아웃
        if (data.session?.user) {
          try {
            const deviceId = await getOrCreateDeviceId();
            const { data: prof } = await supabase
              .from("profiles")
              .select("device_id")
              .eq("id", data.session.user.id)
              .single();

            if (prof?.device_id && prof.device_id !== deviceId) {
              await clearSupabaseAuthStorage();
              if (!mounted) return;
              setSession(null);
              setLoading(false);
              return;
            }
          } catch {
            // 네트워크 오류 등은 무시하고 세션 유지
          }
        }

        if (!mounted) return;
        setSession(data.session ?? null);
      } catch (e: any) {
        if (isRefreshTokenError(e?.message || "")) {
          await clearSupabaseAuthStorage();
          if (!mounted) return;
          setSession(null);
          return;
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_evt, s) => {
      if (!mounted) return;
      setSession(s ?? null);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthValue>(() => {
    const user = session?.user ?? null;
    return { session, user, loading };
  }, [session, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
