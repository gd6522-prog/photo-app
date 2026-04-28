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

export type AdminRole = "main" | "center" | "company" | null;

export type ParkingRequestRow = {
  id: string;
  type: "regular" | "visitor";
  company: string;
  name: string;
  car_number: string;
  phone: string;
  visit_date: string | null;
  expire_date: string | null;
  status: "pending" | "approved" | "rejected" | "expired";
  reject_reason: string | null;
  admin_memo: string | null;
  created_at: string;
};

function inferPendingLabel(row: Partial<PendingApprovalRow>) {
  const explicit = String(row.pending_label ?? "").trim();
  if (explicit) return explicit;

  return "신규가입";
}

function compactWorkPart(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, "");
}

export async function getAdminRole(): Promise<AdminRole> {
  const { data: sess } = await supabase.auth.getSession();
  const user = sess?.session?.user;
  if (!user) return null;

  let prof: any = null;
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("is_admin, is_company_admin, work_part")
      .eq("id", user.id)
      .maybeSingle();
    if (!error) prof = data;
  } catch {}

  if (prof?.is_admin === true) return "main";

  const wp = compactWorkPart(prof?.work_part);
  if (wp === "관리자" || wp === "일반관리자") return "main";
  if (wp === "센터관리자") return "center";
  if (prof?.is_company_admin === true) return "company";
  if (wp === "업체관리자") return "company";

  try {
    const { data, error } = await supabase
      .from("admin_users")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!error && data?.user_id) return "main";
  } catch {}

  return null;
}

export async function isAdminUser(): Promise<boolean> {
  return (await getAdminRole()) !== null;
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

async function getSignupPendingCount(): Promise<number> {
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

export async function getPendingParkingCount(): Promise<number> {
  try {
    const { count, error } = await supabase
      .from("parking_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending")
      .eq("type", "regular");
    if (error) return 0;
    return Number.isFinite(count as any) ? Number(count) : 0;
  } catch {
    return 0;
  }
}

export async function getPendingCount(role?: AdminRole): Promise<number> {
  const r = role ?? (await getAdminRole());
  if (!r) return 0;

  if (r === "main") {
    const [signup, parking] = await Promise.all([getSignupPendingCount(), getPendingParkingCount()]);
    return signup + parking;
  }
  if (r === "center") {
    return getPendingParkingCount();
  }
  if (r === "company") {
    return getSignupPendingCount();
  }
  return 0;
}

export async function fetchPendingParkingRequests(): Promise<ParkingRequestRow[]> {
  const { data, error } = await supabase
    .from("parking_requests")
    .select("id, type, company, name, car_number, phone, visit_date, expire_date, status, reject_reason, admin_memo, created_at")
    .eq("type", "regular")
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ParkingRequestRow[];
}

export async function setParkingRequestStatus(
  id: string,
  status: "approved" | "rejected",
  rejectReason?: string
): Promise<void> {
  const { data: sess } = await supabase.auth.getSession();
  const uid = sess?.session?.user?.id ?? null;
  const nowIso = new Date().toISOString();

  const patch: Record<string, unknown> =
    status === "approved"
      ? {
          status: "approved",
          approved_at: nowIso,
          approved_by: uid,
          reject_reason: null,
          expire_date: "2999-12-31",
        }
      : {
          status: "rejected",
          reject_reason: rejectReason?.trim() || "관리자 거절",
        };

  const { error } = await supabase.from("parking_requests").update(patch).eq("id", id);
  if (error) throw error;
}
