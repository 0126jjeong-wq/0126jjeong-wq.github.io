import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.95.0";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "GET, OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "GET") return json({ ok: false, error: "Method not allowed" }, 405);
  try {
    const authorization = req.headers.get("authorization") || "";
    const token = authorization.replace(/^Bearer\s+/i, "");
    if (!token) return json({ ok: false, error: "로그인이 필요합니다." }, 401);
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authClient = createClient(url, anon, { global: { headers: { Authorization: authorization } } });
    const { data, error } = await authClient.auth.getUser(token);
    if (error || !data.user) return json({ ok: false, error: "로그인 세션을 확인할 수 없습니다." }, 401);
    const db = createClient(url, service);
    const { data: record, error: lookupError } = await db.from("account_deletion_audit")
      .select("id,blocked_until,restored_at").eq("user_id", data.user.id).maybeSingle();
    if (lookupError) throw lookupError;
    if (record && !record.restored_at) {
      const expires = new Date(record.blocked_until);
      if (expires.getTime() > Date.now()) return json({ ok: true, pending: true, recoverable: true, expires_at: record.blocked_until });
      const { error: deleteError } = await db.auth.admin.deleteUser(data.user.id);
      if (deleteError) throw deleteError;
      return json({ ok: true, expired: true });
    }

    // Compatibility with deletion requests made before recoverable deletion was added.
    const email = String(data.user.email || "").trim().toLowerCase();
    if (email) {
      const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email));
      const identityHash = [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
      const { data: legacy, error: legacyError } = await db.from("account_deletion_audit")
        .select("blocked_until").eq("identity_hash", identityHash).gt("blocked_until", new Date().toISOString())
        .is("user_id", null).order("blocked_until", { ascending: false }).limit(1).maybeSingle();
      if (legacyError) throw legacyError;
      if (legacy) return json({ ok: true, pending: true, recoverable: false, expires_at: legacy.blocked_until });
    }
    return json({ ok: true, pending: false });
  } catch (error) {
    console.error("Account deletion status failed", error);
    return json({ ok: false, error: "계정 상태를 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요." }, 500);
  }
});
