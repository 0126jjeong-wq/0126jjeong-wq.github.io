import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.95.0";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
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
    const email = String(data.user.email || "").trim().toLowerCase();
    if (!email) return json({ ok: false, error: "계정 이메일을 확인할 수 없습니다." }, 400);

    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email));
    const identityHash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
    const db = createClient(url, service);
    const deletedAt = new Date().toISOString();
    const blockedUntil = new Date(Date.now() + 30 * 86400000).toISOString();
    const { error: auditError } = await db.from("account_deletion_audit").upsert({
      user_id: data.user.id,
      identity_hash: identityHash,
      deleted_at: deletedAt,
      restored_at: null,
      blocked_until: blockedUntil,
    }, { onConflict: "user_id" });
    if (auditError) throw auditError;
    return json({ ok: true, recover_until: blockedUntil });
  } catch (error) {
    console.error("Account deletion request failed", error);
    return json({ ok: false, error: "탈퇴 처리에 실패했어요. 저장된 정보는 삭제되지 않았으니 다시 시도해주세요." }, 500);
  }
});
