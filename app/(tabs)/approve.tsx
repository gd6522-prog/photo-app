import React, { useEffect, useState } from "react";
import { Alert, FlatList, Pressable, SafeAreaView, Text, View } from "react-native";
import { supabase } from "../../src/lib/supabase";

type PendingProfile = {
  id: string;
  name: string | null;
  phone: string | null;
  work_part: string | null;
  nationality: string | null;
  birthdate: string | null;
  created_at?: string | null;
  approved: boolean | null;
};

export default function ApproveScreen() {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<PendingProfile[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData?.user?.id;
      if (!uid) throw new Error("로그인이 필요합니다.");

      // 관리자 체크
      const { data: me, error: meErr } = await supabase
        .from("profiles")
        .select("is_admin")
        .eq("id", uid)
        .single();

      if (meErr) throw meErr;
      if (!me?.is_admin) {
        Alert.alert("권한 없음", "관리자만 접근할 수 있어요.");
        return;
      }

      const { data, error } = await supabase
        .from("profiles")
        .select("id,name,phone,work_part,nationality,birthdate,created_at,approved")
        .eq("approved", false)
        .order("created_at", { ascending: true });

      if (error) throw error;
      setItems((data as any) ?? []);
    } catch (e: any) {
      Alert.alert("불러오기 실패", e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const onApprove = async (userId: string) => {
    try {
      const { error } = await supabase.rpc("approve_user", { p_user_id: userId });
      if (error) throw error;
      Alert.alert("승인 완료", "승인 처리되었습니다.");
      await load();
    } catch (e: any) {
      Alert.alert("승인 실패", e?.message ?? String(e));
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#F6F7FB" }}>
      <View style={{ padding: 16 }}>
        <Text style={{ fontSize: 20, fontWeight: "900", color: "#111827" }}>가입 승인</Text>
        <Text style={{ color: "#6B7280", marginTop: 6 }}>
          승인 대기 사용자 목록입니다. 작업파트가 ‘관리자’인 경우 승인 시 관리자 권한이 자동 부여됩니다.
        </Text>
      </View>

      <FlatList
        data={items}
        keyExtractor={(x) => x.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
        refreshing={refreshing}
        onRefresh={async () => {
          setRefreshing(true);
          await load();
          setRefreshing(false);
        }}
        ListEmptyComponent={
          !loading ? (
            <View style={{ padding: 16 }}>
              <Text style={{ color: "#6B7280" }}>승인 대기 사용자가 없습니다.</Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <View
            style={{
              backgroundColor: "#fff",
              borderWidth: 1,
              borderColor: "#E5E7EB",
              borderRadius: 16,
              padding: 14,
              marginBottom: 10,
            }}
          >
            <Text style={{ fontWeight: "900", color: "#111827", fontSize: 16 }}>
              {item.name ?? "(이름없음)"} • {item.work_part ?? "-"}
            </Text>
            <Text style={{ color: "#6B7280", marginTop: 4 }}>
              {item.phone ?? "-"} • {item.nationality ?? "-"} • {item.birthdate ?? "-"}
            </Text>

            <Pressable
              onPress={() => onApprove(item.id)}
              style={{
                marginTop: 10,
                height: 42,
                borderRadius: 12,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "#2563EB",
              }}
            >
              <Text style={{ color: "#fff", fontWeight: "900" }}>승인</Text>
            </Pressable>
          </View>
        )}
      />
    </SafeAreaView>
  );
}
