/* ============================================================================
   StreamVault — app.js
   Boot sequence, views, hero rotation, rows, Movies · TV · Anime library
   (tabs, sorts, certifications, language, score, year range, playable-now,
   unlimited load-more), watchlist, search wiring, language menu (19 packs),
   owner console wiring, newsletter.
   ============================================================================ */

import { IMG, GENRES, SEARCH_DEBOUNCE } from './config.js';
import { t, getLang, setLang, applyI18n, GENRE_NAMES, LANGS, coverage } from './i18n.js';
import {
  verifyKey, apiState, getTrending, getPopular, getTopRated, getNowPlaying,
  getUpcoming, getKorean, getJapanese, getIndonesian, getHollywood, getFamily,
  discover, discoverTv, getMoviesByIds, getFallback, validateEmail,
} from './api.js';
import { isBlockedTitle } from './content.js';
import { loadPdMap, pdIds } from './archive.js';
import {
  skeletonRow, fillRow, movieCard, renderGenreGrid, renderFeatures, renderFaq,
  renderSocials, renderSearchResults, getWatchlist, observeChildren, initCarousel,
} from './ui.js';
import { openPlayer } from './player.js';
import {
  initPreloader, initNavbar, initReveals, splitHeroTitle, initHeroMotion,
  initRipples, initCursorGlow, initDiscordPill, withViewTransition,
} from './animations.js';
import {
  ensureOwnerSeed, enforceAccountState, applyMotionSetting, getSettings,
  renderUserArea, renderAuthView, openSettings,
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
    document.getElementById(`view-${name}`).classList.add('active');
    currentView = name;
    document.querySelectorAll('.nav-links a').forEach((a) =>
      a.classList.toggle('active', a.dataset.view === name));
    scrollTo({ top: 0 });
    if (name === 'watchlist') renderWatchlist();
    if (name === 'movies' && !gridState.loadedOnce) loadGrid(true);
    if (name === 'admin') renderAdminView();
    if (name === 'auth') { renderAuthView(); renderSocials(); }
  });
}

// Programmatic navigation (auth success, user menu…)
window.addEventListener('sv:goto', (e) => showView(e.detail.view));

