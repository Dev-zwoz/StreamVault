/* ============================================================================
   StreamVault — api.js
   TMDB data layer: fetch queue (rate-limited), in-memory + sessionStorage
   cache with 30-min TTL, key verification, graceful offline fallback.
   ============================================================================ */

import { TMDB_API_KEY, TMDB_BASE, CACHE_TTL, EMAIL_VALIDATE_API, BLOCKED_KEYWORDS, MATURITY_LEVELS, DEFAULT_MATURITY } from './config.js';
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
      const { t, v } = JSON.parse(raw);
      if (Date.now() - t < CACHE_TTL) { mem.set(key, { t, v }); return v; }
      sessionStorage.removeItem('svc:' + key);
    }
  } catch { /* storage full or disabled — memory cache still works */ }
  return null;
}

function cacheSet(key, v) {
  const entry = { t: Date.now(), v };
  mem.set(key, entry);
  try { sessionStorage.setItem('svc:' + key, JSON.stringify(entry)); }
  catch { /* quota exceeded — evict oldest sv cache entries */
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
    const job = queue.shift();
    job();
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

/**
 * GET a TMDB path with params. Returns parsed JSON.
 * Localized by current UI language; cached 30 min per (path, params, lang).
 */
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

/**
 * Startup key verification — called once on load.
 * Resolves { ok, reason } and never throws; logs the result.
 */
export async function verifyKey() {
  try {
    const res = await throttledFetch(`${TMDB_BASE}/configuration?api_key=${TMDB_API_KEY}`);
    if (res.status === 401) {
      apiState.keyValid = false;
      console.warn('[StreamVault] TMDB key INVALID (401). Falling back to offline data. Fix TMDB_API_KEY in js/config.js.');
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
// Fallback data
// ---------------------------------------------------------------------------
let fallbackCache = null;
export async function getFallback() {
  if (fallbackCache) return fallbackCache;
  const res = await fetch('data/fallback-movies.json');
  fallbackCache = await res.json();
  return fallbackCache;
}

/** Movie list fetch that degrades to fallback data instead of throwing. */
export async function movieList(path, params = {}) {
  if (apiState.online && apiState.keyValid) {
    try { return await tmdb(path, params); }
    catch (e) { console.warn('[StreamVault] list fetch failed, using fallback:', e.message); }
  }
  const fb = await getFallback();
  return { page: 1, total_pages: 1, results: fb.results };
}

// ---------------------------------------------------------------------------
// Content policy (js/content.js owns the user-facing parts; api.js owns the
// request-level enforcement so EVERY discover is covered):
//   * without_keywords — LGBT-theme keywords are excluded site-wide
//   * certification.lte — maturity ceiling (user setting, default teen)
// An explicit `certification` filter (Age Rating dropdown) overrides the
// ceiling — the user deliberately asked for that exact rating.
// ---------------------------------------------------------------------------
const readMaturity = () => {
  try {
    const s = JSON.parse(localStorage.getItem('sv:settings'));
    return MATURITY_LEVELS.some((l) => l.id === s?.contentMaturity) ? s.contentMaturity : DEFAULT_MATURITY;
  } catch { return DEFAULT_MATURITY; }
};
export function policyParams(kind = 'movie', params = {}) {
  const p = { without_keywords: BLOCKED_KEYWORDS.join(',') };
  const lvl = MATURITY_LEVELS.find((l) => l.id === readMaturity());
  const max = lvl && (kind === 'tv' ? lvl.tv : lvl.movie);
  if (max && !params.certification) {
    p.certification_country = 'US';
    p['certification.lte'] = max;
  }
  return p;
}

// ---------------------------------------------------------------------------
// Convenience endpoints — rows go through /discover (not /movie/popular & co.)
// so the content policy applies to home rows too.
// ---------------------------------------------------------------------------
const today = () => new Date().toISOString().slice(0, 10);
export const getTrending = () => movieList('/trending/movie/week');
export const getPopular = (page = 1) => discover({ sort_by: 'popularity.desc', page });
export const getTopRated = (page = 1) => discover({ sort_by: 'vote_average.desc', 'vote_count.gte': 300, page });
export const getNowPlaying = (page = 1) => discover({ sort_by: 'primary_release_date.desc', 'primary_release_date.lte': today(), page });
export const getUpcoming = (page = 1) => discover({ sort_by: 'primary_release_date.desc', 'primary_release_date.gte': today(), page });
export const getGenreList = () => tmdb('/genre/movie/list');
export const searchMovies = (query, page = 1) => movieList('/search/movie', { query, page, include_adult: false });
export const discover = (params = {}) => movieList('/discover/movie', { include_adult: false, ...policyParams('movie', params), ...params });
export const discoverTv = (params = {}) => movieList('/discover/tv', { include_adult: false, ...policyParams('tv', params), ...params });
export const discoverByType = (type, params) => (type === 'movie' ? discover(params) : discoverTv(params));

export const getKorean = () => discover({ with_original_language: 'ko', sort_by: 'popularity.desc', 'vote_count.gte': 200 });
export const getJapanese = () => discover({ with_original_language: 'ja', sort_by: 'popularity.desc', 'vote_count.gte': 200 });
export const getIndonesian = () => discover({ with_origin_country: 'ID', sort_by: 'popularity.desc' });
export const getHollywood = () => discover({ with_origin_country: 'US', sort_by: 'revenue.desc', 'vote_count.gte': 1000 });
export const getFamily = () => discover({ with_genres: '10751', sort_by: 'popularity.desc', 'vote_count.gte': 300, certification_country: 'US' });

export const getMovie = (id) =>
  tmdb(`/movie/${id}`, { append_to_response: 'videos,credits,similar,recommendations,external_ids' });
export const getShow = (id) =>
  tmdb(`/tv/${id}`, { append_to_response: 'videos,credits,similar,recommendations,external_ids' });
export const getTitle = (type, id) => (type === 'tv' ? getShow(id) : getMovie(id));
export const getProviders = (id) => tmdb(`/movie/${id}/watch/providers`);
export const getTvProviders = (id) => tmdb(`/tv/${id}/watch/providers`);
export const getProvidersFor = (type, id) => (type === 'tv' ? getTvProviders(id) : getProviders(id));

/** Fetch light details for a set of ids (used by Free Classics row offline-safe) */
export async function getMoviesByIds(ids) {
  const out = [];
  await Promise.all(ids.map(async (id) => {
    try { out.push(await tmdb(`/movie/${id}`)); }
    catch { /* skip unfetchable */ }
  }));
  return out;
}

// ---------------------------------------------------------------------------
// Email validation (Disify — APIVault "Data Validation", HTTPS+CORS, no key)
// Falls back to a solid client-side regex when the API is unreachable.
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
    // API down → accept on regex alone (graceful degradation)
    return { valid: true, degraded: true };
  }
}
