// 피킹셀 조정 요청 화면 (일반 작업자용)
// 사용자 흐름:
// 1) "변경 전 피킹셀" 입력 → 디바운스 후 상품별 전략관리 lookup → 상품코드/상품명 자동 채움
// 2) "변경 후 피킹셀" 입력
// 3) 제출 → public.picking_cell_change_requests 에 insert
//
// 웹의 /admin/operation/picking-cell-request 페이지에서 관리자가 처리한다.
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { supabase } from "../../src/lib/supabase";

const DRIDO_API_BASE = "https://dridolabs.com";

const THEME = {
  bg: "#F7F7F8",
  surface: "#FFFFFF",
  text: "#111827",
  subtext: "#6B7280",
  border: "#E5E7EB",
  muted: "#9CA3AF",
  soft: "#F9FAFB",
  primary: "#2563EB",
  primarySoft: "#EFF6FF",
  success: "#16A34A",
  red: "#DC2626",
  warn: "#92400E",
  warnSoft: "#FEF3C7",
};

type LookupState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "hit"; product_code: string; product_name: string }
  | { status: "miss" }
  | { status: "error"; message: string };

export default function PickingCellScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [userId, setUserId] = useState<string | null>(null);
  const [workPart, setWorkPart] = useState<string>("");

  const [cellBefore, setCellBefore] = useState("");
  const [productCode, setProductCode] = useState("");
  const [productName, setProductName] = useState("");
  const [cellAfter, setCellAfter] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [recent, setRecent] = useState<any[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [lookup, setLookup] = useState<LookupState>({ status: "idle" });
  // 사용자가 자동 채움 이후 수동으로 상품코드/상품명 수정했으면, 셀 재조회로 덮어쓰지 않도록
  const codeManuallyEdited = useRef(false);
  const nameManuallyEdited = useRef(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      const u = data?.user;
      if (!u) return;
      setUserId(u.id);
      const { data: prof } = await supabase.from("profiles").select("work_part").eq("id", u.id).single();
      setWorkPart(((prof as any)?.work_part ?? "").trim());
    })();
  }, []);

  const loadRecent = useCallback(async () => {
    if (!userId) return;
    setLoadingRecent(true);
    const { data } = await supabase
      .from("picking_cell_change_requests")
      .select("id, cell_before, product_code, product_name, cell_after, status, admin_memo, created_at")
      .eq("requested_by", userId)
      .order("created_at", { ascending: false })
      .limit(10);
    setRecent((data ?? []) as any[]);
    setLoadingRecent(false);
  }, [userId]);

  useEffect(() => { loadRecent(); }, [loadRecent]);

  // 변경 전 피킹셀 입력 → 디바운스 lookup
  useEffect(() => {
    const cell = cellBefore.trim();
    if (cell.length < 3) {
      setLookup({ status: "idle" });
      return;
    }
    const handle = setTimeout(async () => {
      setLookup({ status: "loading" });
      try {
        const { data: sess } = await supabase.auth.getSession();
        const token = sess?.session?.access_token ?? "";
        const res = await fetch(
          `${DRIDO_API_BASE}/api/admin/product-strategy-lookup?cell=${encodeURIComponent(cell)}`,
          { headers: token ? { Authorization: `Bearer ${token}` } : {} }
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.ok) {
          setLookup({ status: "error", message: data?.message ?? "조회 실패" });
          return;
        }
        if (data.found && data.product) {
          const hitCode = String(data.product.product_code ?? "");
          const hitName = String(data.product.product_name ?? "");
          setLookup({ status: "hit", product_code: hitCode, product_name: hitName });
          if (!codeManuallyEdited.current) setProductCode(hitCode);
          if (!nameManuallyEdited.current) setProductName(hitName);
        } else {
          setLookup({ status: "miss" });
        }
      } catch (e: any) {
        setLookup({ status: "error", message: e?.message ?? String(e) });
      }
    }, 500);
    return () => clearTimeout(handle);
  }, [cellBefore]);

  const onSubmit = async () => {
    if (!userId) {
      Alert.alert("안내", "로그인 정보를 확인할 수 없습니다.");
      return;
    }
    const cb = cellBefore.trim();
    const pc = productCode.trim();
    const ca = cellAfter.trim();
    if (!cb || !pc || !ca) {
      Alert.alert("안내", "변경 전/후 피킹셀과 상품코드를 입력해 주세요.");
      return;
    }
    if (cb === ca) {
      Alert.alert("안내", "변경 전/후 피킹셀이 같습니다.");
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.from("picking_cell_change_requests").insert({
        cell_before: cb,
        product_code: pc,
        product_name: productName.trim() || null,
        cell_after: ca,
        requested_by: userId,
        requested_by_work_part: workPart || null,
      });
      if (error) {
        Alert.alert("등록 실패", error.message);
        return;
      }
      Alert.alert("등록 완료", "피킹셀 변경 요청이 접수되었습니다.");
      setCellBefore("");
      setProductCode("");
      setProductName("");
      setCellAfter("");
      codeManuallyEdited.current = false;
      nameManuallyEdited.current = false;
      setLookup({ status: "idle" });
      await loadRecent();
    } catch (e: any) {
      Alert.alert("오류", e?.message ?? String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const onDeleteRecent = (r: { id: string; cell_before: string; cell_after: string; status: string }) => {
    if (r.status !== "pending") {
      Alert.alert("삭제 불가", "이미 관리자가 처리한 요청은 삭제할 수 없습니다.");
      return;
    }
    Alert.alert(
      "요청 삭제",
      `${r.cell_before} → ${r.cell_after} 요청을 삭제할까요?`,
      [
        { text: "취소", style: "cancel" },
        {
          text: "삭제", style: "destructive", onPress: async () => {
            setDeletingId(r.id);
            try {
              const { error } = await supabase
                .from("picking_cell_change_requests")
                .delete()
                .eq("id", r.id)
                .eq("status", "pending");
              if (error) {
                Alert.alert("삭제 실패", error.message);
                return;
              }
              await loadRecent();
            } finally {
              setDeletingId(null);
            }
          },
        },
      ],
    );
  };

  const statusLabel = (s: string) =>
    s === "applied" ? "처리됨" : s === "rejected" ? "반려" : "대기";
  const statusColor = (s: string) =>
    s === "applied" ? "#16A34A" : s === "rejected" ? "#DC2626" : "#6B7280";

  // lookup 상태 표시
  const LookupHint = () => {
    if (lookup.status === "idle") return null;
    if (lookup.status === "loading") {
      return (
        <View style={[styles.hintBox, { backgroundColor: THEME.primarySoft }]}>
          <ActivityIndicator size="small" color={THEME.primary} />
          <Text style={[styles.hintText, { color: THEME.primary }]}>상품 정보 조회 중...</Text>
        </View>
      );
    }
    if (lookup.status === "hit") {
      return (
        <View style={[styles.hintBox, { backgroundColor: "#DCFCE7" }]}>
          <Ionicons name="checkmark-circle" size={14} color="#15803D" />
          <Text style={[styles.hintText, { color: "#15803D" }]}>자동 조회됨 (상품코드/상품명 채워졌습니다)</Text>
        </View>
      );
    }
    if (lookup.status === "miss") {
      return (
        <View style={[styles.hintBox, { backgroundColor: THEME.warnSoft }]}>
          <Ionicons name="alert-circle-outline" size={14} color={THEME.warn} />
          <Text style={[styles.hintText, { color: THEME.warn }]}>해당 셀의 상품 정보가 없습니다. 직접 입력해 주세요.</Text>
        </View>
      );
    }
    return (
      <View style={[styles.hintBox, { backgroundColor: "#FEE2E2" }]}>
        <Ionicons name="warning-outline" size={14} color={THEME.red} />
        <Text style={[styles.hintText, { color: THEME.red }]}>{lookup.message}</Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: THEME.bg }}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 8) }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={THEME.text} />
        </Pressable>
        <Text style={styles.headerTitle}>피킹셀 조정</Text>
        <View style={{ width: 32 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
            <Text style={styles.label}>변경 전 피킹셀</Text>
            <TextInput
              value={cellBefore}
              onChangeText={(t) => {
                setCellBefore(t);
                codeManuallyEdited.current = false;
                nameManuallyEdited.current = false;
              }}
              placeholder="예: 01-01-101"
              placeholderTextColor={THEME.muted}
              style={styles.input}
              autoCapitalize="characters"
              autoCorrect={false}
            />
            <LookupHint />

            <Text style={styles.label}>상품코드</Text>
            <TextInput
              value={productCode}
              onChangeText={(t) => { codeManuallyEdited.current = true; setProductCode(t); }}
              placeholder={lookup.status === "hit" ? "자동 입력됨" : "변경 전 피킹셀로 자동 조회됩니다"}
              placeholderTextColor={THEME.muted}
              style={[styles.input, lookup.status === "hit" && styles.inputAuto]}
              keyboardType="number-pad"
            />

            <Text style={styles.label}>상품명</Text>
            <TextInput
              value={productName}
              onChangeText={(t) => { nameManuallyEdited.current = true; setProductName(t); }}
              placeholder={lookup.status === "hit" ? "자동 입력됨" : "자동 조회 시 채워집니다"}
              placeholderTextColor={THEME.muted}
              style={[styles.input, lookup.status === "hit" && styles.inputAuto]}
            />

            <Text style={styles.label}>변경 후 피킹셀</Text>
            <TextInput
              value={cellAfter}
              onChangeText={setCellAfter}
              placeholder="예: 01-01-102"
              placeholderTextColor={THEME.muted}
              style={styles.input}
              autoCapitalize="characters"
              autoCorrect={false}
            />

            <Pressable
              onPress={onSubmit}
              disabled={submitting}
              style={[styles.submitBtn, submitting && { opacity: 0.6 }]}
            >
              {submitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="send" size={16} color="#fff" />
                  <Text style={styles.submitBtnText}>요청 등록</Text>
                </>
              )}
            </Pressable>
          </View>

          <Text style={styles.recentTitle}>내 최근 요청</Text>
          {loadingRecent ? (
            <View style={{ paddingVertical: 16, alignItems: "center" }}>
              <ActivityIndicator />
            </View>
          ) : recent.length === 0 ? (
            <Text style={styles.empty}>아직 등록한 요청이 없습니다.</Text>
          ) : (
            recent.map((r) => (
              <View key={r.id} style={styles.recentItem}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={styles.recentCells}>{r.cell_before} → {r.cell_after}</Text>
                  <View style={[styles.statusPill, { borderColor: statusColor(r.status) }]}>
                    <Text style={[styles.statusPillText, { color: statusColor(r.status) }]}>{statusLabel(r.status)}</Text>
                  </View>
                  {r.status === "pending" && (
                    <Pressable
                      onPress={() => onDeleteRecent(r)}
                      disabled={deletingId === r.id}
                      hitSlop={8}
                      style={({ pressed }) => [
                        styles.deleteBtn,
                        (pressed || deletingId === r.id) && { opacity: 0.5 },
                      ]}
                    >
                      {deletingId === r.id ? (
                        <ActivityIndicator size="small" color={THEME.red} />
                      ) : (
                        <>
                          <Ionicons name="trash-outline" size={14} color={THEME.red} />
                          <Text style={styles.deleteBtnText}>삭제</Text>
                        </>
                      )}
                    </Pressable>
                  )}
                </View>
                <Text style={styles.recentMeta}>{r.product_code}{r.product_name ? ` · ${r.product_name}` : ""}</Text>
                {r.admin_memo ? <Text style={styles.recentMemo}>관리자 메모: {r.admin_memo}</Text> : null}
              </View>
            ))
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingBottom: 12,
    backgroundColor: THEME.surface,
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
  },
  backBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 16, fontWeight: "800", color: THEME.text },

  card: {
    backgroundColor: THEME.surface,
    borderWidth: 1,
    borderColor: THEME.border,
    borderRadius: 14,
    padding: 16,
    gap: 6,
  },
  label: { fontSize: 13, color: THEME.subtext, fontWeight: "700", marginTop: 8 },
  input: {
    borderWidth: 1,
    borderColor: THEME.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: THEME.text,
    backgroundColor: THEME.soft,
    marginTop: 4,
  },
  inputAuto: {
    backgroundColor: "#ECFDF5",
    borderColor: "#A7F3D0",
  },
  hintBox: {
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  hintText: { fontSize: 12, fontWeight: "700" },
  submitBtn: {
    marginTop: 16,
    backgroundColor: THEME.primary,
    paddingVertical: 14,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  submitBtnText: { color: "#fff", fontWeight: "800", fontSize: 15 },

  recentTitle: { fontSize: 14, fontWeight: "800", color: THEME.text, marginTop: 24, marginBottom: 8 },
  empty: { color: THEME.muted, fontSize: 13, paddingVertical: 12, textAlign: "center" },
  recentItem: {
    backgroundColor: THEME.surface,
    borderWidth: 1,
    borderColor: THEME.border,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    gap: 4,
  },
  recentCells: { fontSize: 15, fontWeight: "800", color: THEME.text },
  recentMeta: { fontSize: 12, color: THEME.subtext },
  recentMemo: { fontSize: 12, color: "#7C2D12", marginTop: 4 },
  statusPill: {
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 8,
  },
  statusPillText: { fontSize: 11, fontWeight: "800" },
  deleteBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    marginLeft: "auto",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#FECACA",
    backgroundColor: "#FEF2F2",
  },
  deleteBtnText: { fontSize: 11, fontWeight: "800", color: "#DC2626" },
});
