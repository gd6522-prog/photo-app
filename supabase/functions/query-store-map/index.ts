import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function json(status: number, data: unknown) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    },
  });
}

function corsPreflight() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
}

function normalizeStoreCode(input: string | null | undefined) {
  const digits = String(input ?? "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.length >= 5 ? digits.slice(0, 5) : digits.padStart(5, "0");
}

type StoreMapRow = {
  store_code: string;
  store_name: string;
  car_no: number | null;
  seq_no: number | null;
};

type QueryStoreMapBody = {
  mode?: "search" | "by_car" | "inspection" | "by_code";
  query?: string;
  carNo?: number;
  storeCode?: string;
  limit?: number;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return json(405, { error: "Method Not Allowed" });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!SUPABASE_URL || !SERVICE_ROLE) {
      return json(500, { error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const body = ((await req.json().catch(() => ({}))) ?? {}) as QueryStoreMapBody;
    const mode = body.mode ?? "search";
    const limit = Math.min(Math.max(Number(body.limit ?? 200), 1), 5000);

    let query = admin.from("store_map").select("store_code, store_name, car_no, seq_no");

    if (mode === "by_car") {
      const carNo = Number(body.carNo);
      if (!Number.isFinite(carNo)) return json(400, { error: "Invalid carNo" });
      query = query.eq("car_no", carNo);
    } else if (mode === "inspection") {
      query = query.eq("is_inspection", true);
    } else if (mode === "by_code") {
      const storeCode = normalizeStoreCode(body.storeCode);
      if (!storeCode) return json(400, { error: "Invalid storeCode" });
      query = query.eq("store_code", storeCode);
    } else {
      const raw = String(body.query ?? "").trim();
      if (!raw) return json(200, { ok: true, rows: [] as StoreMapRow[] });
      const escaped = raw.replace(/[%_,]/g, "");
      query = query.or(`store_code.ilike.%${escaped}%,store_name.ilike.%${escaped}%`);
    }

    query = query
      .order("car_no", { ascending: true, nullsFirst: false })
      .order("seq_no", { ascending: true, nullsFirst: false })
      .limit(limit);

    const { data, error } = await query;
    if (error) throw error;

    return json(200, { ok: true, rows: (data ?? []) as StoreMapRow[] });
  } catch (e: any) {
    return json(500, { error: e?.message ?? String(e) });
  }
});
