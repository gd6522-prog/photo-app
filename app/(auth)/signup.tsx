import { Picker } from "@react-native-picker/picker";
import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { localeFromNationality, setLocale } from "../../src/lib/locale";
import { supabase } from "../../src/lib/supabase";
import { getWorkPartOptionsIncludeDriver, Option } from "../../src/lib/workParts";

// ✅ 작업파트: 기존 + 임시직 추가
const WORK_PARTS: Option[] = [
  ...getWorkPartOptionsIncludeDriver(),
  { label: "임시직", value: "임시직" },
];

// ✅ 국적: 지정 6개 + 직접입력
const NATIONALITIES: Option[] = [
  { label: "대한민국 (KR)", value: "KR" },
  { label: "중국 (CN)", value: "CN" },
  { label: "러시아 (RU)", value: "RU" },
  { label: "우즈베키스탄 (UZ)", value: "UZ" },
  { label: "카자흐스탄 (KZ)", value: "KZ" },
  { label: "키르키스스탄 (KG)", value: "KG" },
  { label: "직접입력", value: "CUSTOM" },
];

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

function isValidBirth8(v: string) {
  if (!/^\d{8}$/.test(v)) return false;
  const y = Number(v.slice(0, 4));
  const m = Number(v.slice(4, 6));
  const d = Number(v.slice(6, 8));
  if (y < 1900 || y > 2100) return false;
  if (m < 1 || m > 12) return false;

  const dt = new Date(
    `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T00:00:00`
  );
  if (Number.isNaN(dt.getTime())) return false;
  return dt.getFullYear() === y && dt.getMonth() + 1 === m && dt.getDate() === d;
}

function birth8ToDash(v: string) {
  return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
}

function OneLineSelect({
  label,
  value,
  placeholder,
  options,
  disabled,
  onPress,
}: {
  label: string;
  value: string;
  placeholder: string;
  options?: Option[];
  disabled?: boolean;
  onPress: () => void;
}) {
  const safeOptions = options ?? [];
  const selectedLabel =
    safeOptions.find((o) => o.value === value)?.label || (value ? value : "");

  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: "#374151", fontWeight: "800" }}>{label}</Text>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        style={{
          backgroundColor: "#F9FAFB",
          borderWidth: 1,
          borderColor: "#E5E7EB",
          borderRadius: 12,
          paddingHorizontal: 12,
          height: 46,
          justifyContent: "center",
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <Text style={{ color: selectedLabel ? "#111827" : "#9CA3AF", fontWeight: "800" }}>
          {selectedLabel || placeholder}
        </Text>
      </Pressable>
    </View>
  );
}

