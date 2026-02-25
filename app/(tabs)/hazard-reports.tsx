import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  SafeAreaView,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { supabase } from "../../src/lib/supabase";

type ReportRow = {
  id: string;
  user_id: string;
  comment: string | null;
  photo_path: string; // 대표 1장 (NOT NULL)
  photo_url: string;  // 대표 1장 (NOT NULL)
  created_at: string;
};

type PhotoRow = {
  id: string;
  report_id: string;
  photo_path: string | null;
  photo_url: string | null;
  created_at: string;
};

function formatKST(ts: string): string {
  const d = new Date(ts);
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const yyyy = kst.getUTCFullYear();
  const mm = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(kst.getUTCDate()).padStart(2, "0");
  const HH = String(kst.getUTCHours()).padStart(2, "0");
  const MI = String(kst.getUTCMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${HH}:${MI}`;
}

export default function HazardReportsScreen() {
  const router = useRouter();

  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const [isAdmin, setIsAdmin] = useState(false);

  const [reports, setReports] = useState<ReportRow[]>([]);
  const [photoMap, setPhotoMap] = useState<Record<string, PhotoRow[]>>({});

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewTitle, setPreviewTitle] = useState("");
  const [previewPhotos, setPreviewPhotos] = useState<Array<{ url: string; path: string }>>([]);
  const [previewComment, setPreviewComment] = useState("");
  const [previewReportId, setPreviewReportId] = useState<string>("");

  const mounted = useRef(false);

  const requireSession = async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      Alert.alert("auth error", error.message);
      return null;
    }
    if (!data.session) {
      Alert.alert("로그인 필요", "세션이 없습니다. 로그인 후 다시 시도하세요.");
      return null;
    }
    return data.session;
  };

  const loadAdminFlag = async () => {
    const session = await requireSession();
    if (!session) return;

    const { data, error } = await supabase
      .from("profiles")
      .select("is_admin")
      .eq("id", session.user.id)
      .maybeSingle();

    setIsAdmin(!error && !!data?.is_admin);
  };

  const fetchReports = async () => {
    const session = await requireSession();
    if (!session) return;

    setLoading(true);
    try {
      // ✅ RLS 정책이 "본인 or 관리자 전체"라서, 여기서는 그냥 select만 하면 됨
      const { data, error } = await supabase
        .from("hazard_reports")
        .select("id, user_id, comment, photo_path, photo_url, created_at")
        .order("created_at", { ascending: false })
        .limit(300);

      if (error) throw error;

      const rows = (data ?? []) as ReportRow[];
      setReports(rows);

      // ✅ 여러장 테이블이 있으면 같이 가져오고, 없으면 무시(앱은 정상 동작)
      const reportIds = rows.map((r) => r.id);
      if (reportIds.length === 0) {
        setPhotoMap({});
        return;
      }

      const { data: photos, error: phErr } = await supabase
        .from("hazard_report_photos")
        .select("id, report_id, photo_path, photo_url, created_at")
        .in("report_id", reportIds);

      if (phErr) {
        // 테이블 없거나 RLS면 여기서 에러 -> 대표 1장만으로 계속
        setPhotoMap({});
        return;
      }

      const map: Record<string, PhotoRow[]> = {};
      for (const p of (photos ?? []) as PhotoRow[]) {
        if (!map[p.report_id]) map[p.report_id] = [];
        map[p.report_id].push(p);
      }
      // 정렬(시간순)
      for (const k of Object.keys(map)) {
        map[k].sort((a, b) => (a.created_at > b.created_at ? -1 : 1));
      }
      setPhotoMap(map);
    } catch (e: any) {
      Alert.alert("조회 오류", e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (mounted.current) return;
    mounted.current = true;
    (async () => {
      await loadAdminFlag();
      await fetchReports();
    })();
  }, []);

  const openPreview = (r: ReportRow) => {
    const extra = photoMap[r.id] ?? [];

    // ✅ 대표 1장 + 추가사진들 합치기 (중복 url 방지)
    const items: Array<{ url: string; path: string }> = [];
    if (r.photo_url && r.photo_path) items.push({ url: r.photo_url, path: r.photo_path });

    for (const p of extra) {
      const url = p.photo_url ?? "";
      const path = p.photo_path ?? "";
      if (!url || !path) continue;
      if (items.find((x) => x.path === path)) continue;
      items.push({ url, path });
    }

    setPreviewReportId(r.id);
    setPreviewTitle(`제보 ${formatKST(r.created_at)}  •  사진 ${items.length}장`);
    setPreviewComment(r.comment ?? "");
    setPreviewPhotos(items);
    setPreviewOpen(true);
  };

  // ✅ B 정책: 본인도 삭제 가능 + 관리자는 전체 삭제 가능
  // (RLS가 막아주니까 UI에서 굳이 더 안 막아도 됨)
  const deleteReport = async (reportId: string) => {
    const session = await requireSession();
    if (!session) return;

    Alert.alert(
      "삭제 확인",
      "이 제보를 완전삭제할까요?\n(사진 파일 + DB 기록 모두 삭제)",
      [
        { text: "취소", style: "cancel" },
        {
          text: "삭제",
          style: "destructive",
          onPress: async () => {
            setBusy(true);
            try {
              // 1) 대표 + 추가 사진 path 모으기
              const { data: rep, error: repErr } = await supabase
                .from("hazard_reports")
                .select("id, photo_path")
                .eq("id", reportId)
                .single();

              if (repErr) throw repErr;

              const paths = new Set<string>();
              if (rep?.photo_path) paths.add(String(rep.photo_path));

              // 추가 사진 테이블에서 경로 조회(없으면 그냥 스킵)
              const { data: exPhotos, error: exErr } = await supabase
                .from("hazard_report_photos")
                .select("photo_path")
                .eq("report_id", reportId);

              if (!exErr && exPhotos?.length) {
                for (const r of exPhotos as any[]) {
                  const p = String(r?.photo_path ?? "");
                  if (p) paths.add(p);
                }
              }

              // 2) Storage 삭제
              const arr = Array.from(paths).filter(Boolean);
              if (arr.length > 0) {
                const { error: rmErr } = await supabase.storage.from("hazard-reports").remove(arr);
                if (rmErr) throw rmErr;
              }

              // 3) DB 삭제 (photos는 FK cascade면 자동 삭제)
              const { error: delErr } = await supabase.from("hazard_reports").delete().eq("id", reportId);
              if (delErr) throw delErr;

              Alert.alert("완료", "삭제 완료");
              setPreviewOpen(false);
              setPreviewReportId("");
              await fetchReports();
            } catch (e: any) {
              Alert.alert("삭제 실패", e?.message ?? String(e));
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  };

  const emptyText = useMemo(() => {
    if (loading) return "";
    return isAdmin ? "제보 내역이 없습니다." : "내 제보 내역이 없습니다.";
  }, [loading, isAdmin]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#FFFFFF" }}>
      {/* 헤더 */}
      <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Pressable
            onPress={() => {
              try {
                router.back();
              } catch {
                router.replace("/(tabs)" as any);
              }
            }}
            style={{
              paddingVertical: 8,
              paddingHorizontal: 10,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: "#E5E7EB",
              backgroundColor: "#F9FAFB",
            }}
          >
            <Text style={{ fontWeight: "900", color: "#111827" }}>←</Text>
          </Pressable>

          <Image
            source={require("../../assets/hanexpress-logo.png")}
            style={{ width: 160, height: 40, resizeMode: "contain" }}
          />
        </View>

        <Text style={{ marginTop: 8, fontSize: 20, fontWeight: "900", color: "#111827" }}>
          위험요인 제보 내역
        </Text>
        <Text style={{ marginTop: 4, color: "#6B7280" }}>
          {isAdmin ? "관리자는 전체 제보를 볼 수 있습니다." : "내가 제보한 내용만 표시됩니다."}
        </Text>

        <Pressable
          onPress={fetchReports}
          disabled={loading || busy}
          style={{
            marginTop: 10,
            height: 44,
            borderRadius: 12,
            backgroundColor: "#111827",
            alignItems: "center",
            justifyContent: "center",
            opacity: loading || busy ? 0.6 : 1,
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "900" }}>
            {loading ? "새로고침 중..." : "새로고침"}
          </Text>
        </Pressable>

        {loading && <ActivityIndicator style={{ marginTop: 8 }} />}
      </View>

      {/* 리스트 */}
      <View style={{ flex: 1, paddingHorizontal: 16, paddingBottom: 12 }}>
        <View style={{ borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 16, overflow: "hidden", flex: 1 }}>
          <FlatList
            data={reports}
            keyExtractor={(r) => r.id}
            ListEmptyComponent={
              <View style={{ padding: 14 }}>
                <Text style={{ color: "#6B7280" }}>{emptyText}</Text>
              </View>
            }
            renderItem={({ item }) => {
              const extraCount = (photoMap[item.id]?.length ?? 0);
              const totalCount = 1 + extraCount;

              return (
                <Pressable
                  onPress={() => openPreview(item)}
                  disabled={busy}
                  style={{
                    padding: 12,
                    borderBottomWidth: 1,
                    borderBottomColor: "#F3F4F6",
                    flexDirection: "row",
                    gap: 12,
                    alignItems: "center",
                    backgroundColor: "#FFFFFF",
                    opacity: busy ? 0.7 : 1,
                  }}
                >
                  <Image
                    source={{ uri: item.photo_url }}
                    style={{ width: 56, height: 56, borderRadius: 12, backgroundColor: "#F3F4F6" }}
                  />

                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={{ fontWeight: "900", fontSize: 15, color: "#111827" }}>
                      {formatKST(item.created_at)} • 사진 {totalCount}장
                    </Text>
                    <Text style={{ color: "#6B7280" }} numberOfLines={2}>
                      {item.comment ?? "(코멘트 없음)"}
                    </Text>
                  </View>

                  <Text style={{ fontWeight: "900", color: "#111827" }}>보기</Text>
                </Pressable>
              );
            }}
          />
        </View>

        <Text style={{ color: "#9CA3AF", marginTop: 8 }}>
          항목을 누르면 상세(사진/코멘트) 확인 및 삭제가 가능합니다.
        </Text>
      </View>

      {/* 상세/미리보기 모달 */}
      <Modal visible={previewOpen} animationType="slide" onRequestClose={() => setPreviewOpen(false)} presentationStyle="fullScreen">
        <SafeAreaView style={{ flex: 1, backgroundColor: "#FFFFFF" }}>
          <View style={{ padding: 16, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ fontSize: 16, fontWeight: "900", flex: 1, color: "#111827" }} numberOfLines={2}>
              {previewTitle}
            </Text>
            <Pressable onPress={() => setPreviewOpen(false)} style={{ padding: 10 }}>
              <Text style={{ fontWeight: "900", color: "#2563EB" }}>닫기</Text>
            </Pressable>
          </View>

          <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
            <Text style={{ fontWeight: "900", color: "#111827" }}>코멘트</Text>
            <Text style={{ color: "#6B7280", marginTop: 6 }}>{previewComment || "(없음)"}</Text>

            <View style={{ height: 14 }} />

            <Pressable
              onPress={() => deleteReport(previewReportId)}
              disabled={busy || !previewReportId}
              style={{
                height: 46,
                borderRadius: 14,
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 1,
                borderColor: "#EF4444",
                backgroundColor: "#FFFFFF",
                opacity: busy || !previewReportId ? 0.4 : 1,
              }}
            >
              <Text style={{ fontWeight: "900", color: "#EF4444" }}>
                {busy ? "삭제 중..." : "이 제보 삭제(사진 포함)"}
              </Text>
            </Pressable>
          </View>

          <FlatList
            data={previewPhotos}
            keyExtractor={(x) => x.path}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, gap: 12 }}
            renderItem={({ item }) => (
              <View style={{ borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 16, padding: 12, backgroundColor: "#FFFFFF" }}>
                <Image
                  source={{ uri: item.url }}
                  style={{ width: "100%", height: 320, borderRadius: 14, backgroundColor: "#F3F4F6" }}
                  resizeMode="contain"
                />
                <View style={{ height: 8 }} />
                <Text style={{ color: "#9CA3AF", fontSize: 12 }} numberOfLines={1}>
                  {item.path}
                </Text>
              </View>
            )}
            ListEmptyComponent={
              <View style={{ padding: 16 }}>
                <Text style={{ color: "#6B7280" }}>사진이 없습니다.</Text>
              </View>
            }
          />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}
