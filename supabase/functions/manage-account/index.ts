import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type RequestBody = {
  action?:
    | "cleanup_incomplete_signup"
    | "reject_delete_user"
    | "mark_pending_by_identity"
    | "get_identity_status"
    | "list_pending_users"
    | "get_pending_labels"
    | "clear_pending_label"
    | "unlock_after_password_reset";
  user_id?: string | null;
  user_ids?: string[] | null;
  phone?: string | null;
  phone_raw?: string | null;
  email?: string | null;
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

function authTokenFrom(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  return auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
}

function isAdminProfile(row: any) {
  return !!row?.is_admin || String(row?.work_part ?? "").trim() === "관리자";
}

function normalizePhone(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function inferPendingLabel(createdAt: unknown, currentLabel: string) {
  if (currentLabel.trim()) return currentLabel.trim();

  return "신규가입";
}

async function getAuthUserById(admin: ReturnType<typeof createClient>, userId: string) {
  try {
    const { data, error } = await admin.auth.admin.getUserById(userId);
    if (!error && data?.user) return data.user;
  } catch {}

  let page = 1;
  while (true) {
    const { data: listData, error: listErr } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (listErr) throw listErr;

    const users = listData.users ?? [];
    const found = users.find((user: any) => String(user.id) === userId);
    if (found) return found;

    if (users.length < 200) break;
    page += 1;
  }

  throw new Error(`Auth user not found: ${userId}`);
}

async function updatePendingLabel(admin: ReturnType<typeof createClient>, userId: string, label: string) {
  const user = await getAuthUserById(admin, userId);
  const currentMeta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const currentAppMeta = (user.app_metadata ?? {}) as Record<string, unknown>;
  const { error: updateErr } = await admin.auth.admin.updateUserById(userId, {
    user_metadata: {
      ...currentMeta,
      pending_label: label,
    },
    app_metadata: {
      ...currentAppMeta,
      pending_label: label,
    },
  });

  if (updateErr) throw updateErr;

  const updatedUser = await getAuthUserById(admin, userId);
  const savedLabel = String(
    (updatedUser.user_metadata ?? {}).pending_label ?? (updatedUser.app_metadata ?? {}).pending_label ?? ""
  ).trim();

  if (savedLabel !== label) {
    throw new Error(`Pending label save failed: expected=${label} actual=${savedLabel || "-"}`);
  }
}

async function getActor(admin: ReturnType<typeof createClient>, token: string) {
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) throw new Error("Unauthorized");
  return data.user;
}

async function ensureAdmin(admin: ReturnType<typeof createClient>, actorId: string) {
  const { data: actorProfile, error } = await admin
    .from("profiles")
    .select("is_admin, work_part")
    .eq("id", actorId)
    .maybeSingle();

  if (error) throw error;
  if (isAdminProfile(actorProfile)) return;

  const { data: adminRow, error: adminRowErr } = await admin
    .from("admin_users")
    .select("user_id")
    .eq("user_id", actorId)
    .maybeSingle();

  if (adminRowErr) {
    throwIfRealAdminLookupError(adminRowErr);
  }
  if (adminRow?.user_id) return;

  throw new Error("Forbidden");
}

function throwIfRealAdminLookupError(err: any) {
  const msg = String(err?.message ?? "").toLowerCase();
  const code = String(err?.code ?? "").toLowerCase();
  if (
    msg.includes("admin_users") &&
    (msg.includes("does not exist") || msg.includes("not found") || msg.includes("relation")) ||
    code === "42p01"
  ) {
    return;
  }
  throw err;
}

async function deleteProfileAndUser(admin: ReturnType<typeof createClient>, userId: string) {
  const { error: profErr } = await admin.from("profiles").delete().eq("id", userId);
  if (profErr) throw profErr;

  const { error: userErr } = await admin.auth.admin.deleteUser(userId);
  if (userErr && !String(userErr.message ?? "").toLowerCase().includes("not found")) {
    throw userErr;
  }
}

async function findUserIdByIdentity(admin: ReturnType<typeof createClient>, body: RequestBody) {
  const wantedPhones = [body.phone, body.phone_raw].map(normalizePhone).filter(Boolean);
  const wantedEmail = String(body.email ?? "").trim().toLowerCase();

  const { data: profileRows, error: profileErr } = await admin
    .from("profiles")
    .select("id, phone, approval_status")
    .limit(5000);

  if (profileErr) throw profileErr;

  const matchedProfile = (profileRows ?? []).find((row: any) => {
    const current = normalizePhone(row.phone);
    if (!current) return false;
    return wantedPhones.some((w) => current === w || current.endsWith(w) || w.endsWith(current));
  });

  if (matchedProfile?.id) {
    return {
      userId: String(matchedProfile.id),
      previousStatus: String(matchedProfile.approval_status ?? ""),
      source: "profiles.phone",
    };
  }

  let page = 1;
  while (true) {
    const { data: listData, error: listErr } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (listErr) throw listErr;

    const users = listData.users ?? [];
    const matchedUser = users.find((user: any) => {
      const authPhone = normalizePhone(user.phone);
      const authEmail = String(user.email ?? "").trim().toLowerCase();

      const phoneMatch =
        authPhone && wantedPhones.some((w) => authPhone === w || authPhone.endsWith(w) || w.endsWith(authPhone));
      const emailMatch = wantedEmail && authEmail === wantedEmail;
      return phoneMatch || emailMatch;
    });

    if (matchedUser?.id) {
      const { data: prof } = await admin
        .from("profiles")
        .select("approval_status")
        .eq("id", matchedUser.id)
        .maybeSingle();

      return {
        userId: String(matchedUser.id),
        previousStatus: String(prof?.approval_status ?? ""),
        source: "auth.users",
      };
    }

    if (users.length < 200) break;
    page += 1;
  }

  return null;
}

async function markPendingByIdentity(admin: ReturnType<typeof createClient>, body: RequestBody) {
  const match = await findUserIdByIdentity(admin, body);
  if (!match?.userId) return json(404, { error: "Profile not found" });

  const { error } = await admin.from("profiles").upsert(
    {
      id: match.userId,
      approval_status: "pending",
    },
    { onConflict: "id" }
  );

  if (error) throw error;
  await updatePendingLabel(admin, match.userId, "비밀번호 5회 오류");

  return json(200, {
    ok: true,
    user_id: match.userId,
    approval_status: "pending",
    source: match.source,
    previous_status: match.previousStatus,
  });
}

async function getIdentityStatus(admin: ReturnType<typeof createClient>, body: RequestBody) {
  const match = await findUserIdByIdentity(admin, body);
  if (!match?.userId) {
    return json(200, {
      ok: true,
      found: false,
      user_id: null,
      approval_status: null,
      pending_label: "",
    });
  }

  const { data: prof, error: profErr } = await admin
    .from("profiles")
    .select("approval_status")
    .eq("id", match.userId)
    .maybeSingle();

  if (profErr) throw profErr;

  const user = await getAuthUserById(admin, match.userId);
  const pendingLabel = String((user.user_metadata ?? {}).pending_label ?? (user.app_metadata ?? {}).pending_label ?? "").trim();

  return json(200, {
    ok: true,
    found: true,
    user_id: match.userId,
    approval_status: String(prof?.approval_status ?? ""),
    pending_label: pendingLabel,
  });
}

async function listPendingUsers(admin: ReturnType<typeof createClient>) {
  const { data, error } = await admin
    .from("profiles")
    .select("id, phone, name, approval_status, created_at")
    .eq("approval_status", "pending")
    .order("created_at", { ascending: true });

  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];
  const userMetaById = new Map<string, string>();

  let page = 1;
  while (true) {
    const { data: listData, error: listErr } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (listErr) throw listErr;

    const users = listData.users ?? [];
    for (const user of users) {
      const label = String((user.user_metadata ?? {}).pending_label ?? (user.app_metadata ?? {}).pending_label ?? "").trim();
      if (label) {
        userMetaById.set(String(user.id), label);
      }
    }

    if (users.length < 200) break;
    page += 1;
  }

  const mergedRows = rows.map((row: any) => ({
    ...row,
    pending_label: inferPendingLabel(row.created_at, userMetaById.get(String(row.id)) || ""),
  }));

  return json(200, {
    ok: true,
    count: mergedRows.length,
    rows: mergedRows,
  });
}

