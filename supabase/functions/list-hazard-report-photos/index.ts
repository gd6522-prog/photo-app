import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type RequestBody = {
  report_ids?: string[] | null;
  access_token?: string | null;
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

function isAdminProfile(row: any) {
  return !!row?.is_admin || String(row?.work_part ?? "").trim() === "관리자";
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

    const actorId = String(actorData.user.id ?? "");
    const reportIds = Array.isArray(body.report_ids)
      ? body.report_ids.map((id) => String(id ?? "").trim()).filter(Boolean).slice(0, 300)
      : [];
    if (!reportIds.length) return json(200, { ok: true, rows: [] });

    const { data: actorProfile } = await admin
      .from("profiles")
      .select("is_admin, work_part")
      .eq("id", actorId)
      .maybeSingle();
    const isAdmin = isAdminProfile(actorProfile);

    let allowedReportIds = reportIds;
    if (!isAdmin) {
      const { data: ownedReports, error: ownErr } = await admin
        .from("hazard_reports")
        .select("id")
        .eq("user_id", actorId)
        .in("id", reportIds);
      if (ownErr) throw ownErr;
      allowedReportIds = (ownedReports ?? []).map((row: any) => String(row.id ?? "")).filter(Boolean);
    }

    if (!allowedReportIds.length) return json(200, { ok: true, rows: [] });

    const { data: photos, error: photoErr } = await admin
      .from("hazard_report_photos")
      .select("id, report_id, photo_path, photo_url, created_at")
      .in("report_id", allowedReportIds)
      .order("created_at", { ascending: false });

    if (photoErr) throw photoErr;
    return json(200, { ok: true, rows: photos ?? [] });
  } catch (e: any) {
    return json(500, { error: e?.message ?? String(e) });
  }
});
