import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
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
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Calendar } from "react-native-calendars";
import { supabase } from "../../src/lib/supabase";
import { getTodayTempWorkPart } from "../../src/lib/tempWorkPart";

// ✅ 반드시 legacy로! (expo-file-system import 금지)
import * as FileSystem from "expo-file-system/legacy";
import * as MediaLibrary from "expo-media-library";

// ✅ 안전영역/탭바 겹침 방지
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const THEME = {
  bg: "#F7F7F8",
  surface: "#FFFFFF",
  text: "#111827",
  subtext: "#6B7280",
  border: "#E5E7EB",
  muted: "#9CA3AF",
  soft: "#F9FAFB",
  shadow: "rgba(17,24,39,0.08)",
  primary: "#111827",
  blue: "#2563EB",
  blueSoft: "#EFF6FF",
  danger: "#EF4444",
  dangerSoft: "#FEF2F2",
  success: "#16A34A",
  successSoft: "#ECFDF5",
  amber: "#F59E0B",
  purple: "#7C3AED",
};

type DriverCategory = "bottle" | "tobacco" | "miochul" | "wash";

function categoryLabel(c: DriverCategory) {
  if (c === "bottle") return "공병";
  if (c === "tobacco") return "담배";
  if (c === "miochul") return "미오출";
  return "세차";
}
function categoryColor(c: DriverCategory) {
  if (c === "bottle") return THEME.blue;
  if (c === "tobacco") return THEME.amber;
  if (c === "miochul") return THEME.purple;
  return "#0F766E";
}

function getDriverCategoryPath(category: DriverCategory, washStage: 1 | 2) {
  if (category === "wash") return `wash${washStage}`;
  return category;
}

function getDriverCategoryDisplay(category: DriverCategory, washStage: 1 | 2) {
  if (category === "wash") return `세차 ${washStage}차`;
  return categoryLabel(category);
}

type StoreMapRow = {
  store_code: string;
  store_name: string;
  car_no: number | null;
  seq_no: number | null;
};

type PhotoRow = {
  id: string;
  user_id: string;
  created_at: string;
  status: "public" | "hidden";
  original_path: string;
  original_url: string;
  store_code: string;
  work_part?: string | null;
  store_name?: string | null;
  bucket?: string | null;

  // ✅ 기사 분류/미오출 정보(있을 수도 / 없을 수도)
  category?: string | null;
  delivery_planned_date?: string | null;
  extra_note?: string | null;
};

type SelectedStore = {
  store_code: string;
  store_name: string;
  car_no: number | null;
  seq_no: number | null;
} | null;

