// 체화재고(출고기준미달) 회신 화면 (일반 작업자용)
//
// 데이터 소스: 웹의 통합체크리스트(/api/admin/operation-checklist) 6번 출고기준미달.
// 1단계에서는 RN 앱이 그 데이터를 직접 받지 못하므로, 화면은 "응답 이력" + "직접 입력 회신"
// 형태로 동작한다. 웹 측에 RN 앱 전용 노출 API 가 붙으면 상단 데이터 리스트가 자동 표시된다.
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
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

import { uploadWorkerPhoto } from "../../src/lib/photoUpload";
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
  primary: "#16A34A",
  red: "#DC2626",
};

type StaleItem = {
  product_code: string;
  product_name: string;
  picking_cell?: string | null;
  reference_expiry?: string | null;
  shipment_standard_date?: string | null;
};

type ResponseRow = {
  id: string;
  source_date: string;
  product_code: string;
  product_name: string | null;
  picking_cell: string | null;
  reference_expiry: string | null;
  shipment_standard_date: string | null;
  actual_expiry: string | null;
  photo_id: string | null;
  note: string | null;
  created_at: string;
};

const kstToday = () => {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
};

export default function StaleStockScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [userId, setUserId] = useState<string | null>(null);
  const [workPart, setWorkPart] = useState<string>("");
  const [items, setItems] = useState<StaleItem[]>([]);
  const [itemsError, setItemsError] = useState<string>("");
  const [loadingItems, setLoadingItems] = useState(true);
  const [myResponses, setMyResponses] = useState<ResponseRow[]>([]);

  const [openCode, setOpenCode] = useState<string | null>(null);
  const [draftExpiry, setDraftExpiry] = useState<Record<string, string>>({});
  const [draftNote, setDraftNote] = useState<Record<string, string>>({});
  const [draftUri, setDraftUri] = useState<Record<string, string>>({});
  const [submittingCode, setSubmittingCode] = useState<string | null>(null);

  const sourceDate = kstToday();

  const loadItemsFromServer = useCallback(async () => {
    setLoadingItems(true);
    setItemsError("");
    try {
      const { data: sess } = await supabase.auth.getSession();
      const accessToken = String(sess?.session?.access_token ?? "").trim();
      // 웹의 출고기준미달 데이터 노출 API. 다음 단계에서 추가될 예정.
      const res = await fetch(`${DRIDO_API_BASE}/api/admin/operation-checklist/stale-stock-for-app`, {
        method: "GET",
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      });
      if (!res.ok) {
        setItems([]);
        setItemsError("출고기준미달 데이터를 불러올 수 없습니다.");
        return;
      }
      const payload = (await res.json().catch(() => ({}))) as { items?: StaleItem[] };
      setItems(Array.isArray(payload.items) ? payload.items : []);
    } catch {
      setItems([]);
      setItemsError("서버 연결이 불안정합니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setLoadingItems(false);
    }
  }, []);

  const loadMyResponses = useCallback(async (uid: string) => {
    const { data } = await supabase
      .from("stale_stock_responses")
      .select("id, source_date, product_code, product_name, picking_cell, reference_expiry, shipment_standard_date, actual_expiry, photo_id, note, created_at")
      .eq("responded_by", uid)
      .order("created_at", { ascending: false })
      .limit(50);
    setMyResponses((data ?? []) as any[]);
  }, []);

  const loadAll = useCallback(async () => {
    const { data: userRes } = await supabase.auth.getUser();
    const u = userRes?.user;
    if (!u) return;
    setUserId(u.id);
    const { data: prof } = await supabase.from("profiles").select("work_part").eq("id", u.id).single();
    setWorkPart(((prof as any)?.work_part ?? "").trim());
    await Promise.all([loadItemsFromServer(), loadMyResponses(u.id)]);
  }, [loadItemsFromServer, loadMyResponses]);

  useEffect(() => { loadAll(); }, [loadAll]);
  useFocusEffect(useCallback(() => { loadAll(); return () => {}; }, [loadAll]));

  const respondedCodes = new Set(
    myResponses.filter((r) => r.source_date === sourceDate).map((r) => r.product_code)
  );

  const takePhoto = async (code: string) => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { Alert.alert("권한 필요", "카메라 권한을 허용해주세요."); return; }
    const shot = await ImagePicker.launchCameraAsync({ quality: 0.9, allowsEditing: false });
    if (shot.canceled) return;
    const uri = shot.assets?.[0]?.uri ?? "";
    if (uri) setDraftUri((m) => ({ ...m, [code]: uri }));
  };

  const pickPhoto = async (code: string) => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert("권한 필요", "갤러리 접근 권한을 허용해주세요."); return; }
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.9 });
    if (picked.canceled) return;
    const uri = picked.assets?.[0]?.uri ?? "";
    if (uri) setDraftUri((m) => ({ ...m, [code]: uri }));
  };

  const submit = async (it: StaleItem) => {
    if (!userId) return;
    const expiry = (draftExpiry[it.product_code] ?? "").trim();
    const note = (draftNote[it.product_code] ?? "").trim();
    const uri = draftUri[it.product_code];

    // 실제 소비기한 형식 검사 (YYYY-MM-DD)
    if (expiry && !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) {
      Alert.alert("형식 오류", "실제 소비기한은 YYYY-MM-DD 형식으로 입력해 주세요.");
      return;
    }
    if (!expiry && !uri && !note) {
      Alert.alert("입력 필요", "실제 소비기한 / 사진 / 메모 중 하나는 입력해 주세요.");
      return;
    }

    setSubmittingCode(it.product_code);
    try {
      let photoId: string | undefined;
      if (uri) {
        const up = await uploadWorkerPhoto({
          uri, userId, workPart: workPart || null, category: "field",
        });
        if (!up.ok || !up.photoId) {
          Alert.alert("사진 업로드 실패", up.error ?? "사진 업로드에 실패했습니다.");
          return;
        }
        photoId = up.photoId;
      }
      const { error } = await supabase.from("stale_stock_responses").upsert(
        {
          source_date: sourceDate,
          product_code: it.product_code,
          product_name: it.product_name,
          picking_cell: it.picking_cell ?? null,
          reference_expiry: it.reference_expiry ?? null,
          shipment_standard_date: it.shipment_standard_date ?? null,
          actual_expiry: expiry || null,
          photo_id: photoId ?? null,
          note: note || null,
          responded_by: userId,
          responded_by_work_part: workPart || null,
        },
        { onConflict: "source_date,product_code,responded_by" }
      );
      if (error) {
        Alert.alert("등록 실패", error.message);
        return;
      }
      setDraftExpiry((m) => { const n = { ...m }; delete n[it.product_code]; return n; });
      setDraftNote((m) => { const n = { ...m }; delete n[it.product_code]; return n; });
      setDraftUri((m) => { const n = { ...m }; delete n[it.product_code]; return n; });
      setOpenCode(null);
      await loadMyResponses(userId);
      Alert.alert("회신 완료", "응답이 등록되었습니다.");
    } catch (e: any) {
      Alert.alert("오류", e?.message ?? String(e));
    } finally {
      setSubmittingCode(null);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: THEME.bg }}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 8) }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={THEME.text} />
        </Pressable>
        <View>
          <Text style={styles.headerTitle}>체화재고</Text>
          <Text style={styles.headerSub}>출고기준미달 · {sourceDate}</Text>
        </View>
        <Pressable onPress={loadAll} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="refresh" size={20} color={THEME.text} />
        </Pressable>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
          <Text style={styles.sectionTitle}>오늘 출고기준미달 상품</Text>
          {loadingItems ? (
            <View style={{ paddingVertical: 20, alignItems: "center" }}><ActivityIndicator /></View>
          ) : itemsError ? (
            <View style={styles.errorBox}>
              <MaterialCommunityIcons name="cloud-off-outline" size={22} color={THEME.muted} />
              <Text style={styles.errorText}>{itemsError}</Text>
              <Text style={styles.errorSub}>관리자가 통합체크리스트를 등록한 후 표시됩니다.</Text>
            </View>
          ) : items.length === 0 ? (
            <View style={styles.emptyBox}>
              <MaterialCommunityIcons name="check-circle-outline" size={28} color={THEME.muted} />
              <Text style={styles.emptyText}>오늘 출고기준미달 상품이 없습니다.</Text>
            </View>
          ) : (
            items.map((it) => {
              const responded = respondedCodes.has(it.product_code);
              const open = openCode === it.product_code;
              return (
                <View key={it.product_code} style={[styles.item, responded && { opacity: 0.7 }]}>
                  <Pressable onPress={() => setOpenCode(open ? null : it.product_code)} style={styles.itemHead}>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 }}>
                        {responded ? (
                          <View style={[styles.tag, { backgroundColor: "#DCFCE7" }]}>
                            <Text style={[styles.tagText, { color: "#15803D" }]}>회신완료</Text>
                          </View>
                        ) : (
                          <View style={[styles.tag, { backgroundColor: "#FEF3C7" }]}>
                            <Text style={[styles.tagText, { color: "#92400E" }]}>확인필요</Text>
                          </View>
                        )}
                        {!!it.picking_cell && <Text style={styles.cellPill}>{it.picking_cell}</Text>}
                      </View>
                      <Text style={styles.itemTitle}>{it.product_name}</Text>
                      <Text style={styles.itemMeta}>{it.product_code}</Text>
                      <Text style={styles.itemMeta}>
                        시스템 소비기한 {it.reference_expiry ?? "—"} · 출고기준일 {it.shipment_standard_date ?? "—"}
                      </Text>
                    </View>
                    <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={THEME.muted} />
                  </Pressable>

                  {open && (
                    <View style={styles.itemBody}>
                      <Text style={styles.subLabel}>실제 소비기한 (YYYY-MM-DD)</Text>
                      <TextInput
                        value={draftExpiry[it.product_code] ?? ""}
                        onChangeText={(t) => setDraftExpiry((m) => ({ ...m, [it.product_code]: t }))}
                        placeholder="예: 2026-08-15"
                        placeholderTextColor={THEME.muted}
                        style={styles.input}
                        keyboardType="number-pad"
                      />

                      <Text style={styles.subLabel}>메모(선택)</Text>
                      <TextInput
                        value={draftNote[it.product_code] ?? ""}
                        onChangeText={(t) => setDraftNote((m) => ({ ...m, [it.product_code]: t }))}
                        placeholder="현장 코멘트"
                        placeholderTextColor={THEME.muted}
                        style={[styles.input, { minHeight: 50 }]}
                        multiline
                      />

                      <Text style={styles.subLabel}>사진</Text>
                      {draftUri[it.product_code] ? (
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                          <Image source={{ uri: draftUri[it.product_code] }} style={styles.thumb} />
                          <Pressable
                            onPress={() => setDraftUri((m) => { const n = { ...m }; delete n[it.product_code]; return n; })}
                            style={styles.linkBtn}
                          >
                            <Ionicons name="close-circle" size={18} color={THEME.red} />
                            <Text style={[styles.linkBtnText, { color: THEME.red }]}>삭제</Text>
                          </Pressable>
                        </View>
                      ) : (
                        <View style={{ flexDirection: "row", gap: 8 }}>
                          <Pressable onPress={() => takePhoto(it.product_code)} style={styles.cameraBtn}>
                            <Ionicons name="camera" size={15} color="#fff" />
                            <Text style={styles.cameraBtnText}>촬영</Text>
                          </Pressable>
                          <Pressable onPress={() => pickPhoto(it.product_code)} style={styles.galleryBtn}>
                            <Ionicons name="images-outline" size={15} color={THEME.text} />
                            <Text style={styles.galleryBtnText}>갤러리</Text>
                          </Pressable>
                        </View>
                      )}

                      <Pressable
                        onPress={() => submit(it)}
                        disabled={submittingCode === it.product_code}
                        style={[styles.submitBtn, submittingCode === it.product_code && { opacity: 0.6 }]}
                      >
                        {submittingCode === it.product_code ? (
                          <ActivityIndicator color="#fff" />
                        ) : (
                          <>
                            <Ionicons name="send" size={15} color="#fff" />
                            <Text style={styles.submitBtnText}>{responded ? "재등록" : "회신 등록"}</Text>
                          </>
                        )}
                      </Pressable>
                    </View>
                  )}
                </View>
              );
            })
          )}

          <Text style={[styles.sectionTitle, { marginTop: 24 }]}>내 최근 회신</Text>
          {myResponses.length === 0 ? (
            <Text style={styles.empty}>아직 등록한 회신이 없습니다.</Text>
          ) : (
            myResponses.map((r) => (
              <View key={r.id} style={styles.recentItem}>
                <Text style={styles.recentTitle}>{r.product_name ?? r.product_code}</Text>
                <Text style={styles.recentMeta}>
                  {r.product_code}
                  {r.picking_cell ? ` · ${r.picking_cell}` : ""}
                  {` · ${r.source_date}`}
                </Text>
                <Text style={styles.recentMeta}>
                  실제 소비기한 {r.actual_expiry ?? "—"}
                </Text>
                {r.note ? <Text style={styles.recentNote}>{r.note}</Text> : null}
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
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 12, paddingBottom: 12,
    backgroundColor: THEME.surface, borderBottomWidth: 1, borderBottomColor: THEME.border,
  },
  backBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 16, fontWeight: "800", color: THEME.text, textAlign: "center" },
  headerSub: { fontSize: 11, color: THEME.subtext, textAlign: "center", marginTop: 2 },

  sectionTitle: { fontSize: 13, fontWeight: "800", color: THEME.subtext, marginBottom: 8 },
  errorBox: {
    alignItems: "center", padding: 16, backgroundColor: THEME.surface,
    borderWidth: 1, borderColor: THEME.border, borderRadius: 12, gap: 4,
  },
  errorText: { color: THEME.text, fontWeight: "700", marginTop: 4 },
  errorSub: { color: THEME.subtext, fontSize: 12 },
  emptyBox: {
    alignItems: "center", padding: 24, backgroundColor: THEME.surface,
    borderWidth: 1, borderColor: THEME.border, borderRadius: 12, gap: 6,
  },
  emptyText: { color: THEME.subtext },

  item: {
    backgroundColor: THEME.surface, borderWidth: 1, borderColor: THEME.border,
    borderRadius: 12, marginBottom: 10, overflow: "hidden",
  },
  itemHead: { flexDirection: "row", alignItems: "flex-start", padding: 14, gap: 8 },
  itemTitle: { fontSize: 14, fontWeight: "800", color: THEME.text },
  itemMeta: { fontSize: 11, color: THEME.subtext, marginTop: 2 },
  cellPill: {
    fontSize: 10, fontWeight: "800", color: "#1D4ED8",
    backgroundColor: "#DBEAFE", paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6,
  },
  tag: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6 },
  tagText: { fontSize: 10, fontWeight: "800" },
  itemBody: { paddingHorizontal: 14, paddingBottom: 14, borderTopWidth: 1, borderTopColor: THEME.border, gap: 6 },
  subLabel: { fontSize: 12, fontWeight: "800", color: THEME.subtext, marginTop: 6 },
  input: {
    borderWidth: 1, borderColor: THEME.border, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 8, backgroundColor: THEME.soft,
    fontSize: 13, color: THEME.text, textAlignVertical: "top",
  },
  thumb: { width: 88, height: 88, borderRadius: 8 },
  cameraBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: THEME.primary, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10,
  },
  cameraBtnText: { color: "#fff", fontWeight: "800", fontSize: 13 },
  galleryBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: THEME.soft, borderWidth: 1, borderColor: THEME.border,
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10,
  },
  galleryBtnText: { color: THEME.text, fontWeight: "700", fontSize: 13 },
  linkBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  linkBtnText: { fontSize: 13, fontWeight: "700" },
  submitBtn: {
    marginTop: 10,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    backgroundColor: THEME.text, paddingVertical: 12, borderRadius: 10,
  },
  submitBtnText: { color: "#fff", fontWeight: "800", fontSize: 14 },

  recentItem: {
    backgroundColor: THEME.surface, borderWidth: 1, borderColor: THEME.border,
    borderRadius: 12, padding: 12, marginBottom: 8, gap: 4,
  },
  recentTitle: { fontSize: 14, fontWeight: "800", color: THEME.text },
  recentMeta: { fontSize: 12, color: THEME.subtext },
  recentNote: { fontSize: 12, color: "#7C2D12" },
  empty: { color: THEME.muted, fontSize: 13, paddingVertical: 12, textAlign: "center" },
});
