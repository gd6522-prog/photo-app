import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SUPABASE_ANON_KEY, SUPABASE_URL, supabase } from "../../src/lib/supabase";

type ReportRow = {
  id: string;
  user_id: string;
  comment: string | null;
  photo_path: string;
  photo_url: string;
  created_at: string;
};

type PhotoRow = {
  id: string;
  report_id: string;
  photo_path: string | null;
  photo_url: string | null;
  created_at: string;
};

type ResolutionRow = {
  report_id: string;
  after_path: string | null;
  after_public_url: string | null;
  after_memo: string | null;
  improved_by: string | null;
  improved_at: string | null;
  planned_due_date: string | null;
};

type StatusKey = "open" | "pending" | "done";

type StatusFilter = "all" | StatusKey;

async function fetchHazardReportPhotos(params: {
  accessToken: string;
  reportIds: string[];
}): Promise<PhotoRow[]> {
  const payload = {
    report_ids: params.reportIds,
    access_token: params.accessToken,
  };

  const invokeRes = await supabase.functions.invoke("list-hazard-report-photos", {
    body: payload,
  });
  if (!(invokeRes as any)?.error) {
    const rows = (invokeRes as any)?.data?.rows;
    return Array.isArray(rows) ? (rows as PhotoRow[]) : [];
  }

  const res = await fetch(`${SUPABASE_URL}/functions/v1/list-hazard-report-photos`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${params.accessToken}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any)?.error || `HTTP ${res.status}`);
  return Array.isArray((data as any)?.rows) ? ((data as any).rows as PhotoRow[]) : [];
}

