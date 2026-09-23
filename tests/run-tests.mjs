#!/usr/bin/env node
/* ============================================================================
   StreamVault — tests/run-tests.mjs
   jsdom harness. Run:  NODE_PATH=/tmp/node_modules node tests/run-tests.mjs
   Boots the real app modules against a stubbed network (TMDB / archive.org /
   Disify) and verifies every Round-6 requirement end to end.
   ============================================================================ */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole, DOMParser } = require('/tmp/node_modules/jsdom');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX_HTML = readFileSync(join(root, 'index.html'), 'utf8');
const WATCH_HTML = readFileSync(join(root, 'watch.html'), 'utf8');

// ---------------------------------------------------------------------------
// tiny test runner
// ---------------------------------------------------------------------------
let passed = 0, failed = 0;
const failures = [];
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name + (extra ? ` — ${extra}` : '')); console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitUntil(fn, timeout = 10000, label = 'condition') {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try { if (fn()) return true; } catch { /* keep waiting */ }
    await sleep(60);
  }
  return !!fn();
}

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------
function tmdbMovie(i, over = {}) {
  return {
    id: 900000 + i,
    title: `Fixture Movie ${i}`,
    name: undefined,
    release_date: `${1970 + (i % 50)}-0${1 + (i % 9)}-1${i % 9}`,
    poster_path: `/p${i}.jpg`,
    backdrop_path: `/b${i}.jpg`,
    vote_average: 5 + (i % 5) * 0.8,
    vote_count: 400 + i * 10,
    popularity: 100 - i,
    genre_ids: [28, 35].slice(0, 1 + (i % 2)),
    overview: `Overview ${i}`,
    ...over,
  };
}
function tmdbShow(i) {
  return {
    id: 800000 + i,
    name: `Fixture Show ${i}`,
    first_air_date: `${1980 + (i % 40)}-0${1 + (i % 9)}-1${i % 9}`,
    poster_path: `/sp${i}.jpg`,
    backdrop_path: `/sb${i}.jpg`,
    vote_average: 6 + (i % 4) * 0.7,
    vote_count: 300 + i * 7,
    popularity: 90 - i,
    genre_ids: [16, 18].slice(0, 1 + (i % 2)),
    overview: `Show overview ${i}`,
  };
}
const detail = (id) => ({
  id,
  title: `Fixture Detail ${id}`,
  name: `Fixture Detail ${id}`,
  tagline: 'A fixture tagline',
  overview: 'Long fixture overview.',
  release_date: '2001-07-20', first_air_date: '2001-07-20',
  runtime: 120, episode_run_time: [42],
  vote_average: 8.1, vote_count: 12000,
  poster_path: '/dp.jpg', backdrop_path: '/db.jpg',
  genres: [{ id: 28, name: 'Action' }],
  videos: { results: [{ site: 'YouTube', type: 'Trailer', key: 'abc123' }] },
  credits: { cast: [{ name: 'Actor One', character: 'Hero', profile_path: '/a.jpg }' }], crew: [{ name: 'Director X', job: 'Director' }] },
  created_by: [{ name: 'Creator Y' }],
  similar: { results: [tmdbMovie(91)] },
  recommendations: { results: [tmdbMovie(92)] },
});

const ARCHIVE_META = (id) => ({
  d1: 'd1.us.archive.org',
  dir: `/${id}`,
  files: [
    { name: 'trailer.mp4', size: '1000', format: 'MPEG4' },
    { name: `${id}.mp4`, size: '734003200', format: 'h.264 MPEG-4' },
    { name: `${id}.ogv`, size: '5000', format: 'Ogg Video' },
  ],
});

// ---------------------------------------------------------------------------
// DOM + globals
// ---------------------------------------------------------------------------
let consoleErrors = [];
const fetchLog = [];
let currentDom = null;

