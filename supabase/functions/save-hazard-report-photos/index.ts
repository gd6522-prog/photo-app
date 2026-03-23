import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type RequestBody = {
  report_id?: string | null;
  access_token?: string | null;
  photos?: Array<{
    photo_path?: string | null;
    photo_url?: string | null;
  }> | null;
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
    const token = authTokenFrom(req) || String(body.access_token ?? "").trim();
    if (!token) return json(401, { error: "Unauthorized" });

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: actorData, error: actorErr } = await admin.auth.getUser(token);
    if (actorErr || !actorData?.user) return json(401, { error: "Unauthorized" });

    const reportId = String(body.report_id ?? "").trim();
    const photos = Array.isArray(body.photos) ? body.photos : [];
    if (!reportId) return json(400, { error: "Missing report_id" });
    if (!photos.length) return json(200, { ok: true, inserted: 0 });

    const normalized = photos
      .map((photo) => ({
        report_id: reportId,
        photo_path: String(photo?.photo_path ?? "").trim(),
        photo_url: String(photo?.photo_url ?? "").trim(),
      }))
      .filter((photo) => photo.photo_path && photo.photo_url);

    if (!normalized.length) return json(200, { ok: true, inserted: 0 });

    const { data: report, error: reportErr } = await admin
      .from("hazard_reports")
      .select("id, user_id")
      .eq("id", reportId)
      .maybeSingle();

    if (reportErr) throw reportErr;
    if (!report?.id) return json(404, { error: "Report not found" });
    if (String(report.user_id ?? "") !== String(actorData.user.id ?? "")) {
      return json(403, { error: "Forbidden" });
    }

    const { error: insertErr } = await admin.from("hazard_report_photos").insert(normalized);
    if (insertErr) throw insertErr;

    return json(200, { ok: true, inserted: normalized.length });
  } catch (e: any) {
    return json(500, { error: e?.message ?? String(e) });
  }
});
