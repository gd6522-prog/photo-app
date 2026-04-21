import AsyncStorage from "@react-native-async-storage/async-storage";
import { getOrCreateDeviceId } from "../../src/lib/deviceId";
import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SUPABASE_ANON_KEY, SUPABASE_URL, supabase } from "../../src/lib/supabase";

const KEY_AUTO_LOGIN = "hx_auto_login";
const KEY_LOGIN_FAIL_PREFIX = "hx_login_fail_";
const KEY_LOGIN_LOCK_PREFIX = "hx_login_lock_";
const POST_SIGNUP_LOGIN_KEY = "hx_post_signup_login_redirect";
const MAX_LOGIN_FAILS = 5;

function toE164KR(raw: string): string | null {
  const s = raw.replace(/[^\d+]/g, "");
  if (s.startsWith("+")) {
    if (!/^\+\d{8,15}$/.test(s)) return null;
    return s;
  }

  const digits = s.replace(/\D/g, "");
  if (digits.length < 9 || digits.length > 11) return null;
  if (!digits.startsWith("0")) return null;
  return `+82${digits.slice(1)}`;
}

function phoneToEmail(e164: string) {
  const digits = e164.replace(/\D/g, "");
  return `p_${digits}@phone.local`;
}

function loginFailKey(e164: string) {
  return `${KEY_LOGIN_FAIL_PREFIX}${e164}`;
}

function loginLockKey(e164: string) {
  return `${KEY_LOGIN_LOCK_PREFIX}${e164}`;
}

function isSessionMissingPopup(title?: string, message?: string) {
  const t = (title ?? "").toLowerCase();
  const m = (message ?? "").toLowerCase();
  return t.includes("login required") || (m.includes("session") && m.includes("login"));
}

function isInvalidCreds(err: any) {
  const msg = String(err?.message ?? "").toLowerCase();
  return msg.includes("invalid login credentials") || msg.includes("invalid credentials");
}

function mapAuthErrorToKo(err: any) {
  const msg = String(err?.message ?? "").toLowerCase();

  if (!msg) return "로그인 중 오류가 발생했습니다.";
  if (msg.includes("invalid login credentials") || msg.includes("invalid credentials")) {
    return "전화번호 또는 비밀번호가 올바르지 않습니다.";
  }
  if (msg.includes("email not confirmed") || msg.includes("phone not confirmed")) {
    return "승인되지 않은 계정입니다.";
  }
  if (msg.includes("too many requests") || msg.includes("rate limit")) {
    return "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.";
  }
  if (msg.includes("network") || msg.includes("fetch failed")) {
    return "네트워크 연결을 확인해 주세요.";
  }
  if (msg.includes("refresh token")) {
    return "세션이 만료되었습니다. 다시 로그인해 주세요.";
  }

  return err?.message ?? "로그인 중 오류가 발생했습니다.";
}

async function markProfilePendingByPhone(phone: string) {
  const rawDigits = phone.startsWith("+82") ? `0${phone.slice(3)}` : phone;
  const email = phoneToEmail(phone);
  const res = await fetch(`${SUPABASE_URL}/functions/v1/manage-account`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({
      action: "mark_pending_by_identity",
      phone,
      phone_raw: rawDigits,
      email,
    }),
  });

  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error((payload as any)?.error || "failed to mark pending");
  }

  return await res.json().catch(() => ({}));
}

async function getIdentityStatusByPhone(phone: string) {
  const rawDigits = phone.startsWith("+82") ? `0${phone.slice(3)}` : phone;
  const email = phoneToEmail(phone);
  const res = await fetch(`${SUPABASE_URL}/functions/v1/manage-account`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({
      action: "get_identity_status",
      phone,
      phone_raw: rawDigits,
      email,
    }),
  });

  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error((payload as any)?.error || "failed to get identity status");
  }

  return await res.json().catch(() => ({}));
}