// Delegate all data-view / data-scroll / data-goto / settings navigation
document.addEventListener('click', (e) => {
  const settingsEl = e.target.closest('[data-open-settings]');
  if (settingsEl) { e.preventDefault(); openSettings(); return; }
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
  if (m) document.getElementById('hero-movie-title').textContent = `${m.title} (${(m.release_date || '').slice(0, 4)})`;
}

function startHeroRotation() {
  clearInterval(heroTimer);
  if (!getSettings().heroRotate) return; // user turned auto-rotate off
  heroTimer = setInterval(() => renderHeroSlide((heroIdx + 1) % heroMovies.length), 8000);
}
window.addEventListener('sv:settings', startHeroRotation);
// Maturity change → re-run home rows + library grid under the new ceiling
let lastMaturity = null;
window.addEventListener('sv:settings', (e) => {
  const m = e.detail?.contentMaturity;
  if (!m || m === lastMaturity) { lastMaturity = m ?? lastMaturity; return; }
  const changed = lastMaturity !== null;
  lastMaturity = m;
  if (changed) { loadRows(); loadGrid(true); }
});

async function initHero() {
  splitHeroTitle(t('hero.title'));
  const data = await getTrending();
  // Content policy: sweep trending through the keyword guard before rendering
  const pool = (data.results || []).filter((m) => m.backdrop_path);
  const allowed = await Promise.all(pool.map((m) => isBlockedTitle('movie', m.id)));
  heroMovies = pool.filter((_, i) => !allowed[i]).slice(0, 5);
  const bg = document.getElementById('hero-bg');
  const dots = document.getElementById('hero-dots');
  bg.innerHTML = ''; dots.innerHTML = '';

  // hero CTA always works — featured movie when online, first PD film offline
  document.getElementById('hero-watch').onclick = async () => {
    const m = heroMovies[heroIdx];
    if (m) { openPlayer(m); return; }
    const fb = await getFallback();
    const classic = fb.results.find((x) => pdIds().includes(x.id));
    if (classic) openPlayer(classic);
  };
  if (!heroMovies.length) return; // offline: aurora + scrim still look intentional
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
}

// ---------------------------------------------------------------------------
// Home rows
// ---------------------------------------------------------------------------
const ROWS = [
  ['row-trending', getTrending],
  ['row-popular', getPopular],
  ['row-top', getTopRated],
  ['row-now', getNowPlaying],
  ['row-upcoming', getUpcoming],
  ['row-korean', getKorean],
  ['row-japanese', getJapanese],
  ['row-indo', getIndonesian],
  ['row-hollywood', getHollywood],
  ['row-family', getFamily],
];

async function loadRows() {
  ROWS.forEach(([id]) => skeletonRow(document.getElementById(id)));
  skeletonRow(document.getElementById('row-top10'));

  // Top 10 — trending with big outlined rank numbers
  getTrending().then(async (data) => {
    const el = document.getElementById('row-top10');
    el.innerHTML = '';
    // content policy: filter, then rank what's left 1..10
    const pool = data.results || [];
    const ok = await Promise.all(pool.map((m) => isBlockedTitle('movie', m.id)));
    pool.filter((_, i) => !ok[i]).slice(0, 10).forEach((m, i) => {
      const card = movieCard(m, { revealChild: true });
      card.classList.add('ranked');
      card.style.setProperty('--reveal-delay', `${i * 70}ms`);
      const rank = document.createElement('span');
      rank.className = 'rank';
      rank.textContent = String(i + 1);
      card.appendChild(rank);
      el.appendChild(card);
    });
    initCarousel(el.closest('.carousel-wrap'));
    observeChildren(el);
  }).catch(() => { document.getElementById('row-top10').innerHTML = ''; });

  // Load rows in small batches to stay well under rate limits
  for (const [id, fn] of ROWS) {
    fn().then((data) => {
      const el = document.getElementById(id);
      fillRow(el, (data.results || []).slice(0, 18), { revealChild: true });
    }).catch(() => {
      document.getElementById(id).innerHTML = '';
    });
  }
}

// ---------------------------------------------------------------------------
// Library view — Movies · TV Shows · Anime
// ---------------------------------------------------------------------------
const gridState = {
  type: 'all', page: 1, totalPages: 1, totalResults: 0,
  loadedOnce: false, busy: false, pending: null,
};

/** TMDB genre id mapping for TV endpoints (our local genre keys → tv ids) */
const TV_GENRE_MAP = {
  28: 10759, 12: 10759, 16: 16, 35: 35, 80: 80, 99: 99, 18: 18,
  10751: 10751, 9648: 9648, 10749: 10749, 10752: 10768,
};
/** US certification for movies ⇄ closest US TV rating */
const TV_CERT = { G: 'TV-G', PG: 'TV-PG', 'PG-13': 'TV-14', R: 'TV-MA', 'NC-17': 'TV-MA' };
/** sort_by value per tab (TMDB movie vs tv field names) */
const SORT_FIELD = (type) => type === 'movie'
  ? {
      'popularity.desc': 'popularity.desc', 'vote_average.desc': 'vote_average.desc',
      'primary_release_date.desc': 'primary_release_date.desc', 'primary_release_date.asc': 'primary_release_date.asc',
      'original_title.asc': 'original_title.asc', 'vote_count.desc': 'vote_count.desc',
      'revenue.desc': 'revenue.desc',
    }
  : {
      'popularity.desc': 'popularity.desc', 'vote_average.desc': 'vote_average.desc',
      'primary_release_date.desc': 'first_air_date.desc', 'primary_release_date.asc': 'first_air_date.asc',
      'original_title.asc': 'name.asc', 'vote_count.desc': 'vote_count.desc',
      'revenue.desc': 'popularity.desc', // TV has no revenue — popularity keeps the order meaningful
    };

/** 30+ original languages for the language filter */
const FILTER_LANGS = [
  ['en', 'English'], ['id', 'Bahasa Indonesia'], ['es', 'Español'], ['fr', 'Français'],
  ['de', 'Deutsch'], ['ja', '日本語'], ['ko', '한국어'], ['zh', '中文'], ['it', 'Italiano'],
  ['pt', 'Português'], ['ru', 'Русский'], ['tr', 'Türkçe'], ['hi', 'हिन्दी'], ['ar', 'العربية'],
  ['th', 'ไทย'], ['vi', 'Tiếng Việt'], ['tl', 'Filipino'], ['nl', 'Nederlands'], ['pl', 'Polski'],
  ['uk', 'Українська'], ['sv', 'Svenska'], ['no', 'Norsk'], ['da', 'Dansk'], ['fi', 'Suomi'],
  ['cs', 'Čeština'], ['el', 'Ελληνικά'], ['he', 'עברית'], ['hu', 'Magyar'], ['ro', 'Română'],
  ['ms', 'Bahasa Melayu'], ['fa', 'فارسی'], ['bn', 'বাংলা'], ['ta', 'தமிழ்'], ['te', 'తెలుగు'],
  ['mr', 'मराठी'], ['pa', 'ਪੰਜਾਬੀ'],
];

const dateKey = (type) => (type === 'movie' ? 'primary_release_date' : 'first_air_date');
const normalize = (m, type) => ({
  ...m,
  title: m.title || m.name || '—',
  release_date: m.release_date || m.first_air_date || '',
  media_type: type,
});

function gridParams(type) {
  const sortSel = document.getElementById('f-sort');
  const sortBy = SORT_FIELD(type)[sortSel.value] || 'popularity.desc';
  const p = { sort_by: sortBy, page: gridState.page };

  const genre = document.getElementById('f-genre').value;
  if (genre && type !== 'all') {
    const gid = type === 'movie' ? genre : (TV_GENRE_MAP[genre] || genre);
    p.with_genres = type === 'anime' ? `16,${gid}` : gid;
  } else if (type === 'anime') {
    p.with_genres = '16';
  }
  const cert = document.getElementById('f-cert').value;
  if (cert && type !== 'all') {
    p.certification_country = 'US';
    p.certification = type === 'movie' ? cert : (TV_CERT[cert] || cert);
  }
  const lang = document.getElementById('f-lang').value;
  if (lang && type !== 'all') p.with_original_language = lang;
  else if (type === 'anime') p.with_original_language = 'ja';
  const score = document.getElementById('f-score').value;
  if (score && type !== 'all') { p['vote_average.gte'] = score; p['vote_count.gte'] = 50; }
  const yFrom = document.getElementById('f-year-from').value;
  if (yFrom && type !== 'all') p[`${dateKey(type)}.gte`] = `${yFrom}-01-01`;
  const yTo = document.getElementById('f-year-to').value;
  if (yTo && type !== 'all') p[`${dateKey(type)}.lte`] = `${yTo}-12-31`;
  if (sortSel.value.startsWith('vote_average')) {
    p['vote_count.gte'] = Math.max(Number(p['vote_count.gte'] || 0), 300);
  }
  return p;
}

async function fetchGridPage(type) {
  if (type === 'all') {
    const [movies, shows] = await Promise.all([
      discover(gridParams('movie')),
      discoverTv(gridParams('tv')),
    ]);
    const a = (movies.results || []).map((m) => normalize(m, 'movie'));
    const b = (shows.results || []).map((m) => normalize(m, 'tv'));
    const merged = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i]) merged.push(a[i]);
      if (b[i]) merged.push(b[i]);
    }
    return {
      results: merged,
      totalPages: Math.min(movies.total_pages || 1, shows.total_pages || 1),
      totalResults: (movies.total_results || 0) + (shows.total_results || 0),
    };
  }
  const endpoint = type === 'movie' ? discover : discoverTv;
  const data = await endpoint(gridParams(type)); // 'anime' params handled inside gridParams
  return {
    results: (data.results || []).map((m) => normalize(m, 'tv')),
    totalPages: data.total_pages || 1,
    totalResults: data.total_results || 0,
  };
}

