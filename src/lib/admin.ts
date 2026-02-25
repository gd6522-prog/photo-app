// src/lib/admin.ts
import { supabase } from "./supabase";

// ✅ 진짜 "승인/관리" 권한자(예: admin_users 테이블/메타데이터 등)
//    너 프로젝트에서 이미 쓰던 기존 로직이 있을 수 있어서,
//    여기서는 "profiles.is_admin" 또는 "admin_users" 둘 중 하나만 있어도 되게 유연하게 해둠.
export async function isAdminUser(): Promise<boolean> {
  const { data: sess } = await supabase.auth.getSession();
  const user = sess?.session?.user;
  if (!user) return false;

  // 1) profiles.is_admin 컬럼이 있는 경우 (있으면 이걸 우선)
  try {
    const { data: prof, error } = await supabase
      .from("profiles")
      .select("is_admin")
      .eq("id", user.id)
      .maybeSingle();

    if (!error && prof && typeof (prof as any).is_admin === "boolean") {
      return !!(prof as any).is_admin;
    }
  } catch {}

  // 2) admin_users 테이블이 있는 경우 (있으면 존재 여부로 판단)
  try {
    const { data, error } = await supabase
      .from("admin_users")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!error && data?.user_id) return true;
  } catch {}

  return false;
}

// ✅ "작업파트 관리자" (회원가입 때 work_part를 '관리자'로 선택한 사람)
//    ==> 업로드 화면 우측상단 "작업파트 설정" 버튼은 이걸로 보여주기!
export async function isWorkPartAdmin(): Promise<boolean> {
  const { data: sess } = await supabase.auth.getSession();
  const user = sess?.session?.user;
  if (!user) return false;

  const { data: prof, error } = await supabase
    .from("profiles")
    .select("work_part")
    .eq("id", user.id)
    .maybeSingle();

  if (error) return false;

  const wp = (prof?.work_part ?? "").trim();
  return wp === "관리자";
}

// (너가 이미 쓰고 있던 함수면 유지)
// ✅ 승인 대기 카운트: "진짜 승인 권한자"만 볼 거라면 isAdminUser()와 같이 쓰면 됨
export async function getPendingCount(): Promise<number> {
  // approve 대상 테이블/조건은 너 프로젝트 기준이 있으니 기존 코드 있으면 그걸로 쓰는 게 맞음.
  // 안전하게 0 반환만 기본 제공.
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("approval_status", "pending");

    if (error) return 0;
    // @ts-ignore
    return (data as any)?.length ? (data as any).length : 0;
  } catch {
    return 0;
  }
}
