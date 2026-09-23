/* ============================================================================
   StreamVault — api.js
   TMDB data layer: fetch queue (rate-limited), in-memory + sessionStorage
   cache with 30-min TTL, key verification, graceful offline fallback.
   Covers movies, TV shows and anime (animation + JP origin/language).
   ============================================================================ */

import { TMDB_API_KEY, TMDB_BASE, CACHE_TTL, EMAIL_VALIDATE_API } from './config.js';
import { tmdbLang } from './i18n.js';

// ---------------------------------------------------------------------------
// Cache: memory first, sessionStorage second (survives reloads within session)
// ---------------------------------------------------------------------------
const mem = new Map();

function cacheGet(key) {
  const hit = mem.get(key);
  if (hit && Date.now() - hit.t < CACHE_TTL) return hit.v;
  try {
    const raw = sessionStorage.getItem('svc:' + key);
    if (raw) {
      const { time, value } = JSON.parse(raw);
      if (Date.now() - time < CACHE_TTL) { mem.set(key, { t: time, v: value }); return value; }
      sessionStorage.removeItem('svc:' + key);
    }
  } catch { /* storage full or disabled — memory cache still works */ }
  return null;
}

function cacheSet(key, v) {
  const entry = { time: Date.now(), value: v };
  mem.set(key, { t: entry.time, v });
  try { sessionStorage.setItem('svc:' + key, JSON.stringify(entry)); }
  catch { /* quota exceeded — evict half the cache */
    try {
      const keys = Object.keys(sessionStorage).filter((k) => k.startsWith('svc:'));
      keys.slice(0, Math.ceil(keys.length / 2)).forEach((k) => sessionStorage.removeItem(k));
    } catch { /* noop */ }
  }
}

// ---------------------------------------------------------------------------
// Request queue — never exceed ~40 requests / second (TMDB soft limit ~50)
// ---------------------------------------------------------------------------
const queue = [];
let inWindow = 0;
const WINDOW_MS = 1000, MAX_PER_WINDOW = 40;

function pump() {
  while (queue.length && inWindow < MAX_PER_WINDOW) {
    inWindow++;
    queue.shift()();
  }
}
setInterval(() => { inWindow = 0; pump(); }, WINDOW_MS);

function throttledFetch(url) {
  return new Promise((resolve, reject) => {
    queue.push(() => fetch(url).then(resolve, reject));
    pump();
  });
}

// ---------------------------------------------------------------------------
// Core TMDB call
// ---------------------------------------------------------------------------
export const apiState = { online: true, keyValid: true };

export async function tmdb(path, params = {}) {
  const search = new URLSearchParams({ api_key: TMDB_API_KEY, language: tmdbLang(), ...params });
  const url = `${TMDB_BASE}${path}?${search}`;
  const key = `${path}?${search.toString().replace(TMDB_API_KEY, 'k')}`;

  const cached = cacheGet(key);
  if (cached) return cached;

  const res = await throttledFetch(url);
  if (res.status === 401) { apiState.keyValid = false; throw new Error('TMDB 401 — invalid API key'); }
  if (!res.ok) throw new Error(`TMDB ${res.status} on ${path}`);
  const json = await res.json();
  cacheSet(key, json);
  return json;
}

/** Startup key verification — resolves { ok, reason } and never throws */
export async function verifyKey() {
  try {
    const res = await throttledFetch(`${TMDB_BASE}/configuration?api_key=${TMDB_API_KEY}`);
    if (res.status === 401) {
      apiState.keyValid = false;
      console.warn('[StreamVault] TMDB key INVALID (401). Falling back to offline data.');
      return { ok: false, reason: 'invalid-key' };
    }
    if (!res.ok) throw new Error(String(res.status));
    console.info('[StreamVault] TMDB key verified ✓ — live data enabled.');
    return { ok: true };
  } catch (e) {
    apiState.online = false;
    console.warn('[StreamVault] TMDB unreachable — offline mode.', e.message || e);
    return { ok: false, reason: 'offline' };
  }
}

// ---------------------------------------------------------------------------
// Fallback data + normalisation
// ---------------------------------------------------------------------------
let fallbackCache = null;
export async function getFallback() {
  if (fallbackCache) return fallbackCache;
  const res = await fetch('data/fallback-movies.json');
  fallbackCache = await res.json();
  return fallbackCache;
}

/**
 * Normalise a TMDB list item so every card has the same shape:
 * title, release_date, media_type and a stable `date`.
 */
export function norm(m) {
  if (!m) return m;
  const media_type = m.media_type || (m.first_air_date !== undefined && m.title === undefined ? 'tv' : 'movie');
  return {
    ...m,
    media_type: media_type === 'person' ? 'person' : media_type,
    title: m.title || m.name || m.original_title || m.original_name || '',
    release_date: m.release_date || m.first_air_date || '',
  };
}

