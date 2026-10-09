import { createClient } from "jsr:@supabase/supabase-js@2.95.0";
const reply=(v:unknown,s=200)=>Response.json(v,{status:s,headers:{"Cache-Control":"no-store"}});
const canonical=(s:string)=>{try{const u=new URL(s);if(!["instagram.com","www.instagram.com"].includes(u.hostname))return null;const m=u.pathname.match(/^\/(?:reel|reels|p)\/([A-Za-z0-9_-]+)\/?$/);return m?m[1]:null;}catch{return null;}};
class MetaAuthError extends Error {}
Deno.serve(async(req)=>{
 if(req.method!=="POST")return reply({error:"POST only"},405);
 const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
 const auth=req.headers.get("x-reel-sync-key")||"";
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(auth)))).map(x=>x.toString(16).padStart(2,"0")).join("");
 const {data:cfg}=await db.from("reel_sync_config").select("auth_sha256").eq("id",true).single();
 if(!auth||hash!==cfg?.auth_sha256)return reply({error:"Unauthorized"},401);
 const tokens=[...new Set(["INSTAGRAM_ACCESS_TOKEN","instagram_access_token","instagram_acces_token"].map(name=>Deno.env.get(name)?.trim()).filter((value):value is string=>Boolean(value)))];
 if(!tokens.length)return reply({error:"INSTAGRAM_ACCESS_TOKEN missing"},503);
 let activeToken=0;
 const {data:running}=await db.from("reel_sync_runs").select("id").eq("status","running").gte("started_at",new Date(Date.now()-180000).toISOString()).limit(1);
 if(running?.length)return reply({error:"Already running"},409);
 const {data:run,error:runErr}=await db.from("reel_sync_runs").insert({}).select("id").single();
 if(runErr)return reply({error:"Run record failed"},500);
 const results:any[]=[];
 try{
 const {data:creators,error}=await db.from("reel_sync_creators").select("handle,last_attempt_at").eq("enabled",true).order("handle");
 if(error)throw new Error("Database creator read failed");
 const {data:registered,error:registeredError}=await db.from("restaurants").select("instagram_url,creator_handle").eq("status","published").limit(1000);
 if(registeredError)throw new Error("Registered reels read failed");
 const handleCodes=new Map<string,Set<string>>();
 for(const row of registered||[]){
  const code=canonical(row.instagram_url||"");
  const handle=String(row.creator_handle||"").replace(/^@/,"").toLowerCase();
  if(!code||!/^[a-z0-9._]{1,30}$/.test(handle))continue;
  if(!handleCodes.has(handle))handleCodes.set(handle,new Set());
  handleCodes.get(handle)!.add(code);
 }
 const selected=(creators||[]).filter(x=>handleCodes.has(x.handle.toLowerCase())).sort((a,b)=>Date.parse(a.last_attempt_at||"1970-01-01")-Date.parse(b.last_attempt_at||"1970-01-01")).slice(0,5);
 let authFailed=false;
 for(const {handle} of selected){
  try{
   if(!/^[a-zA-Z0-9._]{1,30}$/.test(handle))throw new Error("Invalid creator handle");
   const items:any[]=[];let cursor:string|undefined;let truncated=false;
   const targets=handleCodes.get(handle.toLowerCase())!;
   for(let page=0;page<3;page++){
    const edge="media.limit(40)"+(cursor?".after("+cursor+")":"");
    const fields="business_discovery.username("+handle+"){username,"+edge+"{id,permalink,media_type,timestamp,view_count}}";
    const url=new URL("https://graph.facebook.com/v26.0/17841474995250895");url.searchParams.set("fields",fields);
    let data:any;
    for(let candidate=activeToken;candidate<tokens.length;candidate++){
     const response=await fetch(url,{headers:{Authorization:"Bearer "+tokens[candidate]},signal:AbortSignal.timeout(15000)});
     data=await response.json();
     if(response.ok&&!data.error){activeToken=candidate;break;}
     const code=Number(data.error?.code||response.status),subcode=Number(data.error?.error_subcode||0);
     const message="Meta API code "+code+" subcode "+subcode;
     if(code!==190)throw new Error(message);
     if(candidate===tokens.length-1)throw new MetaAuthError(message);
    }
    const media=data.business_discovery?.media;
    if(!Array.isArray(media?.data))throw new Error("Meta media response missing");
    items.push(...media.data.filter((m:any)=>targets.has(canonical(m.permalink)||"")));
    if(new Set(items.map((m:any)=>canonical(m.permalink))).size===targets.size)break;
    const next=media.paging?.cursors?.after;
    if(!next){truncated=media.data.length===40;break;}
    if(media.data.length<40)break;
    if(!/^[a-zA-Z0-9_=-]+$/.test(next))throw new Error("Invalid pagination cursor");
    cursor=next;if(page===2)truncated=true;
   }
   const observed=new Date().toISOString();let saved=0,matched=0,missing=0;
   for(const m of items){
    if(!m.id||!canonical(m.permalink)||!m.timestamp||!Number.isFinite(Date.parse(m.timestamp)))continue;
    const views=Number.isSafeInteger(m.view_count)&&m.view_count>=0?m.view_count:null;
    if(views===null)missing++;
    const {data:prev}=await db.from("reel_view_snapshots").select("view_count,observed_at").eq("media_id",m.id).not("view_count","is",null).lte("observed_at",new Date(Date.now()-1800000).toISOString()).order("observed_at",{ascending:false}).limit(1).maybeSingle();
    const hours=prev?(Date.parse(observed)-Date.parse(prev.observed_at))/3600000:null;
    const delta=views!==null&&prev?views-Number(prev.view_count):null;
    const status=views===null?"unavailable":delta===null?"baseline":delta<0?"counter_decreased":"measured";
    const {error:up}=await db.from("reel_media_stats").upsert({media_id:String(m.id),creator_handle:handle,permalink:m.permalink,media_type:m.media_type,posted_at:m.timestamp,view_count:views,observed_at:observed,view_delta:delta,views_per_hour:delta!==null&&delta>=0&&hours?delta/hours:null,measurement_status:status,million_reached:views!==null&&views>=1000000});
    if(up)throw new Error("Database media write failed");
    const {error:snap}=await db.from("reel_view_snapshots").insert({run_id:run.id,media_id:String(m.id),observed_at:observed,view_count:views});
    if(snap)throw new Error("Database snapshot write failed");
    saved++;
    if(views!==null){
     const urls=["https://www.instagram.com/reel/"+canonical(m.permalink)+"/","https://www.instagram.com/p/"+canonical(m.permalink)+"/","https://www.instagram.com/reels/"+canonical(m.permalink)+"/"];
     const {data:links,error:linkErr}=await db.from("instagram_inbox").update({view_count:views,meta_media_id:String(m.id)}).in("source_url",urls).select("id");
     if(linkErr)throw new Error("Database link update failed");matched+=links?.length||0;
    }
   }
   await db.from("reel_sync_creators").update({last_success_at:observed,last_attempt_at:observed,last_error:null}).eq("handle",handle);
   results.push({handle,registered_reels:targets.size,saved,matched,missing_view_count:missing,truncated});
  }catch(e){const error=e instanceof Error?e.message:"Collection failed";await db.from("reel_sync_creators").update({last_attempt_at:new Date().toISOString(),last_error:error}).eq("handle",handle);results.push({handle,error});if(e instanceof MetaAuthError){authFailed=true;break;}}
 }
 const ok=results.every(x=>!x.error);
 await db.from("reel_sync_runs").update({finished_at:new Date().toISOString(),status:authFailed?"auth_error":ok?"success":"partial_failure",summary:results}).eq("id",run.id);
 return reply({ok,auth_error:authFailed,run_id:run.id,results},ok?200:502);
 }catch{await db.from("reel_sync_runs").update({finished_at:new Date().toISOString(),status:"failed",summary:{error:"Collection failed"}}).eq("id",run.id);return reply({error:"Collection failed"},500);}
});
