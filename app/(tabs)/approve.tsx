import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, SafeAreaView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { SUPABASE_ANON_KEY, SUPABASE_URL, supabase } from "../../src/lib/supabase";
import { fetchPendingApprovals, fetchPendingLabels, isAdminUser, PendingApprovalRow } from "../../src/lib/admin";

type ApprovedRow = { id: string; name: string | null; phone: string | null; device_id: string | null };

type Row = PendingApprovalRow;

function inferPendingLabel(row: Partial<Row>) {
  const explicit = String(row.pending_label ?? "").trim();
  if (explicit) return explicit;

  return "신규가입";
}

export default function ApproveScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<"approve" | "device">("approve");
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [approvedRows, setApprovedRows] = useState<ApprovedRow[]>([]);
  const [deviceLoading, setDeviceLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const admin = await isAdminUser();
      if (!admin) {
        Alert.alert("권한 없음", "관리자만 접근 가능합니다.", [{ text: "확인", onPress: () => router.replace("/(tabs)") }]);
        return;
      }

      try {
        const payload = await fetchPendingApprovals();
        setPendingCount(payload.count);
        setRows(payload.rows.map((row) => ({ ...row, pending_label: inferPendingLabel(row) })));
      } catch (edgeErr: any) {
        const { data, error } = await supabase
          .from("profiles")
          .select("id, phone, name, approval_status, created_at")
          .eq("approval_status", "pending")
          .order("created_at", { ascending: true });

        if (error) {
          throw new Error(edgeErr?.message || error.message || "승인 대기 목록 조회 실패");
        }

        const fallbackRows = (data ?? []) as Row[];
        let labelMap: Record<string, string> = {};
        try {
          labelMap = await fetchPendingLabels(fallbackRows.map((row) => row.id));
        } catch {}

        const mergedRows = fallbackRows.map((row) => ({
          ...row,
          pending_label: inferPendingLabel({
            ...row,
            pending_label: labelMap[row.id] || row.pending_label || "",
          }),
        }));

        setRows(mergedRows);
        setPendingCount(mergedRows.length);
      }
    } catch (e: any) {
      Alert.alert("오류", e?.message ?? "불러오기 실패");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  const rejectAndDeleteUser = useCallback(async (userId: string) => {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;

    const accessToken = String(data.session?.access_token ?? "").trim();
    if (!accessToken) throw new Error("관리자 세션이 없습니다.");

    const res = await fetch(`${SUPABASE_URL}/functions/v1/manage-account`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ action: "reject_delete_user", user_id: userId }),
    });

    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((payload as any)?.error || "반려 및 삭제 실패");
  }, []);

  const clearPendingLabel = useCallback(async (userId: string) => {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;

    const accessToken = String(data.session?.access_token ?? "").trim();
    if (!accessToken) throw new Error("관리자 세션이 없습니다.");

    const res = await fetch(`${SUPABASE_URL}/functions/v1/manage-account`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ action: "clear_pending_label", user_id: userId }),
    });

    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((payload as any)?.error || "잠금 초기화 실패");
  }, []);

  const loadApprovedUsers = useCallback(async () => {
    setDeviceLoading(true);
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, name, phone, device_id")
        .eq("approval_status", "approved")
        .order("name", { ascending: true });
      if (error) throw error;
      setApprovedRows((data ?? []) as ApprovedRow[]);
    } catch (e: any) {
      Alert.alert("오류", e?.message ?? "불러오기 실패");
    } finally {
      setDeviceLoading(false);
    }
  }, []);

  const resetDeviceId = useCallback(async (userId: string, userName: string) => {
    Alert.alert("기기 초기화", `${userName || "이 사용자"}의 기기 등록을 초기화할까요?\n초기화하면 어느 기기에서든 다시 로그인할 수 있습니다.`, [
      { text: "취소", style: "cancel" },
      {
        text: "초기화",
        style: "destructive",
        onPress: async () => {
          try {
            const { error } = await supabase
              .from("profiles")
              .update({ device_id: null })
              .eq("id", userId);
            if (error) throw error;
            setApprovedRows((prev) => prev.map((r) => r.id === userId ? { ...r, device_id: null } : r));
            Alert.alert("완료", "기기 초기화가 완료되었습니다.");
          } catch (e: any) {
            Alert.alert("실패", e?.message ?? "초기화 실패");
          }
        },
      },
    ]);
  }, []);

  const setStatus = useCallback(
    async (userId: string, status: "approved" | "rejected") => {
      try {
        if (status === "rejected") {
          await rejectAndDeleteUser(userId);
        } else {
          const { error } = await supabase.rpc("admin_set_approval", {
            p_user_id: userId,
            p_status: status,
          });
          if (error) throw error;
          try {
            await clearPendingLabel(userId);
          } catch (clearErr) {
            console.warn("[approve] clear pending label failed", clearErr);
          }
        }

        setRows((prev) => prev.filter((r) => r.id !== userId));
        setPendingCount((prev) => Math.max(0, prev - 1));
      } catch (e: any) {
        Alert.alert("처리 실패", e?.message ?? "승인/반려 실패");
      }
    },
    [clearPendingLabel, rejectAndDeleteUser]
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#F6F7FB" }}>
      <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <Text style={{ fontSize: 22, fontWeight: "900", color: "#111827" }}>관리자</Text>
          <Pressable
            onPress={() => { if (tab === "approve") load(); else loadApprovedUsers(); }}
            style={{ paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: "#E5E7EB", backgroundColor: "#fff" }}
          >
            <Text style={{ fontWeight: "900", color: "#111827" }}>새로고침</Text>
          </Pressable>
        </View>

        {/* 탭 */}
        <View style={{ flexDirection: "row", gap: 10, marginBottom: 12 }}>
          <Pressable
            onPress={() => setTab("approve")}
            style={{ flex: 1, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: tab === "approve" ? "#2563EB" : "#E5E7EB", backgroundColor: tab === "approve" ? "#EFF6FF" : "#fff" }}
          >
            <Text style={{ fontWeight: "900", color: tab === "approve" ? "#2563EB" : "#374151" }}>가입 승인 {pendingCount > 0 ? `(${pendingCount})` : ""}</Text>
          </Pressable>
          <Pressable
            onPress={() => { setTab("device"); if (approvedRows.length === 0) loadApprovedUsers(); }}
            style={{ flex: 1, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: tab === "device" ? "#2563EB" : "#E5E7EB", backgroundColor: tab === "device" ? "#EFF6FF" : "#fff" }}
          >
            <Text style={{ fontWeight: "900", color: tab === "device" ? "#2563EB" : "#374151" }}>기기 초기화</Text>
          </Pressable>
        </View>

        {tab === "device" ? (
          deviceLoading ? (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
              <ActivityIndicator />
            </View>
          ) : (
            <FlatList
              data={approvedRows}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ paddingBottom: 30 }}
              ListEmptyComponent={<View style={{ padding: 16 }}><Text style={{ color: "#6B7280" }}>승인된 사용자가 없습니다.</Text></View>}
              renderItem={({ item }) => (
                <View style={{ backgroundColor: "#fff", borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: "#E5E7EB", flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={{ fontWeight: "900", color: "#111827" }}>{item.name?.trim() || "이름없음"}</Text>
                    <Text style={{ color: "#6B7280", fontSize: 13 }}>{item.phone ?? "-"}</Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 }}>
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: item.device_id ? "#16A34A" : "#9CA3AF" }} />
                      <Text style={{ fontSize: 12, color: item.device_id ? "#16A34A" : "#9CA3AF", fontWeight: "800" }}>
                        {item.device_id ? "기기 등록됨" : "미등록 (어느 기기든 로그인 가능)"}
                      </Text>
                    </View>
                  </View>
                  {item.device_id ? (
                    <Pressable
                      onPress={() => resetDeviceId(item.id, item.name ?? "")}
                      style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: "#FCA5A5", backgroundColor: "#FEF2F2" }}
                    >
                      <Text style={{ fontWeight: "900", color: "#EF4444", fontSize: 13 }}>초기화</Text>
                    </Pressable>
                  ) : (
                    <View style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: "#E5E7EB", backgroundColor: "#F9FAFB" }}>
                      <Text style={{ fontWeight: "900", color: "#9CA3AF", fontSize: 13 }}>미등록</Text>
                    </View>
                  )}
                </View>
              )}
            />
          )
        ) : loading ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <ActivityIndicator />
            <Text style={{ marginTop: 10, color: "#6B7280" }}>불러오는 중...</Text>
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
                <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                  <Text style={{ flex: 1, fontSize: 16, fontWeight: "900", color: "#111827" }}>
                    {item.name?.trim() ? item.name : "이름없음"}
                  </Text>
                  <View
                    style={{
                      paddingHorizontal: 10,
                      paddingVertical: 5,
                      borderRadius: 999,
                      backgroundColor:
                        item.pending_label === "비밀번호 5회 오류"
                          ? "#FEF2F2"
                          : item.pending_label === "신규가입"
                            ? "#EEF2FF"
                            : "#F3F4F6",
                      borderWidth: 1,
                      borderColor:
                        item.pending_label === "비밀번호 5회 오류"
                          ? "#FCA5A5"
                          : item.pending_label === "신규가입"
                            ? "#C7D2FE"
                            : "#D1D5DB",
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 12,
                        fontWeight: "900",
                        color:
                          item.pending_label === "비밀번호 5회 오류"
                            ? "#B91C1C"
                            : item.pending_label === "신규가입"
                              ? "#4338CA"
                              : "#4B5563",
                      }}
                    >
                      {item.pending_label || "구분없음"}
                    </Text>
                  </View>
                </View>

                <Text style={{ color: "#374151" }}>전화번호: {item.phone ?? "없음"}</Text>
                <Text style={{ color: "#9CA3AF", fontSize: 12 }}>가입: {new Date(item.created_at).toLocaleString()}</Text>

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
