import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.95.0";

const allowedOrigins=new Set([
  "https://0126jjeong-wq.github.io",
  "https://myreelsmap.com",
  "https://www.myreelsmap.com",
  "https://reelsmap-ios-preview.milky-bud-7541.chatgpt.site",
  "capacitor://localhost"
]);
const fallbackOrigin="https://myreelsmap.com";
const cors=(origin:string|null)=>({
  "Access-Control-Allow-Origin":origin&&allowedOrigins.has(origin)?origin:fallbackOrigin,
  "Access-Control-Allow-Headers":"authorization, content-type",
  "Access-Control-Allow-Methods":"POST, OPTIONS",
  "Vary":"Origin"
});
const json=(body:unknown,status:number,origin:string|null)=>new Response(JSON.stringify(body),{
  status,
  headers:{...cors(origin),"content-type":"application/json; charset=utf-8","cache-control":"no-store"}
});
const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const visitorPattern=/^[a-zA-Z0-9_-]{16,100}$/;
const eventTypes=new Set(["visit","restaurant","reel","route"]);
async function hashVisitor(value:string){
  const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes)).map(x=>x.toString(16).padStart(2,"0")).join("");
}

Deno.serve(async(req:Request)=>{
  const origin=req.headers.get("origin");
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors(origin)});
  if(req.method!=="POST")return json({ok:false,error:"POST only"},405,origin);
  if(origin&&!allowedOrigins.has(origin))return json({ok:false,error:"허용되지 않은 요청입니다."},403,origin);

  let body:any;
  try{body=await req.json()}catch{return json({ok:false,error:"요청 형식이 올바르지 않습니다."},400,origin)}
  const restaurantId=typeof body?.restaurant_id==="string"?body.restaurant_id.trim():"";
  const eventType=typeof body?.event_type==="string"?body.event_type.trim():"";
  const visitorId=typeof body?.visitor_id==="string"?body.visitor_id.trim():"";
  if(!eventTypes.has(eventType))return json({ok:false,error:"집계 유형이 올바르지 않습니다."},400,origin);
  if(eventType!=="visit"&&!uuidPattern.test(restaurantId))return json({ok:false,error:"집계 대상이 올바르지 않습니다."},400,origin);
  if(!visitorPattern.test(visitorId))return json({ok:false,error:"방문자 정보가 올바르지 않습니다."},400,origin);

  const supabase=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  if(eventType!=="visit"){
    const {data:restaurant,error:findError}=await supabase.from("restaurants").select("id").eq("id",restaurantId).eq("status","published").maybeSingle();
    if(findError)return json({ok:false,error:"집계 대상을 확인하지 못했습니다."},500,origin);
    if(!restaurant)return json({ok:false,error:"공개된 맛집이 아닙니다."},404,origin);
  }

  const visitorHash=await hashVisitor(visitorId);
  let memberUserId:string|null=null;
  const authorization=req.headers.get("authorization")||"";
  if(eventType==="visit"&&authorization){
    const accessToken=authorization.replace(/^Bearer\s+/i,"");
    const {data:userData,error:userError}=await supabase.auth.getUser(accessToken);
    if(userError||!userData.user)return json({ok:false,error:"로그인 세션을 확인할 수 없습니다."},401,origin);
    const {data:profile,error:profileError}=await supabase.from("member_profiles").select("visit_tracking_consent").eq("user_id",userData.user.id).maybeSingle();
    if(profileError)return json({ok:false,error:"방문 기록 동의를 확인할 수 없습니다."},500,origin);
    if(profile?.visit_tracking_consent===true)memberUserId=userData.user.id;
  }
  const {data:record,error}=await supabase.rpc("record_engagement_event_with_member",{
    p_restaurant_id:eventType==="visit"?null:restaurantId,
    p_event_type:eventType,
    p_visitor_hash:visitorHash,
    p_member_user_id:memberUserId
  });
  if(error)return json({ok:false,error:"집계를 저장하지 못했습니다."},500,origin);
  return json({ok:true,counted:Boolean(record?.accepted),reason:record?.reason||null},200,origin);
});
