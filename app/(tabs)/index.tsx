// app/(tabs)/index.tsx
import { useFocusEffect } from "@react-navigation/native";
import { Buffer } from "buffer";
import * as Device from "expo-device";
import * as FileSystem from "expo-file-system/legacy";
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

import { getPendingCount, isAdminUser } from "../../src/lib/admin";
import { useAuth } from "../../src/lib/auth";
import { supabase } from "../../src/lib/supabase";

import { useSafeAreaInsets } from "react-native-safe-area-context";

const THEME = {
  bg: "#F7F7F8",
  surface: "#FFFFFF",
  text: "#111827",
  subtext: "#6B7280",
  border: "#E5E7EB",
  muted: "#9CA3AF",
  soft: "#F9FAFB",

  orange: "#FF6A00",
  orangeSoft: "rgba(255,106,0,0.10)",
  orangeBorder: "rgba(255,106,0,0.35)",

  primary: "#111827",
  success: "#16A34A",

  shadow: "rgba(17,24,39,0.08)",
};

const CENTER_LAT = 37.0778566841938;
const CENTER_LNG = 126.954553958864;
const MAX_DISTANCE_M = 1000;

const ALLOW_FALLBACK_CLOCK = true;
const GPS_TOTAL_TIMEOUT_MS = 25000;
const PUSH_NOTIFY_TIMEOUT_MS = 12000;

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

