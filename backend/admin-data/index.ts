import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.95.0";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"GET, POST, OPTIONS"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
const text=(value:unknown,max=10000)=>typeof value==="string"?value.trim().slice(0,max):"";
const instagramHandle=(value:unknown)=>text(value,40).replace(/^@+/,"").replace(/[^a-zA-Z0-9._]/g,"").slice(0,30);
const numberOrNull=(value:unknown)=>{if(value===""||value===null||value===undefined)return null;const n=Number(value);return Number.isFinite(n)?n:null};
const categories=new Set(["식사","일식","양식","카페·디저트","술집"]);
const imageBucket="restaurant-images";
const imageTypes=new Map([["image/jpeg","jpg"],["image/png","png"],["image/webp","webp"]]);
const imageRightsSources=new Set(["self","merchant","creator","licensed","other"]);
const signedImageSeconds=60*60;
const validDateKey=(value:string)=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const [year,month,day]=value.split("-").map(Number),date=new Date(Date.UTC(year,month-1,day));return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day};

async function signedImageUrl(admin:any,path:unknown){
  const cleanPath=text(path,500);if(!cleanPath)return null;
  const {data,error}=await admin.storage.from(imageBucket).createSignedUrl(cleanPath,signedImageSeconds);
  return error?null:data.signedUrl;
}
async function signRestaurantImages(admin:any,rows:any[]){
  return Promise.all((rows||[]).map(async row=>({...row,image_url:await signedImageUrl(admin,row.image_path)})));
}
async function signDraftImages(admin:any,rows:any[]){
  return Promise.all((rows||[]).map(async row=>({...row,payload:{...(row.payload||{}),image_url:await signedImageUrl(admin,row.payload?.image_path)}})));
}

function inferCategory(value:string){
  if(/카페|디저트|베이커리|제과|케이크|커피/i.test(value))return"카페·디저트";
  if(/술집|이자카야|호프|와인|칵테일|맥주|바\b|bar/i.test(value))return"술집";
  if(/일식|라멘|스시|초밥|우동|돈카츠|이자카야|오코노미|몬자/i.test(value))return"일식";
  if(/양식|파스타|스테이크|피자|브런치|이탈리안|프렌치/i.test(value))return"양식";
  return"식사";
}
function inferRegion(address:string){
  const normalized=address.replace(/^대한민국\s*/,"").replace(/^서울특별시/,"서울").trim();
  const match=normalized.match(/서울\s+([가-힣]+구)(?:\s+([가-힣0-9]+(?:동|가)))?/);
  return match?(match[2]?`${match[1]} ${match[2]}`:match[1]):"서울";
}
function validKoreanCoordinates(latitude:number|null,longitude:number|null){
  return latitude!==null&&longitude!==null&&latitude>=33&&latitude<=39&&longitude>=124&&longitude<=132;
}
async function digest(value:string){
  const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes)).map(x=>x.toString(16).padStart(2,"0")).join("");
}
async function manualPlaceId(name:string,address:string){return"manual_"+(await digest(name.toLowerCase()+"|"+address.toLowerCase())).slice(0,24)}

