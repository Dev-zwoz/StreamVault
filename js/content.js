/* ============================================================================
   StreamVault — content.js
   Content-policy engine: LGBT-theme exclusion (hard, operator policy) +
   maturity ceiling (user setting). Policy params are injected into every
   /discover request by api.js; this module additionally checks single titles
   (search results, play requests) against TMDB's keyword data so nothing
   slips through the discover-only filter.
   ============================================================================ */

import { BLOCKED_KEYWORDS, MATURITY_LEVELS, DEFAULT_MATURITY } from './config.js';
import { tmdb } from './api.js';

const SET_KEY = 'sv:settings';

/** Current maturity level (user setting; falls back to the operator default). */
export function getMaturity() {
  try {
    const s = JSON.parse(localStorage.getItem(SET_KEY));
    return MATURITY_LEVELS.some((l) => l.id === s?.contentMaturity) ? s.contentMaturity : DEFAULT_MATURITY;
  } catch { return DEFAULT_MATURITY; }
}

/** Keyword ids TMDB has tagged on this title ([] when un-fetchable). */
export async function fetchKeywordIds(type, id) {
  try {
    const j = await tmdb(`/${type === 'tv' ? 'tv' : 'movie'}/${id}/keywords`);
    return (j.keywords || j.results || []).map((k) => Number(k.id));
  } catch { return []; }
}

const blockedCache = new Map(); // "type:id" -> boolean (session-lifetime)

/** True when the title carries an LGBT-theme keyword — it must not appear. */
export async function isBlockedTitle(type, id) {
  const key = `${type}:${id}`;
  if (blockedCache.has(key)) return blockedCache.get(key);
  const ids = await fetchKeywordIds(type, id);
  const bad = ids.some((n) => BLOCKED_KEYWORDS.includes(n));
  blockedCache.set(key, bad);
  return bad;
}