export default function LoginScreen() {
  const router = useRouter();

  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [autoLogin, setAutoLogin] = useState(true);
  const [loginFailCount, setLoginFailCount] = useState(0);
  const [loginLocked, setLoginLocked] = useState(false);

  const originalAlertRef = useRef<typeof Alert.alert | null>(null);

  useEffect(() => {
    if (!originalAlertRef.current) originalAlertRef.current = Alert.alert;
    const original = originalAlertRef.current;

    // @ts-ignore
    Alert.alert = (title: any, message?: any, buttons?: any, options?: any) => {
      try {
        if (isSessionMissingPopup(String(title ?? ""), String(message ?? ""))) {
          return;
        }
      } catch {}
      return (original as any)(title, message, buttons, options);
    };

    return () => {
      if (originalAlertRef.current) {
        // @ts-ignore
        Alert.alert = originalAlertRef.current;
      }
    };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const v = await AsyncStorage.getItem(KEY_AUTO_LOGIN);
        if (v === "0") setAutoLogin(false);
      } catch {}
    })();
  }, []);

  const e164 = useMemo(() => toE164KR(phone.trim()), [phone]);
  const canSubmit = useMemo(() => !!e164 && password.trim().length >= 6, [e164, password]);

  useEffect(() => {
    (async () => {
      if (!e164) {
        setLoginFailCount(0);
        setLoginLocked(false);
        return;
      }

      try {
        const [countRaw, lockRaw] = await Promise.all([
          AsyncStorage.getItem(loginFailKey(e164)),
          AsyncStorage.getItem(loginLockKey(e164)),
        ]);
        const count = Number(countRaw ?? "0");
        const localCount = Number.isFinite(count) ? count : 0;
        const localLocked = lockRaw === "1";

        let serverPending = false;
        try {
          const status = await getIdentityStatusByPhone(e164);
          serverPending = String(status?.approval_status ?? "").trim() === "pending";
        } catch {}

        if (localLocked && !serverPending) {
          await Promise.all([
            AsyncStorage.removeItem(loginFailKey(e164)),
            AsyncStorage.removeItem(loginLockKey(e164)),
          ]);
          setLoginFailCount(0);
          setLoginLocked(false);
          return;
        }

        setLoginFailCount(localCount);
        setLoginLocked(localLocked && serverPending);
      } catch {
        setLoginFailCount(0);
        setLoginLocked(false);
      }
    })();
  }, [e164]);

  const toggleAutoLogin = async () => {
    const next = !autoLogin;
    setAutoLogin(next);
    try {
      await AsyncStorage.setItem(KEY_AUTO_LOGIN, next ? "1" : "0");
    } catch {}
  };

  const clearLoginFailState = async (targetE164: string) => {
    try {
      await Promise.all([
        AsyncStorage.removeItem(loginFailKey(targetE164)),
        AsyncStorage.removeItem(loginLockKey(targetE164)),
      ]);
    } catch {}
    setLoginFailCount(0);
    setLoginLocked(false);
  };

  const recordLoginFail = async (targetE164: string) => {
    const key = loginFailKey(targetE164);
    let nextCount = 1;
    let pendingResult: any = null;
    let pendingError = "";

    try {
      const prevRaw = await AsyncStorage.getItem(key);
      const prev = Number(prevRaw ?? "0");
      nextCount = Number.isFinite(prev) ? Math.min(prev + 1, MAX_LOGIN_FAILS) : 1;
      await AsyncStorage.setItem(key, String(nextCount));
    } catch {
      nextCount = 1;
    }

    setLoginFailCount(nextCount);

    if (nextCount < MAX_LOGIN_FAILS) {
      return { nextCount, pendingResult, pendingError };
    }

    try {
      pendingResult = await markProfilePendingByPhone(targetE164);
    } catch (e: any) {
      pendingError = String(e?.message ?? e ?? "");
    }

    if (!pendingError) {
      try {
        await AsyncStorage.setItem(loginLockKey(targetE164), "1");
      } catch {}
      setLoginLocked(true);
    }
    return { nextCount, pendingResult, pendingError };
  };

  const onLogin = async () => {
    if (!canSubmit || loading) return;

    setLoading(true);

    try {
      const pw = password.trim();
      let data: any = null;
      let err: any = null;

      const r1 = await supabase.auth.signInWithPassword({
        phone: e164!,
        password: pw,
      });
      data = r1.data;
      err = r1.error;

      if (err && isInvalidCreds(err)) {
        const email = phoneToEmail(e164!);
        const r2 = await supabase.auth.signInWithPassword({
          email,
          password: pw,
        });
        data = r2.data;
        err = r2.error;
      }

      if (err) throw err;
      if (!data?.user) throw new Error("로그인 세션을 만들지 못했습니다.");

      const { data: prof, error: pErr } = await supabase
        .from("profiles")
        .select("approval_status")
        .eq("id", data.user.id)
        .single();

      if (pErr) throw pErr;

      if (prof?.approval_status !== "approved") {
        await supabase.auth.signOut();
        Alert.alert("승인 대기", "관리자 승인 후 로그인할 수 있습니다.");
        return;
      }

      // 기기 1대 제한 체크
      const deviceId = await getOrCreateDeviceId();
      const { data: devProf } = await supabase
        .from("profiles")
        .select("device_id")
        .eq("id", data.user.id)
        .single();

      if (devProf?.device_id && devProf.device_id !== deviceId) {
        await supabase.auth.signOut();
        Alert.alert("로그인 불가", "이 계정은 다른 기기에서 이미 사용 중입니다.\n기기를 변경하려면 관리자에게 문의하세요.");
        return;
      }

      // 기기 등록 (신규 or 동일 기기 갱신)
      await supabase.from("profiles").update({ device_id: deviceId }).eq("id", data.user.id);

      try {
        await AsyncStorage.removeItem(POST_SIGNUP_LOGIN_KEY);
      } catch {}

      await clearLoginFailState(e164!);
    } catch (err: any) {
      const failState = e164 && isInvalidCreds(err) ? await recordLoginFail(e164) : { nextCount: 0, pendingResult: null, pendingError: "" };
      if (failState.nextCount >= MAX_LOGIN_FAILS) {
        if (failState.pendingError) {
          Alert.alert("로그인 실패", `5회 실패로 앱 잠금은 됐지만 승인대기 반영은 실패했습니다.\n${failState.pendingError}`);
          return;
        }

        Alert.alert("로그인 실패", "비밀번호를 5회 실패해서 승인대기 상태로 바뀌었습니다.");
        return;
      }

      Alert.alert("로그인 실패", mapAuthErrorToKo(err));
    } finally {
      setLoading(false);
    }
  };

  const failGuide = loginLocked
    ? "5회 실패로 승인대기 상태입니다.\n관리자 승인 후 다시 로그인해 주세요."
    : loginFailCount > 0
      ? `로그인 실패 ${loginFailCount}/${MAX_LOGIN_FAILS}`
      : "전화번호와 비밀번호로 로그인하세요.";

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#F6F7FB" }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            paddingHorizontal: 18,
            paddingTop: 26,
            paddingBottom: 28,
            flexGrow: 1,
            justifyContent: "center",
          }}
        >
          <View style={{ alignItems: "center", marginBottom: 18 }}>
            <Image
              source={require("../../assets/hanexpress-logo.png")}
              style={{ width: 260, height: 80, resizeMode: "contain" }}
            />
          </View>

          <View
            style={{
              backgroundColor: "#FFFFFF",
              borderRadius: 18,
              padding: 16,
              borderWidth: 1,
              borderColor: "#E5E7EB",
              gap: 12,
              shadowColor: "#000",
              shadowOpacity: 0.06,
              shadowRadius: 12,
              elevation: 2,
            }}
          >
            <Text style={{ fontSize: 20, fontWeight: "900", color: "#111827" }}>로그인</Text>

            <View style={{ gap: 6 }}>
              <Text style={{ color: "#374151", fontWeight: "800" }}>전화번호</Text>
              <TextInput
                value={phone}
                onChangeText={setPhone}
                placeholder="01012345678"
                placeholderTextColor="#9CA3AF"
                keyboardType="phone-pad"
                autoCapitalize="none"
                autoCorrect={false}
                editable={!loading}
                style={{
                  backgroundColor: "#F9FAFB",
                  borderWidth: 1,
                  borderColor: e164 || phone.length === 0 ? "#E5E7EB" : "#EF4444",
                  borderRadius: 12,
                  paddingHorizontal: 12,
                  paddingVertical: 12,
                  color: "#111827",
                }}
              />
              <Text style={{ color: "#9CA3AF", fontSize: 12 }}>하이픈 없이 입력해도 됩니다.</Text>
            </View>

            <View style={{ gap: 6 }}>
              <Text style={{ color: "#374151", fontWeight: "800" }}>비밀번호</Text>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  backgroundColor: "#F9FAFB",
                  borderWidth: 1,
                  borderColor: "#E5E7EB",
                  borderRadius: 12,
                  paddingHorizontal: 12,
                }}
              >
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder="6자 이상"
                  placeholderTextColor="#9CA3AF"
                  secureTextEntry={!showPw}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!loading}
                  style={{ flex: 1, paddingVertical: 12, color: "#111827" }}
                />
                <Pressable onPress={() => setShowPw((v) => !v)} style={{ paddingLeft: 10, paddingVertical: 10 }} disabled={loading}>
                  <Text style={{ color: "#2563EB", fontWeight: "900" }}>{showPw ? "숨김" : "표시"}</Text>
                </Pressable>
              </View>
            </View>

            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                marginTop: 2,
              }}
            >
              <Pressable onPress={toggleAutoLogin} disabled={loading} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 6,
                    borderWidth: 2,
                    borderColor: autoLogin ? "#2563EB" : "#CBD5E1",
                    backgroundColor: autoLogin ? "#2563EB" : "#FFFFFF",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {autoLogin ? <Text style={{ color: "#fff", fontWeight: "900" }}>✓</Text> : null}
                </View>
                <Text style={{ color: "#111827", fontWeight: "900" }}>자동로그인</Text>
              </Pressable>

              <Pressable onPress={() => router.push("/(auth)/reset-password" as any)} disabled={loading}>
                <Text style={{ color: "#2563EB", fontWeight: "900" }}>비밀번호 재설정</Text>
              </Pressable>
            </View>

            <View style={{ marginTop: 4, marginBottom: 2 }}>
              <Text style={{ color: "#6B7280", textAlign: "center" }}>{failGuide}</Text>
              {!loginLocked && loginFailCount > 0 ? (
                <Text style={{ marginTop: 6, color: "#DC2626", textAlign: "center", fontWeight: "800" }}>
                  5회 실패하면 승인대기 상태로 변경됩니다.
                </Text>
              ) : null}
            </View>

            <Pressable
              onPress={onLogin}
              disabled={!canSubmit || loading}
              style={{
                height: 46,
                borderRadius: 12,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: !canSubmit || loading ? "#CBD5E1" : "#2563EB",
                marginTop: 6,
              }}
            >
              {loading ? (
                <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
                  <ActivityIndicator color="#fff" />
                  <Text style={{ color: "#fff", fontWeight: "900" }}>처리 중...</Text>
                </View>
              ) : (
                <Text style={{ color: "#fff", fontWeight: "900" }}>로그인</Text>
              )}
            </Pressable>

            <Pressable onPress={() => router.push("/(auth)/signup" as any)} disabled={loading} style={{ alignItems: "center", paddingVertical: 4 }}>
              <Text style={{ color: "#2563EB", fontWeight: "900" }}>회원가입</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
