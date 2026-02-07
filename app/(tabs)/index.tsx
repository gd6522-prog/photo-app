import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  SafeAreaView,
  Text,
  View,
} from "react-native";
import { useAuth } from "../../src/lib/auth";
import { supabase } from "../../src/lib/supabase";

const KEY_AUTO_LOGIN = "hx_auto_login";

export default function MenuScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);

  const userEmail = useMemo(() => user?.email ?? "", [user]);

  const goUpload = () => router.push("/(tabs)/upload");
  const goList = () => router.push("/(tabs)/photo-list");

  const onLogout = async () => {
    Alert.alert(
      "로그아웃",
      "로그아웃하면 자동로그인이 꺼지고, 다음 앱 실행 시 로그인부터 시작합니다.",
      [
        { text: "취소", style: "cancel" },
        {
          text: "로그아웃",
          style: "destructive",
          onPress: async () => {
            setBusy(true);
            try {
              await AsyncStorage.setItem(KEY_AUTO_LOGIN, "0");
              await supabase.auth.signOut();
              router.replace("/(auth)/login");
            } catch (e: any) {
              Alert.alert("오류", e?.message ?? String(e));
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#FFFFFF" }}>
      <View style={{ flex: 1, paddingHorizontal: 18, justifyContent: "center", gap: 16 }}>
        {/* 로고/타이틀 */}
        <View style={{ alignItems: "center", gap: 10, marginBottom: 6 }}>
          <Image
            source={require("../../assets/hanexpress-logo.png")}
            style={{ width: 280, height: 86, resizeMode: "contain" }}
          />
          <Text style={{ fontSize: 22, fontWeight: "900", color: "#111827" }}>
            메인 메뉴
          </Text>
          <Text style={{ color: "#6B7280", textAlign: "center" }}>
            업로드 또는 조회를 선택하세요.
          </Text>
          {!!userEmail && (
            <Text style={{ color: "#9CA3AF", fontSize: 12 }}>로그인: {userEmail}</Text>
          )}
        </View>

        {/* 카드 */}
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
          {/* 업로드 */}
          <Pressable
            onPress={goUpload}
            disabled={busy}
            style={{
              height: 56,
              borderRadius: 16,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "#2563EB",
              opacity: busy ? 0.6 : 1,
            }}
          >
            <Text style={{ color: "#FFFFFF", fontWeight: "900", fontSize: 16 }}>
              업로드
            </Text>
          </Pressable>

          {/* 조회 */}
          <Pressable
            onPress={goList}
            disabled={busy}
            style={{
              height: 56,
              borderRadius: 16,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "#111827",
              opacity: busy ? 0.6 : 1,
            }}
          >
            <Text style={{ color: "#FFFFFF", fontWeight: "900", fontSize: 16 }}>
              조회
            </Text>
          </Pressable>

          {/* 로그아웃 */}
          <Pressable
            onPress={onLogout}
            disabled={busy}
            style={{
              height: 52,
              borderRadius: 16,
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 1,
              borderColor: "#EF4444",
              backgroundColor: "#FFFFFF",
              opacity: busy ? 0.6 : 1,
              marginTop: 4,
            }}
          >
            {busy ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <ActivityIndicator />
                <Text style={{ color: "#EF4444", fontWeight: "900" }}>처리 중...</Text>
              </View>
            ) : (
              <Text style={{ color: "#EF4444", fontWeight: "900", fontSize: 15 }}>
                로그아웃
              </Text>
            )}
          </Pressable>

          <Text style={{ color: "#9CA3AF", fontSize: 12, textAlign: "center", marginTop: 4 }}>
            로그아웃 시 자동로그인이 꺼져서 다음 실행부터 로그인 화면이 먼저 뜹니다.
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}
