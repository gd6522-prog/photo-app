import { Ionicons } from "@expo/vector-icons";
import { Buffer } from "buffer";
import * as FileSystem from "expo-file-system/legacy";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
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
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SUPABASE_ANON_KEY, SUPABASE_URL, supabase } from "../../src/lib/supabase";
import { fetchInspectionStores, fetchStoresByCarNo, searchStores as searchStoreMap } from "../../src/lib/storeMap";
import { getTodayTempWorkPart } from "../../src/lib/tempWorkPart";
import { getWorkPartOptionsExceptDriver, Option } from "../../src/lib/workParts";

import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { Calendar } from "react-native-calendars";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

export const options = { headerShown: false };

type Mode = "search" | "inspect";
type DriverCategory = "bottle" | "tobacco" | "miochul" | "wash";

type StoreMapRow = {
  store_code: string;
  store_name: string;
  car_no: number | null;
  seq_no: number | null;
};

type CarPick =
  | { kind: "car"; carNo: number; label: string }
  | { kind: "support"; label: string };

type MiochulFlags = {
  redelivery: boolean; // 재배송
  damage: boolean; // 파손
  other: boolean; // 기타
};

function kstNowDateString(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

function kstDayRangeUtcIso(dayYYYYMMDD: string) {
  const startKst = new Date(`${dayYYYYMMDD}T00:00:00+09:00`);
  const endKst = new Date(startKst.getTime() + 24 * 60 * 60 * 1000);
  return { startIso: startKst.toISOString(), endIso: endKst.toISOString() };
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

function looksLikePolicyError(error: unknown) {
  const msg = String((error as any)?.message ?? "").toLowerCase();
  return msg.includes("row-level security") || msg.includes("permission denied") || msg.includes("violates row-level security");
}

async function invokeFunctionJson(functionName: string, accessToken: string, body: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let payload: any = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text || null;
  }

  if (!res.ok) {
    const detail =
      typeof payload === "string"
        ? payload
        : String(payload?.error ?? payload?.message ?? `HTTP ${res.status}`);
    throw new Error(detail);
  }

  return payload;
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

function normalizeStoreCode(input: string | null | undefined) {
  const digits = String(input ?? "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.length >= 5 ? digits.slice(0, 5) : digits.padStart(5, "0");
}

async function loadInspectionOrderStoreCodes(workPart?: string) {
  const invokeRes = await supabase.functions.invoke("list-inspection-order-stores", { body: { work_part: workPart ?? "" } });
  const payload = invokeRes.data as { ok?: boolean; store_codes?: string[]; error?: string } | null;
  if (invokeRes.error) throw invokeRes.error;
  if (!payload?.ok) throw new Error(payload?.error || "검수 점포 기준 조회에 실패했습니다.");

  return new Set((payload.store_codes ?? []).map((code) => normalizeStoreCode(code)).filter(Boolean));
}

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
  purpleSoft: "#F5F3FF",
};

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

function isCarWashCategory(c: DriverCategory) {
  return c === "wash";
}

function makeCarWashTarget(carNo: number, stageNo: 1 | 2): StoreMapRow {
  return {
    store_code: `CARWASH-${carNo}-${stageNo}`,
    store_name: `${carNo}호 차량 세차 ${stageNo}차`,
    car_no: carNo,
    seq_no: stageNo,
  };
}

function getDriverCategoryPath(category: DriverCategory, washStage: 1 | 2) {
  if (category === "wash") return `wash${washStage}`;
  return category;
}

function getCarWashDisplayName(storeName: string) {
  return storeName.replace(/^\d+호\s*/, "");
}

function miochulFlagLabels(flags: MiochulFlags) {
  const arr: string[] = [];
  if (flags.redelivery) arr.push("재배송");
  if (flags.damage) arr.push("파손");
  if (flags.other) arr.push("기타");
  return arr;
}

/**
 * ✅ 호차는 무조건 4자리 숫자
 * profiles.car_no (text) 값이 "1801 / 1802" 형태여도 [1801,1802]로 분리.
 */
function parseCarNos(row: any): number[] {
  const out: number[] = [];
  const src = String(row?.car_no ?? "").trim();
  if (src) {
    const matches = src.match(/\d{4}/g) ?? [];
    matches.forEach((m) => {
      const n = Number(m);
      if (!Number.isNaN(n) && n >= 1000 && n <= 9999) out.push(n);
    });
  }
  const uniq = Array.from(new Set(out));
  uniq.sort((a, b) => a - b);
  return uniq;
}

export default function UploadScreen() {
  const router = useRouter();

  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const topPad = Platform.OS === "android" ? Math.max(insets.top, 40) : Math.max(insets.top, 12);
  const bottomPad = tabBarHeight + (Platform.OS === "android" ? 12 : 6);
  const [isDriver, setIsDriver] = useState(false);

  // ===== 공통 =====
  const [selectedStore, setSelectedStore] = useState<StoreMapRow | null>(null);
  const [queueAssets, setQueueAssets] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const queueCount = queueAssets.length;

  const [busy, setBusy] = useState(false);

  const [myWorkPart, setMyWorkPart] = useState<string>("");
  const [canManageWorkPart, setCanManageWorkPart] = useState(false);

  const [doneStoreSet, setDoneStoreSet] = useState<Set<string>>(new Set());
  const [doneLoading, setDoneLoading] = useState(false);

  // ===== 현장 =====
  const [mode, setMode] = useState<Mode>("search");
  const [query, setQuery] = useState("");
  const [storeResults, setStoreResults] = useState<StoreMapRow[]>([]);

  const [inspectQuery, setInspectQuery] = useState("");
  const [inspectStores, setInspectStores] = useState<StoreMapRow[]>([]);
  const [inspectLoading, setInspectLoading] = useState(false);

  // ===== 기사 =====
  const [carNos, setCarNos] = useState<number[]>([]);
  const [carPick, setCarPick] = useState<CarPick | null>(null);
  const [carDropdownOpen, setCarDropdownOpen] = useState(false);

  const [driverStores, setDriverStores] = useState<StoreMapRow[]>([]);
  const [driverLoading, setDriverLoading] = useState(false);

  const [driverCategory, setDriverCategory] = useState<DriverCategory>("bottle");
  const [washStage, setWashStage] = useState<1 | 2>(1);

  // ✅ 미오출
  const [miochulPlanned, setMiochulPlanned] = useState(""); // YYYY-MM-DD
  const [miochulDetail, setMiochulDetail] = useState(""); // 상세내용
  const [miochulFlags, setMiochulFlags] = useState<MiochulFlags>({
    redelivery: false,
    damage: false,
    other: false,
  });
  const [miochulModalOpen, setMiochulModalOpen] = useState(false);
  const [miochulKeyboardHeight, setMiochulKeyboardHeight] = useState(0);
  const miochulScrollRef = useRef<ScrollView>(null);

  // 지원일 때 점포검색
  const [supportQuery, setSupportQuery] = useState("");
  const [supportResults, setSupportResults] = useState<StoreMapRow[]>([]);
  const [supportBusy, setSupportBusy] = useState(false);

  // 관리자 작업파트 설정(현장 유지)
  const [workPartModalOpen, setWorkPartModalOpen] = useState(false);
  const [selectedWorkPartInModal, setSelectedWorkPartInModal] = useState<string>("");
  const workPartOptions = useMemo<Option[]>(() => getWorkPartOptionsExceptDriver(), []);
  const driverPathCategory = getDriverCategoryPath(driverCategory, washStage);

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

  const loadMyProfile = async (userId: string) => {
    const { data, error } = await supabase.from("profiles").select("work_part, car_no, is_admin").eq("id", userId).single();
    if (error) throw error;

    const rawWp = String(data?.work_part ?? "").trim();
    let displayWp = rawWp;
    if (rawWp === "임시직") {
      const todayWp = await getTodayTempWorkPart(userId);
      if (!todayWp) {
        Alert.alert("출근 필요", "임시직은 출근 확인에서 오늘 근무파트를 선택한 뒤 업로드를 사용할 수 있습니다.");
        router.replace("/(tabs)");
        throw new Error("임시직 오늘 근무파트 미선택");
      }
      displayWp = todayWp;
    }

    setMyWorkPart(displayWp);
    setCanManageWorkPart(!!data?.is_admin || rawWp === "관리자");

    const driverFlag = rawWp.includes("기사");
    setIsDriver(driverFlag);

    if (driverFlag) {
      const list = parseCarNos(data);
      setCarNos(list);

      if (list.length >= 1) setCarPick({ kind: "car", carNo: list[0], label: String(list[0]) });
      else setCarPick({ kind: "support", label: "지원" });
    } else {
      setMode("search");
    }

    return displayWp;
  };

  const loadDoneStoresForToday = async (workPart: string, cat?: string) => {
    const session = await requireSession();
    if (!session) return;

    const wp = (workPart ?? "").trim();
    if (!wp) {
      setDoneStoreSet(new Set());
      return;
    }

    setDoneLoading(true);
    try {
      const day = kstNowDateString();
      const { startIso, endIso } = kstDayRangeUtcIso(day);

      if (wp.includes("기사")) {
        let q = supabase
          .from("delivery_photos")
          .select("store_code, created_at, path, created_by")
          .eq("created_by", session.user.id)
          .gte("created_at", startIso)
          .lt("created_at", endIso)
          .limit(5000);

        if (cat) q = (q as any).ilike("path", `${cat}/%`);

        const { data: rows, error } = await q;
        if (error) throw error;

        const done = new Set<string>();
        ((rows ?? []) as any[]).forEach((r) => {
          const storeCode = String(r?.store_code ?? "");
          if (!storeCode) return;
          if (cat) done.add(`${storeCode}:${cat}`);
          else done.add(storeCode);
        });

        setDoneStoreSet(done);
        return;
      }

      let q = supabase
        .from("photos")
        .select("store_code, created_at, category, work_part")
        .eq("work_part", wp)
        .gte("created_at", startIso)
        .lt("created_at", endIso)
        .limit(5000);

      if (cat) q = (q as any).eq("category", cat);

      const { data: photos, error: pErr } = await q;
      if (pErr) throw pErr;

      const done = new Set<string>();
      ((photos ?? []) as any[]).forEach((r) => {
        const storeCode = String(r?.store_code ?? "");
        if (!storeCode) return;
        if (cat) done.add(`${storeCode}:${cat}`);
        else done.add(storeCode);
      });

      setDoneStoreSet(done);
    } catch {
      setDoneStoreSet(new Set());
    } finally {
      setDoneLoading(false);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const session = await requireSession();
        if (!session) return;
        const wp = await loadMyProfile(session.user.id);
        await loadDoneStoresForToday(wp, wp.includes("기사") ? driverPathCategory : undefined);
      } catch (e: any) {
        Alert.alert("초기 로딩 실패", e?.message ?? String(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isDriver) return;
    if (!carPick) return;

    (async () => {
      const wp = (myWorkPart ?? "").trim();
      if (wp) await loadDoneStoresForToday(wp, driverPathCategory);

      if (isCarWashCategory(driverCategory)) {
        if (carPick.kind === "car") {
          const washTargets = [makeCarWashTarget(carPick.carNo, 1), makeCarWashTarget(carPick.carNo, 2)];
          setDriverStores(washTargets);
          const nextSelected =
            selectedStore && selectedStore.store_code.startsWith("CARWASH-")
              ? washTargets.find((item) => item.store_code === selectedStore.store_code) ?? washTargets[0]
              : washTargets[0];
          setSelectedStore(nextSelected);
          setWashStage(nextSelected.seq_no === 2 ? 2 : 1);
        } else {
          setDriverStores([]);
          setSelectedStore(null);
        }
        return;
      }

      if (selectedStore?.store_code.startsWith("CARWASH-")) {
        setSelectedStore(null);
      }

      if (carPick.kind === "car") await loadDriverStoresByCarNo(carPick.carNo);
      else {
        setDriverStores([]);
        setSelectedStore(null);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDriver, carPick?.kind, (carPick as any)?.carNo, driverCategory]);

  useEffect(() => {
    if (isDriver) return;
    if (mode !== "inspect") return;
    if (inspectLoading) return;
    if (inspectStores.length > 0) return;

    void loadInspectStores();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDriver, mode]);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    if (!miochulModalOpen) { setMiochulKeyboardHeight(0); return; }
    const show = Keyboard.addListener("keyboardDidShow", (e) => setMiochulKeyboardHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener("keyboardDidHide", () => setMiochulKeyboardHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, [miochulModalOpen]);

  const loadDriverStoresByCarNo = async (carNo: number) => {
    const session = await requireSession();
    if (!session) return;

    setDriverLoading(true);
    try {
      const { rows, error } = await fetchStoresByCarNo(carNo, 5000);
      if (error) throw error;

      setDriverStores(rows.slice().sort(sortStores));
    } catch (e: any) {
      Alert.alert("호차 점포 로딩 오류", e?.message ?? String(e));
      setDriverStores([]);
    } finally {
      setDriverLoading(false);
    }
  };

  const doSupportStoreSearch = async () => {
    const session = await requireSession();
    if (!session) return;

    Keyboard.dismiss();

    const q = supportQuery.trim();
    if (!q) return Alert.alert("경고", "점포코드 또는 점포명을 입력하세요.");

    setSupportBusy(true);
    try {
      const { rows, error } = await searchStoreMap(q, 200);

      if (error) throw error;

      setSupportResults(rows);
      if (rows.length === 0) Alert.alert("결과 없음", "검색 결과가 없습니다.");
    } catch (e: any) {
      Alert.alert("오류", e?.message ?? String(e));
    } finally {
      setSupportBusy(false);
    }
  };

  const loadInspectStores = async () => {
    const session = await requireSession();
    if (!session) return;

    setInspectLoading(true);
    setInspectStores([]);
    try {
      const wp = (myWorkPart ?? "").trim();
      const [storeResult, orderStoreCodes] = await Promise.all([
        fetchInspectionStores(5000),
        loadInspectionOrderStoreCodes(wp || undefined),
      ]);

      const { rows: inspectionRows, error } = storeResult;
      if (error) throw error;

      let rows = inspectionRows.slice();
      rows = rows.filter((row) => orderStoreCodes.has(normalizeStoreCode(row.store_code)));

      rows.sort(sortStores);
      setInspectStores(rows);

      if (wp) await loadDoneStoresForToday(wp);
    } catch (e: any) {
      Alert.alert("검수 점포 로딩 오류", e?.message ?? String(e));
      setInspectStores([]);
    } finally {
      setInspectLoading(false);
    }
  };

  const doStoreSearch = async () => {
    const session = await requireSession();
    if (!session) return;

    Keyboard.dismiss();

    const q = query.trim();
    if (!q) return Alert.alert("경고", "점포코드 또는 점포명을 입력하세요.");

    setBusy(true);
    try {
      const { rows, error } = await searchStoreMap(q, 200);

      if (error) throw error;

      setStoreResults(rows);
      if (rows.length === 0) Alert.alert("결과 없음", "검색 결과가 없습니다.");

      const wp = (myWorkPart ?? "").trim();
      if (wp) await loadDoneStoresForToday(wp);
    } catch (e: any) {
      Alert.alert("오류", e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const addToQueue = (assets: ImagePicker.ImagePickerAsset[]) => {
    if (!assets || assets.length === 0) return;
    setQueueAssets((prev) => [...prev, ...assets]);
  };

  const removeFromQueue = (uri: string) => setQueueAssets((prev) => prev.filter((a) => a.uri !== uri));
  const clearQueue = () => setQueueAssets([]);

  // ✅ 미오출은 업로드 직전에만 검증
  const ensureMiochulFieldsOk = () => {
    if (!isDriver) return true;
    if (driverCategory !== "miochul") return true;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(miochulPlanned.trim())) {
      Alert.alert("미오출", "납품예정일을 선택하세요.");
      return false;
    }

    const picked = miochulFlagLabels(miochulFlags);
    if (picked.length === 0) {
      Alert.alert("미오출", "재배송/파손/기타 중 최소 1개를 선택하세요.");
      return false;
    }

    if (miochulDetail.trim().length < 1) {
      Alert.alert("미오출", "상세내용을 입력하세요.");
      return false;
    }

    return true;
  };

  const isMiochulReady =
    isDriver &&
    driverCategory === "miochul" &&
    /^\d{4}-\d{2}-\d{2}$/.test(miochulPlanned.trim()) &&
    miochulFlagLabels(miochulFlags).length > 0 &&
    miochulDetail.trim().length > 0;

  const pickMultiFromGalleryToQueue = async () => {
    const session = await requireSession();
    if (!session) return;
    if (!selectedStore) return Alert.alert("경고", "점포를 먼저 선택하세요.");
    if (!ensureMiochulFieldsOk()) return;

    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return Alert.alert("권한 필요", "사진 접근 권한을 허용해주세요.");

    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      selectionLimit: 0,
      quality: 0.9,
    });

    if (picked.canceled) return;
    addToQueue(picked.assets ?? []);
  };

  const takePhotoToQueue = async () => {
    const session = await requireSession();
    if (!session) return;
    if (!selectedStore) return Alert.alert("경고", "점포를 먼저 선택하세요.");
    if (!ensureMiochulFieldsOk()) return;

    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return Alert.alert("권한 필요", "카메라 권한을 허용해주세요.");

    const shot = await ImagePicker.launchCameraAsync({ quality: 0.9 });
    if (shot.canceled) return;
    addToQueue(shot.assets ?? []);
  };

  // ✅ 현장(photos) insert robust
  const insertPhotoRowViaFunction = async (payload: any, minimalPayload: any, accessToken: string) => {
    const response = await invokeFunctionJson("save-upload-photo-record", accessToken, {
        table: "photos",
        access_token: accessToken,
        payload,
        minimal_payload: minimalPayload,
    });
    if (!response?.ok) throw new Error(response?.error || "photos 저장에 실패했습니다.");
  };

  const insertPhotoRowRobust = async (payload: any, minimalPayload: any, accessToken: string) => {
    const { error } = await supabase.from("photos").insert(payload);
    if (!error) return;

    const msg = String((error as any)?.message ?? "");
    const looksLikeMissingColumn =
      msg.toLowerCase().includes("column") || msg.toLowerCase().includes("does not exist") || msg.toLowerCase().includes("schema cache");

    if (looksLikeMissingColumn) {
      const { error: e2 } = await supabase.from("photos").insert(minimalPayload);
      if (!e2) return;
      if (looksLikePolicyError(e2)) {
        await insertPhotoRowViaFunction(payload, minimalPayload, accessToken);
        return;
      }
      throw e2;
    }

    if (looksLikePolicyError(error)) {
      await insertPhotoRowViaFunction(payload, minimalPayload, accessToken);
      return;
    }

    throw error;
  };

  // ✅ 기사(배송) delivery_photos insert robust
  const insertDeliveryPhotoRowViaFunction = async (payload: any, minimalPayload: any, accessToken: string) => {
    const response = await invokeFunctionJson("save-upload-photo-record", accessToken, {
        table: "delivery_photos",
        access_token: accessToken,
        payload,
        minimal_payload: minimalPayload,
    });
    if (!response?.ok) throw new Error(response?.error || "delivery_photos 저장에 실패했습니다.");
  };

  const insertDeliveryPhotoRowRobust = async (payload: any, minimalPayload: any, accessToken: string) => {
    const { error } = await supabase.from("delivery_photos").insert(payload);
    if (!error) return;

    const msg = String((error as any)?.message ?? "");
    const looksLikeMissingColumn =
      msg.toLowerCase().includes("column") || msg.toLowerCase().includes("does not exist") || msg.toLowerCase().includes("schema cache");

    if (looksLikeMissingColumn) {
      const { error: e2 } = await supabase.from("delivery_photos").insert(minimalPayload);
      if (!e2) return;
      if (looksLikePolicyError(e2)) {
        await insertDeliveryPhotoRowViaFunction(payload, minimalPayload, accessToken);
        return;
      }
      throw e2;
    }

    if (looksLikePolicyError(error)) {
      await insertDeliveryPhotoRowViaFunction(payload, minimalPayload, accessToken);
      return;
    }

    throw error;
  };

  const uploadAssets = async (assets: ImagePicker.ImagePickerAsset[]) => {
    const session = await requireSession();
    if (!session) return;

    if (!selectedStore) return Alert.alert("경고", "점포를 먼저 선택/확인해야 업로드가 가능합니다.");
    const allowMetaOnlyUpload = isDriver && driverCategory === "miochul";
    if ((!assets || assets.length === 0) && !allowMetaOnlyUpload) return;
    if (!ensureMiochulFieldsOk()) return;

    const day = kstNowDateString();
    const wp = (myWorkPart ?? "").trim();

    const cat: any = isDriver ? driverPathCategory : "field";

    const plannedDate = isDriver && driverCategory === "miochul" ? miochulPlanned.trim() : null;
    const detail = isDriver && driverCategory === "miochul" ? miochulDetail.trim() : null;
    const flagsPicked = isDriver && driverCategory === "miochul" ? miochulFlagLabels(miochulFlags) : [];

    const carNoForMeta = isDriver && carPick?.kind === "car" ? carPick.carNo : null;

    setBusy(true);
    try {
      let ok = 0;
      let fail = 0;
      const reasons: string[] = [];
      const totalCount = assets.length > 0 ? assets.length : 1;

      const saveDriverRow = async (path: string | null, publicUrl: string | null, bucket: string | null) => {
        const mioMemo =
          driverCategory === "miochul"
            ? `[${flagsPicked.join(", ")}] 납품예정:${plannedDate ?? "-"} / 상세:${detail ?? ""}`
            : null;

        const payload: any = {
          work_date: day,
          car_no: carNoForMeta ? String(carNoForMeta) : null,
          store_code: selectedStore.store_code,
          store_name: selectedStore.store_name,
          memo: mioMemo,
          bucket,
          path,
          public_url: publicUrl,
          created_by: session.user.id,
        };

        const minimal: any = {
          store_code: selectedStore.store_code,
          path,
          public_url: publicUrl,
          created_by: session.user.id,
        };

        await insertDeliveryPhotoRowRobust(payload, minimal, session.access_token);
      };

      if (assets.length === 0 && allowMetaOnlyUpload) {
        try {
          const metaPath = `${cat}/${selectedStore.store_code}/${day}/meta-only-${Date.now()}`;
          await saveDriverRow(metaPath, `meta://${metaPath}`, "delivery_photos");
          ok++;
        } catch (e: any) {
          fail++;
          reasons.push(`(${fail}/${totalCount}) ${e?.message ?? String(e)}`);
        }
      }

      for (let i = 0; i < assets.length; i++) {
        const a = assets[i];
        const uri = a?.uri;
        if (!uri) continue;

        try {
          const fileName = makeSafeFileName();

          const path = `${cat}/${selectedStore.store_code}/${day}/${fileName}`;
          const { buffer: ab, contentType } = await uriToArrayBuffer(uri);

          const targetBucket = isDriver ? "delivery_photos" : "photos";

          const { publicUrl } = await uploadToR2({
            buffer: ab,
            contentType,
            path,
            bucket: targetBucket,
            accessToken: session.access_token,
          });

          if (isDriver) {
            await saveDriverRow(path, publicUrl, targetBucket);
          } else {
            const payload: any = {
              user_id: session.user.id,
              store_code: selectedStore.store_code,
              original_path: path,
              original_url: publicUrl,
              status: "public" as const,
              work_part: wp || null,

              category: cat,
              car_no: carNoForMeta,
              delivery_planned_date: plannedDate,
              extra_note: detail,
            };

            const minimal: any = {
              user_id: session.user.id,
              store_code: selectedStore.store_code,
              original_path: path,
              original_url: publicUrl,
              status: "public" as const,
              work_part: wp || null,
            };

            await insertPhotoRowRobust(payload, minimal, session.access_token);
          }

          ok++;
        } catch (e: any) {
          fail++;
          reasons.push(`(${fail}/${totalCount}) ${e?.message ?? String(e)}`);
        }
      }

      if (ok > 0) {
        if (isDriver) await loadDoneStoresForToday(wp, driverPathCategory);
        else await loadDoneStoresForToday(wp);
      }

      if (fail === 0) Alert.alert("완료", `업로드 성공: ${ok}장`);
      else if (ok === 0) Alert.alert("업로드 실패", `성공 0장 / 실패 ${fail}장\n\n첫 실패:\n${reasons[0]}`);
      else Alert.alert("완료(부분 성공)", `성공 ${ok}장 / 실패 ${fail}장\n\n첫 실패:\n${reasons[0]}`);
    } finally {
      setBusy(false);
    }
  };

  const uploadQueue = async () => {
    if (!selectedStore) return Alert.alert("경고", "점포를 먼저 선택하세요.");
    if (queueAssets.length === 0 && !isMiochulReady) return Alert.alert("경고", "업로드할 사진이 없습니다. 먼저 추가/촬영하세요.");
    if (!ensureMiochulFieldsOk()) return;

    const uploadCountLabel = queueAssets.length > 0 ? `${queueAssets.length}장` : "미오출 설정";
    Alert.alert("업로드", `${uploadCountLabel}을 업로드할까요?`, [
      { text: "취소", style: "cancel" },
      {
        text: "업로드",
        onPress: async () => {
          await uploadAssets(queueAssets);
          clearQueue();
        },
      },
    ]);
  };

  const showWorkPartButton = canManageWorkPart && !isDriver;

  const driverDropdownOptions: CarPick[] = useMemo(() => {
    if (!isDriver) return [];
    const list = carNos ?? [];

    if (list.length === 1) {
      return [
        { kind: "car", carNo: list[0], label: String(list[0]) },
        { kind: "support", label: "지원" },
      ];
    }
    if (list.length >= 2) {
      return [...list.map((n) => ({ kind: "car" as const, carNo: n, label: String(n) })), { kind: "support" as const, label: "지원" }];
    }
    return [{ kind: "support", label: "지원" }];
  }, [isDriver, carNos]);

  const isSupport = isDriver && carPick?.kind === "support";

  const selectedLine = selectedStore
    ? selectedStore.store_code.startsWith("CARWASH-")
      ? getCarWashDisplayName(selectedStore.store_name)
      : `${selectedStore.car_no ?? "-"}-${selectedStore.seq_no ?? "-"} / ${selectedStore.store_code} / ${selectedStore.store_name}`
    : "점포를 선택하세요";

  const renderStoreRow = (item: StoreMapRow) => {
    const isCarWashRow = item.store_code.startsWith("CARWASH-");
    const itemDriverPathCategory = isCarWashRow ? getDriverCategoryPath("wash", item.seq_no === 2 ? 2 : 1) : driverPathCategory;
    const doneKey = isDriver ? `${item.store_code}:${itemDriverPathCategory}` : item.store_code;
    const isDoneToday = doneStoreSet.has(doneKey);
    const isSelected = selectedStore?.store_code === item.store_code;

    const todayDay = parseInt(kstNowDateString().slice(8, 10), 10);
    const isCarWashClosed = isCarWashRow && (
      (item.seq_no === 1 && (todayDay < 1 || todayDay > 10)) ||
      (item.seq_no === 2 && (todayDay < 11 || todayDay > 20))
    );

    return (
      <Pressable
        onPress={() => {
          if (isCarWashClosed) return;
          Keyboard.dismiss();
          if (isCarWashRow) setWashStage(item.seq_no === 2 ? 2 : 1);
          setSelectedStore(item);
        }}
        style={[
          styles.row,
          isSelected && { backgroundColor: THEME.blueSoft, borderBottomColor: "rgba(37,99,235,0.16)" },
          !isSelected && isDoneToday && { backgroundColor: "#F3F4F6" },
          isCarWashClosed && { backgroundColor: "#F9FAFB", opacity: 0.6 },
        ]}
      >
        <View style={styles.rowLeft}>
          <Text style={[styles.rowNo, (isDoneToday || isCarWashClosed) && { color: THEME.subtext }]} numberOfLines={1}>
            {isCarWashRow ? item.car_no ?? "-" : `${item.car_no ?? "-"}-${item.seq_no ?? "-"}`}
          </Text>
        </View>

        <View style={styles.rowMid}>
          {!isCarWashRow ? (
            <Text style={[styles.rowCode, (isDoneToday || isCarWashClosed) && { color: THEME.subtext }]} numberOfLines={1}>
              [{item.store_code}]
            </Text>
          ) : null}
          <Text style={[styles.rowNameBig, (isDoneToday || isCarWashClosed) && { color: THEME.subtext }]} numberOfLines={2} ellipsizeMode="tail">
            {isCarWashRow ? getCarWashDisplayName(item.store_name) : item.store_name}
          </Text>
        </View>

        <View style={styles.rowRight}>
          {isCarWashClosed ? (
            <View style={[styles.donePill, { borderColor: "rgba(156,163,175,0.4)", backgroundColor: "#F3F4F6" }]}>
              <Text style={[styles.doneText, { color: THEME.muted }]}>마감</Text>
            </View>
          ) : isDoneToday ? (
            <View style={styles.donePill}>
              <Ionicons name="checkmark-circle" size={14} color={THEME.success} />
              <Text style={styles.doneText}>완료</Text>
            </View>
          ) : (
            <Ionicons name="chevron-forward" size={18} color={THEME.muted} />
          )}
        </View>
      </Pressable>
    );
  };

  const mioPicked = miochulFlagLabels(miochulFlags);
  const miochulSummary =
    miochulPlanned && mioPicked.length > 0
      ? `납품예정일 ${miochulPlanned} / ${mioPicked.join(", ")}${miochulDetail.trim() ? " / 상세 있음" : ""}`
      : "미오출 정보 미설정";
  const listBottomSpacer = <View style={{ height: 16 }} />;

  const catIconMap: Record<DriverCategory, keyof typeof Ionicons.glyphMap> = {
    bottle: "archive-outline",
    tobacco: "pricetag-outline",
    miochul: "alert-circle-outline",
    wash: "water-outline",
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={undefined}>
        <View style={{ flex: 1 }} onTouchStart={() => Keyboard.dismiss()}>

          {/* ── 헤더 ── */}
          <View style={[styles.header, { paddingTop: topPad }]}>
            <View style={styles.headerRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.headerTitle}>{isDriver ? "기사 업로드" : "사진 업로드"}</Text>
                {!!myWorkPart && <Text style={styles.headerSub} numberOfLines={1}>{myWorkPart}</Text>}
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                {(doneLoading || inspectLoading || driverLoading || supportBusy) && (
                  <ActivityIndicator size="small" color={THEME.blue} />
                )}
                {isDriver && (
                  <Pressable onPress={() => setCarDropdownOpen(true)} disabled={busy} style={[styles.chip, busy && styles.dim]}>
                    <Ionicons name="bus-outline" size={15} color={THEME.blue} />
                    <Text style={styles.chipText}>{carPick?.label ?? "호차"}</Text>
                    <Ionicons name="chevron-down" size={13} color={THEME.blue} />
                  </Pressable>
                )}
                {!isDriver && !!myWorkPart && !showWorkPartButton && (
                  <View style={styles.chip}>
                    <Ionicons name="briefcase-outline" size={15} color={THEME.blue} />
                    <Text style={styles.chipText}>{myWorkPart}</Text>
                  </View>
                )}
                {showWorkPartButton && (
                  <Pressable
                    onPress={() => { Keyboard.dismiss(); setSelectedWorkPartInModal(myWorkPart || ""); setWorkPartModalOpen(true); }}
                    disabled={busy}
                    style={[styles.chip, busy && styles.dim]}
                  >
                    <Ionicons name="settings-outline" size={15} color={THEME.blue} />
                    <Text style={styles.chipText}>파트 설정</Text>
                  </Pressable>
                )}
              </View>
            </View>

            {/* 카테고리 탭 */}
            {isDriver ? (
              <View style={styles.catRow}>
                {(["bottle", "tobacco", "miochul", "wash"] as DriverCategory[]).map((c) => {
                  const on = driverCategory === c;
                  const col = categoryColor(c);
                  return (
                    <Pressable
                      key={c}
                      onPress={async () => {
                        setDriverCategory(c);
                        const wp = (myWorkPart ?? "").trim();
                        if (wp) await loadDoneStoresForToday(wp, getDriverCategoryPath(c, washStage));
                      }}
                      style={[styles.catTab, on && { backgroundColor: col, borderColor: col }]}
                    >
                      <Ionicons name={catIconMap[c]} size={18} color={on ? "#fff" : THEME.muted} />
                      <Text style={[styles.catTabLabel, on && { color: "#fff" }]}>{categoryLabel(c)}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <View style={[styles.catRow, { gap: 12 }]}>
                <Pressable
                  onPress={() => { Keyboard.dismiss(); setMode("search"); setStoreResults([]); }}
                  style={[styles.catTabWide, mode === "search" && { backgroundColor: THEME.blue, borderColor: THEME.blue }]}
                >
                  <Ionicons name="search-outline" size={17} color={mode === "search" ? "#fff" : THEME.subtext} />
                  <Text style={[styles.catTabWideLabel, mode === "search" && { color: "#fff" }]}>검색 선택</Text>
                </Pressable>
                <Pressable
                  onPress={async () => { Keyboard.dismiss(); setMode("inspect"); setInspectQuery(""); await loadInspectStores(); }}
                  style={[styles.catTabWide, mode === "inspect" && { backgroundColor: THEME.blue, borderColor: THEME.blue }]}
                >
                  <Ionicons name="layers-outline" size={17} color={mode === "inspect" ? "#fff" : THEME.subtext} />
                  <Text style={[styles.catTabWideLabel, mode === "inspect" && { color: "#fff" }]}>검수 점포</Text>
                </Pressable>
              </View>
            )}
          </View>

          {/* ── 검색 / 미오출 설정 영역 ── */}
          <View style={styles.searchSection}>
            {isDriver && driverCategory === "miochul" && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Pressable
                  onPress={() => { Keyboard.dismiss(); setMiochulModalOpen(true); }}
                  style={styles.miochulBtn}
                >
                  <Ionicons name="calendar-outline" size={15} color={THEME.purple} />
                  <Text style={styles.miochulBtnText}>미오출 설정</Text>
                  {isMiochulReady
                    ? <Ionicons name="checkmark-circle" size={15} color={THEME.success} />
                    : <Ionicons name="chevron-forward" size={13} color={THEME.purple} />
                  }
                </Pressable>
                <Text style={{ flex: 1, color: THEME.subtext, fontWeight: "800", fontSize: 11 }} numberOfLines={1}>
                  {miochulSummary}
                </Text>
              </View>
            )}

            {isDriver && isSupport && (
              <View style={{ gap: 8 }}>
                <View style={styles.inputWrap}>
                  <Ionicons name="search-outline" size={17} color={THEME.muted} />
                  <TextInput
                    value={supportQuery}
                    onChangeText={setSupportQuery}
                    placeholder="지원: 점포코드 또는 점포명"
                    placeholderTextColor={THEME.muted}
                    style={styles.input}
                    returnKeyType="search"
                    onSubmitEditing={doSupportStoreSearch}
                  />
                  {!!supportQuery && (
                    <Pressable onPress={() => setSupportQuery("")} hitSlop={8}>
                      <Ionicons name="close-circle" size={17} color={THEME.muted} />
                    </Pressable>
                  )}
                </View>
                <TouchableOpacity onPress={doSupportStoreSearch} disabled={supportBusy || busy} style={[styles.searchBtn, (supportBusy || busy) && styles.dim]}>
                  <Ionicons name="search-outline" size={16} color="#fff" />
                  <Text style={styles.searchBtnText}>{supportBusy ? "검색 중..." : "검색"}</Text>
                </TouchableOpacity>
              </View>
            )}

            {!isDriver && mode === "search" && (
              <View style={{ gap: 8 }}>
                <View style={styles.inputWrap}>
                  <Ionicons name="search-outline" size={17} color={THEME.muted} />
                  <TextInput
                    value={query}
                    onChangeText={setQuery}
                    placeholder="점포코드 또는 점포명 검색"
                    placeholderTextColor={THEME.muted}
                    style={styles.input}
                    returnKeyType="search"
                    onSubmitEditing={doStoreSearch}
                  />
                  {!!query && (
                    <Pressable onPress={() => setQuery("")} hitSlop={8}>
                      <Ionicons name="close-circle" size={17} color={THEME.muted} />
                    </Pressable>
                  )}
                </View>
                <TouchableOpacity onPress={doStoreSearch} disabled={busy} style={[styles.searchBtn, busy && styles.dim]}>
                  <Ionicons name="search-outline" size={16} color="#fff" />
                  <Text style={styles.searchBtnText}>{busy ? "검색 중..." : "검색"}</Text>
                </TouchableOpacity>
              </View>
            )}

            {!isDriver && mode === "inspect" && (
              <View style={{ gap: 8 }}>
                <View style={styles.inputWrap}>
                  <Ionicons name="search-outline" size={17} color={THEME.muted} />
                  <TextInput
                    value={inspectQuery}
                    onChangeText={setInspectQuery}
                    placeholder="점포코드 / 점포명 / 호차 / 순번"
                    placeholderTextColor={THEME.muted}
                    style={styles.input}
                  />
                  {!!inspectQuery && (
                    <Pressable onPress={() => setInspectQuery("")} hitSlop={8}>
                      <Ionicons name="close-circle" size={17} color={THEME.muted} />
                    </Pressable>
                  )}
                </View>
                <TouchableOpacity onPress={loadInspectStores} disabled={inspectLoading || busy} style={[styles.searchBtn, (inspectLoading || busy) && styles.dim]}>
                  <Ionicons name="refresh" size={16} color="#fff" />
                  <Text style={styles.searchBtnText}>{inspectLoading ? "불러오는 중..." : "새로고침"}</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* ── 점포 목록 ── */}
          <View style={{ flex: 1, paddingHorizontal: 14, paddingBottom: 6 }}>
            <View style={[styles.listBox, { flex: 1 }]}>
              {isDriver ? (
                isSupport ? (
                  <FlatList
                    data={supportResults}
                    keyExtractor={(item) => item.store_code}
                    nestedScrollEnabled
                    keyboardShouldPersistTaps="handled"
                    removeClippedSubviews
                    initialNumToRender={15}
                    ListFooterComponent={listBottomSpacer}
                    ListEmptyComponent={
                      <View style={styles.listEmpty}>
                        <Ionicons name="search-outline" size={24} color={THEME.muted} />
                        <Text style={styles.listEmptyText}>검색 결과가 여기에 표시됩니다.</Text>
                      </View>
                    }
                    renderItem={({ item }) => renderStoreRow(item)}
                  />
                ) : driverLoading ? (
                  <View style={styles.listEmpty}><ActivityIndicator color={THEME.blue} /></View>
                ) : (
                  <FlatList
                    data={driverStores}
                    keyExtractor={(item) => item.store_code}
                    nestedScrollEnabled
                    keyboardShouldPersistTaps="handled"
                    removeClippedSubviews
                    initialNumToRender={15}
                    ListFooterComponent={listBottomSpacer}
                    ListEmptyComponent={
                      <View style={styles.listEmpty}>
                        <Ionicons name="bus-outline" size={24} color={THEME.muted} />
                        <Text style={styles.listEmptyText}>호차 점포가 없습니다.</Text>
                      </View>
                    }
                    renderItem={({ item }) => renderStoreRow(item)}
                  />
                )
              ) : mode === "search" ? (
                <FlatList
                  data={storeResults}
                  keyExtractor={(item) => item.store_code}
                  nestedScrollEnabled
                  keyboardShouldPersistTaps="handled"
                  removeClippedSubviews
                  initialNumToRender={15}
                  ListFooterComponent={listBottomSpacer}
                  ListEmptyComponent={
                    <View style={styles.listEmpty}>
                      <Ionicons name="search-outline" size={24} color={THEME.muted} />
                      <Text style={styles.listEmptyText}>검색 결과가 여기에 표시됩니다.</Text>
                    </View>
                  }
                  renderItem={({ item }) => renderStoreRow(item)}
                />
              ) : inspectLoading ? (
                <View style={styles.listEmpty}><ActivityIndicator color={THEME.blue} /></View>
              ) : (
                <FlatList
                  data={inspectStores.filter((s) => {
                    const q = inspectQuery.trim().toLowerCase();
                    if (!q) return true;
                    const code = (s.store_code ?? "").toLowerCase();
                    const name = (s.store_name ?? "").toLowerCase();
                    const car = String(s.car_no ?? "");
                    const seq = String(s.seq_no ?? "");
                    return code.includes(q) || name.includes(q) || car.includes(q) || seq.includes(q);
                  })}
                  keyExtractor={(item) => item.store_code}
                  nestedScrollEnabled
                  keyboardShouldPersistTaps="handled"
                  removeClippedSubviews
                  initialNumToRender={15}
                  ListFooterComponent={listBottomSpacer}
                  ListEmptyComponent={
                    <View style={styles.listEmpty}>
                      <Ionicons name="layers-outline" size={24} color={THEME.muted} />
                      <Text style={styles.listEmptyText}>검수 점포 결과가 없습니다.</Text>
                    </View>
                  }
                  renderItem={({ item }) => renderStoreRow(item)}
                />
              )}
            </View>
          </View>

          {/* ── 업로드 패널 ── */}
          <View style={[styles.uploadPanel, { paddingBottom: bottomPad }]}>
            {/* 선택된 점포 */}
            <View style={styles.storeBar}>
              <View style={[styles.storeBarDot, { backgroundColor: selectedStore ? THEME.blue : THEME.border }]} />
              <Text
                style={[styles.storeBarText, !selectedStore && { color: THEME.muted }]}
                numberOfLines={1}
              >
                {selectedLine}
              </Text>
              {queueCount > 0 && (
                <View style={styles.countBadge}>
                  <Text style={styles.countBadgeText}>{queueCount}장</Text>
                </View>
              )}
              <Pressable
                onPress={() => setQueueAssets([])}
                disabled={busy || queueCount === 0}
                style={[styles.trashBtn, (busy || queueCount === 0) && styles.dim]}
                hitSlop={10}
              >
                <Ionicons name="trash-outline" size={17} color={queueCount > 0 ? THEME.danger : THEME.muted} />
              </Pressable>
            </View>

            {/* 사진 큐 */}
            {queueCount > 0 ? (
              <FlatList
                data={queueAssets}
                keyExtractor={(item) => item.uri}
                horizontal
                keyboardShouldPersistTaps="handled"
                showsHorizontalScrollIndicator={false}
                style={{ height: 104 }}
                contentContainerStyle={{ gap: 10, paddingHorizontal: 2, paddingVertical: 2 }}
                renderItem={({ item }) => (
                  <View style={{ width: 76 }}>
                    <Image source={{ uri: item.uri }} style={styles.queueThumb} />
                    <Pressable onPress={() => removeFromQueue(item.uri)} disabled={busy} style={[styles.thumbX, busy && styles.dim]}>
                      <Ionicons name="close" size={12} color={THEME.text} />
                      <Text style={styles.thumbXText}>삭제</Text>
                    </Pressable>
                  </View>
                )}
              />
            ) : (
              <View style={styles.queueEmpty}>
                <Ionicons name="images-outline" size={18} color={THEME.muted} />
                <Text style={styles.queueEmptyText}>추가된 사진이 없습니다</Text>
              </View>
            )}

            {/* 갤러리 / 카메라 */}
            <View style={{ flexDirection: "row", gap: 10 }}>
              <TouchableOpacity
                onPress={pickMultiFromGalleryToQueue}
                disabled={!selectedStore || busy}
                style={[styles.addBtn, (!selectedStore || busy) && styles.dim]}
              >
                <Ionicons name="images-outline" size={17} color={THEME.blue} />
                <Text style={styles.addBtnText}>갤러리 추가</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={takePhotoToQueue}
                disabled={!selectedStore || busy}
                style={[styles.addBtn, (!selectedStore || busy) && styles.dim]}
              >
                <Ionicons name="camera-outline" size={17} color={THEME.blue} />
                <Text style={styles.addBtnText}>카메라 촬영</Text>
              </TouchableOpacity>
            </View>

            {/* 업로드 */}
            <TouchableOpacity
              onPress={uploadQueue}
              disabled={!selectedStore || busy || (queueCount === 0 && !isMiochulReady)}
              style={[styles.uploadBtn, (!selectedStore || busy || (queueCount === 0 && !isMiochulReady)) && styles.dim]}
            >
              {busy
                ? <ActivityIndicator color="#fff" size="small" />
                : <Ionicons name="cloud-upload-outline" size={20} color="#fff" />
              }
              <Text style={styles.uploadBtnText}>
                {busy ? "업로드 중..." : queueCount > 0 ? `업로드  ${queueCount}장` : "미오출 업로드"}
              </Text>
            </TouchableOpacity>
          </View>

          {/* ── 호차 선택 모달 ── */}
          <Modal visible={carDropdownOpen} transparent animationType="fade" onRequestClose={() => setCarDropdownOpen(false)}>
            <Pressable style={styles.backdrop} onPress={() => setCarDropdownOpen(false)} />
            <View style={[styles.modalBox, { top: topPad + 64 }]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>호차 선택</Text>
                <Pressable onPress={() => setCarDropdownOpen(false)} style={styles.iconBtn}>
                  <Ionicons name="close" size={18} color={THEME.text} />
                </Pressable>
              </View>
              <View style={{ padding: 14, gap: 10 }}>
                {driverDropdownOptions.map((opt, idx) => {
                  const isOn =
                    (carPick?.kind === opt.kind && opt.kind === "support" && carPick?.label === opt.label) ||
                    (carPick?.kind === "car" && opt.kind === "car" && (carPick as any).carNo === (opt as any).carNo);
                  return (
                    <Pressable
                      key={`${opt.label}-${idx}`}
                      onPress={() => { setCarPick(opt); setCarDropdownOpen(false); setSelectedStore(null); setQueueAssets([]); setSupportResults([]); }}
                      style={[styles.pill, isOn && { borderColor: "rgba(37,99,235,0.55)", backgroundColor: THEME.blueSoft }]}
                    >
                      <Text style={[styles.pillText, isOn && { color: THEME.blue }]}>{opt.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </Modal>

          {/* ── 미오출 설정 모달 ── */}
          <Modal visible={miochulModalOpen} transparent animationType="fade" onRequestClose={() => setMiochulModalOpen(false)}>
            <Pressable style={styles.backdrop} onPress={() => setMiochulModalOpen(false)} />
            <View style={[styles.modalBoxLarge, { top: Platform.OS === "android" && miochulKeyboardHeight > 0 ? 20 : topPad + 20 }]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>미오출 설정</Text>
                <Pressable onPress={() => setMiochulModalOpen(false)} style={styles.iconBtn}>
                  <Ionicons name="close" size={18} color={THEME.text} />
                </Pressable>
              </View>
              <ScrollView
                ref={miochulScrollRef}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                style={Platform.OS === "android" && miochulKeyboardHeight > 0 ? { maxHeight: 400 } : undefined}
                contentContainerStyle={{ padding: 12, gap: 10 }}
              >
                <Text style={{ fontWeight: "900", color: THEME.text, fontSize: 12 }}>납품예정일</Text>
                <Calendar
                  onDayPress={(day) => setMiochulPlanned(day.dateString)}
                  markedDates={miochulPlanned ? { [miochulPlanned]: { selected: true, selectedColor: THEME.purple } } : undefined}
                  theme={{ todayTextColor: THEME.purple, arrowColor: THEME.purple }}
                />
                <Text style={{ fontWeight: "900", color: THEME.text, fontSize: 12, marginTop: 6 }}>구분</Text>
                <View style={{ flexDirection: "row", gap: 10 }}>
                  {(["redelivery", "damage", "other"] as const).map((flag) => {
                    const labels = { redelivery: "재배송", damage: "파손", other: "기타" };
                    const on = miochulFlags[flag];
                    return (
                      <Pressable
                        key={flag}
                        onPress={() => setMiochulFlags((p) => ({ ...p, [flag]: !p[flag] }))}
                        style={[styles.flagPill, on && { borderColor: "rgba(124,58,237,0.45)", backgroundColor: THEME.purpleSoft }]}
                      >
                        <Ionicons name={on ? "checkbox" : "square-outline"} size={16} color={THEME.purple} />
                        <Text style={[styles.flagText, on && { color: THEME.purple }]}>{labels[flag]}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Text style={{ fontWeight: "900", color: THEME.text, fontSize: 12, marginTop: 6 }}>상세내용</Text>
                <View style={[styles.inputWrap, { height: 110, alignItems: "flex-start", paddingTop: 10 }]}>
                  <Ionicons name="document-text-outline" size={18} color={THEME.subtext} />
                  <TextInput
                    value={miochulDetail}
                    onChangeText={setMiochulDetail}
                    placeholder="상세내용을 입력하세요"
                    placeholderTextColor={THEME.muted}
                    style={[styles.input, { paddingTop: 0, height: 104 }]}
                    multiline
                    onFocus={() => Platform.OS === "android" && setTimeout(() => miochulScrollRef.current?.scrollToEnd({ animated: true }), 200)}
                  />
                </View>
                <View style={{ flexDirection: "row", gap: 10, marginTop: 6 }}>
                  <Pressable
                    onPress={() => { setMiochulPlanned(""); setMiochulDetail(""); setMiochulFlags({ redelivery: false, damage: false, other: false }); }}
                    style={[styles.modalBtn, styles.modalBtnGhost]}
                  >
                    <Text style={styles.modalBtnText}>초기화</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      if (!/^\d{4}-\d{2}-\d{2}$/.test(miochulPlanned.trim())) return Alert.alert("미오출", "납품예정일을 선택하세요.");
                      if (miochulFlagLabels(miochulFlags).length === 0) return Alert.alert("미오출", "재배송/파손/기타 중 최소 1개를 선택하세요.");
                      if (miochulDetail.trim().length < 1) return Alert.alert("미오출", "상세내용을 입력하세요.");
                      setMiochulModalOpen(false);
                    }}
                    style={[styles.modalBtn, { backgroundColor: THEME.purple }]}
                  >
                    <Text style={styles.modalBtnTextWhite}>저장</Text>
                  </Pressable>
                </View>
                <Text style={styles.modalFoot}>
                  현재: {miochulPlanned || "-"} / {miochulFlagLabels(miochulFlags).join(", ") || "-"} / 상세: {miochulDetail.trim() ? "있음" : "-"}
                </Text>
              </ScrollView>
            </View>
          </Modal>

          {/* ── 작업파트 설정 모달 ── */}
          <Modal visible={workPartModalOpen} transparent animationType="fade" onRequestClose={() => setWorkPartModalOpen(false)}>
            <Pressable style={styles.backdrop} onPress={() => { Keyboard.dismiss(); setWorkPartModalOpen(false); }} />
            <View style={[styles.modalBox, { top: topPad + 84 }]}>
              <View style={styles.modalHeader}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Ionicons name="settings-outline" size={18} color={THEME.text} />
                  <Text style={styles.modalTitle}>작업파트 설정(관리자)</Text>
                </View>
                <Pressable onPress={() => setWorkPartModalOpen(false)} style={styles.iconBtn}>
                  <Ionicons name="close" size={18} color={THEME.text} />
                </Pressable>
              </View>
              <View style={{ padding: 14, gap: 10 }}>
                <Text style={styles.modalDesc}>회원가입 작업파트 목록에서 "기사"만 제외한 옵션입니다.</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                  {workPartOptions.map((o) => {
                    const selected = selectedWorkPartInModal === o.value;
                    return (
                      <Pressable
                        key={o.value}
                        onPress={() => setSelectedWorkPartInModal(o.value)}
                        style={[styles.pill, selected && { borderColor: "rgba(37,99,235,0.55)", backgroundColor: THEME.blueSoft }]}
                      >
                        <Text style={[styles.pillText, selected && { color: THEME.blue }]}>{o.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
                  <Pressable onPress={() => setWorkPartModalOpen(false)} style={[styles.modalBtn, styles.modalBtnGhost]}>
                    <Text style={styles.modalBtnText}>취소</Text>
                  </Pressable>
                  <Pressable
                    onPress={async () => {
                      const session = await requireSession();
                      if (!session) return;
                      const wp = (selectedWorkPartInModal ?? "").trim();
                      if (!wp) return Alert.alert("작업파트", "작업파트를 선택하세요.");
                      setBusy(true);
                      try {
                        const { error } = await supabase.from("profiles").upsert({ id: session.user.id, work_part: wp }, { onConflict: "id" });
                        if (error) throw error;
                        setMyWorkPart(wp);
                        await loadDoneStoresForToday(wp);
                        setWorkPartModalOpen(false);
                        Alert.alert("완료", `작업파트가 "${wp}"로 저장되었습니다.`);
                      } catch (e: any) {
                        Alert.alert("작업파트 저장 실패", e?.message ?? String(e));
                      } finally {
                        setBusy(false);
                      }
                    }}
                    disabled={busy || !selectedWorkPartInModal}
                    style={[styles.modalBtn, styles.modalBtnPrimary, (busy || !selectedWorkPartInModal) && styles.dim]}
                  >
                    <Text style={styles.modalBtnTextWhite}>{busy ? "저장 중..." : "저장"}</Text>
                  </Pressable>
                </View>
                <Text style={styles.modalFoot}>
                  현재: {myWorkPart || "-"} / 선택: {selectedWorkPartInModal || "-"}
                </Text>
              </View>
            </View>
          </Modal>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: THEME.bg },
  dim: { opacity: 0.5 },

  // ── 헤더 ──
  header: {
    backgroundColor: THEME.surface,
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
    gap: 12,
  },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  headerTitle: { fontSize: 22, fontWeight: "900", color: THEME.text, letterSpacing: -0.3 },
  headerSub: { fontSize: 12, color: THEME.subtext, fontWeight: "800", marginTop: 2 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(37,99,235,0.25)",
    backgroundColor: THEME.blueSoft,
  },
  chipText: { fontWeight: "900", color: THEME.blue, fontSize: 12 },

  // 카테고리 탭 (기사 — 4칸)
  catRow: { flexDirection: "row", gap: 8 },
  catTab: {
    flex: 1,
    height: 58,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: THEME.border,
    backgroundColor: THEME.soft,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  catTabLabel: { fontWeight: "900", fontSize: 12, color: THEME.subtext },

  // 카테고리 탭 (현장 — 2칸)
  catTabWide: {
    flex: 1,
    height: 50,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: THEME.border,
    backgroundColor: THEME.soft,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  catTabWideLabel: { fontWeight: "900", fontSize: 14, color: THEME.subtext },

  // ── 검색 영역 ──
  searchSection: {
    backgroundColor: THEME.surface,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
    gap: 8,
  },
  inputWrap: {
    height: 46,
    borderWidth: 1,
    borderColor: THEME.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    backgroundColor: THEME.soft,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  input: { flex: 1, color: THEME.text, fontWeight: "900", fontSize: 13, paddingVertical: 0 },
  searchBtn: {
    height: 44,
    borderRadius: 12,
    backgroundColor: THEME.blue,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  searchBtnText: { color: "#fff", fontWeight: "900", fontSize: 13 },
  miochulBtn: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(124,58,237,0.3)",
    backgroundColor: THEME.purpleSoft,
  },
  miochulBtnText: { color: THEME.purple, fontWeight: "900", fontSize: 13 },

  // ── 목록 ──
  listBox: {
    borderWidth: 1,
    borderColor: THEME.border,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: THEME.surface,
  },
  listEmpty: { alignItems: "center", justifyContent: "center", gap: 10, padding: 32 },
  listEmptyText: { color: THEME.subtext, fontWeight: "800", fontSize: 13 },

  row: {
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
    backgroundColor: THEME.surface,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  rowLeft: { width: 58 },
  rowNo: { fontWeight: "900", color: THEME.text, fontSize: 12 },
  rowMid: { flex: 1, paddingRight: 6 },
  rowCode: { fontWeight: "900", color: THEME.subtext, fontSize: 11, marginBottom: 2 },
  rowNameBig: { fontWeight: "900", color: THEME.text, fontSize: 14, lineHeight: 19 },
  rowRight: { alignItems: "flex-end", justifyContent: "center" },
  donePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    height: 28,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(22,163,74,0.25)",
    backgroundColor: THEME.successSoft,
  },
  doneText: { fontWeight: "900", color: THEME.success, fontSize: 12 },

  // ── 업로드 패널 ──
  uploadPanel: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: THEME.border,
    backgroundColor: THEME.surface,
    gap: 10,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -3 },
    elevation: 6,
  },
  storeBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: THEME.border,
    backgroundColor: THEME.soft,
  },
  storeBarDot: { width: 10, height: 10, borderRadius: 5 },
  storeBarText: { flex: 1, fontWeight: "900", fontSize: 13, color: THEME.text },
  countBadge: {
    paddingHorizontal: 10,
    height: 26,
    borderRadius: 999,
    backgroundColor: THEME.blue,
    alignItems: "center",
    justifyContent: "center",
  },
  countBadgeText: { color: "#fff", fontWeight: "900", fontSize: 12 },
  trashBtn: { padding: 4 },
  queueThumb: { width: 76, height: 76, borderRadius: 14, backgroundColor: "#F3F4F6" },
  thumbX: {
    marginTop: 5,
    height: 24,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: THEME.border,
    backgroundColor: THEME.soft,
    flexDirection: "row",
    gap: 3,
  },
  thumbXText: { fontWeight: "900", color: THEME.text, fontSize: 11 },
  queueEmpty: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 },
  queueEmptyText: { color: THEME.muted, fontWeight: "800", fontSize: 13 },
  addBtn: {
    flex: 1,
    height: 46,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: THEME.blue,
    backgroundColor: THEME.surface,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  addBtnText: { color: THEME.blue, fontWeight: "900", fontSize: 13 },
  uploadBtn: {
    height: 54,
    borderRadius: 16,
    backgroundColor: THEME.success,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 10,
  },
  uploadBtnText: { color: "#fff", fontWeight: "900", fontSize: 16 },

  // ── 모달 공통 ──
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
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
  modalBoxLarge: {
    position: "absolute",
    left: 12,
    right: 12,
    backgroundColor: THEME.surface,
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: THEME.border,
  },
  modalHeader: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
    backgroundColor: THEME.soft,
  },
  modalTitle: { fontSize: 14, fontWeight: "900", color: THEME.text },
  modalDesc: { color: THEME.subtext, fontWeight: "800", fontSize: 12, lineHeight: 16 },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: THEME.border,
    backgroundColor: THEME.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  pill: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: THEME.border,
    backgroundColor: THEME.surface,
  },
  pillText: { fontWeight: "900", color: THEME.text },
  flagPill: {
    flex: 1,
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: THEME.border,
    backgroundColor: THEME.surface,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
  },
  flagText: { fontWeight: "900", color: THEME.text, fontSize: 12 },
  modalBtn: { flex: 1, height: 46, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  modalBtnGhost: { borderWidth: 1, borderColor: THEME.border, backgroundColor: THEME.surface },
  modalBtnPrimary: { backgroundColor: THEME.blue },
  modalBtnText: { fontWeight: "900", color: THEME.text },
  modalBtnTextWhite: { fontWeight: "900", color: "#fff" },
  modalFoot: { color: THEME.muted, fontSize: 11, textAlign: "center", marginTop: 6, fontWeight: "800" },
});
