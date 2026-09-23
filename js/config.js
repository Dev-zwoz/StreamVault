/* ============================================================================
   StreamVault — config.js
   Central configuration. Swap keys here.
   ----------------------------------------------------------------------------
   ⚠️  SECURITY NOTE: any key placed in a static frontend is PUBLICLY VISIBLE
   to anyone who opens DevTools. TMDB v3 keys are rate-limited and free, so
   this is acceptable for demos — but for production route requests through
   the serverless proxy in /api/tmdb.js (see README "Serverless proxy").
   ============================================================================ */

/** TMDB v3 API key — replace with your own from themoviedb.org/settings/api */
export const TMDB_API_KEY = 'd722b1fbda5442499e514e438a092a5a';

/** TMDB endpoints & image CDN */
export const TMDB_BASE = 'https://api.themoviedb.org/3';
export const IMG_BASE = 'https://image.tmdb.org/t/p/';
export const IMG = {
  posterSm: IMG_BASE + 'w342',
  poster: IMG_BASE + 'w500',
  backdrop: IMG_BASE + 'w1280',
  backdropFull: IMG_BASE + 'original',
  profile: IMG_BASE + 'w185',
};

/** Cache TTL for TMDB responses (30 minutes) */
export const CACHE_TTL = 30 * 60 * 1000;

/** Search input debounce (ms) */
export const SEARCH_DEBOUNCE = 300;

/**
 * VidRift embed player — free video embed API addressed by TMDB id.
 * One URL per title; white-label branding via query params.
 * Docs: https://vidrift.net/
 */
export const VIDRIFT = {
  base: 'https://embed.vidrift.in/embed',
  origin: 'https://embed.vidrift.in',
  brand: 'StreamVault',
  brandColor: 'F5C518',
};

/** People & projects to credit in the UI */
export const CREDITS = {
  vidrift: {
    label: 'VidRift',
    author: 'Rust (cinrift)',
    url: 'https://discord.com/users/1515548260196941864',
  },
  archive: { label: 'Internet Archive', url: 'https://archive.org' },
};

/**
 * LICENSED_SOURCES hook — map a TMDB id to a licensed stream you have the
 * rights to serve. Checked BEFORE the public-domain map and VidRift.
 * Shape: { [tmdbId]: { type: 'mp4'|'hls'|'iframe', url: string, label: string } }
 * Example:
 *   4808: { type: 'hls', url: 'https://cdn.example.com/charade/master.m3u8', label: 'StreamVault CDN' }
 */
export const LICENSED_SOURCES = {};

/** Genre id → name (TMDB canonical ids used across the app) */
export const GENRES = [
  { id: 28, key: 'action' }, { id: 12, key: 'adventure' }, { id: 16, key: 'animation' },
  { id: 35, key: 'comedy' }, { id: 80, key: 'crime' }, { id: 99, key: 'documentary' },
  { id: 18, key: 'drama' }, { id: 10751, key: 'family' }, { id: 14, key: 'fantasy' },
  { id: 27, key: 'horror' }, { id: 9648, key: 'mystery' }, { id: 10749, key: 'romance' },
  { id: 878, key: 'scifi' }, { id: 53, key: 'thriller' }, { id: 10752, key: 'war' },
];

/** Creator / social links */
export const SOCIAL = {
  github: { url: 'https://github.com/Dev-zwoz', label: 'Dev-zwoz' },
  discord: { url: 'https://discord.com/users/1469638087268110399', label: 'Discord' },
  instagram: { url: 'https://www.instagram.com/vzowzz/', label: '@vzowzz' },
};

/**
 * Disify — free email validation API (APIVault → Data Validation).
 * HTTPS + CORS, no key required. Checks syntax, disposable status and DNS/MX.
 * Degrades gracefully to client-side regex when unreachable.
 */
export const EMAIL_VALIDATE_API = 'https://www.disify.com/api/email/';
