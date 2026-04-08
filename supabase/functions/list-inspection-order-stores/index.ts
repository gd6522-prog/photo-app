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

function normalizeStoreCode(input: string | null | undefined) {
  const digits = String(input ?? "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.length >= 5 ? digits.slice(0, 5) : digits.padStart(5, "0");
}

type VehicleSnapshotCargoRow = {
  store_code?: string | null;
  large_box?: number | null;
  large_inner?: number | null;
  large_other?: number | null;
  small_low?: number | null;
  small_high?: number | null;
  tobacco?: number | null;
};

type VehicleSnapshot = {
  cargoRows?: VehicleSnapshotCargoRow[] | null;
};

// work_part → cargoRow에서 발주량을 확인할 필드 목록
const WORK_PART_FIELDS: Record<string, (keyof VehicleSnapshotCargoRow)[]> = {
  "박스존": ["large_box"],
  "이너존": ["large_inner"],
  "이형존": ["large_other"],
  "경량존": ["small_low"],
  "슬라존": ["small_high"],
  "담배존": ["tobacco"],
};

function hasOrderForPart(row: VehicleSnapshotCargoRow, fields: (keyof VehicleSnapshotCargoRow)[]): boolean {
  return fields.some((f) => ((row[f] as number | null) ?? 0) > 0);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflight();
  if (req.method !== "POST") return json(405, { error: "Method Not Allowed" });

  try {
    const body = await req.json().catch(() => ({})) as { work_part?: string };
    const workPart = (body?.work_part ?? "").trim();
    const partFields = WORK_PART_FIELDS[workPart] ?? null;

    const R2_PUBLIC_URL = "https://pub-2ed566ac41944f778e208a0ccea9acd5.r2.dev";
    const r2Res = await fetch(`${R2_PUBLIC_URL}/vehicle-data/current/latest.json`);
    if (!r2Res.ok) {
      if (r2Res.status === 404) {
        return json(200, { ok: true, store_codes: [] });
      }
      throw new Error(`R2 데이터 조회 실패 (${r2Res.status})`);
    }

    const raw = await r2Res.text();
    const parsed = JSON.parse(raw) as VehicleSnapshot;
    const allRows = parsed.cargoRows ?? [];

    const filteredRows = partFields
      ? allRows.filter((row) => hasOrderForPart(row, partFields))
      : allRows;

    const storeCodes = Array.from(
      new Set(
        filteredRows
          .map((row) => normalizeStoreCode(row?.store_code))
          .filter(Boolean)
      )
    );

    return json(200, { ok: true, store_codes: storeCodes });
  } catch (e: any) {
    return json(500, { error: e?.message ?? String(e) });
  }
});
