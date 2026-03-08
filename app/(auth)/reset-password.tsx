import { useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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

function mapAuthErrorToKo(err: any) {
  const msg = String(err?.message ?? "").toLowerCase();

  if (!msg) return "처리 중 오류가 발생했습니다.";
  if (msg.includes("invalid otp") || msg.includes("token has expired")) {
    return "인증코드가 올바르지 않거나 만료되었습니다.";
  }
  if (msg.includes("password should be at least")) {
    return "비밀번호는 6자 이상이어야 합니다.";
  }
  if (msg.includes("same as the old password")) {
    return "이전 비밀번호와 다른 비밀번호를 입력해 주세요.";
  }
  if (msg.includes("too many requests") || msg.includes("rate limit")) {
    return "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.";
  }
  if (msg.includes("network") || msg.includes("fetch failed")) {
    return "네트워크 연결을 확인해 주세요.";
  }
  return err?.message ?? "처리 중 오류가 발생했습니다.";
}

export default function ResetPasswordScreen() {
  const router = useRouter();

  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [showPw2, setShowPw2] = useState(false);
  const [loading, setLoading] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [lockedPhone, setLockedPhone] = useState<string | null>(null);

  const e164 = useMemo(() => toE164KR(phone.trim()), [phone]);
  const pwMatch = useMemo(() => newPw.trim().length >= 6 && newPw.trim() === newPw2.trim(), [newPw, newPw2]);
  const canSendOtp = !!e164 && !loading && !otpSent;
  const canReset = !!lockedPhone && otp.trim().length >= 4 && pwMatch && !loading;

  const onSendOtp = async () => {
    if (!canSendOtp) return;
    setLoading(true);
    try {
      const target = e164!;
      const { data: exists, error: checkErr } = await supabase.rpc("check_phone_exists", {
        p_phone: target,
      });
      if (checkErr) throw checkErr;
      if (!exists) {
        Alert.alert("안내", "가입된 전화번호가 아닙니다. 회원가입을 먼저 진행해 주세요.");
        return;
      }

      const { error } = await supabase.auth.signInWithOtp({ phone: target });
      if (error) throw error;

      setLockedPhone(target);
      setOtpSent(true);
      Alert.alert("인증코드 발송", "문자로 받은 인증코드를 입력해 주세요.");
    } catch (err: any) {
      Alert.alert("발송 실패", mapAuthErrorToKo(err));
    } finally {
      setLoading(false);
    }
  };

  const onResetPassword = async () => {
    if (!canReset) return;
    setLoading(true);
    try {
      const target = lockedPhone!;
      const token = otp.trim();

      const { data: otpData, error: otpErr } = await supabase.auth.verifyOtp({
        phone: target,
        token,
        type: "sms",
      });
      if (otpErr) throw otpErr;

      if (otpData?.session) {
        const { error: sessErr } = await supabase.auth.setSession({
          access_token: otpData.session.access_token,
          refresh_token: otpData.session.refresh_token,
        });
        if (sessErr) throw sessErr;
      }

      const { error: upErr } = await supabase.auth.updateUser({
        password: newPw.trim(),
      });
      if (upErr) throw upErr;

      await supabase.auth.signOut();
      Alert.alert("완료", "비밀번호가 변경되었습니다. 새 비밀번호로 로그인해 주세요.", [
        { text: "확인", onPress: () => router.replace("/(auth)/login") },
      ]);
    } catch (err: any) {
      Alert.alert("재설정 실패", mapAuthErrorToKo(err));
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
            paddingTop: 24,
            paddingBottom: 30,
            flexGrow: 1,
            justifyContent: "center",
          }}
        >
          <View
            style={{
              backgroundColor: "#FFFFFF",
              borderRadius: 18,
              padding: 16,
              borderWidth: 1,
              borderColor: "#E5E7EB",
              gap: 12,
            }}
          >
            <Text style={{ fontSize: 22, fontWeight: "900", color: "#111827" }}>비밀번호 재설정</Text>
            <Text style={{ color: "#6B7280" }}>
              웹과 동일하게 인증코드를 받아 확인한 뒤 새 비밀번호로 변경합니다.
            </Text>

            <View style={{ gap: 6 }}>
              <Text style={{ color: "#374151", fontWeight: "800" }}>전화번호</Text>
              <TextInput
                value={phone}
                onChangeText={setPhone}
                editable={!loading && !otpSent}
                placeholder="01012345678"
                placeholderTextColor="#9CA3AF"
                keyboardType="phone-pad"
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
            </View>

            <Pressable
              onPress={onSendOtp}
              disabled={!canSendOtp}
              style={{
                height: 44,
                borderRadius: 12,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: canSendOtp ? "#2563EB" : "#CBD5E1",
              }}
            >
              {loading && !otpSent ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={{ color: "#fff", fontWeight: "900" }}>인증코드 받기</Text>
              )}
            </Pressable>

            {otpSent ? (
              <>
                <View style={{ gap: 6 }}>
                  <Text style={{ color: "#374151", fontWeight: "800" }}>인증코드</Text>
                  <TextInput
                    value={otp}
                    onChangeText={setOtp}
                    editable={!loading}
                    keyboardType="number-pad"
                    placeholder="문자로 받은 코드"
                    placeholderTextColor="#9CA3AF"
                    style={{
                      backgroundColor: "#F9FAFB",
                      borderWidth: 1,
                      borderColor: "#E5E7EB",
                      borderRadius: 12,
                      paddingHorizontal: 12,
                      paddingVertical: 12,
                      color: "#111827",
                    }}
                  />
                </View>

                <View style={{ gap: 6 }}>
                  <Text style={{ color: "#374151", fontWeight: "800" }}>새 비밀번호</Text>
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
                      value={newPw}
                      onChangeText={setNewPw}
                      secureTextEntry={!showPw}
                      editable={!loading}
                      placeholder="6자 이상"
                      placeholderTextColor="#9CA3AF"
                      style={{ flex: 1, paddingVertical: 12, color: "#111827" }}
                    />
                    <Pressable onPress={() => setShowPw((v) => !v)} disabled={loading}>
                      <Text style={{ color: "#2563EB", fontWeight: "900" }}>{showPw ? "숨김" : "표시"}</Text>
                    </Pressable>
                  </View>
                </View>

                <View style={{ gap: 6 }}>
                  <Text style={{ color: "#374151", fontWeight: "800" }}>새 비밀번호 확인</Text>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      backgroundColor: "#F9FAFB",
                      borderWidth: 1,
                      borderColor: newPw2.length === 0 || pwMatch ? "#E5E7EB" : "#EF4444",
                      borderRadius: 12,
                      paddingHorizontal: 12,
                    }}
                  >
                    <TextInput
                      value={newPw2}
                      onChangeText={setNewPw2}
                      secureTextEntry={!showPw2}
                      editable={!loading}
                      placeholder="비밀번호 다시 입력"
                      placeholderTextColor="#9CA3AF"
                      style={{ flex: 1, paddingVertical: 12, color: "#111827" }}
                    />
                    <Pressable onPress={() => setShowPw2((v) => !v)} disabled={loading}>
                      <Text style={{ color: "#2563EB", fontWeight: "900" }}>{showPw2 ? "숨김" : "표시"}</Text>
                    </Pressable>
                  </View>
                  {!pwMatch && newPw2.length > 0 ? (
                    <Text style={{ color: "#EF4444", fontSize: 12 }}>비밀번호가 일치하지 않습니다.</Text>
                  ) : null}
                </View>

                <Pressable
                  onPress={onResetPassword}
                  disabled={!canReset}
                  style={{
                    height: 46,
                    borderRadius: 12,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: canReset ? "#16A34A" : "#CBD5E1",
                  }}
                >
                  {loading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={{ color: "#fff", fontWeight: "900" }}>비밀번호 변경</Text>
                  )}
                </Pressable>
              </>
            ) : null}

            <Pressable onPress={() => router.replace("/(auth)/login")} disabled={loading} style={{ alignItems: "center", paddingVertical: 6 }}>
              <Text style={{ color: "#2563EB", fontWeight: "900" }}>로그인 화면으로</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
