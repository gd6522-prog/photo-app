import { Buffer } from "buffer";
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Modal,
  Pressable,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  FlatList,
  StyleSheet,
  Image,
} from "react-native";
import { supabase } from "../../src/lib/supabase";
import { getWorkPartOptionsExceptDriver, Option } from "../../src/lib/workParts";
import { Ionicons } from "@expo/vector-icons";

import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";

export const options = { headerShown: false };

type Mode = "search" | "inspect";

type StoreMapRow = {
  store_code: string;
  store_name: string;
  car_no: number | null;
  seq_no: number | null;
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
};

export default function UploadScreen() {
  const router = useRouter();

  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();

  const topPad = Math.min(Math.max(insets.top, 6), 18) + 4;

  /**
   * ✅ 핵심 변경:
   * - bottomWrap을 absolute로 "떠있게" 만들고
   * - FlatList 영역은 paddingBottom으로 bottomWrap 높이만큼 예약
   *
   * 이렇게 하면 "가운데 리스트"는 줄어들지 않고 넓게 유지됨.
   */
  const bottomPad = Math.max(insets.bottom, 2) + 10;

  // bottomWrap이 대략 차지하는 높이(기기별 약간 차이 있으니 넉넉히)
  const BOTTOM_EST_HEIGHT = 270;
  const listReserveBottom = tabBarHeight + bottomPad + BOTTOM_EST_HEIGHT;

  const [mode, setMode] = useState<Mode>("search");

  const [query, setQuery] = useState("");
  const [storeResults, setStoreResults] = useState<StoreMapRow[]>([]);

  const [inspectQuery, setInspectQuery] = useState("");
  const [inspectStores, setInspectStores] = useState<StoreMapRow[]>([]);
  const [inspectLoading, setInspectLoading] = useState(false);

  const [selectedStore, setSelectedStore] = useState<StoreMapRow | null>(null);
  const [busy, setBusy] = useState(false);

  const [myWorkPart, setMyWorkPart] = useState<string>("");

  const [doneStoreSet, setDoneStoreSet] = useState<Set<string>>(new Set());
  const [doneLoading, setDoneLoading] = useState(false);

  const [workPartModalOpen, setWorkPartModalOpen] = useState(false);
  const [selectedWorkPartInModal, setSelectedWorkPartInModal] = useState<string>("");

  const workPartOptions = useMemo<Option[]>(() => getWorkPartOptionsExceptDriver(), []);

  const [queueAssets, setQueueAssets] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const queueCount = queueAssets.length;

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

  const loadMyWorkPart = async (userId: string) => {
    const { data, error } = await supabase.from("profiles").select("work_part").eq("id", userId).single();
    if (error) throw error;
    const wp = (data?.work_part ?? "").trim();
    setMyWorkPart(wp);
    return wp;
  };

  const loadDoneStoresForToday = async (workPart: string) => {
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

      const { data: photos, error: pErr } = await supabase
        .from("photos")
        .select("store_code, work_part, created_at")
        .eq("work_part", wp)
        .gte("created_at", startIso)
        .lt("created_at", endIso)
        .limit(5000);

      if (pErr) throw pErr;

      const done = new Set<string>();
      ((photos ?? []) as any[]).forEach((r) => {
        const storeCode = String(r?.store_code ?? "");
        if (storeCode) done.add(storeCode);
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
        const wp = await loadMyWorkPart(session.user.id);
        await loadDoneStoresForToday(wp);
      } catch {}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadInspectStores = async () => {
    const session = await requireSession();
    if (!session) return;

    setInspectLoading(true);
    try {
      let wp = (myWorkPart ?? "").trim();
      if (!wp) wp = await loadMyWorkPart(session.user.id);

      const { data, error } = await supabase
        .from("store_map")
        .select("store_code, store_name, car_no, seq_no")
        .eq("is_inspection", true)
        .limit(5000);

      if (error) throw error;

      const rows = ((data ?? []) as StoreMapRow[]).slice().sort(sortStores);
      setInspectStores(rows);

      await loadDoneStoresForToday(wp);
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
    if (!q) {
      Alert.alert("경고", "점포코드 또는 점포명을 입력하세요.");
      return;
    }

    setBusy(true);
    try {
      let wp = (myWorkPart ?? "").trim();
      if (!wp) wp = await loadMyWorkPart(session.user.id);
      await loadDoneStoresForToday(wp);

      const like = `%${q}%`;
      const { data, error } = await supabase
        .from("store_map")
        .select("store_code, store_name, car_no, seq_no")
        .or(`store_code.ilike.${like},store_name.ilike.${like}`)
        .order("car_no", { ascending: true, nullsFirst: false })
        .order("seq_no", { ascending: true, nullsFirst: false })
        .limit(200);

      if (error) throw error;

      const rows = ((data ?? []) as StoreMapRow[]).slice().sort(sortStores);
      setStoreResults(rows);
      if (rows.length === 0) Alert.alert("결과 없음", "검색 결과가 없습니다.");
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

  const pickMultiFromGalleryToQueue = async () => {
    const session = await requireSession();
    if (!session) return;
    if (!selectedStore) return Alert.alert("경고", "점포를 먼저 선택하세요.");

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

    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return Alert.alert("권한 필요", "카메라 권한을 허용해주세요.");

    const shot = await ImagePicker.launchCameraAsync({ quality: 0.9 });
    if (shot.canceled) return;
    addToQueue(shot.assets ?? []);
  };

  const uploadAssets = async (assets: ImagePicker.ImagePickerAsset[]) => {
    const session = await requireSession();
    if (!session) return;

    if (!selectedStore) return Alert.alert("경고", "점포를 먼저 선택/확인해야 업로드가 가능합니다.");
    if (!assets || assets.length === 0) return;

    let wp = (myWorkPart ?? "").trim();
    if (!wp) {
      try {
        wp = await loadMyWorkPart(session.user.id);
      } catch {
        wp = "";
      }
    }

    setBusy(true);
    try {
      let ok = 0;
      let fail = 0;
      const reasons: string[] = [];

      for (let i = 0; i < assets.length; i++) {
        const a = assets[i];
        const uri = a?.uri;
        if (!uri) continue;

        try {
          const contentType = guessContentType(uri);

          const day = kstNowDateString();
          const fileName = makeSafeFileName();
          const path = `${selectedStore.store_code}/${day}/${fileName}`;

          const ab = await uriToArrayBuffer(uri);

          const { error: upErr } = await supabase.storage.from("photos").upload(path, ab, {
            contentType,
            upsert: false,
          });
          if (upErr) throw upErr;

          const { data: pub } = supabase.storage.from("photos").getPublicUrl(path);
          const publicUrl = pub.publicUrl;

          const payload: any = {
            user_id: session.user.id,
            store_code: selectedStore.store_code,
            original_path: path,
            original_url: publicUrl,
            status: "public" as const,
            work_part: wp || null,
          };

          const { error: insErr } = await supabase.from("photos").insert(payload);
          if (insErr) throw insErr;

          ok++;
        } catch (e: any) {
          fail++;
          reasons.push(`(${fail}/${assets.length}) ${e?.message ?? String(e)}`);
        }
      }

      if (ok > 0) await loadDoneStoresForToday(wp);

      if (fail === 0) Alert.alert("완료", `업로드 성공: ${ok}장`);
      else if (ok === 0) Alert.alert("업로드 실패", `성공 0장 / 실패 ${fail}장\n\n첫 실패:\n${reasons[0]}`);
      else Alert.alert("완료(부분 성공)", `성공 ${ok}장 / 실패 ${fail}장\n\n첫 실패:\n${reasons[0]}`);
    } finally {
      setBusy(false);
    }
  };

  const uploadQueue = async () => {
    if (!selectedStore) return Alert.alert("경고", "점포를 먼저 선택하세요.");
    if (queueAssets.length === 0) return Alert.alert("경고", "업로드할 사진이 없습니다. 먼저 추가/촬영하세요.");

    const count = queueAssets.length;
    Alert.alert("업로드", `${count}장을 업로드할까요?`, [
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

  const showWorkPartButton = myWorkPart === "관리자";

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

  const selectedLine = selectedStore
    ? `${selectedStore.car_no ?? "-"}-${selectedStore.seq_no ?? "-"} / ${selectedStore.store_code} / ${selectedStore.store_name}`
    : "점포를 선택하세요";

  const renderStoreRow = (item: StoreMapRow) => {
    const isDoneToday = doneStoreSet.has(item.store_code);
    const isSelected = selectedStore?.store_code === item.store_code;

    return (
      <Pressable
        onPress={() => {
          Keyboard.dismiss();
          setSelectedStore(item);
        }}
        style={[
          styles.row,
          isSelected && { backgroundColor: THEME.blueSoft, borderBottomColor: "rgba(37,99,235,0.16)" },
          !isSelected && isDoneToday && { backgroundColor: "#F3F4F6" },
        ]}
      >
        <View style={styles.rowLeft}>
          <Text style={[styles.rowNo, isDoneToday && { color: THEME.subtext }]} numberOfLines={1}>
            {item.car_no ?? "-"}-{item.seq_no ?? "-"}
          </Text>
        </View>

        <View style={styles.rowMid}>
          <Text style={[styles.rowCode, isDoneToday && { color: THEME.subtext }]} numberOfLines={1}>
            [{item.store_code}]
          </Text>
          <Text style={[styles.rowNameBig, isDoneToday && { color: THEME.subtext }]} numberOfLines={2} ellipsizeMode="tail">
            {item.store_name}
          </Text>
        </View>

        <View style={styles.rowRight}>
          {isDoneToday ? (
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

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <View style={[styles.headerWrap, { paddingTop: topPad }]}>
        <View style={styles.headerTopRow}>
          <Text style={styles.headerTitleLeft}>사진 업로드</Text>

          <View style={{ marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 10 }}>
            {(doneLoading || inspectLoading) && <ActivityIndicator />}

            {showWorkPartButton && (
              <Pressable
                onPress={() => {
                  Keyboard.dismiss();
                  setSelectedWorkPartInModal(myWorkPart || "");
                  setWorkPartModalOpen(true);
                }}
                style={[styles.headerChip, busy && { opacity: 0.6 }]}
                disabled={busy}
              >
                <Ionicons name="settings-outline" size={16} color={THEME.blue} />
                <Text style={styles.headerChipText}>작업파트 설정</Text>
              </Pressable>
            )}
          </View>
        </View>

        <Text style={styles.h2}>
          점포 선택 → 사진 추가 → 업로드.{" "}
          <Text style={{ color: THEME.subtext, fontWeight: "800" }}>(작업파트: {myWorkPart || "-"})</Text>
        </Text>

        <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
          <TouchableOpacity
            onPress={() => {
              Keyboard.dismiss();
              setMode("search");
              setStoreResults([]);
            }}
            style={[styles.segBtn, mode === "search" && styles.segBtnOn]}
          >
            <Text style={[styles.segText, mode === "search" && styles.segTextOn]}>검색 선택</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={async () => {
              Keyboard.dismiss();
              setMode("inspect");
              setInspectQuery("");
              await loadInspectStores();
            }}
            style={[styles.segBtn, mode === "inspect" && styles.segBtnOn]}
          >
            <Text style={[styles.segText, mode === "inspect" && styles.segTextOn]}>검수 점포</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          {mode === "search" ? (
            <>
              <Text style={styles.cardTitle}>점포 검색</Text>

              <View style={styles.inputWrap}>
                <Ionicons name="search-outline" size={18} color={THEME.subtext} />
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
                  <Pressable onPress={() => setQuery("")} style={{ padding: 6 }} hitSlop={8}>
                    <Ionicons name="close-circle" size={18} color={THEME.muted} />
                  </Pressable>
                )}
              </View>

              <TouchableOpacity onPress={doStoreSearch} disabled={busy} style={[styles.btn, styles.btnPrimary, busy && styles.dim]}>
                <View style={styles.btnInner}>
                  <Ionicons name="search-outline" size={18} color="#fff" />
                  <Text style={styles.btnTextWhite}>{busy ? "검색중..." : "검색"}</Text>
                </View>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.cardTitle}>검수 점포 목록</Text>

              <View style={styles.inputWrap}>
                <Ionicons name="search-outline" size={18} color={THEME.subtext} />
                <TextInput
                  value={inspectQuery}
                  onChangeText={setInspectQuery}
                  placeholder="검색: 점포코드/점포명/호차/순번"
                  placeholderTextColor={THEME.muted}
                  style={styles.input}
                />
                {!!inspectQuery && (
                  <Pressable onPress={() => setInspectQuery("")} style={{ padding: 6 }} hitSlop={8}>
                    <Ionicons name="close-circle" size={18} color={THEME.muted} />
                  </Pressable>
                )}
              </View>

              <TouchableOpacity
                onPress={loadInspectStores}
                disabled={inspectLoading || busy}
                style={[styles.btn, styles.btnPrimary, (inspectLoading || busy) && styles.dim]}
              >
                <View style={styles.btnInner}>
                  <Ionicons name="refresh" size={18} color="#fff" />
                  <Text style={styles.btnTextWhite}>{inspectLoading ? "불러오는 중..." : "검수 점포 새로고침"}</Text>
                </View>
              </TouchableOpacity>
            </>
          )}

          {(busy || inspectLoading) && <ActivityIndicator style={{ marginTop: 10 }} />}
        </View>
      </View>

      {/* ✅ 리스트 영역은 bottomWrap을 "절대배치"로 띄웠기 때문에, paddingBottom으로만 예약 */}
      <View style={{ flex: 1, paddingHorizontal: 16, paddingBottom: listReserveBottom }}>
        <View style={styles.listBox}>
          {mode === "search" ? (
            <FlatList
              data={storeResults}
              keyExtractor={(item) => item.store_code}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={
                <View style={{ padding: 14 }}>
                  <Text style={{ color: THEME.subtext, fontWeight: "800" }}>검색 결과가 여기에 표시됩니다.</Text>
                </View>
              }
              renderItem={({ item }) => renderStoreRow(item)}
            />
          ) : inspectLoading ? (
            <View style={{ padding: 16 }}>
              <ActivityIndicator />
            </View>
          ) : (
            <FlatList
              data={filteredInspectStores}
              keyExtractor={(item) => item.store_code}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={
                <View style={{ padding: 14 }}>
                  <Text style={{ color: THEME.subtext, fontWeight: "800" }}>검수 점포 결과가 없습니다.</Text>
                </View>
              }
              renderItem={({ item }) => renderStoreRow(item)}
            />
          )}
        </View>
      </View>

      {/* ✅ bottomWrap: absolute로 띄우고 탭바 높이만큼 bottom을 올림 */}
      <View
        style={[
          styles.bottomWrapFloating,
          {
            bottom: tabBarHeight,
            paddingBottom: bottomPad,
          },
        ]}
      >
        <View style={styles.bottomHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.bottomHeaderTitle} numberOfLines={1}>
              {selectedLine}
            </Text>
            <Text style={styles.bottomHeaderSub}>대기 {queueCount}장</Text>
          </View>

          <Pressable
            onPress={clearQueue}
            disabled={busy || queueCount === 0}
            style={[styles.clearPill, (busy || queueCount === 0) && styles.dim]}
            hitSlop={8}
          >
            <Ionicons name="trash-outline" size={14} color={THEME.danger} />
            <Text style={styles.clearPillText}>전체삭제</Text>
          </Pressable>
        </View>

        <View style={styles.queueCard}>
          {queueCount === 0 ? (
            <View style={styles.queueEmpty}>
              <Ionicons name="images-outline" size={18} color={THEME.muted} />
              <Text style={styles.queueEmptyText}>대기 사진이 없습니다. (갤러리/카메라로 추가)</Text>
            </View>
          ) : (
            <FlatList
              data={queueAssets}
              keyExtractor={(item) => item.uri}
              horizontal
              keyboardShouldPersistTaps="handled"
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 10, paddingVertical: 4 }}
              renderItem={({ item }) => (
                <View style={{ width: 78 }}>
                  <Image source={{ uri: item.uri }} style={styles.queueThumb} />
                  <Pressable onPress={() => removeFromQueue(item.uri)} disabled={busy} style={[styles.thumbDelete, busy && styles.dim]}>
                    <Ionicons name="close" size={14} color={THEME.text} />
                    <Text style={styles.thumbDeleteText}>삭제</Text>
                  </Pressable>
                </View>
              )}
            />
          )}
        </View>

        <View style={{ flexDirection: "row", gap: 10 }}>
          <TouchableOpacity
            onPress={pickMultiFromGalleryToQueue}
            disabled={!selectedStore || busy}
            style={[styles.btn, styles.btnBlue, (!selectedStore || busy) && styles.dim]}
          >
            <View style={styles.btnInner}>
              <Ionicons name="images-outline" size={18} color="#fff" />
              <Text style={styles.btnTextWhite}>갤러리 추가</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={takePhotoToQueue}
            disabled={!selectedStore || busy}
            style={[styles.btn, styles.btnOutlineBlue, (!selectedStore || busy) && styles.dim]}
          >
            <View style={styles.btnInner}>
              <Ionicons name="camera-outline" size={18} color={THEME.blue} />
              <Text style={[styles.btnText, { color: THEME.blue }]}>카메라 촬영</Text>
            </View>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          onPress={uploadQueue}
          disabled={!selectedStore || busy || queueCount === 0}
          style={[styles.btnWide, styles.btnGreen, (!selectedStore || busy || queueCount === 0) && styles.dim]}
        >
          <View style={styles.btnInner}>
            <Ionicons name="cloud-upload-outline" size={18} color="#fff" />
            <Text style={styles.btnTextWhite}>{busy ? "업로드 중..." : `사진 업로드 (${queueCount}장)`}</Text>
          </View>
        </TouchableOpacity>
      </View>

      <Modal visible={workPartModalOpen} transparent animationType="fade" onRequestClose={() => setWorkPartModalOpen(false)}>
        <Pressable
          style={styles.backdrop}
          onPress={() => {
            Keyboard.dismiss();
            setWorkPartModalOpen(false);
          }}
        />
        <View style={[styles.modalBox, { top: topPad + 84 }]}>
          <View style={styles.modalHeader}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Ionicons name="settings-outline" size={18} color={THEME.text} />
              <Text style={styles.modalTitle}>작업파트 설정(관리자)</Text>
            </View>
            <Pressable onPress={() => setWorkPartModalOpen(false)} style={styles.iconBtn}>
              <Ionicons name="close" size={18} color={THEME.text} />
            </Pressable>
          </View>
          <View style={{ padding: 14, gap: 10 }}>
            <Text style={styles.modalDesc}>회원가입 작업파트 목록에서 “기사”만 제외한 옵션입니다.</Text>

            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              {workPartOptions.map((o) => {
                const selected = selectedWorkPartInModal === o.value;
                return (
                  <Pressable
                    key={o.value}
                    onPress={() => setSelectedWorkPartInModal(o.value)}
                    style={[
                      styles.pill,
                      selected ? { borderColor: "rgba(37,99,235,0.55)", backgroundColor: THEME.blueSoft } : null,
                    ]}
                  >
                    <Text style={[styles.pillText, selected ? { color: THEME.blue } : null]}>{o.label}</Text>
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
                    const { error } = await supabase
                      .from("profiles")
                      .upsert({ id: session.user.id, work_part: wp }, { onConflict: "id" });
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: THEME.bg },

  headerWrap: { paddingHorizontal: 16, paddingBottom: 10, gap: 10 },
  headerTopRow: { flexDirection: "row", alignItems: "center", gap: 10 },

  headerTitleLeft: { fontSize: 24, fontWeight: "900", color: THEME.text, letterSpacing: -0.4 },

  headerChip: {
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
  headerChipText: { fontWeight: "900", color: THEME.blue, fontSize: 12 },

  h2: { color: THEME.subtext, fontSize: 12, lineHeight: 16, fontWeight: "800" },

  segBtn: {
    flex: 1,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: THEME.border,
    borderRadius: 14,
    alignItems: "center",
    backgroundColor: THEME.surface,
  },
  segBtnOn: { borderColor: "rgba(37,99,235,0.35)", backgroundColor: THEME.blueSoft },
  segText: { fontWeight: "900", color: THEME.text, fontSize: 13 },
  segTextOn: { color: THEME.blue },

  card: {
    backgroundColor: THEME.surface,
    borderWidth: 1,
    borderColor: THEME.border,
    borderRadius: 18,
    padding: 12,
    gap: 10,
    shadowColor: THEME.shadow as any,
    shadowOpacity: 1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
  cardTitle: { fontWeight: "900", color: THEME.text, fontSize: 13 },

  inputWrap: {
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
  input: { flex: 1, color: THEME.text, fontWeight: "900", fontSize: 13, paddingVertical: 0 },

  btn: { height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center", flex: 1 },
  btnWide: { height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  btnInner: { flexDirection: "row", alignItems: "center", gap: 8 },

  btnPrimary: { backgroundColor: THEME.primary },
  btnBlue: { backgroundColor: THEME.blue },
  btnGreen: { backgroundColor: THEME.success },
  btnOutlineBlue: { backgroundColor: THEME.surface, borderWidth: 1, borderColor: THEME.blue },

  btnTextWhite: { color: "#fff", fontWeight: "900", fontSize: 13 },
  btnText: { color: THEME.text, fontWeight: "900", fontSize: 13 },

  dim: { opacity: 0.6 },

  listBox: {
    borderWidth: 1,
    borderColor: THEME.border,
    borderRadius: 18,
    overflow: "hidden",
    backgroundColor: THEME.surface,
    flex: 1,
  },

  row: {
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
    backgroundColor: THEME.surface,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },

  rowLeft: { width: 62 },
  rowNo: { fontWeight: "900", color: THEME.text, fontSize: 12 },

  rowMid: { flex: 1, paddingRight: 6 },
  rowCode: { fontWeight: "900", color: THEME.text, fontSize: 12, marginBottom: 3 },
  rowNameBig: { fontWeight: "900", color: THEME.text, fontSize: 13, lineHeight: 18 },

  rowRight: { alignItems: "flex-end", justifyContent: "center" },

  donePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    height: 28,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(22,163,74,0.25)",
    backgroundColor: THEME.successSoft,
  },
  doneText: { fontWeight: "900", color: THEME.success, fontSize: 12 },

  // ✅ floating bottom 영역
  bottomWrapFloating: {
    position: "absolute",
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: THEME.border,
    backgroundColor: THEME.surface,
    gap: 10,
  },

  bottomHeader: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: THEME.border,
    borderRadius: 18,
    backgroundColor: THEME.soft,
  },
  bottomHeaderTitle: { fontWeight: "900", color: THEME.text, fontSize: 12 },
  bottomHeaderSub: { marginTop: 6, color: THEME.subtext, fontWeight: "800", fontSize: 12 },

  queueCard: {
    borderWidth: 1,
    borderColor: THEME.border,
    borderRadius: 18,
    padding: 12,
    backgroundColor: THEME.surface,
    gap: 10,
  },

  queueEmpty: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 },
  queueEmptyText: { color: THEME.subtext, fontWeight: "800", fontSize: 12, flex: 1 },

  clearPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    height: 34,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#FCA5A5",
    backgroundColor: THEME.dangerSoft,
  },
  clearPillText: { fontWeight: "900", color: THEME.danger, fontSize: 12 },

  queueThumb: { width: 78, height: 78, borderRadius: 16, backgroundColor: "#F3F4F6" },
  thumbDelete: {
    marginTop: 6,
    height: 30,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: THEME.border,
    backgroundColor: THEME.soft,
    flexDirection: "row",
    gap: 6,
  },
  thumbDeleteText: { fontWeight: "900", color: THEME.text, fontSize: 12 },

  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },
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
  modalDesc: { color: THEME.subtext, fontWeight: "800", fontSize: 12, lineHeight: 16 },

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

  pill: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: THEME.border, backgroundColor: THEME.surface },
  pillText: { fontWeight: "900", color: THEME.text },

  modalBtn: { flex: 1, height: 46, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  modalBtnGhost: { borderWidth: 1, borderColor: THEME.border, backgroundColor: THEME.surface },
  modalBtnPrimary: { backgroundColor: THEME.blue },
  modalBtnText: { fontWeight: "900", color: THEME.text },
  modalBtnTextWhite: { fontWeight: "900", color: "#fff" },
  modalFoot: { color: THEME.muted, fontSize: 11, textAlign: "center", marginTop: 6, fontWeight: "800" },
});