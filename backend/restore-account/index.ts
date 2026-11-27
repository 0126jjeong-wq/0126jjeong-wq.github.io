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
    const authClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authorization } } });
    const { data, error } = await authClient.auth.getUser(token);
    if (error || !data.user) return json({ ok: false, error: "로그인 세션을 확인할 수 없습니다." }, 401);
    const db = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: record, error: lookupError } = await db.from("account_deletion_audit")
      .select("id,blocked_until,restored_at").eq("user_id", data.user.id).maybeSingle();
    if (lookupError) throw lookupError;
    if (!record || record.restored_at || new Date(record.blocked_until).getTime() <= Date.now()) {
      return json({ ok: false, error: "복구 기간이 끝났거나 복구할 탈퇴 신청이 없습니다. 다시 가입해 주세요." }, 409);
    }
    const { error: restoreError } = await db.from("account_deletion_audit").update({ restored_at: new Date().toISOString() }).eq("id", record.id);
    if (restoreError) throw restoreError;
    return json({ ok: true });
  } catch (error) {
    console.error("Account restoration failed", error);
    return json({ ok: false, error: "계정을 복구하지 못했어요. 잠시 뒤 다시 시도해 주세요." }, 500);
  }
});