function updateResultCount() {
  const el = document.getElementById('result-count');
  if (!el) return;
  const n = document.getElementById('f-playable').checked
    ? document.querySelectorAll('#movie-grid .card').length
    : gridState.totalResults;
  el.textContent = `${n.toLocaleString()} ${t('movies.results')}`;
}

async function loadGrid(reset = false) {
  // Never drop a filter change — if a load is in flight, queue the latest one
  if (gridState.busy) { gridState.pending = { reset }; return; }
  gridState.busy = true;
  gridState.loadedOnce = true;
  const grid = document.getElementById('movie-grid');
  const moreBtn = document.getElementById('load-more');

  if (reset) {
    gridState.page = 1;
    grid.innerHTML = '';
    for (let i = 0; i < 12; i++) {
      const sk = document.createElement('div');
      sk.innerHTML = '<div class="sk sk-poster"></div><div class="sk sk-line"></div>';
      sk.className = 'sk-grid-item';
      grid.appendChild(sk);
    }
  }

  let results = [], totalPages = 1;

  if (document.getElementById('f-playable').checked) {
    // Playable now = verified public-domain titles (movies)
    const ids = pdIds();
    if (apiState.online && apiState.keyValid) results = await getMoviesByIds(ids);
    else { const fb = await getFallback(); results = fb.results.filter((m) => ids.includes(m.id)); }
    results = results.map((m) => normalize(m, 'movie'));
    const genre = Number(document.getElementById('f-genre').value);
    if (genre) results = results.filter((m) => (m.genre_ids || (m.genres || []).map((g) => g.id)).includes(genre));
    totalPages = 1;
    gridState.totalResults = results.length;
  } else {
    try {
      const page = await fetchGridPage(gridState.type);
      results = page.results;
      totalPages = Math.max(1, Math.min(page.totalPages, 500)); // TMDB deep-page limit
      gridState.totalResults = page.totalResults;
    } catch { results = []; }
  }

  if (reset) grid.innerHTML = '';
  grid.querySelectorAll('.sk-grid-item').forEach((el) => el.remove());
  if (reset && !results.length) {
    grid.innerHTML = `<div class="grid-empty muted">${t('movies.none')}</div>`;
  }
  results.forEach((m, i) => {
    const card = movieCard(m, { revealChild: true });
    card.style.setProperty('--reveal-delay', `${Math.min(i, 11) * 50}ms`);
    grid.appendChild(card);
  });
  observeChildren(grid);
  updateResultCount();

  gridState.totalPages = totalPages;
  moreBtn.style.display = gridState.page >= totalPages ? 'none' : '';
  gridState.busy = false;
  if (gridState.pending) {
    const next = gridState.pending;
    gridState.pending = null;
    loadGrid(next.reset);
  }
}

