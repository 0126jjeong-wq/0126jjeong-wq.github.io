import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generateSeo } from './build-seo.mjs';

const first = '123e4567-e89b-12d3-a456-426614174000';
const second = '123e4567-e89b-12d3-a456-426614174001';
const row = (id, name) => ({
  id, name, address: '서울 마포구 어딘가 1', region: '마포구', category: '식사',
  latitude: 37.5, longitude: 126.9,
  instagram_url: 'https://www.instagram.com/reel/ABC123/', creator_handle: 'creator',
  menu_names: ['첫 메뉴', '두 번째 메뉴', '세 번째 메뉴'], updated_at: '2026-10-29T10:00:00Z'
});

test('renders indexable HTML and removes unpublished pages on refresh', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'reelsmap-seo-'));
  try {
    await generateSeo([row(first, '맛집 A'), row(second, '맛집 B')], output);
    const html = await readFile(path.join(output, 'places', first, 'index.html'), 'utf8');
    const sitemap = await readFile(path.join(output, 'sitemap.xml'), 'utf8');
    assert.match(html, /두 번째 메뉴/);
    assert.match(html, /<h1>맛집 A<\/h1>/);
    assert.match(html, /application\/ld\+json/);
    assert.match(html, new RegExp(`rel="canonical" href="https://myreelsmap.com/places/${first}/"`));
    assert.match(sitemap, new RegExp(`places/${second}/`));
    assert.match(sitemap, /2026-10-29/);
    await generateSeo([row(first, '맛집 A')], output);
    assert.deepEqual((await readdir(path.join(output, 'places'))).sort(), [first, 'index.html']);
    assert.doesNotMatch(await readFile(path.join(output, 'sitemap.xml'), 'utf8'), new RegExp(second));
  } finally { await rm(output, { recursive: true, force: true }); }
});

test('escapes database text and refuses empty or duplicate refreshes', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'reelsmap-seo-'));
  try {
    const special = row(first, '</script><script>alert(1)</script>');
    special.instagram_url = 'https://evil.example/reel/ABC123/';
    await generateSeo([special], output);
    const html = await readFile(path.join(output, 'places', first, 'index.html'), 'utf8');
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
    assert.doesNotMatch(html, /https:\/\/evil\.example/);
    assert.match(html, /&lt;\/script&gt;/);
    await assert.rejects(generateSeo([], output));
    await assert.rejects(generateSeo([special, special], output));
    assert.deepEqual((await readdir(path.join(output, 'places'))).sort(), [first, 'index.html']);
  } finally { await rm(output, { recursive: true, force: true }); }
});
