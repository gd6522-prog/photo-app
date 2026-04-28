// supabase/functions/send-parking-push/index.ts
// 정기 주차신청 신규 등록 시, 메인관리자 + 센터관리자에게 Expo Push 발송

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Body = {
  request_id?: string | null;
  company?: string | null;
  name?: string | null;
  car_number?: string | null;
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

function compactWorkPart(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, "");
}

function isMainOrCenterAdmin(row: any) {
  if (row?.is_admin === true) return true;
  const wp = compactWorkPart(row?.work_part);
  if (wp === "관리자" || wp === "일반관리자") return true;
  if (wp === "센터관리자") return true;
  return false;
}

function buildMessages(tokens: string[], body: Body, pendingTotal: number) {
  const who = String(body.name ?? "").trim() || "외부 차량";
  const car = String(body.car_number ?? "").trim();
  const company = String(body.company ?? "").trim();
  const text = `${company ? `[${company}] ` : ""}${who}${car ? ` (${car})` : ""}님이 정기 주차를 신청했습니다.`;

  return tokens.map((to) => ({
    to,
    sound: "default",
    title: "정기 주차신청",
    body: text,
    data: {
      type: "parking_request_new",
      request_id: body.request_id ?? null,
    },
    badge: pendingTotal > 0 ? pendingTotal : 1,
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

    // 메인관리자 + 센터관리자 토큰 수집
    const { data: admins, error: adminErr } = await supabase
      .from("profiles")
      .select("id, expo_push_token, is_admin, work_part")
      .not("expo_push_token", "is", null);

    if (adminErr) {
      return json(500, { error: "Failed to fetch admin tokens", detail: adminErr.message });
    }

    const tokens = Array.from(
      new Set(
        (admins || [])
          .filter((r: any) => isMainOrCenterAdmin(r))
          .map((r: any) => String(r.expo_push_token || "").trim())
          .filter((t) => t.startsWith("ExponentPushToken[") || t.startsWith("ExpoPushToken["))
      )
    );

    if (tokens.length === 0) {
      return json(200, { ok: true, sent: 0, reason: "no_admin_tokens" });
    }

    // 현재 대기중 정기신청 총 건수 → 배지에 사용
    let pendingTotal = 0;
    try {
      const { count } = await supabase
        .from("parking_requests")
        .select("id", { count: "exact", head: true })
        .eq("type", "regular")
        .eq("status", "pending");
      pendingTotal = Number.isFinite(count as any) ? Number(count) : 0;
    } catch {}

    const CHUNK = 90;
    const results: any[] = [];
    let sent = 0;

    for (let i = 0; i < tokens.length; i += CHUNK) {
      const chunk = tokens.slice(i, i + CHUNK);
      const messages = buildMessages(chunk, payload, pendingTotal);
      const r = await sendExpoPush(messages);
      results.push(r);
      if (r.ok) sent += chunk.length;
    }

    return json(200, { ok: true, adminCountWithToken: tokens.length, sent, pendingTotal, results });
  } catch (e: any) {
    return json(500, { error: e?.message ?? String(e) });
  }
});
