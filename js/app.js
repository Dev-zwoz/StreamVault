/* ============================================================================
   StreamVault — app.js
   Boot sequence, views (home / library / watchlist / auth / account / admin),
   hero rotation, rows, the unlimited filterable library, search, language
   switching and the newsletter.
   ============================================================================ */

import { IMG, GENRES, SEARCH_DEBOUNCE, SORTS, CERTIFICATIONS, LIB_LANGS } from './config.js';
import { t, getLang, setLang, applyI18n, GENRE_NAMES, LANGS, langMeta, langCoverage } from './i18n.js';
import {
  verifyKey, apiState, getTrending, getPopular, getTopRated, getNowPlaying,
  getUpcoming, getKorean, getJapanese, getIndonesian, getHollywood, getFamily,
  getAnime, getTrendingAll, discover, discoverTV, getTvPopular, getTvOnAir,
  getMoviesByIds, getMedia, getFallback, validateEmail, isAnimeItem,
} from './api.js';
import { loadPdMap, pdIds } from './archive.js';
import {
  skeletonRow, fillRow, movieCard, renderGenreGrid, renderFeatures, renderFaq,
  renderSocials, renderSearchResults, getWatchlist, observeChildren, initCarousel,
  toast,
} from './ui.js';
import { openPlayer, closePlayer } from './player.js';
import {
  initPreloader, initNavbar, initReveals, splitHeroTitle, initHeroMotion,
  initRipples, initCursorGlow, initDiscordPill, initMarquee, initSectionParallax, withViewTransition,
} from './animations.js';
import {
  applyMotionSetting, applyAccent, getSettings, renderUserArea, renderAuthView,
  renderAccountView, openSettings, seedOwner, enforceSession, getUser, isAdmin,
} from './account.js';
import { renderAdminView } from './admin.js';

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------
let currentView = 'home';

function showView(name) {
  if (name === currentView) { scrollTo({ top: 0, behavior: 'smooth' }); return; }
  withViewTransition(() => {
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    const el = document.getElementById(`view-${name}`);
    if (!el) return;
    el.classList.add('active');
    currentView = name;
    document.querySelectorAll('.nav-links a').forEach((a) =>
      a.classList.toggle('active', a.dataset.view === name));
    scrollTo({ top: 0 });
    if (name === 'watchlist') renderWatchlist();
    if (name === 'movies') { ensureLib(); loadGrid(true); }
    if (name === 'auth') { renderAuthView(); renderSocials(); }
    if (name === 'account') renderAccountView();
    if (name === 'admin') renderAdminView();
  });
}

window.addEventListener('sv:goto', (e) => showView(e.detail.view));

document.addEventListener('click', (e) => {
  const settingsEl = e.target.closest('[data-open-settings]');
  if (settingsEl) { e.preventDefault(); openSettings(); return; }
  const libEl = e.target.closest('[data-lib]');
  if (libEl) {
    e.preventDefault();
    libState.tab = libEl.dataset.lib;
    showView('movies');
    ensureLib();
    loadGrid(true);
    return;
  }
  const gotoEl = e.target.closest('[data-goto]');
  if (gotoEl) { e.preventDefault(); showView(gotoEl.dataset.goto); return; }
  const viewEl = e.target.closest('[data-view]');
  if (viewEl) { e.preventDefault(); showView(viewEl.dataset.view); return; }
  const scrollEl = e.target.closest('[data-scroll]');
  if (scrollEl) {
    e.preventDefault();
    const go = () => document.querySelector(scrollEl.dataset.scroll)?.scrollIntoView({ behavior: 'smooth' });
    if (currentView !== 'home') { showView('home'); setTimeout(go, 80); } else go();
  }
});

// ---------------------------------------------------------------------------
// Hero rotation — top 5 trending, 8s crossfade
// ---------------------------------------------------------------------------
let heroMovies = [], heroIdx = 0, heroTimer = null;

function renderHeroSlide(i) {
  const bg = document.getElementById('hero-bg');
  const dots = document.getElementById('hero-dots');
  heroIdx = i;
  [...bg.children].forEach((el, j) => el.classList.toggle('active', j === i));
  [...dots.children].forEach((el, j) => el.classList.toggle('active', j === i));
  const m = heroMovies[i];
  const meta = document.getElementById('hero-movie-title');
  if (m && meta) meta.textContent = `${m.title} (${(m.release_date || '').slice(0, 4)})`;
}

