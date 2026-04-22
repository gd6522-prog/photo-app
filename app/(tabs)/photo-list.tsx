import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { Calendar } from "react-native-calendars";
import { supabase } from "../../src/lib/supabase";
import { getTodayTempWorkPart } from "../../src/lib/tempWorkPart";

// ✅ 반드시 legacy로! (expo-file-system import 금지)
import * as FileSystem from "expo-file-system/legacy";
import * as MediaLibrary from "expo-media-library";

// ✅ 안전영역/탭바 겹침 방지
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

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

const SPRING = { damping: 18, stiffness: 200, mass: 0.8 };

// 각 이미지 슬라이드 — 위치를 shared value로만 계산해서 React 재렌더 없이 플래시 제거
function ImageSlide({
  item,
  imageIdx,
  idxSV,
  swipeX,
  scale,
  panX,
  panY,
}: {
  item: PhotoRow;
  imageIdx: number;
  idxSV: any;
  swipeX: any;
  scale: any;
  panX: any;
  panY: any;
}) {
  const imgStyle = useAnimatedStyle(() => {
    const isCenter = imageIdx === idxSV.value;
    const baseX = (imageIdx - idxSV.value) * SCREEN_W + swipeX.value;
    if (isCenter && scale.value > 1) {
      return {
        transform: [
          { translateX: panX.value },
          { translateY: panY.value },
          { scale: scale.value },
        ],
      };
    }
    return {
      transform: [
        { translateX: baseX },
        { scale: isCenter ? scale.value : 1 },
      ],
    };
  });
  return (
    <Animated.Image
      source={{ uri: item.original_url }}
      style={[{ position: "absolute", width: SCREEN_W, height: SCREEN_H }, imgStyle]}
      resizeMode="contain"
    />
  );
}

