import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Dimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const SCREEN_W = Dimensions.get("window").width;
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as ImageManipulator from "expo-image-manipulator";
import { Buffer } from "buffer";
import { Calendar } from "react-native-calendars";
import { supabase } from "../../src/lib/supabase";

const THEME = {
  bg: "#F7F7F8",
  surface: "#FFFFFF",
  text: "#111827",
  subtext: "#6B7280",
  border: "#E5E7EB",
  muted: "#9CA3AF",
  soft: "#F9FAFB",
  orange: "#FF6A00",
  orangeSoft: "rgba(255,106,0,0.09)",
  orangeBorder: "rgba(255,106,0,0.30)",
  danger: "#EF4444",
  dangerSoft: "#FEF2F2",
  success: "#16A34A",
  successSoft: "#ECFDF3",
  warn: "#C2410C",
  warnSoft: "#FFF7ED",
};

const WEB_API_URL = "https://han-admin.vercel.app";

async function uriToBuffer(uri: string): Promise<{ buffer: ArrayBuffer; contentType: string }> {
  const ext = uri.split(".").pop()?.toLowerCase() ?? "";
  let finalUri = uri;
  let contentType = "image/jpeg";
  if (ext === "heic" || ext === "heif") {
    const result = await ImageManipulator.manipulateAsync(uri, [], { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG });
    finalUri = result.uri;
  } else if (ext === "png") {
    contentType = "image/png";
  }
  const base64 = await FileSystem.readAsStringAsync(finalUri, { encoding: FileSystem.EncodingType.Base64 });
  const buf = Buffer.from(base64, "base64");
  return { buffer: new Uint8Array(buf).buffer, contentType };
}

async function uploadImprovementToR2(params: {
  buffer: ArrayBuffer;
  contentType: string;
  path: string;
  accessToken: string;
}): Promise<{ publicUrl: string }> {
  const res = await fetch(`${WEB_API_URL}/api/r2/upload-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${params.accessToken}` },
    body: JSON.stringify({ bucket: "hazard-reports", path: params.path, contentType: params.contentType }),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.message ?? "R2 URL 발급 실패");
  const upRes = await fetch(data.uploadUrl, { method: "PUT", headers: { "Content-Type": params.contentType }, body: params.buffer });
  if (!upRes.ok) throw new Error("R2 업로드 실패");
  return { publicUrl: data.publicUrl };
}

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


function formatKST(ts: string | null | undefined): string {
  if (!ts) return "-";
  const d = new Date(ts);
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const mm = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(kst.getUTCDate()).padStart(2, "0");
  const HH = String(kst.getUTCHours()).padStart(2, "0");
  const MI = String(kst.getUTCMinutes()).padStart(2, "0");
  return `${mm}/${dd} ${HH}:${MI}`;
}

function formatKSTFull(ts: string | null | undefined): string {
  if (!ts) return "-";
  const d = new Date(ts);
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const yyyy = kst.getUTCFullYear();
  const mm = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(kst.getUTCDate()).padStart(2, "0");
  const HH = String(kst.getUTCHours()).padStart(2, "0");
  const MI = String(kst.getUTCMinutes()).padStart(2, "0");
  return `${yyyy}.${mm}.${dd} ${HH}:${MI}`;
}

function todayYmdKst() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

function getHazardStatus(resolution: ResolutionRow | null): {
  key: StatusKey; label: string; bg: string; border: string; text: string; icon: string;
} {
  const today = todayYmdKst();
  if (resolution?.after_public_url) {
    return { key: "done", label: "처리완료", bg: THEME.successSoft, border: "#A7F3D0", text: THEME.success, icon: "checkmark-circle" };
  }
  if (resolution?.planned_due_date && resolution.planned_due_date >= today) {
    return { key: "pending", label: "처리대기", bg: THEME.warnSoft, border: "#FDBA74", text: THEME.warn, icon: "time" };
  }
  return { key: "open", label: "미처리", bg: THEME.dangerSoft, border: "#FECACA", text: THEME.danger, icon: "alert-circle" };
}

function PhotoSlide({ uri }: { uri: string }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <View style={[photoSlideStyle, { justifyContent: "center", alignItems: "center" }]}>
      {!loaded && <ActivityIndicator color={THEME.orange} style={{ position: "absolute" }} />}
      <Image
        source={{ uri }}
        style={photoSlideStyle}
        resizeMode="cover"
        fadeDuration={0}
        onLoad={() => setLoaded(true)}
      />
    </View>
  );
}
const photoSlideStyle = { width: SCREEN_W - 32, height: 260, borderRadius: 16, backgroundColor: "#F3F4F6" } as const;