function startHeroRotation() {
  clearInterval(heroTimer);
  if (!getSettings().heroRotate || !heroMovies.length) return;
  heroTimer = setInterval(() => renderHeroSlide((heroIdx + 1) % heroMovies.length), 8000);
}
window.addEventListener('sv:settings', startHeroRotation);

async function initHero() {
  splitHeroTitle(t('hero.title'));
  const data = await getTrendingAll();
  heroMovies = (data.results || []).filter((m) => m.backdrop_path && m.media_type !== 'tv').slice(0, 5);
  if (!heroMovies.length) {
    const fb = await getTrending();
    heroMovies = (fb.results || []).filter((m) => m.backdrop_path).slice(0, 5);
  }
  const bg = document.getElementById('hero-bg');
  const dots = document.getElementById('hero-dots');
  bg.innerHTML = ''; dots.innerHTML = '';

  document.getElementById('hero-watch').onclick = async () => {
    const m = heroMovies[heroIdx];
    if (m) { openPlayer(m, { type: 'movie' }); return; }
    const fb = await getFallback();
    const classic = fb.results.find((x) => pdIds().includes(x.id));
    if (classic) openPlayer(classic, { type: 'movie' });
  };

  heroMovies.forEach((m, i) => {
    const slide = document.createElement('div');
    slide.className = 'hero-slide';
    slide.style.backgroundImage = `url('${IMG.backdropFull + m.backdrop_path}')`;
    bg.appendChild(slide);
    const dot = document.createElement('button');
    dot.setAttribute('role', 'tab');
    dot.setAttribute('aria-label', `Show ${m.title}`);
    dot.addEventListener('click', () => { renderHeroSlide(i); startHeroRotation(); });
    dots.appendChild(dot);
  });
  renderHeroSlide(0);
  startHeroRotation();

  // marquee ticker under the hero
  const ticker = document.getElementById('ticker-track');
  if (ticker) {
    const titles = (data.results || []).slice(0, 14).map((m) => m.title).filter(Boolean);
    initMarquee(ticker, titles.map((x) => `<span class="tick"><i>★</i>${x}</span>`).join(''));
  }
}

// ---------------------------------------------------------------------------
// Home rows
// ---------------------------------------------------------------------------
const ROWS = [
  ['row-trending', () => getTrendingAll()],
  ['row-popular', getPopular],
  ['row-anime', () => getAnime()],
  ['row-top', getTopRated],
  ['row-tv', getTvPopular],
  ['row-now', getNowPlaying],
  ['row-upcoming', getUpcoming],
  ['row-korean', getKorean],
  ['row-japanese', getJapanese],
  ['row-indo', getIndonesian],
  ['row-hollywood', getHollywood],
  ['row-family', getFamily],
  ['row-onair', getTvOnAir],
];

async function loadRows() {
  ROWS.forEach(([id]) => skeletonRow(document.getElementById(id)));
  skeletonRow(document.getElementById('row-top10'));
  skeletonRow(document.getElementById('row-continue'));

  getTrendingAll().then((data) => {
    const el = document.getElementById('row-top10');
    if (!el) return;
    el.innerHTML = '';
    (data.results || []).filter((m) => m.media_type !== 'person').slice(0, 10).forEach((m, i) => {
      const card = movieCard(m, { revealChild: true, rank: i + 1 });
      card.style.setProperty('--reveal-delay', `${i * 70}ms`);
      el.appendChild(card);
    });
    initCarousel(el.closest('.carousel-wrap'));
    observeChildren(el);
  }).catch(() => { const el = document.getElementById('row-top10'); if (el) el.innerHTML = ''; });

  renderContinueRow();

  for (const [id, fn] of ROWS) {
    fn().then((data) => {
      const el = document.getElementById(id);
      if (el) fillRow(el, (data.results || []).filter((m) => m.media_type !== 'person').slice(0, 20), { revealChild: true });
    }).catch(() => { const el = document.getElementById(id); if (el) el.innerHTML = ''; });
  }
}

