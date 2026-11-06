import { readFile, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const SITE = 'https://myreelsmap.com';
const API = 'https://tbyfoxsyadmpeeatyzvm.supabase.co/functions/v1/site-data';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const xml = esc;
const json = value => JSON.stringify(value).replace(/</g, '\\u003c');
const placeUrl = row => `${SITE}/places/${row.id}/`;
const short = (value, max = 155) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

function reelUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ['instagram.com', 'www.instagram.com'].includes(url.hostname)
      && /^\/(reel|p)\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)
      ? `https://www.instagram.com${url.pathname.replace(/\/$/, '')}/` : null;
  } catch { return null; }
}

function head({ title, description, url, type = 'website' }) {
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="index,follow">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(url)}">
<link rel="icon" type="image/svg+xml" href="/assets/reelsmap-logo.svg">
<meta property="og:locale" content="ko_KR">
<meta property="og:type" content="${type}">
<meta property="og:site_name" content="릴스맛집지도">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${SITE}/assets/reelsmap-share.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${SITE}/assets/reelsmap-share.png">`;
}

const css = `<style>
:root{font-family:-apple-system,BlinkMacSystemFont,"Pretendard","Noto Sans KR",sans-serif;color:#222;background:#f7f6f3}*{box-sizing:border-box}body{margin:0}header,main,footer{max-width:900px;margin:auto;padding:20px}header{display:flex;align-items:center;gap:12px}header img{width:42px;height:42px}a{color:#b63821}header a{color:#222;text-decoration:none;font-weight:800}nav{margin:18px 0;color:#777;font-size:14px}nav a{color:inherit}.card{background:white;border:1px solid #e8e6e3;border-radius:20px;padding:26px;margin:14px 0;line-height:1.7}h1{font-size:clamp(27px,5vw,38px);line-height:1.28;margin:6px 0 20px}h2{font-size:20px;margin:0 0 12px}.muted{color:#686b71}.tag{display:inline-block;background:#fff0eb;color:#b63821;border-radius:30px;padding:5px 12px;font-size:13px;font-weight:700}.links{display:flex;gap:12px;flex-wrap:wrap;margin-top:22px}.links a{display:inline-block;padding:11px 17px;background:#ff4d2e;color:white;border-radius:11px;text-decoration:none;font-weight:800}.links a.secondary{background:white;border:1px solid #ffb9aa;color:#b63821}ul{padding-left:20px}li{margin:7px 0}footer{color:#666;font-size:13px}footer a{margin-right:12px}.list{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px;list-style:none;padding:0}.list li{margin:0}.list a{display:block;background:white;padding:14px 16px;border:1px solid #e8e6e3;border-radius:12px;text-decoration:none;font-weight:700}.list small{display:block;color:#686b71;font-weight:400}
</style>`;

function page(row, all) {
  const url = placeUrl(row);
  const title = `${row.name} | ${row.region || '서울·경기'} ${row.category || '맛집'} | 릴스맛집지도`;
  const description = short(`${row.name} · ${row.address || row.region || '위치 정보'}${row.menu_names?.length ? ` · 메뉴 ${row.menu_names.slice(0, 3).join(', ')}` : ''}. 위치와 관련 릴스를 릴스맛집지도에서 확인하세요.`);
  const nearby = all.filter(other => other.id !== row.id && other.region && other.region === row.region).slice(0, 4);
  const instagram = reelUrl(row.instagram_url);
  const lat = Number(row.latitude), lng = Number(row.longitude);
  const business = {
    '@context': 'https://schema.org', '@type': 'LocalBusiness', '@id': `${url}#business`,
    name: row.name, url, address: { '@type': 'PostalAddress', streetAddress: row.address, addressCountry: 'KR' },
    ...(Number.isFinite(lat) && Number.isFinite(lng) && lat > -90 && lat < 90 && lng > -180 && lng < 180
      ? { geo: { '@type': 'GeoCoordinates', latitude: lat, longitude: lng } } : {})
  };
  const breadcrumbs = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: '홈', item: `${SITE}/` },
    { '@type': 'ListItem', position: 2, name: '전체 맛집', item: `${SITE}/places/` },
    { '@type': 'ListItem', position: 3, name: row.name, item: url }
  ] };
  const menu = Array.isArray(row.menu_names) ? row.menu_names.map(name => short(name, 80)).filter(Boolean).slice(0, 3) : [];
  const mapUrl = `https://map.kakao.com/link/to/${encodeURIComponent(row.name)},${lat},${lng}`;
  return `<!doctype html><html lang="ko"><head>${head({ title, description, url })}${css}
<script type="application/ld+json">${json(business)}</script>
<script type="application/ld+json">${json(breadcrumbs)}</script></head><body>
<header><img src="/assets/reelsmap-logo.svg" alt=""><a href="/">릴스맛집지도</a></header>
<main><nav aria-label="탐색 경로"><a href="/">홈</a> / <a href="/places/">전체 맛집</a> / ${esc(row.name)}</nav>
<article class="card"><span class="tag">${esc(row.category || '맛집')}</span><h1>${esc(row.name)}</h1>
<p><strong>주소</strong> · ${esc(row.address || '매장 주소 확인 중')}</p>
${menu.length ? `<h2>등록된 메뉴</h2><ul>${menu.map(name => `<li>${esc(name)}</li>`).join('')}</ul>` : ''}
${instagram ? `<h2>관련 Instagram 릴스</h2><p>릴스 제작자 ${row.creator_handle ? `@${esc(String(row.creator_handle).replace(/^@/, ''))}` : '정보 없음'}의 공개 게시물로 연결됩니다.</p><p><a href="${esc(instagram)}">Instagram에서 릴스 보기 ↗</a></p>` : ''}
<div class="links"><a href="/?place=${encodeURIComponent(row.id)}">릴스맛집지도에서 보기</a>${Number.isFinite(lat) && Number.isFinite(lng) ? `<a class="secondary" href="${esc(mapUrl)}" target="_blank" rel="noopener noreferrer">카카오맵 길찾기 ↗</a>` : ''}</div></article>
${nearby.length ? `<section class="card"><h2>${esc(row.region)}의 다른 맛집</h2><ul class="list">${nearby.map(other => `<li><a href="/places/${other.id}/">${esc(other.name)}<small>${esc(other.address || other.category || '')}</small></a></li>`).join('')}</ul></section>` : ''}
<p class="muted">매장과 메뉴 정보는 변경될 수 있으니 방문 전 확인해 주세요. 사진·영상은 저장하지 않고 원본 게시물로 연결합니다.</p></main>
<footer><a href="/places/">전체 맛집</a><a href="/policy.html">서비스 안내·정보 수정</a></footer></body></html>\n`;
}