function LightboxModal({
  visible,
  items,
  initialIndex,
  onClose,
  storeMeta,
}: {
  visible: boolean;
  items: PhotoRow[];
  initialIndex: number;
  onClose: () => void;
  storeMeta: Record<string, StoreMapRow>;
}) {
  // windowCenter는 헤더 표시 및 렌더 윈도우 결정용 React state
  const [windowCenter, setWindowCenter] = useState(initialIndex);

  const idxSV = useSharedValue(initialIndex);
  const totalSV = useSharedValue(items.length);
  const swipeX = useSharedValue(0);
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const panX = useSharedValue(0);
  const panY = useSharedValue(0);
  const savedPanX = useSharedValue(0);
  const savedPanY = useSharedValue(0);

  useEffect(() => { totalSV.value = items.length; }, [items.length]);

  useEffect(() => {
    if (visible) {
      idxSV.value = initialIndex;
      swipeX.value = 0;
      scale.value = 1; savedScale.value = 1;
      panX.value = 0; savedPanX.value = 0;
      panY.value = 0; savedPanY.value = 0;
      setWindowCenter(initialIndex);
    }
  }, [visible, initialIndex]);

  // 페이지 전환 시 줌 리셋
  useEffect(() => {
    scale.value = 1; savedScale.value = 1;
    panX.value = 0; savedPanX.value = 0;
    panY.value = 0; savedPanY.value = 0;
  }, [windowCenter]);

  const commitTo = (newIdx: number) => {
    setWindowCenter(newIdx);
  };

  const resetZoom = () => {
    "worklet";
    scale.value = withSpring(1, SPRING);
    panX.value = withSpring(0, SPRING);
    panY.value = withSpring(0, SPRING);
    savedScale.value = 1; savedPanX.value = 0; savedPanY.value = 0;
  };

  const pinch = Gesture.Pinch()
    .onStart(() => { "worklet"; savedScale.value = scale.value; })
    .onUpdate((e) => { "worklet"; scale.value = Math.min(Math.max(savedScale.value * e.scale, 0.5), 5); })
    .onEnd(() => {
      "worklet";
      if (scale.value < 1) resetZoom();
      else savedScale.value = scale.value;
    });

  const pan = Gesture.Pan()
    .activeOffsetX([-12, 12])
    .failOffsetY([-20, 20])
    .onStart(() => {
      "worklet";
      savedPanX.value = panX.value;
      savedPanY.value = panY.value;
    })
    .onUpdate((e) => {
      "worklet";
      if (scale.value > 1) {
        panX.value = savedPanX.value + e.translationX;
        panY.value = savedPanY.value + e.translationY;
      } else {
        swipeX.value = e.translationX;
      }
    })
    .onEnd((e) => {
      "worklet";
      if (scale.value > 1) {
        savedPanX.value = panX.value;
        savedPanY.value = panY.value;
        return;
      }
      const threshold = SCREEN_W * 0.25;
      const fastSwipe = Math.abs(e.velocityX) > 500;
      if ((e.translationX < -threshold || (fastSwipe && e.velocityX < 0)) && idxSV.value < totalSV.value - 1) {
        swipeX.value = withTiming(-SCREEN_W, { duration: 200 }, (finished) => {
          "worklet";
          if (finished) {
            // idxSV와 swipeX를 같은 프레임에서 업데이트 → 플래시 없음
            idxSV.value = idxSV.value + 1;
            swipeX.value = 0;
            runOnJS(commitTo)(idxSV.value);
          }
        });
      } else if ((e.translationX > threshold || (fastSwipe && e.velocityX > 0)) && idxSV.value > 0) {
        swipeX.value = withTiming(SCREEN_W, { duration: 200 }, (finished) => {
          "worklet";
          if (finished) {
            idxSV.value = idxSV.value - 1;
            swipeX.value = 0;
            runOnJS(commitTo)(idxSV.value);
          }
        });
      } else {
        swipeX.value = withSpring(0, SPRING);
      }
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDuration(250)
    .onEnd(() => {
      "worklet";
      if (savedScale.value > 1) resetZoom();
      else { scale.value = withSpring(2.5, SPRING); savedScale.value = 2.5; }
    });

  const gesture = Gesture.Simultaneous(doubleTap, pinch, pan);

  if (!visible || items.length === 0) return null;

  const RENDER_WINDOW = 2;
  const startRenderIdx = Math.max(0, windowCenter - RENDER_WINDOW);
  const endRenderIdx = Math.min(items.length - 1, windowCenter + RENDER_WINDOW);

  const cur = items[windowCenter];
  const meta = cur ? storeMeta[cur.store_code] : null;
  const car = meta?.car_no ?? "-";
  const seq = meta?.seq_no ?? "-";
  const code = cur?.store_code ?? "";
  const name = cur?.store_name ?? meta?.store_name ?? "";
  const date = cur ? formatKST(cur.created_at).slice(0, 10) : "";

  const slideItems: Array<{ item: PhotoRow; imageIdx: number }> = [];
  for (let i = startRenderIdx; i <= endRenderIdx; i++) {
    slideItems.push({ item: items[i], imageIdx: i });
  }

  return (
    <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 100, backgroundColor: "#000" }}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        {/* 헤더 */}
        <View style={lbStyles.header}>
          <Text style={lbStyles.counter}>{windowCenter + 1}/{items.length}</Text>
          <Text style={lbStyles.timeText} numberOfLines={1}>{car}-{seq} {code} {name}  {date}</Text>
          <Pressable onPress={onClose} style={lbStyles.closeBtn} hitSlop={8}>
            <Ionicons name="close" size={22} color="#fff" />
          </Pressable>
        </View>

        {/* 이미지 영역 */}
        <GestureDetector gesture={gesture}>
          <View style={{ flex: 1, overflow: "hidden" }}>
            {slideItems.map(({ item, imageIdx }) => (
              <ImageSlide
                key={item.id}
                item={item}
                imageIdx={imageIdx}
                idxSV={idxSV}
                swipeX={swipeX}
                scale={scale}
                panX={panX}
                panY={panY}
              />
            ))}
          </View>
        </GestureDetector>
      </GestureHandlerRootView>
    </View>
  );
}

const lbStyles = StyleSheet.create({
  header: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    flexDirection: "row",
    alignItems: "center",
    paddingTop: 52,
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 10,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  counter: { color: "#fff", fontWeight: "900", fontSize: 14 },
  timeText: { flex: 1, color: "rgba(255,255,255,0.75)", fontSize: 12, fontWeight: "700" },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
});