function kstNowDateString(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

function formatKST(ts: string): string {
  const d = new Date(ts);
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const yyyy = kst.getUTCFullYear();
  const mm = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(kst.getUTCDate()).padStart(2, "0");
  const HH = String(kst.getUTCHours()).padStart(2, "0");
  const MI = String(kst.getUTCMinutes()).padStart(2, "0");
  const SS = String(kst.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${HH}:${MI}:${SS}`;
}

function isValidDateYYYYMMDD(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function kstRangeUTC(dateYYYYMMDD: string) {
  const start = new Date(`${dateYYYYMMDD}T00:00:00+09:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { startUTC: start.toISOString(), endUTC: end.toISOString() };
}

function sortStores(a: StoreMapRow, b: StoreMapRow) {
  const BIG = 999999;
  const carA = a.car_no ?? BIG;
  const carB = b.car_no ?? BIG;
  if (carA !== carB) return carA - carB;

  const seqA = a.seq_no ?? BIG;
  const seqB = b.seq_no ?? BIG;
  if (seqA !== seqB) return seqA - seqB;

  return String(a.store_code ?? "").localeCompare(String(b.store_code ?? ""));
}

function ymLabel(yyyyMMdd: string) {
  const [y, m] = yyyyMMdd.split("-").map((x) => Number(x));
  if (!y || !m) return "";
  return `${y}년 ${m}월`;
}

function firstOfMonth(yyyyMMdd: string) {
  const [y, m] = yyyyMMdd.split("-").map((x) => Number(x));
  const mm = String(m || 1).padStart(2, "0");
  return `${y}-${mm}-01`;
}

function addMonthsFirstDay(yyyyMMdd: string, delta: number) {
  const [y0, m0] = yyyyMMdd.split("-").map((x) => Number(x));
  const dt = new Date(Date.UTC(y0, (m0 || 1) - 1, 1));
  dt.setUTCMonth(dt.getUTCMonth() + delta);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

function escapeLike(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function safeFileNameFromUrl(url: string) {
  try {
    const u = new URL(url);
    const last = (u.pathname.split("/").pop() || "photo").trim();
    const clean = last.replace(/[^\w.\-]+/g, "_");
    if (clean.includes(".")) return clean;
    return `${clean}.jpg`;
  } catch {
    return `photo_${Date.now()}.jpg`;
  }
}

function buildStoreTitle(meta: StoreMapRow | SelectedStore | undefined, fallbackCode: string, fallbackName = "") {
  const car = meta?.car_no ?? "-";
  const seq = meta?.seq_no ?? "-";
  const code = (meta as any)?.store_code ?? fallbackCode;
  const name = meta?.store_name ?? fallbackName;
  return `${car} - ${seq}  ${code} ${name}`.trim();
}

export default function PhotoListScreen() {
  const router = useRouter();

  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();

  const topPad = Math.min(Math.max(insets.top, 6), 18) + 6;
  const bottomPad = tabBarHeight + Math.max(insets.bottom, 16) + 22;

  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);

  const [isAdmin, setIsAdmin] = useState(false);
  const [adminSeeAll, setAdminSeeAll] = useState(false);

  const [myWorkPart, setMyWorkPart] = useState<string>("");

  // ✅ 기사면 강제로 “내것만” + 기사 카테고리 탭으로
  const [isDriver, setIsDriver] = useState(false);
  const [driverCategory, setDriverCategory] = useState<DriverCategory>("bottle");
  const [washStage, setWashStage] = useState<1 | 2>(1);

  // 기존 토글 (기사일 때는 숨김/무시)
  const [onlyMine, setOnlyMine] = useState(false);

  const [dateStr, setDateStr] = useState(kstNowDateString());

  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(firstOfMonth(dateStr));

  // ✅ 검색 입력 / 검수점포 선택
  // 기사 모드에서는 검색 기능을 안 쓰므로 UI에서 숨김(데이터는 유지)
  const [searchText, setSearchText] = useState("");
  const [selectedStore, setSelectedStore] = useState<SelectedStore>(null);

  const [photos, setPhotos] = useState<PhotoRow[]>([]);
  const [storeMeta, setStoreMeta] = useState<Record<string, StoreMapRow>>({});

  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewTitle, setPreviewTitle] = useState("");
  const [previewItems, setPreviewItems] = useState<PhotoRow[]>([]);
  const driverPathCategory = getDriverCategoryPath(driverCategory, washStage);
  const driverDisplayCategory = getDriverCategoryDisplay(driverCategory, washStage);

  const [inspectModalOpen, setInspectModalOpen] = useState(false);
  const [inspectQuery, setInspectQuery] = useState("");
  const [inspectStores, setInspectStores] = useState<StoreMapRow[]>([]);
  const [inspectLoading, setInspectLoading] = useState(false);

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

  const loadMyProfileFlags = async () => {
    const session = await requireSession();
    if (!session) return;

    const { data, error } = await supabase
      .from("profiles")
      .select("is_admin, work_part")
      .eq("id", session.user.id)
      .maybeSingle();

    if (error) {
      setIsAdmin(false);
      setAdminSeeAll(false);
      setMyWorkPart("");
      setIsDriver(false);
      return;
    }

    const wp = String(data?.work_part ?? "").trim();
    const driver = wp.includes("기사");
    let displayWp = wp;

    if (wp === "임시직") {
      const todayWp = await getTodayTempWorkPart(session.user.id);
      if (!todayWp) {
        Alert.alert("출근 필요", "임시직은 출근 확인에서 오늘 근무파트를 선택한 뒤 조회를 사용할 수 있습니다.");
        router.replace("/(tabs)");
        return;
      }
      displayWp = todayWp;
    }

    const adminFlag = !!data?.is_admin || wp === "관리자";
    setIsAdmin(adminFlag);
    setAdminSeeAll(false);
    setMyWorkPart(displayWp);
    setIsDriver(driver);

    // ✅ 기사면 이 조회 화면에서는 “내것만 + 기사 3종만” 컨셉 강제
    if (driver) {
      setOnlyMine(true);
      setSelectedStore(null);
      setSearchText("");
    } else {
      setOnlyMine(false);
    }
  };

  useEffect(() => {
    if (mounted.current) return;
    mounted.current = true;
    (async () => {
      await loadMyProfileFlags();
    })();
  }, []);

  const getImageUrl = (p: PhotoRow) => p.original_url;

  const openInspectModal = async () => {
    const session = await requireSession();
    if (!session) return;

    Keyboard.dismiss();
    setInspectQuery("");
    setInspectModalOpen(true);
    setInspectLoading(true);

    try {
      const { data, error } = await supabase
        .from("store_map")
        .select("store_code, store_name, car_no, seq_no")
        .eq("is_inspection", true)
        .limit(5000);

      if (error) throw error;

      const rows = ((data ?? []) as StoreMapRow[]).slice().sort(sortStores);
      setInspectStores(rows);
    } catch (e: any) {
      Alert.alert("점포 목록 오류", e?.message ?? String(e));
      setInspectStores([]);
    } finally {
      setInspectLoading(false);
    }
  };

  const filteredInspectStores = useMemo(() => {
    const q = inspectQuery.trim().toLowerCase();
    if (!q) return inspectStores;
    return inspectStores.filter((s) => {
      const code = (s.store_code ?? "").toLowerCase();
      const name = (s.store_name ?? "").toLowerCase();
      const car = String(s.car_no ?? "");
      const seq = String(s.seq_no ?? "");
      return code.includes(q) || name.includes(q) || car.includes(q) || seq.includes(q);
    });
  }, [inspectStores, inspectQuery]);

  const fetchList = async (overrideDate?: string) => {
    const session = await requireSession();
    if (!session) return;

    const d = (overrideDate ?? dateStr).trim();
    if (!isValidDateYYYYMMDD(d)) {
      Alert.alert("날짜 오류", "날짜는 YYYY-MM-DD 형식이어야 합니다.");
      return;
    }

    setLoading(true);
    try {
      const { startUTC, endUTC } = kstRangeUTC(d);

      if (isDriver) {
        const { data, error } = await supabase
          .from("delivery_photos")
          .select("id, created_at, store_code, store_name, memo, bucket, path, public_url, created_by")
          .eq("created_by", session.user.id)
          .gte("created_at", startUTC)
          .lt("created_at", endUTC)
          .ilike("path", `${driverPathCategory}/%`)
          .order("created_at", { ascending: false });

        if (error) throw error;

        const rows: PhotoRow[] = ((data ?? []) as any[]).map((r) => {
          const memo = String(r?.memo ?? "");
          const plannedDateMatch = memo.match(/납품예정:([0-9]{4}-[0-9]{2}-[0-9]{2})/);
          const detailMatch = memo.match(/상세:(.*)$/);
          return {
            id: String(r.id),
            user_id: String(r.created_by ?? session.user.id),
            created_at: String(r.created_at),
            status: "public",
            original_path: String(r.path ?? ""),
            original_url: String(r.public_url ?? ""),
            store_code: String(r.store_code ?? ""),
            store_name: String(r.store_name ?? ""),
            bucket: String(r.bucket ?? "delivery_photos"),
            category: driverPathCategory,
            delivery_planned_date: plannedDateMatch?.[1] ?? null,
            extra_note: detailMatch?.[1]?.trim() ?? null,
          };
        });

        setPhotos(rows);

        const codes = Array.from(new Set(rows.map((p) => p.store_code))).filter(Boolean);
        if (codes.length === 0) {
          setStoreMeta({});
        } else {
          const { data: meta, error: metaErr } = await supabase
            .from("store_map")
            .select("store_code, store_name, car_no, seq_no")
            .in("store_code", codes);

          if (!metaErr) {
            const map: Record<string, StoreMapRow> = {};
            for (const r of (meta ?? []) as StoreMapRow[]) map[r.store_code] = r;
            setStoreMeta(map);
          } else {
            setStoreMeta({});
          }
        }
      } else {
        let q = supabase
          .from("photos")
          .select(
            "id, user_id, created_at, status, original_path, original_url, store_code, work_part, category, delivery_planned_date, extra_note"
          )
          .gte("created_at", startUTC)
          .lt("created_at", endUTC)
          .order("created_at", { ascending: false });

        // ✅ 기존: 1) 검수점포 선택이 있으면 store_code 필터
        if (selectedStore?.store_code) {
          q = q.eq("store_code", selectedStore.store_code);
        } else {
          // ✅ 2) 없으면 검색 텍스트로 매칭(코드/명)
          const kwRaw = searchText.trim();
          if (kwRaw) {
            const kw = escapeLike(kwRaw);

            const { data: hits, error: hitErr } = await supabase
              .from("store_map")
              .select("store_code")
              .or(`store_code.ilike.%${kw}%,store_name.ilike.%${kw}%`)
              .limit(300);

            if (hitErr) {
              q = q.eq("store_code", kwRaw);
            } else {
              const codes = Array.from(
                new Set(((hits ?? []) as any[]).map((r) => String(r.store_code ?? "").trim()).filter(Boolean))
              );

              if (codes.length === 0) q = q.eq("store_code", "__no_match__");
              else if (codes.length === 1) q = q.eq("store_code", codes[0]);
              else q = q.in("store_code", codes);
            }
          }
        }

        // ✅ 권한 필터(기존)
        if (isAdmin && adminSeeAll) {
          // 전체
        } else {
          if (onlyMine) q = q.eq("user_id", session.user.id);
          else {
            const wp = (myWorkPart ?? "").trim();
            if (wp) q = q.eq("work_part", wp);
            else q = q.eq("user_id", session.user.id);
          }
        }

        const { data, error } = await q;
        if (error) throw error;

        const rows = (data ?? []) as PhotoRow[];
        setPhotos(rows);

        const codes = Array.from(new Set(rows.map((p) => p.store_code))).filter(Boolean);
        if (codes.length === 0) {
          setStoreMeta({});
        } else {
          const { data: meta, error: metaErr } = await supabase
            .from("store_map")
            .select("store_code, store_name, car_no, seq_no")
            .in("store_code", codes);

          if (!metaErr) {
            const map: Record<string, StoreMapRow> = {};
            for (const r of (meta ?? []) as StoreMapRow[]) map[r.store_code] = r;
            setStoreMeta(map);
          } else {
            setStoreMeta({});
          }
        }
      }

      setSelectedIds(new Set());
      setSelectMode(false);
    } catch (e: any) {
      Alert.alert("조회 오류", e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  // ✅ 기사 모드: 탭 바꾸면 즉시 재조회
  useEffect(() => {
    if (!isDriver) return;
    (async () => {
      await fetchList();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverPathCategory, isDriver]);

  const groupedByStore = useMemo(() => {
    const groups: Record<string, PhotoRow[]> = {};
    for (const p of photos) {
      if (!groups[p.store_code]) groups[p.store_code] = [];
      groups[p.store_code].push(p);
    }
    const entries = Object.entries(groups).map(([code, items]) => {
      items.sort((a, b) => (a.created_at > b.created_at ? -1 : 1));
      return { store_code: code, items };
    });
    entries.sort((a, b) => (a.items[0]?.created_at > b.items[0]?.created_at ? -1 : 1));
    return entries;
  }, [photos]);

  const enterOrExitSelectMode = () => {
    setSelectMode((v) => {
      const next = !v;
      if (!next) setSelectedIds(new Set());
      return next;
    });
  };

  const deletePhotosByIds = async (ids: string[]) => {
    const session = await requireSession();
    if (!session) return false;
    if (ids.length === 0) return true;

    setBusy(true);
    try {
      if (isDriver) {
        const { data, error } = await supabase.from("delivery_photos").select("id, path, created_by").in("id", ids);
        if (error) throw error;

        const deletableRows = ((data ?? []) as any[]).filter((row) => String(row?.created_by ?? "") === session.user.id);
        const deletableIds = deletableRows.map((row) => String(row.id));
        const paths = deletableRows
          .map((row) => row.path)
          .filter((x: any) => typeof x === "string" && x.length > 0 && !String(x).startsWith("meta://"));

        if (paths.length > 0) {
          const { error: rmErr } = await supabase.storage.from("delivery_photos").remove(paths);
          if (rmErr) throw rmErr;
        }

        if (deletableIds.length > 0) {
          const { error: delErr } = await supabase.from("delivery_photos").delete().in("id", deletableIds);
          if (delErr) throw delErr;
        }
      } else {
        const { data, error } = await supabase.from("photos").select("id, original_path").in("id", ids);
        if (error) throw error;

        const paths = (data ?? [])
          .map((r: any) => r.original_path)
          .filter((x: any) => typeof x === "string" && x.length > 0);

        if (paths.length > 0) {
          const { error: rmErr } = await supabase.storage.from("photos").remove(paths);
          if (rmErr) throw rmErr;
        }

        const { error: delErr } = await supabase.from("photos").delete().in("id", ids);
        if (delErr) throw delErr;
      }

      return true;
    } catch (e: any) {
      Alert.alert("삭제 실패", e?.message ?? String(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const deleteSelected = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    Alert.alert("삭제 확인", `선택된 ${ids.length}개를 완전삭제할까요?\n(DB + Storage에서 삭제)`, [
      { text: "취소", style: "cancel" },
      {
        text: "삭제",
        style: "destructive",
        onPress: async () => {
          const ok = await deletePhotosByIds(ids);
          if (!ok) return;
          Alert.alert("완료", "삭제 완료");
          setSelectedIds(new Set());
          setSelectMode(false);
          await fetchList();
        },
      },
    ]);
  };

  const openPreviewForStore = (store_code: string) => {
    const grp = groupedByStore.find((g) => g.store_code === store_code);
    if (!grp) return;

    const meta = storeMeta[store_code];
    const title = buildStoreTitle(meta, store_code, grp.items[0]?.store_name ?? "");

    setPreviewTitle(title);
    setPreviewItems(grp.items);
    setPreviewOpen(true);
  };

  const openCalendar = () => {
    Keyboard.dismiss();
    setCalendarMonth(firstOfMonth(dateStr));
    setCalendarOpen(true);
  };

  const pickDateAndFetch = async (picked: string) => {
    setDateStr(picked);
    setCalendarMonth(firstOfMonth(picked));
    setCalendarOpen(false);
    await fetchList(picked);
  };

  // ✅ 갤러리 저장 (legacy + MediaLibrary)
  // ✅ "앨범 생성" 제거: createAlbumAsync 호출 없음
  const saveToGalleryOne = async (url: string) => {
    try {
      setBusy(true);

      const perm = await MediaLibrary.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("권한 필요", "갤러리에 저장하려면 사진(미디어) 권한을 허용해주세요.");
        return;
      }

      const filename = safeFileNameFromUrl(url);
      const baseDir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
      if (!baseDir) throw new Error("저장 경로를 찾을 수 없습니다.");

      const localUri = `${baseDir}${filename}`;

      const dl = await FileSystem.downloadAsync(url, localUri);
      if (!dl?.uri) throw new Error("다운로드 실패");

      await MediaLibrary.createAssetAsync(dl.uri);

      Alert.alert("저장 완료", "갤러리에 저장했습니다.");
    } catch (e: any) {
      Alert.alert("저장 실패", e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const onDeleteOne = (p: PhotoRow) => {
    Alert.alert("삭제", "이 사진을 삭제할까요?\n(DB + Storage에서 삭제)", [
      { text: "취소", style: "cancel" },
      {
        text: "삭제",
        style: "destructive",
        onPress: async () => {
          const ok = await deletePhotosByIds([p.id]);
          if (!ok) return;

          setPreviewItems((prev) => prev.filter((x) => x.id !== p.id));
          setPhotos((prev) => prev.filter((x) => x.id !== p.id));
        },
      },
    ]);
  };

  const filterBadge = useMemo(() => {
    // ✅ 기사 모드 badge는 간단하게
    if (isDriver) {
      return `📅 ${dateStr} · 👤 내 업로드 · 🧾 ${driverDisplayCategory}`;
    }

    const parts: string[] = [];
    parts.push(`📅 ${dateStr}`);
    if (selectedStore?.store_code) parts.push(`🏪 ${selectedStore.store_code}`);
    else if (searchText.trim()) parts.push(`🔎 ${searchText.trim()}`);
    if (isAdmin && adminSeeAll) parts.push("🛡️ 전체");
    else if (onlyMine) parts.push("👤 내것만");
    else if (myWorkPart) parts.push(`👥 ${myWorkPart}`);
    return parts.join(" · ");
  }, [dateStr, selectedStore, searchText, isAdmin, adminSeeAll, onlyMine, myWorkPart, isDriver, driverDisplayCategory]);

  return (
    <SafeAreaView style={styles.safe}>
      {/* 헤더 */}
      <View style={[styles.headerWrap, { paddingTop: topPad }]}>
        <View style={styles.headerTopRow}>
          <Text style={styles.headerTitleLeft}>{isDriver ? "기사 사진 조회" : "사진 조회"}</Text>
          <View style={{ flex: 1 }} />
          <Pressable
            onPress={() => fetchList()}
            disabled={loading || busy}
            style={[styles.headerIconBtn, (loading || busy) && styles.dim]}
            hitSlop={8}
          >
            <Ionicons name="refresh" size={18} color={THEME.text} />
          </Pressable>
        </View>

      </View>

      {/* 컨트롤 */}
      <View style={{ paddingHorizontal: 16, gap: 10, paddingBottom: 10 }}>
        {/* ✅ 기사 모드: 카테고리 탭만 보여줌 */}
        {isDriver ? (
          <View style={styles.card}>
            <Text style={styles.label}>기사 분류</Text>
            <View style={{ flexDirection: "row", gap: 10 }}>
              {(["bottle", "tobacco", "miochul", "wash"] as DriverCategory[]).map((c) => {
                const on = driverCategory === c;
                return (
                  <Pressable
                    key={c}
                    onPress={() => setDriverCategory(c)}
                    style={[
                      styles.catPill,
                      {
                        borderColor: on ? categoryColor(c) : THEME.border,
                        backgroundColor: on ? THEME.soft : THEME.surface,
                      },
                    ]}
                  >
                    <Text style={[styles.catPillText, { color: on ? categoryColor(c) : THEME.text }]}>
                      {categoryLabel(c)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {driverCategory === "wash" ? (
              <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
                {[1, 2].map((stage) => {
                  const on = washStage === stage;
                  return (
                    <Pressable
                      key={stage}
                      onPress={() => setWashStage(stage as 1 | 2)}
                      style={[
                        styles.catPill,
                        {
                          borderColor: on ? categoryColor("wash") : THEME.border,
                          backgroundColor: on ? THEME.soft : THEME.surface,
                        },
                      ]}
                    >
                      <Text style={[styles.catPillText, { color: on ? categoryColor("wash") : THEME.text }]}>{`${stage}차`}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}

            <View style={{ height: 10 }} />

            <Text style={styles.label}>날짜</Text>
            <Pressable
              onPress={openCalendar}
              disabled={loading || busy}
              style={[styles.field48, (loading || busy) && styles.dim]}
            >
              <View style={styles.fieldRow}>
                <Ionicons name="calendar-outline" size={18} color={THEME.subtext} />
                <Text style={styles.fieldText}>{dateStr}</Text>
                <View style={{ flex: 1 }} />
                <Ionicons name="chevron-down" size={16} color={THEME.muted} />
              </View>
            </Pressable>

            <TouchableOpacity
              onPress={() => fetchList()}
              disabled={loading || busy}
              style={[styles.btnWide, styles.btnPrimary, (loading || busy) && styles.dim, { marginTop: 10 }]}
            >
              <View style={styles.btnInner}>
                <Ionicons name="search-outline" size={18} color="#fff" />
                <Text style={styles.btnTextWhite}>{loading ? "조회중" : "조회"}</Text>
              </View>
            </TouchableOpacity>

            {loading && <ActivityIndicator style={{ marginTop: 10 }} />}
          </View>
        ) : (
          <>
            {/* 토글 2개 한줄 */}
            <View style={{ flexDirection: "row", gap: 10 }}>
              {isAdmin ? (
                <View style={[styles.miniToggleCard, { flex: 1 }]}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Ionicons name="shield-checkmark-outline" size={16} color={THEME.text} />
                    <Text style={styles.miniToggleTitle} numberOfLines={1}>
                      관리자 전체
                    </Text>
                  </View>
                  <Switch value={adminSeeAll} onValueChange={setAdminSeeAll} />
                </View>
              ) : (
                <View style={{ flex: 1 }} />
              )}

              <View style={[styles.miniToggleCard, { flex: 1, opacity: isAdmin && adminSeeAll ? 0.5 : 1 }]}>
                <View style={{ gap: 2, flex: 1, paddingRight: 8 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <MaterialCommunityIcons name="account-multiple-outline" size={16} color={THEME.text} />
                    <Text style={styles.miniToggleTitle} numberOfLines={1}>
                      {onlyMine ? "내것만" : "작업파트"}
                    </Text>
                  </View>
                  <Text style={styles.miniToggleSub} numberOfLines={1}>
                    {myWorkPart ? `파트: ${myWorkPart}` : "파트 미설정"}
                  </Text>
                </View>
                <Switch value={onlyMine} onValueChange={setOnlyMine} disabled={isAdmin && adminSeeAll} />
              </View>
            </View>

            {/* 필터 카드 */}
            <View style={styles.card}>
              <View style={{ flexDirection: "row", gap: 10 }}>
                {/* 날짜 */}
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>날짜</Text>
                  <Pressable
                    onPress={openCalendar}
                    disabled={loading || busy}
                    style={[styles.field48, (loading || busy) && styles.dim]}
                  >
                    <View style={styles.fieldRow}>
                      <Ionicons name="calendar-outline" size={18} color={THEME.subtext} />
                      <Text style={styles.fieldText}>{dateStr}</Text>
                      <View style={{ flex: 1 }} />
                      <Ionicons name="chevron-down" size={16} color={THEME.muted} />
                    </View>
                  </Pressable>
                </View>

                {/* 검수점포 */}
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>검수점포</Text>
                  <Pressable
                    onPress={openInspectModal}
                    disabled={loading || busy}
                    style={[
                      styles.field48,
                      styles.inspectField,
                      (loading || busy) && styles.dim,
                      selectedStore ? styles.inspectFieldSelected : null,
                    ]}
                  >
                    <View style={styles.fieldRow}>
                      <MaterialCommunityIcons
                        name={selectedStore ? "store-check-outline" : "store-search-outline"}
                        size={20}
                        color={selectedStore ? THEME.blue : THEME.text}
                      />
                      <Text
                        style={[styles.fieldText, { flex: 1 }, !selectedStore ? { color: THEME.muted } : null]}
                        numberOfLines={1}
                      >
                        {selectedStore ? buildStoreTitle(selectedStore, selectedStore.store_code, selectedStore.store_name) : "눌러서 점포 선택"}
                      </Text>
                      <Ionicons name="chevron-down" size={16} color={THEME.muted} />
                    </View>
                  </Pressable>

                  {!!selectedStore && (
                    <Pressable
                      onPress={() => setSelectedStore(null)}
                      disabled={loading || busy}
                      style={[styles.clearLink, (loading || busy) && styles.dim]}
                    >
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Ionicons name="close-circle" size={15} color={THEME.danger} />
                        <Text style={styles.clearText}>선택 해제</Text>
                      </View>
                    </Pressable>
                  )}
                </View>
              </View>

              {/* 검색점포 + 버튼 */}
              <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-end", marginTop: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>검색점포</Text>

                  <View style={styles.textInputWrap}>
                    <Ionicons name="search-outline" size={18} color={THEME.subtext} />
                    <TextInput
                      value={searchText}
                      onChangeText={setSearchText}
                      placeholder="점포코드 또는 점포명"
                      placeholderTextColor={THEME.muted}
                      style={styles.textInput}
                      returnKeyType="search"
                      onSubmitEditing={() => fetchList()}
                    />
                    {searchText.length > 0 && (
                      <Pressable onPress={() => setSearchText("")} style={{ padding: 6 }} hitSlop={8}>
                        <Ionicons name="close-circle" size={18} color={THEME.muted} />
                      </Pressable>
                    )}
                  </View>
                </View>

                <TouchableOpacity
                  onPress={() => fetchList()}
                  disabled={loading || busy}
                  style={[styles.btn, styles.btnPrimary, (loading || busy) && styles.dim]}
                >
                  <View style={styles.btnInner}>
                    <Ionicons name="search-outline" size={18} color="#fff" />
                    <Text style={styles.btnTextWhite}>{loading ? "조회중" : "조회"}</Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={enterOrExitSelectMode}
                  disabled={loading || busy}
                  style={[
                    styles.btn,
                    styles.btnOutline,
                    (loading || busy) && styles.dim,
                    selectMode && { backgroundColor: THEME.blueSoft, borderColor: "rgba(37,99,235,0.35)" },
                  ]}
                >
                  <View style={styles.btnInner}>
                    <Ionicons name="checkbox-outline" size={18} color={THEME.text} />
                    <Text style={styles.btnText}>선택 {selectedIds.size}</Text>
                  </View>
                </TouchableOpacity>
              </View>

              {selectMode && (
                <TouchableOpacity
                  onPress={deleteSelected}
                  disabled={selectedIds.size === 0 || busy || loading}
                  style={[
                    styles.btnWide,
                    styles.btnDangerOutline,
                    (selectedIds.size === 0 || busy || loading) && { opacity: 0.35 },
                  ]}
                >
                  <View style={styles.btnInner}>
                    <Ionicons name="trash-outline" size={18} color={THEME.danger} />
                    <Text style={styles.btnTextDanger}>선택 삭제</Text>
                  </View>
                </TouchableOpacity>
              )}

              {loading && <ActivityIndicator style={{ marginTop: 10 }} />}
            </View>
          </>
        )}
      </View>

      {/* 리스트 */}
      <View style={{ flex: 1, paddingHorizontal: 16, paddingBottom: bottomPad }}>
        <View style={styles.listBox}>
          <FlatList
            data={groupedByStore}
            keyExtractor={(g) => g.store_code}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <View style={{ padding: 16 }}>
                <View style={styles.emptyTitleRow}>
                  <Ionicons name="information-circle-outline" size={18} color={THEME.subtext} />
                  <Text style={styles.emptyTitle}>조회 결과가 없습니다.</Text>
                </View>
              </View>
            }
            renderItem={({ item }) => {
              const meta = storeMeta[item.store_code];
              const first = item.items[0];
              const timeStr = first?.created_at ? formatKST(first.created_at) : "-";
              const count = item.items.length;

              const groupSelectedCount = item.items.reduce((acc, p) => (selectedIds.has(p.id) ? acc + 1 : acc), 0);
              const groupAllSelected = groupSelectedCount === count && count > 0;

              const title = buildStoreTitle(meta, item.store_code, first?.store_name ?? "");

              // ✅ 기사면: 카테고리 pill 표시(현재 탭이지만 UI 명확하게)
              const catLabel = isDriver ? driverDisplayCategory : "";

              return (
                <Pressable
                  onPress={() => {
                    Keyboard.dismiss();
                    if (selectMode) {
                      setSelectedIds((prev) => {
                        const next = new Set(prev);
                        if (groupAllSelected) for (const p of item.items) next.delete(p.id);
                        else for (const p of item.items) next.add(p.id);
                        return next;
                      });
                    } else {
                      openPreviewForStore(item.store_code);
                    }
                  }}
                  style={[styles.row, selectMode && groupSelectedCount > 0 && { backgroundColor: THEME.blueSoft }]}
                >
                  <View style={styles.thumbWrap}>
                    {first ? (
                      <Image source={{ uri: getImageUrl(first) }} style={styles.thumb} />
                    ) : (
                      <View style={styles.thumbEmpty}>
                        <Ionicons name="image-outline" size={20} color={THEME.muted} />
                      </View>
                    )}
                  </View>

                  <View style={styles.rowTextWrap}>
                    <Text style={styles.rowTitleStrong} numberOfLines={2}>
                      {title}
                    </Text>
                    <Text style={styles.rowSub}>업로드 : {timeStr}</Text>

                    {isDriver ? (
                      <View style={[styles.catBadge, { borderColor: categoryColor(driverCategory) }]}>
                        <Text style={[styles.catBadgeText, { color: categoryColor(driverCategory) }]}>{catLabel}</Text>
                      </View>
                    ) : null}

                    {selectMode && (
                      <View style={styles.selectPill}>
                        <Ionicons
                          name={groupAllSelected ? "checkmark-circle" : "ellipse-outline"}
                          size={14}
                          color={THEME.blue}
                        />
                        <Text style={styles.selectInfo}>
                          선택됨: {groupSelectedCount} / {count}
                        </Text>
                      </View>
                    )}
                  </View>

                  <View style={styles.rightCol}>
                    <View style={styles.countPill}>
                      <Ionicons name="images-outline" size={14} color={THEME.subtext} />
                      <Text style={styles.countText}>{count}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={THEME.muted} />
                  </View>
                </Pressable>
              );
            }}
          />
        </View>

        <Text style={styles.hint}>
          {isDriver
            ? "기사 조회: 내 업로드만 · 공병/담배/미오출 탭으로 전환"
            : "선택 버튼으로 선택모드 ON/OFF · 선택모드에서는 점포 줄 탭으로 그룹 단위 선택/해제"}
        </Text>
      </View>

      {/* 미리보기 */}
      <Modal
        visible={previewOpen}
        animationType="slide"
        onRequestClose={() => setPreviewOpen(false)}
        presentationStyle="fullScreen"
      >
        <SafeAreaView style={styles.safe}>
          <View style={[styles.previewHeader, { paddingTop: topPad }]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.previewTitleOneLine} numberOfLines={1}>
                {previewTitle}
              </Text>
              <Text style={styles.previewSub} numberOfLines={1}>
                {previewItems.length}장 · 저장/삭제
              </Text>
            </View>

            <Pressable onPress={() => setPreviewOpen(false)} style={styles.headerIconBtn}>
              <Ionicons name="close" size={18} color={THEME.text} />
            </Pressable>
          </View>

          <FlatList
            data={previewItems}
            keyExtractor={(p) => p.id}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: bottomPad, gap: 10 }}
            renderItem={({ item }) => {
              const isMio = String(item.category ?? "") === "miochul";
              const isMetaOnly = String(item.original_url ?? "").startsWith("meta://");
              return (
                <View style={styles.previewCard}>
                  <View style={styles.previewTopRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.previewTime}>{formatKST(item.created_at)}</Text>

                      {isDriver ? (
                        <Text style={styles.previewTag}>
                          분류: {driverDisplayCategory}
                          {isMio ? ` · 납품예정일: ${item.delivery_planned_date ?? "-"}` : ""}
                        </Text>
                      ) : (
                        !!item.work_part && <Text style={styles.previewTag}>작업파트: {item.work_part}</Text>
                      )}

                      {/* ✅ 미오출이면 추가내용 노출 */}
                      {isMio ? (
                        <Text style={styles.previewMioNote} numberOfLines={5}>
                          추가내용: {item.extra_note ?? "-"}
                        </Text>
                      ) : null}
                    </View>

                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Pressable
                        onPress={() => saveToGalleryOne(item.original_url)}
                        disabled={busy || isMetaOnly}
                        style={[styles.smallBtn, (busy || isMetaOnly) && { opacity: 0.6 }]}
                        hitSlop={8}
                      >
                        <Ionicons name="download-outline" size={16} color={THEME.text} />
                        <Text style={styles.smallBtnText}>저장</Text>
                      </Pressable>

                      <Pressable
                        onPress={() => onDeleteOne(item)}
                        disabled={busy}
                        style={[styles.smallDangerBtn, busy && { opacity: 0.6 }]}
                        hitSlop={8}
                      >
                        <Ionicons name="trash-outline" size={16} color={THEME.danger} />
                        <Text style={styles.smallDangerText}>삭제</Text>
                      </Pressable>
                    </View>
                  </View>

                  <View style={{ height: 10 }} />

                  {isMetaOnly ? (
                    <View style={[styles.previewImage, { alignItems: "center", justifyContent: "center", backgroundColor: THEME.soft }]}>
                      <Text style={{ color: THEME.subtext, fontWeight: "700" }}>사진 없이 저장된 미오출입니다.</Text>
                    </View>
                  ) : (
                    <Image source={{ uri: getImageUrl(item) }} style={styles.previewImage} resizeMode="contain" />
                  )}
                </View>
              );
            }}
            ListEmptyComponent={
              <View style={{ padding: 16 }}>
                <Text style={{ color: THEME.subtext }}>미리보기 데이터가 없습니다.</Text>
              </View>
            }
          />
        </SafeAreaView>
      </Modal>

      {/* 달력 */}
      <Modal visible={calendarOpen} transparent animationType="fade" onRequestClose={() => setCalendarOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setCalendarOpen(false)} />

        <View style={[styles.modalBox, { top: topPad + 84 }]}>
          <View style={styles.modalHeader}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Pressable onPress={() => setCalendarMonth((prev) => addMonthsFirstDay(prev, -1))} style={styles.iconBtn}>
                <Ionicons name="chevron-back" size={18} color={THEME.text} />
              </Pressable>

              <Text style={styles.modalTitle}>{ymLabel(calendarMonth)}</Text>

              <Pressable onPress={() => setCalendarMonth((prev) => addMonthsFirstDay(prev, 1))} style={styles.iconBtn}>
                <Ionicons name="chevron-forward" size={18} color={THEME.text} />
              </Pressable>
            </View>

            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Pressable onPress={() => pickDateAndFetch(kstNowDateString())} style={styles.todayBtn}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Ionicons name="today-outline" size={16} color={THEME.blue} />
                  <Text style={styles.todayText}>오늘</Text>
                </View>
              </Pressable>

              <Pressable onPress={() => setCalendarOpen(false)} style={styles.iconBtn}>
                <Ionicons name="close" size={18} color={THEME.text} />
              </Pressable>
            </View>
          </View>

          <Calendar
            key={calendarMonth}
            current={calendarMonth}
            enableSwipeMonths
            hideArrows
            renderHeader={() => null}
            markedDates={{
              [dateStr]: { selected: true, selectedColor: THEME.blue },
            }}
            theme={{
              todayTextColor: THEME.blue,
              textDayFontWeight: "700",
              textMonthFontWeight: "900",
              textDayHeaderFontWeight: "800",
            }}
            onMonthChange={(m) => setCalendarMonth(firstOfMonth(m.dateString))}
            onDayPress={(day) => pickDateAndFetch(day.dateString)}
          />
        </View>
      </Modal>

      {/* 검수점포 모달 (기사 모드에서는 안 쓰지만, 기존 유지) */}
      <Modal visible={inspectModalOpen} transparent animationType="fade" onRequestClose={() => setInspectModalOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setInspectModalOpen(false)} />

        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={[styles.inspectWrap, { top: topPad + 60 }]}
        >
          <View style={styles.inspectBox}>
            <View style={styles.inspectHeader}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <MaterialCommunityIcons name="store-search-outline" size={18} color={THEME.text} />
                <Text style={styles.inspectTitle}>검수점포 선택</Text>
              </View>

              <Pressable onPress={() => setInspectModalOpen(false)} style={styles.iconBtn}>
                <Ionicons name="close" size={18} color={THEME.text} />
              </Pressable>
            </View>

            <View style={styles.searchWrap}>
              <Ionicons name="search-outline" size={18} color={THEME.subtext} />
              <TextInput
                value={inspectQuery}
                onChangeText={setInspectQuery}
                placeholder="검색: 점포코드/점포명/호차/순번"
                placeholderTextColor={THEME.muted}
                style={styles.searchInput}
              />
              {inspectQuery.length > 0 && (
                <Pressable onPress={() => setInspectQuery("")} style={{ padding: 6 }}>
                  <Ionicons name="close-circle" size={18} color={THEME.muted} />
                </Pressable>
              )}
            </View>

            <View style={styles.inspectCols}>
              <Text style={[styles.colHead, { width: 52 }]}>호차</Text>
              <Text style={[styles.colHead, { width: 52 }]}>순번</Text>
              <Text style={[styles.colHead, { flex: 1 }]}>점포코드 / 점포명</Text>
              {inspectLoading && <ActivityIndicator style={{ marginLeft: 8 }} />}
            </View>

            {inspectLoading ? (
              <View style={{ padding: 16 }}>
                <ActivityIndicator />
              </View>
            ) : (
              <FlatList
                data={filteredInspectStores}
                keyExtractor={(it) => it.store_code}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => {
                  const isSelected = selectedStore?.store_code === item.store_code;

                  return (
                    <Pressable
                      onPress={() => {
                        setSelectedStore({
                          store_code: item.store_code,
                          store_name: item.store_name,
                          car_no: item.car_no ?? null,
                          seq_no: item.seq_no ?? null,
                        });
                        setInspectModalOpen(false);
                        Alert.alert("선택 완료", `${item.store_code} ${item.store_name}`);
                      }}
                      style={[
                        styles.inspectRow,
                        isSelected ? { backgroundColor: THEME.blueSoft, borderTopColor: "rgba(37,99,235,0.18)" } : null,
                      ]}
                    >
                      <Text style={[styles.cell, { width: 52 }]}>{item.car_no ?? "-"}</Text>
                      <Text style={[styles.cell, { width: 52 }]}>{item.seq_no ?? "-"}</Text>

                      <View style={{ flex: 1 }}>
                        <Text style={styles.cellStrong} numberOfLines={1}>
                          {item.store_code} <Text style={styles.cellName}>{item.store_name}</Text>
                        </Text>
                      </View>

                      <Ionicons
                        name={isSelected ? "checkmark-circle" : "chevron-forward"}
                        size={18}
                        color={isSelected ? THEME.blue : THEME.muted}
                      />
                    </Pressable>
                  );
                }}
                ListEmptyComponent={
                  <View style={{ padding: 16 }}>
                    <Text style={{ color: THEME.subtext }}>결과 없음</Text>
                  </View>
                }
              />
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: THEME.bg },

  headerWrap: { paddingHorizontal: 16, paddingBottom: 10 },
  headerTopRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  headerTitleLeft: { fontSize: 24, fontWeight: "900", color: THEME.text, letterSpacing: -0.4 },

  h1: { marginTop: 10, fontSize: 20, fontWeight: "900", color: THEME.text, letterSpacing: -0.2 },
  h2: { marginTop: 6, color: THEME.subtext, lineHeight: 18, fontSize: 13 },

  badgeRow: { marginTop: 10, flexDirection: "row", gap: 8 },
  badge: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: THEME.soft,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  badgeText: { color: THEME.subtext, fontWeight: "800", fontSize: 12 },

  miniToggleCard: {
    backgroundColor: THEME.surface,
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: THEME.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 48,
  },
  miniToggleTitle: { fontWeight: "900", color: THEME.text, fontSize: 13 },
  miniToggleSub: { color: THEME.subtext, fontSize: 11, marginLeft: 24 },

  card: {
    backgroundColor: THEME.surface,
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: THEME.border,
    shadowColor: THEME.shadow as any,
    shadowOpacity: 1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
    gap: 10,
  },

  label: { fontSize: 12, fontWeight: "900", color: "#374151", marginBottom: 6 },

  field48: {
    borderWidth: 1,
    borderColor: THEME.border,
    borderRadius: 14,
    height: 48,
    justifyContent: "center",
    paddingHorizontal: 12,
    backgroundColor: THEME.soft,
  },
  fieldRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  fieldText: { fontWeight: "900", color: THEME.text, fontSize: 13 },

  inspectField: { borderColor: "rgba(37,99,235,0.22)", backgroundColor: THEME.blueSoft },
  inspectFieldSelected: { backgroundColor: "#FFFFFF", borderColor: "rgba(37,99,235,0.32)" },

  clearLink: { marginTop: 8, alignSelf: "flex-end" },
  clearText: { fontWeight: "900", color: THEME.danger, fontSize: 12 },

  textInputWrap: {
    height: 48,
    borderWidth: 1,
    borderColor: THEME.border,
    borderRadius: 14,
    paddingHorizontal: 12,
    backgroundColor: THEME.soft,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  textInput: { flex: 1, color: THEME.text, fontWeight: "900", fontSize: 13, paddingVertical: 0 },

  btn: { height: 48, paddingHorizontal: 14, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  btnWide: { height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  btnInner: { flexDirection: "row", alignItems: "center", gap: 8 },
  btnPrimary: { backgroundColor: THEME.primary },
  btnOutline: { backgroundColor: THEME.surface, borderWidth: 1, borderColor: THEME.primary },
  btnDangerOutline: { backgroundColor: THEME.surface, borderWidth: 1, borderColor: "#FCA5A5" },

  btnTextWhite: { color: "#fff", fontWeight: "900", fontSize: 13 },
  btnText: { color: THEME.text, fontWeight: "900", fontSize: 13 },
  btnTextDanger: { color: THEME.danger, fontWeight: "900", fontSize: 13 },

  dim: { opacity: 0.65 },

  listBox: {
    borderWidth: 1,
    borderColor: THEME.border,
    borderRadius: 18,
    overflow: "hidden",
    backgroundColor: THEME.surface,
  },

  row: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    backgroundColor: THEME.surface,
  },

  thumbWrap: { width: 64, height: 64, borderRadius: 16, overflow: "hidden", backgroundColor: "#F3F4F6" },
  thumb: { width: "100%", height: "100%" },
  thumbEmpty: { flex: 1, alignItems: "center", justifyContent: "center" },

  rowTextWrap: { flex: 1, gap: 6 },
  rowTitleStrong: { fontWeight: "950" as any, fontSize: 13, color: THEME.text, lineHeight: 18 },
  rowSub: { color: THEME.subtext, fontSize: 12, lineHeight: 16 },

  catBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    backgroundColor: THEME.soft,
  },
  catBadgeText: { fontWeight: "900", fontSize: 12 },

  selectPill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: THEME.soft,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  selectInfo: { fontWeight: "900", color: THEME.text, fontSize: 12 },

  rightCol: { alignItems: "flex-end", justifyContent: "space-between", height: 64, paddingVertical: 2 },

  countPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: THEME.soft,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  countText: { fontWeight: "900", color: THEME.text, fontSize: 12 },

  hint: { color: THEME.muted, marginTop: 10, fontSize: 11, lineHeight: 15 },

  emptyTitleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  emptyTitle: { color: THEME.subtext, fontWeight: "900", fontSize: 13 },

  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },

  previewHeader: {
    paddingHorizontal: 16,
    paddingBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  previewTitleOneLine: { fontSize: 17, fontWeight: "950" as any, color: THEME.text, lineHeight: 22 },
  previewSub: { marginTop: 4, color: THEME.subtext, fontWeight: "800", fontSize: 12 },

  headerIconBtn: {
    width: 40,
    height: 40,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: THEME.border,
    backgroundColor: THEME.surface,
    alignItems: "center",
    justifyContent: "center",
  },

  previewCard: {
    borderWidth: 1,
    borderColor: THEME.border,
    borderRadius: 18,
    padding: 12,
    backgroundColor: THEME.surface,
    shadowColor: THEME.shadow as any,
    shadowOpacity: 1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
  previewTopRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 },
  previewTime: { fontWeight: "950" as any, color: THEME.text, fontSize: 12 },
  previewTag: { marginTop: 6, color: THEME.subtext, fontWeight: "800", fontSize: 12 },
  previewMioNote: { marginTop: 8, color: THEME.text, fontWeight: "800", fontSize: 12, lineHeight: 16 },

  smallBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: THEME.border,
    backgroundColor: THEME.soft,
  },
  smallBtnText: { fontWeight: "950" as any, color: THEME.text, fontSize: 12 },

  smallDangerBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#FCA5A5",
    backgroundColor: THEME.dangerSoft,
  },
  smallDangerText: { fontWeight: "950" as any, color: THEME.danger, fontSize: 12 },

  previewImage: { width: "100%", height: 340, borderRadius: 16, backgroundColor: "#F3F4F6" },

  modalBox: {
    position: "absolute",
    left: 16,
    right: 16,
    backgroundColor: THEME.surface,
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: THEME.border,
  },
  modalHeader: {
    paddingHorizontal: 10,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
    backgroundColor: THEME.soft,
  },
  modalTitle: { fontSize: 14, fontWeight: "900", color: THEME.text },

  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: THEME.border,
    backgroundColor: THEME.surface,
    alignItems: "center",
    justifyContent: "center",
  },

  todayBtn: {
    height: 40,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(37,99,235,0.22)",
    backgroundColor: THEME.blueSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  todayText: { fontWeight: "900", color: THEME.blue, fontSize: 13 },

  inspectWrap: { position: "absolute", left: 16, right: 16, maxHeight: "78%" },
  inspectBox: {
    backgroundColor: THEME.surface,
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: THEME.border,
  },

  inspectHeader: {
    paddingHorizontal: 10,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: THEME.soft,
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
  },
  inspectTitle: { fontSize: 14, fontWeight: "900", color: THEME.text },

  searchWrap: {
    margin: 12,
    height: 48,
    borderWidth: 1,
    borderColor: THEME.border,
    borderRadius: 14,
    paddingHorizontal: 12,
    backgroundColor: THEME.soft,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  searchInput: { flex: 1, color: THEME.text, fontWeight: "900", fontSize: 13 },

  inspectCols: { flexDirection: "row", paddingHorizontal: 12, paddingBottom: 10, alignItems: "center" },
  colHead: { fontWeight: "900", color: "#374151", fontSize: 11 },

  inspectRow: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderTopWidth: 1,
    borderTopColor: "#F3F4F6",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: THEME.surface,
  },
  cell: { fontWeight: "900", color: THEME.text, fontSize: 13 },
  cellStrong: { fontWeight: "900", color: THEME.text, fontSize: 13 },
  cellName: { fontWeight: "800", color: THEME.text, fontSize: 13 },

  // ✅ 기사 탭 pill
  catPill: { flex: 1, height: 44, borderRadius: 14, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  catPillText: { fontWeight: "900", fontSize: 13 },
});