async function getPendingLabels(admin: ReturnType<typeof createClient>, body: RequestBody) {
  const ids = Array.isArray(body.user_ids)
    ? body.user_ids.map((id) => String(id ?? "").trim()).filter(Boolean)
    : [];

  const result: Record<string, string> = {};
  for (const id of ids.slice(0, 200)) {
    const { data, error } = await admin.auth.admin.getUserById(id);
    if (error || !data?.user) continue;
    const label = String((data.user.user_metadata ?? {}).pending_label ?? (data.user.app_metadata ?? {}).pending_label ?? "").trim();
    result[id] = label || "";
  }

  return json(200, { ok: true, labels: result });
}

async function clearPendingLabel(admin: ReturnType<typeof createClient>, actorId: string, body: RequestBody) {
  await ensureAdmin(admin, actorId);

  const targetId = String(body.user_id ?? "").trim();
  if (!targetId) return json(400, { error: "Missing user_id" });

  await updatePendingLabel(admin, targetId, "");
  return json(200, { ok: true, user_id: targetId, pending_label: "" });
}

async function unlockAfterPasswordReset(admin: ReturnType<typeof createClient>, actorId: string) {
  const { error: profErr } = await admin
    .from("profiles")
    .upsert(
      {
        id: actorId,
        approval_status: "approved",
      },
      { onConflict: "id" }
    );

  if (profErr) throw profErr;

  await updatePendingLabel(admin, actorId, "");
  return json(200, { ok: true, user_id: actorId, approval_status: "approved", pending_label: "" });
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

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const body = (await req.json().catch(() => ({}))) as RequestBody;

    if (body.action === "mark_pending_by_identity") {
      return await markPendingByIdentity(admin, body);
    }

    if (body.action === "get_identity_status") {
      return await getIdentityStatus(admin, body);
    }

    if (body.action === "get_pending_labels") {
      return await getPendingLabels(admin, body);
    }

    const token = authTokenFrom(req);
    if (!token) return json(401, { error: "Unauthorized" });

    const actor = await getActor(admin, token);

    if (body.action === "list_pending_users") {
      return await listPendingUsers(admin);
    }

    if (body.action === "clear_pending_label") {
      return await clearPendingLabel(admin, actor.id, body);
    }

    if (body.action === "unlock_after_password_reset") {
      return await unlockAfterPasswordReset(admin, actor.id);
    }

    if (body.action === "cleanup_incomplete_signup") {
      const { data: prof, error: profErr } = await admin
        .from("profiles")
        .select("approval_status, phone_verified, birthdate, nationality")
        .eq("id", actor.id)
        .maybeSingle();

      if (profErr) throw profErr;

      const incomplete =
        !prof ||
        prof.phone_verified !== true ||
        !prof.birthdate ||
        !String(prof.nationality ?? "").trim() ||
        String(prof.approval_status ?? "").trim() === "";

      if (!incomplete) {
        return json(400, { error: "Refusing to delete completed account" });
      }

      await deleteProfileAndUser(admin, actor.id);
      return json(200, { ok: true, deleted_user_id: actor.id });
    }

    if (body.action === "reject_delete_user") {
      const targetId = String(body.user_id ?? "").trim();
      if (!targetId) return json(400, { error: "Missing user_id" });

      await ensureAdmin(admin, actor.id);
      await deleteProfileAndUser(admin, targetId);
      return json(200, { ok: true, deleted_user_id: targetId });
    }

    return json(400, { error: "Invalid action" });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    if (msg === "Forbidden") return json(403, { error: msg });
    return json(500, { error: msg });
  }
});