/** Continue-watching row, built from locally stored resume positions */
function renderContinueRow() {
  const wrap = document.getElementById('continue-section');
  const el = document.getElementById('row-continue');
  if (!el) return;
  let positions = {};
  try { positions = JSON.parse(localStorage.getItem('sv:positions')) || {}; } catch { /* noop */ }
  const entries = Object.entries(positions)
    .filter(([, p]) => p.t > 20 && (!p.d || p.t < p.d - 30))
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, 14);

  if (!entries.length) { if (wrap) wrap.hidden = true; return; }
  if (wrap) wrap.hidden = false;
  el.innerHTML = '';
  entries.forEach(([, p]) => {
    const card = movieCard(
      { id: p.id, title: p.title, poster_path: p.poster, media_type: p.type || 'movie' },
      { revealChild: true, progress: p.d ? (p.t / p.d) * 100 : 0 },
    );
    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-act]')) return;
      resume(p.id, p.type || 'movie');
    });
    el.appendChild(card);
  });
  initCarousel(el.closest('.carousel-wrap'));
  observeChildren(el);
}

async function resume(id, type) {
  try {
    const media = await getMedia(type, id);
    openPlayer(media, { type });
  } catch { toast(t('badge.offline')); }
}
window.addEventListener('sv:resume', (e) => resume(Number(e.detail.id), e.detail.type));

// ---------------------------------------------------------------------------
// Library (Movies / TV / Anime / All) — unlimited, filterable, infinite scroll
// ---------------------------------------------------------------------------
const libState = { tab: 'all', page: 1, totalPages: 1, busy: false, count: 0 };

const $ = (id) => document.getElementById(id);

function ensureLib() {
  const tabs = document.querySelectorAll('#lib-tabs button');
  tabs.forEach((b) => b.classList.toggle('active', b.dataset.lib === libState.tab));
  const isMovie = libState.tab === 'movie';
  const playableWrap = $('f-playable-wrap');
  if (playableWrap) playableWrap.hidden = !isMovie && libState.tab !== 'all';
  $('f-cert')?.closest('label')?.toggleAttribute('hidden', !isMovie);
  fillSort();
}

function fillSort() {
  const sel = $('f-sort');
  if (!sel) return;
  const list = libState.tab === 'tv' || libState.tab === 'anime' ? SORTS.tv : SORTS.movie;
  const prev = sel.value;
  sel.innerHTML = `<option value="">${t('movies.filter.sort')}</option>` +
    list.map((s) => `<option value="${s.value}">${t(`movies.sort.${s.key}`)}</option>`).join('');
  sel.value = list.some((s) => s.value === prev) ? prev : '';
}

function fillGenreSelect() {
  const sel = $('f-genre');
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = `<option value="">${t('movies.filter.genre')}</option>` +
    GENRES.map((g) => `<option value="${g.id}">${(GENRE_NAMES[getLang()] || GENRE_NAMES.en)[g.key] || GENRE_NAMES.en[g.key]}</option>`).join('');
  sel.value = prev;
}

function fillStaticFilters() {
  const cert = $('f-cert');
  if (cert) {
    cert.innerHTML = `<option value="">${t('movies.filter.cert')}</option>` +
      CERTIFICATIONS.map((c) => `<option value="${c}">${c}</option>`).join('');
  }
  const lang = $('f-lang');
  if (lang) {
    lang.innerHTML = `<option value="">${t('movies.filter.lang')}</option>` +
      LIB_LANGS.map((code) => `<option value="${code}">${languageName(code)}</option>`).join('');
  }
  const score = $('f-score');
  if (score) {
    score.innerHTML = `<option value="">${t('movies.filter.minRating')}</option>` +
      [9, 8, 7, 6, 5].map((n) => `<option value="${n}">${n}+ ★</option>`).join('');
  }
}

function languageName(code) {
  try {
    const name = new Intl.DisplayNames([getLang()], { type: 'language' }).of(code);
    return name ? name[0].toUpperCase() + name.slice(1) : code;
  } catch { return code; }
}

function gridParams() {
  const p = {};
  const sort = $('f-sort')?.value;
  const isTV = libState.tab === 'tv' || libState.tab === 'anime';
  if (sort) p.sort_by = sort;
  else p.sort_by = 'popularity.desc';

  const genre = $('f-genre')?.value;
  const lang = $('f-lang')?.value;
  const score = $('f-score')?.value;
  const cert = $('f-cert')?.value;
  const yFrom = $('f-year-from')?.value;
  const yTo = $('f-year-to')?.value;

  if (genre) p.with_genres = genre;
  if (lang) p.with_original_language = lang;
  if (score) p['vote_average.gte'] = score;
  if (yFrom) p[isTV ? 'first_air_date.gte' : 'primary_release_date.gte'] = `${yFrom}-01-01`;
  if (yTo) p[isTV ? 'first_air_date.lte' : 'primary_release_date.lte'] = `${yTo}-12-31`;
  if (cert && !isTV) { p.certification = cert; p.certification_country = 'US'; }
  if (sort === 'vote_average.desc') p['vote_count.gte'] = 200;
  return p;
}

