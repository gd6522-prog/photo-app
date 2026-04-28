import { SUPABASE_ANON_KEY, SUPABASE_URL, supabase } from "./supabase";

// Drido 웹(Next.js) API base URL — sregist(주차관제) 자동등록을 함께 처리하는 라우트 호출용
const DRIDO_API_BASE = "https://dridolabs.com";

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

/**
 * 주차 신청 승인/거절 처리.
 *
 * - 승인은 Drido 웹의 API 라우트를 호출해 DB 승인 + sregist(주차관제) 자동등록까지 함께 수행한다.
 *   기존 supabase 직접 update 방식은 sregist 호출이 빠져 차량이 외부 시스템에 등록되지 않았다.
 * - 거절은 sregist와 무관해서 종전대로 supabase 직접 update.
 *
 * 반환값: sregistError 가 있으면 "DB 승인은 됐지만 주차관제 자동등록은 실패" 한 케이스.
 *        호출 측에서 별도 알림 표시 후, 관리자 웹 페이지의 [재등록] 버튼으로 복구 가능하다.
 */
export async function setParkingRequestStatus(
  id: string,
  status: "approved" | "rejected",
  rejectReason?: string
): Promise<{ sregistError?: string }> {
  if (status === "approved") {
    const { data: sess, error: sessErr } = await supabase.auth.getSession();
    if (sessErr) throw sessErr;
    const accessToken = String(sess.session?.access_token ?? "").trim();
    if (!accessToken) throw new Error("관리자 세션이 없습니다.");

    const res = await fetch(`${DRIDO_API_BASE}/api/admin/parking/${id}/approve`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const payload = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      message?: string;
      sregistAttempted?: boolean;
      sregistRegistered?: boolean;
      sregistError?: string;
    };

    if (!res.ok || payload.ok === false) {
      throw new Error(payload.message || `승인 처리 실패 (HTTP ${res.status})`);
    }

    if (payload.sregistAttempted && payload.sregistRegistered === false) {
      return { sregistError: payload.sregistError || "주차관제 자동등록 실패" };
    }
    return {};
  }

  // 거절: 종전대로 supabase 직접 update (sregist 영향 없음)
  const { error } = await supabase
    .from("parking_requests")
    .update({
      status: "rejected",
      reject_reason: rejectReason?.trim() || "관리자 거절",
    })
    .eq("id", id);
  if (error) throw error;
  return {};
}
