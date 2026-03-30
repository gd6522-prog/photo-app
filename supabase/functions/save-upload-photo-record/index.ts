import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type RequestBody = {
  table?: "photos" | "delivery_photos" | null;
  access_token?: string | null;
  payload?: Record<string, unknown> | null;
  minimal_payload?: Record<string, unknown> | null;
};

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

function authTokenFrom(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  return auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
}

function normalizeTable(input: unknown) {
  const table = String(input ?? "").trim();
  if (table === "photos" || table === "delivery_photos") return table;
  return "";
}

function asNonEmptyString(input: unknown) {
  const value = String(input ?? "").trim();
  return value || null;
}

function sanitizePayload(table: "photos" | "delivery_photos", input: Record<string, unknown>, actorId?: string | null) {
  if (table === "photos") {
    return {
      user_id: asNonEmptyString(input.user_id) ?? asNonEmptyString(actorId),
      store_code: input.store_code ?? null,
      original_path: input.original_path ?? null,
      original_url: input.original_url ?? null,
      status: input.status ?? null,
      work_part: input.work_part ?? null,
      category: input.category ?? null,
      car_no: input.car_no ?? null,
      delivery_planned_date: input.delivery_planned_date ?? null,
      extra_note: input.extra_note ?? null,
    };
  }

  return {
    work_date: input.work_date ?? null,
    car_no: input.car_no ?? null,
    store_code: input.store_code ?? null,
    store_name: input.store_name ?? null,
    memo: input.memo ?? null,
    bucket: input.bucket ?? null,
    path: input.path ?? null,
    public_url: input.public_url ?? null,
    created_by: asNonEmptyString(input.created_by) ?? asNonEmptyString(actorId),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return json(405, { error: "Method Not Allowed" });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!SUPABASE_URL || !SERVICE_ROLE) {
      return json(500, { error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" });
    }

    const body = (await req.json().catch(() => ({}))) as RequestBody;
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const table = normalizeTable(body.table);
    if (!table) return json(400, { error: "Invalid table" });

    const token = authTokenFrom(req) || String(body.access_token ?? "").trim();
    let actorId: string | null = null;
    if (token) {
      const { data: actorData } = await admin.auth.getUser(token);
      actorId = asNonEmptyString(actorData?.user?.id);
    }

    const payload = sanitizePayload(table, (body.payload ?? {}) as Record<string, unknown>, actorId);
    const minimalPayload = sanitizePayload(table, (body.minimal_payload ?? body.payload ?? {}) as Record<string, unknown>, actorId);

    if (table === "photos" && !payload.user_id && !minimalPayload.user_id) {
      return json(400, { error: "Missing user_id" });
    }
    if (table === "delivery_photos" && !payload.created_by && !minimalPayload.created_by) {
      return json(400, { error: "Missing created_by" });
    }

    const { error } = await admin.from(table).insert(payload);
    if (!error) return json(200, { ok: true });

    const message = String(error.message ?? "").toLowerCase();
    const looksLikeMissingColumn =
      message.includes("column") || message.includes("does not exist") || message.includes("schema cache");

    if (!looksLikeMissingColumn) throw error;

    const { error: fallbackError } = await admin.from(table).insert(minimalPayload);
    if (fallbackError) throw fallbackError;

    return json(200, { ok: true, minimal: true });
  } catch (e: any) {
    return json(500, { error: e?.message ?? String(e) });
  }
});
