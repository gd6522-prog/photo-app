import { supabase } from "./supabase";

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function kstToday() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return `${kst.getUTCFullYear()}-${pad2(kst.getUTCMonth() + 1)}-${pad2(kst.getUTCDate())}`;
}

function kstDayRangeUtcIso(ymd: string) {
  const [y, m, d] = ymd.split("-").map((v) => Number(v));
  const startMs = Date.UTC(y, m - 1, d, -9, 0, 0, 0);
  const endMs = startMs + 24 * 60 * 60 * 1000;
  return {
    startIso: new Date(startMs).toISOString(),
    endIso: new Date(endMs).toISOString(),
  };
}

export async function getTodayTempWorkPart(userId: string, ymd = kstToday()) {
  const { data, error } = await supabase
    .from("work_shifts")
    .select("status, clock_out_at")
    .eq("user_id", userId)
    .eq("work_date", ymd)
    .maybeSingle();

  if (error) throw error;
  const isOpen = String((data as any)?.status ?? "").trim() === "open" && !(data as any)?.clock_out_at;
  if (!isOpen) return "";

  const { startIso, endIso } = kstDayRangeUtcIso(ymd);
  const clockInEvent = await supabase
    .from("work_events")
    .select("payload, occurred_at")
    .eq("user_id", userId)
    .eq("event_type", "clock_in")
    .gte("occurred_at", startIso)
    .lt("occurred_at", endIso)
    .order("occurred_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (clockInEvent.error) throw clockInEvent.error;
  return String((clockInEvent.data as any)?.payload?.today_work_part ?? "").trim();
}
