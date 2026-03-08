// supabase/functions/send-hazard-push/index.ts
// Deno / Supabase Edge Function

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Body = {
  report_id?: string | null;
  comment?: string | null;
  photo_url?: string | null;
  created_by?: string | null;
};

function json(status: number, data: any) {
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

function makeNotifyBody(reporterName: string) {
  const who = (reporterName || "").trim() || "사용자";
  return `${who}님이 위험요인을 제보했습니다. 확인 바랍니다.`;
}

function buildMessages(tokens: string[], payload: Body, reporterName: string) {
  const title = "알림";
  const body = makeNotifyBody(reporterName);

  return tokens.map((to) => ({
    to,
    sound: "default",
    title,
    body,
    data: {
      type: "hazard_report",
      report_id: payload.report_id ?? null,
      created_by: payload.created_by ?? null,
      photo_url: payload.photo_url ?? null,
    },
    priority: "high",
  }));
}

async function sendExpoPush(messages: any[]) {
  const res = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(messages),
  });

  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
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

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false },
    });

    const payload = (await req.json().catch(() => ({}))) as Body;

    let reporterName = "";
    if (payload.created_by) {
      const { data: reporter } = await supabase
        .from("profiles")
        .select("name")
        .eq("id", payload.created_by)
        .maybeSingle();
      reporterName = String((reporter as any)?.name ?? "").trim();
    }

    // 대상:
    // 1) 권한 관리자 (is_admin = true)
    // 2) 작업파트 관리자 (work_part = "관리자")
    const { data: admins, error: adminErr } = await supabase
      .from("profiles")
      .select("id, expo_push_token, is_admin, work_part")
      .or("is_admin.eq.true,work_part.eq.관리자")
      .not("expo_push_token", "is", null);

    if (adminErr) {
      return json(500, { error: "Failed to fetch admin tokens", detail: adminErr.message });
    }

    const tokens = Array.from(
      new Set(
        (admins || [])
          .map((r: any) => String(r.expo_push_token || "").trim())
          .filter((t) => t.startsWith("ExponentPushToken[") || t.startsWith("ExpoPushToken["))
      )
    );

    if (tokens.length === 0) {
      return json(200, { ok: true, sent: 0, reason: "no_admin_tokens" });
    }

    const CHUNK = 90;
    const results: any[] = [];
    let sent = 0;

    for (let i = 0; i < tokens.length; i += CHUNK) {
      const chunk = tokens.slice(i, i + CHUNK);
      const messages = buildMessages(chunk, payload, reporterName);

      const r = await sendExpoPush(messages);
      results.push(r);
      if (r.ok) sent += chunk.length;
    }

    return json(200, {
      ok: true,
      adminCountWithToken: tokens.length,
      sent,
      reporterName: reporterName || null,
      results,
    });
  } catch (e: any) {
    return json(500, { error: e?.message ?? String(e) });
  }
});
