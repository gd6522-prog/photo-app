import React, { useCallback, useEffect, useState } from "react";
import { Alert, FlatList, Pressable, SafeAreaView, Text, View, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { supabase } from "../../src/lib/supabase";
import { isAdminUser, getPendingCount } from "../../src/lib/admin";

type Row = {
  id: string;
  phone: string | null;
  name: string | null;
  approval_status: "pending" | "approved" | "rejected";
  created_at: string;
};

export default function ApproveScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [pendingCount, setPendingCount] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const admin = await isAdminUser();
      if (!admin) {
        Alert.alert("권한 없음", "관리자만 접근 가능합니다.", [
          { text: "확인", onPress: () => router.replace("/(tabs)") },
        ]);
        return;
      }

      const c = await getPendingCount();
      setPendingCount(c);

      const { data, error } = await supabase
        .from("profiles")
        .select("id, phone, name, approval_status, created_at")
        .eq("approval_status", "pending")
        .order("created_at", { ascending: true });

      if (error) throw error;
      setRows((data ?? []) as Row[]);
    } catch (e: any) {
      Alert.alert("오류", e?.message ?? "불러오기 실패");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  const setStatus = useCallback(async (userId: string, status: "approved" | "rejected") => {
    try {
      const { error } = await supabase.rpc("admin_set_approval", {
        p_user_id: userId,
        p_status: status,
      });
      if (error) throw error;

      setRows((prev) => prev.filter((r) => r.id !== userId));
      setPendingCount((prev) => Math.max(0, prev - 1));
    } catch (e: any) {
      Alert.alert("처리 실패", e?.message ?? "승인/반려 실패");
    }
  }, []);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#F6F7FB" }}>
      <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <View style={{ gap: 4 }}>
            <Text style={{ fontSize: 22, fontWeight: "900", color: "#111827" }}>가입 승인</Text>
            <Text style={{ color: "#6B7280" }}>승인 대기: {pendingCount}명</Text>
          </View>

          <Pressable
            onPress={load}
            style={{
              paddingVertical: 10,
              paddingHorizontal: 14,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: "#E5E7EB",
              backgroundColor: "#fff",
            }}
          >
            <Text style={{ fontWeight: "900", color: "#111827" }}>새로고침</Text>
          </Pressable>
        </View>

        {loading ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <ActivityIndicator />
            <Text style={{ marginTop: 10, color: "#6B7280" }}>불러오는 중…</Text>
          </View>
        ) : (
          <FlatList
            data={rows}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ paddingBottom: 30 }}
            ListEmptyComponent={
              <View style={{ padding: 16 }}>
                <Text style={{ color: "#6B7280" }}>승인 대기 사용자가 없습니다.</Text>
              </View>
            }
            renderItem={({ item }) => (
              <View
                style={{
                  backgroundColor: "#fff",
                  borderRadius: 16,
                  padding: 14,
                  marginBottom: 12,
                  borderWidth: 1,
                  borderColor: "#E5E7EB",
                  gap: 6,
                }}
              >
                <Text style={{ fontSize: 16, fontWeight: "900", color: "#111827" }}>
                  {item.name?.trim() ? item.name : "이름없음"}
                </Text>
                <Text style={{ color: "#374151" }}>전화번호: {item.phone ?? "없음"}</Text>
                <Text style={{ color: "#9CA3AF", fontSize: 12 }}>
                  가입: {new Date(item.created_at).toLocaleString()}
                </Text>

                <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
                  <Pressable
                    onPress={() =>
                      Alert.alert("승인", "이 사용자를 승인할까요?", [
                        { text: "취소", style: "cancel" },
                        { text: "승인", onPress: () => setStatus(item.id, "approved") },
                      ])
                    }
                    style={{
                      flex: 1,
                      height: 44,
                      borderRadius: 12,
                      alignItems: "center",
                      justifyContent: "center",
                      borderWidth: 1,
                      borderColor: "#16A34A",
                      backgroundColor: "#ECFDF5",
                    }}
                  >
                    <Text style={{ fontWeight: "900", color: "#16A34A" }}>승인</Text>
                  </Pressable>

                  <Pressable
                    onPress={() =>
                      Alert.alert("반려", "이 사용자를 반려할까요?", [
                        { text: "취소", style: "cancel" },
                        { text: "반려", style: "destructive", onPress: () => setStatus(item.id, "rejected") },
                      ])
                    }
                    style={{
                      flex: 1,
                      height: 44,
                      borderRadius: 12,
                      alignItems: "center",
                      justifyContent: "center",
                      borderWidth: 1,
                      borderColor: "#EF4444",
                      backgroundColor: "#FEF2F2",
                    }}
                  >
                    <Text style={{ fontWeight: "900", color: "#EF4444" }}>반려</Text>
                  </Pressable>
                </View>
              </View>
            )}
          />
        )}
      </View>
    </SafeAreaView>
  );
}
