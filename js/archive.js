/* ============================================================================
   StreamVault — archive.js
   Playable source resolution, in priority order:
     1. LICENSED_SOURCES (config.js hook — streams you own the rights to)
     2. public-domain-map.json → Internet Archive MP4 (native <video>, plays
        inside any frame, no third-party player required)
     3. VidRift embed (HD iframe player addressed by TMDB id) — with our thanks
        to Rust (cinrift): https://discord.com/users/1515548260196941864
   ============================================================================ */

import { LICENSED_SOURCES, VIDRIFT } from './config.js';

let pdMap = null;

/** Load & memoize the public-domain map */
export async function loadPdMap() {
  if (pdMap) return pdMap;
  try {
    const res = await fetch('data/public-domain-map.json');
    pdMap = (await res.json()).films || {};
  } catch { pdMap = {}; }
  return pdMap;
}

/** Sync check once the map is loaded (loadPdMap is called at boot) */
export function isPublicDomain(tmdbId) {
  return !!(pdMap && pdMap[String(tmdbId)]);
}

export function pdEntry(tmdbId) {
  return pdMap ? pdMap[String(tmdbId)] || null : null;
}

/** TMDB ids of every public-domain film (playable natively) */
export function pdIds() {
  return pdMap ? Object.keys(pdMap).filter((k) => k !== '_comment').map(Number) : [];
}

/**
 * Resolve the best MP4 for an Archive item via its metadata API.
 * Prefers h.264 derivatives, largest first (usually the full feature).
 */
async function resolveArchiveMp4(archiveId, preferredFile) {
  const res = await fetch(`https://archive.org/metadata/${archiveId}`);
  if (!res.ok) throw new Error(`Archive metadata ${res.status}`);
  const meta = await res.json();
  const server = meta.d1 || meta.server;
  const dir = meta.dir;
  const files = meta.files || [];

  const urlFor = (name) => `https://${server}${dir}/${encodeURIComponent(name).replace(/%2F/g, '/')}`;

  if (preferredFile) {
    const hit = files.find((f) => f.name === preferredFile);
    if (hit) return urlFor(hit.name);
  }
  const mp4s = files
    .filter((f) => /\.mp4$/i.test(f.name) && !/(trailer|sample|thumb)/i.test(f.name))
    .sort((a, b) => Number(b.size || 0) - Number(a.size || 0));
  const h264 = mp4s.find((f) => /h\.?264/i.test(f.format || '')) || mp4s[0];
  if (h264) return urlFor(h264.name);

  const ogv = files.filter((f) => /\.ogv$/i.test(f.name)).sort((a, b) => Number(b.size || 0) - Number(a.size || 0))[0];
  if (ogv) return urlFor(ogv.name);
  throw new Error('No playable file in archive item');
}

/** Build a branded VidRift embed URL (movie, or TV with season/episode) */
export function vidriftUrl(tmdbId, title = '', type = 'movie', season = 1, episode = 1) {
  const p = new URLSearchParams({ brand: VIDRIFT.brand, brandColor: VIDRIFT.brandColor, mobileSheets: '1' });
  if (title) p.set('title', title);
  try { p.set('brandLogo', new URL('assets/logo.svg', location.href).href); } catch { /* relative base only */ }
  const path = type === 'tv' ? `tv/${tmdbId}/${season}/${episode}` : `movie/${tmdbId}`;
  return `${VIDRIFT.base}/${path}?${p}`;
}

/**
 * Every playable source for a title, best first.
 * Returns [{ type: 'mp4'|'hls'|'iframe', url, label, kind }]
 */
export async function listSources(tmdbId, title = '', type = 'movie', season = 1, episode = 1) {
  const out = [];
  const licensed = LICENSED_SOURCES[tmdbId] || LICENSED_SOURCES[String(tmdbId)];
  if (licensed) out.push({ ...licensed, kind: 'licensed' });

  if (type === 'movie') {
    await loadPdMap();
    const pd = pdEntry(tmdbId);
    if (pd) {
      try {
        const url = await resolveArchiveMp4(pd.archiveId, pd.file);
        out.push({ type: 'mp4', url, label: 'Internet Archive · Public Domain', kind: 'public-domain', sourceKey: 'archive' });
      } catch (e) {
        console.warn('[StreamVault] Archive resolution failed:', e.message);
      }
    }
  }

  out.push({
    type: 'iframe',
    url: vidriftUrl(tmdbId, title, type, season, episode),
    label: 'VidRift · HD',
    kind: 'vidrift',
    sourceKey: 'vidrift',
  });
  return out;
}

/** Single best source (kept for compatibility) */
export async function resolveSource(tmdbId, title = '', type = 'movie', season = 1, episode = 1) {
  const sources = await listSources(tmdbId, title, type, season, episode);
  return sources[0];
}