/** Client-side filtering for the mixed "All" feed */
function filterMixed(items) {
  const genre = Number($('f-genre')?.value || 0);
  const lang = $('f-lang')?.value;
  const score = Number($('f-score')?.value || 0);
  const yFrom = Number($('f-year-from')?.value || 0);
  const yTo = Number($('f-year-to')?.value || 0);
  let out = items.filter((m) => m.media_type !== 'person');
  if (genre) out = out.filter((m) => (m.genre_ids || []).includes(genre));
  if (lang) out = out.filter((m) => m.original_language === lang);
  if (score) out = out.filter((m) => (m.vote_average || 0) >= score);
  if (yFrom) out = out.filter((m) => Number((m.release_date || '').slice(0, 4)) >= yFrom);
  if (yTo) out = out.filter((m) => Number((m.release_date || '').slice(0, 4)) <= yTo);
  const sort = $('f-sort')?.value;
  if (sort === 'vote_average.desc') out = out.sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0));
  if (sort === 'primary_release_date.desc' || sort === 'first_air_date.desc') out = out.sort((a, b) => (b.release_date || '').localeCompare(a.release_date || ''));
  if (sort === 'primary_release_date.asc' || sort === 'first_air_date.asc') out = out.sort((a, b) => (a.release_date || '').localeCompare(b.release_date || ''));
  if (sort === 'original_title.asc' || sort === 'name.asc') out = out.sort((a, b) => String(a.title).localeCompare(String(b.title)));
  return out;
}

async function loadGrid(reset = false) {
  if (libState.busy) return;
  libState.busy = true;
  const grid = $('movie-grid');
  const moreBtn = $('load-more');
  const status = $('grid-status');

  if (reset) {
    libState.page = 1;
    grid.innerHTML = '';
    for (let i = 0; i < 12; i++) {
      const sk = document.createElement('div');
      sk.className = 'sk-grid-item';
      sk.innerHTML = '<div class="sk sk-poster"></div><div class="sk sk-line"></div>';
      grid.appendChild(sk);
    }
  }

  const playableOnly = libState.tab === 'movie' && $('f-playable')?.checked;
  let results = [], totalPages = 1;

  try {
    if (playableOnly) {
      const ids = pdIds();
      if (apiState.online && apiState.keyValid) results = await getMoviesByIds(ids);
      else { const fb = await getFallback(); results = fb.results.filter((m) => ids.includes(m.id)); }
      const genre = Number($('f-genre')?.value || 0);
      if (genre) results = results.filter((m) => (m.genre_ids || []).includes(genre));
      totalPages = 1;
    } else if (libState.tab === 'anime') {
      const data = await getAnime({ ...gridParams(), page: libState.page });
      results = data.results || [];
      totalPages = Math.min(data.total_pages || 1, 500);
    } else if (libState.tab === 'tv') {
      const data = await discoverTV({ include_adult: false, ...gridParams(), page: libState.page });
      results = data.results || [];
      totalPages = Math.min(data.total_pages || 1, 500);
    } else if (libState.tab === 'movie') {
      const data = await discover({ include_adult: false, ...gridParams(), page: libState.page });
      results = data.results || [];
      totalPages = Math.min(data.total_pages || 1, 500);
    } else {
      const data = await getTrendingAll(libState.page);
      results = filterMixed(data.results || []);
      totalPages = Math.min(data.total_pages || 1, 500);
    }
  } catch { results = []; }

  grid.querySelectorAll('.sk-grid-item').forEach((el) => el.remove());
  if (reset) grid.innerHTML = '';

  if (reset && !results.length) {
    grid.innerHTML = `<p class="muted" style="grid-column:1/-1;padding:30px 0">${t('lib.empty')}</p>`;
  }
  results.forEach((m, i) => {
    const card = movieCard(m, { revealChild: true });
    card.style.setProperty('--reveal-delay', `${Math.min(i, 11) * 45}ms`);
    grid.appendChild(card);
  });
  observeChildren(grid);

  libState.count = reset ? results.length : libState.count + results.length;
  libState.totalPages = totalPages;
  if (status) {
    status.textContent = libState.page >= totalPages
      ? `${libState.count} ${t('lib.showing')} · ${t('lib.end')}`
      : `${libState.count} ${t('lib.showing')}`;
  }
  moreBtn.style.display = libState.page >= totalPages ? 'none' : '';
  libState.busy = false;
}