async function kakaoPlaceSearch(query:string){
  const key=Deno.env.get("KAKAO_REST_API_KEY");
  if(!key)return null;
  const response=await fetch("https://dapi.kakao.com/v2/local/search/keyword.json?size=10&query="+encodeURIComponent(query),{headers:{Authorization:`KakaoAK ${key}`}});
  if(!response.ok)throw new Error("카카오 장소검색 연결에 실패했습니다.");
  const payload=await response.json();
  return (Array.isArray(payload?.documents)?payload.documents:[]).map((item:any)=>({
    place_provider:"kakao",place_id:String(item.id),place_url:item.place_url||null,name:item.place_name||"",
    address:item.road_address_name||item.address_name||"",latitude:Number(item.y),longitude:Number(item.x),
    category:inferCategory(item.category_name||""),region:inferRegion(item.road_address_name||item.address_name||""),category_detail:item.category_name||""
  })).filter((item:any)=>item.name&&item.address&&validKoreanCoordinates(item.latitude,item.longitude));
}
async function osmPlaceSearch(query:string){
  try{
    const response=await fetch("https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=kr&addressdetails=1&limit=8&q="+encodeURIComponent(query),{headers:{"User-Agent":"ReelsMap/1.1 (admin place search)","Accept-Language":"ko"}});
    if(!response.ok)return[];
    const rows=await response.json();
    return (Array.isArray(rows)?rows:[]).map((item:any)=>{
      const address=item.display_name||"",latitude=Number(item.lat),longitude=Number(item.lon);
      return{place_provider:"openstreetmap",place_id:`${item.osm_type||"place"}_${item.osm_id||""}`,place_url:`https://www.openstreetmap.org/${item.osm_type||"node"}/${item.osm_id||""}`,name:item.name||String(item.display_name||"").split(",")[0]||"",address,latitude,longitude,category:inferCategory([item.type,item.category,item.display_name].join(" ")),region:inferRegion(address),category_detail:[item.category,item.type].filter(Boolean).join(" · ")};
    }).filter((item:any)=>item.name&&item.address&&validKoreanCoordinates(item.latitude,item.longitude));
  }catch{return[]}
}
async function searchPlaces(name:string,hint:string){
  const query=[name,hint||"서울"].filter(Boolean).join(" ");
  const kakao=await kakaoPlaceSearch(query);
  if(kakao)return{provider:"kakao",candidates:kakao,warning:null};
  const candidates=await osmPlaceSearch(query);
  return{provider:"openstreetmap",candidates,warning:"카카오 REST API 키가 아직 연결되지 않아 예비 장소검색을 사용했습니다."};
}
async function geocode(address:string,name=""){
  const key=Deno.env.get("KAKAO_REST_API_KEY");
  if(key){
    const response=await fetch("https://dapi.kakao.com/v2/local/search/address.json?size=5&query="+encodeURIComponent(address),{headers:{Authorization:`KakaoAK ${key}`}});
    if(response.ok){
      const payload=await response.json();
      for(const item of Array.isArray(payload?.documents)?payload.documents:[]){
        const latitude=Number(item.y),longitude=Number(item.x);
        if(validKoreanCoordinates(latitude,longitude))return{latitude,longitude,display_name:item.road_address?.address_name||item.address?.address_name||address,provider:"kakao"};
      }
    }
  }
  // Nominatim often finds a Korean road address correctly but returns no result
  // when a business name is added to the same query. Try the address by itself
  // first so administrators never have to enter coordinates manually.
  const queries=[address,[address,name].filter(Boolean).join(" ")];
  for(const query of [...new Set(queries.filter(Boolean))]){
    const result=await osmPlaceSearch(query);
    const first=result[0];
    if(first)return{latitude:first.latitude,longitude:first.longitude,display_name:first.address,provider:"openstreetmap"};
  }
  return null;
}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(!["GET","POST"].includes(req.method))return json({ok:false,error:"Method not allowed"},405);

  const auth=req.headers.get("authorization")||"",token=auth.replace(/^Bearer\s+/i,"");
  if(!token)return json({ok:false,error:"로그인이 필요합니다."},401);
  const url=Deno.env.get("SUPABASE_URL")!,anon=Deno.env.get("SUPABASE_ANON_KEY")!,service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const userClient=createClient(url,anon,{global:{headers:{Authorization:auth}}});
  const {data:userData,error:userError}=await userClient.auth.getUser(token);
  if(userError||!userData.user?.email)return json({ok:false,error:"세션이 유효하지 않습니다."},401);
  const admin=createClient(url,service),email=userData.user.email.toLowerCase();
  const {data:allowed}=await admin.from("admin_users").select("email").eq("email",email).eq("enabled",true).maybeSingle();
  if(!allowed)return json({ok:false,error:"관리자 권한이 없습니다."},403);
  const {data:aal,error:aalError}=await userClient.auth.mfa.getAuthenticatorAssuranceLevel(token);
  if(aalError||aal?.currentLevel!=="aal2")return json({ok:false,error:"관리자 인증번호 확인이 필요합니다.",code:"MFA_CHALLENGE_REQUIRED"},403);

  try{
    if(req.method==="GET"){
      const params=new URL(req.url).searchParams;
      const memberVisits=params.get("member_visits");
      if(memberVisits!==null){
        const from=params.get("from"),to=params.get("to");
        if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(memberVisits)||
          (from!==null&&!validDateKey(from))||(to!==null&&!validDateKey(to))||Boolean(from)!==Boolean(to)||Boolean(from&&to&&from>to))
          return json({ok:false,error:"방문 기록 조회 조건을 확인해주세요."},400);
        const {data:profile,error:profileError}=await admin.from("member_profiles").select("visit_tracking_consent").eq("user_id",memberVisits).maybeSingle();
        if(profileError)throw profileError;
        if(!profile?.visit_tracking_consent)return json({ok:false,error:"방문 기록에 동의한 회원만 조회할 수 있습니다."},403);
        let query=admin.from("engagement_events").select("created_at").eq("member_user_id",memberVisits).eq("event_type","visit").order("created_at",{ascending:false}).limit(100);
        if(from&&to){query=query.gte("created_at",new Date(`${from}T00:00:00+09:00`).toISOString()).lt("created_at",new Date(new Date(`${to}T00:00:00+09:00`).getTime()+86400000).toISOString())}
        const {data:visits,error:visitsError}=await query;
        if(visitsError)throw visitsError;
        return json({ok:true,visits:visits||[]});
      }
      if(params.get("members")==="1"){
        const from=params.get("from"),to=params.get("to"),search=text(params.get("q"),100),page=Number(params.get("page")||"1"),provider=params.get("provider")||"all";
        if(!["all","google","kakao"].includes(provider)||(from&&!validDateKey(from))||(to&&!validDateKey(to))||Boolean(from)!==Boolean(to)||from&&to&&from>to||!Number.isInteger(page)||page<1||page>10000)return json({ok:false,error:"회원 조회 조건을 확인해주세요."},400);
        const {data:memberData,error:memberError}=await admin.rpc("get_admin_member_management",{p_from_date:from||null,p_to_date:to||null,p_search:search,p_page:page,p_page_size:50,p_provider:provider});
        if(memberError)throw memberError;
        const safeMembers=memberData||{total:0,members:[]};
        return json({ok:true,members:{...safeMembers,members:(safeMembers.members||[]).map((member:any)=>({
          ...member,visit_count:member.visit_tracking_consent?member.visit_count:0
        }))}});
      }
      const analyticsDate=params.get("analytics_date");
      if(analyticsDate!==null){
        if(!validDateKey(analyticsDate))return json({ok:false,error:"확인할 날짜 형식이 올바르지 않습니다."},400);
        const {data:selected,error:selectedError}=await admin.rpc("get_admin_engagement_analytics_for_date",{p_selected_date:analyticsDate});
        if(selectedError)throw selectedError;
        return json({ok:true,analytics:{selected:selected||{}}});
      }
      const retentionCutoff=new Date(Date.now()-30*24*60*60*1000).toISOString();
      await admin.from("rights_requests").delete().not("resolved_at","is",null).lt("resolved_at",retentionCutoff);
      const [{data:inbox,error:inboxError},{data:restaurants,error:restaurantError},{data:requests,error:requestError},{data:drafts,error:draftError}]=await Promise.all([
        admin.from("instagram_inbox").select("id,source_url,creator_handle,status,submitted_name,restaurant_name,address,latitude,longitude,analysis_status,analysis_error,source_fetch_note,analysis,place_provider,place_id,place_url,source_mode,created_at,updated_at").order("created_at",{ascending:false}).limit(500),
        admin.from("restaurants").select("id,inbox_id,name,address,region,category,latitude,longitude,instagram_url,creator_handle,status,editor_note,source_status,place_provider,place_id,place_url,image_url,image_path,image_rights_status,image_rights_source,image_rights_note,image_rights_confirmed_at,menu_names,menu_source_url,reel_click_count,route_click_count,created_at,updated_at").order("created_at",{ascending:false}).limit(500),
        admin.from("rights_requests").select("id,request_type,requester_role,restaurant_name,source_url,requester_name,requester_email,message,status,created_at,resolved_at").order("created_at",{ascending:false}).limit(300),
        admin.from("admin_restaurant_drafts").select("id,restaurant_id,inbox_id,payload,created_at,updated_at").eq("admin_email",email).order("updated_at",{ascending:false}).limit(300)
      ]);
      const {data:analytics,error:analyticsError}=await admin.rpc("get_admin_engagement_analytics");
      if(inboxError||restaurantError||requestError||draftError||analyticsError)throw inboxError||restaurantError||requestError||draftError||analyticsError;
      const [safeRestaurants,safeDrafts]=await Promise.all([signRestaurantImages(admin,restaurants||[]),signDraftImages(admin,drafts||[])]);
      return json({ok:true,user:{email},kakao_configured:Boolean(Deno.env.get("KAKAO_REST_API_KEY")),inbox:inbox||[],restaurants:safeRestaurants,requests:requests||[],drafts:safeDrafts,analytics:analytics||{}});
    }

    const body=await req.json(),action=text(body?.action,80);
    if(action==="upload_restaurant_image"){
      const dataUrl=text(body?.data_url,3_000_000),match=dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
      if(!match)return json({ok:false,error:"JPG·PNG·WEBP 사진만 업로드할 수 있습니다."},400);
      const mime=match[1],ext=imageTypes.get(mime);if(!ext)return json({ok:false,error:"지원하지 않는 사진 형식입니다."},400);
      let bytes:Uint8Array;
      try{bytes=Uint8Array.from(atob(match[2]),char=>char.charCodeAt(0))}catch{return json({ok:false,error:"사진 데이터를 읽지 못했습니다."},400)}
      if(!bytes.length||bytes.length>2_097_152)return json({ok:false,error:"사진은 2MB 이하로 등록해주세요."},400);
      const path=`restaurants/${new Date().toISOString().slice(0,10)}/${crypto.randomUUID()}.${ext}`;
      const {error:uploadError}=await admin.storage.from(imageBucket).upload(path,bytes,{contentType:mime,cacheControl:"31536000",upsert:false});
      if(uploadError)throw uploadError;
      const imageUrl=await signedImageUrl(admin,path);
      if(!imageUrl){await admin.storage.from(imageBucket).remove([path]);return json({ok:false,error:"사진 미리보기 주소를 만들지 못했습니다."},500)}
      return json({ok:true,image_url:imageUrl,image_path:path});
    }
    if(action==="search_place"){
      const name=text(body?.name,120),hint=text(body?.hint,200);
      if(name.length<2)return json({ok:false,error:"검색할 상호명을 2자 이상 입력해주세요."},400);
      return json({ok:true,...await searchPlaces(name,hint)});
    }
    if(action==="geocode"){
      const address=text(body?.address,300),name=text(body?.name,120);
      if(!address)return json({ok:false,error:"주소가 필요합니다."},400);
      const result=await geocode(address,name);
      if(!result)return json({ok:false,error:"주소로 위치를 찾지 못했습니다. 장소검색 결과를 선택하거나 주소를 확인해주세요."},404);
      return json({ok:true,...result});
    }
    if(action==="create_inbox"){
      const sourceUrl=text(body?.source_url,1000),name=text(body?.name,120),creatorHandle=instagramHandle(body?.creator_handle);
      if(!/^https:\/\/(www\.)?instagram\.com\/(reel|reels|p)\//i.test(sourceUrl)||!name)return json({ok:false,error:"올바른 Instagram URL과 상호명이 필요합니다."},400);
      const row={source_url:sourceUrl,source_type:/\/p\//i.test(sourceUrl)?"post":"reel",saved_via:"admin",source_mode:"manual_link",status:"needs_review",analysis_status:"needs_place_lookup",submitted_name:name,restaurant_name:name,source_fetch_status:"url_only",source_fetch_note:"관리자 직접 등록 · 공식 장소 확인 필요",caption_text:null,creator_handle:creatorHandle||null,view_count:null,like_count:null,comment_count:null,updated_at:new Date().toISOString()};
      const {data,error}=await admin.from("instagram_inbox").upsert(row,{onConflict:"source_url"}).select("id").single();if(error)throw error;
      return json({ok:true,item:data});
    }
    if(action==="save_draft"){
      const item=body?.restaurant||{},now=new Date().toISOString();
      const payload={
        id:text(item.id,80)||null,inbox_id:text(item.inbox_id,80)||null,
        name:text(item.name,120),address:text(item.address,300),
        category:categories.has(text(item.category,40))?text(item.category,40):"식사",
        region:text(item.region,80),latitude:numberOrNull(item.latitude),longitude:numberOrNull(item.longitude),
        instagram_url:text(item.instagram_url,1000),creator_handle:instagramHandle(item.creator_handle)||null,
        place_provider:text(item.place_provider,40),place_id:text(item.place_id,200),
        place_url:text(item.place_url,1000)||null,image_url:null,
        image_path:text(item.image_path,500)||null,
        image_rights_status:text(item.image_rights_status,20)==="approved"?"approved":"unverified",
        image_rights_source:imageRightsSources.has(text(item.image_rights_source,30))?text(item.image_rights_source,30):null,
        image_rights_note:text(item.image_rights_note,500)||null,
        editor_note:text(item.editor_note,2000)
      };
      let draftId=text(body?.draft_id,80),existing:any=null;
      if(draftId){
        const {data}=await admin.from("admin_restaurant_drafts").select("id,payload").eq("id",draftId).eq("admin_email",email).maybeSingle();existing=data;
      }else if(payload.inbox_id){
        const {data}=await admin.from("admin_restaurant_drafts").select("id,payload").eq("admin_email",email).eq("inbox_id",payload.inbox_id).maybeSingle();existing=data;draftId=data?.id||"";
      }else if(payload.id){
        const {data}=await admin.from("admin_restaurant_drafts").select("id,payload").eq("admin_email",email).eq("restaurant_id",payload.id).maybeSingle();existing=data;draftId=data?.id||"";
      }
      const saved=draftId
        ?await admin.from("admin_restaurant_drafts").update({restaurant_id:payload.id,inbox_id:payload.inbox_id,payload,updated_at:now}).eq("id",draftId).eq("admin_email",email).select().single()
        :await admin.from("admin_restaurant_drafts").insert({admin_email:email,restaurant_id:payload.id,inbox_id:payload.inbox_id,payload,updated_at:now}).select().single();
      if(saved.error)throw saved.error;
      const oldDraftPath=text(existing?.payload?.image_path,500);
      if(oldDraftPath&&oldDraftPath!==payload.image_path){
        const {count}=await admin.from("restaurants").select("id",{count:"exact",head:true}).eq("image_path",oldDraftPath);
        if(!count)await admin.storage.from(imageBucket).remove([oldDraftPath]);
      }
      return json({ok:true,draft:saved.data});
    }
    if(action==="delete_draft"){
      const id=text(body?.id,80);if(!id)return json({ok:false,error:"id required"},400);
      const {data:draft,error:findError}=await admin.from("admin_restaurant_drafts").select("payload").eq("id",id).eq("admin_email",email).maybeSingle();if(findError)throw findError;
      const {error}=await admin.from("admin_restaurant_drafts").delete().eq("id",id).eq("admin_email",email);if(error)throw error;
      const imagePath=text(draft?.payload?.image_path,500);
      if(imagePath){
        const {count}=await admin.from("restaurants").select("id",{count:"exact",head:true}).eq("image_path",imagePath);
        if(!count)await admin.storage.from(imageBucket).remove([imagePath]);
      }
      return json({ok:true});
    }
    if(action==="publish"){
      const item=body?.restaurant||{},name=text(item.name,120),address=text(item.address,300),instagramUrl=text(item.instagram_url,1000),creatorHandle=instagramHandle(item.creator_handle),imagePath=text(item.image_path,500)||null;
      const requestedImageStatus=imagePath&&text(item.image_rights_status,20)==="approved"?"approved":"unverified";
      const imageRightsSource=imageRightsSources.has(text(item.image_rights_source,30))?text(item.image_rights_source,30):null;
      if(requestedImageStatus==="approved"&&!imageRightsSource)return json({ok:false,error:"사진 사용 권한의 출처를 선택해주세요."},400);
      let latitude=numberOrNull(item.latitude),longitude=numberOrNull(item.longitude);
      if(!name||!address||!instagramUrl)return json({ok:false,error:"가게명·주소·인스타 URL이 모두 필요합니다."},400);
      if(!/^https:\/\/(www\.)?instagram\.com\/(reel|reels|p)\//i.test(instagramUrl))return json({ok:false,error:"Instagram URL 형식을 확인해주세요."},400);
      if(!validKoreanCoordinates(latitude,longitude)){
        const found=await geocode(address,name);if(!found)return json({ok:false,error:"주소 위치를 찾지 못했습니다. 장소검색 결과를 선택해주세요."},400);
        latitude=found.latitude;longitude=found.longitude;
      }
      let placeProvider=text(item.place_provider,40),placeId=text(item.place_id,200),placeUrl=text(item.place_url,1000)||null;
      if(!placeProvider||!placeId){placeProvider="manual";placeId=await manualPlaceId(name,address);placeUrl=null}
      const category=categories.has(text(item.category,40))?text(item.category,40):"식사",now=new Date().toISOString();
      const row={
        inbox_id:text(item.inbox_id,80)||null,name,address,region:text(item.region,80)||inferRegion(address),category,latitude,longitude,
        instagram_url:instagramUrl,status:"published",editor_note:text(item.editor_note,2000)||null,source_status:"admin_verified",
        place_provider:placeProvider,place_id:placeId,place_url:placeUrl,image_url:null,image_path:imagePath,
        image_rights_status:requestedImageStatus,image_rights_source:requestedImageStatus==="approved"?imageRightsSource:null,
        image_rights_note:requestedImageStatus==="approved"?text(item.image_rights_note,500)||null:null,
        image_rights_confirmed_at:requestedImageStatus==="approved"?now:null,
        menu_names:Array.isArray(item.menu_names)?[...new Set(item.menu_names.map((v:unknown)=>text(v,60)).filter(Boolean))].slice(0,3):[],
        menu_source_url:/^https:\/\//i.test(text(item.menu_source_url,1000))?text(item.menu_source_url,1000):null,
        creator_handle:creatorHandle||null,view_count:null,like_count:null,comment_count:null,caption_text:null,updated_at:now
      };
      let targetId=text(item.id,80);
      if(!targetId&&row.inbox_id){const {data}=await admin.from("restaurants").select("id").eq("inbox_id",row.inbox_id).maybeSingle();targetId=data?.id||""}
      if(!targetId){const {data}=await admin.from("restaurants").select("id").eq("instagram_url",instagramUrl).maybeSingle();targetId=data?.id||""}
      let oldImagePath="";
      if(targetId){const {data:existing}=await admin.from("restaurants").select("image_path").eq("id",targetId).maybeSingle();oldImagePath=text(existing?.image_path,500)}
      const saved=targetId
        ?await admin.from("restaurants").update(row).eq("id",targetId).select().single()
        :await admin.from("restaurants").insert(row).select().single();
      if(saved.error)throw saved.error;
      if(placeProvider!=="manual"&&placeId){const {error:menuSyncError}=await admin.from("restaurants").update({menu_names:row.menu_names,menu_source_url:row.menu_source_url}).eq("place_provider",placeProvider).eq("place_id",placeId).neq("id",saved.data.id);if(menuSyncError)throw menuSyncError}
      if(oldImagePath&&oldImagePath!==imagePath)await admin.storage.from(imageBucket).remove([oldImagePath]);
      if(row.inbox_id)await admin.from("instagram_inbox").update({status:"registered",analysis_status:"published",submitted_name:name,restaurant_name:name,address,latitude,longitude,place_provider:placeProvider,place_id:placeId,place_url:placeUrl,restaurant_count:1,source_mode:"manual_verified",source_fetch_status:"url_only",source_fetch_note:"관리자 장소 확인 완료",caption_text:null,creator_handle:creatorHandle||null,view_count:null,like_count:null,comment_count:null,updated_at:now}).eq("id",row.inbox_id);
      const draftId=text(item.draft_id,80);if(draftId)await admin.from("admin_restaurant_drafts").delete().eq("id",draftId).eq("admin_email",email);
      return json({ok:true,restaurant:saved.data});
    }
    if(action==="unpublish"){
      const id=text(body?.id,80);if(!id)return json({ok:false,error:"id required"},400);
      const {data,error}=await admin.from("restaurants").update({status:"pending_review",updated_at:new Date().toISOString()}).eq("id",id).select().single();if(error)throw error;
      return json({ok:true,restaurant:data});
    }
    if(action==="delete_restaurant"){
      const id=text(body?.id,80);if(!id)return json({ok:false,error:"id required"},400);
      const {data:old}=await admin.from("restaurants").select("inbox_id,image_path").eq("id",id).maybeSingle();
      const {error}=await admin.from("restaurants").delete().eq("id",id);if(error)throw error;
      if(old?.image_path)await admin.storage.from(imageBucket).remove([old.image_path]);
      if(old?.inbox_id)await admin.from("instagram_inbox").update({status:"needs_review",analysis_status:"needs_place_lookup",restaurant_count:0,updated_at:new Date().toISOString()}).eq("id",old.inbox_id);
      return json({ok:true});
    }
    if(action==="delete_inbox"){
      const id=text(body?.id,80);if(!id)return json({ok:false,error:"id required"},400);
      const {data:deleted,error}=await admin.rpc("delete_admin_inbox",{target_id:id});if(error)throw error;
      const imagePaths=Array.isArray(deleted?.image_paths)?deleted.image_paths.map((path:unknown)=>text(path,500)).filter(Boolean):[];
      let warning="";
      if(imagePaths.length){const {error:storageError}=await admin.storage.from(imageBucket).remove(imagePaths);if(storageError)warning="데이터는 삭제됐지만 대표사진 파일 정리는 재확인이 필요합니다."}
      return json({ok:true,deleted,warning:warning||null});
    }
    if(action==="ignore_inbox"){
      const id=text(body?.id,80);if(!id)return json({ok:false,error:"id required"},400);
      const {error}=await admin.from("instagram_inbox").update({status:"ignored",analysis_status:"not_found",source_fetch_note:"관리자 검토 후 지도 등록 제외",updated_at:new Date().toISOString()}).eq("id",id);if(error)throw error;
      return json({ok:true});
    }
    if(action==="resolve_request"){
      const id=text(body?.id,80),status=text(body?.status,20)==="rejected"?"rejected":"resolved";
      if(!id)return json({ok:false,error:"id required"},400);
      const {data,error}=await admin.from("rights_requests").update({status,resolved_at:new Date().toISOString()}).eq("id",id).select().single();if(error)throw error;
      return json({ok:true,request:data});
    }
    return json({ok:false,error:"Unknown action"},400);
  }catch(error){return json({ok:false,error:error instanceof Error?error.message:String(error)},500)}
});
