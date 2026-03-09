import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type RequestBody = {
  action?: "cleanup_incomplete_signup" | "reject_delete_user";
  user_id?: string | null;
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

async function getActor(admin: ReturnType<typeof createClient>, token: string) {
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) throw new Error("Unauthorized");
  return data.user;
}

async function deleteProfileAndUser(admin: ReturnType<typeof createClient>, userId: string) {
  const { error: profErr } = await admin.from("profiles").delete().eq("id", userId);
  if (profErr) throw profErr;

  const { error: userErr } = await admin.auth.admin.deleteUser(userId);
  if (userErr && !String(userErr.message ?? "").toLowerCase().includes("not found")) {
    throw userErr;
  }
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

    const token = authTokenFrom(req);
    if (!token) return json(401, { error: "Unauthorized" });

    const actor = await getActor(admin, token);
    const body = (await req.json().catch(() => ({}))) as RequestBody;

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

      const { data: actorProfile, error: actorErr } = await admin
        .from("profiles")
        .select("is_admin, work_part")
        .eq("id", actor.id)
        .maybeSingle();

      if (actorErr) throw actorErr;
      if (!isAdminProfile(actorProfile)) return json(403, { error: "Forbidden" });

      await deleteProfileAndUser(admin, targetId);
      return json(200, { ok: true, deleted_user_id: targetId });
    }

    return json(400, { error: "Invalid action" });
  } catch (e: any) {
    return json(500, { error: e?.message ?? String(e) });
  }
});