export default function HazardReportsScreen() {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "android"
    ? Math.max(insets.top, 40)
    : Math.min(Math.max(insets.top, 6), 18) + 4;

  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  const [reports, setReports] = useState<ReportRow[]>([]);
  const [photoMap, setPhotoMap] = useState<Record<string, PhotoRow[]>>({});
  const [resolutionMap, setResolutionMap] = useState<Record<string, ResolutionRow | null>>({});
  const [filter, setFilter] = useState<StatusFilter>("all");

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewPhotos, setPreviewPhotos] = useState<{ url: string; path: string; created_at?: string }[]>([]);
  const [previewComment, setPreviewComment] = useState("");
  const [previewReportId, setPreviewReportId] = useState<string>("");
  const [previewResolution, setPreviewResolution] = useState<ResolutionRow | null>(null);
  const [previewCreatedAt, setPreviewCreatedAt] = useState<string>("");
  const [activePhotoIdx, setActivePhotoIdx] = useState(0);

  const [improveMode, setImproveMode] = useState<"none" | "pending" | "done">("none");
  const [improveMemo, setImproveMemo] = useState("");
  const [improveDate, setImproveDate] = useState("");
  const [improveImageUri, setImproveImageUri] = useState<string | null>(null);
  const [improveBusy, setImproveBusy] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);

  const scrollViewRef = useRef<ScrollView>(null);
  const mounted = useRef(false);

  const resetImproveForm = () => {
    setImproveMode("none");
    setImproveMemo("");
    setImproveDate("");
    setImproveImageUri(null);
    setCalendarOpen(false);
  };

  const closePreview = () => {
    setPreviewOpen(false);
    setPreviewReportId("");
    resetImproveForm();
  };

  const requireSession = async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error) { Alert.alert("auth error", error.message); return null; }
    if (!data.session) { Alert.alert("로그인 필요", "세션이 없습니다."); return null; }
    return data.session;
  };

  const loadAdminFlag = async (session: { user: { id: string } }) => {
    const { data, error } = await supabase.from("profiles").select("is_admin, work_part").eq("id", session.user.id).maybeSingle();
    if (error || !data) return;
    const adminByFlag = !!data.is_admin;
    const adminByPart = String(data.work_part ?? "").includes("관리자");
    setIsAdmin(adminByFlag || adminByPart);
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
      if (reportIds.length === 0) { setPhotoMap({}); setResolutionMap({}); return; }

      // resolutions + photos 병렬 조회
      const [resolutionRes, photoRes] = await Promise.allSettled([
        supabase
          .from("hazard_report_resolutions")
          .select("report_id, after_path, after_public_url, after_memo, improved_by, improved_at, planned_due_date")
          .in("report_id", reportIds),
        supabase
          .from("hazard_report_photos")
          .select("id, report_id, photo_path, photo_url, created_at")
          .in("report_id", reportIds),
      ]);

      if (resolutionRes.status === "fulfilled" && !(resolutionRes.value as any).error) {
        const map: Record<string, ResolutionRow | null> = {};
        for (const row of ((resolutionRes.value as any).data ?? []) as ResolutionRow[]) map[row.report_id] = row;
        setResolutionMap(map);
      } else setResolutionMap({});

      if (photoRes.status === "fulfilled" && !(photoRes.value as any).error) {
        const map: Record<string, PhotoRow[]> = {};
        for (const p of ((photoRes.value as any).data ?? []) as PhotoRow[]) {
          if (!map[p.report_id]) map[p.report_id] = [];
          map[p.report_id].push(p);
        }
        for (const key of Object.keys(map)) map[key].sort((a, b) => (a.created_at > b.created_at ? -1 : 1));
        setPhotoMap(map);
      } else setPhotoMap({});
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
      const session = await requireSession();
      if (!session) return;
      // admin 확인 + 목록 조회 병렬 실행
      await Promise.all([loadAdminFlag(session), fetchReports()]);
    })();
  }, []);

  const statusCounts = useMemo(() => {
    const counts = { open: 0, pending: 0, done: 0 };
    for (const report of reports) counts[getHazardStatus(resolutionMap[report.id] ?? null).key] += 1;
    return counts;
  }, [reports, resolutionMap]);

  const visibleReports = useMemo(() => {
    const items = reports.filter((report) => {
      if (filter === "all") return true;
      return getHazardStatus(resolutionMap[report.id] ?? null).key === filter;
    });
    const order = { open: 0, pending: 1, done: 2 } as const;
    return [...items].sort((a, b) => {
      const aRes = resolutionMap[a.id] ?? null;
      const bRes = resolutionMap[b.id] ?? null;
      const aStatus = getHazardStatus(aRes).key;
      const bStatus = getHazardStatus(bRes).key;
      if (aStatus !== bStatus) return order[aStatus] - order[bStatus];
      if (aStatus === "done" && bStatus === "done") {
        const aTime = new Date(aRes?.improved_at ?? "").getTime();
        const bTime = new Date(bRes?.improved_at ?? "").getTime();
        if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) return bTime - aTime;
      }
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [filter, reports, resolutionMap]);

  const openPreview = (report: ReportRow) => {
    const extra = photoMap[report.id] ?? [];
    const items: { url: string; path: string; created_at?: string }[] = [];
    if (report.photo_url && report.photo_path) items.push({ url: report.photo_url, path: report.photo_path, created_at: report.created_at });
    for (const photo of extra) {
      const url = photo.photo_url ?? "";
      const path = photo.photo_path ?? "";
      if (!url || !path || items.find((i) => i.path === path)) continue;
      items.push({ url, path, created_at: photo.created_at });
    }
    setPreviewReportId(report.id);
    setPreviewCreatedAt(report.created_at);
    setPreviewComment(report.comment ?? "");
    setPreviewPhotos(items);
    setPreviewResolution(resolutionMap[report.id] ?? null);
    setActivePhotoIdx(0);
    setPreviewOpen(true);
  };

  const savePending = async () => {
    if (!improveDate.trim()) return Alert.alert("처리대기", "개선예정일을 선택하세요.");
    const session = await requireSession();
    if (!session) return;
    setImproveBusy(true);
    try {
      const existing = resolutionMap[previewReportId];
      const { error } = await supabase.from("hazard_report_resolutions").upsert(
        { report_id: previewReportId, after_path: existing?.after_path ?? null, after_public_url: existing?.after_public_url ?? null, after_memo: existing?.after_memo ?? null, improved_by: session.user.id, improved_at: existing?.improved_at ?? null, planned_due_date: improveDate.trim() },
        { onConflict: "report_id" }
      );
      if (error) throw error;
      Alert.alert("완료", "처리대기로 저장되었습니다.");
      resetImproveForm();
      await fetchReports();
    } catch (e: any) {
      Alert.alert("저장 실패", e?.message ?? String(e));
    } finally {
      setImproveBusy(false);
    }
  };

  const saveDone = async () => {
    if (!improveImageUri) return Alert.alert("처리완료", "개선 사진을 선택하세요.");
    const session = await requireSession();
    if (!session) return;
    setImproveBusy(true);
    try {
      const { buffer, contentType } = await uriToBuffer(improveImageUri);
      const ext = contentType === "image/png" ? "png" : "jpg";
      const path = `resolved/${session.user.id}/${Date.now()}.${ext}`;
      const { publicUrl } = await uploadImprovementToR2({ buffer, contentType, path, accessToken: session.access_token });
      const { error } = await supabase.from("hazard_report_resolutions").upsert(
        { report_id: previewReportId, after_path: path, after_public_url: publicUrl, after_memo: improveMemo.trim() || null, improved_by: session.user.id, improved_at: new Date().toISOString(), planned_due_date: null },
        { onConflict: "report_id" }
      );
      if (error) throw error;
      Alert.alert("완료", "개선사진이 등록되었습니다.");
      resetImproveForm();
      await fetchReports();
    } catch (e: any) {
      Alert.alert("업로드 실패", e?.message ?? String(e));
    } finally {
      setImproveBusy(false);
    }
  };

  const pickImproveImage = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return Alert.alert("권한 필요", "사진 접근 권한을 허용해주세요.");
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.9 });
    if (!picked.canceled && picked.assets?.[0]) setImproveImageUri(picked.assets[0].uri);
  };

  const takeImprovePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return Alert.alert("권한 필요", "카메라 권한을 허용해주세요.");
    const shot = await ImagePicker.launchCameraAsync({ quality: 0.9 });
    if (!shot.canceled && shot.assets?.[0]) setImproveImageUri(shot.assets[0].uri);
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
            const { data: rep, error: repErr } = await supabase.from("hazard_reports").select("id, photo_path").eq("id", reportId).single();
            if (repErr) throw repErr;
            const paths = new Set<string>();
            if (rep?.photo_path) paths.add(String(rep.photo_path));
            const { data: exPhotos, error: exErr } = await supabase.from("hazard_report_photos").select("photo_path").eq("report_id", reportId);
            if (!exErr && exPhotos?.length) for (const row of exPhotos as any[]) { const p = String(row?.photo_path ?? ""); if (p) paths.add(p); }
            const resolution = resolutionMap[reportId];
            if (resolution?.after_path) paths.add(String(resolution.after_path));
            const removeTargets = Array.from(paths).filter(Boolean);
            if (removeTargets.length > 0) { const { error: rmErr } = await supabase.storage.from("hazard-reports").remove(removeTargets); if (rmErr) throw rmErr; }
            const { error: delErr } = await supabase.from("hazard_reports").delete().eq("id", reportId);
            if (delErr) throw delErr;
            Alert.alert("완료", "삭제 완료");
            closePreview();
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

  const previewStatus = getHazardStatus(previewResolution);

  // ─── 목록 카드 ───────────────────────────────────────────────
  const renderItem = ({ item }: { item: ReportRow }) => {
    const photos = photoMap[item.id] ?? [];
    const totalCount = 1 + photos.length;
    const resolution = resolutionMap[item.id] ?? null;
    const status = getHazardStatus(resolution);

    return (
      <Pressable onPress={() => openPreview(item)} disabled={busy} style={({ pressed }) => [styles.card, pressed && { opacity: 0.75 }]}>
        <Image source={{ uri: item.photo_url }} style={styles.cardThumb} resizeMode="cover" fadeDuration={0} />
        <View style={styles.cardBody}>
          <View style={styles.cardTopRow}>
            <Text style={styles.cardDate}>{formatKST(item.created_at)}</Text>
            <View style={[styles.statusBadge, { backgroundColor: status.bg, borderColor: status.border }]}>
              <Ionicons name={status.icon as any} size={11} color={status.text} />
              <Text style={[styles.statusText, { color: status.text }]}>{status.label}</Text>
            </View>
          </View>
          <Text style={styles.cardComment} numberOfLines={2}>
            {item.comment || "(코멘트 없음)"}
          </Text>
          <View style={styles.cardFooter}>
            <Ionicons name="camera-outline" size={12} color={THEME.muted} />
            <Text style={styles.cardFooterText}>사진 {totalCount}장</Text>
            {status.key === "pending" && resolution?.planned_due_date && (
              <>
                <View style={styles.cardFooterDot} />
                <Text style={[styles.cardFooterText, { color: THEME.warn }]}>예정 {resolution.planned_due_date}</Text>
              </>
            )}
            {status.key === "done" && resolution?.improved_at && (
              <>
                <View style={styles.cardFooterDot} />
                <Text style={[styles.cardFooterText, { color: THEME.success }]}>개선 {formatKST(resolution.improved_at)}</Text>
              </>
            )}
          </View>
        </View>
        <Ionicons name="chevron-forward" size={16} color={THEME.muted} style={{ alignSelf: "center" }} />
      </Pressable>
    );
  };

  // ─── 필터 탭 ─────────────────────────────────────────────────
  const FilterTab = ({ fkey, label, count }: { fkey: StatusFilter; label: string; count?: number }) => {
    const active = filter === fkey;
    return (
      <Pressable onPress={() => setFilter(fkey)} style={[styles.filterTab, active && styles.filterTabActive]}>
        <Text style={[styles.filterTabText, active && styles.filterTabTextActive]}>{label}</Text>
        {typeof count === "number" && count > 0 && (
          <View style={[styles.filterBadge, active && styles.filterBadgeActive]}>
            <Text style={[styles.filterBadgeText, active && styles.filterBadgeTextActive]}>{count}</Text>
          </View>
        )}
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      {/* 헤더 */}
      <View style={[styles.header, { paddingTop: topPad }]}>
        <View style={styles.headerTop}>
          <View style={styles.headerIconWrap}>
            <MaterialCommunityIcons name="alert-circle-outline" size={20} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>위험요인 내역</Text>
            <Text style={styles.headerSub}>총 {reports.length}건 · 미처리 {statusCounts.open}건</Text>
          </View>
          <Pressable onPress={fetchReports} disabled={loading || busy} style={[styles.refreshBtn, (loading || busy) && { opacity: 0.5 }]}>
            {loading
              ? <ActivityIndicator size="small" color={THEME.orange} />
              : <Ionicons name="refresh" size={18} color={THEME.orange} />
            }
          </Pressable>
        </View>

        {/* 필터 탭 */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          <FilterTab fkey="all" label="전체" />
          <FilterTab fkey="open" label="미처리" count={statusCounts.open} />
          <FilterTab fkey="pending" label="처리대기" count={statusCounts.pending} />
          <FilterTab fkey="done" label="처리완료" count={statusCounts.done} />
        </ScrollView>
      </View>

      {/* 목록 */}
      <FlatList
        data={visibleReports}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        removeClippedSubviews
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        windowSize={5}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            {loading
              ? <ActivityIndicator color={THEME.orange} />
              : <>
                  <MaterialCommunityIcons name="clipboard-check-outline" size={40} color={THEME.muted} />
                  <Text style={styles.emptyText}>
                    {filter === "all" ? (isAdmin ? "제보 내역이 없습니다." : "내 제보 내역이 없습니다.") :
                     filter === "open" ? "미처리 제보가 없습니다." :
                     filter === "pending" ? "처리대기 제보가 없습니다." : "처리완료 제보가 없습니다."}
                  </Text>
                </>
            }
          </View>
        }
        renderItem={renderItem}
      />

      {/* ─── 상세 모달 ─────────────────────────────────────── */}
      <Modal visible={previewOpen} animationType="slide" onRequestClose={closePreview} presentationStyle="fullScreen">
        <SafeAreaView style={styles.safe}>
          {/* 모달 헤더 */}
          <View style={styles.detailHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.detailHeaderDate}>{formatKSTFull(previewCreatedAt)}</Text>
              <View style={[styles.statusBadge, { backgroundColor: previewStatus.bg, borderColor: previewStatus.border, alignSelf: "flex-start", marginTop: 4 }]}>
                <Ionicons name={previewStatus.icon as any} size={11} color={previewStatus.text} />
                <Text style={[styles.statusText, { color: previewStatus.text }]}>{previewStatus.label}</Text>
              </View>
            </View>
            <Pressable onPress={closePreview} style={styles.detailCloseBtn} hitSlop={8}>
              <Ionicons name="close" size={20} color={THEME.subtext} />
            </Pressable>
          </View>

          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
            <ScrollView
              ref={scrollViewRef}
              contentContainerStyle={styles.detailContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {/* 제보 사진 슬라이더 */}
              {previewPhotos.length > 0 && (
                <View style={styles.section}>
                  <View style={styles.sectionHeader}>
                    <Ionicons name="camera" size={14} color={THEME.orange} />
                    <Text style={styles.sectionTitle}>제보 사진</Text>
                    <Text style={styles.sectionCount}>{previewPhotos.length}장</Text>
                  </View>
                  <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} onScroll={(e) => setActivePhotoIdx(Math.round(e.nativeEvent.contentOffset.x / e.nativeEvent.layoutMeasurement.width))} scrollEventThrottle={16}>
                    {previewPhotos.map((item) => (
                      <PhotoSlide key={item.path} uri={item.url} />
                    ))}
                  </ScrollView>
                  {previewPhotos.length > 1 && (
                    <View style={styles.dotRow}>
                      {previewPhotos.map((_, i) => (
                        <View key={i} style={[styles.dot, i === activePhotoIdx && styles.dotActive]} />
                      ))}
                    </View>
                  )}
                </View>
              )}

              {/* 코멘트 */}
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Ionicons name="chatbubble-ellipses-outline" size={14} color={THEME.orange} />
                  <Text style={styles.sectionTitle}>제보 내용</Text>
                </View>
                <View style={styles.commentBox}>
                  <Text style={styles.commentText}>{previewComment || "(코멘트 없음)"}</Text>
                </View>
              </View>

              {/* 처리대기 정보 */}
              {previewStatus.key === "pending" && previewResolution?.planned_due_date && (
                <View style={styles.section}>
                  <View style={styles.sectionHeader}>
                    <Ionicons name="time-outline" size={14} color={THEME.warn} />
                    <Text style={[styles.sectionTitle, { color: THEME.warn }]}>처리 대기 중</Text>
                  </View>
                  <View style={[styles.infoCard, { borderColor: "#FDBA74", backgroundColor: THEME.warnSoft }]}>
                    <Text style={styles.infoCardLabel}>개선 예정일</Text>
                    <Text style={[styles.infoCardValue, { color: THEME.warn }]}>{previewResolution.planned_due_date}</Text>
                  </View>
                </View>
              )}

              {/* 개선완료 정보 */}
              {previewStatus.key === "done" && previewResolution?.after_public_url && (
                <View style={styles.section}>
                  <View style={styles.sectionHeader}>
                    <Ionicons name="checkmark-circle-outline" size={14} color={THEME.success} />
                    <Text style={[styles.sectionTitle, { color: THEME.success }]}>개선 완료</Text>
                  </View>
                  <View style={[styles.infoCard, { borderColor: "#A7F3D0", backgroundColor: THEME.successSoft, gap: 10 }]}>
                    <Image source={{ uri: previewResolution.after_public_url }} style={styles.resolvedPhoto} resizeMode="cover" fadeDuration={0} />
                    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <Text style={styles.infoCardLabel}>개선일시</Text>
                      <Text style={[styles.infoCardValue, { color: THEME.success }]}>{formatKSTFull(previewResolution.improved_at)}</Text>
                    </View>
                    {previewResolution.after_memo && (
                      <Text style={styles.commentText}>{previewResolution.after_memo}</Text>
                    )}
                  </View>
                </View>
              )}

              {/* 관리자 전용: 개선내역 등록 */}
              {isAdmin && (
                <View style={styles.section}>
                  <View style={styles.sectionHeader}>
                    <MaterialCommunityIcons name="wrench-outline" size={14} color={THEME.text} />
                    <Text style={styles.sectionTitle}>개선내역 등록</Text>
                    {improveMode !== "none" && (
                      <Pressable onPress={resetImproveForm} style={styles.cancelLink}>
                        <Text style={styles.cancelLinkText}>취소</Text>
                      </Pressable>
                    )}
                  </View>

                  {improveMode === "none" && (
                    <View style={styles.improveRow}>
                      <Pressable onPress={() => { setImproveMode("pending"); setImproveDate(""); }} style={[styles.improveBtn, { borderColor: "#FDBA74", backgroundColor: THEME.warnSoft }]}>
                        <Ionicons name="time-outline" size={16} color={THEME.warn} />
                        <Text style={[styles.improveBtnText, { color: THEME.warn }]}>처리대기 등록</Text>
                      </Pressable>
                      <Pressable onPress={() => { setImproveMode("done"); setImproveMemo(""); setImproveImageUri(null); }} style={[styles.improveBtn, { borderColor: "#A7F3D0", backgroundColor: THEME.successSoft }]}>
                        <Ionicons name="checkmark-circle-outline" size={16} color={THEME.success} />
                        <Text style={[styles.improveBtnText, { color: THEME.success }]}>처리완료 등록</Text>
                      </Pressable>
                    </View>
                  )}

                  {improveMode === "pending" && (
                    <View style={styles.improveForm}>
                      <Text style={styles.improveFormLabel}>개선예정일 선택</Text>
                      <Pressable onPress={() => setCalendarOpen(!calendarOpen)} style={styles.datePickerBtn}>
                        <Ionicons name="calendar-outline" size={16} color={THEME.subtext} />
                        <Text style={[styles.datePickerText, !improveDate && { color: THEME.muted }]}>
                          {improveDate || "날짜를 선택하세요"}
                        </Text>
                        <Ionicons name={calendarOpen ? "chevron-up" : "chevron-down"} size={14} color={THEME.muted} />
                      </Pressable>
                      {calendarOpen && (
                        <Calendar
                          onDayPress={(day) => { setImproveDate(day.dateString); setCalendarOpen(false); }}
                          markedDates={improveDate ? { [improveDate]: { selected: true, selectedColor: THEME.warn } } : undefined}
                          theme={{ todayTextColor: THEME.warn, arrowColor: THEME.warn }}
                        />
                      )}
                      <Pressable onPress={savePending} disabled={improveBusy} style={[styles.submitBtn, { backgroundColor: "#F59E0B" }, improveBusy && { opacity: 0.6 }]}>
                        {improveBusy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.submitBtnText}>처리대기 저장</Text>}
                      </Pressable>
                    </View>
                  )}

                  {improveMode === "done" && (
                    <View style={styles.improveForm}>
                      {improveImageUri ? (
                        <View>
                          <Image source={{ uri: improveImageUri }} style={styles.improvePreviewImg} resizeMode="cover" />
                          <Pressable onPress={() => setImproveImageUri(null)} style={styles.removePhotoBtn}>
                            <Ionicons name="trash-outline" size={14} color={THEME.danger} />
                            <Text style={styles.removePhotoBtnText}>사진 제거</Text>
                          </Pressable>
                        </View>
                      ) : (
                        <View style={styles.improvePhotoRow}>
                          <Pressable onPress={takeImprovePhoto} style={styles.improvePhotoBtn}>
                            <Ionicons name="camera-outline" size={18} color={THEME.text} />
                            <Text style={styles.improvePhotoBtnText}>카메라</Text>
                          </Pressable>
                          <Pressable onPress={pickImproveImage} style={styles.improvePhotoBtn}>
                            <Ionicons name="images-outline" size={18} color={THEME.text} />
                            <Text style={styles.improvePhotoBtnText}>갤러리</Text>
                          </Pressable>
                        </View>
                      )}
                      <TextInput
                        value={improveMemo}
                        onChangeText={setImproveMemo}
                        placeholder="개선내용 입력 (예: 정리 완료, 안전표지 부착)"
                        placeholderTextColor={THEME.muted}
                        style={styles.improveTextarea}
                        multiline
                        onFocus={() => setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 200)}
                      />
                      <Pressable onPress={saveDone} disabled={improveBusy} style={[styles.submitBtn, { backgroundColor: THEME.success }, improveBusy && { opacity: 0.6 }]}>
                        {improveBusy
                          ? <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}><ActivityIndicator color="#fff" size="small" /><Text style={styles.submitBtnText}>업로드 중...</Text></View>
                          : <Text style={styles.submitBtnText}>처리완료 등록</Text>
                        }
                      </Pressable>
                    </View>
                  )}
                </View>
              )}

              {/* 삭제 버튼 */}
              {isAdmin && (
                <Pressable onPress={() => deleteReport(previewReportId)} disabled={busy || !previewReportId} style={[styles.deleteBtn, (busy || !previewReportId) && { opacity: 0.4 }]}>
                  <Ionicons name="trash-outline" size={16} color={THEME.danger} />
                  <Text style={styles.deleteBtnText}>{busy ? "삭제 중..." : "제보 삭제 (사진 포함)"}</Text>
                </Pressable>
              )}
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: THEME.bg },

  // 헤더
  header: {
    backgroundColor: THEME.surface,
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
    paddingHorizontal: 16,
    paddingBottom: 0,
  },
  headerTop: { flexDirection: "row", alignItems: "center", gap: 12, paddingBottom: 12 },
  headerIconWrap: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: THEME.orange,
    alignItems: "center", justifyContent: "center",
  },
  headerTitle: { fontSize: 17, fontWeight: "800", color: THEME.text, letterSpacing: -0.3 },
  headerSub: { fontSize: 12, color: THEME.subtext, marginTop: 1 },
  refreshBtn: {
    width: 38, height: 38, borderRadius: 10,
    backgroundColor: THEME.orangeSoft,
    borderWidth: 1, borderColor: THEME.orangeBorder,
    alignItems: "center", justifyContent: "center",
  },

  // 필터 탭
  filterRow: { flexDirection: "row", gap: 6, paddingBottom: 12, paddingTop: 2 },
  filterTab: {
    flexDirection: "row", alignItems: "center", gap: 5,
    height: 34, paddingHorizontal: 14, borderRadius: 10,
    borderWidth: 1, borderColor: THEME.border,
    backgroundColor: THEME.surface,
  },
  filterTabActive: { backgroundColor: THEME.text, borderColor: THEME.text },
  filterTabText: { fontWeight: "700", fontSize: 13, color: THEME.subtext },
  filterTabTextActive: { color: "#fff" },
  filterBadge: {
    minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: THEME.border,
    alignItems: "center", justifyContent: "center",
    paddingHorizontal: 4,
  },
  filterBadgeActive: { backgroundColor: "rgba(255,255,255,0.25)" },
  filterBadgeText: { fontSize: 10, fontWeight: "800", color: THEME.subtext },
  filterBadgeTextActive: { color: "#fff" },

  // 목록
  listContent: { padding: 14, gap: 0, flexGrow: 1 },
  separator: { height: 8 },
  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 60, gap: 10 },
  emptyText: { color: THEME.muted, fontSize: 14, fontWeight: "600" },

  // 카드
  card: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: THEME.surface,
    borderRadius: 16, padding: 12,
    borderWidth: 1, borderColor: THEME.border,
    shadowColor: "rgba(0,0,0,0.06)",
    shadowOpacity: 1, shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardThumb: { width: 64, height: 64, borderRadius: 12, backgroundColor: "#F3F4F6", flexShrink: 0 },
  cardBody: { flex: 1, gap: 4 },
  cardTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cardDate: { fontSize: 12, fontWeight: "700", color: THEME.subtext },
  cardComment: { fontSize: 13, color: THEME.text, lineHeight: 18 },
  cardFooter: { flexDirection: "row", alignItems: "center", gap: 4 },
  cardFooterText: { fontSize: 11, color: THEME.muted, fontWeight: "600" },
  cardFooterDot: { width: 2, height: 2, borderRadius: 1, backgroundColor: THEME.muted },

  // 상태 뱃지
  statusBadge: {
    flexDirection: "row", alignItems: "center", gap: 3,
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 8, borderWidth: 1,
  },
  statusText: { fontSize: 11, fontWeight: "800" },

  // 상세 헤더
  detailHeader: {
    flexDirection: "row", alignItems: "flex-start",
    paddingHorizontal: 16, paddingVertical: 14,
    backgroundColor: THEME.surface,
    borderBottomWidth: 1, borderBottomColor: THEME.border,
  },
  detailHeaderDate: { fontSize: 15, fontWeight: "800", color: THEME.text, letterSpacing: -0.3 },
  detailCloseBtn: {
    width: 32, height: 32, borderRadius: 10,
    backgroundColor: THEME.soft, borderWidth: 1, borderColor: THEME.border,
    alignItems: "center", justifyContent: "center",
  },

  // 상세 내용
  detailContent: { padding: 16, gap: 16, paddingBottom: 32 },
  section: { gap: 10 },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  sectionTitle: { fontSize: 14, fontWeight: "800", color: THEME.text, flex: 1 },
  sectionCount: { fontSize: 12, color: THEME.muted, fontWeight: "600" },

  // 사진 슬라이더
  photoSlide: { width: SCREEN_W - 32 },
  dotRow: { flexDirection: "row", justifyContent: "center", gap: 5, marginTop: 8 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: THEME.border },
  dotActive: { backgroundColor: THEME.orange, width: 18 },

  // 코멘트
  commentBox: {
    backgroundColor: THEME.soft, borderRadius: 14,
    padding: 14, borderWidth: 1, borderColor: THEME.border,
  },
  commentText: { fontSize: 14, color: THEME.text, lineHeight: 20 },

  // 정보 카드
  infoCard: { borderRadius: 14, padding: 14, borderWidth: 1, gap: 6 },
  infoCardLabel: { fontSize: 12, color: THEME.subtext, fontWeight: "600" },
  infoCardValue: { fontSize: 15, fontWeight: "800" },
  resolvedPhoto: { width: "100%", height: 200, borderRadius: 12, backgroundColor: "#F3F4F6" },

  // 개선 등록
  cancelLink: { paddingHorizontal: 8 },
  cancelLinkText: { fontSize: 13, color: THEME.muted, fontWeight: "700" },
  improveRow: { flexDirection: "row", gap: 10 },
  improveBtn: {
    flex: 1, height: 46, borderRadius: 12,
    borderWidth: 1, flexDirection: "row",
    alignItems: "center", justifyContent: "center", gap: 6,
  },
  improveBtnText: { fontWeight: "800", fontSize: 13 },
  improveForm: { gap: 12 },
  improveFormLabel: { fontSize: 13, fontWeight: "700", color: THEME.subtext },
  datePickerBtn: {
    height: 46, borderWidth: 1, borderColor: THEME.border,
    borderRadius: 12, paddingHorizontal: 14,
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: THEME.soft,
  },
  datePickerText: { flex: 1, fontSize: 14, fontWeight: "700", color: THEME.text },
  improvePhotoRow: { flexDirection: "row", gap: 10 },
  improvePhotoBtn: {
    flex: 1, height: 46, borderRadius: 12,
    borderWidth: 1, borderColor: THEME.border,
    backgroundColor: THEME.soft,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7,
  },
  improvePhotoBtnText: { fontWeight: "700", fontSize: 14, color: THEME.text },
  improvePreviewImg: { width: "100%", height: 180, borderRadius: 14, backgroundColor: "#F3F4F6" },
  removePhotoBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5,
    marginTop: 6, paddingVertical: 4,
  },
  removePhotoBtnText: { fontSize: 12, fontWeight: "800", color: THEME.danger },
  improveTextarea: {
    minHeight: 88, borderWidth: 1, borderColor: THEME.border,
    borderRadius: 14, paddingHorizontal: 13, paddingVertical: 11,
    backgroundColor: THEME.soft, color: THEME.text,
    textAlignVertical: "top", lineHeight: 20, fontSize: 14,
  },
  submitBtn: {
    height: 50, borderRadius: 14,
    alignItems: "center", justifyContent: "center",
    shadowOpacity: 0.2, shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 }, elevation: 3,
  },
  submitBtnText: { fontWeight: "800", fontSize: 15, color: "#fff" },

  // 삭제
  deleteBtn: {
    height: 46, borderRadius: 14,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7,
    borderWidth: 1, borderColor: "#FECACA",
    backgroundColor: THEME.dangerSoft,
  },
  deleteBtnText: { fontWeight: "800", color: THEME.danger, fontSize: 14 },
});
