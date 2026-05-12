// 긴급출고 화면 (일반 작업자용)
// - 본인 work_part 대상 dispatch 목록 (미해결 우선)
// - 항목 펼침: 본문 / 매장 / 사진 회신 폼 / 본인 회신 사진들
// - 사진 회신: 카메라 1장 촬영 → photos 테이블에 저장 → urgent_dispatch_replies 에 photo_id 연결
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
import { fetchMyReplies, fetchUrgentDispatches, UrgentDispatchReplyRow, UrgentDispatchRow } from "../../src/lib/worker";

const THEME = {
  bg: "#F7F7F8",
  surface: "#FFFFFF",
  text: "#111827",
  subtext: "#6B7280",
  border: "#E5E7EB",
  muted: "#9CA3AF",
  soft: "#F9FAFB",
  orange: "#FF6A00",
  orangeSoft: "#FFF1E6",
  success: "#16A34A",
  red: "#DC2626",
};

type RepliesByDispatch = Record<string, UrgentDispatchReplyRow[]>;
type PhotoUrlMap = Record<string, string>;

export default function UrgentDispatchScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [userId, setUserId] = useState<string | null>(null);
  const [workPart, setWorkPart] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [dispatches, setDispatches] = useState<UrgentDispatchRow[]>([]);
  const [replies, setReplies] = useState<RepliesByDispatch>({});
  const [photoUrls, setPhotoUrls] = useState<PhotoUrlMap>({});
  const [openId, setOpenId] = useState<string | null>(null);

  const [draftUriById, setDraftUriById] = useState<Record<string, string>>({});
  const [draftNoteById, setDraftNoteById] = useState<Record<string, string>>({});
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const u = userRes?.user;
      if (!u) {
        setLoading(false);
        return;
      }
      setUserId(u.id);
      const { data: prof } = await supabase.from("profiles").select("work_part").eq("id", u.id).single();
      const wp = ((prof as any)?.work_part ?? "").trim();
      setWorkPart(wp);
      if (!wp) {
        setDispatches([]);
        setReplies({});
        setLoading(false);
        return;
      }
      const list = await fetchUrgentDispatches(wp);
      setDispatches(list);

      const ids = list.map((d) => d.id);
      const myReplies = await fetchMyReplies(u.id, ids);
      const map: RepliesByDispatch = {};
      myReplies.forEach((r) => {
        if (!map[r.dispatch_id]) map[r.dispatch_id] = [];
        map[r.dispatch_id].push(r);
      });
      setReplies(map);

      // 회신 사진 URL 미리 가져오기
      const photoIds = myReplies.map((r) => r.photo_id).filter(Boolean) as string[];
      if (photoIds.length > 0) {
        const { data: pdata } = await supabase
          .from("photos")
          .select("id, original_url")
          .in("id", photoIds);
        const urlMap: PhotoUrlMap = {};
        (pdata ?? []).forEach((p: any) => { urlMap[p.id] = p.original_url; });
        setPhotoUrls(urlMap);
      } else {
        setPhotoUrls({});
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);
  useFocusEffect(useCallback(() => { loadAll(); return () => {}; }, [loadAll]));

  const takePhoto = async (dispatchId: string) => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("권한 필요", "카메라 권한을 허용해주세요.");
      return;
    }
    const shot = await ImagePicker.launchCameraAsync({ quality: 0.9, allowsEditing: false });
    if (shot.canceled) return;
    const uri = shot.assets?.[0]?.uri ?? "";
    if (!uri) return;
    setDraftUriById((m) => ({ ...m, [dispatchId]: uri }));
  };

  const pickFromGallery = async (dispatchId: string) => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("권한 필요", "갤러리 접근 권한을 허용해주세요.");
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9,
    });
    if (picked.canceled) return;
    const uri = picked.assets?.[0]?.uri ?? "";
    if (!uri) return;
    setDraftUriById((m) => ({ ...m, [dispatchId]: uri }));
  };

  const submitReply = async (d: UrgentDispatchRow) => {
    if (!userId) return;
    const uri = draftUriById[d.id];
    const note = (draftNoteById[d.id] ?? "").trim();
    if (!uri) {
      Alert.alert("사진 필요", "사진을 촬영하거나 선택해 주세요.");
      return;
    }
    setSubmittingId(d.id);
    try {
      const up = await uploadWorkerPhoto({
        uri,
        userId,
        storeCode: d.target_store_code ?? null,
        workPart: workPart || null,
        category: "field",
      });
      if (!up.ok || !up.photoId) {
        Alert.alert("업로드 실패", up.error ?? "사진 업로드에 실패했습니다.");
        return;
      }
      const { error } = await supabase.from("urgent_dispatch_replies").insert({
        dispatch_id: d.id,
        user_id: userId,
        photo_id: up.photoId,
        note: note || null,
      });
      if (error) {
        Alert.alert("등록 실패", error.message);
        return;
      }
      setDraftUriById((m) => { const n = { ...m }; delete n[d.id]; return n; });
      setDraftNoteById((m) => { const n = { ...m }; delete n[d.id]; return n; });
      await loadAll();
      Alert.alert("회신 완료", "사진이 등록되었습니다.");
    } catch (e: any) {
      Alert.alert("오류", e?.message ?? String(e));
    } finally {
      setSubmittingId(null);
    }
  };

  const formatKst = (iso: string) => {
    try {
      const d = new Date(iso);
      return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
    } catch { return iso; }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: THEME.bg }}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 8) }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={THEME.text} />
        </Pressable>
        <View>
          <Text style={styles.headerTitle}>긴급출고</Text>
          {!!workPart && <Text style={styles.headerSub}>{workPart}</Text>}
        </View>
        <Pressable onPress={loadAll} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="refresh" size={20} color={THEME.text} />
        </Pressable>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
          {loading ? (
            <View style={{ paddingVertical: 40, alignItems: "center" }}>
              <ActivityIndicator />
            </View>
          ) : dispatches.length === 0 ? (
            <View style={{ paddingVertical: 60, alignItems: "center" }}>
              <MaterialCommunityIcons name="check-circle-outline" size={36} color={THEME.muted} />
              <Text style={{ color: THEME.subtext, marginTop: 8 }}>등록된 긴급출고 공지가 없습니다.</Text>
            </View>
          ) : (
            dispatches.map((d) => {
              const myReplies = replies[d.id] ?? [];
              const replied = myReplies.length > 0;
              const resolved = !!d.resolved_at;
              const open = openId === d.id;
              return (
                <View key={d.id} style={[styles.item, resolved && { opacity: 0.65 }]}>
                  <Pressable onPress={() => setOpenId(open ? null : d.id)} style={styles.itemHead}>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 }}>
                        {resolved ? (
                          <View style={[styles.tag, { backgroundColor: "#E5E7EB" }]}>
                            <Text style={[styles.tagText, { color: "#374151" }]}>종료</Text>
                          </View>
                        ) : replied ? (
                          <View style={[styles.tag, { backgroundColor: "#DCFCE7" }]}>
                            <Text style={[styles.tagText, { color: "#15803D" }]}>회신완료</Text>
                          </View>
                        ) : (
                          <View style={[styles.tag, { backgroundColor: "#FEE2E2" }]}>
                            <Text style={[styles.tagText, { color: "#B91C1C" }]}>미회신</Text>
                          </View>
                        )}
                        <Text style={styles.itemTime}>{formatKst(d.created_at)}</Text>
                      </View>
                      <Text style={styles.itemTitle}>{d.title}</Text>
                    </View>
                    <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={THEME.muted} />
                  </Pressable>

                  {open && (
                    <View style={styles.itemBody}>
                      {!!d.target_store_name && (
                        <Text style={styles.storeLine}>
                          <MaterialCommunityIcons name="storefront-outline" size={13} color={THEME.subtext} />
                          {"  "}{d.target_store_code ? `${d.target_store_code} · ` : ""}{d.target_store_name}
                        </Text>
                      )}
                      <Text style={styles.bodyText}>{d.body}</Text>

                      {myReplies.length > 0 && (
                        <View style={{ marginTop: 8, gap: 6 }}>
                          <Text style={styles.subLabel}>내 회신</Text>
                          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                            {myReplies.map((r) => {
                              const url = r.photo_id ? photoUrls[r.photo_id] : null;
                              return (
                                <View key={r.id} style={styles.replyThumbWrap}>
                                  {url ? (
                                    <Image source={{ uri: url }} style={styles.replyThumb} />
                                  ) : (
                                    <View style={[styles.replyThumb, { backgroundColor: THEME.soft, alignItems: "center", justifyContent: "center" }]}>
                                      <Ionicons name="image-outline" size={20} color={THEME.muted} />
                                    </View>
                                  )}
                                  {!!r.note && <Text style={styles.replyNote} numberOfLines={2}>{r.note}</Text>}
                                </View>
                              );
                            })}
                          </View>
                        </View>
                      )}

                      {!resolved && (
                        <View style={{ marginTop: 12, gap: 8 }}>
                          <Text style={styles.subLabel}>{replied ? "추가 사진 회신" : "사진 회신"}</Text>
                          {draftUriById[d.id] ? (
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                              <Image source={{ uri: draftUriById[d.id] }} style={styles.draftThumb} />
                              <Pressable
                                onPress={() => setDraftUriById((m) => { const n = { ...m }; delete n[d.id]; return n; })}
                                style={styles.linkBtn}
                              >
                                <Ionicons name="close-circle" size={18} color={THEME.red} />
                                <Text style={[styles.linkBtnText, { color: THEME.red }]}>삭제</Text>
                              </Pressable>
                            </View>
                          ) : (
                            <View style={{ flexDirection: "row", gap: 8 }}>
                              <Pressable onPress={() => takePhoto(d.id)} style={styles.cameraBtn}>
                                <Ionicons name="camera" size={16} color="#fff" />
                                <Text style={styles.cameraBtnText}>촬영</Text>
                              </Pressable>
                              <Pressable onPress={() => pickFromGallery(d.id)} style={styles.galleryBtn}>
                                <Ionicons name="images-outline" size={16} color={THEME.text} />
                                <Text style={styles.galleryBtnText}>갤러리</Text>
                              </Pressable>
                            </View>
                          )}
                          <TextInput
                            value={draftNoteById[d.id] ?? ""}
                            onChangeText={(t) => setDraftNoteById((m) => ({ ...m, [d.id]: t }))}
                            placeholder="코멘트(선택)"
                            placeholderTextColor={THEME.muted}
                            style={styles.input}
                            multiline
                          />
                          <Pressable
                            onPress={() => submitReply(d)}
                            disabled={submittingId === d.id}
                            style={[styles.submitBtn, submittingId === d.id && { opacity: 0.6 }]}
                          >
                            {submittingId === d.id ? (
                              <ActivityIndicator color="#fff" />
                            ) : (
                              <>
                                <Ionicons name="send" size={15} color="#fff" />
                                <Text style={styles.submitBtnText}>회신 등록</Text>
                              </>
                            )}
                          </Pressable>
                        </View>
                      )}
                    </View>
                  )}
                </View>
              );
            })
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

  item: {
    backgroundColor: THEME.surface,
    borderWidth: 1, borderColor: THEME.border,
    borderRadius: 12, marginBottom: 10, overflow: "hidden",
  },
  itemHead: { flexDirection: "row", alignItems: "center", padding: 14, gap: 8 },
  itemTitle: { fontSize: 15, fontWeight: "800", color: THEME.text },
  itemTime: { fontSize: 11, color: THEME.muted },
  tag: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6 },
  tagText: { fontSize: 10, fontWeight: "800" },
  itemBody: { paddingHorizontal: 14, paddingBottom: 14, borderTopWidth: 1, borderTopColor: THEME.border },
  storeLine: { fontSize: 12, color: THEME.subtext, marginTop: 10 },
  bodyText: { fontSize: 14, color: THEME.text, marginTop: 8, lineHeight: 20 },
  subLabel: { fontSize: 12, fontWeight: "800", color: THEME.subtext, marginTop: 4 },
  replyThumbWrap: { gap: 4, alignItems: "center", width: 88 },
  replyThumb: { width: 88, height: 88, borderRadius: 8, backgroundColor: THEME.soft },
  replyNote: { fontSize: 10, color: THEME.subtext, width: 88 },

  cameraBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: THEME.orange, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10,
  },
  cameraBtnText: { color: "#fff", fontWeight: "800", fontSize: 13 },
  galleryBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: THEME.soft, borderWidth: 1, borderColor: THEME.border, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10,
  },
  galleryBtnText: { color: THEME.text, fontWeight: "700", fontSize: 13 },
  draftThumb: { width: 88, height: 88, borderRadius: 8 },
  linkBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  linkBtnText: { fontSize: 13, fontWeight: "700" },

  input: {
    borderWidth: 1, borderColor: THEME.border, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 8, minHeight: 60, backgroundColor: THEME.soft,
    fontSize: 13, color: THEME.text, textAlignVertical: "top",
  },
  submitBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    backgroundColor: THEME.text, paddingVertical: 12, borderRadius: 10,
  },
  submitBtnText: { color: "#fff", fontWeight: "800", fontSize: 14 },
});