const isAnimeItem = (m) => (m.genre_ids || m.genres?.map((g) => g.id) || []).includes(16) &&
  ['ja', 'zh', 'ko'].includes(m.original_language);

export { isAnimeItem };

/** List fetch that degrades to fallback data instead of throwing. */
export async function movieList(path, params = {}) {
  if (apiState.online && apiState.keyValid) {
    try {
      const data = await tmdb(path, params);
      if (Array.isArray(data.results)) data.results = data.results.map(norm);
      return data;
    } catch (e) { console.warn('[StreamVault] list fetch failed, using fallback:', e.message); }
  }
  const fb = await getFallback();
  return { page: 1, total_pages: 1, results: fb.results.map(norm) };
}

// ---------------------------------------------------------------------------
// Endpoints — movies
// ---------------------------------------------------------------------------
export const getTrending = () => movieList('/trending/movie/week');
export const getPopular = (page = 1) => movieList('/movie/popular', { page });
export const getTopRated = (page = 1) => movieList('/movie/top_rated', { page });
export const getNowPlaying = (page = 1) => movieList('/movie/now_playing', { page });
export const getUpcoming = (page = 1) => movieList('/movie/upcoming', { page });
export const searchMovies = (query, page = 1) => movieList('/search/movie', { query, page, include_adult: false });
export const discover = (params) => movieList('/discover/movie', { include_adult: false, ...params });

export const getKorean = () => discover({ with_original_language: 'ko', sort_by: 'popularity.desc', 'vote_count.gte': 200 });
export const getJapanese = () => discover({ with_original_language: 'ja', sort_by: 'popularity.desc', 'vote_count.gte': 200 });
export const getIndonesian = () => discover({ with_origin_country: 'ID', sort_by: 'popularity.desc' });
export const getHollywood = () => discover({ with_origin_country: 'US', sort_by: 'revenue.desc', 'vote_count.gte': 1000 });
export const getFamily = () => discover({ with_genres: '10751', sort_by: 'popularity.desc', 'vote_count.gte': 300, certification_country: 'US' });

// ---------------------------------------------------------------------------
// Endpoints — TV & anime
// ---------------------------------------------------------------------------
export const getTrendingAll = (page = 1) => movieList('/trending/all/week', { page });
export const getTrendingTV = (page = 1) => movieList('/trending/tv/week', { page });
export const discoverTV = (params) => movieList('/discover/tv', { include_adult: false, ...params });
export const getTvPopular = (page = 1) => movieList('/tv/popular', { page });
export const getTvOnAir = (page = 1) => movieList('/tv/on_the_air', { page });

/** Anime: animation genre, Japanese origin, sane vote floor */
export const getAnime = (params = {}) => discoverTV({
  with_genres: '16', with_origin_country: 'JP', sort_by: 'popularity.desc',
  'vote_count.gte': 50, ...params,
});

// ---------------------------------------------------------------------------
// Endpoints — search & detail
// ---------------------------------------------------------------------------
export const searchMulti = (query, page = 1) =>
  movieList('/search/multi', { query, page, include_adult: false });

export const getMovie = async (id) => ({ media_type: 'movie', ...(await tmdb(`/movie/${id}`, { append_to_response: 'videos,credits,similar,recommendations,external_ids,release_dates' })) });
export const getTV = async (id) => ({ media_type: 'tv', ...(await tmdb(`/tv/${id}`, { append_to_response: 'videos,credits,similar,recommendations,external_ids,content_ratings' })) });
export const getSeason = (id, season) => tmdb(`/tv/${id}/season/${season}`);

/** Detail fetch for either media type */
export const getMedia = (type, id) => (type === 'tv' ? getTV(id) : getMovie(id));

/** Where-to-watch, per media type */
export const getProviders = (type, id) => tmdb(`/${type === 'tv' ? 'tv' : 'movie'}/${id}/watch/providers`);

/** Light details for a set of movie ids (used by the playable-only filter) */
export async function getMoviesByIds(ids) {
  const out = [];
  await Promise.all(ids.map(async (id) => {
    try { out.push(norm(await tmdb(`/movie/${id}`))); }
    catch { /* skip unfetchable */ }
  }));
  return out;
}

// ---------------------------------------------------------------------------
// Email validation (Disify — free, HTTPS+CORS, no key) with regex fallback
// ---------------------------------------------------------------------------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function validateEmail(email) {
  if (!EMAIL_RE.test(email)) return { valid: false, reason: 'format' };
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 4000);
    const res = await fetch(EMAIL_VALIDATE_API + encodeURIComponent(email), { signal: ctl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(String(res.status));
    const j = await res.json();
    if (j.format === false) return { valid: false, reason: 'format' };
    if (j.disposable === true) return { valid: false, reason: 'disposable' };
    if (j.dns === false) return { valid: false, reason: 'format' };
    return { valid: true };
  } catch {
    return { valid: true, degraded: true };
  }
}