function fillLangFilter() {
  const sel = document.getElementById('f-lang');
  const val = sel.value;
  sel.innerHTML = `<option value="">${t('movies.filter.langAny')}</option>` +
    FILTER_LANGS.map(([code, name]) => `<option value="${code}">${name}</option>`).join('');
  sel.value = val;
}

function fillGenreFilter() {
  const sel = document.getElementById('f-genre');
  const val = sel.value;
  const showable = gridState.type === 'movie'
    ? GENRES
    : GENRES.filter((g) => TV_GENRE_MAP[g.id]);
  sel.innerHTML = `<option value="">${t('movies.filter.genre')}</option>` +
    showable.map((g) => `<option value="${g.id}">${GENRE_NAMES[getLang()][g.key]}</option>`).join('');
  sel.value = val;
}

function fillYearFilters() {
  const from = document.getElementById('f-year-from');
  const to = document.getElementById('f-year-to');
  const vf = from.value, vt = to.value;
  let opts = `<option value="">${t('movies.filter.yearFrom')}</option>`;
  let opts2 = `<option value="">${t('movies.filter.yearTo')}</option>`;
  for (let y = new Date().getFullYear() + 1; y >= 1940; y--) {
    opts += `<option value="${y}">${y}</option>`;
    opts2 += `<option value="${y}">${y}</option>`;
  }
  from.innerHTML = opts; to.innerHTML = opts2;
  from.value = vf; to.value = vt;
}

