// src/lib/workParts.ts
export type Option = { label: string; value: string };

export const WORK_PART_OPTIONS: Option[] = [
  { label: "선택", value: "" },
  { label: "박스존", value: "박스존" },
  { label: "이너존", value: "이너존" },
  { label: "슬라존", value: "슬라존" },
  { label: "경량존", value: "경량존" },
  { label: "이형존", value: "이형존" },
  { label: "담배존", value: "담배존" },
  { label: "관리자", value: "관리자" },
  { label: "기사", value: "기사" },
];

// ✅ 업로드 화면(작업파트 설정 모달)에서는 "기사" 제외
export function getWorkPartOptionsExceptDriver(): Option[] {
  return WORK_PART_OPTIONS.filter((o) => o.value !== "기사");
}

// ✅ 회원가입에서는 "기사" 포함
export function getWorkPartOptionsIncludeDriver(): Option[] {
  return [...WORK_PART_OPTIONS];
}
