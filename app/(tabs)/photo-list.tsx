import { Picker } from "@react-native-picker/picker";
import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  SafeAreaView,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { supabase } from "../../src/lib/supabase";

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
};

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

export default function PhotoListScreen() {
  const router = useRouter();

  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);

  const [isAdmin, setIsAdmin] = useState(false);
  const [adminSeeAll, setAdminSeeAll] = useState(false);

  const [dateStr, setDateStr] = useState(kstNowDateString());
  const [carNo, setCarNo] = useState<string>("ALL");
  const [storeCodeFilter, setStoreCodeFilter] = useState("");
  const [carOptions, setCarOptions] = useState<Array<{ label: string; value: string }>>([
    { label: "전체", value: "ALL" },
  ]);

  const [photos, setPhotos] = useState<PhotoRow[]>([]);
  const [storeMeta, setStoreMeta] = useState<Record<string, StoreMapRow>>({});

  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewTitle, setPreviewTitle] = useState("");
  const [previewItems, setPreviewItems] = useState<PhotoRow[]>([]);

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

    if (error) {
      setIsAdmin(false);
      setAdminSeeAll(false);
      return;
    }

    setIsAdmin(!!data?.is_admin);
    setAdminSeeAll(false);
  };

  const loadCarOptions = async () => {
    const session = await requireSession();
    if (!session) return;

    const { data, error } = await supabase.from("store_map").select("car_no");
    if (error) {
      setCarOptions([{ label: "전체", value: "ALL" }]);
      return;
    }

    const set = new Set<string>();
    for (const r of data ?? []) {
      if ((r as any)?.car_no != null) set.add(String((r as any).car_no));
    }
    const cars = Array.from(set).sort((a, b) => Number(a) - Number(b));
    setCarOptions([{ label: "전체", value: "ALL" }, ...cars.map((c) => ({ label: `호차 ${c}`, value: c }))]);
  };

  useEffect(() => {
    if (mounted.current) return;
    mounted.current = true;
    (async () => {
      await loadAdminFlag();
      await loadCarOptions();
    })();
  }, []);

  const getImageUrl = (p: PhotoRow) => p.original_url;

  const fetchList = async () => {
    const session = await requireSession();
    if (!session) return;

    const d = dateStr.trim();
    if (!isValidDateYYYYMMDD(d)) {
      Alert.alert("날짜 오류", "날짜는 YYYY-MM-DD 형식으로 입력하세요. 예: 2026-01-23");
      return;
    }

    setLoading(true);
    try {
      const { startUTC, endUTC } = kstRangeUTC(d);

      let q = supabase
        .from("photos")
        .select("id, user_id, created_at, status, original_path, original_url, store_code")
        .gte("created_at", startUTC)
        .lt("created_at", endUTC)
        .order("created_at", { ascending: false });

      if (!(isAdmin && adminSeeAll)) q = q.eq("user_id", session.user.id);

      if (carNo !== "ALL") {
        const { data: storesByCar, error: carErr } = await supabase
          .from("store_map")
          .select("store_code")
          .eq("car_no", Number(carNo));

        if (carErr) throw carErr;
        const codes = (storesByCar ?? []).map((x: any) => x.store_code).filter(Boolean);

        if (codes.length === 0) {
          setPhotos([]);
          setStoreMeta({});
          setSelectedIds(new Set());
          setSelectMode(false);
          return;
        }
        q = q.in("store_code", codes);
      }

      const sc = storeCodeFilter.trim();
      if (sc) q = q.eq("store_code", sc);

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

      setSelectedIds(new Set());
      setSelectMode(false);
    } catch (e: any) {
      Alert.alert("조회 오류", e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

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

  const deleteSelected = async () => {
    const session = await requireSession();
    if (!session) return;

    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    Alert.alert("삭제 확인", `선택된 ${ids.length}개를 완전삭제할까요?\n(DB + Storage에서 삭제)`, [
      { text: "취소", style: "cancel" },
      {
        text: "삭제",
        style: "destructive",
        onPress: async () => {
          setBusy(true);
          try {
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

            Alert.alert("완료", "삭제 완료");
            setSelectedIds(new Set());
            setSelectMode(false);
            await fetchList();
          } catch (e: any) {
            Alert.alert("삭제 실패", e?.message ?? String(e));
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  const openPreviewForStore = (store_code: string) => {
    const grp = groupedByStore.find((g) => g.store_code === store_code);
    if (!grp) return;

    const meta = storeMeta[store_code];
    const title = meta
      ? `[${meta.store_code}] ${meta.store_name} / 호차:${meta.car_no ?? "-"} / 순번:${meta.seq_no ?? "-"}`
      : `[${store_code}]`;

    setPreviewTitle(title);
    setPreviewItems(grp.items);
    setPreviewOpen(true);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#FFFFFF" }}>
      {/* 헤더: 뒤로가기 + 로고 */}
      <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Pressable
            onPress={() => {
              try {
                router.back();
              } catch {
                router.replace("/");
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

          <Image source={require("../../assets/hanexpress-logo.png")} style={{ width: 160, height: 40, resizeMode: "contain" }} />
        </View>

        <Text style={{ marginTop: 8, fontSize: 20, fontWeight: "900", color: "#111827" }}>사진 조회</Text>
        <Text style={{ marginTop: 4, color: "#6B7280" }}>날짜/호차/점포코드로 조회 후 미리보기 또는 삭제하세요.</Text>
      </View>

      {/* 상단 필터(압축) */}
      <View style={{ paddingHorizontal: 16, paddingBottom: 10, gap: 8 }}>
        {isAdmin && (
          <View
            style={{
              borderWidth: 1,
              borderColor: "#E5E7EB",
              borderRadius: 14,
              padding: 10,
              backgroundColor: "#FFFFFF",
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <Text style={{ fontWeight: "900", color: "#111827" }}>관리자 전체 보기</Text>
            <Switch value={adminSeeAll} onValueChange={setAdminSeeAll} />
          </View>
        )}

        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 12, fontWeight: "900", color: "#374151", marginBottom: 4 }}>날짜</Text>
            <TextInput
              value={dateStr}
              onChangeText={setDateStr}
              placeholder="YYYY-MM-DD"
              placeholderTextColor="#9CA3AF"
              style={{
                borderWidth: 1,
                borderColor: "#E5E7EB",
                borderRadius: 12,
                paddingVertical: 10,
                paddingHorizontal: 12,
                backgroundColor: "#F9FAFB",
                color: "#111827",
              }}
            />
          </View>

          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 12, fontWeight: "900", color: "#374151", marginBottom: 4 }}>호차</Text>
            <View
              style={{
                borderWidth: 1,
                borderColor: "#E5E7EB",
                borderRadius: 12,
                overflow: "hidden",
                height: 44,
                justifyContent: "center",
                backgroundColor: "#F9FAFB",
              }}
            >
              <Picker selectedValue={carNo} onValueChange={(v) => setCarNo(String(v))} style={{ height: 44, marginTop: -6 }}>
                {carOptions.map((opt) => (
                  <Picker.Item key={opt.value} label={opt.label} value={opt.value} />
                ))}
              </Picker>
            </View>
          </View>
        </View>

        <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-end" }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 12, fontWeight: "900", color: "#374151", marginBottom: 4 }}>점포코드</Text>
            <TextInput
              value={storeCodeFilter}
              onChangeText={setStoreCodeFilter}
              placeholder="예: 03696 (비우면 전체)"
              placeholderTextColor="#9CA3AF"
              style={{
                borderWidth: 1,
                borderColor: "#E5E7EB",
                borderRadius: 12,
                paddingVertical: 10,
                paddingHorizontal: 12,
                backgroundColor: "#F9FAFB",
                color: "#111827",
              }}
            />
          </View>

          <TouchableOpacity
            onPress={fetchList}
            disabled={loading || busy}
            style={{
              height: 44,
              paddingHorizontal: 16,
              borderRadius: 12,
              backgroundColor: "#111827",
              alignItems: "center",
              justifyContent: "center",
              opacity: loading || busy ? 0.6 : 1,
            }}
          >
            <Text style={{ color: "#FFFFFF", fontWeight: "900" }}>{loading ? "조회중" : "조회"}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={enterOrExitSelectMode}
            disabled={loading || busy}
            style={{
              height: 44,
              paddingHorizontal: 12,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: "#111827",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: selectMode ? "#EFF6FF" : "#FFFFFF",
              opacity: loading || busy ? 0.6 : 1,
            }}
          >
            <Text style={{ fontWeight: "900", color: "#111827" }}>선택 {selectedIds.size}</Text>
          </TouchableOpacity>
        </View>

        {selectMode && (
          <TouchableOpacity
            onPress={deleteSelected}
            disabled={selectedIds.size === 0 || busy || loading}
            style={{
              height: 44,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: "#EF4444",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "#FFFFFF",
              opacity: selectedIds.size === 0 || busy || loading ? 0.35 : 1,
            }}
          >
            <Text style={{ fontWeight: "900", color: "#EF4444" }}>선택 삭제</Text>
          </TouchableOpacity>
        )}

        {loading && <ActivityIndicator />}
      </View>

      {/* 리스트 */}
      <View style={{ flex: 1, paddingHorizontal: 16, paddingBottom: 12 }}>
        <View style={{ borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 16, overflow: "hidden", flex: 1 }}>
          <FlatList
            data={groupedByStore}
            keyExtractor={(g) => g.store_code}
            ListEmptyComponent={
              <View style={{ padding: 14 }}>
                <Text style={{ color: "#6B7280" }}>조회 결과가 없습니다.</Text>
              </View>
            }
            renderItem={({ item }) => {
              const meta = storeMeta[item.store_code];
              const first = item.items[0];
              const timeStr = first?.created_at ? formatKST(first.created_at) : "-";
              const count = item.items.length;

              const groupSelectedCount = item.items.reduce((acc, p) => (selectedIds.has(p.id) ? acc + 1 : acc), 0);
              const groupAllSelected = groupSelectedCount === count && count > 0;

              const title = meta ? `[${meta.store_code}] ${meta.store_name}` : `[${item.store_code}]`;
              const sub = meta ? `호차:${meta.car_no ?? "-"} / 순번:${meta.seq_no ?? "-"}` : `점포코드:${item.store_code}`;

              return (
                <Pressable
                  onPress={() => {
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
                  style={{
                    padding: 12,
                    borderBottomWidth: 1,
                    borderBottomColor: "#F3F4F6",
                    flexDirection: "row",
                    gap: 12,
                    alignItems: "center",
                    backgroundColor: selectMode && groupSelectedCount > 0 ? "#EFF6FF" : "#FFFFFF",
                  }}
                >
                  <Image
                    source={{ uri: first ? getImageUrl(first) : (undefined as any) }}
                    style={{ width: 56, height: 56, borderRadius: 12, backgroundColor: "#F3F4F6" }}
                  />

                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ fontWeight: "900", fontSize: 15, color: "#111827" }}>{title}</Text>
                    <Text style={{ color: "#6B7280" }}>{sub}</Text>
                    <Text style={{ color: "#6B7280" }}>
                      업로드 {count}장 / 최신: {timeStr}
                    </Text>

                    {selectMode && (
                      <Text style={{ marginTop: 4, fontWeight: "900", color: "#111827" }}>
                        선택됨: {groupSelectedCount} / {count}
                      </Text>
                    )}
                  </View>
                </Pressable>
              );
            }}
          />
        </View>

        <Text style={{ color: "#9CA3AF", marginTop: 8 }}>
          선택 버튼으로 선택모드 ON/OFF. 선택모드에서는 점포 줄을 눌러 그룹 단위 선택/해제.
        </Text>
      </View>

      {/* 미리보기 모달 */}
      <Modal visible={previewOpen} animationType="slide" onRequestClose={() => setPreviewOpen(false)} presentationStyle="fullScreen">
        <SafeAreaView style={{ flex: 1, backgroundColor: "#FFFFFF" }}>
          <View style={{ padding: 16, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ fontSize: 16, fontWeight: "900", flex: 1, color: "#111827" }} numberOfLines={2}>
              {previewTitle}
            </Text>
            <TouchableOpacity onPress={() => setPreviewOpen(false)} style={{ padding: 10 }}>
              <Text style={{ fontWeight: "900", color: "#2563EB" }}>닫기</Text>
            </TouchableOpacity>
          </View>

          <FlatList
            data={previewItems}
            keyExtractor={(p) => p.id}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, gap: 12 }}
            renderItem={({ item }) => (
              <View style={{ borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 16, padding: 12, backgroundColor: "#FFFFFF" }}>
                <Text style={{ fontWeight: "900", color: "#111827" }}>{formatKST(item.created_at)}</Text>
                <Text style={{ color: "#6B7280" }}>점포코드: {item.store_code}</Text>

                <View style={{ height: 10 }} />

                <Image
                  source={{ uri: getImageUrl(item) }}
                  style={{ width: "100%", height: 320, borderRadius: 14, backgroundColor: "#F3F4F6" }}
                  resizeMode="contain"
                />

                <View style={{ height: 8 }} />
                <Text style={{ color: "#9CA3AF", fontSize: 12 }} numberOfLines={1}>
                  {item.original_url}
                </Text>
              </View>
            )}
            ListEmptyComponent={
              <View style={{ padding: 16 }}>
                <Text style={{ color: "#6B7280" }}>미리보기 데이터가 없습니다.</Text>
              </View>
            }
          />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}
