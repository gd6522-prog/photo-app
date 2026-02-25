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

function makeTitle(comment: string) {
  const c = (comment || "").trim();
  if (!c) return "위험요인 제보";
  return c.length > 20 ? `위험요인: ${c.slice(0, 20)}…` : `위험요인: ${c}`;
}

function buildMessages(tokens: string[], payload: Body) {
  const title = makeTitle(payload.comment || "");
  const body = (payload.comment || "새 위험요인 제보가 등록되었습니다.").trim();

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
  // Expo Push API
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

    // ✅ 관리자 전원(is_admin=true) 토큰 가져오기
    const { data: admins, error: adminErr } = await supabase
      .from("profiles")
      .select("id, expo_push_token")
      .eq("is_admin", true)
      .not("expo_push_token", "is", null);

    if (adminErr) {
      return json(500, { error: "Failed to fetch admin tokens", detail: adminErr.message });
    }

    const tokens = (admins || [])
      .map((r: any) => String(r.expo_push_token || "").trim())
      .filter((t) => t.startsWith("ExponentPushToken[") || t.startsWith("ExpoPushToken["));

    if (tokens.length === 0) {
      return json(200, { ok: true, sent: 0, reason: "no_admin_tokens" });
    }

    // ✅ Expo는 한번에 너무 많이 보내면 안 좋아서 90개씩 쪼갬(안전)
    const CHUNK = 90;
    const results: any[] = [];
    let sent = 0;

    for (let i = 0; i < tokens.length; i += CHUNK) {
      const chunk = tokens.slice(i, i + CHUNK);
      const messages = buildMessages(chunk, payload);

      const r = await sendExpoPush(messages);
      results.push(r);
      if (r.ok) sent += chunk.length;
    }

    return json(200, {
      ok: true,
      adminCountWithToken: tokens.length,
      sent,
      results,
    });
  } catch (e: any) {
    return json(500, { error: e?.message ?? String(e) });
  }
});
