/* ============================================================================
   StreamVault — app.js
   Boot sequence, views, hero rotation, rows, movies grid, watchlist,
   search wiring, language toggle, newsletter.
   ============================================================================ */

import { IMG, GENRES, SEARCH_DEBOUNCE } from './config.js';
import { t, getLang, setLang, applyI18n, GENRE_NAMES } from './i18n.js';
import {
  verifyKey, apiState, getTrending, getPopular, getTopRated, getNowPlaying,
  getUpcoming, getKorean, getJapanese, getIndonesian, getHollywood, getFamily,
  discover, getMoviesByIds, getFallback, validateEmail,
} from './api.js';
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
  initAdShield, applyMotionSetting, getSettings, renderUserArea,
  renderAuthView, openSettings,
} from './account.js';

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

async function initHero() {
  splitHeroTitle(t('hero.title'));
  const data = await getTrending();
  heroMovies = (data.results || []).filter((m) => m.backdrop_path).slice(0, 5);
  const bg = document.getElementById('hero-bg');
  const dots = document.getElementById('hero-dots');
  bg.innerHTML = ''; dots.innerHTML = '';

  // hero CTA always works — featured movie when online, first classic offline
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
  skeletonRow(document.getElementById('row-classics'));
  skeletonRow(document.getElementById('row-top10'));

  // Free Classics — from the public-domain map (works offline via fallback data)
  loadClassicsRow();

  // Top 10 — trending with big outlined rank numbers (7movies-style)
  getTrending().then((data) => {
    const el = document.getElementById('row-top10');
    el.innerHTML = '';
    (data.results || []).slice(0, 10).forEach((m, i) => {
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

async function loadClassicsRow() {
  const el = document.getElementById('row-classics');
  const ids = pdIds();
  let movies = [];
  if (apiState.online && apiState.keyValid) {
    movies = await getMoviesByIds(ids);
    movies.sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0));
  }
  if (!movies.length) {
    const fb = await getFallback();
    movies = fb.results.filter((m) => ids.includes(m.id));
  }
  fillRow(el, movies, { revealChild: true });
}

// ---------------------------------------------------------------------------
// Movies grid view (discover + filters + pagination)
// ---------------------------------------------------------------------------
const gridState = { page: 1, totalPages: 1, loadedOnce: false, busy: false };

function gridParams() {
  const p = {
    sort_by: document.getElementById('f-sort').value,
    page: gridState.page,
    'vote_count.gte': document.getElementById('f-sort').value.startsWith('vote_average') ? 300 : 0,
  };
  const genre = document.getElementById('f-genre').value;
  const year = document.getElementById('f-year').value;
  if (genre) p.with_genres = genre;
  if (year) p.primary_release_year = year;
  return p;
}

async function loadGrid(reset = false) {
  if (gridState.busy) return;
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

  const playableOnly = document.getElementById('f-playable').checked;
  let results = [], totalPages = 1;

  if (playableOnly) {
    // Playable now = verified public-domain titles
    const ids = pdIds();
    if (apiState.online && apiState.keyValid) results = await getMoviesByIds(ids);
    else { const fb = await getFallback(); results = fb.results.filter((m) => ids.includes(m.id)); }
    const genre = Number(document.getElementById('f-genre').value);
    if (genre) results = results.filter((m) => (m.genre_ids || (m.genres || []).map((g) => g.id)).includes(genre));
    totalPages = 1;
  } else {
    const data = await discover(gridParams());
    results = data.results || [];
    totalPages = Math.min(data.total_pages || 1, 500);
  }

  if (reset) grid.innerHTML = '';
  grid.querySelectorAll('.sk-grid-item').forEach((el) => el.remove());
  results.forEach((m, i) => {
    const card = movieCard(m, { revealChild: true });
    card.style.setProperty('--reveal-delay', `${Math.min(i, 11) * 50}ms`);
    grid.appendChild(card);
  });
  observeChildren(grid);

  gridState.totalPages = totalPages;
  moreBtn.style.display = gridState.page >= totalPages ? 'none' : '';
  gridState.busy = false;
}

function initGridControls() {
  // genre select
  const gSel = document.getElementById('f-genre');
  const fillGenres = () => {
    const val = gSel.value;
    gSel.innerHTML = `<option value="">${t('movies.filter.genre')}</option>` +
      GENRES.map((g) => `<option value="${g.id}">${GENRE_NAMES[getLang()][g.key]}</option>`).join('');
    gSel.value = val;
  };
  fillGenres();
  window.addEventListener('sv:langchange', fillGenres);

  // year select
  const ySel = document.getElementById('f-year');
  const fillYears = () => {
    const val = ySel.value;
    let opts = `<option value="">${t('movies.filter.year')}</option>`;
    for (let y = new Date().getFullYear() + 1; y >= 1940; y--) opts += `<option>${y}</option>`;
    ySel.innerHTML = opts;
    ySel.value = val;
  };
  fillYears();
  window.addEventListener('sv:langchange', fillYears);

  ['f-genre', 'f-year', 'f-sort', 'f-playable'].forEach((id) =>
    document.getElementById(id).addEventListener('change', () => loadGrid(true)));

  document.getElementById('load-more').addEventListener('click', () => {
    gridState.page++;
    loadGrid(false);
  });

  // Infinite scroll: auto-click "Load more" when it nears the viewport
  const io = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && currentView === 'movies' &&
        !gridState.busy && gridState.page < gridState.totalPages) {
      gridState.page++;
      loadGrid(false);
    }
  }, { rootMargin: '600px' });
  io.observe(document.getElementById('load-more'));
}

/** Open Movies view pre-filtered by genre (from genre tiles / footer links) */
function openGenre(genreId) {
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
// Language toggle
// ---------------------------------------------------------------------------
function initLangToggles() {
  const sync = () => {
    document.querySelectorAll('.lang-toggle').forEach((tg) => {
      tg.dataset.lang = getLang();
      tg.querySelectorAll('button').forEach((b) => {
        const active = b.dataset.setlang === getLang();
        b.classList.toggle('active', active);
        b.setAttribute('aria-pressed', String(active));
      });
    });
  };
  document.querySelectorAll('[data-setlang]').forEach((btn) =>
    btn.addEventListener('click', () => setLang(btn.dataset.setlang)));
  window.addEventListener('sv:langchange', () => {
    sync();
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
  });
  sync();
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
  initAdShield();
  applyMotionSetting();
  renderUserArea();
  applyI18n();

  // Static content renders immediately — the UI is never blank
  renderFeatures();
  renderFaq();
  renderSocials();
  renderGenreGrid(openGenre);
  renderFooterGenres();
  initSearch();
  initLangToggles();
  initNewsletter();
  initGridControls();
  initReveals();

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
