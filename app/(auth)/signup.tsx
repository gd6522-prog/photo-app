import { Picker } from "@react-native-picker/picker";
import { useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
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

const WORK_PARTS = [
  { label: "선택", value: "" },
  { label: "박스존", value: "박스존" },
  { label: "이너존", value: "이너존" },
  { label: "슬라존", value: "슬라존" },
  { label: "경량존", value: "경량존" },
  { label: "이형존", value: "이형존" },
  { label: "담배존", value: "담배존" },
  { label: "관리자", value: "관리자" },
  { label: "기사", value: "기사" },
];

const NATIONALITIES = [
  { label: "대한민국 (KR)", value: "KR" },
  { label: "미국 (US)", value: "US" },
  { label: "영국 (UK)", value: "UK" },
  { label: "일본 (JP)", value: "JP" },
  { label: "중국 (CN)", value: "CN" },
  { label: "대만 (TW)", value: "TW" },
  { label: "홍콩 (HK)", value: "HK" },
  { label: "캐나다 (CA)", value: "CA" },
  { label: "호주 (AU)", value: "AU" },
  { label: "기타 (ETC)", value: "ETC" },
];

// 한국 전화번호 -> E.164 (+82...)
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

// pseudo email (테스트용 예약 TLD .invalid)
function pseudoEmailFromPhoneE164(e164: string) {
  const digits = e164.replace(/\D/g, "");
  return `u${digits}@phone.invalid`;
}

// YYYY-MM-DD 검증
function isValidDateYYYYMMDD(v: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(v + "T00:00:00");
  if (Number.isNaN(d.getTime())) return false;
  const [y, m, day] = v.split("-").map(Number);
  return d.getFullYear() === y && d.getMonth() + 1 === m && d.getDate() === day;
}

type Option = { label: string; value: string };

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
  options: Option[];
  disabled?: boolean;
  onPress: () => void;
}) {
  const selectedLabel =
    options.find((o) => o.value === value)?.label || (value ? value : "");

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
        <Text
          style={{
            color: selectedLabel ? "#111827" : "#9CA3AF",
            fontWeight: "800",
          }}
        >
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
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.35)",
          justifyContent: "flex-end",
        }}
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

  const [inviteCode, setInviteCode] = useState("");

  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);

  const [name, setName] = useState("");
  const [birthdate, setBirthdate] = useState(""); // YYYY-MM-DD
  const [nationality, setNationality] = useState("KR");

  const [workPart, setWorkPart] = useState("");

  const [loading, setLoading] = useState(false);

  const [workPartOpen, setWorkPartOpen] = useState(false);
  const [nationOpen, setNationOpen] = useState(false);

  const e164 = useMemo(() => toE164KR(phone.trim()), [phone]);
  const birthdateOk = useMemo(() => isValidDateYYYYMMDD(birthdate.trim()), [birthdate]);

  const isAdmin = useMemo(() => workPart === "관리자", [workPart]);

  const canSubmit = useMemo(() => {
    return (
      inviteCode.trim().length >= 3 &&
      !!e164 &&
      password.length >= 6 &&
      name.trim().length >= 2 &&
      birthdateOk &&
      nationality.trim().length > 0 &&
      workPart.trim().length > 0
    );
  }, [inviteCode, e164, password, name, birthdateOk, nationality, workPart]);

  const onSignup = async () => {
    if (!canSubmit || loading) return;

    setLoading(true);
    try {
      // 1) 초대코드 검증 + 1회 사용 처리
      const { data: ok, error: codeErr } = await supabase.rpc("consume_invite_code", {
        p_code: inviteCode.trim(),
      });
      if (codeErr) throw codeErr;
      if (!ok) {
        Alert.alert("실패", "초대코드가 올바르지 않거나 사용이 제한되었습니다.");
        return;
      }

      // 2) 전화번호를 pseudo email로 회원가입
      const pseudoEmail = pseudoEmailFromPhoneE164(e164!);
      const lang = localeFromNationality(nationality);

      const { data: signData, error: signErr } = await supabase.auth.signUp({
        email: pseudoEmail,
        password,
        options: {
          data: {
            name: name.trim(),
            work_part: workPart.trim(),
            phone: e164!,
            phone_verified: false,
            birthdate: birthdate.trim(),
            nationality: nationality.trim(),
            language: lang,
            is_admin: isAdmin, // 관리자 “운영권한”
          },
        },
      });

      if (signErr) throw signErr;

      const userId = signData?.user?.id;
      if (!userId) {
        throw new Error("회원가입은 됐는데 user id를 못 받았어요. (Auth 설정 확인 필요)");
      }

      // 3) profiles 생성 (RLS 정책으로 본인만 insert 가능)
      const { error: profErr } = await supabase.from("profiles").insert({
        id: userId,
        phone: e164!,
        phone_verified: false,
        birthdate: birthdate.trim(),
        nationality: nationality.trim(),
        language: lang,
        name: name.trim(),
        work_part: workPart.trim(),
        is_admin: isAdmin,
        approved: false, // ✅ 기본: 승인대기
      });

      if (profErr) throw profErr;

      // 4) 앱 언어 저장/적용
      await setLocale(lang);

      Alert.alert("회원가입 완료", "승인 대기 상태입니다. 승인되면 로그인 가능합니다.");
      router.replace("/(auth)/login");
    } catch (err: any) {
      const msg =
        err?.message ||
        err?.error_description ||
        err?.details ||
        JSON.stringify(err);
      Alert.alert("회원가입 실패", msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#F6F7FB" }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 18, paddingBottom: 28, flexGrow: 1 }}
        >
          <View style={{ alignItems: "center", marginBottom: 14 }}>
            <Image
              source={require("../../assets/hanexpress-logo.png")}
              style={{ width: 240, height: 70, resizeMode: "contain" }}
            />
            <Text style={{ marginTop: 8, color: "#6B7280", textAlign: "center" }}>
              초대코드로만 가입할 수 있어요. 가입 후 승인되면 전화번호+비밀번호로 로그인합니다.
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

            {/* 1. 초대코드 */}
            <View style={{ gap: 6 }}>
              <Text style={{ color: "#374151", fontWeight: "800" }}>초대코드</Text>
              <TextInput
                value={inviteCode}
                onChangeText={setInviteCode}
                placeholder="예: HAN2026"
                placeholderTextColor="#9CA3AF"
                autoCapitalize="characters"
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

            {/* 2. 전화번호 */}
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
                  borderColor: "#E5E7EB",
                  borderRadius: 12,
                  paddingHorizontal: 12,
                  paddingVertical: 12,
                  color: "#111827",
                }}
              />
              <Text style={{ color: "#9CA3AF", fontSize: 12 }}>하이픈 없이 입력해도 됩니다.</Text>
            </View>

            {/* 3. 비밀번호 */}
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
              <Text style={{ color: "#9CA3AF" }}>비밀번호는 6자 이상</Text>
            </View>

            {/* 4. 이름 */}
            <View style={{ gap: 6 }}>
              <Text style={{ color: "#374151", fontWeight: "800" }}>이름</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="홍길동"
                placeholderTextColor="#9CA3AF"
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

            {/* 5. 생년월일 */}
            <View style={{ gap: 6 }}>
              <Text style={{ color: "#374151", fontWeight: "800" }}>생년월일</Text>
              <TextInput
                value={birthdate}
                onChangeText={setBirthdate}
                placeholder="YYYY-MM-DD (예: 1995-08-21)"
                placeholderTextColor="#9CA3AF"
                keyboardType="numbers-and-punctuation"
                autoCapitalize="none"
                autoCorrect={false}
                editable={!loading}
                style={{
                  backgroundColor: "#F9FAFB",
                  borderWidth: 1,
                  borderColor: birthdate.length === 0 || birthdateOk ? "#E5E7EB" : "#EF4444",
                  borderRadius: 12,
                  paddingHorizontal: 12,
                  paddingVertical: 12,
                  color: "#111827",
                }}
              />
              <Text style={{ color: birthdate.length === 0 || birthdateOk ? "#9CA3AF" : "#EF4444", fontSize: 12 }}>
                {birthdate.length === 0
                  ? "형식: YYYY-MM-DD"
                  : birthdateOk
                  ? "OK"
                  : "날짜 형식이 올바르지 않아요 (예: 1999-12-31)"}
              </Text>
            </View>

            {/* 6. 국적 */}
            <OneLineSelect
              label="국적"
              value={nationality}
              placeholder="선택"
              options={NATIONALITIES}
              disabled={loading}
              onPress={() => setNationOpen(true)}
            />
            <Text style={{ color: "#9CA3AF", fontSize: 12 }}>
              국적 선택에 따라 앱 언어가 자동 설정됩니다.
            </Text>

            {/* 7. 작업파트 */}
            <OneLineSelect
              label="작업파트"
              value={workPart}
              placeholder="선택"
              options={WORK_PARTS}
              disabled={loading}
              onPress={() => setWorkPartOpen(true)}
            />
            {isAdmin && (
              <Text style={{ color: "#2563EB", fontSize: 12, fontWeight: "900" }}>
                관리자 선택됨 → 운영(조회) 권한 플래그가 설정됩니다. (승인은 별도)
              </Text>
            )}

            <Pressable
              onPress={onSignup}
              disabled={!canSubmit || loading}
              style={{
                height: 46,
                borderRadius: 12,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: !canSubmit || loading ? "#CBD5E1" : "#2563EB",
              }}
            >
              {loading ? (
                <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
                  <ActivityIndicator color="#fff" />
                  <Text style={{ color: "#fff", fontWeight: "900" }}>처리 중</Text>
                </View>
              ) : (
                <Text style={{ color: "#fff", fontWeight: "900" }}>회원가입</Text>
              )}
            </Pressable>

            <Pressable onPress={() => router.replace("/(auth)/login")} disabled={loading} style={{ alignItems: "center", paddingVertical: 8 }}>
              <Text style={{ color: "#2563EB", fontWeight: "900" }}>로그인으로 돌아가기</Text>
            </Pressable>
          </View>

          {/* 모달들 */}
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
