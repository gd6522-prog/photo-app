// supabase/functions/send-urgent-dispatch-push/index.ts
// 긴급출고 공지가 등록되면, 대상 작업파트(target_work_part)에 속한 일반 사용자 전원에게
// Expo Push 발송. 호출은 웹 admin 의 작성 API 에서 service_role 토큰으로 수행.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Body = {
  dispatch_id?: string;
  // dispatch_id 가 있으면 DB 에서 다시 조회한다. 아래 필드는 fallback.
  title?: string;
  body?: string;
  target_work_part?: string;
  target_store_code?: string | null;
  target_store_name?: string | null;
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

function isValidExpoToken(t: string) {
  return t.startsWith("ExponentPushToken[") || t.startsWith("ExpoPushToken[");
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

    // 호출 인증: verify_jwt=false 로 운영하므로 직접 service_role 키 검증.
    // (웹 admin API 가 service_role 키로만 호출하는 내부 함수)
    const auth = req.headers.get("authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (!token || token !== SERVICE_ROLE) {
      return json(401, { error: "Unauthorized" });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
    const payload = (await req.json().catch(() => ({}))) as Body;

    // dispatch_id 가 있으면 DB 에서 다시 조회 (신뢰성↑)
    let dispatch: {
      id: string | null;
      title: string;
      body: string;
      target_work_part: string;
      target_store_code: string | null;
      target_store_name: string | null;
    } = {
      id: payload.dispatch_id ?? null,
      title: String(payload.title ?? "").trim(),
      body: String(payload.body ?? "").trim(),
      target_work_part: String(payload.target_work_part ?? "").trim(),
      target_store_code: payload.target_store_code ?? null,
      target_store_name: payload.target_store_name ?? null,
    };

    if (payload.dispatch_id) {
      const { data, error } = await supabase
        .from("urgent_dispatches")
        .select("id, title, body, target_work_part, target_store_code, target_store_name")
        .eq("id", payload.dispatch_id)
        .single();
      if (!error && data) {
        dispatch = data as typeof dispatch;
      }
    }

    if (!dispatch.target_work_part) {
      return json(400, { error: "target_work_part required" });
    }

    // 대상 토큰 수집: profiles.work_part = target_work_part AND expo_push_token != null
    const { data: rows, error: profErr } = await supabase
      .from("profiles")
      .select("id, expo_push_token, work_part")
      .eq("work_part", dispatch.target_work_part)
      .not("expo_push_token", "is", null);
    if (profErr) {
      return json(500, { error: "Failed to fetch worker tokens", detail: profErr.message });
    }

    const tokens = Array.from(
      new Set(
        (rows || [])
          .map((r: any) => String(r.expo_push_token || "").trim())
          .filter(isValidExpoToken)
      )
    );

    if (tokens.length === 0) {
      return json(200, { ok: true, sent: 0, reason: "no_worker_tokens" });
    }

    const storeLine =
      dispatch.target_store_code || dispatch.target_store_name
        ? `[${dispatch.target_store_code ?? ""}${dispatch.target_store_name ? ` ${dispatch.target_store_name}` : ""}]`
        : "";
    const titlePush = "🚨 긴급출고";
    const bodyPush = `${storeLine}${storeLine ? " " : ""}${dispatch.title}`.trim();

    const messages = tokens.map((to) => ({
      to,
      sound: "default",
      title: titlePush,
      body: bodyPush,
      data: { type: "urgent_dispatch_new", dispatch_id: dispatch.id },
      badge: 1,
      priority: "high",
    }));

    const CHUNK = 90;
    const results: any[] = [];
    let sent = 0;
    for (let i = 0; i < messages.length; i += CHUNK) {
      const chunk = messages.slice(i, i + CHUNK);
      const r = await sendExpoPush(chunk);
      results.push(r);
      if (r.ok) sent += chunk.length;
    }

    return json(200, { ok: true, targetWorkPart: dispatch.target_work_part, tokenCount: tokens.length, sent, results });
  } catch (e: any) {
    return json(500, { error: e?.message ?? String(e) });
  }
});
