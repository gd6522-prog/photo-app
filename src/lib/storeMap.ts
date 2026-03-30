import { supabase } from "./supabase";

export type StoreMapRow = {
  store_code: string;
  store_name: string;
  car_no: number | null;
  seq_no: number | null;
};

type QueryStoreMapBody = {
  mode: "search" | "by_car" | "inspection" | "by_code";
  query?: string;
  carNo?: number;
  storeCode?: string;
  limit?: number;
};

function normalizeStoreCode(input: string | null | undefined) {
  const digits = String(input ?? "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.length >= 5 ? digits.slice(0, 5) : digits.padStart(5, "0");
}

function looksLikeRlsError(error: unknown) {
  const message = String((error as any)?.message ?? "").toLowerCase();
  return (
    message.includes("row-level security") ||
    message.includes("permission denied") ||
    message.includes("not allowed")
  );
}

async function invokeStoreMapQuery(body: QueryStoreMapBody): Promise<StoreMapRow[]> {
  const invokeRes = await supabase.functions.invoke("query-store-map", { body });
  const payload = invokeRes.data as { ok?: boolean; rows?: StoreMapRow[]; error?: string } | null;
  if (invokeRes.error) throw invokeRes.error;
  if (!payload?.ok) throw new Error(payload?.error || "store_map 조회에 실패했습니다.");
  return (payload.rows ?? []) as StoreMapRow[];
}

async function queryStoreMapWithFallback(
  direct: () => Promise<{ data: StoreMapRow[] | null; error: any }>,
  fallbackBody: QueryStoreMapBody
) {
  const directRes = await direct();
  if (!directRes.error) return directRes.data ?? [];
  if (!looksLikeRlsError(directRes.error)) throw directRes.error;
  return invokeStoreMapQuery(fallbackBody);
}

export async function fetchStoreByCode(storeCode: string) {
  const code = normalizeStoreCode(storeCode);
  if (!code) return { row: null as StoreMapRow | null, error: null as any };

  try {
    const rows = await queryStoreMapWithFallback(
      async () =>
        await supabase
          .from("store_map")
          .select("store_code, store_name, car_no, seq_no")
          .eq("store_code", code)
          .limit(1),
      { mode: "by_code", storeCode: code, limit: 1 }
    );

    return { row: rows[0] ?? null, error: null as any };
  } catch (error) {
    return { row: null as StoreMapRow | null, error };
  }
}

export async function searchStores(query: string, limit = 30) {
  const q = query.trim();
  if (!q) return { rows: [] as StoreMapRow[], error: null as any };

  try {
    const rows = await queryStoreMapWithFallback(
      async () =>
        await supabase
          .from("store_map")
          .select("store_code, store_name, car_no, seq_no")
          .or(`store_code.ilike.%${q}%,store_name.ilike.%${q}%`)
          .order("car_no", { ascending: true, nullsFirst: false })
          .order("seq_no", { ascending: true, nullsFirst: false })
          .limit(limit),
      { mode: "search", query: q, limit }
    );

    return { rows, error: null as any };
  } catch (error) {
    return { rows: [] as StoreMapRow[], error };
  }
}

export async function fetchStoresByCarNo(carNo: number, limit = 5000) {
  try {
    const rows = await queryStoreMapWithFallback(
      async () =>
        await supabase
          .from("store_map")
          .select("store_code, store_name, car_no, seq_no")
          .eq("car_no", carNo)
          .limit(limit),
      { mode: "by_car", carNo, limit }
    );

    return { rows, error: null as any };
  } catch (error) {
    return { rows: [] as StoreMapRow[], error };
  }
}

export async function fetchInspectionStores(limit = 5000) {
  try {
    const rows = await queryStoreMapWithFallback(
      async () =>
        await supabase
          .from("store_map")
          .select("store_code, store_name, car_no, seq_no")
          .eq("is_inspection", true)
          .limit(limit),
      { mode: "inspection", limit }
    );

    return { rows, error: null as any };
  } catch (error) {
    return { rows: [] as StoreMapRow[], error };
  }
}
