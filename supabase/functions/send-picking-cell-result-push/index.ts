// supabase/functions/send-picking-cell-result-push/index.ts
// 피킹셀 변경 요청이 관리자에 의해 처리(applied) / 반려(rejected) 되면
// 요청자(requested_by) 한 명에게 Expo Push 발송.
// 웹 admin PATCH 핸들러에서 service_role 토큰으로 호출.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Body = { request_id?: string };

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

    // 인증: verify_jwt=false + send-parking-push / send-hazard-push 와 동일 패턴.
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
    const payload = (await req.json().catch(() => ({}))) as Body;
    if (!payload.request_id) return json(400, { error: "request_id required" });

    const { data: row, error } = await supabase
      .from("picking_cell_change_requests")
      .select("id, cell_before, cell_after, product_code, product_name, status, admin_memo, requested_by")
      .eq("id", payload.request_id)
      .single();
    if (error || !row) return json(404, { error: error?.message ?? "request not found" });

    if (row.status !== "applied" && row.status !== "rejected") {
      return json(200, { ok: true, sent: 0, reason: "not_processed_yet" });
    }

    const { data: prof } = await supabase
      .from("profiles")
      .select("expo_push_token")
      .eq("id", row.requested_by)
      .single();
    const tk = String((prof as any)?.expo_push_token ?? "").trim();
    if (!tk || !isValidExpoToken(tk)) {
      return json(200, { ok: true, sent: 0, reason: "no_requester_token" });
    }

    const verb = row.status === "applied" ? "처리 완료" : "반려";
    const titlePush = `피킹셀 변경 ${verb}`;
    const cellLine = `${row.cell_before ?? ""} → ${row.cell_after ?? ""}`;
    const productLine = row.product_name ?? row.product_code ?? "";
    const memoLine = row.admin_memo ? `\n메모: ${row.admin_memo}` : "";
    const bodyPush = `${cellLine}${productLine ? ` · ${productLine}` : ""}${memoLine}`.trim();

    const result = await sendExpoPush([
      {
        to: tk,
        sound: "default",
        title: titlePush,
        body: bodyPush,
        data: { type: "picking_cell_request_result", request_id: row.id, status: row.status },
        badge: 1,
        priority: "high",
      },
    ]);

    return json(200, { ok: true, sent: result.ok ? 1 : 0, result });
  } catch (e: any) {
    return json(500, { error: e?.message ?? String(e) });
  }
});
