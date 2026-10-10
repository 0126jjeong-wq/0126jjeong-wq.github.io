import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.95.0";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"GET, OPTIONS"};
const reelCode=(value:unknown)=>{try{const u=new URL(String(value));if(!["instagram.com","www.instagram.com"].includes(u.hostname))return null;const parts=u.pathname.split("/").filter(Boolean);return parts.length===2&&["reel","reels","p"].includes(parts[0])&&/^[A-Za-z0-9_-]+$/.test(parts[1])?parts[1]:null}catch{return null}};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="GET")return json({ok:false,error:"GET only"},405);
  const projectUrl=Deno.env.get("SUPABASE_URL")!;
  const secretKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  // Supabase's opaque sb_secret_* keys belong in `apikey`, not `Authorization`.
  // Passing them as Bearer tokens makes PostgREST reject the request with PGRST303.
  // Leave Authorization unset when it only repeats the API key so the gateway can
  // translate the secret API key into its internal service-role JWT.
  const supabase=createClient(projectUrl,secretKey,{
    global:{fetch:async(input,init={})=>{
      const request=input instanceof Request?input:new Request(input,init);
      const headers=new Headers(request.headers);
      if(headers.get("authorization")===`Bearer ${secretKey}`)headers.delete("authorization");
      return fetch(new Request(request,{headers}));
    }}
  });
  const [{data,error},{data:routeRows,error:routeError}]=await Promise.all([
    supabase.from("restaurants")
      .select("id,inbox_id,name,address,region,category,latitude,longitude,instagram_url,creator_handle,status,place_provider,place_id,place_url,image_path,image_rights_status,menu_names,reel_click_count,route_click_count,created_at,updated_at")
      .eq("status","published").order("created_at",{ascending:false}).limit(500),
    supabase.rpc("get_public_route_counts")
  ]);
  if(error){
    console.error("restaurants query failed",{code:error.code,message:error.message});
    return json({ok:false,error:"맛집 데이터를 불러오지 못했습니다."},500);
  }
  // Route counts are supplementary. A transient RPC failure must not hide the list.
  if(routeError)console.warn("route count query failed",{code:routeError.code,message:routeError.message});
  const {data:signals,error:signalError}=await supabase.from("registered_reel_categories").select("media_id,permalink,creator_handle,posted_at,observed_at,view_count,view_delta,projected_24h_delta,post_age_group,million_reached,rapid_growth,measurement_status").limit(1000);
  const signalByCode=new Map((signals||[]).filter((m:any)=>reelCode(m.permalink)).map((m:any)=>[reelCode(m.permalink),m]));
  const routeCounts=new Map((routeRows||[]).map((row:any)=>[String(row.restaurant_id),{week:Number(row.route_clicks_7d||0),all:Number(row.route_clicks_all||0)}]));
  const approvedPaths=[...new Set((data||[]).filter((row:any)=>row.image_rights_status==="approved"&&row.image_path).map((row:any)=>String(row.image_path)))];
  const signedPairs=await Promise.all(approvedPaths.map(async path=>{
    const {data:signed,error:signedError}=await supabase.storage.from("restaurant-images").createSignedUrl(path,60*60);
    return [path,signedError?null:signed.signedUrl] as const;
  }));
  const signedUrls=new Map(signedPairs);
  const restaurants=(data||[]).map((row:any)=>{
    const {image_rights_status,image_path,...publicRow}=row;
    const signal=signalByCode.get(reelCode(row.instagram_url));
    const fresh=signal && Date.now()-Date.parse(signal.observed_at)<36*60*60*1000;
    return {...publicRow,reel_signal:fresh?{posted_at:signal.posted_at,observed_at:signal.observed_at,view_count:signal.view_count,view_delta:signal.view_delta,projected_24h_delta:signal.projected_24h_delta,post_age_group:signal.post_age_group,million_reached:signal.million_reached,rapid_growth:signal.rapid_growth,measurement_status:signal.measurement_status}:null,image_url:image_rights_status==="approved"&&image_path?signedUrls.get(String(image_path))||null:null,route_clicks_7d:routeCounts.get(String(row.id))?.week||0,route_clicks_all:routeCounts.get(String(row.id))?.all||0};
  });
  return json({ok:true,restaurants,stats:{restaurants:restaurants.length,reel_signals_available:!signalError}});
});