function PickerModal({
  visible,
  title,
  value,
  options,
  onClose,
  onChange,
}: {
  visible: boolean;
  title: string;
  value: string;
  options: Option[];
  onClose: () => void;
  onChange: (v: string) => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "flex-end" }}
      >
        <Pressable
          onPress={() => {}}
          style={{
            backgroundColor: "#fff",
            borderTopLeftRadius: 18,
            borderTopRightRadius: 18,
            paddingBottom: 18,
            overflow: "hidden",
          }}
        >
          <View
            style={{
              paddingHorizontal: 16,
              paddingTop: 12,
              paddingBottom: 10,
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              borderBottomWidth: 1,
              borderBottomColor: "#E5E7EB",
            }}
          >
            <Text style={{ fontSize: 16, fontWeight: "900", color: "#111827" }}>{title}</Text>
            <Pressable onPress={onClose} style={{ paddingVertical: 6, paddingHorizontal: 10 }}>
              <Text style={{ color: "#2563EB", fontWeight: "900" }}>완료</Text>
            </Pressable>
          </View>

          <Picker selectedValue={value} onValueChange={(v) => onChange(String(v))}>
            {options.map((o) => (
              <Picker.Item key={o.value || "empty"} label={o.label} value={o.value} />
            ))}
          </Picker>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export default function SignupScreen() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [pw2Touched, setPw2Touched] = useState(false);

  const [birth8, setBirth8] = useState("");

  // ✅ nationality = 선택값(KR/CN/.../CUSTOM)
  const [nationality, setNationality] = useState("KR");
  // ✅ 직접 입력값
  const [nationalityCustom, setNationalityCustom] = useState("");

  const [workPart, setWorkPart] = useState("");

  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [lockedE164, setLockedE164] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [checkingPhone, setCheckingPhone] = useState(false);

  const [workPartOpen, setWorkPartOpen] = useState(false);
  const [nationOpen, setNationOpen] = useState(false);

  // ✅ 전화번호 사전 확인 상태
  const [phoneChecked, setPhoneChecked] = useState(false);
  const [phoneExists, setPhoneExists] = useState<boolean | null>(null); // null=미확인, true=이미있음, false=사용가능
  const [checkedE164, setCheckedE164] = useState<string | null>(null);

  const e164 = useMemo(() => toE164KR(phone.trim()), [phone]);
  const birthOk = useMemo(() => isValidBirth8(birth8.trim()), [birth8]);

  // ✅ 최종 국적(DB 저장용): CUSTOM이면 직접입력값, 아니면 코드
  const nationalityFinal = useMemo(() => {
    if (nationality === "CUSTOM") return nationalityCustom.trim();
    return nationality.trim();
  }, [nationality, nationalityCustom]);

  // ✅ 직접입력일 때만 국적 유효성 체크
  const nationalityOk = useMemo(() => {
    if (nationality !== "CUSTOM") return nationality.trim().length > 0;
    return nationalityCustom.trim().length >= 2;
  }, [nationality, nationalityCustom]);

  const passOk = useMemo(() => {
    const p = password.trim();
    const p2 = password2.trim();
    return p.length >= 6 && p === p2;
  }, [password, password2]);

  const passMismatch = useMemo(() => {
    const p = password.trim();
    const p2 = password2.trim();
    if (!pw2Touched) return false;
    if (p2.length === 0) return false;
    if (p.length === 0) return false;
    return p !== p2;
  }, [password, password2, pw2Touched]);

  // ✅ 입력 전화번호가 바뀌면 "확인"을 다시 하게 만들기
  useEffect(() => {
    setPhoneChecked(false);
    setPhoneExists(null);
    setCheckedE164(null);
  }, [e164]);

  // ✅ 국적이 CUSTOM이 아니면 직접입력칸 초기화
  useEffect(() => {
    if (nationality !== "CUSTOM") setNationalityCustom("");
  }, [nationality]);

  const baseFormOk = useMemo(() => {
    return (
      name.trim().length >= 2 &&
      !!e164 &&
      passOk &&
      birthOk &&
      nationalityOk &&
      workPart.trim().length > 0
    );
  }, [name, e164, passOk, birthOk, nationalityOk, workPart]);

  // ✅ 가입 진행 조건: 기본폼 OK + 전화번호 확인 완료 + (이미가입 아님)
  const formOk = useMemo(() => {
    return baseFormOk && phoneChecked && phoneExists === false && checkedE164 === e164;
  }, [baseFormOk, phoneChecked, phoneExists, checkedE164, e164]);

  const canCheckPhone = !!e164 && !loading && !otpSent && !checkingPhone;
  const canSendOtp = formOk && !loading && !otpSent;
  const canVerify = !!lockedE164 && otp.trim().length >= 4 && !loading && otpSent;

  const hardSignOut = async () => {
    try {
      await supabase.auth.signOut();
    } catch {}
  };

  const resetToNewPhone = async () => {
    await hardSignOut();
    setOtp("");
    setOtpSent(false);
    setLockedE164(null);

    // 전화번호 확인 상태 초기화
    setPhoneChecked(false);
    setPhoneExists(null);
    setCheckedE164(null);
  };

  const onCheckPhone = async () => {
    if (!canCheckPhone) return;

    setCheckingPhone(true);
    try {
      if (!e164) throw new Error("전화번호 형식이 올바르지 않습니다.");

      // ✅ RLS 영향 없이 “존재 여부”만 확인 (DB에 만든 RPC 사용)
      const { data, error } = await supabase.rpc("check_phone_exists", {
        p_phone: e164,
      });
      if (error) throw error;

      const exists = !!data;

      setPhoneChecked(true);
      setPhoneExists(exists);
      setCheckedE164(e164);

      if (exists) {
        Alert.alert(
          "이미 가입된 전화번호",
          "이 번호는 이미 가입되어 있어요. 로그인할까요? 아니면 다른 번호로 다시 만들까요?",
          [
            {
              text: "로그인",
              onPress: () => router.replace("/(auth)/login"),
              style: "default",
            },
            {
              text: "다시 만들기",
              onPress: () => {
                resetToNewPhone();
              },
              style: "destructive",
            },
            { text: "취소", style: "cancel" },
          ]
        );
      } else {
        Alert.alert("확인 완료", "가입 가능한 전화번호입니다. 계속 진행하세요.");
      }
    } catch (err: any) {
      setPhoneChecked(false);
      setPhoneExists(null);
      setCheckedE164(null);
      Alert.alert("확인 실패", err?.message ?? JSON.stringify(err));
    } finally {
      setCheckingPhone(false);
    }
  };

  const onSendOtp = async () => {
    if (!canSendOtp) return;

    setLoading(true);
    try {
      if (!e164) throw new Error("전화번호 형식이 올바르지 않습니다.");
      if (!phoneChecked || phoneExists !== false || checkedE164 !== e164) {
        throw new Error("전화번호 확인을 먼저 진행해주세요.");
      }
      if (!nationalityOk) {
        throw new Error("국적을 입력/선택해주세요.");
      }

      // ✅ locale: KR이면 KR, 나머지는 ETC로 fallback
      const lang = localeFromNationality(nationality === "KR" ? "KR" : "ETC");
      const birthdateDashed = birth8ToDash(birth8.trim());

      const { error } = await supabase.auth.signInWithOtp({
        phone: e164,
        options: {
          data: {
            name: name.trim(),
            work_part: workPart.trim(),
            phone: e164,
            phone_verified: false,
            birthdate: birthdateDashed,
            nationality: nationalityFinal,
            language: lang,
          },
        },
      });

      if (error) throw error;

      setLockedE164(e164);
      setOtpSent(true);
      Alert.alert("인증번호 발송", "문자로 인증번호가 발송되었습니다.");
    } catch (err: any) {
      setLockedE164(null);
      setOtpSent(false);
      setOtp("");
      Alert.alert("발송 실패", err?.message ?? JSON.stringify(err));
    } finally {
      setLoading(false);
    }
  };

  const onVerify = async () => {
    if (!canVerify) return;

    setLoading(true);
    try {
      const e164Fixed = lockedE164!;
      if (!nationalityOk) throw new Error("국적을 입력/선택해주세요.");

      const lang = localeFromNationality(nationality === "KR" ? "KR" : "ETC");
      const birthdateDashed = birth8ToDash(birth8.trim());

      const { data: otpData, error: otpErr } = await supabase.auth.verifyOtp({
        phone: e164Fixed,
        token: otp.trim(),
        type: "sms",
      });
      if (otpErr) throw otpErr;

      const userId = otpData?.user?.id;
      if (!userId) throw new Error("OTP 인증은 됐는데 user id를 못 받았어요.");

      if (otpData?.session) {
        const { error: sessErr } = await supabase.auth.setSession({
          access_token: otpData.session.access_token,
          refresh_token: otpData.session.refresh_token,
        });
        if (sessErr) throw sessErr;
      }

      // ✅ 비밀번호 설정 + 메타데이터 저장
      const { error: upErr } = await supabase.auth.updateUser({
        password: password.trim(),
        data: {
          name: name.trim(),
          work_part: workPart.trim(),
          phone: e164Fixed,
          phone_verified: true,
          birthdate: birthdateDashed,
          nationality: nationalityFinal,
          language: lang,
        },
      });

      // ✅ 이미 같은 비번이 설정된 “기존 계정”이면 안내하고 로그인 유도
      if (upErr) {
        const msg = String(upErr?.message ?? "");
        if (msg.toLowerCase().includes("new password should be different")) {
          await hardSignOut();
          Alert.alert(
            "이미 가입된 번호",
            "이 번호는 이미 가입되어 있어요. 비밀번호로 로그인해주세요.",
            [
              { text: "로그인", onPress: () => router.replace("/(auth)/login") },
              { text: "확인", style: "cancel" },
            ]
          );
          return;
        }
        throw upErr;
      }

      const { error: profErr } = await supabase
        .from("profiles")
        .upsert(
          {
            id: userId,
            phone: e164Fixed,
            name: name.trim(),
            work_part: workPart.trim(),
            birthdate: birthdateDashed,
            nationality: nationalityFinal,
            language: lang,
            phone_verified: true,
          },
          { onConflict: "id" }
        );

      if (profErr) throw profErr;

      await setLocale(lang);

      // ✅ (중요) 라우팅보다 먼저 세션 정리
      await hardSignOut();

      // ✅ (중요) 즉시 로그인 화면으로 “단독 이동” (AuthGate 경합 방지)
      router.replace("/(auth)/login");
      queueMicrotask(() => router.replace("/(auth)/login"));

      // ✅ Alert는 라우팅 이후에 띄우기
      setTimeout(() => {
        Alert.alert("가입 완료", "승인 대기 상태입니다. 승인되면 로그인 가능합니다.");
      }, 50);
    } catch (err: any) {
      await hardSignOut();
      Alert.alert("가입 실패", err?.message ?? JSON.stringify(err));
    } finally {
      setLoading(false);
    }
  };

  const onResetPhone = async () => {
    await resetToNewPhone();
  };

  const phoneStatusText = useMemo(() => {
    if (!e164) return null;
    if (!phoneChecked || checkedE164 !== e164) return { text: "전화번호 확인이 필요합니다.", color: "#9CA3AF" };
    if (phoneExists === true) return { text: "이미 가입된 전화번호입니다.", color: "#EF4444" };
    if (phoneExists === false) return { text: "사용 가능한 전화번호입니다.", color: "#16A34A" };
    return null;
  }, [e164, phoneChecked, phoneExists, checkedE164]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#F6F7FB" }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            paddingHorizontal: 18,
            paddingTop: 18,
            paddingBottom: 28,
            flexGrow: 1,
          }}
        >
          <View style={{ alignItems: "center", marginBottom: 14 }}>
            <Image
              source={require("../../assets/hanexpress-logo.png")}
              style={{ width: 240, height: 70, resizeMode: "contain" }}
            />
            <Text style={{ marginTop: 8, color: "#6B7280", textAlign: "center" }}>
              가입 시 1회 문자 인증 후, 전화번호+비밀번호로 로그인합니다.
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
            <Text style={{ fontSize: 20, fontWeight: "900", color: "#111827" }}>회원가입</Text>

            <View style={{ gap: 6 }}>
              <Text style={{ color: "#374151", fontWeight: "800" }}>이름</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="홍길동"
                placeholderTextColor="#9CA3AF"
                editable={!loading && !otpSent}
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

            {/* ✅ 전화번호 + 확인 버튼 */}
            <View style={{ gap: 6 }}>
              <Text style={{ color: "#374151", fontWeight: "800" }}>전화번호</Text>

              <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
                <View style={{ flex: 1 }}>
                  <TextInput
                    value={phone}
                    onChangeText={setPhone}
                    placeholder="01012345678"
                    placeholderTextColor="#9CA3AF"
                    keyboardType="phone-pad"
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!loading && !otpSent && !checkingPhone}
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
                  onPress={onCheckPhone}
                  disabled={!canCheckPhone}
                  style={{
                    height: 46,
                    paddingHorizontal: 12,
                    borderRadius: 12,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: !canCheckPhone ? "#CBD5E1" : "#111827",
                    minWidth: 96,
                  }}
                >
                  {checkingPhone ? (
                    <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                      <ActivityIndicator color="#fff" />
                      <Text style={{ color: "#fff", fontWeight: "900" }}>확인중</Text>
                    </View>
                  ) : (
                    <Text style={{ color: "#fff", fontWeight: "900" }}>
                      {phoneChecked && checkedE164 === e164 && phoneExists === false ? "확인됨" : "확인"}
                    </Text>
                  )}
                </Pressable>
              </View>

              {phoneStatusText ? (
                <Text style={{ color: phoneStatusText.color, fontSize: 12, fontWeight: "700" }}>
                  {phoneStatusText.text}
                </Text>
              ) : null}
            </View>

            <View style={{ gap: 6 }}>
              <Text style={{ color: "#374151", fontWeight: "800" }}>비밀번호</Text>
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="6자 이상"
                placeholderTextColor="#9CA3AF"
                secureTextEntry
                editable={!loading && !otpSent}
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
              <Text style={{ color: "#374151", fontWeight: "800" }}>비밀번호 확인</Text>
              <TextInput
                value={password2}
                onChangeText={(t) => {
                  setPassword2(t);
                  if (!pw2Touched) setPw2Touched(true);
                }}
                onBlur={() => setPw2Touched(true)}
                placeholder="비밀번호 다시 입력"
                placeholderTextColor="#9CA3AF"
                secureTextEntry
                editable={!loading && !otpSent}
                style={{
                  backgroundColor: "#F9FAFB",
                  borderWidth: 1,
                  borderColor: passMismatch ? "#EF4444" : "#E5E7EB",
                  borderRadius: 12,
                  paddingHorizontal: 12,
                  paddingVertical: 12,
                  color: "#111827",
                }}
              />
              {passMismatch ? (
                <Text style={{ color: "#EF4444", fontSize: 12, fontWeight: "700" }}>비밀번호가 다릅니다.</Text>
              ) : null}
            </View>

            <View style={{ gap: 6 }}>
              <Text style={{ color: "#374151", fontWeight: "800" }}>생년월일</Text>
              <TextInput
                value={birth8}
                onChangeText={(t) => setBirth8(t.replace(/\D/g, "").slice(0, 8))}
                placeholder="YYYYMMDD (예: 19950821)"
                placeholderTextColor="#9CA3AF"
                keyboardType="number-pad"
                editable={!loading && !otpSent}
                style={{
                  backgroundColor: "#F9FAFB",
                  borderWidth: 1,
                  borderColor: birth8.length === 0 || birthOk ? "#E5E7EB" : "#EF4444",
                  borderRadius: 12,
                  paddingHorizontal: 12,
                  paddingVertical: 12,
                  color: "#111827",
                }}
              />
            </View>

            <OneLineSelect
              label="국적"
              value={nationality}
              placeholder="선택"
              options={NATIONALITIES}
              disabled={loading || otpSent}
              onPress={() => setNationOpen(true)}
            />

            {nationality === "CUSTOM" ? (
              <View style={{ gap: 6 }}>
                <Text style={{ color: "#374151", fontWeight: "800" }}>국적 직접입력</Text>
                <TextInput
                  value={nationalityCustom}
                  onChangeText={setNationalityCustom}
                  placeholder="예: 베트남 / 몽골 / 태국"
                  placeholderTextColor="#9CA3AF"
                  editable={!loading && !otpSent}
                  style={{
                    backgroundColor: "#F9FAFB",
                    borderWidth: 1,
                    borderColor: nationalityOk ? "#E5E7EB" : "#EF4444",
                    borderRadius: 12,
                    paddingHorizontal: 12,
                    paddingVertical: 12,
                    color: "#111827",
                  }}
                />
                {!nationalityOk ? (
                  <Text style={{ color: "#EF4444", fontSize: 12, fontWeight: "700" }}>
                    국적을 2글자 이상 입력해주세요.
                  </Text>
                ) : null}
              </View>
            ) : null}

            <OneLineSelect
              label="작업파트"
              value={workPart}
              placeholder="선택"
              options={WORK_PARTS}
              disabled={loading || otpSent}
              onPress={() => setWorkPartOpen(true)}
            />

            {!otpSent ? (
              <Pressable
                onPress={onSendOtp}
                disabled={!canSendOtp}
                style={{
                  height: 46,
                  borderRadius: 12,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: !canSendOtp ? "#CBD5E1" : "#2563EB",
                }}
              >
                {loading ? (
                  <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
                    <ActivityIndicator color="#fff" />
                    <Text style={{ color: "#fff", fontWeight: "900" }}>처리 중</Text>
                  </View>
                ) : (
                  <Text style={{ color: "#fff", fontWeight: "900" }}>인증번호 받기</Text>
                )}
              </Pressable>
            ) : (
              <>
                <View style={{ gap: 6 }}>
                  <Text style={{ color: "#374151", fontWeight: "800" }}>인증번호</Text>
                  <TextInput
                    value={otp}
                    onChangeText={(t) => setOtp(t.replace(/\D/g, "").slice(0, 8))}
                    placeholder="문자로 받은 인증번호"
                    placeholderTextColor="#9CA3AF"
                    keyboardType="number-pad"
                    editable={!loading}
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

                <Pressable
                  onPress={onVerify}
                  disabled={!canVerify}
                  style={{
                    height: 46,
                    borderRadius: 12,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: !canVerify ? "#CBD5E1" : "#16A34A",
                  }}
                >
                  {loading ? (
                    <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
                      <ActivityIndicator color="#fff" />
                      <Text style={{ color: "#fff", fontWeight: "900" }}>처리 중</Text>
                    </View>
                  ) : (
                    <Text style={{ color: "#fff", fontWeight: "900" }}>인증 완료하고 가입</Text>
                  )}
                </Pressable>

                <Pressable onPress={onResetPhone} disabled={loading} style={{ alignItems: "center", paddingVertical: 6 }}>
                  <Text style={{ color: "#2563EB", fontWeight: "900" }}>전화번호 다시 입력</Text>
                </Pressable>
              </>
            )}

            <Pressable
              onPress={() => router.replace("/(auth)/login")}
              disabled={loading}
              style={{ alignItems: "center", paddingVertical: 8 }}
            >
              <Text style={{ color: "#2563EB", fontWeight: "900" }}>로그인으로 돌아가기</Text>
            </Pressable>
          </View>

          <PickerModal
            visible={nationOpen}
            title="국적 선택"
            value={nationality}
            options={NATIONALITIES}
            onClose={() => setNationOpen(false)}
            onChange={(v) => setNationality(v)}
          />
          <PickerModal
            visible={workPartOpen}
            title="작업파트 선택"
            value={workPart}
            options={WORK_PARTS}
            onClose={() => setWorkPartOpen(false)}
            onChange={(v) => setWorkPart(v)}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}