async function uriToArrayBuffer(uri: string): Promise<ArrayBuffer> {
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const buf = Buffer.from(base64, "base64");
  const u8 = new Uint8Array(buf);
  return u8.buffer;
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
      try {
        const last = await withTimeout(Location.getLastKnownPositionAsync(), 2500, "마지막 위치");
        if (last) return { pos: last, source: "last_known" as const };
      } catch {}

      try {
        const p = await withTimeout(
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Lowest }),
          8000,
          "현재 위치(낮은 정확도)"
        );
        return { pos: p, source: "current_lowest" as const };
      } catch {}

      try {
        const p = await getPositionByWatching(9000, Location.Accuracy.Balanced);
        return { pos: p, source: "watch_balanced" as const };
      } catch {}

      const p = await getPositionByWatching(9000, Location.Accuracy.High);
      return { pos: p, source: "watch_high" as const };
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
  const topPad = Math.max(insets.top, 12) + 8;
  const bottomPad = Math.max(insets.bottom, 10) + 10;

  const [isAdmin, setIsAdmin] = useState(false);
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [loadingAdmin, setLoadingAdmin] = useState(true);

  const [busy, setBusy] = useState(false);
  const [displayName, setDisplayName] = useState<string>("");

  const [reportOpen, setReportOpen] = useState(false);
  const [reportPhotos, setReportPhotos] = useState<string[]>([]);
  const [reportComment, setReportComment] = useState<string>("");
  const [reportUploading, setReportUploading] = useState(false);

  const [attLoading, setAttLoading] = useState(false);
  const [att, setAtt] = useState<AttendanceRow | null>(null);

  const [clockInConfirmOpen, setClockInConfirmOpen] = useState(false);
  const [clockOutConfirmOpen, setClockOutConfirmOpen] = useState(false);
  const [clockPhase, setClockPhase] = useState<string>("");

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

  const requireSession = useCallback(async () => {
    try {
      const res = await withTimeout(supabase.auth.getSession(), 12000, "세션 확인");
      if ((res as any).error) {
        Alert.alert("auth error", (res as any).error.message);
        return null;
      }
      if (!(res as any).data?.session) {
        Alert.alert("로그인 필요", "세션이 없습니다. 로그인 후 다시 시도하세요.");
        return null;
      }
      return (res as any).data.session;
    } catch (e: any) {
      Alert.alert("세션 오류", e?.message ?? String(e));
      return null;
    }
  }, []);

  const loadAdmin = useCallback(async () => {
    setLoadingAdmin(true);
    try {
      const ok = await withTimeout(isAdminUser(), 12000, "관리자 확인");
      setIsAdmin(!!ok);

      if (ok) {
        const c = await withTimeout(getPendingCount(), 12000, "승인대기 조회");
        setPendingCount(Number.isFinite(c as any) ? (c as any) : 0);
      } else {
        setPendingCount(0);
      }
    } catch {
      setIsAdmin(false);
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
        supabase.from("profiles").select("name").eq("id", u.id).single(),
        12000,
        "프로필 조회"
      );

      const profName = ((profRes as any).data?.name ?? "").trim();
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
      setDisplayName(metaName || "이름 미등록");
    }
  }, [user]);

  /** ✅ 오늘 출퇴근 조회: work_shifts */
  const loadTodayAttendance = useCallback(async () => {
    const session = await requireSession();
    if (!session) return;

    setAttLoading(true);
    try {
      const res = await withTimeout(
        supabase
          .from("work_shifts")
          .select(
            "id, user_id, work_date, status, clock_in_at, clock_out_at, clock_in_lat, clock_in_lng, clock_in_accuracy_m, clock_in_source, clock_out_lat, clock_out_lng, clock_out_accuracy_m, clock_out_source, created_at, updated_at"
          )
          .eq("user_id", session.user.id)
          .eq("work_date", kstNowDateString())
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
    loadTodayAttendance();
    registerPushTokenForThisUser();
  }, [loadAdmin, loadProfileName, loadTodayAttendance, registerPushTokenForThisUser]);

  useFocusEffect(
    useCallback(() => {
      loadAdmin();
      loadTodayAttendance();
      return () => {};
    }, [loadAdmin, loadTodayAttendance])
  );

  const goUpload = () => router.push("/(tabs)/upload");
  const goList = () => router.push("/(tabs)/photo-list");
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
    try {
      const session = (sessRes as any).data.session;
      const userId = session.user.id;
      const day = kstNowDateString();

      const firstUri = reportPhotos[0];
      const firstName = makeSafeFileName();
      const firstPath = `${day}/${userId}/${firstName}`;

      const firstAb = await uriToArrayBuffer(firstUri);
      const firstType = guessContentType(firstUri);

      const up1Res = await withTimeout(
        supabase.storage.from("hazard-reports").upload(firstPath, firstAb, {
          contentType: firstType,
          upsert: false,
        }),
        20000,
        "사진 업로드"
      );
      if ((up1Res as any).error) throw (up1Res as any).error;

      const { data: pub1 } = supabase.storage.from("hazard-reports").getPublicUrl(firstPath);
      const firstUrl = pub1.publicUrl;

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

      try {
        await withTimeout(
          supabase.functions.invoke("send-hazard-push", {
            body: { report_id: reportId, comment, photo_url: firstUrl, created_by: userId },
          }),
          PUSH_NOTIFY_TIMEOUT_MS,
          "관리자 알림"
        );
      } catch {}

      Alert.alert("제보 완료", "위험요인 제보가 접수되었습니다. 감사합니다!");
      setReportOpen(false);
      setReportPhotos([]);
      setReportComment("");
    } catch (e: any) {
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
        Alert.alert("범위 밖", `센터 기준 1km 이내에서만 가능합니다.\n현재 거리: ${Math.round(dist)}m`);
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

      const res = await withTimeout(
        supabase
          .from("work_shifts")
          .upsert(
            {
              user_id: session.user.id,
              work_date: workDate,
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
            "id, user_id, work_date, status, clock_in_at, clock_out_at, clock_in_lat, clock_in_lng, clock_in_accuracy_m, clock_in_source, clock_out_lat, clock_out_lng, clock_out_accuracy_m, clock_out_source, created_at, updated_at"
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
            payload: { work_date: workDate },
          }),
          12000,
          "출근 이벤트"
        );
      } catch {}

      setClockPhase("완료");
      setAtt(((res as any).data as AttendanceRow) ?? null);

      Alert.alert("출근 완료", `출근: ${formatKSTTime(nowIso)}`);
      loadTodayAttendance().catch(() => {});
    } catch (e: any) {
      Alert.alert("출근 실패", e?.message ?? String(e));
    } finally {
      stopWatchdog();
      setBusy(false);
      setTimeout(() => setClockPhase(""), 500);
    }
  }, [att, busy, getCurrentLocationChecked, requireSession, loadTodayAttendance, startWatchdog, stopWatchdog]);

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

      const res = await withTimeout(
        supabase
          .from("work_shifts")
          .upsert(
            {
              user_id: session.user.id,
              work_date: workDate,
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
            "id, user_id, work_date, status, clock_in_at, clock_out_at, clock_in_lat, clock_in_lng, clock_in_accuracy_m, clock_in_source, clock_out_lat, clock_out_lng, clock_out_accuracy_m, clock_out_source, created_at, updated_at"
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

      Alert.alert("퇴근 완료", `퇴근: ${formatKSTTime(nowIso)}`);
      loadTodayAttendance().catch(() => {});
    } catch (e: any) {
      Alert.alert("퇴근 실패", e?.message ?? String(e));
    } finally {
      stopWatchdog();
      setBusy(false);
      setTimeout(() => setClockPhase(""), 500);
    }
  }, [att, busy, getCurrentLocationChecked, requireSession, loadTodayAttendance, startWatchdog, stopWatchdog]);

  const onClockIn = () => {
    if (busy) return;
    if (att?.clock_in_at) {
      Alert.alert("안내", `이미 출근 처리됨 (${formatKSTTime(att.clock_in_at)})`);
      return;
    }
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
  const todayStr = kstNowDateString();

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

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        bounces={false}
        alwaysBounceVertical={false}
        scrollEnabled={true}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.scrollContent, { paddingTop: topPad, paddingBottom: bottomPad }]}
      >
        <Pressable onPress={() => Keyboard.dismiss()} style={{ gap: 14 }}>
          <View style={styles.header}>
            <Image source={require("../../assets/hanexpress-logo.png")} style={styles.logo} />
            <Text style={styles.h1}>{greetingLine}</Text>
          </View>

          <View style={styles.card}>
            <View style={styles.cardTitleRow}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <MaterialCommunityIcons name="clock-outline" size={18} color={THEME.text} />
                <Text style={styles.cardTitle}>출퇴근</Text>
              </View>

              <View style={styles.pill}>
                <MaterialCommunityIcons name="map-marker-radius-outline" size={14} color={THEME.subtext} />
                <Text style={styles.pillText}>1km</Text>
              </View>
            </View>

            <Text style={styles.helper}>기준 좌표 1km 이내에서만 가능합니다.</Text>

            <View style={styles.twoCols}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>오늘({todayStr}) 출근</Text>
                <Text style={styles.timeValue}>{formatKSTTime(att?.clock_in_at)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>오늘({todayStr}) 퇴근</Text>
                <Text style={styles.timeValue}>{formatKSTTime(att?.clock_out_at)}</Text>
              </View>
            </View>

            <View style={styles.rowGap}>
              <ActionButton onPress={onClockIn} disabled={busy} iconLib="mci" icon="login" title="출근" variant="success" />
              <ActionButton onPress={onClockOut} disabled={busy} iconLib="mci" icon="logout" title="퇴근" variant="primary" />
            </View>

            {attLoading ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator />
                <Text style={styles.loadingText}>출퇴근 정보 불러오는 중...</Text>
              </View>
            ) : null}
          </View>

          <View style={styles.card}>
            {approveRowVisible ? (
              <Pressable
                onPress={() => router.push("/(tabs)/approve")}
                disabled={busy}
                style={[styles.approveRow, busy && styles.btnDisabled]}
              >
                <View style={{ gap: 2 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Ionicons name="shield-checkmark-outline" size={18} color={THEME.text} />
                    <Text style={styles.cardTitle}>가입 승인</Text>
                  </View>
                  <Text style={styles.helperSmall}>대기 인원 확인</Text>
                </View>

                <View style={[styles.badge, pendingCount > 0 ? styles.badgeHot : styles.badgeIdle]}>
                  <Text style={[styles.badgeText, pendingCount > 0 ? styles.badgeTextHot : styles.badgeTextIdle]}>
                    {pendingCount}
                  </Text>
                </View>
              </Pressable>
            ) : null}

            <ActionButton onPress={goUpload} disabled={busy} icon="cloud-upload-outline" title="업로드" variant="primary" />
            <ActionButton onPress={goList} disabled={busy} icon="search-outline" title="조회" variant="outline" />

            <ActionButton
              onPress={openReport}
              disabled={busy}
              iconLib="mci"
              icon="alert-circle-outline"
              title="위험요인 제보"
              variant="orangeSoft"
            />
            <ActionButton
              onPress={goHazardList}
              disabled={busy}
              iconLib="mci"
              icon="clipboard-text-outline"
              title="위험요인 내역보기"
              variant="orangeOutline"
            />

            <ActionButton onPress={onLogout} disabled={busy} icon="log-out-outline" title="로그아웃" variant="dangerOutline" />

            <Text style={styles.footnote}>로그아웃 시 다음 실행부터 로그인 화면이 먼저 뜹니다.</Text>
          </View>
        </Pressable>
      </ScrollView>

      {/* 출근 확인 모달 */}
      <Modal visible={clockInConfirmOpen} transparent animationType="fade" onRequestClose={() => setClockInConfirmOpen(false)}>
        <Pressable
          style={styles.backdrop}
          onPress={() => {
            Keyboard.dismiss();
            setClockInConfirmOpen(false);
          }}
        />
        <View style={[styles.modalBox, { top: 220 }]}>
          <View style={styles.modalInner}>
            <Text style={styles.modalTitle}>확인</Text>
            <Text style={styles.modalBody}>오늘 근무하기에 건강상태가 괜찮습니까?</Text>

            <View style={styles.rowGap}>
              <Pressable onPress={() => setClockInConfirmOpen(false)} style={[styles.btn, styles.btnOutline]}>
                <Text style={styles.btnText}>아니요</Text>
              </Pressable>

              <Pressable
                onPress={() => {
                  setClockInConfirmOpen(false);
                  setTimeout(() => doClockIn(), 300);
                }}
                style={[styles.btn, styles.btnSuccess]}
              >
                <View style={styles.btnInner}>
                  <MaterialCommunityIcons name="check" size={18} color="#fff" />
                  <Text style={styles.btnTextWhite}>네</Text>
                </View>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* 퇴근 확인 모달 */}
      <Modal visible={clockOutConfirmOpen} transparent animationType="fade" onRequestClose={() => setClockOutConfirmOpen(false)}>
        <Pressable
          style={styles.backdrop}
          onPress={() => {
            Keyboard.dismiss();
            setClockOutConfirmOpen(false);
          }}
        />
        <View style={[styles.modalBox, { top: 220 }]}>
          <View style={styles.modalInner}>
            <Text style={styles.modalTitle}>확인</Text>
            <Text style={styles.modalBody}>퇴근 처리를 진행할까요?</Text>

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
      </Modal>

      {/* 위험요인 제보 모달 */}
      <Modal visible={reportOpen} transparent animationType="fade" onRequestClose={() => setReportOpen(false)}>
        <Pressable
          style={styles.backdrop}
          onPress={() => {
            Keyboard.dismiss();
            if (!reportUploading) setReportOpen(false);
          }}
        />

        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.reportKav}>
          <Pressable onPress={() => Keyboard.dismiss()} style={styles.reportSheet}>
            <View style={styles.reportHeader}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <MaterialCommunityIcons name="alert-octagon-outline" size={18} color={THEME.text} />
                <Text style={styles.modalTitle}>위험요인 제보</Text>
              </View>

              <Pressable
                onPress={() => {
                  Keyboard.dismiss();
                  if (!reportUploading) setReportOpen(false);
                }}
                style={styles.closeBtn}
              >
                <Text style={styles.closeBtnText}>닫기</Text>
              </Pressable>
            </View>

            <View style={styles.reportBody}>
              <Text style={styles.helper}>사진 여러 장 + 코멘트를 남기면 바로 접수됩니다.</Text>

              <View style={styles.previewBox}>
                {reportPhotos.length > 0 ? (
                  <Image source={{ uri: reportPhotos[0] }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
                ) : (
                  <Text style={styles.mutedCenter}>아직 촬영된 사진이 없습니다</Text>
                )}
              </View>

              {reportPhotos.length > 0 && (
                <View style={styles.thumbWrap}>
                  {reportPhotos.map((uri, idx) => (
                    <View key={`${uri}_${idx}`} style={{ position: "relative" }}>
                      <Image source={{ uri }} style={styles.thumb} />
                      <Pressable
                        onPress={() => removePhotoAt(idx)}
                        disabled={reportUploading}
                        style={[styles.thumbRemove, reportUploading && { opacity: 0.5 }]}
                      >
                        <Text style={{ color: "#fff", fontWeight: "900" }}>×</Text>
                      </Pressable>
                    </View>
                  ))}
                </View>
              )}

              <Pressable
                onPress={takeReportPhoto}
                disabled={reportUploading}
                style={[styles.btn, styles.btnPrimary, reportUploading && styles.btnDisabled]}
              >
                <View style={styles.btnInner}>
                  <Ionicons name="camera-outline" size={18} color="#fff" />
                  <Text style={styles.btnTextWhite}>사진 촬영 추가 ({reportPhotos.length}장)</Text>
                </View>
              </Pressable>

              <View style={{ gap: 6 }}>
                <Text style={styles.labelStrong}>코멘트</Text>
                <TextInput
                  value={reportComment}
                  onChangeText={setReportComment}
                  placeholder="예) 통로에 적치물이 있어 지게차 동선 위험"
                  placeholderTextColor={THEME.muted}
                  editable={!reportUploading}
                  multiline
                  style={styles.textarea}
                />
              </View>

              <Pressable
                onPress={submitReport}
                disabled={reportUploading}
                style={[styles.btn, styles.btnOrangeSolid, reportUploading && styles.btnDisabled]}
              >
                {reportUploading ? (
                  <View style={styles.inlineCenter}>
                    <ActivityIndicator color="#fff" />
                    <Text style={styles.btnTextWhite}>제보 접수 중...</Text>
                  </View>
                ) : (
                  <View style={styles.btnInner}>
                    <MaterialCommunityIcons name="send" size={18} color="#fff" />
                    <Text style={styles.btnTextWhite}>제보 제출 (사진 {reportPhotos.length}장)</Text>
                  </View>
                )}
              </Pressable>

              <Text style={styles.smallNote}>사진/코멘트는 안전관리 목적에만 사용됩니다.</Text>
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: THEME.bg },

  scrollContent: {
    paddingHorizontal: 18,
    flexGrow: 1,
    justifyContent: "flex-start",
    gap: 14,
  },

  header: { alignItems: "center", gap: 10, marginBottom: 2 },
  logo: { width: 260, height: 78, resizeMode: "contain" },
  h1: { fontSize: 20, fontWeight: "800", color: THEME.text, letterSpacing: -0.2 },

  card: {
    backgroundColor: THEME.surface,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: THEME.border,

    shadowColor: THEME.shadow as any,
    shadowOpacity: 1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,

    gap: 12,
  },

  cardTitleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cardTitle: { fontWeight: "800", color: THEME.text, fontSize: 16, letterSpacing: -0.2 },

  pill: {
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
  pillText: { color: THEME.subtext, fontSize: 12, fontWeight: "700" },

  helper: { color: THEME.subtext, fontSize: 12, lineHeight: 16 },
  helperSmall: { color: THEME.subtext, fontSize: 11, marginTop: 2 },

  twoCols: { flexDirection: "row", gap: 12 },
  label: { color: "#374151", fontWeight: "700", fontSize: 12 },
  labelStrong: { color: "#374151", fontWeight: "800", fontSize: 13 },
  timeValue: { color: THEME.text, fontWeight: "800", fontSize: 18, marginTop: 4, letterSpacing: -0.2 },

  rowGap: { flexDirection: "row", gap: 10 },

  btn: { flex: 1, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  btnInner: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  btnDisabled: { opacity: 0.65 },

  btnPrimary: { backgroundColor: THEME.primary },
  btnSuccess: { backgroundColor: THEME.success },
  btnOutline: { backgroundColor: THEME.surface, borderWidth: 1, borderColor: THEME.border },

  btnOrangeSoft: { backgroundColor: THEME.orangeSoft, borderWidth: 1, borderColor: THEME.orangeBorder },
  btnOrangeOutline: { backgroundColor: THEME.surface, borderWidth: 1, borderColor: THEME.orangeBorder },
  btnOrangeSolid: { backgroundColor: THEME.orange },

  btnDangerOutline: { backgroundColor: THEME.surface, borderWidth: 1, borderColor: "#FCA5A5" },

  btnTextWhite: { color: "#FFFFFF", fontWeight: "800", fontSize: 15, letterSpacing: -0.1 },
  btnText: { color: THEME.text, fontWeight: "800", fontSize: 15, letterSpacing: -0.1 },
  btnTextOrange: { color: "#9A3412", fontWeight: "800", fontSize: 15, letterSpacing: -0.1 },
  btnTextDanger: { color: "#DC2626", fontWeight: "800", fontSize: 15, letterSpacing: -0.1 },

  loadingRow: { alignItems: "center", paddingTop: 4, gap: 6 },
  loadingText: { color: THEME.muted, fontSize: 12 },

  approveRow: {
    height: 56,
    borderRadius: 16,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: THEME.surface,
    borderWidth: 1,
    borderColor: THEME.border,
  },

  badge: {
    minWidth: 30,
    height: 30,
    paddingHorizontal: 10,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeHot: { backgroundColor: THEME.orangeSoft, borderWidth: 1, borderColor: THEME.orangeBorder },
  badgeIdle: { backgroundColor: THEME.soft, borderWidth: 1, borderColor: THEME.border },
  badgeText: { fontWeight: "900" },
  badgeTextHot: { color: THEME.orange },
  badgeTextIdle: { color: THEME.text },

  footnote: { color: THEME.muted, fontSize: 11, textAlign: "center", marginTop: 2, lineHeight: 16 },

  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },
  modalBox: {
    position: "absolute",
    left: 18,
    right: 18,
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

  reportKav: { position: "absolute", left: 16, right: 16, top: 110 },
  reportSheet: {
    backgroundColor: THEME.surface,
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: THEME.border,
    shadowColor: THEME.shadow as any,
    shadowOpacity: 1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 },
    elevation: 4,
  },
  reportHeader: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: THEME.soft,
  },
  closeBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: THEME.surface,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  closeBtnText: { fontWeight: "800", color: THEME.text },
  reportBody: { padding: 14, gap: 12 },
  previewBox: {
    borderWidth: 1,
    borderColor: THEME.border,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: THEME.soft,
    height: 180,
    alignItems: "center",
    justifyContent: "center",
  },
  mutedCenter: { color: THEME.muted, fontWeight: "800" },
  thumbWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  thumb: { width: 66, height: 66, borderRadius: 14, backgroundColor: "#F3F4F6" },
  thumbRemove: {
    position: "absolute",
    top: -6,
    right: -6,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: THEME.primary,
  },
  textarea: {
    minHeight: 92,
    borderWidth: 1,
    borderColor: THEME.border,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: THEME.soft,
    color: THEME.text,
    textAlignVertical: "top",
    lineHeight: 18,
  },
  inlineCenter: { flexDirection: "row", alignItems: "center", gap: 10 },
  smallNote: { color: THEME.muted, fontSize: 11, textAlign: "center", lineHeight: 16 },
});