function formatKST(ts: string | null | undefined): string {
  if (!ts) return "-";
  const d = new Date(ts);
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const yyyy = kst.getUTCFullYear();
  const mm = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(kst.getUTCDate()).padStart(2, "0");
  const HH = String(kst.getUTCHours()).padStart(2, "0");
  const MI = String(kst.getUTCMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${HH}:${MI}`;
}

function todayYmdKst() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

function getHazardStatus(resolution: ResolutionRow | null): {
  key: StatusKey;
  label: string;
  bg: string;
  border: string;
  text: string;
} {
  const today = todayYmdKst();
  if (resolution?.after_public_url) {
    return { key: "done", label: "처리완료", bg: "#ECFDF3", border: "#A7F3D0", text: "#15803D" };
  }
  if (resolution?.planned_due_date && resolution.planned_due_date >= today) {
    return { key: "pending", label: "처리대기", bg: "#FFF7ED", border: "#FDBA74", text: "#C2410C" };
  }
  return { key: "open", label: "미처리", bg: "#FEF2F2", border: "#FECACA", text: "#DC2626" };
}

export default function HazardReportsScreen() {
  const insets = useSafeAreaInsets();
  const topPad = Math.min(Math.max(insets.top, 6), 18) + 4;

  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  const [reports, setReports] = useState<ReportRow[]>([]);
  const [photoMap, setPhotoMap] = useState<Record<string, PhotoRow[]>>({});
  const [resolutionMap, setResolutionMap] = useState<Record<string, ResolutionRow | null>>({});
  const [filter, setFilter] = useState<StatusFilter>("all");

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewTitle, setPreviewTitle] = useState("");
  const [previewPhotos, setPreviewPhotos] = useState<{ url: string; path: string }[]>([]);
  const [previewComment, setPreviewComment] = useState("");
  const [previewReportId, setPreviewReportId] = useState<string>("");
  const [previewResolution, setPreviewResolution] = useState<ResolutionRow | null>(null);

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
      const { data, error } = await supabase
        .from("hazard_reports")
        .select("id, user_id, comment, photo_path, photo_url, created_at")
        .order("created_at", { ascending: false })
        .limit(300);

      if (error) throw error;

      const rows = (data ?? []) as ReportRow[];
      setReports(rows);

      const reportIds = rows.map((r) => r.id);
      if (reportIds.length === 0) {
        setPhotoMap({});
        setResolutionMap({});
        return;
      }

      try {
        const resolutionRes = await supabase
          .from("hazard_report_resolutions")
          .select("report_id, after_path, after_public_url, after_memo, improved_by, improved_at, planned_due_date")
          .in("report_id", reportIds);

        if (!(resolutionRes as any).error) {
          const map: Record<string, ResolutionRow | null> = {};
          for (const row of ((resolutionRes as any).data ?? []) as ResolutionRow[]) {
            map[row.report_id] = row;
          }
          setResolutionMap(map);
        } else {
          setResolutionMap({});
        }
      } catch {
        setResolutionMap({});
      }

      try {
        const { data: photos, error: phErr } = await supabase
          .from("hazard_report_photos")
          .select("id, report_id, photo_path, photo_url, created_at")
          .in("report_id", reportIds);

        if (!phErr) {
          const map: Record<string, PhotoRow[]> = {};
          for (const p of (photos ?? []) as PhotoRow[]) {
            if (!map[p.report_id]) map[p.report_id] = [];
            map[p.report_id].push(p);
          }
          for (const key of Object.keys(map)) {
            map[key].sort((a, b) => (a.created_at > b.created_at ? -1 : 1));
          }
          setPhotoMap(map);
        } else {
          setPhotoMap({});
        }
      } catch {
        setPhotoMap({});
      }
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

  useEffect(() => {
    if (reports.length === 0) return;
    let cancelled = false;

    (async () => {
      const session = await requireSession();
      if (!session) return;

      try {
        const rows = await fetchHazardReportPhotos({
          accessToken: String(session.access_token ?? ""),
          reportIds: reports.map((r) => r.id),
        });

        if (cancelled) return;

        const map: Record<string, PhotoRow[]> = {};
        for (const p of rows) {
          if (!map[p.report_id]) map[p.report_id] = [];
          map[p.report_id].push(p);
        }
        for (const key of Object.keys(map)) {
          map[key].sort((a, b) => (a.created_at > b.created_at ? -1 : 1));
        }
        setPhotoMap((prev) => ({ ...prev, ...map }));
      } catch {}
    })();

    return () => {
      cancelled = true;
    };
  }, [reports]);

  const statusCounts = useMemo(() => {
    const counts = { open: 0, pending: 0, done: 0 };
    for (const report of reports) {
      counts[getHazardStatus(resolutionMap[report.id] ?? null).key] += 1;
    }
    return counts;
  }, [reports, resolutionMap]);

  const visibleReports = useMemo(() => {
    const items = reports.filter((report) => {
      if (filter === "all") return true;
      return getHazardStatus(resolutionMap[report.id] ?? null).key === filter;
    });

    const order = { open: 0, pending: 1, done: 2 } as const;
    return [...items].sort((a, b) => {
      const aResolution = resolutionMap[a.id] ?? null;
      const bResolution = resolutionMap[b.id] ?? null;
      const aStatus = getHazardStatus(aResolution).key;
      const bStatus = getHazardStatus(bResolution).key;
      if (aStatus !== bStatus) return order[aStatus] - order[bStatus];

      if (aStatus === "done" && bStatus === "done") {
        const aTime = new Date(aResolution?.improved_at ?? "").getTime();
        const bTime = new Date(bResolution?.improved_at ?? "").getTime();
        if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) {
          return bTime - aTime;
        }
      }

      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [filter, reports, resolutionMap]);

  const openPreview = (report: ReportRow) => {
    const extra = photoMap[report.id] ?? [];
    const items: { url: string; path: string }[] = [];

    if (report.photo_url && report.photo_path) {
      items.push({ url: report.photo_url, path: report.photo_path });
    }
    for (const photo of extra) {
      const url = photo.photo_url ?? "";
      const path = photo.photo_path ?? "";
      if (!url || !path) continue;
      if (items.find((item) => item.path === path)) continue;
      items.push({ url, path });
    }

    setPreviewReportId(report.id);
    setPreviewTitle(`제보 ${formatKST(report.created_at)} / 사진 ${items.length}장`);
    setPreviewComment(report.comment ?? "");
    setPreviewPhotos(items);
    setPreviewResolution(resolutionMap[report.id] ?? null);
    setPreviewOpen(true);
  };

  const deleteReport = async (reportId: string) => {
    const session = await requireSession();
    if (!session) return;

    Alert.alert("삭제 확인", "이 제보를 완전히 삭제할까요?\n(사진 파일 + DB 기록 모두 삭제)", [
      { text: "취소", style: "cancel" },
      {
        text: "삭제",
        style: "destructive",
        onPress: async () => {
          setBusy(true);
          try {
            const { data: rep, error: repErr } = await supabase
              .from("hazard_reports")
              .select("id, photo_path")
              .eq("id", reportId)
              .single();

            if (repErr) throw repErr;

            const paths = new Set<string>();
            if (rep?.photo_path) paths.add(String(rep.photo_path));

            const { data: exPhotos, error: exErr } = await supabase
              .from("hazard_report_photos")
              .select("photo_path")
              .eq("report_id", reportId);

            if (!exErr && exPhotos?.length) {
              for (const row of exPhotos as any[]) {
                const path = String(row?.photo_path ?? "");
                if (path) paths.add(path);
              }
            }

            const resolution = resolutionMap[reportId];
            if (resolution?.after_path) paths.add(String(resolution.after_path));

            const removeTargets = Array.from(paths).filter(Boolean);
            if (removeTargets.length > 0) {
              const { error: rmErr } = await supabase.storage.from("hazard-reports").remove(removeTargets);
              if (rmErr) throw rmErr;
            }

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
    ]);
  };

  const emptyText = useMemo(() => {
    if (loading) return "";
    if (filter === "all") return isAdmin ? "제보 내역이 없습니다." : "내 제보 내역이 없습니다.";
    if (filter === "open") return "미처리 제보가 없습니다.";
    if (filter === "pending") return "처리대기 제보가 없습니다.";
    return "처리완료 제보가 없습니다.";
  }, [filter, isAdmin, loading]);

  const previewStatus = getHazardStatus(previewResolution);

  const filterButton = (key: StatusFilter, label: string, count?: number) => {
    const active = filter === key;
    return (
      <Pressable
        key={key}
        onPress={() => setFilter(key)}
        style={{
          flex: key === "all" ? 0 : 1,
          minWidth: key === "all" ? 74 : 0,
          height: 40,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: active ? "#111827" : "#E5E7EB",
          backgroundColor: active ? "#111827" : "#FFFFFF",
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: 10,
        }}
      >
        <Text style={{ color: active ? "#FFFFFF" : "#374151", fontWeight: "900", fontSize: 13 }}>
          {label}
          {typeof count === "number" ? ` ${count}` : ""}
        </Text>
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#FFFFFF" }}>
      <View style={{ paddingHorizontal: 16, paddingTop: topPad, paddingBottom: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Text style={{ fontSize: 24, fontWeight: "900", color: "#111827", letterSpacing: -0.4 }}>위험요인 제보 내역</Text>
        </View>

        <View style={{ marginTop: 12, flexDirection: "row", gap: 8 }}>
          {filterButton("all", "전체")}
          {filterButton("open", "미처리", statusCounts.open)}
          {filterButton("pending", "처리대기", statusCounts.pending)}
          {filterButton("done", "처리완료", statusCounts.done)}
        </View>

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
          <Text style={{ color: "#fff", fontWeight: "900" }}>{loading ? "새로고침 중..." : "새로고침"}</Text>
        </Pressable>

        {loading ? <ActivityIndicator style={{ marginTop: 8 }} /> : null}
      </View>

      <View style={{ flex: 1, paddingHorizontal: 16, paddingBottom: 12 }}>
        <View style={{ borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 16, overflow: "hidden", flex: 1 }}>
          <FlatList
            data={visibleReports}
            keyExtractor={(item) => item.id}
            ListEmptyComponent={
              <View style={{ padding: 14 }}>
                <Text style={{ color: "#6B7280" }}>{emptyText}</Text>
              </View>
            }
            renderItem={({ item }) => {
              const extraCount = photoMap[item.id]?.length ?? 0;
              const totalCount = 1 + extraCount;
              const resolution = resolutionMap[item.id] ?? null;
              const status = getHazardStatus(resolution);

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
                  <Image source={{ uri: item.photo_url }} style={{ width: 56, height: 56, borderRadius: 12, backgroundColor: "#F3F4F6" }} />

                  <View style={{ flex: 1, gap: 5 }}>
                    <Text style={{ fontWeight: "900", fontSize: 14, color: "#111827" }}>{formatKST(item.created_at)} / 사진 {totalCount}장</Text>
                    <Text style={{ color: "#6B7280" }} numberOfLines={2}>
                      {item.comment ?? "(코멘트 없음)"}
                    </Text>
                    {status.key === "pending" && resolution?.planned_due_date ? (
                      <Text style={{ color: "#C2410C", fontWeight: "800", fontSize: 12 }}>예정일: {resolution.planned_due_date}</Text>
                    ) : null}
                    {status.key === "done" ? (
                      <Text style={{ color: "#15803D", fontWeight: "800", fontSize: 12 }}>개선일: {formatKST(resolution?.improved_at)}</Text>
                    ) : null}
                  </View>

                  <View
                    style={{
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                      borderRadius: 10,
                      backgroundColor: status.bg,
                      borderWidth: 1,
                      borderColor: status.border,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Text style={{ color: status.text, fontWeight: "900", fontSize: 12 }}>{status.label}</Text>
                  </View>
                </Pressable>
              );
            }}
          />
        </View>

        <Text style={{ color: "#9CA3AF", marginTop: 8 }}>항목을 누르면 제보 사진과 처리 상태를 자세히 확인할 수 있습니다.</Text>
      </View>

      <Modal visible={previewOpen} animationType="slide" onRequestClose={() => setPreviewOpen(false)} presentationStyle="fullScreen">
        <SafeAreaView style={{ flex: 1, backgroundColor: "#FFFFFF" }}>
          <View style={{ padding: 16, flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={{ fontSize: 16, fontWeight: "900", color: "#111827" }} numberOfLines={2}>
                {previewTitle}
              </Text>
              <View
                style={{
                  alignSelf: "flex-start",
                  paddingHorizontal: 10,
                  height: 24,
                  borderRadius: 999,
                  backgroundColor: previewStatus.bg,
                  borderWidth: 1,
                  borderColor: previewStatus.border,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text style={{ color: previewStatus.text, fontWeight: "900", fontSize: 12 }}>{previewStatus.label}</Text>
              </View>
            </View>
            <Pressable onPress={() => setPreviewOpen(false)} style={{ padding: 10 }}>
              <Text style={{ fontWeight: "900", color: "#2563EB" }}>닫기</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, gap: 14 }}>
            <View style={{ borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 16, backgroundColor: "#FFFFFF", padding: 14 }}>
              <Text style={{ fontWeight: "900", color: "#111827" }}>제보 코멘트</Text>
              <Text style={{ color: "#6B7280", marginTop: 6 }}>{previewComment || "(없음)"}</Text>
            </View>

            <View style={{ gap: 10 }}>
              <Text style={{ fontWeight: "900", color: "#111827", fontSize: 15 }}>제보 사진</Text>
              {previewPhotos.length === 0 ? (
                <View style={{ padding: 16 }}>
                  <Text style={{ color: "#6B7280" }}>사진이 없습니다.</Text>
                </View>
              ) : (
                previewPhotos.map((item) => (
                  <View key={item.path} style={{ borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 16, padding: 12, backgroundColor: "#FFFFFF" }}>
                    <Image source={{ uri: item.url }} style={{ width: "100%", height: 320, borderRadius: 14, backgroundColor: "#F3F4F6" }} resizeMode="contain" />
                    <View style={{ height: 8 }} />
                    <Text style={{ color: "#9CA3AF", fontSize: 12 }} numberOfLines={1}>
                      {item.path}
                    </Text>
                  </View>
                ))
              )}
            </View>

            {previewStatus.key === "pending" && previewResolution?.planned_due_date ? (
              <View style={{ borderWidth: 1, borderColor: "#FDBA74", borderRadius: 16, backgroundColor: "#FFF7ED", padding: 14 }}>
                <Text style={{ fontWeight: "900", color: "#9A3412" }}>처리대기 정보</Text>
                <Text style={{ color: "#C2410C", marginTop: 6 }}>예정일: {previewResolution.planned_due_date}</Text>
              </View>
            ) : null}

            {previewStatus.key === "done" ? (
              <View style={{ gap: 10 }}>
                <Text style={{ fontWeight: "900", color: "#111827", fontSize: 15 }}>개선 완료 정보</Text>

                {previewResolution?.after_public_url ? (
                  <View style={{ borderWidth: 1, borderColor: "#BBF7D0", borderRadius: 16, padding: 12, backgroundColor: "#FFFFFF" }}>
                    <Image
                      source={{ uri: previewResolution.after_public_url }}
                      style={{ width: "100%", height: 320, borderRadius: 14, backgroundColor: "#F3F4F6" }}
                      resizeMode="contain"
                    />
                    <View style={{ height: 10 }} />
                    <Text style={{ color: "#15803D", fontWeight: "800" }}>개선일: {formatKST(previewResolution.improved_at)}</Text>
                    <Text style={{ color: "#374151", marginTop: 6 }}>{previewResolution.after_memo || "(개선 설명 없음)"}</Text>
                  </View>
                ) : null}
              </View>
            ) : null}

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
              <Text style={{ fontWeight: "900", color: "#EF4444" }}>{busy ? "삭제 중..." : "이 제보 삭제(사진 포함)"}</Text>
            </Pressable>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}
