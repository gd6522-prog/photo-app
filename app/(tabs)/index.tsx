// app/(tabs)/index.tsx
import { useFocusEffect } from "@react-navigation/native";
import { Buffer } from "buffer";
import * as Device from "expo-device";
import * as FileSystem from "expo-file-system/legacy";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
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

import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";

import { AdminRole, getAdminRole, getPendingCount } from "../../src/lib/admin";
import { useAuth } from "../../src/lib/auth";
import { SUPABASE_ANON_KEY, SUPABASE_URL, supabase } from "../../src/lib/supabase";
import { getTodayTempWorkPart } from "../../src/lib/tempWorkPart";

import { useSafeAreaInsets } from "react-native-safe-area-context";
import { searchStores } from "../../src/lib/storeMap";

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
  orangeBorder: "#FFD4B0",

  primary: "#111827",
  success: "#16A34A",

  shadow: "rgba(17,24,39,0.08)",
};

const CENTER_LAT = 37.0778566841938;
const CENTER_LNG = 126.954553958864;
const MAX_DISTANCE_M = 250;
const WEEKDAYS_KO = ["일", "월", "화", "수", "목", "금", "토"] as const;

const ALLOW_FALLBACK_CLOCK = false;
const GPS_TOTAL_TIMEOUT_MS = 22000;
const PUSH_NOTIFY_TIMEOUT_MS = 12000;
const PUSH_NOTIFY_MAX_ATTEMPTS = 3;
const TEMP_DAILY_WORK_PARTS = ["박스존", "이너존", "슬라존", "경량존", "이형존", "담배존"] as const;

type DriverProfile = { id: string; name: string; car_no: string | null };
type CarGroup = { car_no: string; drivers: DriverProfile[] };
type StoreOption = { store_code: string; store_name: string; car_no: number | null; seq_no: number | null };

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true as any,
    shouldShowList: true as any,
  }),
});

function kstNowDateString(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

function formatKSTTime(ts?: string | null) {
  if (!ts) return "-";
  const d = new Date(ts);
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const HH = String(kst.getUTCHours()).padStart(2, "0");
  const MI = String(kst.getUTCMinutes()).padStart(2, "0");
  return `${HH}:${MI}`;
}

function shiftYmd(ymd: string, days: number) {
  const [y, m, d] = ymd.split("-").map((v) => Number(v));
  if (!y || !m || !d) return ymd;
  const t = Date.UTC(y, m - 1, d) + days * 24 * 60 * 60 * 1000;
  return new Date(t).toISOString().slice(0, 10);
}

function formatKstDateLabel(ymd: string) {
  const [y, m, d] = ymd.split("-").map((v) => Number(v));
  if (!y || !m || !d) return ymd;
  const dt = new Date(Date.UTC(y, m - 1, d));
  const wd = WEEKDAYS_KO[dt.getUTCDay()];
  return `${y}.${String(m).padStart(2, "0")}.${String(d).padStart(2, "0")}(${wd})`;
}

async function uriToArrayBuffer(uri: string): Promise<{ buffer: ArrayBuffer; contentType: string }> {
  const ext = uri.split(".").pop()?.toLowerCase() ?? "";
  const isHeic = ext === "heic" || ext === "heif";

  let finalUri = uri;
  let contentType = "image/jpeg";

  if (isHeic) {
    const result = await ImageManipulator.manipulateAsync(uri, [], {
      compress: 0.9,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    finalUri = result.uri;
  } else if (ext === "png") {
    contentType = "image/png";
  } else if (ext === "webp") {
    contentType = "image/webp";
  }

  const base64 = await FileSystem.readAsStringAsync(finalUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const buf = Buffer.from(base64, "base64");
  const u8 = new Uint8Array(buf);
  return { buffer: u8.buffer, contentType };
}

function guessContentType(uri: string) {
  const ext = uri.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  return "image/jpeg";
}

function makeSafeFileName() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}.jpg`;
}

const WEB_API_URL = "https://han-admin.vercel.app";

async function uploadToR2(params: {
  buffer: ArrayBuffer;
  contentType: string;
  path: string;
  bucket: string;
  accessToken: string;
}): Promise<{ publicUrl: string; key: string }> {
  const res = await fetch(`${WEB_API_URL}/api/r2/upload-url`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.accessToken}`,
    },
    body: JSON.stringify({ bucket: params.bucket, path: params.path, contentType: params.contentType }),
  });

  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.message ?? `R2 URL 발급 실패 (${res.status})`);

  const { uploadUrl, publicUrl, key } = data;

  const upRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": params.contentType },
    body: params.buffer,
  });

  if (!upRes.ok) throw new Error(`R2 업로드 실패 (${upRes.status})`);

  return { publicUrl, key };
}

