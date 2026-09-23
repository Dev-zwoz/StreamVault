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

/* ----------------------------------------------------------------------------
   Content policy (operator settings — see legal.html#content-policy)
   1) LGBT-themed titles are excluded site-wide. The ids below are TMDB
      keyword ids (verified on themoviedb.org keyword pages, 2026-09) and are
      sent as `without_keywords` on every /discover request; titles that slip
      through (e.g. found directly via search) are blocked again at play time
      via /movie|tv/{id}/keywords (see js/content.js).
   2) A maturity ceiling hides titles above the chosen age rating:
      default 'teen' (max PG-13 / TV-14); 'mature' shows everything.
   ---------------------------------------------------------------------------- */
export const BLOCKED_KEYWORDS = [
  158718, // lgbt (umbrella)
  363345, // gay (umbrella)
  163037, // lgbt teen
  243575, // indigenous lgbt
  264386, // lesbian
  290527, // transgender
  239239, // closeted homosexual
  240305, // gay romance
  258533, // gay theme
  265777, // gay relationship
  323690, // gay sex
  323678, // gay hardcore
  238355, // gay pornography
  247821, // gay youth
  329424, // gay people
  337701, // gay men
  346769, // gay interest
  41515,  // gay parent
  11524,  // in the closet
  300642, // queer cinema
];

/* Maturity levels: certification ceiling per endpoint (US certifications).
   null = no ceiling (R / NC-17 / TV-MA allowed). */
export const MATURITY_LEVELS = [
  { id: 'all',    movie: 'G',     tv: 'TV-G' },
  { id: 'family', movie: 'PG',    tv: 'TV-PG' },
  { id: 'teen',   movie: 'PG-13', tv: 'TV-14' },
  { id: 'mature', movie: null,    tv: null },
];
export const DEFAULT_MATURITY = 'teen';

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