function initGridControls() {
  fillSort(); fillGenreSelect(); fillStaticFilters();

  document.querySelectorAll('#lib-tabs button').forEach((b) =>
    b.addEventListener('click', () => {
      libState.tab = b.dataset.lib;
      ensureLib();
      loadGrid(true);
    }));

  ['f-sort', 'f-genre', 'f-cert', 'f-lang', 'f-score', 'f-year-from', 'f-year-to', 'f-playable']
    .forEach((id) => $(id)?.addEventListener('change', () => loadGrid(true)));
  $('f-reset')?.addEventListener('click', () => {
    ['f-sort', 'f-genre', 'f-cert', 'f-lang', 'f-score', 'f-year-from', 'f-year-to'].forEach((id) => { if ($(id)) $(id).value = ''; });
    if ($('f-playable')) $('f-playable').checked = false;
    loadGrid(true);
  });

  $('load-more')?.addEventListener('click', () => { libState.page++; loadGrid(false); });

  const io = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && currentView === 'movies' &&
        !libState.busy && libState.page < libState.totalPages) {
      libState.page++;
      loadGrid(false);
    }
  }, { rootMargin: '700px' });
  if ($('load-more')) io.observe($('load-more'));
}

/** Open the library pre-filtered by genre */
function openGenre(genreId) {
  libState.tab = 'movie';
  fillGenreSelect();
  if ($('f-genre')) $('f-genre').value = String(genreId);
  ensureLib();
  if (currentView === 'movies') loadGrid(true);
  else showView('movies');   // showView triggers the (now filtered) first load
}

// ---------------------------------------------------------------------------
// Watchlist view
// ---------------------------------------------------------------------------
function renderWatchlist() {
  const grid = $('watchlist-grid');
  const empty = $('watchlist-empty');
  if (!grid) return;
  const list = getWatchlist();
  grid.innerHTML = '';
  empty.hidden = list.length > 0;
  list.forEach((m, i) => {
    const card = movieCard(m, {
      revealChild: true,
      onRemove: (cardEl) => {
        cardEl.classList.add('removing');
        setTimeout(() => { cardEl.remove(); empty.hidden = getWatchlist().length > 0; }, 360);
      },
    });
    card.style.setProperty('--reveal-delay', `${Math.min(i, 11) * 50}ms`);
    grid.appendChild(card);
  });
  observeChildren(grid);
}
window.addEventListener('sv:watchlist', () => { if (currentView === 'watchlist') renderWatchlist(); });

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------
function initSearch() {
  const input = $('search-input');
  const box = $('search-results');
  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => renderSearchResults(input.value.trim()), SEARCH_DEBOUNCE);
  });
  input.addEventListener('focus', () => { if (input.value.trim().length >= 2) renderSearchResults(input.value.trim()); });
  document.addEventListener('click', (e) => { if (!e.target.closest('.search-wrap')) box.classList.remove('open'); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { box.classList.remove('open'); input.blur(); } });
}

// ---------------------------------------------------------------------------
// Language menu
// ---------------------------------------------------------------------------
function initLangMenu() {
  const btn = $('lang-btn');
  const menu = $('lang-menu');
  if (!btn || !menu) return;

  const sync = () => {
    const meta = langMeta();
    btn.querySelector('.lb-code').textContent = meta.code.toUpperCase();
    btn.querySelector('.lb-flag').textContent = meta.flag;
    menu.querySelectorAll('[data-setlang]').forEach((b) =>
      b.classList.toggle('active', b.dataset.setlang === getLang()));
  };

  menu.innerHTML = LANGS.map((l) => {
    const cov = langCoverage(l.code);
    return `
    <button class="lang-item" data-setlang="${l.code}">
      <span class="li-flag">${l.flag}</span>
      <span class="li-native">${l.native}</span>
      ${cov < 100 ? `<span class="li-cov" title="${t('lang.coverage')}">${cov}%</span>` : '<span class="li-cov full">✓</span>'}
      <span class="li-code">${l.code.toUpperCase()}</span>
    </button>`;
  }).join('');

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = menu.classList.toggle('open');
    btn.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', () => menu.classList.remove('open'));
  menu.querySelectorAll('[data-setlang]').forEach((b) =>
    b.addEventListener('click', () => { setLang(b.dataset.setlang); menu.classList.remove('open'); }));

  // footer <select> mirrors the same choice
  const footerSel = $('footer-lang');
  if (footerSel) {
    footerSel.innerHTML = LANGS.map((l) => {
      const cov = langCoverage(l.code);
      return `<option value="${l.code}">${l.flag} ${l.native}${cov < 100 ? ` · ${cov}%` : ''}</option>`;
    }).join('');
    footerSel.value = getLang();
    footerSel.addEventListener('change', () => setLang(footerSel.value));
  }

  window.addEventListener('sv:langchange', () => { sync(); if (footerSel) footerSel.value = getLang(); });
  sync();
}

