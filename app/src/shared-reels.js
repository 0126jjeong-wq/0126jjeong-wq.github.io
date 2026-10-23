// Only store public Instagram post URLs; discard tracking data and other origins.
export function canonicalReel(raw) {
  if (typeof raw !== 'string') return null;
  try {
    const url = new URL(raw.trim());
    const parts = url.pathname.split('/').filter(Boolean);
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
        !['instagram.com', 'www.instagram.com', 'm.instagram.com'].includes(url.hostname) ||
        parts.length !== 2 || !['reel', 'reels', 'p'].includes(parts[0]) ||
        !/^[A-Za-z0-9_-]+$/.test(parts[1])) return null;
    return `https://www.instagram.com/${parts[0] === 'reels' ? 'reel' : parts[0]}/${parts[1]}/`;
  } catch { return null; }
}

export function extractReels(text) {
  if (typeof text !== 'string') return [];
  return [...new Set((text.match(/https:\/\/[^\s<>"']+/g) || [])
    .map(raw => canonicalReel(raw.replace(/[),.\]!}]+$/, ''))).filter(Boolean))];
}

export function matchPlaces(raw, places) {
  const url = canonicalReel(raw);
  if (!url) return [];
  return places.filter(place => (place.reels || []).some(reel => canonicalReel(reel.url) === url));
}