function syncLibPill() {
  const tabs = document.getElementById('lib-tabs');
  if (!tabs) return;
  const active = tabs.querySelector('[data-tab].active');
  const pill = tabs.querySelector('.lib-pill');
  if (active && pill) {
    pill.style.width = `${active.offsetWidth}px`;
    pill.style.transform = `translateX(${active.offsetLeft - (tabs.querySelector('[data-tab]').offsetLeft)}px)`;
  }
}

function setLibTab(tab) {
  gridState.type = tab;
  document.querySelectorAll('#lib-tabs [data-tab]').forEach((b) => {
    const on = b.dataset.tab === tab;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
  });
  syncLibPill();
  // "Playable now" is a movies-only concept (public-domain films)
  const playable = document.getElementById('f-playable');
  if (tab === 'tv' || tab === 'anime') { playable.checked = false; playable.disabled = true; }
  else playable.disabled = false;
  fillGenreFilter();
  loadGrid(true);
}

function initGridControls() {
  fillGenreFilter();
  fillYearFilters();
  fillLangFilter();
  window.addEventListener('sv:langchange', () => { fillGenreFilter(); fillYearFilters(); fillLangFilter(); });

  document.querySelectorAll('#lib-tabs [data-tab]').forEach((b) =>
    b.addEventListener('click', () => setLibTab(b.dataset.tab)));

  ['f-genre', 'f-cert', 'f-lang', 'f-score', 'f-year-from', 'f-year-to', 'f-sort', 'f-playable'].forEach((id) =>
    document.getElementById(id).addEventListener('change', () => loadGrid(true)));

  document.getElementById('f-reset').addEventListener('click', () => {
    ['f-genre', 'f-cert', 'f-lang', 'f-score', 'f-year-from', 'f-year-to'].forEach((id) => { document.getElementById(id).value = ''; });
    document.getElementById('f-sort').value = 'popularity.desc';
    const playable = document.getElementById('f-playable');
    playable.checked = false;
    setLibTab('all');
  });

  document.getElementById('load-more').addEventListener('click', () => {
    gridState.page++;
    loadGrid(false);
  });

  // Infinite scroll: auto-click "Load more" when it nears the viewport — no hard cap
  const io = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && currentView === 'movies' &&
        !gridState.busy && gridState.page < gridState.totalPages) {
      gridState.page++;
      loadGrid(false);
    }
  }, { rootMargin: '600px' });
  io.observe(document.getElementById('load-more'));

  requestAnimationFrame(syncLibPill);
  window.addEventListener('resize', syncLibPill);
}

/** Open Movies view pre-filtered by genre (from genre tiles / footer links) */
function openGenre(genreId) {
  setLibTab('movie');
  document.getElementById('f-genre').value = String(genreId);
  gridState.loadedOnce = true; // avoid double load from showView
  showView('movies');
  loadGrid(true);
}

// ---------------------------------------------------------------------------
// Watchlist view
// ---------------------------------------------------------------------------
function renderWatchlist() {
  const grid = document.getElementById('watchlist-grid');
  const empty = document.getElementById('watchlist-empty');
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
window.addEventListener('sv:watchlist', () => {
  if (currentView === 'watchlist') renderWatchlist();
});

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------
function initSearch() {
  const input = document.getElementById('search-input');
  const box = document.getElementById('search-results');
  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => renderSearchResults(input.value.trim()), SEARCH_DEBOUNCE);
  });
  input.addEventListener('focus', () => { if (input.value.trim().length >= 2) renderSearchResults(input.value.trim()); });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-wrap')) box.classList.remove('open');
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { box.classList.remove('open'); input.blur(); } });
}

// ---------------------------------------------------------------------------
// Language menu — 19 packs with coverage, in navbar + footer
// ---------------------------------------------------------------------------
function langMenuMarkup() {
  const current = getLang();
  return `<button class="lang-btn" aria-haspopup="listbox" aria-expanded="false">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z"/></svg>
      <b>${current.toUpperCase()}</b>
    </button>
    <div class="lang-menu" role="listbox" aria-label="Language">
      ${LANGS.map((l) => `
        <button role="option" data-setlang="${l.code}" aria-selected="${l.code === current}" class="${l.code === current ? 'active' : ''}">
          <span class="lm-name">${l.name}</span>
          <span class="lm-cover" title="${t('lang.cover')}">${coverage(l.code)}%</span>
        </button>`).join('')}
    </div>`;
}