// ---------------------------------------------------------------------------
// Footer genre links
// ---------------------------------------------------------------------------
function renderFooterGenres() {
  const col = $('footer-genres');
  if (!col) return;
  col.querySelectorAll('a').forEach((a) => a.remove());
  GENRES.slice(0, 6).forEach((g) => {
    const a = document.createElement('a');
    a.href = '#movies';
    a.textContent = (GENRE_NAMES[getLang()] || GENRE_NAMES.en)[g.key] || GENRE_NAMES.en[g.key];
    a.addEventListener('click', (e) => { e.preventDefault(); openGenre(g.id); });
    col.appendChild(a);
  });
}

// ---------------------------------------------------------------------------
// Newsletter (Disify email validation with regex fallback)
// ---------------------------------------------------------------------------
function initNewsletter() {
  const form = $('news-form');
  const msg = $('news-msg');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('news-email').value.trim();
    msg.className = 'news-msg';
    msg.textContent = '…';
    const res = await validateEmail(email);
    if (!res.valid) {
      msg.className = 'news-msg err';
      msg.textContent = res.reason === 'disposable' ? t('news.disposable') : t('news.invalid');
      return;
    }
    msg.className = 'news-msg ok';
    msg.textContent = t('news.ok');
    form.reset();
  });
}

// ---------------------------------------------------------------------------
// Status badges
// ---------------------------------------------------------------------------
function showStatus(reason) {
  if (reason === 'invalid-key') {
    const banner = $('key-banner');
    banner.classList.add('show');
    banner.querySelector('button').addEventListener('click', () => banner.classList.remove('show'), { once: true });
  }
  if (reason) $('status-badge').classList.add('show');
}

// ---------------------------------------------------------------------------
// Language change → re-render every localized surface
// ---------------------------------------------------------------------------
function onLangChange() {
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-ph]').forEach((el) => el.setAttribute('placeholder', t(el.dataset.i18nPh)));
  splitHeroTitle(t('hero.title'));
  renderFeatures();
  renderFaq();
  renderGenreGrid(openGenre);
  renderFooterGenres();
  renderUserArea();
  fillSort(); fillGenreSelect(); fillStaticFilters();
  loadRows();
  initHero();
  if (currentView === 'movies') loadGrid(true);
  if (currentView === 'watchlist') renderWatchlist();
  if (currentView === 'auth') { renderAuthView(); renderSocials(); }
  if (currentView === 'account') renderAccountView();
  if (currentView === 'admin') renderAdminView();
}
window.addEventListener('sv:langchange', onLangChange);

// ---------------------------------------------------------------------------
// Session changes → refresh the surfaces that depend on the account
// ---------------------------------------------------------------------------
window.addEventListener('sv:session', () => {
  renderUserArea();
  if (currentView === 'account') renderAccountView();
  if (currentView === 'admin') renderAdminView();
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function boot() {
  initPreloader();
  initNavbar();
  initRipples();
  initDiscordPill();
  applyMotionSetting();
  applyAccent();
  await seedOwner();
  enforceSession();
  renderUserArea();
  applyI18n();

  renderFeatures();
  renderFaq();
  renderSocials();
  renderGenreGrid(openGenre);
  renderFooterGenres();
  initSearch();
  initLangMenu();
  initNewsletter();
  initGridControls();
  initReveals();
  initSectionParallax();

  // keyboard: "/" focuses search, Esc closes the player
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !/input|textarea|select/i.test(document.activeElement.tagName)) {
      e.preventDefault(); $('search-input').focus();
    }
    if (e.key === 'Escape') closePlayer();
  });

  await loadPdMap();
  const key = await verifyKey();
  if (!key.ok) showStatus(key.reason);

  await initHero();
  initHeroMotion();
  loadRows();

  if (window.requestIdleCallback) requestIdleCallback(() => initCursorGlow());
  else setTimeout(initCursorGlow, 800);
}

boot();