function directory(rows) {
  const groups = new Map();
  for (const row of rows) {
    const group = row.region || '그 밖의 지역';
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(row);
  }
  const title = '전체 맛집 | 서울·경기 릴스 맛집 지도';
  const description = '릴스맛집지도에 등록된 서울·경기 맛집을 지역별로 찾아보세요. 확인된 매장 위치와 관련 Instagram 릴스를 연결합니다.';
  return `<!doctype html><html lang="ko"><head>${head({ title, description, url: `${SITE}/places/` })}${css}</head><body>
<header><img src="/assets/reelsmap-logo.svg" alt=""><a href="/">릴스맛집지도</a></header>
<main><nav><a href="/">홈</a> / 전체 맛집</nav><h1>지역별 릴스 맛집</h1><p class="muted">공개된 매장 ${rows.length}곳을 찾아보세요.</p>
${[...groups].sort(([a], [b]) => a.localeCompare(b, 'ko')).map(([region, places]) => `<section><h2>${esc(region)}</h2><ul class="list">${places.map(row => `<li><a href="/places/${row.id}/">${esc(row.name)}<small>${esc(row.category || '맛집')} · ${esc(row.address || '')}</small></a></li>`).join('')}</ul></section>`).join('\n')}
</main><footer><a href="/">지도에서 보기</a><a href="/policy.html">서비스 안내</a></footer></body></html>\n`;
}

function sitemap(rows) {
  const entry = (url, lastmod) => `<url><loc>${xml(url)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`;
  const urls = [`${SITE}/`, `${SITE}/places/`, `${SITE}/policy.html`].map(url => entry(url));
  for (const row of rows) {
    const stamp = Date.parse(row.updated_at || row.created_at || '');
    urls.push(entry(placeUrl(row), Number.isFinite(stamp) ? new Date(stamp).toISOString().slice(0, 10) : null));
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

export async function generateSeo(rows, output = root) {
  if (!Array.isArray(rows) || !rows.length || rows.length >= 500) throw new Error('Expected 1–499 published restaurants; refusing to replace existing pages with incomplete data.');
  const ids = new Set();
  for (const row of rows) {
    if (!uuid.test(row.id) || !String(row.name || '').trim() || ids.has(row.id)) throw new Error('Invalid or duplicate published restaurant.');
    ids.add(row.id);
  }
  const placeDir = path.join(output, 'places');
  await mkdir(placeDir, { recursive: true });
  for (const item of await readdir(placeDir, { withFileTypes: true })) {
    if (item.isDirectory() && uuid.test(item.name) && !ids.has(item.name)) await rm(path.join(placeDir, item.name), { recursive: true, force: true });
  }
  for (const row of rows) {
    const destination = path.join(placeDir, row.id);
    await mkdir(destination, { recursive: true });
    await writeFile(path.join(destination, 'index.html'), page(row, rows));
  }
  await writeFile(path.join(placeDir, 'index.html'), directory(rows));
  await writeFile(path.join(output, 'sitemap.xml'), sitemap(rows));
  return rows.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const input = process.argv.indexOf('--input');
  const output = process.argv.indexOf('--output');
  const rows = input !== -1
    ? JSON.parse(await readFile(process.argv[input + 1], 'utf8'))
    : await (async () => {
      const response = await fetch(API, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`Public data endpoint returned ${response.status}`);
      const payload = await response.json();
      if (!payload.ok || !Array.isArray(payload.restaurants)) throw new Error('Public data endpoint returned invalid data');
      return payload.restaurants;
    })();
  const count = await generateSeo(rows, output !== -1 ? path.resolve(process.argv[output + 1]) : root);
  console.log(`Generated ${count} public restaurant pages and sitemap.xml`);
}
