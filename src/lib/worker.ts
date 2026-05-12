// 일반 작업자(zone worker)용 헬퍼: 긴급출고 / 피킹셀 조정 / 체화재고
//
// 관리자가 아닌 일반 작업파트(박스존, 이너존, 슬라존, 경량존, 이형존, 담배존, 공병, 지게차)
// 작업자에게 메인 화면에서 노출되는 카드의 데이터 소스.
import { supabase } from "./supabase";

export const ZONE_WORK_PARTS = [
  "박스존",
  "이너존",
  "슬라존",
  "경량존",
  "이형존",
  "담배존",
  "공병",
  "지게차",
] as const;
export type ZoneWorkPart = (typeof ZONE_WORK_PARTS)[number];

export function isZoneWorkPart(value: unknown): value is ZoneWorkPart {
  return typeof value === "string" && (ZONE_WORK_PARTS as readonly string[]).includes(value);
}

export type UrgentDispatchRow = {
  id: string;
  title: string;
  body: string;
  target_work_part: string;
  target_store_code: string | null;
  target_store_name: string | null;
  created_at: string;
  resolved_at: string | null;
};

export type UrgentDispatchReplyRow = {
  id: string;
  dispatch_id: string;
  user_id: string;
  photo_id: string | null;
  note: string | null;
  created_at: string;
};

/**
 * 일반 작업자 메인 화면 배지 = (본인 work_part 대상 + 미해결 + 본인이 사진회신 안 한) 긴급출고 개수.
 * 체화재고는 외부(R2) 데이터 의존이라 이 카운트에는 포함하지 않는다.
 */
export async function getWorkerPendingCount(workPart: string, userId: string | null): Promise<number> {
  if (!workPart || !userId) return 0;
  try {
    const { data: dispatches, error } = await supabase
      .from("urgent_dispatches")
      .select("id")
      .eq("target_work_part", workPart)
      .is("resolved_at", null);
    if (error || !dispatches?.length) return 0;

    const ids = dispatches.map((d: any) => d.id as string);
    const { data: replies } = await supabase
      .from("urgent_dispatch_replies")
      .select("dispatch_id")
      .eq("user_id", userId)
      .in("dispatch_id", ids);

    const replied = new Set((replies ?? []).map((r: any) => r.dispatch_id as string));
    return ids.filter((id) => !replied.has(id)).length;
  } catch {
    return 0;
  }
}

export async function fetchUrgentDispatches(workPart: string): Promise<UrgentDispatchRow[]> {
  if (!workPart) return [];
  const { data, error } = await supabase
    .from("urgent_dispatches")
    .select("id, title, body, target_work_part, target_store_code, target_store_name, created_at, resolved_at")
    .eq("target_work_part", workPart)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as UrgentDispatchRow[];
}

export async function fetchMyReplies(userId: string, dispatchIds: string[]): Promise<UrgentDispatchReplyRow[]> {
  if (!userId || dispatchIds.length === 0) return [];
  const { data, error } = await supabase
    .from("urgent_dispatch_replies")
    .select("id, dispatch_id, user_id, photo_id, note, created_at")
    .eq("user_id", userId)
    .in("dispatch_id", dispatchIds);
  if (error) throw error;
  return (data ?? []) as UrgentDispatchReplyRow[];
}
