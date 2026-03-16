import { SUPABASE_ANON_KEY, SUPABASE_URL, supabase } from "./supabase";

export type PendingApprovalRow = {
  id: string;
  phone: string | null;
  name: string | null;
  approval_status: "pending" | "approved" | "rejected";
  created_at: string;
  pending_label?: string | null;
};

type PendingApprovalPayload = {
  ok: boolean;
  count: number;
  rows: PendingApprovalRow[];
};

type PendingLabelPayload = {
  ok: boolean;
  labels: Record<string, string>;
};

function inferPendingLabel(row: Partial<PendingApprovalRow>) {
  const explicit = String(row.pending_label ?? "").trim();
  if (explicit) return explicit;

  const created = new Date(String(row.created_at ?? ""));
  if (!Number.isNaN(created.getTime())) {
    const ageMs = Date.now() - created.getTime();
    if (ageMs > 24 * 60 * 60 * 1000) {
      return "비밀번호 5회 오류";
    }
  }

  return "신규가입";
}

export async function isAdminUser(): Promise<boolean> {
  const { data: sess } = await supabase.auth.getSession();
  const user = sess?.session?.user;
  if (!user) return false;

  try {
    const { data: prof, error } = await supabase.from("profiles").select("is_admin").eq("id", user.id).maybeSingle();
    if (!error && prof && typeof (prof as any).is_admin === "boolean") {
      return !!(prof as any).is_admin;
    }
  } catch {}

  try {
    const { data, error } = await supabase.from("admin_users").select("user_id").eq("user_id", user.id).maybeSingle();
    if (!error && data?.user_id) return true;
  } catch {}

  try {
    const { data: prof, error } = await supabase.from("profiles").select("work_part").eq("id", user.id).maybeSingle();
    if (!error && String(prof?.work_part ?? "").trim() === "관리자") {
      return true;
    }
  } catch {}

  return false;
}

export async function fetchPendingApprovals(): Promise<PendingApprovalPayload> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;

  const accessToken = String(data.session?.access_token ?? "").trim();
  if (!accessToken) throw new Error("관리자 세션이 없습니다.");

  const res = await fetch(`${SUPABASE_URL}/functions/v1/manage-account`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ action: "list_pending_users" }),
  });

  const payload = (await res.json().catch(() => ({}))) as Partial<PendingApprovalPayload> & { error?: string };
  if (!res.ok) throw new Error(payload.error || "승인 대기 목록 조회 실패");

  const rows = Array.isArray(payload.rows) ? (payload.rows as PendingApprovalRow[]) : [];
  return {
    ok: true,
    count: Number(payload.count ?? rows.length),
    rows: rows.map((row) => ({ ...row, pending_label: inferPendingLabel(row) })),
  };
}

export async function fetchPendingLabels(userIds: string[]): Promise<Record<string, string>> {
  const ids = userIds.map((id) => String(id ?? "").trim()).filter(Boolean);
  if (!ids.length) return {};

  const res = await fetch(`${SUPABASE_URL}/functions/v1/manage-account`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ action: "get_pending_labels", user_ids: ids }),
  });

  const payload = (await res.json().catch(() => ({}))) as Partial<PendingLabelPayload> & { error?: string };
  if (!res.ok) throw new Error(payload.error || "승인 라벨 조회 실패");

  return payload.labels ?? {};
}

export async function getPendingCount(): Promise<number> {
  try {
    const payload = await fetchPendingApprovals();
    return payload.count;
  } catch {
    try {
      const { count, error } = await supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("approval_status", "pending");

      if (error) return 0;
      return Number.isFinite(count as any) ? Number(count) : 0;
    } catch {
      return 0;
    }
  }
}