export default function PhotoListScreen() {
  const router = useRouter();

  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();

  const topPad = Math.min(Math.max(insets.top, 6), 18) + 6;
  const bottomPad = tabBarHeight + Math.max(insets.bottom, 0) + 8;

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

  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
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
    setAdminSeeAll(adminFlag); // 관리자는 기본값 전체 보기
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
          .order("created_at", { ascending: false })
          .limit(500);

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

        // photos 먼저 표시하고 메타는 병렬로
        setPhotos(rows);

        const codes = Array.from(new Set(rows.map((p) => p.store_code))).filter(Boolean);
        if (codes.length === 0) {
          setStoreMeta({});
        } else {
          const { data: meta, error: metaErr } = await supabase
            .from("store_map")
            .select("store_code, store_name, car_no, seq_no")
            .in("store_code", codes)
            .limit(codes.length);

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
          .order("created_at", { ascending: false })
          .limit(500);

        // 검수점포 선택 시 store_code 필터
        let prefetchedMeta: Record<string, StoreMapRow> | null = null;

        if (selectedStore?.store_code) {
          q = q.eq("store_code", selectedStore.store_code);
        } else {
          const kwRaw = searchText.trim();
          if (kwRaw) {
            const kw = escapeLike(kwRaw);

            // store_map 조회 + 메타 미리 확보 (재조회 불필요)
            const { data: hits, error: hitErr } = await supabase
              .from("store_map")
              .select("store_code, store_name, car_no, seq_no")
              .or(`store_code.ilike.%${kw}%,store_name.ilike.%${kw}%`)
              .limit(200);

            if (hitErr) {
              q = q.eq("store_code", kwRaw);
            } else {
              const hitRows = (hits ?? []) as StoreMapRow[];
              const codes = Array.from(new Set(hitRows.map((r) => r.store_code).filter(Boolean)));

              // 메타 미리 캐시 → 뒤에서 store_map 재조회 생략
              prefetchedMeta = {};
              for (const r of hitRows) prefetchedMeta[r.store_code] = r;

              if (codes.length === 0) q = q.eq("store_code", "__no_match__");
              else if (codes.length === 1) q = q.eq("store_code", codes[0]);
              else q = q.in("store_code", codes);
            }
          }
        }

        // 권한 필터
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

        if (prefetchedMeta) {
          // 검색어 경우: 이미 확보한 메타 재사용 (추가 쿼리 없음)
          setStoreMeta(prefetchedMeta);
        } else {
          const codes = Array.from(new Set(rows.map((p) => p.store_code))).filter(Boolean);
          if (codes.length === 0) {
            setStoreMeta({});
          } else {
            const { data: meta, error: metaErr } = await supabase
              .from("store_map")
              .select("store_code, store_name, car_no, seq_no")
              .in("store_code", codes)
              .limit(codes.length);

            if (!metaErr) {
              const map: Record<string, StoreMapRow> = {};
              for (const r of (meta ?? []) as StoreMapRow[]) map[r.store_code] = r;
              setStoreMeta(map);
            } else {
              setStoreMeta({});
            }
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
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      {/* 헤더 */}
      <View style={[styles.headerWrap, { paddingTop: topPad }]}>
        <View style={styles.headerRow}>
          <Text style={styles.headerTitle}>{isDriver ? "기사 사진 조회" : "사진 조회"}</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {!isDriver && (
              <Pressable
                onPress={enterOrExitSelectMode}
                disabled={loading || busy}
                style={[styles.headerBtn, selectMode && styles.headerBtnActive, (loading || busy) && styles.dim]}
              >
                <Ionicons name="checkbox-outline" size={18} color={selectMode ? THEME.blue : THEME.text} />
              </Pressable>
            )}
            <Pressable
              onPress={() => fetchList()}
              disabled={loading || busy}
              style={[styles.headerBtn, (loading || busy) && styles.dim]}
            >
              {loading
                ? <ActivityIndicator size="small" color={THEME.text} />
                : <Ionicons name="refresh" size={18} color={THEME.text} />}
            </Pressable>
          </View>
        </View>
      </View>

      {/* 필터 */}
      <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>
        {isDriver ? (
          <View style={styles.filterCard}>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {(["bottle", "tobacco", "miochul", "wash"] as DriverCategory[]).map((c) => {
                const on = driverCategory === c;
                return (
                  <Pressable
                    key={c}
                    onPress={() => setDriverCategory(c)}
                    style={[styles.catPill, on && { borderColor: categoryColor(c), backgroundColor: categoryColor(c) + "18" }]}
                  >
                    <Text style={[styles.catPillText, on && { color: categoryColor(c) }]}>{categoryLabel(c)}</Text>
                  </Pressable>
                );
              })}
            </View>

            {driverCategory === "wash" && (
              <View style={{ flexDirection: "row", gap: 8 }}>
                {([1, 2] as const).map((stage) => {
                  const on = washStage === stage;
                  return (
                    <Pressable
                      key={stage}
                      onPress={() => setWashStage(stage)}
                      style={[styles.catPill, on && { borderColor: "#0F766E", backgroundColor: "#F0FFFE" }]}
                    >
                      <Text style={[styles.catPillText, on && { color: "#0F766E" }]}>{stage}차</Text>
                    </Pressable>
                  );
                })}
              </View>
            )}

            <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              <Pressable
                onPress={openCalendar}
                disabled={loading || busy}
                style={[styles.datePicker, { flex: 1 }, (loading || busy) && styles.dim]}
              >
                <Ionicons name="calendar-outline" size={16} color={THEME.subtext} />
                <Text style={styles.dateText}>{dateStr}</Text>
                <Ionicons name="chevron-down" size={14} color={THEME.muted} />
              </Pressable>
              <Pressable
                onPress={() => fetchList()}
                disabled={loading || busy}
                style={[styles.searchBtn, (loading || busy) && styles.dim]}
              >
                <Ionicons name="search-outline" size={16} color="#fff" />
                <Text style={styles.searchBtnText}>조회</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={styles.filterCard}>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable
                onPress={openCalendar}
                disabled={loading || busy}
                style={[styles.datePicker, { flex: 1 }, (loading || busy) && styles.dim]}
              >
                <Ionicons name="calendar-outline" size={16} color={THEME.subtext} />
                <Text style={styles.dateText}>{dateStr}</Text>
                <Ionicons name="chevron-down" size={14} color={THEME.muted} />
              </Pressable>

              <Pressable
                onPress={openInspectModal}
                disabled={loading || busy}
                style={[styles.datePicker, { flex: 1.2 }, selectedStore && styles.datePickerActive, (loading || busy) && styles.dim]}
              >
                <MaterialCommunityIcons
                  name={selectedStore ? "store-check-outline" : "store-search-outline"}
                  size={16}
                  color={selectedStore ? THEME.blue : THEME.subtext}
                />
                <Text style={[styles.dateText, !selectedStore && { color: THEME.muted }]} numberOfLines={1}>
                  {selectedStore ? selectedStore.store_code : "점포 선택"}
                </Text>
                {selectedStore ? (
                  <Pressable onPress={() => setSelectedStore(null)} hitSlop={8} disabled={loading || busy}>
                    <Ionicons name="close-circle" size={15} color={THEME.danger} />
                  </Pressable>
                ) : (
                  <Ionicons name="chevron-down" size={14} color={THEME.muted} />
                )}
              </Pressable>
            </View>

            <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              <View style={[styles.searchInputWrap, { flex: 1 }]}>
                <Ionicons name="search-outline" size={16} color={THEME.subtext} />
                <TextInput
                  value={searchText}
                  onChangeText={setSearchText}
                  placeholder="점포코드 / 점포명 검색"
                  placeholderTextColor={THEME.muted}
                  style={{ flex: 1, color: THEME.text, fontWeight: "800", fontSize: 13, paddingVertical: 0 }}
                  returnKeyType="search"
                  onSubmitEditing={() => fetchList()}
                />
                {searchText.length > 0 && (
                  <Pressable onPress={() => setSearchText("")} hitSlop={8}>
                    <Ionicons name="close-circle" size={16} color={THEME.muted} />
                  </Pressable>
                )}
              </View>
              <Pressable
                onPress={() => fetchList()}
                disabled={loading || busy}
                style={[styles.searchBtn, (loading || busy) && styles.dim]}
              >
                {loading
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Ionicons name="search-outline" size={16} color="#fff" />}
                <Text style={styles.searchBtnText}>{loading ? "조회중" : "조회"}</Text>
              </Pressable>
            </View>

            {selectMode && (
              <Pressable
                onPress={deleteSelected}
                disabled={selectedIds.size === 0 || busy || loading}
                style={[styles.deletePill, (selectedIds.size === 0 || busy || loading) && { opacity: 0.35 }]}
              >
                <Ionicons name="trash-outline" size={15} color={THEME.danger} />
                <Text style={{ fontWeight: "900", color: THEME.danger, fontSize: 13 }}>선택 삭제 ({selectedIds.size}개)</Text>
              </Pressable>
            )}
          </View>
        )}
      </View>

      {/* 사진 목록 */}
      <FlatList
        data={groupedByStore}
        keyExtractor={(g) => g.store_code}
        keyboardShouldPersistTaps="handled"
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: bottomPad, gap: 8 }}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.emptyWrap}>
              <Ionicons name="images-outline" size={44} color={THEME.muted} />
              <Text style={styles.emptyText}>조회된 사진이 없습니다</Text>
              <Text style={{ color: THEME.muted, fontSize: 12, marginTop: 2 }}>날짜나 필터를 변경 후 조회하세요</Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => {
          const meta = storeMeta[item.store_code];
          const first = item.items[0];
          const timeStr = first?.created_at ? formatKST(first.created_at) : "-";
          const count = item.items.length;
          const groupSelectedCount = item.items.reduce((acc, p) => (selectedIds.has(p.id) ? acc + 1 : acc), 0);
          const groupAllSelected = groupSelectedCount === count && count > 0;
          const title = buildStoreTitle(meta, item.store_code, first?.store_name ?? "");

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
              style={[
                styles.listRow,
                selectMode && groupSelectedCount > 0 && { backgroundColor: THEME.blueSoft, borderColor: "rgba(37,99,235,0.25)" },
              ]}
            >
              <View style={styles.thumbWrap}>
                {first && !String(first.original_url).startsWith("meta://") ? (
                  <Image source={{ uri: getImageUrl(first) }} style={styles.thumb} />
                ) : (
                  <View style={[styles.thumb, { alignItems: "center", justifyContent: "center" }]}>
                    <Ionicons name="image-outline" size={22} color={THEME.muted} />
                  </View>
                )}
                <View style={styles.countBadge}>
                  <Text style={styles.countBadgeText}>{count}</Text>
                </View>
              </View>

              <View style={{ flex: 1, gap: 4 }}>
                <Text style={styles.rowTitle} numberOfLines={2}>{title}</Text>
                <Text style={styles.rowSub}>{timeStr}</Text>
                {isDriver && (
                  <View style={[styles.catBadge, { borderColor: categoryColor(driverCategory), backgroundColor: categoryColor(driverCategory) + "14" }]}>
                    <Text style={[styles.catBadgeText, { color: categoryColor(driverCategory) }]}>{driverDisplayCategory}</Text>
                  </View>
                )}
                {selectMode && (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    <Ionicons name={groupAllSelected ? "checkmark-circle" : "ellipse-outline"} size={14} color={THEME.blue} />
                    <Text style={{ fontSize: 11, color: THEME.blue, fontWeight: "800" }}>{groupSelectedCount}/{count} 선택</Text>
                  </View>
                )}
              </View>

              <Ionicons name="chevron-forward" size={18} color={THEME.muted} />
            </Pressable>
          );
        }}
      />

      {/* 미리보기 모달 */}
      <Modal
        visible={previewOpen}
        animationType="slide"
        onRequestClose={() => setPreviewOpen(false)}
        presentationStyle="fullScreen"
      >
        <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
          <View style={[styles.previewHeader, { paddingTop: topPad + 8 }]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.previewTitle} numberOfLines={1}>{previewTitle}</Text>
              <Text style={styles.previewSub}>{previewItems.length}장 · 저장 / 삭제</Text>
            </View>
            <Pressable onPress={() => setPreviewOpen(false)} style={styles.headerBtn}>
              <Ionicons name="close" size={18} color={THEME.text} />
            </Pressable>
          </View>

          <FlatList
            data={previewItems}
            keyExtractor={(p) => p.id}
            contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: bottomPad, gap: 12 }}
            renderItem={({ item }) => {
              const isMio = String(item.category ?? "") === "miochul";
              const isMetaOnly = String(item.original_url ?? "").startsWith("meta://");
              const nonMetaItems = previewItems.filter((p) => !String(p.original_url).startsWith("meta://"));
              return (
                <View style={styles.previewCard}>
                  {isMetaOnly ? (
                    <View style={[styles.previewImage, { alignItems: "center", justifyContent: "center", backgroundColor: THEME.soft }]}>
                      <Ionicons name="image-outline" size={32} color={THEME.muted} />
                      <Text style={{ color: THEME.subtext, fontWeight: "700", marginTop: 8, fontSize: 13 }}>사진 없이 저장된 미오출</Text>
                    </View>
                  ) : (
                    <Pressable
                      onPress={() => {
                        setLightboxIndex(nonMetaItems.indexOf(item));
                        setLightboxOpen(true);
                      }}
                    >
                      <Image source={{ uri: getImageUrl(item) }} style={styles.previewImage} resizeMode="contain" />
                      <View style={styles.zoomHint}>
                        <Ionicons name="expand-outline" size={12} color="#fff" />
                        <Text style={styles.zoomHintText}>전체화면</Text>
                      </View>
                    </Pressable>
                  )}

                  <View style={{ padding: 12, gap: 6 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <Text style={{ fontWeight: "800", color: THEME.text, fontSize: 13, flex: 1 }} numberOfLines={1}>
                        {formatKST(item.created_at)}
                      </Text>
                      <View style={{ flexDirection: "row", gap: 8 }}>
                        <Pressable
                          onPress={() => saveToGalleryOne(item.original_url)}
                          disabled={busy || isMetaOnly}
                          style={[styles.actionPill, (busy || isMetaOnly) && { opacity: 0.4 }]}
                        >
                          <Ionicons name="download-outline" size={14} color={THEME.text} />
                          <Text style={{ fontWeight: "800", fontSize: 12, color: THEME.text }}>저장</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => onDeleteOne(item)}
                          disabled={busy}
                          style={[styles.actionPillDanger, busy && { opacity: 0.4 }]}
                        >
                          <Ionicons name="trash-outline" size={14} color={THEME.danger} />
                          <Text style={{ fontWeight: "800", fontSize: 12, color: THEME.danger }}>삭제</Text>
                        </Pressable>
                      </View>
                    </View>

                    {isDriver ? (
                      <Text style={{ color: THEME.subtext, fontSize: 12, fontWeight: "700" }}>
                        {driverDisplayCategory}{isMio ? ` · 납품예정: ${item.delivery_planned_date ?? "-"}` : ""}
                      </Text>
                    ) : (
                      !!item.work_part && (
                        <Text style={{ color: THEME.subtext, fontSize: 12, fontWeight: "700" }}>파트: {item.work_part}</Text>
                      )
                    )}

                    {isMio && item.extra_note ? (
                      <Text style={{ color: THEME.text, fontSize: 12, fontWeight: "700", lineHeight: 16 }}>
                        메모: {item.extra_note}
                      </Text>
                    ) : null}
                  </View>
                </View>
              );
            }}
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <Text style={styles.emptyText}>미리보기 데이터가 없습니다</Text>
              </View>
            }
          />

          <LightboxModal
            visible={lightboxOpen}
            items={previewItems.filter((p) => !String(p.original_url).startsWith("meta://"))}
            initialIndex={lightboxIndex}
            onClose={() => setLightboxOpen(false)}
            storeMeta={storeMeta}
          />
        </SafeAreaView>
      </Modal>

      {/* 달력 모달 */}
      <Modal visible={calendarOpen} transparent animationType="fade" onRequestClose={() => setCalendarOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setCalendarOpen(false)} />
        <View style={[styles.calendarBox, { top: topPad + 80 }]}>
          <View style={styles.calendarHeader}>
            <Pressable onPress={() => setCalendarMonth((prev) => addMonthsFirstDay(prev, -1))} style={styles.iconBtn}>
              <Ionicons name="chevron-back" size={18} color={THEME.text} />
            </Pressable>
            <Text style={{ fontWeight: "900", color: THEME.text, fontSize: 15 }}>{ymLabel(calendarMonth)}</Text>
            <Pressable onPress={() => setCalendarMonth((prev) => addMonthsFirstDay(prev, 1))} style={styles.iconBtn}>
              <Ionicons name="chevron-forward" size={18} color={THEME.text} />
            </Pressable>
            <View style={{ flex: 1 }} />
            <Pressable onPress={() => pickDateAndFetch(kstNowDateString())} style={styles.todayBtn}>
              <Ionicons name="today-outline" size={14} color={THEME.blue} />
              <Text style={{ fontWeight: "900", color: THEME.blue, fontSize: 13 }}>오늘</Text>
            </Pressable>
            <Pressable onPress={() => setCalendarOpen(false)} style={styles.iconBtn}>
              <Ionicons name="close" size={18} color={THEME.text} />
            </Pressable>
          </View>
          <Calendar
            key={calendarMonth}
            current={calendarMonth}
            enableSwipeMonths
            hideArrows
            renderHeader={() => null}
            markedDates={{ [dateStr]: { selected: true, selectedColor: THEME.blue } }}
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

      {/* 검수점포 모달 */}
      <Modal visible={inspectModalOpen} transparent animationType="fade" onRequestClose={() => setInspectModalOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setInspectModalOpen(false)} />
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={[styles.inspectWrap, { top: topPad + 56 }]}
        >
          <View style={styles.inspectBox}>
            <View style={styles.inspectHeader}>
              <MaterialCommunityIcons name="store-search-outline" size={18} color={THEME.text} />
              <Text style={{ fontWeight: "900", fontSize: 14, color: THEME.text, flex: 1 }}>검수점포 선택</Text>
              <Pressable onPress={() => setInspectModalOpen(false)} style={styles.iconBtn}>
                <Ionicons name="close" size={18} color={THEME.text} />
              </Pressable>
            </View>

            <View style={styles.inspectSearch}>
              <Ionicons name="search-outline" size={16} color={THEME.subtext} />
              <TextInput
                value={inspectQuery}
                onChangeText={setInspectQuery}
                placeholder="점포코드 / 점포명 / 호차 / 순번"
                placeholderTextColor={THEME.muted}
                style={{ flex: 1, color: THEME.text, fontWeight: "800", fontSize: 13 }}
              />
              {inspectQuery.length > 0 && (
                <Pressable onPress={() => setInspectQuery("")} hitSlop={8}>
                  <Ionicons name="close-circle" size={16} color={THEME.muted} />
                </Pressable>
              )}
            </View>

            <View style={{ flexDirection: "row", paddingHorizontal: 12, paddingBottom: 8 }}>
              <Text style={[styles.colHead, { width: 48 }]}>호차</Text>
              <Text style={[styles.colHead, { width: 48 }]}>순번</Text>
              <Text style={[styles.colHead, { flex: 1 }]}>점포코드 / 점포명</Text>
              {inspectLoading && <ActivityIndicator size="small" />}
            </View>

            {inspectLoading ? (
              <View style={{ padding: 20, alignItems: "center" }}>
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
                      }}
                      style={[styles.inspectRow, isSelected && { backgroundColor: THEME.blueSoft }]}
                    >
                      <Text style={[styles.colCell, { width: 48 }]}>{item.car_no ?? "-"}</Text>
                      <Text style={[styles.colCell, { width: 48 }]}>{item.seq_no ?? "-"}</Text>
                      <Text style={[styles.colCell, { flex: 1 }]} numberOfLines={1}>
                        <Text style={{ fontWeight: "900" }}>{item.store_code}</Text>{"  "}{item.store_name}
                      </Text>
                      <Ionicons
                        name={isSelected ? "checkmark-circle" : "chevron-forward"}
                        size={16}
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

  headerWrap: { paddingHorizontal: 16, paddingBottom: 12 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerTitle: { fontSize: 24, fontWeight: "900", color: THEME.text, letterSpacing: -0.4 },
  headerBtn: {
    width: 40, height: 40, borderRadius: 14,
    borderWidth: 1, borderColor: THEME.border,
    backgroundColor: THEME.surface,
    alignItems: "center", justifyContent: "center",
  },
  headerBtnActive: { backgroundColor: THEME.blueSoft, borderColor: THEME.blue },

  dim: { opacity: 0.55 },

  filterCard: {
    backgroundColor: THEME.surface,
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: THEME.border,
    gap: 10,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },

  datePicker: {
    height: 48, borderWidth: 1, borderColor: THEME.border,
    borderRadius: 14, paddingHorizontal: 12,
    backgroundColor: THEME.soft,
    flexDirection: "row", alignItems: "center", gap: 8,
  },
  datePickerActive: { borderColor: THEME.blue, backgroundColor: THEME.blueSoft },
  dateText: { fontWeight: "800", color: THEME.text, fontSize: 13, flex: 1 },

  searchInputWrap: {
    height: 48, borderWidth: 1, borderColor: THEME.border,
    borderRadius: 14, paddingHorizontal: 12,
    backgroundColor: THEME.soft,
    flexDirection: "row", alignItems: "center", gap: 8,
  },
  searchBtn: {
    height: 48, paddingHorizontal: 18, borderRadius: 14,
    backgroundColor: THEME.primary,
    flexDirection: "row", alignItems: "center", gap: 6,
  },
  searchBtnText: { color: "#fff", fontWeight: "900", fontSize: 13 },

  deletePill: {
    height: 44, paddingHorizontal: 16, borderRadius: 12,
    borderWidth: 1, borderColor: "#FCA5A5",
    backgroundColor: THEME.dangerSoft,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
  },

  catPill: { flex: 1, height: 40, borderRadius: 12, borderWidth: 1, borderColor: THEME.border, alignItems: "center", justifyContent: "center" },
  catPillText: { fontWeight: "900", fontSize: 13, color: THEME.text },

  listRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: THEME.surface, borderRadius: 16,
    padding: 12, borderWidth: 1, borderColor: THEME.border,
  },
  thumbWrap: { width: 72, height: 72, borderRadius: 14, overflow: "hidden", position: "relative", backgroundColor: "#F3F4F6" },
  thumb: { width: "100%", height: "100%" },
  countBadge: {
    position: "absolute", bottom: 4, right: 4,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2,
  },
  countBadgeText: { color: "#fff", fontWeight: "900", fontSize: 11 },
  rowTitle: { fontWeight: "900", fontSize: 13, color: THEME.text, lineHeight: 18 },
  rowSub: { color: THEME.subtext, fontSize: 12 },
  catBadge: { alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  catBadgeText: { fontWeight: "900", fontSize: 11 },

  emptyWrap: { alignItems: "center", justifyContent: "center", paddingVertical: 60, gap: 8 },
  emptyText: { color: THEME.subtext, fontWeight: "800", fontSize: 15 },

  previewHeader: {
    paddingHorizontal: 16, paddingBottom: 12,
    flexDirection: "row", alignItems: "center", gap: 10,
  },
  previewTitle: { fontSize: 17, fontWeight: "900", color: THEME.text },
  previewSub: { color: THEME.subtext, fontSize: 12, fontWeight: "700", marginTop: 2 },
  previewCard: {
    borderRadius: 18, borderWidth: 1, borderColor: THEME.border,
    backgroundColor: THEME.surface, overflow: "hidden",
    shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 }, elevation: 1,
  },
  previewImage: { width: "100%", aspectRatio: 4 / 3, backgroundColor: "#F3F4F6" },
  zoomHint: {
    position: "absolute", bottom: 8, right: 8,
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "rgba(0,0,0,0.45)",
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999,
  },
  zoomHintText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  actionPill: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 999, borderWidth: 1, borderColor: THEME.border, backgroundColor: THEME.soft,
  },
  actionPillDanger: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 999, borderWidth: 1, borderColor: "#FCA5A5", backgroundColor: THEME.dangerSoft,
  },

  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },
  calendarBox: {
    position: "absolute", left: 16, right: 16,
    backgroundColor: THEME.surface, borderRadius: 18,
    overflow: "hidden", borderWidth: 1, borderColor: THEME.border,
  },
  calendarHeader: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 10, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: THEME.border,
    backgroundColor: THEME.soft,
  },
  iconBtn: {
    width: 36, height: 36, borderRadius: 12,
    borderWidth: 1, borderColor: THEME.border, backgroundColor: THEME.surface,
    alignItems: "center", justifyContent: "center",
  },
  todayBtn: {
    height: 36, paddingHorizontal: 10, borderRadius: 12,
    borderWidth: 1, borderColor: "rgba(37,99,235,0.22)",
    backgroundColor: THEME.blueSoft,
    flexDirection: "row", alignItems: "center", gap: 6,
  },

  inspectWrap: { position: "absolute", left: 16, right: 16, maxHeight: "78%" },
  inspectBox: {
    backgroundColor: THEME.surface, borderRadius: 18,
    overflow: "hidden", borderWidth: 1, borderColor: THEME.border,
  },
  inspectHeader: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 12, paddingVertical: 12,
    backgroundColor: THEME.soft,
    borderBottomWidth: 1, borderBottomColor: THEME.border,
  },
  inspectSearch: {
    margin: 12, height: 44, borderWidth: 1, borderColor: THEME.border,
    borderRadius: 12, paddingHorizontal: 12,
    backgroundColor: THEME.soft,
    flexDirection: "row", alignItems: "center", gap: 8,
  },
  colHead: { fontWeight: "900", color: THEME.subtext, fontSize: 11 },
  inspectRow: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: 12, paddingHorizontal: 12,
    borderTopWidth: 1, borderTopColor: "#F3F4F6",
  },
  colCell: { fontWeight: "800", color: THEME.text, fontSize: 13 },
});
