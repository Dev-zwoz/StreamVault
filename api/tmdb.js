/**
 * StreamVault — serverless TMDB proxy (Vercel / Netlify compatible)
 * ---------------------------------------------------------------------------
 * Keeps your TMDB key out of the browser in production.
 *
 * Vercel:   drop this file in /api — it works as-is (Node runtime).
 *           Set the env var TMDB_API_KEY in the Vercel dashboard.
 * Netlify:  move to netlify/functions/tmdb.js and export `handler`
 *           (adapter included at the bottom).
 *
 * Frontend change: in js/config.js set
 *   export const TMDB_BASE = '/api/tmdb';
 * and remove api_key from the URLSearchParams in js/api.js (the proxy adds it).
 */

const TMDB = 'https://api.themoviedb.org/3';

// Allow only known, read-only paths through the proxy.
const ALLOWED = [
  /^\/trending\/movie\/(day|week)$/,
  /^\/movie\/(popular|top_rated|now_playing|upcoming)$/,
  /^\/movie\/\d+$/,
  /^\/movie\/\d+\/watch\/providers$/,
  /^\/genre\/movie\/list$/,
  /^\/search\/movie$/,
  /^\/discover\/movie$/,
  /^\/configuration$/,
];

export default async function handler(req, res) {
  const { path = '', ...params } = req.query;
  if (!ALLOWED.some((re) => re.test(path))) {
    return res.status(400).json({ error: 'Path not allowed' });
  }
  const search = new URLSearchParams({ ...params, api_key: process.env.TMDB_API_KEY });
  try {
    const upstream = await fetch(`${TMDB}${path}?${search}`);
    const body = await upstream.json();
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
    return res.status(upstream.status).json(body);
  } catch (e) {
    return res.status(502).json({ error: 'TMDB unreachable' });
  }
}

/* ------------------------- Netlify adapter -------------------------------
export async function handler(event) {
  const { path = '', ...params } = event.queryStringParameters || {};
  if (!ALLOWED.some((re) => re.test(path))) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Path not allowed' }) };
  }
  const search = new URLSearchParams({ ...params, api_key: process.env.TMDB_API_KEY });
  const upstream = await fetch(`${TMDB}${path}?${search}`);
  return {
    statusCode: upstream.status,
    headers: { 'Cache-Control': 's-maxage=1800' },
    body: await upstream.text(),
  };
}
--------------------------------------------------------------------------- */