function initLangMenus() {
  document.querySelectorAll('.lang-menu-wrap').forEach((wrap) => {
    wrap.innerHTML = langMenuMarkup();
    const btn = wrap.querySelector('.lang-btn');
    const menu = wrap.querySelector('.lang-menu');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = wrap.classList.toggle('open');
      btn.setAttribute('aria-expanded', String(open));
    });
    menu.querySelectorAll('[data-setlang]').forEach((opt) =>
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        setLang(opt.dataset.setlang);
        document.querySelectorAll('.lang-menu-wrap').forEach((w) => {
          w.classList.remove('open');
          w.querySelector('.lang-btn').setAttribute('aria-expanded', 'false');
        });
      }));
  });
  document.addEventListener('click', () =>
    document.querySelectorAll('.lang-menu-wrap.open').forEach((w) => w.classList.remove('open')));
}

function initLangHandling() {
  initLangMenus();
  window.addEventListener('sv:langchange', () => {
    initLangMenus();
    // re-render language-dependent content with fresh TMDB locale
    splitHeroTitle(t('hero.title'));
    renderFeatures();
    renderFaq();
    renderGenreGrid(openGenre);
    renderFooterGenres();
    renderUserArea();
    loadRows();
    initHero();
    if (currentView === 'movies') loadGrid(true);
    if (currentView === 'watchlist') renderWatchlist();
    if (currentView === 'auth') { renderAuthView(); renderSocials(); }
    if (currentView === 'admin') renderAdminView();
  });
}

// ---------------------------------------------------------------------------
// Footer genre links
// ---------------------------------------------------------------------------
function renderFooterGenres() {
  const col = document.getElementById('footer-genres');
  col.querySelectorAll('a').forEach((a) => a.remove());
  GENRES.slice(0, 6).forEach((g) => {
    const a = document.createElement('a');
    a.href = '#movies';
    a.textContent = GENRE_NAMES[getLang()][g.key];
    a.addEventListener('click', (e) => { e.preventDefault(); openGenre(g.id); });
    col.appendChild(a);
  });
}

// ---------------------------------------------------------------------------
// Newsletter (Disify email validation with regex fallback)
// ---------------------------------------------------------------------------
function initNewsletter() {
  const form = document.getElementById('news-form');
  const msg = document.getElementById('news-msg');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('news-email').value.trim();
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
    const banner = document.getElementById('key-banner');
    banner.classList.add('show');
    banner.querySelector('button').addEventListener('click', () => banner.classList.remove('show'), { once: true });
  }
  if (reason) document.getElementById('status-badge').classList.add('show');
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function boot() {
  initPreloader();
  initNavbar();
  initRipples();
  initDiscordPill();
  applyMotionSetting();
  ensureOwnerSeed();       // owner demo account (admin@streamvault.local / vaultmaster)
  renderUserArea();
  applyI18n();
  enforceAccountState();   // kicks / bans / timeouts / unread notices

  // Static content renders immediately — the UI is never blank
  renderFeatures();
  renderFaq();
  renderSocials();
  renderGenreGrid(openGenre);
  renderFooterGenres();
  initSearch();
  initLangHandling();
  initNewsletter();
  initGridControls();
  initReveals();
  // Reveal static .reveal-child blocks (How-It-Works steps etc.)
  observeChildren(document.getElementById('how'));

  // Data layer
  await loadPdMap();
  const key = await verifyKey();
  if (!key.ok) showStatus(key.reason);

  await initHero();
  initHeroMotion();
  loadRows();

  // Lazy extras after the hero is interactive
  if (window.requestIdleCallback) requestIdleCallback(() => initCursorGlow());
  else setTimeout(initCursorGlow, 800);
}

boot();
