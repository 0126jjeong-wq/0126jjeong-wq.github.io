// Read-only Kakao place lookup used while linking a shared Reel to a user's map.
// Never stores the Reel URL or searched text.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});
const buckets = new Map<string, { start: number; count: number }>();
const cache = new Map<string, { at: number; items: any[] }>();

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply({ ok: false, error: 'POST only' }, 405);

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  const now = Date.now();
  if (buckets.size > 2000) for (const [key, value] of buckets) if (now - value.start > 60000) buckets.delete(key);
  const bucket = buckets.get(ip) || { start: now, count: 0 };
  if (now - bucket.start > 60000) { bucket.start = now; bucket.count = 0; }
  if (++bucket.count > 12) return reply({ ok: false, error: '검색이 많아요. 1분 후 다시 시도해주세요.' }, 429);
  buckets.set(ip, bucket);

  let body: any;
  try {
    const raw = await req.text();
    if (raw.length > 1200) return reply({ ok: false, error: '검색어가 너무 길어요.' }, 413);
    body = JSON.parse(raw);
  } catch { return reply({ ok: false, error: '검색어를 확인해주세요.' }, 400); }

  const queries = [...new Set((Array.isArray(body.queries) ? body.queries : [])
    .filter((value: unknown): value is string => typeof value === 'string')
    .map((value: string) => value.trim())
    .filter((value: string) => value.length >= 2 && value.length <= 70))].slice(0, 3);
  if (!queries.length) return reply({ ok: false, error: '가게명이나 지역을 입력해주세요.' }, 400);

  const key = Deno.env.get('KAKAO_REST_API_KEY');
  if (!key) return reply({ ok: false, error: '업체 검색 연결을 준비 중이에요. 기존 등록 맛집에서 검색해주세요.' }, 503);

  const candidates = new Map<string, any>();
  try {
    for (const query of queries) {
      let rows = cache.get(query);
      if (!rows || now - rows.at > 300000) {
        const url = 'https://dapi.kakao.com/v2/local/search/keyword.json?size=15&query=' + encodeURIComponent(query);
        const response = await fetch(url, {
          headers: { Authorization: `KakaoAK ${key}` },
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) throw new Error('Kakao place lookup failed');
        const payload = await response.json();
        rows = {
          at: now,
          items: (payload.documents || [])
            .filter((item: any) => ['FD6', 'CE7'].includes(item.category_group_code))
            .map((item: any) => ({
              id: 'capture-kakao-' + item.id,
              place_provider: 'kakao',
              place_id: String(item.id),
              name: item.place_name || '',
              address: item.road_address_name || item.address_name || '',
              latitude: Number(item.y),
              longitude: Number(item.x),
              phone: item.phone || '',
              place_url: item.place_url || '',
              category: item.category_name || '',
              category_group: item.category_group_name || '',
              region: item.address_name || '',
              provider: '카카오 장소',
            }))
            .filter((item: any) => item.name && item.address && Number.isFinite(item.latitude) && Number.isFinite(item.longitude)),
        };
        if (cache.size > 300) cache.clear();
        cache.set(query, rows);
      }
      for (const item of rows.items) candidates.set(item.place_id, item);
    }
    return reply({ ok: true, candidates: [...candidates.values()].slice(0, 20) });
  } catch {
    return reply({ ok: false, error: '업체 검색에 연결하지 못했어요. 잠시 후 다시 시도해주세요.' }, 502);
  }
});
