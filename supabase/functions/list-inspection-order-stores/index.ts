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

type VehicleSnapshotCargoRow = {
  store_code?: string | null;
};

type VehicleSnapshot = {
  cargoRows?: VehicleSnapshotCargoRow[] | null;
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

    const { data, error } = await admin.storage.from("vehicle-data").download("current/latest.json");
    if (error) {
      const message = String(error.message ?? "");
      if (/not\s*found|404|object not found/i.test(message)) {
        return json(200, { ok: true, store_codes: [] });
      }
      throw error;
    }

    const raw = await data.text();
    const parsed = JSON.parse(raw) as VehicleSnapshot;
    const storeCodes = Array.from(
      new Set(
        (parsed.cargoRows ?? [])
          .map((row) => normalizeStoreCode(row?.store_code))
          .filter(Boolean)
      )
    );

    return json(200, { ok: true, store_codes: storeCodes });
  } catch (e: any) {
    return json(500, { error: e?.message ?? String(e) });
  }
});