function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371000;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function withTimeout<T>(p: PromiseLike<T>, ms = 12000, label = "요청"): Promise<T> {
  return await Promise.race<T>([
    Promise.resolve(p as any) as Promise<T>,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} 시간초과`)), ms)),
  ]);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type HazardPushPayload = {
  report_id: string;
  comment: string;
  photo_url: string | null;
  created_by: string;
};

function assertPushDelivered(data: any) {
  const sent = Number((data as any)?.sent ?? 0);
  const ok = Boolean((data as any)?.ok);
  const reason = String((data as any)?.reason ?? "");
  if (ok && sent > 0) return data;
  if (reason === "no_admin_tokens") throw new Error("No admin push token.");
  throw new Error("Push was not sent.");
}

async function sendHazardPushDirect(payload: HazardPushPayload) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  };

  const res = await fetch(`${SUPABASE_URL}/functions/v1/send-hazard-push`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any)?.error || `HTTP ${res.status}`);
  return assertPushDelivered(data);
}

async function saveHazardExtraPhotos(params: {
  accessToken: string;
  reportId: string;
  photos: { photo_path: string; photo_url: string }[];
}) {
  const payload = {
    report_id: params.reportId,
    access_token: params.accessToken,
    photos: params.photos,
  };

  const invokeRes = await supabase.functions.invoke("save-hazard-report-photos", {
    body: payload,
  });
  if (!(invokeRes as any)?.error) {
    return (invokeRes as any)?.data ?? {};
  }

  const res = await fetch(`${SUPABASE_URL}/functions/v1/save-hazard-report-photos`, {
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
  return data;
}

async function sendHazardPushWithRetry(
  payload: HazardPushPayload,
  maxAttempts = PUSH_NOTIFY_MAX_ATTEMPTS
) {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const directData = await withTimeout(
        sendHazardPushDirect(payload),
        PUSH_NOTIFY_TIMEOUT_MS,
        "push notification direct"
      );
      return directData;
    } catch (directErr) {
      lastError = directErr;
    }

    try {
      const res = await withTimeout(
        supabase.functions.invoke("send-hazard-push", { body: payload }),
        PUSH_NOTIFY_TIMEOUT_MS,
        "push notification"
      );

      if ((res as any)?.error) throw (res as any).error;
      return assertPushDelivered((res as any)?.data ?? {});
    } catch (invokeErr) {
      lastError = invokeErr || lastError;
      if (attempt < maxAttempts) await sleep(500 * attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Push failed");
}

async function getPositionByWatching(ms: number, accuracy: Location.LocationAccuracy) {
  return await new Promise<Location.LocationObject>((resolve, reject) => {
    let settled = false;
    let sub: Location.LocationSubscription | null = null;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        sub?.remove();
      } catch {}
      reject(new Error("GPS_TIMEOUT"));
    }, ms);

    Location.watchPositionAsync(
      { accuracy, timeInterval: 800, distanceInterval: 0 },
      (loc) => {
        if (settled) return;
        const lat = loc.coords.latitude;
        const lng = loc.coords.longitude;
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

        settled = true;
        clearTimeout(timer);
        try {
          sub?.remove();
        } catch {}
        resolve(loc);
      }
    )
      .then((s) => {
        sub = s;
      })
      .catch((e) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(e);
      });
  });
}

async function getReliablePositionForPhoneTotalTimeout() {
  return await withTimeout(
    (async () => {
      // 1단계: 5분 이내 캐시 위치 즉시 반환 (수백ms)
      try {
        const last = await withTimeout(
          Location.getLastKnownPositionAsync({ maxAge: 5 * 60 * 1000, requiredAccuracy: 300 }),
          1500,
          "캐시 위치"
        );
        if (last?.coords) return { pos: last, source: "last_known" as const };
      } catch {}

      // 2단계: 여러 방법 병렬 시도 → 가장 먼저 성공한 것 사용
      const toResult = <S extends string>(source: S) =>
        (pos: Location.LocationObject) => ({ pos, source } as const);

      const winner = await Promise.any([
        // 저정밀도 즉시 측위 (보통 1~3초)
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Lowest })
          .then(toResult("current_lowest")),
        // 균형 정확도 워치 (위보다 느리지만 실내에서 더 잘 잡힘)
        getPositionByWatching(12000, Location.Accuracy.Balanced)
          .then(toResult("watch_balanced")),
        // 고정밀도 워치 (최후 수단)
        getPositionByWatching(18000, Location.Accuracy.High)
          .then(toResult("watch_high")),
      ]);

      return winner;
    })(),
    GPS_TOTAL_TIMEOUT_MS,
    "GPS 전체"
  );
}

/** ✅ TS 에러 해결: 위치 결과 타입 고정 */
type ClockLoc = {
  lat: number;
  lng: number;
  dist: number;
  accuracy: number | null;
  fallback: boolean;
  source: string;
};

/** ✅ work_shifts 모델로 변경 */
type AttendanceRow = {
  id: string;
  user_id: string;
  work_date: string;
  car_no: string;
  status: "open" | "closed" | "void";
  clock_in_at: string | null;
  clock_out_at: string | null;
  clock_in_lat: number | null;
  clock_in_lng: number | null;
  clock_in_accuracy_m: number | null;
  clock_in_source: string | null;
  clock_out_lat: number | null;
  clock_out_lng: number | null;
  clock_out_accuracy_m: number | null;
  clock_out_source: string | null;
  created_at: string;
  updated_at: string | null;
};

function BtnIcon({
  name,
  lib = "ion",
  color,
  size = 18,
}: {
  name: any;
  lib?: "ion" | "mci";
  color: string;
  size?: number;
}) {
  if (lib === "mci") return <MaterialCommunityIcons name={name} size={size} color={color} />;
  return <Ionicons name={name} size={size} color={color} />;
}

export default function MainMenu() {
  const router = useRouter();
  const { user } = useAuth();

  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "android"
    ? Math.max(insets.top, 40)
    : Math.max(insets.top, 12);
  const bottomPad = Platform.OS === "android"
    ? Math.max(insets.bottom, 24) + 40
    : Math.max(insets.bottom, 10) + 10;

  const [adminRole, setAdminRole] = useState<AdminRole>(null);
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [loadingAdmin, setLoadingAdmin] = useState(true);
  const isAdmin = adminRole !== null;

  const [busy, setBusy] = useState(false);
  const [displayName, setDisplayName] = useState<string>("");
  const [workPart, setWorkPart] = useState<string>("");
  const [todayTempWorkPart, setTodayTempWorkPart] = useState<string>("");

  const [hazardMenuOpen, setHazardMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportPhotos, setReportPhotos] = useState<string[]>([]);
  const [reportComment, setReportComment] = useState<string>("");
  const [reportUploading, setReportUploading] = useState(false);
  const [reportKeyboardHeight, setReportKeyboardHeight] = useState(0);
  const reportScrollRef = useRef<any>(null);

  const [attLoading, setAttLoading] = useState(false);
  const [att, setAtt] = useState<AttendanceRow | null>(null);
  const [selectedWorkDate, setSelectedWorkDate] = useState<string>(kstNowDateString());

  const [clockInConfirmOpen, setClockInConfirmOpen] = useState(false);
  const [clockOutConfirmOpen, setClockOutConfirmOpen] = useState(false);
  const [clockPhase, setClockPhase] = useState<string>("");
  const [selectedTempDailyPart, setSelectedTempDailyPart] = useState<string>("");

  // 기사 호차 관련
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [myCarNo, setMyCarNo] = useState<string | null>(null);
  const [carGroups, setCarGroups] = useState<CarGroup[]>([]);
  const [supportDrivers, setSupportDrivers] = useState<DriverProfile[]>([]);
  const [carShifts, setCarShifts] = useState<{ [userId: string]: AttendanceRow | null }>({});
  const [carLoading, setCarLoading] = useState(false);
  const [carBusy, setCarBusy] = useState(false);
  const [selectedCarNo, setSelectedCarNo] = useState<string | null>(null);
  const [carPickerOpen, setCarPickerOpen] = useState(false);
  const [supportStoreModalOpen, setSupportStoreModalOpen] = useState(false);
  const [supportStoreQuery, setSupportStoreQuery] = useState("");
  const [supportStoreResults, setSupportStoreResults] = useState<StoreOption[]>([]);
  const [supportSelectedDriver, setSupportSelectedDriver] = useState<DriverProfile | null>(null);

  const watchdogRef = useRef<any>(null);
  const startWatchdog = useCallback(
    (label: string) => {
      if (watchdogRef.current) clearTimeout(watchdogRef.current);
      watchdogRef.current = setTimeout(() => {
        setBusy(false);
        Alert.alert("처리 지연", `작업이 오래 걸려 중단했습니다.\n멈춘 단계: ${label || clockPhase || "알 수 없음"}`);
      }, 35000);
    },
    [clockPhase]
  );

  const stopWatchdog = useCallback(() => {
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  }, []);

  useEffect(() => () => stopWatchdog(), [stopWatchdog]);

  const requireSession = useCallback(async (showAlert = false) => {
    try {
      const res = await withTimeout(supabase.auth.getSession(), 12000, "세션 확인");
      if ((res as any).error) {
        if (showAlert) Alert.alert("auth error", (res as any).error.message);
        return null;
      }
      if (!(res as any).data?.session) {
        // 세션 없음 = 로그아웃 상태 → 조용히 null 반환
        return null;
      }
      return (res as any).data.session;
    } catch {
      return null;
    }
  }, []);

  const loadAdmin = useCallback(async () => {
    setLoadingAdmin(true);
    try {
      const role = (await withTimeout(getAdminRole(), 12000, "관리자 확인")) as AdminRole;
      setAdminRole(role);

      if (role) {
        const c = await withTimeout(getPendingCount(role), 12000, "승인대기 조회");
        setPendingCount(Number.isFinite(c as any) ? (c as any) : 0);
      } else {
        setPendingCount(0);
      }
    } catch {
      setAdminRole(null);
      setPendingCount(0);
    } finally {
      setLoadingAdmin(false);
    }
  }, []);

  const loadProfileName = useCallback(async () => {
    try {
      const userRes = await withTimeout(supabase.auth.getUser(), 12000, "유저 조회");
      if ((userRes as any).error) throw (userRes as any).error;

      const u = (userRes as any).data?.user;
      if (!u) {
        setDisplayName("");
        return;
      }

      const meta: any = (u as any)?.user_metadata ?? {};
      const metaName = (meta?.name || meta?.full_name || meta?.nickname || "").trim();

      const profRes = await withTimeout(
        supabase.from("profiles").select("name, work_part, car_no").eq("id", u.id).single(),
        12000,
        "프로필 조회"
      );

      const profName = ((profRes as any).data?.name ?? "").trim();
      const profWorkPart = ((profRes as any).data?.work_part ?? "").trim();
      const profCarNo = ((profRes as any).data?.car_no ?? "").trim() || null;
      setWorkPart(profWorkPart);
      setMyCarNo(profCarNo);
      setMyUserId(u.id);
      if (profWorkPart === "임시직") {
        try {
          setTodayTempWorkPart(await getTodayTempWorkPart(u.id));
        } catch {
          setTodayTempWorkPart("");
        }
      } else {
        setTodayTempWorkPart("");
      }
      if (!(profRes as any).error && profName) {
        setDisplayName(profName);
        return;
      }

      if (metaName) {
        await withTimeout(
          supabase.from("profiles").upsert({ id: u.id, name: metaName }, { onConflict: "id" }),
          12000,
          "프로필 저장"
        );
        setDisplayName(metaName);
        return;
      }

      setDisplayName("이름 미등록");
    } catch {
      const meta: any = (user as any)?.user_metadata ?? {};
      const metaName = (meta?.name || meta?.full_name || meta?.nickname || "").trim();
      const metaWorkPart = (meta?.work_part || "").trim();
      setWorkPart(metaWorkPart);
      setTodayTempWorkPart("");
      setDisplayName(metaName || "이름 미등록");
    }
  }, [user]);

  /** ✅ 선택 날짜 출퇴근 조회: work_shifts */
  const loadAttendanceForDate = useCallback(async (workDate: string, carNo: string = "") => {
    const session = await requireSession();
    if (!session) return;

    setAttLoading(true);
    try {
      const res = await withTimeout(
        supabase
          .from("work_shifts")
          .select(
            "id, user_id, work_date, car_no, status, clock_in_at, clock_out_at, clock_in_lat, clock_in_lng, clock_in_accuracy_m, clock_in_source, clock_out_lat, clock_out_lng, clock_out_accuracy_m, clock_out_source, created_at, updated_at"
          )
          .eq("user_id", session.user.id)
          .eq("work_date", workDate)
          .eq("car_no", carNo)
          .maybeSingle(),
        12000,
        "출퇴근 조회"
      );

      if ((res as any).error) throw (res as any).error;
      setAtt(((res as any).data as AttendanceRow) ?? null);
    } catch {
      setAtt(null);
    } finally {
      setAttLoading(false);
    }
  }, [requireSession]);

  const loadCarData = useCallback(async (workDate?: string) => {
    setCarLoading(true);
    try {
      const date = workDate ?? kstNowDateString();
      const driversRes = await withTimeout(
        supabase.from("profiles").select("id, name, car_no").eq("work_part", "기사").eq("approved", true),
        12000,
        "기사 조회"
      );
      const drivers: DriverProfile[] = ((driversRes as any).data ?? []).map((d: any) => ({
        id: d.id,
        name: d.name ?? "",
        car_no: d.car_no ? String(d.car_no).trim() || null : null,
      }));

      const driverIds = drivers.map((d) => d.id);
      let shiftsData: AttendanceRow[] = [];
      if (driverIds.length > 0) {
        const shiftsRes = await withTimeout(
          supabase
            .from("work_shifts")
            .select("id, user_id, work_date, car_no, status, clock_in_at, clock_out_at, clock_in_lat, clock_in_lng, clock_in_accuracy_m, clock_in_source, clock_out_lat, clock_out_lng, clock_out_accuracy_m, clock_out_source, created_at, updated_at")
            .in("user_id", driverIds)
            .eq("work_date", date),
          12000,
          "호차 출퇴근 조회"
        );
        shiftsData = (shiftsRes as any).data ?? [];
      }

      const shiftMap: { [key: string]: AttendanceRow } = {};
      for (const s of shiftsData) shiftMap[`${(s as any).user_id}:${(s as any).car_no ?? ""}`] = s as AttendanceRow;

      const groupMap: { [car: string]: DriverProfile[] } = {};
      const support: DriverProfile[] = [];
      for (const d of drivers) {
        if (d.car_no) {
          if (!groupMap[d.car_no]) groupMap[d.car_no] = [];
          groupMap[d.car_no].push(d);
        } else {
          support.push(d);
        }
      }

      const sorted: CarGroup[] = Object.entries(groupMap)
        .map(([car_no, drvs]) => ({ car_no, drivers: drvs }))
        .sort((a, b) => {
          const na = Number(a.car_no.match(/\d+/)?.[0] ?? "9999");
          const nb = Number(b.car_no.match(/\d+/)?.[0] ?? "9999");
          return na - nb;
        });

      setCarGroups(sorted);
      setSupportDrivers(support);
      setCarShifts(shiftMap);
    } catch {
      // silent
    } finally {
      setCarLoading(false);
    }
  }, []);

  const registerPushTokenForThisUser = useCallback(async () => {
    try {
      if (!Device.isDevice) return;

      const sess = await withTimeout(supabase.auth.getSession(), 12000, "세션 확인");
      const session = (sess as any).data?.session;
      if (!session?.user?.id) return;

      const { status: existing } = await Notifications.getPermissionsAsync();
      let finalStatus = existing;

      if (existing !== "granted") {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      if (finalStatus !== "granted") return;

      const tokenRes = await Notifications.getExpoPushTokenAsync();
      const token = tokenRes.data;
      if (!token) return;

      await withTimeout(
        supabase.from("profiles").upsert({ id: session.user.id, expo_push_token: token }, { onConflict: "id" }),
        12000,
        "토큰 저장"
      );
    } catch {}
  }, []);

  useEffect(() => {
    loadAdmin();
    loadProfileName();
    loadCarData(kstNowDateString());
    registerPushTokenForThisUser();
  }, [loadAdmin, loadProfileName, loadCarData, registerPushTokenForThisUser]);

  useEffect(() => {
    const carNo = workPart === "기사" ? (selectedCarNo || "") : "";
    loadAttendanceForDate(selectedWorkDate, carNo);
  }, [loadAttendanceForDate, selectedWorkDate, workPart, selectedCarNo]);

  useEffect(() => {
    if (isDriverUser) loadCarData(selectedWorkDate);
  }, [selectedWorkDate, isDriverUser, loadCarData]);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    if (!reportOpen) { setReportKeyboardHeight(0); return; }
    const show = Keyboard.addListener("keyboardDidShow", (e) => setReportKeyboardHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener("keyboardDidHide", () => setReportKeyboardHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, [reportOpen]);

  useFocusEffect(
    useCallback(() => {
      loadAdmin();
      loadProfileName();
      const carNo = workPart === "기사" ? (selectedCarNo || "") : "";
      loadAttendanceForDate(selectedWorkDate, carNo);
      loadCarData(selectedWorkDate);
      return () => {};
    }, [loadAdmin, loadAttendanceForDate, loadProfileName, loadCarData, selectedWorkDate, workPart, selectedCarNo])
  );

  const ensureTemporaryWorkerReady = () => {
    if (workPart !== "임시직") return true;
    if (activeWorkPart) return true;
    Alert.alert("출근 필요", "임시직은 출근 확인에서 오늘 근무파트를 선택한 뒤 업로드/조회를 사용할 수 있습니다.");
    return false;
  };

  const goUpload = () => {
    if (!ensureTemporaryWorkerReady()) return;
    router.push("/(tabs)/upload");
  };
  const goList = () => {
    if (!ensureTemporaryWorkerReady()) return;
    router.push("/(tabs)/photo-list");
  };
  const goHazardList = () => router.push("/(tabs)/hazard-reports");

  const onLogout = async () => {
    Alert.alert("로그아웃", "로그아웃 할까요?", [
      { text: "취소", style: "cancel" },
      {
        text: "로그아웃",
        style: "destructive",
        onPress: async () => {
          setBusy(true);
          try {
            await withTimeout(supabase.auth.signOut(), 12000, "로그아웃");
            router.replace("/(auth)/login");
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  const greetingLine = displayName
    ? `${displayName}님 오늘도 안전한 작업 부탁드립니다.`
    : "오늘도 안전한 작업 부탁드립니다.";

  const openReport = () => {
    Keyboard.dismiss();
    setReportComment("");
    setReportPhotos([]);
    setReportOpen(true);
  };

  const takeReportPhoto = async () => {
    Keyboard.dismiss();

    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("권한 필요", "카메라 권한을 허용해주세요.");
      return;
    }

    const shot = await ImagePicker.launchCameraAsync({
      quality: 0.9,
      allowsEditing: false,
    });

    if (shot.canceled) return;
    const uri = shot.assets?.[0]?.uri ?? "";
    if (!uri) return;

    setReportPhotos((prev) => [...prev, uri]);
  };

  const pickReportPhotoFromGallery = async () => {
    Keyboard.dismiss();

    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("권한 필요", "갤러리 접근 권한을 허용해주세요.");
      return;
    }

    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      selectionLimit: 0,
      quality: 0.9,
    });

    if (picked.canceled) return;
    const uris = (picked.assets ?? []).map((a) => a.uri).filter(Boolean);
    if (uris.length === 0) return;
    setReportPhotos((prev) => [...prev, ...uris]);
  };

  const removePhotoAt = (idx: number) => {
    Keyboard.dismiss();
    setReportPhotos((prev) => prev.filter((_, i) => i !== idx));
  };

  const submitReport = async () => {
    if (reportUploading) return;

    Keyboard.dismiss();

    const sessRes = await withTimeout(supabase.auth.getSession(), 12000, "세션 확인");
    if ((sessRes as any).error || !(sessRes as any).data?.session) {
      Alert.alert("로그인 필요", "세션이 없습니다. 로그인 후 다시 시도하세요.");
      return;
    }

    if (reportPhotos.length === 0) {
      Alert.alert("사진 필요", "위험요인 사진을 1장 이상 촬영해주세요.");
      return;
    }

    const comment = reportComment.trim();
    if (comment.length < 2) {
      Alert.alert("코멘트 필요", "코멘트를 2글자 이상 작성해주세요.");
      return;
    }

    setReportUploading(true);
    let createdReportId = "";
    const uploadedPaths: string[] = [];
    try {
      const session = (sessRes as any).data.session;
      const userId = session.user.id;
      const accessToken = String(session.access_token ?? "").trim();
      const day = kstNowDateString();

      const firstUri = reportPhotos[0];
      const firstName = makeSafeFileName();
      const firstPath = `${day}/${userId}/${firstName}`;

      const { buffer: firstAb, contentType: firstType } = await uriToArrayBuffer(firstUri);

      const { publicUrl: firstUrl } = await withTimeout(
        uploadToR2({ buffer: firstAb, contentType: firstType, path: firstPath, bucket: "hazard-reports", accessToken }),
        20000,
        "사진 업로드"
      );
      uploadedPaths.push(firstPath);

      const insRepRes = await withTimeout(
        supabase
          .from("hazard_reports")
          .insert({
            user_id: userId,
            comment,
            photo_path: firstPath,
            photo_url: firstUrl,
          })
          .select("id")
          .single(),
        12000,
        "제보 저장"
      );
      if ((insRepRes as any).error) throw (insRepRes as any).error;

      const reportId = (insRepRes as any).data?.id as string;
      if (!reportId) throw new Error("report id 생성 실패");
      createdReportId = reportId;

      if (reportPhotos.length > 1) {
        const extraRows: Array<{ report_id: string; photo_path: string; photo_url: string }> = [];

        for (const uri of reportPhotos.slice(1)) {
          const name = makeSafeFileName();
          const path = `${day}/${userId}/${name}`;
          const { buffer: ab, contentType } = await uriToArrayBuffer(uri);

          const { publicUrl: photoUrl } = await withTimeout(
            uploadToR2({ buffer: ab, contentType, path, bucket: "hazard-reports", accessToken }),
            20000,
            "추가 사진 업로드"
          );

          uploadedPaths.push(path);
          extraRows.push({
            report_id: reportId,
            photo_path: path,
            photo_url: photoUrl,
          });
        }

        if (extraRows.length > 0) {
          await withTimeout(
            saveHazardExtraPhotos({
              accessToken,
              reportId,
              photos: extraRows,
            }),
            12000,
            "추가 사진 저장"
          );
        }
      }

      let pushFailed = false;
      let pushErrorMsg = "";
      try {
        await sendHazardPushWithRetry({
          report_id: reportId,
          comment,
          photo_url: firstUrl,
          created_by: userId,
        });
      } catch (pushErr: any) {
        pushFailed = true;
        pushErrorMsg = String(pushErr?.message ?? pushErr ?? "").trim();
        console.warn("[hazard-push] failed", pushErrorMsg);
      }

      if (pushFailed) {
        Alert.alert(
          "Report Saved",
          `Report was saved, but admin push notification failed.${pushErrorMsg ? `\n\nReason: ${pushErrorMsg}` : ""}`
        );
      } else {
        const reporterName = (displayName || "제보자").trim();
        Alert.alert("위험요인 제보 성공", `${reporterName}님 위험요인 제보 감사합니다.`);
      }
      setReportOpen(false);
      setReportPhotos([]);
      setReportComment("");
    } catch (e: any) {
      if (createdReportId) {
        try {
          await supabase.from("hazard_reports").delete().eq("id", createdReportId);
        } catch {}
      }
      // R2 파일 롤백은 서버에서 처리 (클라이언트에서는 생략)
      Alert.alert("제보 실패", e?.message ?? String(e));
    } finally {
      setReportUploading(false);
    }
  };

  /** ✅ TS 에러 해결: 반환 타입 명시 */
  const getCurrentLocationChecked = useCallback(async (): Promise<ClockLoc | null> => {
    try {
      setClockPhase("위치 서비스 확인");
      const enabled = await withTimeout(Location.hasServicesEnabledAsync(), 6000, "위치 서비스 확인");
      if (!enabled) {
        Alert.alert("위치 서비스 꺼짐", "휴대폰 설정에서 위치(GPS)를 켜고 다시 시도해주세요.");
        return null;
      }

      setClockPhase("권한 확인");
      const perm = await withTimeout(Location.getForegroundPermissionsAsync(), 8000, "권한 확인");
      let status = (perm as any).status;

      if (status !== "granted") {
        setClockPhase("권한 요청");
        const req = await withTimeout(Location.requestForegroundPermissionsAsync(), 8000, "권한 요청");
        status = (req as any).status;
      }

      if (status !== "granted") {
        Alert.alert(
          "권한 필요",
          "출퇴근 처리를 위해 위치 권한을 허용해주세요.\n(설정 > 개인정보 보호 > 위치서비스 > 앱 > 앱을 사용하는 동안 + 정확한 위치)",
          [
            { text: "닫기", style: "cancel" },
            { text: "설정 열기", onPress: () => Linking.openSettings() },
          ]
        );
        return null;
      }

      setClockPhase("위치 확인");
      let result: any = null;
      try {
        result = await getReliablePositionForPhoneTotalTimeout();
      } catch {
        result = null;
      }

      if (!result?.pos?.coords) {
        if (ALLOW_FALLBACK_CLOCK) {
          return {
            lat: CENTER_LAT,
            lng: CENTER_LNG,
            dist: 0,
            accuracy: null,
            fallback: true,
            source: "fallback_center",
          };
        }
        Alert.alert("위치 실패", "GPS를 가져오지 못했습니다. 창가/야외로 이동 후 다시 시도해주세요.");
        return null;
      }

      // GPS 조작(Mock Location) 감지 — Android 전용
      if ((result.pos as any).mocked === true) {
        Alert.alert(
          "GPS 조작 감지",
          "위치 조작 앱 사용이 감지되었습니다.\nGPS 조작 앱을 끄고 다시 시도해주세요."
        );
        return null;
      }

      const lat = result.pos.coords.latitude;
      const lng = result.pos.coords.longitude;
      const accuracy = typeof result.pos.coords.accuracy === "number" ? result.pos.coords.accuracy : null;

      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        if (ALLOW_FALLBACK_CLOCK) {
          return {
            lat: CENTER_LAT,
            lng: CENTER_LNG,
            dist: 0,
            accuracy: null,
            fallback: true,
            source: "fallback_center",
          };
        }
        Alert.alert("위치 오류", "현재 위치 좌표가 올바르지 않습니다. 다시 시도해주세요.");
        return null;
      }

      setClockPhase("거리 계산");
      const dist = distanceMeters(lat, lng, CENTER_LAT, CENTER_LNG);
      if (!Number.isFinite(dist)) {
        if (ALLOW_FALLBACK_CLOCK) {
          return {
            lat: CENTER_LAT,
            lng: CENTER_LNG,
            dist: 0,
            accuracy: null,
            fallback: true,
            source: "fallback_center",
          };
        }
        Alert.alert("위치 오류", "현재 위치를 계산할 수 없습니다. 다시 시도해주세요.");
        return null;
      }

      if (dist > MAX_DISTANCE_M) {
        Alert.alert("범위 밖", "센터 범위 밖에서는 출퇴근 처리할 수 없습니다.");
        return null;
      }

      return {
        lat,
        lng,
        dist,
        accuracy,
        fallback: false,
        source: String(result.source || "gps"),
      };
    } catch (e: any) {
      if (ALLOW_FALLBACK_CLOCK) {
        return {
          lat: CENTER_LAT,
          lng: CENTER_LNG,
          dist: 0,
          accuracy: null,
          fallback: true,
          source: "fallback_center",
        };
      }
      Alert.alert("위치 실패", e?.message ?? String(e));
      return null;
    }
  }, []);

  /** ✅ 출근: work_shifts + work_events */
  const doClockIn = useCallback(async () => {
    if (busy) return;

    const session = await requireSession();
    if (!session) return;

    if (att?.clock_in_at) {
      Alert.alert("안내", `이미 출근 처리됨 (${formatKSTTime(att.clock_in_at)})`);
      return;
    }

    setBusy(true);
    setClockPhase("시작");
    startWatchdog("시작");

    try {
      setClockPhase("위치 확인");
      startWatchdog("위치 확인");
      const loc = await getCurrentLocationChecked();
      if (!loc) return;

      const nowIso = new Date().toISOString();
      const workDate = kstNowDateString();
      const source = loc.source ?? (loc.fallback ? "fallback_center" : "gps");

      setClockPhase("서버 저장");
      startWatchdog("서버 저장");

      const clockInCarNo = isDriverUser ? (selectedCarNo || "") : "";
      const res = await withTimeout(
        supabase
          .from("work_shifts")
          .upsert(
            {
              user_id: session.user.id,
              work_date: workDate,
              car_no: clockInCarNo,
              status: "open",
              clock_in_at: nowIso,
              clock_in_lat: loc.lat,
              clock_in_lng: loc.lng,
              clock_in_accuracy_m: loc.accuracy ?? null,
              clock_in_source: source,
            },
            { onConflict: "user_id,work_date" }
          )
          .select(
            "id, user_id, work_date, car_no, status, clock_in_at, clock_out_at, clock_in_lat, clock_in_lng, clock_in_accuracy_m, clock_in_source, clock_out_lat, clock_out_lng, clock_out_accuracy_m, clock_out_source, created_at, updated_at"
          )
          .single(),
        12000,
        "출근 저장"
      );

      if ((res as any).error) throw (res as any).error;

      try {
        await withTimeout(
          supabase.from("work_events").insert({
            shift_id: (res as any).data?.id,
            user_id: session.user.id,
            event_type: "clock_in",
            occurred_at: nowIso,
            lat: loc.lat,
            lng: loc.lng,
            accuracy_m: loc.accuracy ?? null,
            source,
            payload: {
              work_date: workDate,
              today_work_part: isTemporaryWorker ? selectedTempDailyPart || null : null,
            },
          }),
          12000,
          "출근 이벤트"
        );
      } catch {}

      setClockPhase("완료");
      setAtt(((res as any).data as AttendanceRow) ?? null);
      if (isTemporaryWorker && selectedTempDailyPart) setTodayTempWorkPart(selectedTempDailyPart);
      setSelectedTempDailyPart("");

      Alert.alert(`${clockInLabel} 완료`, `${clockInLabel}: ${formatKSTTime(nowIso)}`);
      loadAttendanceForDate(selectedWorkDate, isDriverUser ? (selectedCarNo || "") : "").catch(() => {});
    } catch (e: any) {
      Alert.alert("출근 실패", e?.message ?? String(e));
    } finally {
      stopWatchdog();
      setBusy(false);
      setTimeout(() => setClockPhase(""), 500);
    }
  }, [att, busy, clockInLabel, getCurrentLocationChecked, isDriverUser, isTemporaryWorker, requireSession, loadAttendanceForDate, selectedCarNo, selectedTempDailyPart, selectedWorkDate, startWatchdog, stopWatchdog]);

  /** ✅ 퇴근: work_shifts + work_events */
  const doClockOut = useCallback(async () => {
    if (busy) return;

    const session = await requireSession();
    if (!session) return;

    const latest = att;

    if (!latest?.clock_in_at) {
      Alert.alert("안내", "출근 기록이 없어서 퇴근할 수 없습니다.");
      return;
    }

    if (latest?.clock_out_at) {
      Alert.alert("안내", `이미 퇴근 처리됨 (${formatKSTTime(latest.clock_out_at)})`);
      return;
    }

    setBusy(true);
    setClockPhase("시작");
    startWatchdog("시작");

    try {
      setClockPhase("위치 확인");
      startWatchdog("위치 확인");
      const loc = await getCurrentLocationChecked();
      if (!loc) return;

      const nowIso = new Date().toISOString();
      const workDate = kstNowDateString();
      const source = loc.source ?? (loc.fallback ? "fallback_center" : "gps");

      setClockPhase("서버 저장");
      startWatchdog("서버 저장");

      const clockOutCarNo = isDriverUser ? (selectedCarNo || "") : "";
      const res = await withTimeout(
        supabase
          .from("work_shifts")
          .upsert(
            {
              user_id: session.user.id,
              work_date: workDate,
              car_no: clockOutCarNo,
              status: "closed",
              clock_out_at: nowIso,
              clock_out_lat: loc.lat,
              clock_out_lng: loc.lng,
              clock_out_accuracy_m: loc.accuracy ?? null,
              clock_out_source: source,
            },
            { onConflict: "user_id,work_date" }
          )
          .select(
            "id, user_id, work_date, car_no, status, clock_in_at, clock_out_at, clock_in_lat, clock_in_lng, clock_in_accuracy_m, clock_in_source, clock_out_lat, clock_out_lng, clock_out_accuracy_m, clock_out_source, created_at, updated_at"
          )
          .single(),
        12000,
        "퇴근 저장"
      );

      if ((res as any).error) throw (res as any).error;

      try {
        await withTimeout(
          supabase.from("work_events").insert({
            shift_id: (res as any).data?.id,
            user_id: session.user.id,
            event_type: "clock_out",
            occurred_at: nowIso,
            lat: loc.lat,
            lng: loc.lng,
            accuracy_m: loc.accuracy ?? null,
            source,
            payload: { work_date: workDate },
          }),
          12000,
          "퇴근 이벤트"
        );
      } catch {}

      setClockPhase("완료");
      setAtt(((res as any).data as AttendanceRow) ?? null);
      if (isTemporaryWorker) setTodayTempWorkPart("");

      Alert.alert(`${clockOutLabel} 완료`, `${clockOutLabel}: ${formatKSTTime(nowIso)}`);
      loadAttendanceForDate(selectedWorkDate, isDriverUser ? (selectedCarNo || "") : "").catch(() => {});
    } catch (e: any) {
      Alert.alert("퇴근 실패", e?.message ?? String(e));
    } finally {
      stopWatchdog();
      setBusy(false);
      setTimeout(() => setClockPhase(""), 500);
    }
  }, [att, busy, clockOutLabel, getCurrentLocationChecked, isDriverUser, isTemporaryWorker, requireSession, loadAttendanceForDate, selectedCarNo, selectedWorkDate, startWatchdog, stopWatchdog]);

  const doCarClockIn = useCallback(async (group: CarGroup, workDate: string) => {
    if (carBusy) return;
    const session = await requireSession();
    if (!session) return;
    setCarBusy(true);
    try {
      const nowIso = new Date().toISOString();
      const unclocked = group.drivers.filter((d) => !carShifts[`${d.id}:${group.car_no}`]?.clock_in_at);
      if (unclocked.length === 0) { Alert.alert("안내", "이미 모두 입차 처리되었습니다."); return; }
      for (const driver of unclocked) {
        await withTimeout(
          supabase.from("work_shifts").upsert(
            { user_id: driver.id, work_date: workDate, car_no: group.car_no, status: "open", clock_in_at: nowIso, clock_in_source: "vehicle" },
            { onConflict: "user_id,work_date" }
          ),
          12000, "입차 저장"
        );
      }
      Alert.alert("입차 완료", `${group.car_no} 입차 처리 (${unclocked.length}명)`);
      await loadCarData();
    } catch (e: any) {
      Alert.alert("입차 실패", e?.message ?? String(e));
    } finally {
      setCarBusy(false);
    }
  }, [carBusy, carShifts, loadCarData, requireSession]);

  const doCarClockOut = useCallback(async (group: CarGroup, workDate: string) => {
    if (carBusy) return;
    const session = await requireSession();
    if (!session) return;
    setCarBusy(true);
    try {
      const nowIso = new Date().toISOString();
      const toOut = group.drivers.filter((d) => carShifts[`${d.id}:${group.car_no}`]?.clock_in_at && !carShifts[`${d.id}:${group.car_no}`]?.clock_out_at);
      if (toOut.length === 0) { Alert.alert("안내", "출차할 인원이 없습니다."); return; }
      for (const driver of toOut) {
        await withTimeout(
          supabase.from("work_shifts").upsert(
            { user_id: driver.id, work_date: workDate, car_no: group.car_no, status: "closed", clock_out_at: nowIso, clock_out_source: "vehicle" },
            { onConflict: "user_id,work_date" }
          ),
          12000, "출차 저장"
        );
      }
      Alert.alert("출차 완료", `${group.car_no} 출차 처리 (${toOut.length}명)`);
      await loadCarData();
    } catch (e: any) {
      Alert.alert("출차 실패", e?.message ?? String(e));
    } finally {
      setCarBusy(false);
    }
  }, [carBusy, carShifts, loadCarData, requireSession]);

  const doSupportClockIn = useCallback(async (driver: DriverProfile, store: StoreOption) => {
    if (carBusy) return;
    const session = await requireSession();
    if (!session) return;
    setCarBusy(true);
    try {
      const nowIso = new Date().toISOString();
      const workDate = kstNowDateString();
      await withTimeout(
        supabase.from("work_shifts").upsert(
          { user_id: driver.id, work_date: workDate, car_no: "", status: "open", clock_in_at: nowIso, clock_in_source: `support:${store.store_code}` },
          { onConflict: "user_id,work_date" }
        ),
        12000, "지원 입차 저장"
      );
      Alert.alert("지원 입차 완료", `${driver.name} - ${store.store_name}`);
      setSupportStoreModalOpen(false);
      setSupportStoreQuery("");
      setSupportStoreResults([]);
      setSupportSelectedDriver(null);
      await loadCarData();
    } catch (e: any) {
      Alert.alert("지원 입차 실패", e?.message ?? String(e));
    } finally {
      setCarBusy(false);
    }
  }, [carBusy, loadCarData, requireSession]);

  const onClockIn = () => {
    if (busy) return;
    if (att?.clock_in_at) {
      Alert.alert("안내", `이미 출근 처리됨 (${formatKSTTime(att.clock_in_at)})`);
      return;
    }
    setSelectedTempDailyPart("");
    setClockInConfirmOpen(true);
  };

  const onClockOut = () => {
    if (busy) return;
    if (!att?.clock_in_at) {
      Alert.alert("안내", "출근 기록이 없어서 퇴근할 수 없습니다.");
      return;
    }
    if (att?.clock_out_at) {
      Alert.alert("안내", `이미 퇴근 처리됨 (${formatKSTTime(att.clock_out_at)})`);
      return;
    }
    setClockOutConfirmOpen(true);
  };

  const approveRowVisible = useMemo(() => !loadingAdmin && isAdmin, [loadingAdmin, isAdmin]);
  const isDriverUser = useMemo(() => workPart === "기사", [workPart]);

  // 내 호차 자동 선택
  useEffect(() => {
    if (isDriverUser && myCarNo && selectedCarNo === null) {
      const myNums = myCarNo.match(/\d+/g)?.filter((n) => n.length >= 2) ?? [];
      if (myNums.length > 0) setSelectedCarNo(myNums[0]);
    }
  }, [isDriverUser, myCarNo, selectedCarNo]);
  const isTemporaryWorker = useMemo(() => workPart === "임시직", [workPart]);
  const activeWorkPart = useMemo(
    () => (isTemporaryWorker ? (todayTempWorkPart || "").trim() : (workPart || "").trim()),
    [isTemporaryWorker, todayTempWorkPart, workPart]
  );
  const clockInLabel = isDriverUser ? "입차" : "출근";
  const clockOutLabel = isDriverUser ? "출차" : "퇴근";
  const todayStr = kstNowDateString();
  const selectedDateLabel = useMemo(() => formatKstDateLabel(selectedWorkDate), [selectedWorkDate]);
  const isViewingToday = selectedWorkDate === todayStr;
  const canGoNextDay = selectedWorkDate < todayStr;

  const ActionButton = ({
    onPress,
    disabled,
    icon,
    iconLib = "ion",
    title,
    variant,
  }: {
    onPress: () => void;
    disabled?: boolean;
    icon: any;
    iconLib?: "ion" | "mci";
    title: string;
    variant: "primary" | "outline" | "orangeSoft" | "orangeOutline" | "dangerOutline" | "success";
  }) => {
    const v =
      variant === "primary"
        ? styles.btnPrimary
        : variant === "outline"
        ? styles.btnOutline
        : variant === "orangeSoft"
        ? styles.btnOrangeSoft
        : variant === "orangeOutline"
        ? styles.btnOrangeOutline
        : variant === "dangerOutline"
        ? styles.btnDangerOutline
        : styles.btnSuccess;

    const textStyle =
      variant === "primary" || variant === "success"
        ? styles.btnTextWhite
        : variant === "dangerOutline"
        ? styles.btnTextDanger
        : variant === "orangeSoft" || variant === "orangeOutline"
        ? styles.btnTextOrange
        : styles.btnText;

    const iconColor =
      variant === "primary" || variant === "success"
        ? "#fff"
        : variant === "dangerOutline"
        ? "#DC2626"
        : variant === "orangeSoft" || variant === "orangeOutline"
        ? THEME.orange
        : THEME.text;

    return (
      <Pressable onPress={onPress} disabled={disabled} style={[styles.btn, v, disabled && styles.btnDisabled]}>
        <View style={styles.btnInner}>
          <BtnIcon lib={iconLib} name={icon} color={iconColor} size={18} />
          <Text style={textStyle}>{title}</Text>
        </View>
      </Pressable>
    );
  };

  // 출퇴근 상태 계산
  const attStatusInfo = (() => {
    if (isDriverUser && selectedCarNo && selectedCarNo !== "지원") {
      const group = carGroups.find((g) => g.car_no === selectedCarNo || (g.car_no.match(/\d+/g) ?? []).includes(selectedCarNo));
      if (group) {
        const allIn = group.drivers.every((d) => !!carShifts[`${d.id}:${group.car_no}`]?.clock_in_at);
        const allOut = group.drivers.every((d) => !!carShifts[`${d.id}:${group.car_no}`]?.clock_out_at);
        if (allOut) return { label: "출차 완료", color: THEME.subtext, bg: THEME.soft };
        if (allIn) return { label: "입차 중", color: "#16A34A", bg: "#ECFDF3" };
        return { label: "미입차", color: THEME.muted, bg: THEME.bg };
      }
    }
    if (att?.clock_out_at) return { label: isDriverUser ? "출차 완료" : "퇴근 완료", color: THEME.subtext, bg: THEME.soft };
    if (att?.clock_in_at) return { label: isDriverUser ? "입차 중" : "출근 중", color: "#16A34A", bg: "#ECFDF3" };
    return { label: isDriverUser ? "미입차" : "미출근", color: THEME.muted, bg: THEME.bg };
  })();

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        bounces={false}
        alwaysBounceVertical={false}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: bottomPad }}
      >
        <Pressable onPress={() => Keyboard.dismiss()}>

          {/* ── 상단 헤더 배너 ── */}
          <View style={[styles.heroBanner, Platform.OS === "android" && { paddingTop: topPad + 8 }]}>
            <View style={styles.heroTop}>
              <Image source={require("../../assets/hanexpress-logo.png")} style={styles.heroLogo} />
              <Pressable onPress={onLogout} disabled={busy} style={styles.heroLogoutBtn}>
                <Ionicons name="log-out-outline" size={14} color="#9CA3AF" />
                <Text style={styles.heroLogoutText}>로그아웃</Text>
              </Pressable>
            </View>
            <View style={styles.heroBottom}>
              <View style={{ flex: 1 }}>
                {displayName
                  ? <Text style={styles.heroName} numberOfLines={1}>{displayName}님</Text>
                  : null}
                <Text style={styles.heroGreeting} numberOfLines={1}>오늘도 안전한 작업 부탁드립니다.</Text>
                <Text style={styles.heroDate}>{selectedDateLabel}</Text>
              </View>
              {activeWorkPart ? (
                <View style={styles.workPartChip}>
                  <Text style={styles.workPartChipText}>{activeWorkPart}</Text>
                </View>
              ) : null}
            </View>
          </View>

          <View style={styles.mainContent}>

            {/* ── 출퇴근 카드 ── */}
            <View style={styles.attCard}>
              {/* 카드 헤더 */}
              <View style={styles.attCardHeader}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <View style={styles.attCardIconWrap}>
                    <MaterialCommunityIcons name={isDriverUser ? "truck-outline" : "clock-outline"} size={16} color="#fff" />
                  </View>
                  <Text style={styles.attCardTitle}>{isDriverUser ? "입출차 관리" : "출퇴근 관리"}</Text>
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <View style={[styles.attStatusChip, { backgroundColor: attStatusInfo.bg }]}>
                    <Text style={[styles.attStatusText, { color: attStatusInfo.color }]}>{attStatusInfo.label}</Text>
                  </View>
                  {isDriverUser && (
                    <Pressable onPress={() => setCarPickerOpen(true)} disabled={carBusy} style={styles.carPill}>
                      <MaterialCommunityIcons name="truck-outline" size={13} color={THEME.subtext} />
                      <Text style={styles.carPillText}>
                        {selectedCarNo === "지원" ? "지원" : selectedCarNo ? `${selectedCarNo}호` : "호차"}
                      </Text>
                      <Ionicons name="chevron-down" size={11} color={THEME.muted} />
                    </Pressable>
                  )}
                </View>
              </View>

              {/* 날짜 네비게이션 */}
              <View style={styles.dateNav}>
                <Pressable onPress={() => setSelectedWorkDate((p) => shiftYmd(p, -1))} disabled={busy || carBusy} style={[styles.dateNavArrow, (busy || carBusy) && { opacity: 0.4 }]}>
                  <Ionicons name="chevron-back" size={20} color={THEME.subtext} />
                </Pressable>
                <Text style={styles.dateNavText}>{selectedDateLabel}</Text>
                <Pressable onPress={() => setSelectedWorkDate((p) => shiftYmd(p, +1))} disabled={busy || carBusy || !canGoNextDay} style={[styles.dateNavArrow, (busy || carBusy || !canGoNextDay) && { opacity: 0.4 }]}>
                  <Ionicons name="chevron-forward" size={20} color={THEME.subtext} />
                </Pressable>
              </View>

              {/* 기사: 호차 기사 목록 */}
              {isDriverUser && selectedCarNo && selectedCarNo !== "지원" && (() => {
                const group = carGroups.find((g) => g.car_no === selectedCarNo || (g.car_no.match(/\d+/g) ?? []).includes(selectedCarNo));
                if (!group) return null;
                return (
                  <View style={styles.driverList}>
                    {group.drivers.map((driver) => {
                      const sh = carShifts[`${driver.id}:${group.car_no}`];
                      return (
                        <View key={driver.id} style={styles.driverRow}>
                          <View style={styles.driverAvatar}>
                            <Text style={styles.driverAvatarText}>{driver.name.charAt(0)}</Text>
                          </View>
                          <Text style={styles.driverName}>{driver.name}</Text>
                          <View style={{ flex: 1 }} />
                          <Text style={styles.driverTime}>입 {sh?.clock_in_at ? formatKSTTime(sh.clock_in_at) : "--:--"}</Text>
                          <Text style={styles.driverTimeSep}>/</Text>
                          <Text style={styles.driverTime}>출 {sh?.clock_out_at ? formatKSTTime(sh.clock_out_at) : "--:--"}</Text>
                        </View>
                      );
                    })}
                  </View>
                );
              })()}

              {/* 기사: 지원 목록 */}
              {isDriverUser && selectedCarNo === "지원" && (
                <View style={styles.driverList}>
                  {supportDrivers.length === 0 ? (
                    <Text style={styles.helper}>등록된 지원 기사가 없습니다.</Text>
                  ) : (
                    supportDrivers.map((driver) => {
                      const sh = carShifts[`${driver.id}:`];
                      return (
                        <View key={driver.id} style={styles.driverRow}>
                          <View style={styles.driverAvatar}>
                            <Text style={styles.driverAvatarText}>{driver.name.charAt(0)}</Text>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.driverName}>{driver.name}</Text>
                            <Text style={styles.helper}>{sh?.clock_in_at ? `입차 ${formatKSTTime(sh.clock_in_at)}` : "미입차"}</Text>
                          </View>
                          {!sh?.clock_in_at && (
                            <Pressable onPress={() => { setSupportSelectedDriver(driver); setSupportStoreQuery(""); setSupportStoreResults([]); setSupportStoreModalOpen(true); }} disabled={carBusy} style={[styles.supportBtn, carBusy && { opacity: 0.5 }]}>
                              <Text style={styles.supportBtnText}>점포 지정</Text>
                            </Pressable>
                          )}
                        </View>
                      );
                    })
                  )}
                </View>
              )}

              {/* 입차/출차 버튼 */}
              {(() => {
                const mkInBtn = (onPress: () => void, disabled: boolean, doneTime: string | null | undefined, label: string) => (
                  <Pressable onPress={onPress} disabled={disabled} style={[styles.punchBtn, doneTime ? styles.punchBtnDone : styles.punchBtnIn, disabled && !doneTime && { opacity: 0.5 }]}>
                    {doneTime
                      ? <><Text style={styles.punchBtnLabel}>{label === clockInLabel ? (isDriverUser ? "입차" : "출근") : (isDriverUser ? "출차" : "퇴근")}</Text><Text style={styles.punchBtnTime}>{formatKSTTime(doneTime)}</Text></>
                      : <><MaterialCommunityIcons name="login" size={20} color="#15803D" /><Text style={styles.punchBtnIdle}>{label}</Text></>
                    }
                  </Pressable>
                );
                const mkOutBtn = (onPress: () => void, disabled: boolean, doneTime: string | null | undefined, label: string) => (
                  <Pressable onPress={onPress} disabled={disabled} style={[styles.punchBtn, doneTime ? styles.punchBtnDone : styles.punchBtnOut, disabled && !doneTime && { opacity: 0.5 }]}>
                    {doneTime
                      ? <><Text style={styles.punchBtnLabel}>{label === clockOutLabel ? (isDriverUser ? "출차" : "퇴근") : (isDriverUser ? "출차" : "퇴근")}</Text><Text style={styles.punchBtnTime}>{formatKSTTime(doneTime)}</Text></>
                      : <><MaterialCommunityIcons name="logout" size={20} color="#1D4ED8" /><Text style={styles.punchBtnIdle}>{label}</Text></>
                    }
                  </Pressable>
                );

                if (isDriverUser && selectedCarNo && selectedCarNo !== "지원") {
                  const group = carGroups.find((g) => g.car_no === selectedCarNo || (g.car_no.match(/\d+/g) ?? []).includes(selectedCarNo));
                  if (!group) {
                    return (
                      <View style={styles.punchRow}>
                        {mkInBtn(onClockIn, busy || !isViewingToday || !!att?.clock_in_at, att?.clock_in_at, clockInLabel)}
                        {mkOutBtn(onClockOut, busy || !isViewingToday || !att?.clock_in_at || !!att?.clock_out_at, att?.clock_out_at, clockOutLabel)}
                      </View>
                    );
                  }
                  const allIn = group.drivers.every((d) => !!carShifts[`${d.id}:${group.car_no}`]?.clock_in_at);
                  const anyIn = group.drivers.some((d) => !!carShifts[`${d.id}:${group.car_no}`]?.clock_in_at);
                  const allOut = group.drivers.every((d) => !!carShifts[`${d.id}:${group.car_no}`]?.clock_out_at);
                  const firstInDriver = group.drivers.find((d) => carShifts[`${d.id}:${group.car_no}`]?.clock_in_at);
                  const firstOutDriver = group.drivers.find((d) => carShifts[`${d.id}:${group.car_no}`]?.clock_out_at);
                  return (
                    <View style={styles.punchRow}>
                      {mkInBtn(() => doCarClockIn(group, selectedWorkDate), carBusy || allIn, allIn ? (firstInDriver ? carShifts[`${firstInDriver.id}:${group.car_no}`]?.clock_in_at : null) : null, "입차")}
                      {mkOutBtn(() => doCarClockOut(group, selectedWorkDate), carBusy || !anyIn || allOut, allOut ? (firstOutDriver ? carShifts[`${firstOutDriver.id}:${group.car_no}`]?.clock_out_at : null) : null, "출차")}
                    </View>
                  );
                }
                return (
                  <View style={styles.punchRow}>
                    {mkInBtn(onClockIn, busy || !isViewingToday || !!att?.clock_in_at, att?.clock_in_at, clockInLabel)}
                    {mkOutBtn(onClockOut, busy || !isViewingToday || !att?.clock_in_at || !!att?.clock_out_at, att?.clock_out_at, clockOutLabel)}
                  </View>
                );
              })()}

              {(attLoading || (isDriverUser && carLoading)) && (
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingTop: 4 }}>
                  <ActivityIndicator size="small" color={THEME.muted} />
                  <Text style={styles.helper}>{isDriverUser ? "호차 정보 불러오는 중..." : "출퇴근 정보 불러오는 중..."}</Text>
                </View>
              )}
            </View>

            {/* ── 가입/차량 신청 승인 (관리자) ── */}
            {approveRowVisible && (
              <Pressable onPress={() => router.push("/(tabs)/approve")} disabled={busy} style={[styles.approveCard, busy && { opacity: 0.6 }]}>
                <View style={styles.approveCardLeft}>
                  <View style={styles.approveCardIcon}>
                    <Ionicons name="shield-checkmark" size={18} color="#fff" />
                  </View>
                  <View>
                    <Text style={styles.approveCardTitle}>가입/차량 신청 승인 관리</Text>
                    <Text style={styles.approveCardSub}>
                      {adminRole === "main"
                        ? "가입 · 기기초기화 · 정기신청"
                        : adminRole === "center"
                          ? "정기신청 승인 대기"
                          : "가입 · 기기초기화"}
                    </Text>
                  </View>
                </View>
                <View style={[styles.approveCardBadge, pendingCount > 0 ? styles.approveCardBadgeHot : styles.approveCardBadgeIdle]}>
                  <Text style={[styles.approveCardBadgeText, pendingCount > 0 && { color: "#fff" }]}>{pendingCount}</Text>
                </View>
              </Pressable>
            )}

            {/* ── 기능 버튼 그리드 ── */}
            <View style={styles.actionGrid}>
              <Pressable onPress={goUpload} disabled={busy} style={[styles.actionCell, styles.actionCellPrimary, busy && { opacity: 0.6 }]}>
                <View style={[styles.actionCellIconWrap, { backgroundColor: "rgba(255,255,255,0.2)" }]}>
                  <Ionicons name="cloud-upload-outline" size={24} color="#fff" />
                </View>
                <Text style={[styles.actionCellTitle, { color: "#fff" }]}>업로드</Text>
                <Text style={[styles.actionCellSub, { color: "rgba(255,255,255,0.75)" }]}>사진 업로드</Text>
              </Pressable>

              <Pressable onPress={goList} disabled={busy} style={[styles.actionCell, styles.actionCellOutline, busy && { opacity: 0.6 }]}>
                <View style={[styles.actionCellIconWrap, { backgroundColor: THEME.soft }]}>
                  <Ionicons name="search-outline" size={24} color={THEME.text} />
                </View>
                <Text style={styles.actionCellTitle}>조회</Text>
                <Text style={styles.actionCellSub}>사진 조회</Text>
              </Pressable>

              <Pressable onPress={() => setHazardMenuOpen(true)} disabled={busy} style={[styles.actionCell, styles.actionCellOrange, busy && { opacity: 0.6 }]}>
                <View style={[styles.actionCellIconWrap, { backgroundColor: "rgba(255,106,0,0.15)" }]}>
                  <MaterialCommunityIcons name="alert-circle-outline" size={24} color={THEME.orange} />
                </View>
                <Text style={[styles.actionCellTitle, { color: THEME.orange }]}>위험요인</Text>
                <Text style={[styles.actionCellSub, { color: "rgba(255,106,0,0.65)" }]}>제보 · 내역</Text>
              </Pressable>

              <Pressable onPress={() => Alert.alert("공지사항", "준비 중입니다.")} style={[styles.actionCell, styles.actionCellBlue]}>
                <View style={[styles.actionCellIconWrap, { backgroundColor: "#DBEAFE" }]}>
                  <Ionicons name="megaphone-outline" size={24} color="#3B82F6" />
                </View>
                <Text style={styles.actionCellTitle}>공지사항</Text>
                <Text style={styles.actionCellSub}>업데이트 · 안내</Text>
              </Pressable>
            </View>

          </View>
        </Pressable>
      </ScrollView>

      {/* 위험요인 메뉴 모달 */}
      <Modal visible={hazardMenuOpen} transparent animationType="fade" onRequestClose={() => setHazardMenuOpen(false)}>
        <Pressable style={styles.backdropFill} onPress={() => setHazardMenuOpen(false)} />
        <View style={styles.modalCenterWrap}>
          <View style={[styles.modalBox, { minWidth: 260 }]}>
            <View style={[styles.modalInner, { gap: 12 }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <MaterialCommunityIcons name="alert-circle-outline" size={18} color={THEME.orange} />
                <Text style={styles.modalTitle}>위험요인</Text>
              </View>
              <Pressable
                onPress={() => {
                  setHazardMenuOpen(false);
                  setTimeout(() => openReport(), 200);
                }}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  padding: 16,
                  borderRadius: 12,
                  backgroundColor: pressed ? THEME.orangeSoft : THEME.soft,
                  borderWidth: 1,
                  borderColor: THEME.orangeBorder,
                })}
              >
                <MaterialCommunityIcons name="camera-plus-outline" size={22} color={THEME.orange} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: "700", fontSize: 15, color: THEME.text }}>제보하기</Text>
                  <Text style={{ fontSize: 12, color: THEME.subtext, marginTop: 2 }}>위험요인 사진 및 내용 제보</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={THEME.muted} />
              </Pressable>
              <Pressable
                onPress={() => {
                  setHazardMenuOpen(false);
                  setTimeout(() => goHazardList(), 200);
                }}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  padding: 16,
                  borderRadius: 12,
                  backgroundColor: pressed ? THEME.orangeSoft : THEME.soft,
                  borderWidth: 1,
                  borderColor: THEME.border,
                })}
              >
                <MaterialCommunityIcons name="clipboard-text-outline" size={22} color={THEME.subtext} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: "700", fontSize: 15, color: THEME.text }}>내역보기</Text>
                  <Text style={{ fontSize: 12, color: THEME.subtext, marginTop: 2 }}>제보된 위험요인 목록 확인</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={THEME.muted} />
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* 호차 선택 모달 */}
      <Modal visible={carPickerOpen} transparent animationType="fade" onRequestClose={() => setCarPickerOpen(false)}>
        <Pressable style={styles.backdropFill} onPress={() => setCarPickerOpen(false)} />
        <View style={styles.modalCenterWrap}>
          <View style={[styles.modalBox, { maxHeight: "75%", minHeight: 220 }]}>
            <View style={[styles.modalInner, { flex: 1, gap: 14 }]}>
              <Text style={styles.modalTitle}>호차 선택</Text>
              {carLoading ? (
                <View style={{ alignItems: "center", paddingVertical: 20 }}>
                  <ActivityIndicator />
                  <Text style={[styles.helper, { marginTop: 8 }]}>불러오는 중...</Text>
                </View>
              ) : (() => {
                // 내 car_no에서 숫자 추출 → 매칭 carGroup 찾기
                const myNums = (myCarNo ?? "").match(/\d+/g)?.filter((n) => n.length >= 2) ?? [];
                const myItems = myNums.map((num) => {
                  const group = carGroups.find((g) => (g.car_no.match(/\d+/g) ?? []).includes(num));
                  return { num, group: group ?? null, carNo: group?.car_no ?? num };
                });

                if (myItems.length === 0) {
                  return (
                    <Text style={[styles.helper, { textAlign: "center", paddingVertical: 16 }]}>
                      등록된 호차가 없습니다.{"\n"}프로필에서 호차를 설정해주세요.
                    </Text>
                  );
                }

                return (
                  <View style={{ gap: 8 }}>
                    {myItems.map(({ num, group, carNo }) => {
                      const allIn = group ? group.drivers.every((d) => !!carShifts[`${d.id}:${group.car_no}`]?.clock_in_at) : false;
                      const allOut = group ? group.drivers.every((d) => !!carShifts[`${d.id}:${group.car_no}`]?.clock_out_at) : false;
                      const status = !group ? "" : allOut ? "출차완료" : allIn ? "입차중" : "대기";
                      const statusColor = allOut ? THEME.subtext : allIn ? THEME.success : THEME.muted;
                      const isSelected = selectedCarNo === num;
                      return (
                        <Pressable
                          key={num}
                          onPress={() => { setSelectedCarNo(num); setCarPickerOpen(false); }}
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            paddingVertical: 16,
                            paddingHorizontal: 14,
                            borderRadius: 14,
                            borderWidth: 1.5,
                            borderColor: isSelected ? THEME.success : "rgba(37,99,235,0.25)",
                            backgroundColor: isSelected ? "#F0FDF4" : "#EFF6FF",
                          }}
                        >
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontWeight: "900", fontSize: 18, color: isSelected ? THEME.success : THEME.text }}>{num}호</Text>
                            {group && group.drivers.length > 0 && (
                              <Text style={styles.carPickerDrivers}>{group.drivers.map((d) => d.name).join(", ")}</Text>
                            )}
                          </View>
                          {!!status && <Text style={[styles.carPickerStatus, { color: statusColor, fontSize: 13 }]}>{status}</Text>}
                        </Pressable>
                      );
                    })}
                  </View>
                );
              })()}
            </View>
          </View>
        </View>
      </Modal>

      {/* 지원 점포 지정 모달 */}
      <Modal visible={supportStoreModalOpen} transparent animationType="fade" onRequestClose={() => setSupportStoreModalOpen(false)}>
        <Pressable style={styles.backdropFill} onPress={() => { setSupportStoreModalOpen(false); Keyboard.dismiss(); }} />
        <View style={styles.modalCenterWrap}>
          <View style={[styles.modalBox, { maxHeight: "80%" }]}>
            <View style={[styles.modalInner, { flex: 1 }]}>
              <Text style={styles.modalTitle}>점포 지정 입차</Text>
              {supportSelectedDriver && (
                <Text style={styles.modalBody}>{supportSelectedDriver.name} 지원 입차</Text>
              )}
              <TextInput
                value={supportStoreQuery}
                onChangeText={async (q) => {
                  setSupportStoreQuery(q);
                  if (q.trim().length >= 1) {
                    const { rows } = await searchStores(q, 20);
                    setSupportStoreResults(rows);
                  } else {
                    setSupportStoreResults([]);
                  }
                }}
                placeholder="점포명 또는 코드 검색"
                placeholderTextColor={THEME.muted}
                style={styles.storeSearchInput}
                autoFocus
              />
              <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1, maxHeight: 300 }}>
                {supportStoreResults.map((store) => (
                  <Pressable
                    key={store.store_code}
                    onPress={async () => {
                      if (supportSelectedDriver) await doSupportClockIn(supportSelectedDriver, store);
                    }}
                    disabled={carBusy}
                    style={styles.storeResultItem}
                  >
                    <Text style={styles.storeResultCode}>{store.store_code}</Text>
                    <Text style={styles.storeResultName}>{store.store_name}</Text>
                  </Pressable>
                ))}
                {supportStoreResults.length === 0 && supportStoreQuery.trim().length >= 1 && (
                  <Text style={[styles.mutedCenter, { padding: 16 }]}>검색 결과 없음</Text>
                )}
              </ScrollView>
            </View>
          </View>
        </View>
      </Modal>

      {/* 출근/입차 확인 모달 */}
      <Modal visible={clockInConfirmOpen} transparent animationType="fade" onRequestClose={() => setClockInConfirmOpen(false)}>
        <Pressable
          style={styles.backdropFill}
          onPress={() => {
            Keyboard.dismiss();
            setSelectedTempDailyPart("");
            setClockInConfirmOpen(false);
          }}
        />
        <View style={styles.modalCenterWrap}>
        <View style={styles.modalBox}>
          <View style={styles.modalInner}>
            <Text style={styles.modalTitle}>{clockInLabel} 확인</Text>
            <Text style={styles.modalBody}>오늘 근무하기에 건강상태가 괜찮습니까?</Text>

            {isTemporaryWorker ? (
              <View style={styles.tempWorkPartSection}>
                <Text style={styles.tempWorkPartLabel}>오늘 근무파트</Text>
                <View style={styles.tempWorkPartWrap}>
                  {TEMP_DAILY_WORK_PARTS.map((part) => {
                    const selected = selectedTempDailyPart === part;
                    return (
                      <Pressable
                        key={part}
                        onPress={() => setSelectedTempDailyPart(part)}
                        style={[styles.tempWorkPartChip, selected && styles.tempWorkPartChipActive]}
                      >
                        <Text style={[styles.tempWorkPartChipText, selected && styles.tempWorkPartChipTextActive]}>{part}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}

            <View style={styles.rowGap}>
              <Pressable
                onPress={() => {
                  setSelectedTempDailyPart("");
                  setClockInConfirmOpen(false);
                }}
                style={[styles.btn, styles.btnOutline]}
              >
                <Text style={styles.btnText}>아니요</Text>
              </Pressable>

              <Pressable
                onPress={() => {
                  setClockInConfirmOpen(false);
                  setTimeout(() => doClockIn(), 300);
                }}
                disabled={isTemporaryWorker && !selectedTempDailyPart}
                style={[styles.btn, styles.btnSuccess, isTemporaryWorker && !selectedTempDailyPart && styles.btnDisabled]}
              >
                <View style={styles.btnInner}>
                  <MaterialCommunityIcons name="check" size={18} color="#fff" />
                  <Text style={styles.btnTextWhite}>네</Text>
                </View>
              </Pressable>
            </View>
          </View>
        </View>
        </View>
      </Modal>

      {/* 퇴근/출차 확인 모달 */}
      <Modal visible={clockOutConfirmOpen} transparent animationType="fade" onRequestClose={() => setClockOutConfirmOpen(false)}>
        <Pressable
          style={styles.backdropFill}
          onPress={() => {
            Keyboard.dismiss();
            setClockOutConfirmOpen(false);
          }}
        />
        <View style={styles.modalCenterWrap}>
        <View style={styles.modalBox}>
          <View style={styles.modalInner}>
            <Text style={styles.modalTitle}>{clockOutLabel} 확인</Text>
            <Text style={styles.modalBody}>{clockOutLabel} 처리를 진행할까요?</Text>

            <View style={styles.rowGap}>
              <Pressable onPress={() => setClockOutConfirmOpen(false)} style={[styles.btn, styles.btnOutline]}>
                <Text style={styles.btnText}>아니요</Text>
              </Pressable>

              <Pressable
                onPress={() => {
                  setClockOutConfirmOpen(false);
                  setTimeout(() => doClockOut(), 300);
                }}
                style={[styles.btn, styles.btnPrimary]}
              >
                <View style={styles.btnInner}>
                  <MaterialCommunityIcons name="check" size={18} color="#fff" />
                  <Text style={styles.btnTextWhite}>네</Text>
                </View>
              </Pressable>
            </View>
          </View>
        </View>
        </View>
      </Modal>

      {/* 위험요인 제보 모달 */}
      <Modal visible={reportOpen} transparent animationType="slide" onRequestClose={() => { Keyboard.dismiss(); if (!reportUploading) setReportOpen(false); }}>
        <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.45)" }}>
          <Pressable style={StyleSheet.absoluteFillObject} onPress={() => { Keyboard.dismiss(); if (!reportUploading) setReportOpen(false); }} />
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ width: "100%" }}>
        <View style={[styles.reportSheet, Platform.OS === "android" && reportKeyboardHeight > 0 && { marginBottom: reportKeyboardHeight }]}>
          {/* 핸들 바 */}
          <View style={styles.reportHandle} />

          {/* 헤더 */}
          <View style={styles.reportHeader}>
            <View style={styles.reportHeaderLeft}>
              <View style={styles.reportHeaderIcon}>
                <MaterialCommunityIcons name="alert-octagon-outline" size={20} color="#fff" />
              </View>
              <View>
                <Text style={styles.reportTitle}>위험요인 제보</Text>
                <Text style={styles.reportSubtitle}>사진과 코멘트로 바로 접수됩니다</Text>
              </View>
            </View>
            <Pressable
              onPress={() => { Keyboard.dismiss(); if (!reportUploading) setReportOpen(false); }}
              style={styles.reportCloseBtn}
              hitSlop={8}
            >
              <Ionicons name="close" size={20} color={THEME.subtext} />
            </Pressable>
          </View>

          <ScrollView
            ref={reportScrollRef}
            style={Platform.OS === "android" && reportKeyboardHeight > 0 ? { maxHeight: 360 } : undefined}
            contentContainerStyle={styles.reportBody}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* 사진 섹션 */}
            <View style={styles.reportSection}>
              <View style={styles.reportSectionHeader}>
                <Ionicons name="camera" size={14} color={THEME.orange} />
                <Text style={styles.reportSectionLabel}>사진 첨부</Text>
                <View style={styles.reportPhotoBadge}>
                  <Text style={styles.reportPhotoBadgeText}>{reportPhotos.length}장</Text>
                </View>
              </View>

              {/* 사진 미리보기 그리드 */}
              {reportPhotos.length > 0 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2 }}>
                  {reportPhotos.map((uri, idx) => (
                    <View key={`${uri}_${idx}`} style={styles.reportThumbWrap}>
                      <Image source={{ uri }} style={styles.reportThumb} resizeMode="cover" />
                      {idx === 0 && (
                        <View style={styles.reportThumbBadge}>
                          <Text style={{ color: "#fff", fontSize: 9, fontWeight: "800" }}>대표</Text>
                        </View>
                      )}
                      <Pressable onPress={() => removePhotoAt(idx)} disabled={reportUploading} style={[styles.reportThumbRemove, reportUploading && { opacity: 0.4 }]}>
                        <Ionicons name="close" size={12} color="#fff" />
                      </Pressable>
                    </View>
                  ))}
                  {/* 추가 버튼 */}
                  <Pressable onPress={takeReportPhoto} disabled={reportUploading} style={styles.reportThumbAdd}>
                    <Ionicons name="add" size={28} color={THEME.orange} />
                  </Pressable>
                </ScrollView>
              ) : (
                <Pressable onPress={takeReportPhoto} disabled={reportUploading} style={styles.reportEmptyPhoto}>
                  <View style={styles.reportEmptyPhotoIcon}>
                    <Ionicons name="camera-outline" size={32} color={THEME.orange} />
                  </View>
                  <Text style={styles.reportEmptyPhotoText}>탭하여 사진 촬영</Text>
                  <Text style={styles.reportEmptyPhotoSub}>위험 상황을 카메라로 찍어주세요</Text>
                </Pressable>
              )}

              {/* 버튼 행 */}
              <View style={styles.reportPhotoRow}>
                <Pressable onPress={takeReportPhoto} disabled={reportUploading} style={[styles.reportPhotoBtn, styles.reportPhotoBtnPrimary, reportUploading && { opacity: 0.5 }]}>
                  <Ionicons name="camera-outline" size={17} color="#fff" />
                  <Text style={styles.reportPhotoBtnTextWhite}>카메라</Text>
                </Pressable>
                <Pressable onPress={pickReportPhotoFromGallery} disabled={reportUploading} style={[styles.reportPhotoBtn, styles.reportPhotoBtnSecondary, reportUploading && { opacity: 0.5 }]}>
                  <Ionicons name="images-outline" size={17} color={THEME.text} />
                  <Text style={styles.reportPhotoBtnText}>갤러리</Text>
                </Pressable>
              </View>
            </View>

            {/* 구분선 */}
            <View style={styles.reportDivider} />

            {/* 코멘트 섹션 */}
            <View style={styles.reportSection}>
              <View style={styles.reportSectionHeader}>
                <Ionicons name="chatbubble-ellipses-outline" size={14} color={THEME.orange} />
                <Text style={styles.reportSectionLabel}>상황 설명</Text>
                <Text style={styles.reportCommentCount}>{reportComment.length}자</Text>
              </View>
              <TextInput
                value={reportComment}
                onChangeText={setReportComment}
                placeholder={"어떤 위험 상황인지 간략히 설명해 주세요.\n예) 통로에 적치물이 있어 지게차 동선 위험"}
                placeholderTextColor={THEME.muted}
                editable={!reportUploading}
                multiline
                style={styles.reportTextarea}
                onFocus={() => Platform.OS === "android" && setTimeout(() => reportScrollRef.current?.scrollToEnd({ animated: true }), 200)}
              />
            </View>

            {/* 제출 버튼 */}
            <Pressable onPress={submitReport} disabled={reportUploading} style={[styles.reportSubmitBtn, reportUploading && { opacity: 0.7 }]}>
              {reportUploading ? (
                <View style={styles.inlineCenter}>
                  <ActivityIndicator color="#fff" size="small" />
                  <Text style={styles.reportSubmitText}>제보 접수 중...</Text>
                </View>
              ) : (
                <View style={styles.inlineCenter}>
                  <MaterialCommunityIcons name="send-circle-outline" size={22} color="#fff" />
                  <Text style={styles.reportSubmitText}>
                    제보 제출{reportPhotos.length > 0 ? `  ·  사진 ${reportPhotos.length}장` : ""}
                  </Text>
                </View>
              )}
            </Pressable>

            <Text style={styles.reportNote}>수집된 사진과 내용은 안전관리 목적에만 사용됩니다.</Text>
          </ScrollView>
        </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: THEME.bg },

  // 헤더 배너
  heroBanner: {
    backgroundColor: "transparent",
    paddingLeft: 0,
    paddingRight: 12,
    paddingTop: 4,
    paddingBottom: 4,
  },
  heroTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  heroLogo: { width: 240, height: 64, resizeMode: "contain", marginBottom: 4 },
  heroLogoutBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: "#F3F4F6",
  },
  heroLogoutText: { fontSize: 11, color: "#9CA3AF", fontWeight: "600" },
  heroBottom: { flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 20 },
  heroName: { fontSize: 20, fontWeight: "800", color: "#1E2D40", letterSpacing: -0.3, lineHeight: 26 },
  heroGreeting: { fontSize: 13, color: "rgba(0,0,0,0.5)", marginTop: 2, lineHeight: 18 },
  heroDate: { fontSize: 12, color: "rgba(0,0,0,0.35)", marginTop: 3 },
  workPartChip: {
    backgroundColor: "#1E2D40",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  workPartChipText: { fontSize: 12, fontWeight: "700", color: "#ffffff" },

  mainContent: { padding: 16, gap: 12 },

  // 출퇴근 카드
  attCard: {
    backgroundColor: THEME.surface,
    borderRadius: 20,
    padding: 16,
    gap: 14,
    borderWidth: 1,
    borderColor: THEME.border,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  attCardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  attCardIconWrap: {
    width: 32, height: 32, borderRadius: 10,
    backgroundColor: "#111827",
    alignItems: "center", justifyContent: "center",
  },
  attCardTitle: { fontSize: 15, fontWeight: "800", color: THEME.text, letterSpacing: -0.2 },
  attStatusChip: {
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 8,
  },
  attStatusText: { fontSize: 12, fontWeight: "700" },
  carPill: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 9, paddingVertical: 5,
    borderRadius: 9, borderWidth: 1,
    borderColor: THEME.border, backgroundColor: THEME.soft,
  },
  carPillText: { fontSize: 12, fontWeight: "700", color: THEME.subtext },

  dateNav: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: THEME.soft, borderRadius: 14,
    borderWidth: 1, borderColor: THEME.border,
    paddingHorizontal: 6, height: 52,
  },
  dateNavArrow: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  dateNavText: { fontSize: 18, fontWeight: "800", color: THEME.text, letterSpacing: -0.3 },

  driverList: { gap: 8 },
  driverRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 },
  driverAvatar: {
    width: 30, height: 30, borderRadius: 10,
    backgroundColor: THEME.soft, borderWidth: 1, borderColor: THEME.border,
    alignItems: "center", justifyContent: "center",
  },
  driverAvatarText: { fontSize: 13, fontWeight: "800", color: THEME.subtext },
  driverName: { fontSize: 14, fontWeight: "700", color: THEME.text },
  driverTime: { fontSize: 12, fontWeight: "700", color: THEME.subtext },
  driverTimeSep: { fontSize: 12, color: THEME.muted, marginHorizontal: 2 },

  supportBtn: {
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 10, borderWidth: 1,
    borderColor: THEME.border, backgroundColor: THEME.soft,
  },
  supportBtnText: { fontSize: 12, fontWeight: "700", color: THEME.text },

  punchRow: { flexDirection: "row", gap: 12 },
  punchBtn: {
    flex: 1, height: 68, borderRadius: 16,
    borderWidth: 1.5, alignItems: "center", justifyContent: "center", gap: 2,
  },
  punchBtnIn: { backgroundColor: "#F0FDF4", borderColor: "#86EFAC" },
  punchBtnOut: { backgroundColor: "#EFF6FF", borderColor: "#93C5FD" },
  punchBtnDone: { backgroundColor: THEME.soft, borderColor: THEME.border },
  punchBtnLabel: { fontSize: 11, fontWeight: "700", color: THEME.muted },
  punchBtnTime: { fontSize: 20, fontWeight: "800", color: THEME.text, letterSpacing: -0.5 },
  punchBtnIdle: { fontSize: 16, fontWeight: "800", color: THEME.text, letterSpacing: -0.2 },

  helper: { color: THEME.subtext, fontSize: 12, lineHeight: 16 },
  btnInner: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  btnDisabled: { opacity: 0.65 },
  btnOrangeSolid: { backgroundColor: THEME.orange },

  // 모달 공통 버튼
  btn: { flex: 1, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  btnPrimary: { backgroundColor: THEME.primary },
  btnSuccess: { backgroundColor: THEME.success },
  btnOutline: { backgroundColor: THEME.surface, borderWidth: 1, borderColor: THEME.border },
  btnOrangeSoft: { backgroundColor: THEME.orangeSoft, borderWidth: 1, borderColor: THEME.orangeBorder },
  btnOrangeOutline: { backgroundColor: THEME.surface, borderWidth: 1, borderColor: THEME.orangeBorder },
  btnDangerOutline: { backgroundColor: THEME.surface, borderWidth: 1, borderColor: "#FCA5A5" },
  btnTextWhite: { color: "#FFFFFF", fontWeight: "800", fontSize: 15, letterSpacing: -0.1 },
  btnText: { color: THEME.text, fontWeight: "800", fontSize: 15, letterSpacing: -0.1 },
  btnTextOrange: { color: "#9A3412", fontWeight: "800", fontSize: 15, letterSpacing: -0.1 },
  btnTextDanger: { color: "#DC2626", fontWeight: "800", fontSize: 15, letterSpacing: -0.1 },
  rowGap: { flexDirection: "row", gap: 10 },
  labelStrong: { color: "#374151", fontWeight: "800", fontSize: 13 },

  // 승인 카드
  approveCard: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: THEME.surface, borderRadius: 16, padding: 14,
    borderWidth: 1, borderColor: THEME.border,
    shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 }, elevation: 1,
  },
  approveCardLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  approveCardIcon: {
    width: 36, height: 36, borderRadius: 11,
    backgroundColor: "#111827", alignItems: "center", justifyContent: "center",
  },
  approveCardTitle: { fontSize: 14, fontWeight: "800", color: THEME.text },
  approveCardSub: { fontSize: 11, color: THEME.subtext, marginTop: 2 },
  approveCardBadge: {
    minWidth: 32, height: 32, borderRadius: 10,
    paddingHorizontal: 8, alignItems: "center", justifyContent: "center",
  },
  approveCardBadgeHot: { backgroundColor: "#111827" },
  approveCardBadgeIdle: { backgroundColor: THEME.soft, borderWidth: 1, borderColor: THEME.border },
  approveCardBadgeText: { fontWeight: "900", fontSize: 14, color: THEME.subtext },

  // 기능 그리드
  actionGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  actionCell: {
    width: "48%", flexGrow: 1,
    borderRadius: 18, padding: 16, gap: 8,
    borderWidth: 1,
    shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 }, elevation: 1,
  },
  actionCellPrimary: { backgroundColor: "#111827", borderColor: "#111827" },
  actionCellOutline: { backgroundColor: THEME.surface, borderColor: THEME.border },
  actionCellOrange: { backgroundColor: THEME.orangeSoft, borderColor: THEME.border },
  actionCellDanger: { backgroundColor: "#FEF2F2", borderColor: "#FECACA" },
  actionCellBlue: { backgroundColor: "#EFF6FF", borderColor: "#BFDBFE" },
  actionCellIconWrap: { width: 44, height: 44, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  actionCellTitle: { fontSize: 15, fontWeight: "800", color: THEME.text, letterSpacing: -0.2 },
  actionCellSub: { fontSize: 12, color: THEME.subtext },

  footnote: { color: THEME.muted, fontSize: 11, textAlign: "center", marginTop: 2, lineHeight: 16 },

  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },
  backdropFill: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.35)" },
  modalCenterWrap: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 18,
  },
  modalBox: {
    width: "100%",
    maxWidth: 560,
    backgroundColor: THEME.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: THEME.border,
    overflow: "hidden",
    shadowColor: THEME.shadow as any,
    shadowOpacity: 1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 3,
  },
  modalInner: { padding: 16, gap: 10 },
  modalTitle: { fontSize: 16, fontWeight: "900", color: THEME.text, letterSpacing: -0.2 },
  modalBody: { color: "#374151", fontWeight: "700", lineHeight: 20 },
  tempWorkPartSection: {
    gap: 10,
    padding: 12,
    borderRadius: 16,
    backgroundColor: THEME.soft,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  tempWorkPartLabel: { color: THEME.text, fontWeight: "800", fontSize: 13 },
  tempWorkPartWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tempWorkPartChip: {
    minWidth: "30%",
    paddingHorizontal: 12,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: THEME.surface,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  tempWorkPartChipActive: {
    backgroundColor: "#ECFDF3",
    borderColor: "#16A34A",
  },
  tempWorkPartChipText: { color: "#374151", fontWeight: "800", fontSize: 14 },
  tempWorkPartChipTextActive: { color: "#15803D" },

  // 위험요인 제보 모달
  reportBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)" },
  reportSheet: {
    backgroundColor: THEME.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: 32,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -4 },
    elevation: 12,
  },
  reportHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: THEME.border,
    alignSelf: "center",
    marginTop: 10,
    marginBottom: 4,
  },
  reportHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
  },
  reportHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  reportHeaderIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: THEME.orange,
    alignItems: "center",
    justifyContent: "center",
  },
  reportTitle: { fontSize: 16, fontWeight: "800", color: THEME.text, letterSpacing: -0.3 },
  reportSubtitle: { fontSize: 12, color: THEME.subtext, marginTop: 1 },
  reportCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: THEME.soft,
    borderWidth: 1,
    borderColor: THEME.border,
    alignItems: "center",
    justifyContent: "center",
  },
  reportBody: { paddingHorizontal: 18, paddingTop: 16, paddingBottom: 8, gap: 16 },
  reportSection: { gap: 10 },
  reportSectionHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  reportSectionLabel: { fontWeight: "800", fontSize: 13, color: THEME.text, flex: 1 },
  reportPhotoBadge: {
    backgroundColor: THEME.orangeSoft,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: THEME.orangeBorder,
  },
  reportPhotoBadgeText: { fontSize: 11, fontWeight: "800", color: THEME.orange },
  reportCommentCount: { fontSize: 11, color: THEME.muted, fontWeight: "600" },
  reportEmptyPhoto: {
    height: 140,
    borderRadius: 16,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: THEME.orangeBorder,
    backgroundColor: THEME.orangeSoft,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  reportEmptyPhotoIcon: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: "rgba(255,106,0,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  reportEmptyPhotoText: { fontWeight: "800", fontSize: 14, color: THEME.orange },
  reportEmptyPhotoSub: { fontSize: 12, color: THEME.subtext },
  reportThumbWrap: { position: "relative", width: 90, height: 90 },
  reportThumb: { width: 90, height: 90, borderRadius: 14, backgroundColor: "#F3F4F6" },
  reportThumbBadge: {
    position: "absolute",
    bottom: 6,
    left: 6,
    backgroundColor: THEME.orange,
    borderRadius: 5,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  reportThumbRemove: {
    position: "absolute",
    top: -5,
    right: -5,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#374151",
  },
  reportThumbAdd: {
    width: 90,
    height: 90,
    borderRadius: 14,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: THEME.orangeBorder,
    backgroundColor: THEME.orangeSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  reportPhotoRow: { flexDirection: "row", gap: 10 },
  reportPhotoBtn: { flex: 1, height: 44, borderRadius: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  reportPhotoBtnPrimary: { backgroundColor: THEME.orange },
  reportPhotoBtnSecondary: { backgroundColor: THEME.soft, borderWidth: 1, borderColor: THEME.border },
  reportPhotoBtnTextWhite: { fontWeight: "700", fontSize: 14, color: "#fff" },
  reportPhotoBtnText: { fontWeight: "700", fontSize: 14, color: THEME.text },
  reportDivider: { height: 1, backgroundColor: THEME.border, marginHorizontal: -18 },
  reportTextarea: {
    minHeight: 96,
    borderWidth: 1,
    borderColor: THEME.border,
    borderRadius: 14,
    paddingHorizontal: 13,
    paddingVertical: 11,
    backgroundColor: THEME.soft,
    color: THEME.text,
    textAlignVertical: "top",
    lineHeight: 20,
    fontSize: 14,
  },
  reportSubmitBtn: {
    height: 52,
    borderRadius: 16,
    backgroundColor: THEME.orange,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
    shadowColor: THEME.orange,
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  reportSubmitText: { fontWeight: "800", fontSize: 15, color: "#fff", letterSpacing: -0.2 },
  reportNote: { fontSize: 11, color: THEME.muted, textAlign: "center", lineHeight: 16 },

  mutedCenter: { color: THEME.muted, fontWeight: "800" },
  inlineCenter: { flexDirection: "row", alignItems: "center", gap: 10 },

  // 기사 호차 관련
  carSelectHint: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: THEME.border,
    borderStyle: "dashed" as any,
    backgroundColor: THEME.soft,
  },
  carSelectHintText: { color: THEME.subtext, fontWeight: "700", fontSize: 14 },

  carSelectPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: THEME.soft,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  carSelectPillText: { color: THEME.subtext, fontSize: 13, fontWeight: "700" },

  driverRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: THEME.soft,
    borderWidth: 1,
    borderColor: THEME.border,
    gap: 8,
  },
  driverName: { fontWeight: "800", color: THEME.text, fontSize: 14, minWidth: 60 },
  driverShiftInfo: { color: THEME.subtext, fontSize: 12, fontWeight: "600", flex: 1 },

  supportClockInBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: THEME.soft,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  supportClockInBtnText: { color: THEME.text, fontWeight: "800", fontSize: 12 },

  carPickerItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
    gap: 8,
  },
  carPickerItemActive: { backgroundColor: "#F0FDF4" },
  carPickerCarNo: { fontWeight: "800", fontSize: 15, color: THEME.text },
  carPickerCarNoActive: { color: THEME.success },
  carPickerDrivers: { color: THEME.subtext, fontSize: 12, marginTop: 2 },
  carPickerStatus: { fontWeight: "700", fontSize: 12 },

  storeSearchInput: {
    height: 46,
    borderWidth: 1,
    borderColor: THEME.border,
    borderRadius: 14,
    paddingHorizontal: 12,
    backgroundColor: THEME.soft,
    color: THEME.text,
    fontSize: 14,
    fontWeight: "600",
  },
  storeResultItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
  },
  storeResultCode: { color: THEME.subtext, fontWeight: "700", fontSize: 13, minWidth: 60 },
  storeResultName: { color: THEME.text, fontWeight: "700", fontSize: 14, flex: 1 },
});