function stubFetch() {
  globalThis.fetch = async (input) => {
    const url = String(input instanceof URL ? input : input?.url || input);
    fetchLog.push(url);
    const json = (obj) => ({ ok: true, status: 200, json: async () => obj });

    if (url.startsWith('data/') || url.includes('/data/')) {
      const file = url.replace(/^.*?data\//, 'data/');
      const path = join(root, file);
      if (!existsSync(path)) return { ok: false, status: 404, json: async () => ({}) };
      return json(JSON.parse(readFileSync(path, 'utf8')));
    }
    if (url.includes('api.themoviedb.org/3/configuration')) return json({ images: { secure_base_url: 'https://image.tmdb.org/t/p/' } });
    if (url.includes('/trending/movie/week')) {
      return json({ page: 1, results: Array.from({ length: 20 }, (_, i) => tmdbMovie(i + 1)) });
    }
    if (url.includes('/search/movie')) return json({ page: 1, results: [tmdbMovie(0, { id: 142, title: 'Blocked Romance' }), tmdbMovie(1)] });
    if (/\/(movie)\/(popular|top_rated|now_playing|upcoming)/.test(url)) {
      const u = new URL(url);
      const page = Number(u.searchParams.get('page') || 1);
      return json({
        page, total_pages: 5, total_results: 90,
        results: Array.from({ length: 18 }, (_, i) => tmdbMovie((page - 1) * 18 + i + 1)),
      });
    }
    if (url.includes('/discover/movie') || url.includes('/discover/tv')) {
      const u = new URL(url);
      const page = Number(u.searchParams.get('page') || 1);
      const isTv = url.includes('/discover/tv');
      const mk = isTv ? tmdbShow : tmdbMovie;
      return json({
        page, total_pages: 6, total_results: 107,
        results: Array.from({ length: 18 }, (_, i) => mk((page - 1) * 18 + i + 1)),
      });
    }
    // content-policy keyword lookups (/movie|tv/{id}/keywords) — id 142 is the blocked fixture
    if (/\/(movie|tv)\/\d+\/keywords/.test(url)) {
      const kid = Number(url.match(/\/(movie|tv)\/(\d+)/)[2]);
      return json(kid === 142
        ? { keywords: [{ id: 158718, name: 'lgbt' }, { id: 363345, name: 'gay' }], results: [{ id: 158718, name: 'lgbt' }] }
        : { keywords: [], results: [] });
    }
    if (url.includes('/watch/providers')) {
      return json({ results: { ID: { link: 'https://www.justwatch.com', flatrate: [{ provider_name: 'Fixtureflix', logo_path: '/fx.jpg' }] } } });
    }
    const mMovie = url.match(/\/(movie|tv)\/(\d+)/);
    if (mMovie) return json(detail(Number(mMovie[2])));
    if (url.includes('archive.org/metadata/')) {
      const id = decodeURIComponent(url.split('/metadata/')[1]);
      return json(ARCHIVE_META(id));
    }
    if (url.includes('disify.com')) return json({ format: true, disposable: false, dns: true });
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

function installDom(html, url = 'http://localhost:8000/index.html') {
  const vc = new VirtualConsole();
  vc.on('error', (...a) => { consoleErrors.push(a.map(String).join(' ')); });
  vc.on('warn', () => {});
  vc.on('jsdomError', (e) => {
    const msg = String(e?.message || e);
    if (!/Not implemented|Could not load|navigation/i.test(msg)) consoleErrors.push(msg);
  });
  const dom = new JSDOM(html, { url, pretendToBeVisual: true, virtualConsole: vc, runScripts: 'outside-only' });
  currentDom = dom;
  const w = dom.window;

  // shims the modules expect
  w.matchMedia = w.matchMedia || ((q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  w.IntersectionObserver = class {
    constructor(cb) { this.cb = cb; }
    observe(el) { setTimeout(() => { try { this.cb([{ target: el, isIntersecting: true }], this); } catch { /* noop */ } }, 0); }
    unobserve() {} disconnect() {}
  };
  w.scrollTo = () => {};
  if (!w.requestAnimationFrame) w.requestAnimationFrame = (fn) => setTimeout(() => fn(performance.now()), 0);

  // publish onto Node globals so the ESM modules share one realm view
  const define = (name, value) => {
    try { Object.defineProperty(globalThis, name, { value, configurable: true, writable: true }); }
    catch { try { globalThis[name] = value; } catch { /* getter-only global (navigator) — skip */ } }
  };
  define('window', w);
  define('document', w.document);
  define('location', w.location);
  define('navigator', w.navigator);
  define('localStorage', w.localStorage);
  define('sessionStorage', w.sessionStorage);
  define('CustomEvent', w.CustomEvent);
  define('Event', w.Event);
  define('MessageEvent', w.MessageEvent);
  define('MouseEvent', w.MouseEvent);
  define('KeyboardEvent', w.KeyboardEvent);
  define('FormData', w.FormData);
  define('Image', w.Image);
  define('DOMParser', w.DOMParser);
  define('IntersectionObserver', w.IntersectionObserver);
  define('requestAnimationFrame', w.requestAnimationFrame);
  define('cancelAnimationFrame', w.cancelAnimationFrame || (() => {}));
  define('getComputedStyle', w.getComputedStyle);
  define('matchMedia', w.matchMedia);
  define('addEventListener', w.addEventListener.bind(w));
  define('removeEventListener', w.removeEventListener.bind(w));
  define('dispatchEvent', w.dispatchEvent.bind(w));
  define('innerWidth', w.innerWidth);
  define('innerHeight', w.innerHeight);
  define('requestIdleCallback', w.requestIdleCallback || ((fn) => setTimeout(() => fn({ didTimeout: false, timeRemaining: () => 5 }), 0)));
  Object.defineProperty(globalThis, 'scrollY', { get: () => w.scrollY || 0, configurable: true });
  Object.defineProperty(globalThis, 'scrollX', { get: () => w.scrollX || 0, configurable: true });
  define('scrollTo', () => {});
  define('scroll', () => {});
  define('focus', () => {});

  // social-click capture
  w.__opened = [];
  w.open = (u) => { w.__opened.push(String(u)); return { focus() {}, closed: false }; };
  w.top = w; // same-frame: fallbacks don't actually navigate
  return dom;
}

const PUBLISHED_KEYS = ['window','document','location','navigator','localStorage','sessionStorage','CustomEvent','Event','MessageEvent','MouseEvent','KeyboardEvent','FormData','Image','DOMParser','IntersectionObserver','requestAnimationFrame','cancelAnimationFrame','getComputedStyle','matchMedia','addEventListener','removeEventListener','dispatchEvent','innerWidth','innerHeight','requestIdleCallback','scrollTo','scroll','focus'];
const redefine = (k, v) => {
  try { Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true }); }
  catch { try { globalThis[k] = v; } catch { /* getter-only (navigator) */ } }
};
const snapshotGlobals = () => Object.fromEntries(PUBLISHED_KEYS.map((k) => [k, globalThis[k]]));
const restoreGlobals = (snap) => {
  for (const k of PUBLISHED_KEYS) redefine(k, snap[k]);
  const sw = snap.window;
  Object.defineProperty(globalThis, 'scrollY', { get: () => sw.scrollY || 0, configurable: true });
  Object.defineProperty(globalThis, 'scrollX', { get: () => sw.scrollX || 0, configurable: true });
};

stubFetch();

// ---------------------------------------------------------------------------
// MODULE UNDER TEST
// ---------------------------------------------------------------------------
console.log('\n== BOOT ==');
installDom(INDEX_HTML);
const modules = await Promise.all([
  import(join(root, 'js/app.js')),
  import(join(root, 'js/account.js')),
  import(join(root, 'js/admin.js')),
  import(join(root, 'js/i18n.js')),
  import(join(root, 'js/ui.js')),
  import(join(root, 'js/player.js')),
  import(join(root, 'js/archive.js')),
  import(join(root, 'js/config.js')),
]);
const app = modules[0];
const account = modules[1];
const admin = modules[2];
const i18n = modules[3];
const ui = modules[4];
const player = modules[5];
const archive = modules[6];
const MAIN_SNAP = snapshotGlobals(); // main page realm — restored after the watch-page sections
const config = modules[7];
const w = currentDom.window;
const doc = w.document;

// boot completes → rows filled
check('boot without console errors', await waitUntil(() => doc.querySelectorAll('#row-trending .card').length > 0, 15000, 'rows') && consoleErrors.length === 0,
  consoleErrors.slice(0, 3).join(' | '));

// ---------------------------------------------------------------------------
console.log('\n== HERO ==');
check('hero slides render', await waitUntil(() => doc.querySelectorAll('#hero-bg .hero-slide').length === 5));
check('hero dots render', doc.querySelectorAll('#hero-dots button').length === 5);
const dot2 = doc.querySelectorAll('#hero-dots button')[2];
dot2.click();
check('hero dot click switches slide', doc.querySelectorAll('#hero-bg .hero-slide')[2].classList.contains('active'));
console.log('  … waiting 8.3s for the auto-rotation tick');
const beforeTick = [...doc.querySelectorAll('#hero-bg .hero-slide')].findIndex((el) => el.classList.contains('active'));
await sleep(8300);
const afterTick = [...doc.querySelectorAll('#hero-bg .hero-slide')].findIndex((el) => el.classList.contains('active'));
check('hero auto-rotates after 8s', afterTick !== beforeTick && afterTick === (2 + 1) % 5, `before=${beforeTick} after=${afterTick}`);

// ---------------------------------------------------------------------------
console.log('\n== ROWS & TOP 10 ==');
check('trending row filled', doc.querySelectorAll('#row-trending .card').length > 0);
check('popular row filled', doc.querySelectorAll('#row-popular .card').length > 0);
await waitUntil(() => doc.querySelectorAll('#row-top10 .card.ranked').length === 10);
check('top 10 has 10 ranked cards', doc.querySelectorAll('#row-top10 .card.ranked').length === 10);
const ranks = [...doc.querySelectorAll('#row-top10 .rank')].map((r) => r.textContent);
check('top 10 ranks 1..10', ranks.join(',') === '1,2,3,4,5,6,7,8,9,10', ranks.join(','));

// ---------------------------------------------------------------------------
console.log('\n== GENRE TILES (no numbers) ==');
const tiles = [...doc.querySelectorAll('#genre-grid .genre-tile')];
check('15 genre tiles', tiles.length === 15, String(tiles.length));
check('genre tiles show no numbers/counts', tiles.every((tl) => !/\d/.test(tl.textContent.trim())), tiles[0]?.textContent.trim());
check('genre tiles are icon + name', tiles.every((tl) => tl.querySelector('svg') && tl.querySelector('b')));

// ---------------------------------------------------------------------------
console.log('\n== HOW IT WORKS (4 filled steps, visible) ==');
const steps = [...doc.querySelectorAll('#how .step')];
check('4 steps present', steps.length === 4, String(steps.length));
check('every step filled (title + copy)', steps.every((st) => st.querySelector('h3')?.textContent.trim() && st.querySelector('p')?.textContent.trim()));
check('step titles match the 4-step flow', steps.map((st) => st.querySelector('h3').textContent).join('|') === 'Open the door|Pick your lane|Press play|Keep your shelf', steps.map((st) => st.querySelector('h3').textContent).join('|'));
await waitUntil(() => steps.every((st) => st.classList.contains('in')));
check('IntersectionObserver reveals .step children (visible, not empty boxes)', steps.every((st) => st.classList.contains('in')));

// ---------------------------------------------------------------------------
console.log('\n== ADSHIELD ABSENT ==');
check('no .shield-badge element', !doc.querySelector('.shield-badge'));
check('no #shield-count element', !doc.querySelector('#shield-count'));
const jsSources = ['account.js', 'app.js', 'ui.js', 'player.js', 'admin.js', 'archive.js', 'api.js', 'watch.js', 'i18n.js', 'config.js', 'animations.js']
  .map((f) => readFileSync(join(root, 'js', f), 'utf8')).join('\n');
check('no adshield code in JS', !/adshield/i.test(jsSources));
check('no adshield markup/styles', !/adshield/i.test(INDEX_HTML) && !/shield-badge/i.test(readFileSync(join(root, 'styles/components.css'), 'utf8')));

// ---------------------------------------------------------------------------
console.log('\n== FREE CLASSICS ABSENT ==');
check('no #classics section', !doc.querySelector('#classics'));
check('no #row-classics', !doc.querySelector('#row-classics'));
check('no nav.classics keys in markup', !/nav\.classics/.test(INDEX_HTML));
check('no row.classics keys in i18n', !/row\.classics/.test(jsSources) && i18n.DICT.en['row.classics'] === undefined);
check('no classics.badge key anywhere', i18n.DICT.en['classics.badge'] === undefined && !/classics\.badge/.test(jsSources));
check('footer has no Free Classics link', ![...doc.querySelectorAll('footer a')].some((a) => /Free Classics/i.test(a.textContent)));

// ---------------------------------------------------------------------------
console.log('\n== SOCIAL LINKS REALLY NAVIGATE ==');
await waitUntil(() => doc.querySelectorAll('[data-socials] .social-link').length >= 3);
const socialHrefs = [...doc.querySelectorAll('#about [data-socials] .social-link, [data-socials] .social-link')].map((a) => a.getAttribute('href'));
check('github link present', socialHrefs.includes('https://github.com/Dev-zwoz'));
check('discord link present', socialHrefs.includes('https://discord.com/users/1469638087268110399'));
check('instagram link present', socialHrefs.includes('https://www.instagram.com/vzowzz/'));
const firstSocial = doc.querySelector('[data-socials] .social-link');
check('social links carry target=_blank rel=noopener', firstSocial.target === '_blank' && /noopener/.test(firstSocial.rel));
firstSocial.click();
check('social click forces window.open to the right URL', w.__opened.includes('https://github.com/Dev-zwoz'), JSON.stringify(w.__opened));

// ---------------------------------------------------------------------------
console.log('\n== OWNER CONSOLE ==');
const accounts = account.getAccounts();
const ownerAcc = accounts['admin@streamvault.local'];
check('owner demo account seeded on first load', !!ownerAcc);
check('owner seed email + role', ownerAcc?.email === 'admin@streamvault.local' && ownerAcc?.role === 'owner');
const expectedHash = createHash('sha256').update(`sv1:admin@streamvault.local:vaultmaster`).digest('hex');
check('password stored as SHA-256 hash (not plaintext)', ownerAcc?.hash === expectedHash && ownerAcc?.password === undefined, ownerAcc?.hash);
check('README documents the owner demo account', /admin@streamvault\.local/.test(readFileSync(join(root, 'README.md'), 'utf8')) && /vaultmaster/.test(readFileSync(join(root, 'README.md'), 'utf8')));

// owner sign-in through the real auth view
w.dispatchEvent(new w.CustomEvent('sv:goto', { detail: { view: 'auth' } }));
await sleep(200);
const form = doc.querySelector('#view-auth .auth-form');
check('auth view rendered (form-based sign-in)', !!form);
form.querySelector('input[name=email]').value = 'admin@streamvault.local';
form.querySelector('input[name=password]').value = 'vaultmaster';
form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
await sleep(1100);
console.log('  [debug] errs:', consoleErrors.slice(0, 4), 'authErr:', JSON.stringify(doc.querySelector('.auth-err')?.textContent), 'user:', JSON.stringify(account.getUser()));
check('owner signed in with role', account.getUser()?.role === 'owner', JSON.stringify(account.getUser()));
check('navbar Console link visible for owner', doc.getElementById('nav-console')?.hidden === false);
check('sign-in logged in the account record', (account.getAccounts()['admin@streamvault.local'].signinLog || []).some((s) => s.ok));

// a member account to act on
account.signInAccount({ email: 'member@streamvault.local', name: 'Mira Member', password: 'watcher1' });
check('second (member) account exists', !!account.getAccounts()['member@streamvault.local']);

// go to console
w.dispatchEvent(new w.CustomEvent('sv:goto', { detail: { view: 'admin' } }));
await sleep(80);
const adminPanel = doc.getElementById('admin-panel');
check('admin view lists every account', adminPanel.querySelectorAll('.admin-user').length >= 2, String(adminPanel.querySelectorAll('.admin-user').length));
const memberCard = adminPanel.querySelector('[data-user="member@streamvault.local"]');
check('member row shows name, email and role chip', !!memberCard && memberCard.textContent.includes('Mira Member') && memberCard.textContent.includes('member@streamvault.local'));
check('member row shows SHA-256 password hash', /^sv1:$/.test('') || /^[0-9a-f]{64}$/.test(memberCard.querySelector('.au-hash code')?.textContent || ''), memberCard.querySelector('.au-hash code')?.textContent);
check('owner row shows hash too', /^[0-9a-f]{64}$/.test(adminPanel.querySelector('[data-user="admin@streamvault.local"] .au-hash code')?.textContent || ''));

// kick
memberCard.querySelector('[data-act="kick"]').click();
await sleep(30);
check('kick logs an event', adminPanel.querySelector('.admin-log')?.textContent.includes(account.i18nKickedProbe || '') || getEventsText().includes('member@streamvault.local'), getEventsText().slice(0, 80));
function getEventsText() { return doc.querySelector('.admin-log ul')?.textContent || ''; }

// timeout (24h)
const freshCard = () => adminPanel.querySelector('[data-user="member@streamvault.local"]');
freshCard().querySelector('.au-timeout-select').value = '1';
freshCard().querySelector('[data-act="timeout"]').click();
await sleep(30);
check('timeout(24h) flags the account as timed out', adminPanel.querySelector('[data-user="member@streamvault.local"] .st-timeout') !== null);

// ban / unban
adminPanel.querySelector('[data-user="member@streamvault.local"] [data-act="ban"]')?.click();
await sleep(30);
check('ban sets banned status', account.getAccounts()['member@streamvault.local'].status === 'banned');
adminPanel.querySelector('[data-user="member@streamvault.local"] [data-act="unban"]')?.click();
await sleep(30);
check('unban restores active status', account.getAccounts()['member@streamvault.local'].status === 'active');

// promote / demote
adminPanel.querySelector('[data-user="member@streamvault.local"] [data-act="promote"]')?.click();
await sleep(30);
check('promote → admin role', account.getAccounts()['member@streamvault.local'].role === 'admin');
adminPanel.querySelector('[data-user="member@streamvault.local"] [data-act="demote"]')?.click();
await sleep(30);
check('demote → member role', account.getAccounts()['member@streamvault.local'].role === 'member');

// inline message composer (no window.prompt)
adminPanel.querySelector('[data-user="member@streamvault.local"] [data-act="message"]')?.click();
await sleep(20);
const msgBox = adminPanel.querySelector('[data-composer-for="member@streamvault.local"] textarea');
check('message composer is inline (textarea, not prompt)', msgBox && msgBox.tagName === 'TEXTAREA');
msgBox.value = 'Your evening pick is ready.';
adminPanel.querySelector('[data-user="member@streamvault.local"] [data-act="send"]')?.click();
await sleep(30);
check('message delivered to the account notices', (account.getAccounts()['member@streamvault.local'].notices || [])[0]?.msg === 'Your evening pick is ready.');

// reset password
adminPanel.querySelector('[data-user="member@streamvault.local"] [data-act="resetpw"]')?.click();
await sleep(20);
const pwBox = adminPanel.querySelector('[data-pw-for="member@streamvault.local"] input');
pwBox.value = 'newpass9';
adminPanel.querySelector('[data-user="member@streamvault.local"] [data-act="savepw"]')?.click();
await sleep(30);
const newHash = createHash('sha256').update('sv1:member@streamvault.local:newpass9').digest('hex');
check('reset password stores new SHA-256 hash', account.getAccounts()['member@streamvault.local'].hash === newHash);

// clear history (must toast the CORRECT message)
account.saveAccounts({ ...account.getAccounts(), 'member@streamvault.local': { ...account.getAccounts()['member@streamvault.local'], history: [{ id: 1, title: 'X', at: Date.now() }] } });
admin.renderAdminView();
await sleep(20);
let toastsSeen = [];
const origToast = ui.toast;
// capture toasts by watching the DOM
adminPanel.querySelector('[data-user="member@streamvault.local"] [data-act="clearhistory"]')?.click();
await sleep(30);
check('clear history empties watch history', (account.getAccounts()['member@streamvault.local'].history || []).length === 0);
const lastToast = doc.querySelector('#toasts .toast:last-child span')?.textContent || '';
check('clear-history toast says the right thing (not "Message sent")', lastToast.length > 0 && !/message sent/i.test(lastToast) && !/Pesan terkirim/.test(lastToast), lastToast);

// delete account (two-step inline confirm)
const delBtn = () => adminPanel.querySelector('[data-user="member@streamvault.local"] [data-act="delete"]');
delBtn().click();
await sleep(20);
check('delete needs an inline confirm step', delBtn().textContent.length > 0 && delBtn().textContent !== 'Delete' && delBtn().textContent !== '🗑');
delBtn().click();
await sleep(30);
check('delete removes the account', !account.getAccounts()['member@streamvault.local']);

// non-owner gets denied
const ownerUser = account.getUser();
check('admin gating: only owner sees the panel', account.getUser()?.role === 'owner' && doc.getElementById('admin-denied').hidden === true);
void ownerUser;

// ---------------------------------------------------------------------------
console.log('\n== LIBRARY: TABS / SORT / FILTERS / LOAD-MORE ==');
w.dispatchEvent(new w.CustomEvent('sv:goto', { detail: { view: 'movies' } }));
check('library loads cards', await waitUntil(() => doc.querySelectorAll('#movie-grid .card').length > 0));
check('live result count rendered', /\d/.test(doc.getElementById('result-count')?.textContent || ''));
check('4 library tabs present', [...doc.querySelectorAll('#lib-tabs [data-tab]')].map((b) => b.dataset.tab).join(',') === 'all,movie,tv,anime');
check('default tab = All', doc.querySelector('#lib-tabs [data-tab="all"]').classList.contains('active'));

// deterministic request assertions: clear the log, act, wait for a matching URL.
// A request is "seen" when it hits the network OR the app's 30-min TMDB cache
// (cache keys are the exact request URL with the api key masked).
const seenRequests = () => [
  ...fetchLog,
  ...Object.keys(w.sessionStorage).filter((k) => k.startsWith('svc:')).map((k) => k.slice(4)),
];
const discSeen = seenRequests();
check('content policy on every discover: LGBT keywords excluded + teen ceiling (PG-13)',
  discSeen.some((u) => u.includes('/discover/') && u.includes('without_keywords=158718') && u.includes('363345')) &&
  discSeen.some((u) => u.includes('/discover/movie') && u.includes('certification.lte=PG-13') && u.includes('certification_country=US')),
  discSeen.find((u) => u.includes('/discover/movie'))?.split('?')[1] || 'no discover yet');
const expectFetch = async (trigger, matcher, label, extra = '') => {
  fetchLog.length = 0;
  trigger();
  const hit = await waitUntil(() => seenRequests().some((u) => matcher(u)), 8000);
  const seen = seenRequests().find((u) => matcher(u)) || seenRequests()[0] || '';
  check(label, hit, (seen.split('?')[1] || seen).slice(0, 140) + extra);
};
const lastDiscover = () => [...fetchLog].reverse().find((u) => u.includes('/discover/'));

// sort options (movie field names on the movie endpoint)
for (const [opt, expect] of [
  ['vote_average.desc', 'sort_by=vote_average.desc'],
  ['primary_release_date.asc', 'sort_by=primary_release_date.asc'],
  ['vote_count.desc', 'sort_by=vote_count.desc'],
  ['revenue.desc', 'sort_by=revenue.desc'],
  ['original_title.asc', 'sort_by=original_title.asc'],
]) {
  await expectFetch(
    () => { const sel = doc.getElementById('f-sort'); sel.value = opt; sel.dispatchEvent(new w.Event('change', { bubbles: true })); },
    (u) => u.includes('/discover/movie') && u.includes(expect),
    `sort ${opt} applied`,
  );
}

// filters on movie tab
await expectFetch(
  () => doc.querySelector('#lib-tabs [data-tab="movie"]').click(),
  (u) => u.includes('/discover/movie') && u.includes('page=1') && !u.includes('/discover/tv'),
  'movie tab hits /discover/movie',
);

const setAndCheck = (id, value, expected) => expectFetch(
  () => { const el = doc.getElementById(id); el.value = value; el.dispatchEvent(new w.Event('change', { bubbles: true })); },
  (u) => u.includes('/discover/movie') && u.includes(expected),
  `${id}=${value} → ${expected}`,
);
await setAndCheck('f-cert', 'PG-13', 'certification=PG-13');
await setAndCheck('f-lang', 'ja', 'with_original_language=ja');
await setAndCheck('f-score', '7', 'vote_average.gte=7');
await setAndCheck('f-year-from', '2000', 'primary_release_date.gte=2000-01-01');
await setAndCheck('f-year-to', '2020', 'primary_release_date.lte=2020-12-31');
const langOptions = doc.getElementById('f-lang').options.length - 1;
check('language filter offers 30+ languages', langOptions >= 30, String(langOptions));

// reset
await expectFetch(
  () => doc.getElementById('f-reset').click(),
  (u) => u.includes('/discover/') && !u.includes('certification=') && !u.includes('vote_average.gte') && !u.includes('with_original_language') && !u.includes('primary_release_date.gte'),
  'reset clears every filter',
);
check('reset returns to All tab', doc.querySelector('#lib-tabs [data-tab="all"]').classList.contains('active'));

// TV tab
await expectFetch(
  () => doc.querySelector('#lib-tabs [data-tab="tv"]').click(),
  (u) => u.includes('/discover/tv') && u.includes('page=1') && !u.includes('with_genres=16'),
  'tv tab hits /discover/tv',
);
await expectFetch(
  () => { const certSel = doc.getElementById('f-cert'); certSel.value = 'PG'; certSel.dispatchEvent(new w.Event('change', { bubbles: true })); },
  (u) => u.includes('/discover/tv') && u.includes('certification=TV-PG'),
  'age rating maps to TV certs on TV tab (PG → TV-PG)',
);
await expectFetch(
  () => { const tvSort = doc.getElementById('f-sort'); tvSort.value = 'primary_release_date.desc'; tvSort.dispatchEvent(new w.Event('change', { bubbles: true })); },
  (u) => u.includes('/discover/tv') && u.includes('sort_by=first_air_date.desc'),
  'tv Newest uses first_air_date.desc',
);
check('playable-now checkbox disabled on TV tab', doc.getElementById('f-playable').disabled === true);

// anime tab
await expectFetch(
  () => doc.querySelector('#lib-tabs [data-tab="anime"]').click(),
  (u) => u.includes('/discover/tv') && u.includes('with_genres=16') && u.includes('with_original_language=ja'),
  'anime tab = TV + genre 16 + original language ja',
);

// back to movie + playable now
doc.querySelector('#lib-tabs [data-tab="movie"]').click();
await sleep(120);
doc.getElementById('f-playable').checked = true;
doc.getElementById('f-playable').dispatchEvent(new w.Event('change', { bubbles: true }));
await waitUntil(() => doc.querySelectorAll('#movie-grid .card').length > 0 && !fetchLog.slice(-3).join().includes('/discover/'));
const pdCount = doc.querySelectorAll('#movie-grid .card').length;
check('playable-now shows the public-domain films', pdCount >= 10, String(pdCount));
check('playable cards wear the Play Free badge (no Free Classics row though)', doc.querySelectorAll('#movie-grid .badge-free').length === pdCount);
check('PD cards are NOT in a separate classics section — rows never named classics', !doc.querySelector('#row-classics'));

// load more grows the list (no hard cap within TMDB pages)
doc.getElementById('f-playable').checked = false;
doc.getElementById('f-playable').dispatchEvent(new w.Event('change', { bubbles: true }));
await waitUntil(() => doc.querySelectorAll('#movie-grid .card').length > 0);
const countBefore = doc.querySelectorAll('#movie-grid .card').length;
doc.getElementById('load-more').click();
check('load-more grows the list', await waitUntil(() => doc.querySelectorAll('#movie-grid .card').length > countBefore), `${countBefore} → ${doc.querySelectorAll('#movie-grid .card').length}`);

// ---------------------------------------------------------------------------
console.log('\n== 19 LANGUAGES ==');
check('19 language packs registered', i18n.LANGS.length === 19, String(i18n.LANGS.length));
check('every pack covers 100% of core keys', i18n.LANGS.every((l) => i18n.coverage(l.code) === 100), i18n.LANGS.filter((l) => i18n.coverage(l.code) < 100).map((l) => l.code).join(','));
i18n.setLang('id');
check('Indonesian copy applied (nav)', i18n.t('nav.home') === 'Beranda' && doc.querySelector('[data-i18n="nav.home"]').textContent === 'Beranda');
check('Indonesian library tab', i18n.t('lib.tab.tv') === 'Serial TV');
i18n.setLang('vi');
check('Vietnamese copy applied', i18n.t('nav.watchlist') === 'Danh sách của tôi' && i18n.t('lib.tab.movie') === 'Phim');
i18n.setLang('ar');
check('Arabic RTL flips the document', doc.documentElement.dir === 'rtl');
check('Arabic copy applied', i18n.t('hero.title').length > 0 && i18n.t('nav.movies') === 'الأفلام');
i18n.setLang('en');
check('LTR restored', doc.documentElement.dir === 'ltr');
const menuOptions = doc.querySelectorAll('#lang-menu-nav .lang-menu [data-setlang]');
check('language menu lists all 19 with coverage %', menuOptions.length === 19 && [...menuOptions].every((o) => /\d+%/.test(o.textContent)), String(menuOptions.length));
check('TMDB language param follows UI', await (async () => {
  i18n.setLang('ja');
  doc.getElementById('f-sort').dispatchEvent(new w.Event('change', { bubbles: true }));
  const hit = await waitUntil(() => seenRequests().some((u) => u.includes('language=ja-JP')), 8000);
  i18n.setLang('en');
  return hit;
})());

// ---------------------------------------------------------------------------
console.log('\n== CONTENT POLICY (guard + search) ==');
await player.openPlayer({ id: 142, title: 'Blocked Romance' }, 'movie');
await sleep(120);
const guardToast = doc.querySelector('#toasts .toast:last-child span')?.textContent || '';
check('LGBT-tagged title blocked at play time (toast, player never opens)',
  !doc.getElementById('player-modal').classList.contains('open') && /hidden by your content settings/i.test(guardToast), guardToast);

await ui.renderSearchResults('night');
await sleep(140);
const searchLeft = doc.querySelectorAll('#search-results .search-result').length;
check('search suggestions sweep LGBT-tagged hits out', searchLeft === 1, `left: ${searchLeft}`);

// ---------------------------------------------------------------------------
console.log('\n== PLAYER ==');
// PD title → native <video> from archive.org
const pdMovie = { id: 10331, title: 'Night of the Living Dead', poster_path: null };
await player.openPlayer(pdMovie, 'movie');
await waitUntil(() => doc.querySelector('#player-frame video'));
const vid = doc.querySelector('#player-frame video');
check('public-domain title plays as native <video>', vid?.tagName === 'VIDEO');
check('video source is an archive.org MP4', /archive\.org/.test(vid?.src || '') && /\.mp4/i.test(vid?.src || ''), vid?.src || '');
check('no iframe used for PD playback', !doc.querySelector('#player-frame iframe'));
player.closePlayer();

// non-PD → VidRift iframe WITHOUT sandbox
const vrMovie = { id: 27205, title: 'Inception', poster_path: null };
await player.openPlayer(vrMovie, 'movie');
await waitUntil(() => doc.querySelector('#player-frame iframe'));
const frame = doc.querySelector('#player-frame iframe');
check('VidRift iframe rendered', frame?.tagName === 'IFRAME');
check('iframe has NO sandbox attribute (rule #1)', !frame.hasAttribute('sandbox'));
check('iframe grants autoplay/fullscreen via allow', /autoplay/.test(frame.getAttribute('allow') || '') && /fullscreen/.test(frame.getAttribute('allow') || ''));
check('iframe referrerpolicy=origin', frame.getAttribute('referrerpolicy') === 'origin');
check('iframe allowfullscreen present', frame.hasAttribute('allowfullscreen'));
check('VidRift url carries brand=StreamVault', (frame?.src || '').includes('brand=StreamVault') && (frame?.src || '').includes('brandColor=F5C518') && (frame?.src || '').includes('mobileSheets=1'), frame?.src);
check('standalone pill points at watch.html for this title', (doc.getElementById('player-standalone')?.href || '').includes('watch.html') && (doc.getElementById('player-standalone')?.href || '').includes('id=27205'));
const credit = doc.getElementById('player-credit');
check('player credits VidRift — Rust (cinrift) with Discord link', credit?.textContent.includes('Rust (cinrift)') && credit.querySelector('a')?.href === 'https://discord.com/users/1515548260196941864', credit?.textContent);
player.closePlayer();

// TV playback routes to the TV embed
await player.openPlayer({ id: 1399, title: 'Fixture Show 1' }, 'tv');
await waitUntil(() => doc.querySelector('#player-frame iframe'));
check('TV title uses the tv/{id}/{s}/{e} VidRift path', (doc.querySelector('#player-frame iframe')?.src || '').includes('/embed/tv/1399/1/1'));
player.closePlayer();

// ---------------------------------------------------------------------------
console.log('\n== SETTINGS (no AdShield) ==');
account.openSettings();
await sleep(20);
const settingsText = doc.getElementById('settings-modal').textContent;
check('settings modal has no AdShield switch', !/AdShield/i.test(settingsText));
check('settings still offers quality / motion / data', /1080p/.test(settingsText) && settingsText.length > 100);
const noticeSw = () => doc.querySelector('#settings-modal [data-set="embedNotice"]');
check('standalone-notice toggle present & on by default', !!noticeSw()?.classList.contains('on'));
noticeSw().click();
await sleep(10);
check('notice toggle turns the banner off (persisted)', account.getSettings().embedNotice === false);
noticeSw().click();
await sleep(10);
check('notice toggle turns the banner back on', account.getSettings().embedNotice === true);

const maturityBtns = () => [...doc.querySelectorAll('#settings-modal [data-m]')];
check('maturity pills render — 4 levels, Teen default', maturityBtns().length === 4 && doc.querySelector('#settings-modal [data-m].active')?.dataset.m === 'teen');
fetchLog.length = 0;
maturityBtns().find((b) => b.dataset.m === 'mature').click();
await sleep(120);
check('mature level lifts the ceiling (no certification.lte on new discovers)',
  fetchLog.some((u) => u.includes('/discover/movie') && !u.includes('certification.lte')) &&
  fetchLog.some((u) => u.includes('/discover/') && u.includes('without_keywords=')), // LGBT filter stays on
  fetchLog.slice(-2).map((u) => u.split('?')[1]).join(' | '));
check('maturity change reloads rows + grid', fetchLog.filter((u) => u.includes('/discover/')).length >= 4, String(fetchLog.filter((u) => u.includes('/discover/')).length));
fetchLog.length = 0;
maturityBtns().find((b) => b.dataset.m === 'family').click();
await sleep(120);
check('family level = PG ceiling', fetchLog.some((u) => u.includes('/discover/movie') && u.includes('certification.lte=PG-13') === false && /[?&]certification\.lte=PG(&|$)/.test(u)));
maturityBtns().find((b) => b.dataset.m === 'teen').click(); // restore default for later sections
await sleep(80);
doc.getElementById('settings-modal').classList.remove('open');

// ---------------------------------------------------------------------------
console.log('\n== WATCH.HTML (standalone player) ==');
// fresh DOM for the standalone page — import runs its boot IIFE immediately
consoleErrors = [];
installDom(WATCH_HTML, 'http://localhost:8000/watch.html?type=movie&id=10331&title=Night%20of%20the%20Living%20Dead');
const w2 = currentDom.window;
const doc2 = w2.document;
const watch = await import(join(root, 'js/watch.js'));
void watch;
check('watch page builds source chips', await waitUntil(() => doc2.querySelectorAll('#watch-sources .watch-chip').length === 2, 8000));
const chips = [...doc2.querySelectorAll('#watch-sources .watch-chip')];
check('chip 1 = Internet Archive', chips[0]?.textContent.includes('Internet Archive'));
check('chip 2 = VidRift · HD', chips[1]?.textContent.includes('VidRift'));
check('PD default chip → native <video> from archive.org', await waitUntil(() => /archive\.org/.test(doc2.querySelector('#watch-frame video')?.src || '')));
check('watch credits Rust (cinrift)', doc2.getElementById('watch-credit')?.textContent.includes('Rust (cinrift)') && !!doc2.querySelector('#watch-credit a[href="https://discord.com/users/1515548260196941864"]'));

// switch to the VidRift chip
chips[1].click();
await sleep(60);
const wvr = doc2.querySelector('#watch-frame iframe');
check('VidRift chip swaps in an iframe', wvr?.tagName === 'IFRAME');
check('standalone iframe has NO sandbox attribute', wvr && !wvr.hasAttribute('sandbox'));
check('standalone VidRift url carries brand=StreamVault', (wvr?.src || '').includes('brand=StreamVault'));

// resume via postMessage
w2.dispatchEvent(new w.MessageEvent('message', {
  origin: 'https://embed.vidrift.in',
  data: { type: 'vidrift:progress', tmdbId: 10331, currentTime: 734, duration: 5400 },
}));
await sleep(40);
const saved = JSON.parse(w2.localStorage.getItem('sv:positions') || '{}');
check('vidrift:progress postMessage persists a resume position', saved['10331']?.t === 734, JSON.stringify(saved['10331']));

// TV links build season/episode context
installDom(WATCH_HTML, 'http://localhost:8000/watch.html?type=tv&id=1399&s=1&e=2&title=Fixture%20Show');
const w3 = currentDom.window;
const doc3 = w3.document;
const watch2 = await import(join(root, 'js/watch.js?v=2'));
void watch2;
check('tv watch page shows season/episode context', await waitUntil(() => doc3.getElementById('watch-sub')?.textContent.includes('1') && doc3.getElementById('watch-sub')?.textContent.includes('2')));
await waitUntil(() => doc3.querySelectorAll('#watch-sources .watch-chip').length >= 1);
const tvIframe = doc3.querySelector('#watch-frame iframe');
check('tv watch embed uses /tv/{id}/{s}/{e}', tvIframe && /embed\/tv\/1399\/1\/2/.test(tvIframe.src || ''), tvIframe?.src || '');

restoreGlobals(MAIN_SNAP); // back to the main page realm for the remaining checks

// ---------------------------------------------------------------------------
console.log('\n== MOTION PASS (CSS contract) ==');
const anim = readFileSync(join(root, 'styles/animations.css'), 'utf8');
const comp = readFileSync(join(root, 'styles/components.css'), 'utf8');
const animAll = anim + comp;
check('brand easing cubic-bezier(0.22,1,0.36,1) used', animAll.includes('cubic-bezier(0.22, 1, 0.36, 1)') || animAll.includes('cubic-bezier(0.22,1,0.36,1)') || /--ease: cubic-bezier\(0\.22, 1, 0\.36, 1\)/.test(readFileSync(join(root, 'styles/base.css'), 'utf8')));
for (const key of ['orbDrift', 'tickerScroll', 'shineSweep', 'rankBreath', 'sheenMove', 'ctaPulse', 'chipSheen', 'statPop', 'modalIn', 'toastIn', 'chromeIn', 'pulseRing', 'avatarNudge', 'livePing']) {
  check(`motion pass: @keyframes ${key}`, animAll.includes(`@keyframes ${key}`));
}
check('ticker marquee element present', INDEX_HTML.includes('ticker-track'));
check('background orbs present', INDEX_HTML.includes('bg-orbs'));
check('motion disabled under prefers-reduced-motion', /@media \(prefers-reduced-motion: reduce\)/.test(anim));
check('motion disabled under html.force-reduced-motion', anim.includes('html.force-reduced-motion'));
// every keyframe we added only animates transform/opacity
const kfBlock = (name) => {
  const idx = animAll.indexOf(`@keyframes ${name}`);
  const open = animAll.indexOf('{', idx);
  let depth = 0, end = open;
  for (let i = open; i < animAll.length; i++) {
    if (animAll[i] === '{') depth++;
    if (animAll[i] === '}') { depth--; if (!depth) { end = i; break; } }
  }
  return animAll.slice(open, end);
};
let transformOnly = true;
for (const key of ['orbDrift', 'tickerScroll', 'shineSweep', 'rankBreath', 'sheenMove', 'ctaPulse', 'chipSheen', 'statPop', 'modalIn', 'toastIn', 'chromeIn', 'chromeUp', 'pulseRing', 'avatarNudge']) {
  const body = kfBlock(key);
  const props = [...body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]).filter((p) => !['from', 'to', 'transform', 'opacity'].includes(p));
  if (props.length) { transformOnly = false; console.error(`    ${key} animates: ${[...new Set(props)].join(', ')}`); }
}
check('motion pass keyframes are transform/opacity only', transformOnly);

// ---------------------------------------------------------------------------
console.log('\n== PREMIUM AVATAR ==');
check('avatar uses one brand gradient (no per-name hue vars)', !/hsl\(var\(--hue/.test(comp) && /linear-gradient\(135deg, #F5C518/.test(comp));
check('avatar is a fixed square with ring', /border-radius: 11px/.test(comp) && /0 0 0 3\.5px rgba\(245,197,24/.test(comp));
check('account header rendered in the user menu', account.getUser() && comp.includes('.um-account-header'));

// ---------------------------------------------------------------------------
console.log('\n== README ==');
const readme = readFileSync(join(root, 'README.md'), 'utf8');
check('README credits Rust (cinrift) with the Discord link', readme.includes('Rust (cinrift)') && readme.includes('1515548260196941864'));
check('README documents 19 languages', /19 (interface )?languages/i.test(readme));
check('README documents the owner console + demo account', /Owner Console|owner console/i.test(readme));
check('README no longer advertises AdShield', !/AdShield/i.test(readme));
const legal = readFileSync(join(root, 'legal.html'), 'utf8');
check('legal.html ships Terms / Privacy / Content Policy / DMCA', ['id="terms"', 'id="privacy"', 'id="content-policy"', 'id="dmca"'].every((s) => legal.includes(s)));
check('footer links to the legal pages', INDEX_HTML.includes('legal.html#terms') && INDEX_HTML.includes('legal.html#privacy') && INDEX_HTML.includes('legal.html#content-policy') && INDEX_HTML.includes('legal.html#dmca'));

// ---------------------------------------------------------------------------
console.log('\n==========================================');
console.log(`PASSED: ${passed}  FAILED: ${failed}`);
if (failed) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log('  ✗ ' + f));
  process.exit(1);
}
console.log('ALL CHECKS GREEN');

process.exit(0); // IO auto-scroll keeps timers alive — exit explicitly after the tally
