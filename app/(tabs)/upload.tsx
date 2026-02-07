import { Buffer } from "buffer";
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  SafeAreaView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { supabase } from "../../src/lib/supabase";

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

// ✅ 점포 정렬: 호차(car_no) → 순번(seq_no) → 점포코드
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

export default function UploadScreen() {
  const router = useRouter();

  const [mode, setMode] = useState<Mode>("search");
  const [query, setQuery] = useState("");

  const [storeResults, setStoreResults] = useState<StoreMapRow[]>([]);
  const [selectedStore, setSelectedStore] = useState<StoreMapRow | null>(null);

  const [busy, setBusy] = useState(false);

  // ✅ 검수점포 모달 관련
  const [inspectModalOpen, setInspectModalOpen] = useState(false);
  const [inspectQuery, setInspectQuery] = useState("");
  const [inspectStores, setInspectStores] = useState<StoreMapRow[]>([]);
  const [inspectLoading, setInspectLoading] = useState(false);

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

  // ✅ 검색 결과 정렬: 1순위 호차(car_no) 오름차순, 2순위 순번(seq_no) 오름차순
  const doStoreSearch = async () => {
    const session = await requireSession();
    if (!session) return;

    const q = query.trim();
    if (!q) {
      Alert.alert("경고", "점포코드 또는 점포명을 입력하세요.");
      return;
    }

    setBusy(true);
    try {
      const like = `%${q}%`;

      const { data, error } = await supabase
        .from("store_map")
        .select("store_code, store_name, car_no, seq_no")
        .or(`store_code.ilike.${like},store_name.ilike.${like}`)
        .order("car_no", { ascending: true, nullsFirst: false })
        .order("seq_no", { ascending: true, nullsFirst: false })
        .limit(200);

      if (error) throw error;

      // ✅ 화면에서도 정렬 고정
      const rows = ((data ?? []) as StoreMapRow[]).slice().sort(sortStores);

      setStoreResults(rows);
      if (rows.length === 0) Alert.alert("결과 없음", "검색 결과가 없습니다.");
    } catch (e: any) {
      Alert.alert("오류", e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  // ✅ 검수점포 모달 열 때, 전체 점포 리스트 로딩(한 번만 로드)
  const openInspectModal = async () => {
    const session = await requireSession();
    if (!session) return;

    setMode("inspect");
    setInspectQuery("");
    setInspectModalOpen(true);

    // 이미 로딩되어 있으면 재조회 안 함(원하면 여기서 항상 새로고침도 가능)
    if (inspectStores.length > 0) return;

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

  const uploadAssets = async (assets: ImagePicker.ImagePickerAsset[]) => {
    const session = await requireSession();
    if (!session) return;

    if (!selectedStore) {
      Alert.alert("경고", "점포를 먼저 선택/확인해야 업로드가 가능합니다.");
      return;
    }
    if (!assets || assets.length === 0) return;

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

          const payload = {
            user_id: session.user.id,
            store_code: selectedStore.store_code,
            original_path: path,
            original_url: publicUrl,
            status: "public" as const,
          };

          const { error: insErr } = await supabase.from("photos").insert(payload);
          if (insErr) throw insErr;

          ok++;
        } catch (e: any) {
          fail++;
          reasons.push(`(${fail}/${assets.length}) ${e?.message ?? String(e)}`);
        }
      }

      if (fail === 0) Alert.alert("완료", `업로드 성공: ${ok}장`);
      else if (ok === 0) Alert.alert("업로드 실패", `성공 0장 / 실패 ${fail}장\n\n첫 실패:\n${reasons[0]}`);
      else Alert.alert("완료(부분 성공)", `성공 ${ok}장 / 실패 ${fail}장\n\n첫 실패:\n${reasons[0]}`);
    } finally {
      setBusy(false);
    }
  };

  const pickMultiFromGallery = async () => {
    const session = await requireSession();
    if (!session) return;

    if (!selectedStore) {
      Alert.alert("경고", "검수 점포를 먼저 선택하세요.");
      return;
    }

    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("권한 필요", "사진 접근 권한을 허용해주세요.");
      return;
    }

    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      selectionLimit: 0,
      quality: 0.9,
    });

    if (picked.canceled) return;
    await uploadAssets(picked.assets ?? []);
  };

  const takePhotoAndUpload = async () => {
    const session = await requireSession();
    if (!session) return;

    if (!selectedStore) {
      Alert.alert("경고", "검수 점포를 먼저 선택하세요.");
      return;
    }

    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("권한 필요", "카메라 권한을 허용해주세요.");
      return;
    }

    const shot = await ImagePicker.launchCameraAsync({ quality: 0.9 });
    if (shot.canceled) return;
    await uploadAssets(shot.assets ?? []);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#FFFFFF" }}>
      {/* 헤더: 뒤로가기 + 로고 */}
      <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Pressable
            onPress={() => {
              try {
                router.back();
              } catch {
                router.replace("/(tabs)");
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

        <Text style={{ marginTop: 8, fontSize: 20, fontWeight: "900", color: "#111827" }}>사진 업로드</Text>
        <Text style={{ marginTop: 4, color: "#6B7280" }}>
          점포를 선택/확인한 뒤 사진을 업로드하세요.
        </Text>
      </View>

      <View style={{ flex: 1, paddingHorizontal: 16, paddingBottom: 14, gap: 12 }}>
        {/* ✅ 모드 선택 (검색 선택 / 검수 점포) */}
        <View style={{ flexDirection: "row", gap: 10 }}>
          <TouchableOpacity
            onPress={() => {
              setMode("search");
              setStoreResults([]);
              // 선택 점포는 유지(원하면 여기서 null로 초기화 가능)
            }}
            style={{
              flex: 1,
              paddingVertical: 12,
              borderWidth: 1,
              borderColor: mode === "search" ? "#2563EB" : "#E5E7EB",
              borderRadius: 14,
              alignItems: "center",
              backgroundColor: mode === "search" ? "#EFF6FF" : "#FFFFFF",
            }}
          >
            <Text style={{ fontWeight: "900", color: "#111827" }}>검색 선택</Text>
          </TouchableOpacity>

          {/* ✅ 기존 “직접 입력” → “검수 점포” */}
          <TouchableOpacity
            onPress={openInspectModal}
            style={{
              flex: 1,
              paddingVertical: 12,
              borderWidth: 1,
              borderColor: mode === "inspect" ? "#2563EB" : "#E5E7EB",
              borderRadius: 14,
              alignItems: "center",
              backgroundColor: mode === "inspect" ? "#EFF6FF" : "#FFFFFF",
            }}
          >
            <Text style={{ fontWeight: "900", color: "#111827" }}>검수 점포</Text>
          </TouchableOpacity>
        </View>

        {/* 검색 영역 */}
        {mode === "search" && (
          <>
            <View
              style={{
                backgroundColor: "#FFFFFF",
                borderWidth: 1,
                borderColor: "#E5E7EB",
                borderRadius: 16,
                padding: 12,
                gap: 10,
              }}
            >
              <Text style={{ fontWeight: "900", color: "#111827" }}>점포 검색</Text>
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="점포코드 또는 점포명 검색"
                placeholderTextColor="#9CA3AF"
                style={{
                  borderWidth: 1,
                  borderColor: "#E5E7EB",
                  borderRadius: 12,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  backgroundColor: "#F9FAFB",
                  color: "#111827",
                }}
              />

              <TouchableOpacity
                onPress={doStoreSearch}
                disabled={busy}
                style={{
                  height: 44,
                  borderRadius: 12,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: busy ? "#CBD5E1" : "#111827",
                }}
              >
                <Text style={{ color: "#FFFFFF", fontWeight: "900" }}>{busy ? "검색중..." : "검색"}</Text>
              </TouchableOpacity>
            </View>

            {busy && <ActivityIndicator />}

            <View style={{ borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 16, overflow: "hidden", flex: 1 }}>
              <FlatList
                data={storeResults}
                keyExtractor={(item) => item.store_code}
                ListEmptyComponent={
                  <View style={{ padding: 14 }}>
                    <Text style={{ color: "#6B7280" }}>검색 결과가 여기에 표시됩니다.</Text>
                  </View>
                }
                renderItem={({ item }) => (
                  <TouchableOpacity
                    onPress={() => setSelectedStore(item)}
                    style={{
                      padding: 12,
                      borderBottomWidth: 1,
                      borderBottomColor: "#F3F4F6",
                      backgroundColor: selectedStore?.store_code === item.store_code ? "#EFF6FF" : "#FFFFFF",
                    }}
                  >
                    <Text style={{ fontWeight: "900", color: "#111827" }}>
                      [{item.store_code}] {item.store_name}
                    </Text>
                    <Text style={{ marginTop: 2, color: "#6B7280" }}>
                      호차: {item.car_no ?? "-"} / 순번: {item.seq_no ?? "-"}
                    </Text>
                  </TouchableOpacity>
                )}
              />
            </View>
          </>
        )}

        {/* ✅ 선택 점포 박스 */}
        <View style={{ borderWidth: 1, borderColor: "#E5E7EB", backgroundColor: "#FFFFFF", borderRadius: 16, padding: 12 }}>
          <Text style={{ fontWeight: "900", color: "#111827", marginBottom: 8 }}>선택된 점포</Text>
          <Text style={{ color: "#374151" }}>점포코드: {selectedStore?.store_code ?? "-"}</Text>
          <Text style={{ color: "#374151" }}>점포명: {selectedStore?.store_name ?? "-"}</Text>
          <Text style={{ color: "#374151" }}>호차: {selectedStore?.car_no ?? "-"}</Text>
          <Text style={{ color: "#374151" }}>순번: {selectedStore?.seq_no ?? "-"}</Text>
        </View>

        {/* ✅ 업로드 버튼들 (선택 점포 있어야 활성화) */}
        <TouchableOpacity
          onPress={pickMultiFromGallery}
          disabled={!selectedStore || busy}
          style={{
            height: 48,
            borderRadius: 14,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: !selectedStore || busy ? "#CBD5E1" : "#2563EB",
          }}
        >
          <Text style={{ color: "#FFFFFF", fontWeight: "900" }}>갤러리 여러장 선택 후 업로드</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={takePhotoAndUpload}
          disabled={!selectedStore || busy}
          style={{
            height: 48,
            borderRadius: 14,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1,
            borderColor: !selectedStore || busy ? "#CBD5E1" : "#2563EB",
            backgroundColor: "#FFFFFF",
            opacity: !selectedStore || busy ? 0.7 : 1,
          }}
        >
          <Text style={{ color: !selectedStore || busy ? "#94A3B8" : "#2563EB", fontWeight: "900" }}>
            카메라 촬영 후 업로드
          </Text>
        </TouchableOpacity>

        <Text style={{ color: "#9CA3AF" }}>업로드 목록 조회/삭제는 “조회 화면(리스트)”에서 합니다.</Text>
      </View>

      {/* ✅ 검수점포 선택 모달 */}
      <Modal
        visible={inspectModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setInspectModalOpen(false)}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.35)" }}
          onPress={() => setInspectModalOpen(false)}
        />

        <View
          style={{
            position: "absolute",
            left: 16,
            right: 16,
            top: 90,
            maxHeight: "75%",
            backgroundColor: "#FFFFFF",
            borderRadius: 16,
            overflow: "hidden",
          }}
        >
          <View style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ fontSize: 16, fontWeight: "900", color: "#111827" }}>검수점포 선택</Text>
              <Pressable onPress={() => setInspectModalOpen(false)} hitSlop={10}>
                <Text style={{ fontWeight: "900", color: "#111827" }}>닫기</Text>
              </Pressable>
            </View>

            <TextInput
              value={inspectQuery}
              onChangeText={setInspectQuery}
              placeholder="검색: 점포코드/점포명/호차/순번"
              placeholderTextColor="#9CA3AF"
              style={{
                marginTop: 10,
                borderWidth: 1,
                borderColor: "#E5E7EB",
                borderRadius: 12,
                paddingVertical: 10,
                paddingHorizontal: 12,
                backgroundColor: "#F9FAFB",
                color: "#111827",
              }}
            />

            <View style={{ flexDirection: "row", marginTop: 10, paddingHorizontal: 4 }}>
              <Text style={{ width: 52, fontWeight: "900", color: "#374151" }}>호차</Text>
              <Text style={{ width: 52, fontWeight: "900", color: "#374151" }}>순번</Text>
              <Text style={{ flex: 1, fontWeight: "900", color: "#374151" }}>점포코드 / 점포명</Text>
            </View>
          </View>

          {inspectLoading ? (
            <View style={{ padding: 16 }}>
              <ActivityIndicator />
            </View>
          ) : (
            <FlatList
              data={filteredInspectStores}
              keyExtractor={(it) => it.store_code}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => {
                    setSelectedStore(item);
                    setInspectModalOpen(false);
                    Alert.alert("선택 완료", `${item.store_code} ${item.store_name}`);
                  }}
                  style={{
                    paddingVertical: 12,
                    paddingHorizontal: 12,
                    borderBottomWidth: 1,
                    borderBottomColor: "#F3F4F6",
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                    backgroundColor: selectedStore?.store_code === item.store_code ? "#EFF6FF" : "#FFFFFF",
                  }}
                >
                  <Text style={{ width: 52, fontWeight: "900", color: "#111827" }}>{item.car_no ?? "-"}</Text>
                  <Text style={{ width: 52, fontWeight: "900", color: "#111827" }}>{item.seq_no ?? "-"}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: "900", color: "#111827" }}>
                      {item.store_code}{" "}
                      <Text style={{ fontWeight: "700", color: "#111827" }}>{item.store_name}</Text>
                    </Text>
                  </View>
                </Pressable>
              )}
              ListEmptyComponent={
                <View style={{ padding: 16 }}>
                  <Text style={{ color: "#6B7280" }}>결과 없음</Text>
                </View>
              }
            />
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}
