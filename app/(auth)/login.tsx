import AsyncStorage from "@react-native-async-storage/async-storage";
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
import { supabase } from "../../src/lib/supabase";

const KEY_AUTO_LOGIN = "hx_auto_login";

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

function isSessionMissingPopup(title?: string, message?: string) {
  const t = (title ?? "").toLowerCase();
  const m = (message ?? "").toLowerCase();
  return (
    t.includes("로그인 필요") ||
    m.includes("세션이 없습니다") ||
    m.includes("로그인 후 다시") ||
    t.includes("login required") ||
    (m.includes("session") && m.includes("login"))
  );
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
    return "휴대폰 인증이 완료되지 않은 계정입니다.";
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

export default function LoginScreen() {
  const router = useRouter();

  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [autoLogin, setAutoLogin] = useState(true);

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

  const toggleAutoLogin = async () => {
    const next = !autoLogin;
    setAutoLogin(next);
    try {
      await AsyncStorage.setItem(KEY_AUTO_LOGIN, next ? "1" : "0");
    } catch {}
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
    } catch (err: any) {
      Alert.alert("로그인 실패", mapAuthErrorToKo(err));
    } finally {
      setLoading(false);
    }
  };

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
            <Text style={{ marginTop: 10, color: "#6B7280", textAlign: "center" }}>
              전화번호와 비밀번호로 로그인하세요.
            </Text>
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
                <Pressable
                  onPress={() => setShowPw((v) => !v)}
                  style={{ paddingLeft: 10, paddingVertical: 10 }}
                  disabled={loading}
                >
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
              <Pressable
                onPress={toggleAutoLogin}
                disabled={loading}
                style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
              >
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

            <Pressable
              onPress={() => router.push("/(auth)/signup" as any)}
              disabled={loading}
              style={{ alignItems: "center", paddingVertical: 4 }}
            >
              <Text style={{ color: "#2563EB", fontWeight: "900" }}>회원가입</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
