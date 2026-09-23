/* ============================================================================
   StreamVault — ui.js
   Rendering: cards (movie / TV / anime), carousels, genre grid, features, FAQ,
   search, watchlist, media detail modal (FLIP), toasts, social links.
   ============================================================================ */

import { IMG, GENRES, SOCIAL, CERTIFICATIONS } from './config.js';
import { t, getLang, GENRE_NAMES } from './i18n.js';
import { getMedia, getProviders, getSeason, searchMulti, apiState } from './api.js';
import { isPublicDomain } from './archive.js';
import { openPlayer, openTrailer } from './player.js';

// ---------------------------------------------------------------------------
// Genre id → localized name
// ---------------------------------------------------------------------------
export function genreName(id) {
  const g = GENRES.find((x) => x.id === id);
  if (!g) return '';
  return (GENRE_NAMES[getLang()] || GENRE_NAMES.en)[g.key] || GENRE_NAMES.en[g.key] || '';
}

export const isAnime = (m) => (m.genre_ids || m.genres?.map((g) => g.id) || []).includes(16) &&
  ['ja', 'zh', 'ko'].includes(m.original_language) && m.media_type !== 'movie';

/** Media-type badge label for a card / modal */
export function typeLabel(m) {
  const type = m.media_type || (m.first_air_date ? 'tv' : 'movie');
  if (type === 'tv') return isAnime(m) ? t('modal.badge.anime') : t('modal.badge.tv');
  return t('modal.badge.movie');
}

// ---------------------------------------------------------------------------
// Watchlist (localStorage)
// ---------------------------------------------------------------------------
const WL_KEY = 'sv:watchlist';

export function getWatchlist() {
  try { return JSON.parse(localStorage.getItem(WL_KEY)) || []; } catch { return []; }
}
function saveWatchlist(list) { localStorage.setItem(WL_KEY, JSON.stringify(list)); }
export function inWatchlist(id) { return getWatchlist().some((m) => m.id === id); }

export function toggleWatchlist(media) {
  const list = getWatchlist();
  const idx = list.findIndex((m) => m.id === media.id);
  if (idx >= 0) {
    list.splice(idx, 1); saveWatchlist(list);
    toast(t('toast.removed'));
    window.dispatchEvent(new CustomEvent('sv:watchlist'));
    return false;
  }
  list.unshift({
    id: media.id,
    media_type: media.media_type || (media.first_air_date ? 'tv' : 'movie'),
    title: media.title || media.name,
    name: media.name,
    poster_path: media.poster_path,
    release_date: media.release_date || media.first_air_date,
    first_air_date: media.first_air_date,
    original_language: media.original_language,
    vote_average: media.vote_average,
    genre_ids: media.genre_ids || (media.genres || []).map((g) => g.id),
  });
  saveWatchlist(list);
  toast(t('toast.added'));
  window.dispatchEvent(new CustomEvent('sv:watchlist'));
  return true;
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------
export function toast(msg, life = 2600) {
  const box = document.getElementById('toasts');
  if (!box) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.style.setProperty('--toast-life', life + 'ms');
  el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M20 6 9 17l-5-5"/></svg><span></span>`;
  el.querySelector('span').textContent = msg;
  box.appendChild(el);
  setTimeout(() => { el.classList.add('leaving'); setTimeout(() => el.remove(), 320); }, life);
}

// ---------------------------------------------------------------------------
// Poster helpers
// ---------------------------------------------------------------------------
export function gradientPoster(title, pair = ['#312E81', '#0B0B0F']) {
  const short = String(title || '?').slice(0, 22);
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='342' height='513'>` +
    `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>` +
    `<stop offset='0' stop-color='${pair[0]}'/><stop offset='1' stop-color='${pair[1]}'/></linearGradient></defs>` +
    `<rect width='342' height='513' fill='url(#g)'/>` +
    `<circle cx='171' cy='210' r='58' fill='none' stroke='#F5C518' stroke-width='6' opacity='.85'/>` +
    `<path d='M155 180 l50 30 -50 30 z' fill='#F5C518' opacity='.9'/>` +
    `<text x='171' y='330' text-anchor='middle' fill='#F5F5F7' font-family='sans-serif' font-size='20' font-weight='700'>${short.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>` +
    `</svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

function posterUrl(media, size = IMG.posterSm) {
  if (media.poster_path) return size + media.poster_path;
  return gradientPoster(media.title || media.name, media.gradient);
}

// ---------------------------------------------------------------------------
// Media card
// ---------------------------------------------------------------------------
const starSvg = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4-6.2-4.6-6.2 4.6 2.4-7.4L2 9.4h7.6z"/></svg>';
const playSvg = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
const plusSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 5v14M5 12h14"/></svg>';
const checkSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><path d="M20 6 9 17l-5-5"/></svg>';

export function movieCard(media, opts = {}) {
  const m = media.title !== undefined ? media : { ...media, title: media.name || media.title };
  const card = document.createElement('article');
  const type = m.media_type || (m.first_air_date ? 'tv' : 'movie');
  card.className = 'card' + (opts.revealChild ? ' reveal-child' : '');
  card.tabIndex = 0;
  card.dataset.id = m.id;
  card.dataset.type = type;
  card.setAttribute('aria-label', m.title);

  const year = (m.release_date || m.first_air_date || '').slice(0, 4);
  const rating = m.vote_average ? Number(m.vote_average).toFixed(1) : '–';
  const free = type === 'movie' && isPublicDomain(m.id);
  const chips = (m.genre_ids || []).slice(0, 2).map(genreName).filter(Boolean);
  const listed = inWatchlist(m.id);

  card.innerHTML = `
    <div class="card-media">
      <img loading="lazy" alt="${escapeHtml(m.title)} poster">
      <div class="card-badges">
        ${free ? `<span class="badge-free">${t('modal.badge.free')}</span>` : `<span class="badge-type">${typeLabel({ ...m, media_type: type })}</span>`}
        <span class="badge-hd">HD</span>
      </div>
      <span class="card-rating">${starSvg}${rating}</span>
      <div class="card-overlay">
        <div class="ov-actions">
          <button class="ov-btn play" data-act="play" aria-label="Play ${escapeHtml(m.title)}">${playSvg}</button>
          <button class="ov-btn wl ${listed ? 'in-list' : ''}" data-act="wl" aria-label="${t(listed ? 'modal.watchlist.remove' : 'modal.watchlist.add')}">${listed ? checkSvg : plusSvg}</button>
        </div>
        ${chips.length ? `<div class="modal-chips">${chips.map((c) => `<span class="chip">${c}</span>`).join('')}</div>` : ''}
      </div>
      ${opts.progress ? `<div class="card-progress"><i style="width:${Math.min(100, Math.round(opts.progress))}%"></i></div>` : ''}
    </div>
    <div class="card-info">
      <div class="card-title">${escapeHtml(m.title)}</div>
      <div class="card-meta"><span>${year || '—'}</span></div>
    </div>
    ${opts.rank ? `<span class="rank">${opts.rank}</span>` : ''}`;

  const img = card.querySelector('img');
  img.src = posterUrl(m);
  if (img.complete) img.classList.add('loaded');
  else img.addEventListener('load', () => img.classList.add('loaded'), { once: true });
  img.addEventListener('error', () => { img.src = gradientPoster(m.title, m.gradient); img.classList.add('loaded'); }, { once: true });

  card.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (btn) {
      e.stopPropagation();
      if (btn.dataset.act === 'play') openPlayer({ ...m, media_type: type });
      else {
        const added = toggleWatchlist({ ...m, media_type: type });
        btn.classList.toggle('in-list', added);
        btn.innerHTML = added ? checkSvg : plusSvg;
        if (opts.onRemove && !added) opts.onRemove(card, m);
      }
      return;
    }
    openMediaModal(type, m.id, card);
  });
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); openMediaModal(type, m.id, card); }
  });

  attachTilt(card);
  return card;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// 3D tilt following cursor (max 8°) — desktop only, transform-only
function attachTilt(card) {
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let raf = 0;
  card.addEventListener('mousemove', (e) => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const r = card.getBoundingClientRect();
      const rx = ((e.clientY - r.top) / r.height - .5) * -8;
      const ry = ((e.clientX - r.left) / r.width - .5) * 8;
      card.style.transform = `translateY(-6px) scale(1.05) perspective(700px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
    });
  });
  card.addEventListener('mouseleave', () => { card.style.transform = ''; });
}

// ---------------------------------------------------------------------------
// Rows / carousels
// ---------------------------------------------------------------------------
export function skeletonRow(el, n = 8) {
  if (!el) return;
  el.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const sk = document.createElement('div');
    sk.className = 'sk-card';
    sk.innerHTML = '<div class="sk sk-poster"></div><div class="sk sk-line"></div><div class="sk sk-line short"></div>';
    el.appendChild(sk);
  }
}

export function fillRow(el, items, opts = {}) {
  if (!el) return;
  el.innerHTML = '';
  items.forEach((m, i) => {
    const card = movieCard(m, opts);
    card.style.setProperty('--reveal-delay', `${Math.min(i, 10) * 60}ms`);
    el.appendChild(card);
  });
  initCarousel(el.closest('.carousel-wrap'));
  observeChildren(el);
}

const childObserver = new IntersectionObserver((entries) => {
  entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); childObserver.unobserve(e.target); } });
}, { rootMargin: '60px' });

export function observeChildren(container) {
  if (!container) return;
  container.querySelectorAll('.reveal-child').forEach((el) => childObserver.observe(el));
}

/** Arrow buttons + momentum drag + keyboard support for a carousel */
export function initCarousel(wrap) {
  if (!wrap || wrap.dataset.carInit) return;
  wrap.dataset.carInit = '1';
  const car = wrap.querySelector('.carousel');
  if (!car) return;

  const mk = (dir) => {
    const b = document.createElement('button');
    b.className = `car-btn ${dir}`;
    b.setAttribute('aria-label', dir === 'prev' ? 'Scroll back' : 'Scroll forward');
    b.innerHTML = dir === 'prev'
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M15 18l-6-6 6-6"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M9 6l6 6-6 6"/></svg>';
    b.addEventListener('click', () => {
      car.scrollBy({ left: (dir === 'prev' ? -1 : 1) * car.clientWidth * .8, behavior: 'smooth' });
    });
    wrap.appendChild(b);
    return b;
  };
  const prev = mk('prev'), next = mk('next');
  const update = () => {
    prev.toggleAttribute('disabled', car.scrollLeft < 20);
    next.toggleAttribute('disabled', car.scrollLeft > car.scrollWidth - car.clientWidth - 20);
  };
  car.addEventListener('scroll', update, { passive: true });
  update();

  car.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); car.scrollBy({ left: 220, behavior: 'smooth' }); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); car.scrollBy({ left: -220, behavior: 'smooth' }); }
  });

  let down = false, startX = 0, startL = 0, vel = 0, lastX = 0, lastT = 0, moved = 0;
  car.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse') return;
    down = true; moved = 0; startX = e.clientX; startL = car.scrollLeft; lastX = e.clientX; lastT = performance.now();
  });
  window.addEventListener('pointermove', (e) => {
    if (!down) return;
    const dx = e.clientX - startX;
    moved = Math.max(moved, Math.abs(dx));
    if (moved > 6) car.classList.add('dragging');
    car.scrollLeft = startL - dx;
    const now = performance.now();
    vel = (e.clientX - lastX) / Math.max(now - lastT, 1);
    lastX = e.clientX; lastT = now;
  });
  window.addEventListener('pointerup', () => {
    if (!down) return;
    down = false;
    setTimeout(() => car.classList.remove('dragging'), 0);
    let v = -vel * 14;
    const glide = () => {
      if (Math.abs(v) < .4 || car.classList.contains('dragging')) return;
      car.scrollLeft += v; v *= .93;
      requestAnimationFrame(glide);
    };
    if (moved > 6) requestAnimationFrame(glide);
  });
}

// ---------------------------------------------------------------------------
// Genre tiles — icon + name only (no id numbers)
// ---------------------------------------------------------------------------
const GENRE_ICONS = {
  action: '<path d="M13 2 3 14h7l-1 8 10-12h-7z"/>', adventure: '<path d="M12 2 2 22h20zM12 9v7"/>',
  animation: '<circle cx="12" cy="12" r="9"/><circle cx="9" cy="10" r="1.4"/><circle cx="15" cy="10" r="1.4"/><path d="M8.5 15a4.5 4.5 0 0 0 7 0"/>',
  comedy: '<circle cx="12" cy="12" r="9"/><path d="M8 14a4.5 4.5 0 0 0 8 0zM9 9.5h.01M15 9.5h.01"/>',
  crime: '<path d="M12 2 4 6v6c0 5 3.4 8.5 8 10 4.6-1.5 8-5 8-10V6z"/><path d="m9 12 2 2 4-4"/>',
  documentary: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/>',
  drama: '<path d="M4 3h7v8a3.5 3.5 0 1 1-7 0zM13 13h7v5a3.5 3.5 0 1 1-7 0z"/><path d="M6 7h.01M9 7h.01M16 16h.01M19 16h.01"/>',
  family: '<circle cx="8" cy="7" r="3"/><circle cx="17" cy="9" r="2.4"/><path d="M3 21v-2a5 5 0 0 1 5-5 5 5 0 0 1 5 5v2M13.5 21v-1.5a3.5 3.5 0 0 1 7 0V21"/>',
  fantasy: '<path d="m5 21 2-11 5-7 5 7 2 11-7-3z"/><path d="M12 3v6"/>',
  horror: '<path d="M12 2a8 8 0 0 0-8 8v12l3-2 2.5 2 2.5-2 2.5 2 2.5-2 3 2V10a8 8 0 0 0-8-8z"/><path d="M9 11h.01M15 11h.01"/>',
  mystery: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M8 11h6"/>',
  romance: '<path d="M12 21C7 16.5 3 13 3 8.8A4.8 4.8 0 0 1 7.8 4c1.7 0 3.3.8 4.2 2.2A5.2 5.2 0 0 1 16.2 4 4.8 4.8 0 0 1 21 8.8c0 4.2-4 7.7-9 12.2z"/>',
  scifi: '<circle cx="12" cy="12" r="3.5"/><path d="M2 12c3-4.5 17-4.5 20 0-3 4.5-17 4.5-20 0z" transform="rotate(-25 12 12)"/>',
  thriller: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.6 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0z"/>',
  war: '<path d="m14.5 3.5-9 9L3 15l1.5 1.5L2 19l3 3 2.5-2.5L9 21l2.5-2.5 9-9z"/><path d="m17 7 3.5-3.5"/>',
  western: '<path d="M4 20 12 4l8 16"/><path d="M8 20h8"/>',
  history: '<path d="M3 21h18M5 21V9l7-5 7 5v12M9 21v-6h6v6"/>',
  music: '<path d="M9 18V6l10-2v12"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/>',
  tv: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="m8 3 4 3 4-3"/>',
  reality: '<path d="M4 5h16v11H4zM8 20h8"/><path d="m11 9 3 2-3 2z"/>',
  scifi_fantasy: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4"/><circle cx="12" cy="12" r="4"/>',
};

export function renderGenreGrid(onPick) {
  const grid = document.getElementById('genre-grid');
  if (!grid) return;
  grid.innerHTML = '';
  GENRES.forEach((g, i) => {
    const tile = document.createElement('button');
    tile.className = 'genre-tile reveal-child';
    tile.style.setProperty('--reveal-delay', `${(i % 5) * 55}ms`);
    tile.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round">${GENRE_ICONS[g.key] || GENRE_ICONS.drama}</svg>
      <b>${(GENRE_NAMES[getLang()] || GENRE_NAMES.en)[g.key] || GENRE_NAMES.en[g.key]}</b>
      <i class="gt-arrow">${t('genres.explore')} →</i>`;
    tile.addEventListener('click', (e) => { rippleAt(tile, e); onPick(g.id); });
    grid.appendChild(tile);
  });
  observeChildren(grid);
}

export function rippleAt(el, e) {
  const r = el.getBoundingClientRect();
  const d = Math.max(r.width, r.height);
  const s = document.createElement('span');
  s.className = 'ripple';
  s.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
  el.appendChild(s);
  setTimeout(() => s.remove(), 600);
}

// ---------------------------------------------------------------------------
// Feature cards + FAQ
// ---------------------------------------------------------------------------
const FEATURE_ICONS = [
  '<rect x="2" y="4" width="20" height="14" rx="2"/><path d="M8 21h8M12 18v3"/>',
  '<path d="m5 8 6 4-6 4zM13 8h8M13 12h8M13 16h8"/>',
  '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z"/>',
  '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/>',
  '<path d="M3 5h12M9 3v2m1.5 12L5 9m2 8h8m-4-8 5.5 8M14 5l7 14"/>',
  '<path d="M13 2 3 14h7l-1 8 10-12h-7z"/>',
];

export function renderFeatures() {
  const grid = document.getElementById('feature-grid');
  if (!grid) return;
  grid.innerHTML = '';
  for (let i = 1; i <= 6; i++) {
    const card = document.createElement('div');
    card.className = 'feature-card reveal-child';
    card.style.setProperty('--reveal-delay', `${((i - 1) % 3) * 80}ms`);
    card.innerHTML = `
      <div class="feature-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${FEATURE_ICONS[i - 1]}</svg></div>
      <h3>${t(`why.${i}t`)}</h3><p>${t(`why.${i}d`)}</p>`;
    grid.appendChild(card);
  }
  observeChildren(grid);
}

export function renderFaq() {
  const list = document.getElementById('faq-list');
  if (!list) return;
  list.innerHTML = '';
  for (let i = 1; i <= 7; i++) {
    const item = document.createElement('div');
    item.className = 'faq-item';
    const discord = i === 7
      ? `<a class="btn btn-gold btn-sm" href="${SOCIAL.discord.url}" target="_blank" rel="noopener noreferrer">
           <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M20.32 4.37a19.8 19.8 0 0 0-4.93-1.51 13.78 13.78 0 0 0-.64 1.28 18.27 18.27 0 0 0-5.5 0 12.64 12.64 0 0 0-.64-1.28 19.74 19.74 0 0 0-4.93 1.51C.53 9.05-.32 13.58.1 18.06a19.9 19.9 0 0 0 6.07 3.03 14.44 14.44 0 0 0 1.3-2.1 12.6 12.6 0 0 1-2.05-.98c.17-.12.34-.25.5-.38a14.05 14.05 0 0 0 12.16 0c.17.13.33.26.5.38a12.64 12.64 0 0 1-2.05.98 14.82 14.82 0 0 0 1.3 2.1 19.84 19.84 0 0 0 6.07-3.04c.5-5.18-.84-9.68-3.58-13.68ZM8.02 15.33c-1.18 0-2.16-1.08-2.16-2.42s.95-2.42 2.16-2.42 2.18 1.09 2.16 2.42c0 1.34-.95 2.42-2.16 2.42Zm7.97 0c-1.18 0-2.15-1.08-2.15-2.42s.95-2.42 2.15-2.42 2.18 1.09 2.16 2.42c0 1.34-.95 2.42-2.16 2.42Z"/></svg>
           ${t('faq.discord')}</a>`
      : '';
    item.innerHTML = `
      <button class="faq-q" aria-expanded="false">
        <span>${t(`faq.q${i}`)}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 5v14M5 12h14"/></svg>
      </button>
      <div class="faq-a"><div><p>${t(`faq.a${i}`)}</p>${discord}</div></div>`;
    const q = item.querySelector('.faq-q');
    q.addEventListener('click', () => {
      const open = item.classList.toggle('open');
      q.setAttribute('aria-expanded', String(open));
    });
    list.appendChild(item);
  }
}

// ---------------------------------------------------------------------------
// Social links — real anchor navigation (target=_blank, no interception)
// ---------------------------------------------------------------------------
const SOCIAL_SVGS = {
  github: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 .5A11.5 11.5 0 0 0 .5 12a11.5 11.5 0 0 0 7.86 10.93c.58.1.79-.25.79-.56v-2.17c-3.2.7-3.87-1.37-3.87-1.37-.53-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.7 1.25 3.35.96.1-.75.4-1.26.72-1.55-2.55-.29-5.23-1.28-5.23-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.78 0c2.2-1.49 3.16-1.18 3.16-1.18.63 1.59.24 2.76.12 3.05.74.8 1.18 1.83 1.18 3.09 0 4.41-2.68 5.38-5.24 5.67.41.35.78 1.05.78 2.12v3.14c0 .31.2.67.8.56A11.5 11.5 0 0 0 23.5 12 11.5 11.5 0 0 0 12 .5z"/></svg>',
  discord: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.32 4.37a19.8 19.8 0 0 0-4.93-1.51 13.78 13.78 0 0 0-.64 1.28 18.27 18.27 0 0 0-5.5 0 12.64 12.64 0 0 0-.64-1.28 19.74 19.74 0 0 0-4.93 1.51C.53 9.05-.32 13.58.1 18.06a19.9 19.9 0 0 0 6.07 3.03 14.44 14.44 0 0 0 1.3-2.1 12.6 12.6 0 0 1-2.05-.98c.17-.12.34-.25.5-.38a14.05 14.05 0 0 0 12.16 0c.17.13.33.26.5.38a12.64 12.64 0 0 1-2.05.98 14.82 14.82 0 0 0 1.3 2.1 19.84 19.84 0 0 0 6.07-3.04c.5-5.18-.84-9.68-3.58-13.68ZM8.02 15.33c-1.18 0-2.16-1.08-2.16-2.42s.95-2.42 2.16-2.42 2.18 1.09 2.16 2.42c0 1.34-.95 2.42-2.16 2.42Zm7.97 0c-1.18 0-2.15-1.08-2.15-2.42s.95-2.42 2.15-2.42 2.18 1.09 2.16 2.42c0 1.34-.95 2.42-2.16 2.42Z"/></svg>',
  instagram: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2.5" y="2.5" width="19" height="19" rx="5.5"/><circle cx="12" cy="12" r="4.2"/><circle cx="17.6" cy="6.4" r="1.3" fill="currentColor" stroke="none"/></svg>',
};

export function renderSocials() {
  document.querySelectorAll('[data-socials]').forEach((row) => {
    row.innerHTML = '';
    Object.entries(SOCIAL).forEach(([key, s]) => {
      const a = document.createElement('a');
      a.className = 'social-link';
      a.href = s.url;                    // plain anchor: real navigation everywhere
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.dataset.tip = s.label;
      a.setAttribute('aria-label', `${key} — ${s.url}`);
      a.innerHTML = SOCIAL_SVGS[key];
      row.appendChild(a);
    });
  });
  // Text variants (footer / about) — even if pop-ups are blocked, these are links
  document.querySelectorAll('[data-social-links]').forEach((row) => {
    row.innerHTML = '';
    Object.entries(SOCIAL).forEach(([key, s]) => {
      const a = document.createElement('a');
      a.className = 'social-text-link';
      a.href = s.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.innerHTML = `${SOCIAL_SVGS[key]}<span>${s.handle}</span>`;
      row.appendChild(a);
    });
  });
}
window.addEventListener('sv:rerender-socials', renderSocials);

// ---------------------------------------------------------------------------
// Search (debounced by caller) — movies + TV + anime
// ---------------------------------------------------------------------------
export async function renderSearchResults(query) {
  const box = document.getElementById('search-results');
  if (!box) return;
  if (!query || query.length < 2) { box.classList.remove('open'); box.innerHTML = ''; return; }
  const data = await searchMulti(query);
  const results = (data.results || [])
    .filter((m) => m.media_type !== 'person')
    .filter((m) => apiState.online ? true : (m.title || '').toLowerCase().includes(query.toLowerCase()))
    .slice(0, 9);
  box.innerHTML = '';
  if (!results.length) {
    box.innerHTML = `<div class="search-empty">${t('search.none')}</div>`;
  } else {
    results.forEach((m, i) => {
      const btn = document.createElement('button');
      btn.className = 'search-result';
      btn.style.animationDelay = `${i * 40}ms`;
      btn.setAttribute('role', 'option');
      const year = (m.release_date || '').slice(0, 4);
      const type = m.media_type || 'movie';
      btn.innerHTML = `
        <img src="${m.poster_path ? IMG.posterSm + m.poster_path : gradientPoster(m.title, m.gradient)}" alt="" loading="lazy">
        <div><div class="sr-t">${escapeHtml(m.title)}</div>
        <div class="sr-m">${year || '—'} · ★ ${m.vote_average ? Number(m.vote_average).toFixed(1) : '–'} · ${typeLabel({ ...m, media_type: type })}</div></div>`;
      btn.addEventListener('click', () => { box.classList.remove('open'); openMediaModal(type, m.id); });
      box.appendChild(btn);
    });
  }
  box.classList.add('open');
}

// ---------------------------------------------------------------------------
// Media detail modal (movies + TV + anime), FLIP from the clicked card
// ---------------------------------------------------------------------------
let lastFocused = null;

export async function openMediaModal(type, id, fromCard = null) {
  const modal = document.getElementById('media-modal');
  const backdrop = document.getElementById('modal-backdrop');
  lastFocused = document.activeElement;

  if (fromCard && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const r = fromCard.getBoundingClientRect();
    const m = { w: Math.min(960, innerWidth - 32), h: Math.min(innerHeight * .86, 820) };
    const mx = (innerWidth - m.w) / 2, my = (innerHeight - m.h) / 2;
    modal.classList.add('flip');
    modal.style.transform =
      `translate(${r.left + r.width / 2 - (mx + m.w / 2)}px, ${r.top + r.height / 2 - (my + m.h / 2)}px) scale(${r.width / m.w})`;
    modal.style.opacity = '0.4';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      modal.classList.remove('flip');
      modal.style.transform = ''; modal.style.opacity = '';
    }));
  }

  modal.innerHTML = `<div style="display:grid;place-items:center;height:100%"><div class="sk" style="width:80px;height:80px;border-radius:50%"></div></div>`;
  backdrop.classList.add('open');
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
  modal.focus();

  let media;
  try { media = await getMedia(type, id); }
  catch {
    modal.innerHTML = `<div style="display:grid;place-items:center;height:100%;padding:40px;text-align:center">
      <div><h3>Offline</h3><p class="muted" style="margin-top:8px">Full details need a TMDB connection.</p>
      <button class="btn btn-ghost btn-sm" style="margin-top:20px" onclick="document.getElementById('modal-backdrop').click()">Close</button></div></div>`;
    return;
  }

  renderModalContent(modal, { ...media, media_type: type });
  loadProviders(type, id);
}

/** Backwards-compatible alias */
export const openMovieModal = (id, fromCard) => openMediaModal('movie', id, fromCard);

function renderModalContent(modal, media) {
  const type = media.media_type;
  const title = media.title || media.name;
  const date = media.release_date || media.first_air_date || '';
  const year = date.slice(0, 4);
  const runtime = media.runtime
    ? `${Math.floor(media.runtime / 60)}h ${media.runtime % 60}m`
    : media.number_of_seasons ? `${media.number_of_seasons}× ${t('modal.seasons')}` : '';
  const score = Math.round((media.vote_average || 0) * 10);
  const director = (media.credits?.crew || []).find((c) => c.job === 'Director');
  const creator = (media.created_by || [])[0];
  const cast = (media.credits?.cast || []).slice(0, 12);
  const trailer = (media.videos?.results || []).find((v) => v.site === 'YouTube' && v.type === 'Trailer')
    || (media.videos?.results || []).find((v) => v.site === 'YouTube');
  const free = type === 'movie' && isPublicDomain(media.id);
  const listed = inWatchlist(media.id);
  const similar = [...(media.similar?.results || []), ...(media.recommendations?.results || [])]
    .map((m) => ({ ...m, media_type: m.media_type || type }))
    .filter((m, i, arr) => arr.findIndex((x) => x.id === m.id) === i && m.id !== media.id)
    .slice(0, 12);
  const seasons = (media.seasons || []).filter((s) => s.season_number > 0);
  const cert = (media.release_dates?.results || []).find((r) => r.iso_1 === 'US')?.release_dates?.[0]?.certification
    || (media.content_ratings?.results || []).find((r) => r.iso_3166_1 === 'US')?.rating;

  const C = 2 * Math.PI * 26;
  modal.innerHTML = `
    <button class="modal-close" aria-label="Close">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M18 6 6 18M6 6l12 12"/></svg>
    </button>
    <div class="modal-hero">
      <div class="mh-img" style="background-image:url('${media.backdrop_path ? IMG.backdrop + media.backdrop_path : ''}')"></div>
    </div>
    <div class="modal-body">
      <div class="modal-top">
        <img class="modal-poster" src="${posterUrl(media, IMG.poster)}" alt="${escapeHtml(title)} poster">
        <div class="modal-headline">
          <div class="modal-kind">
            <span class="tag type">${typeLabel(media)}</span>
            ${cert ? `<span class="tag">${cert}</span>` : ''}
            ${isPublicDomain(media.id) ? `<span class="tag gold">${t('modal.badge.free')}</span>` : ''}
          </div>
          <h2>${escapeHtml(title)}</h2>
          ${media.tagline ? `<p class="modal-tagline">“${escapeHtml(media.tagline)}”</p>` : ''}
          <div class="modal-facts">
            <div class="rating-ring" role="img" aria-label="Rating ${score}%">
              <svg width="62" height="62"><circle class="rr-bg" cx="31" cy="31" r="26"/>
              <circle class="rr-val" cx="31" cy="31" r="26" stroke-dasharray="${C}" stroke-dashoffset="${C}"/></svg>
              <b>${score}<small style="font-size:.6em">%</small></b>
            </div>
            <span>${year}</span>${runtime ? `<span>·</span><span>${runtime}</span>` : ''}
            <span>·</span><span>★ ${Number(media.vote_average || 0).toFixed(1)} (${Number(media.vote_count || 0).toLocaleString()})</span>
          </div>
          <div class="modal-chips">${(media.genres || []).map((g) => `<span class="chip">${escapeHtml(g.name)}</span>`).join('')}</div>
        </div>
      </div>

      <div class="modal-actions">
        <button class="btn btn-gold btn-shimmer" data-act="play">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          ${free ? t('modal.play') : t('modal.playvr')}
        </button>
        <button class="btn btn-ghost" data-act="wl">${listed ? '✓ ' + t('modal.watchlist.remove') : '+ ' + t('modal.watchlist.add')}</button>
        ${trailer ? `<button class="btn btn-ghost" data-act="trailer">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="15" height="16" rx="2"/><path d="m17 10 5-3v10l-5-3"/></svg>
          ${t('modal.trailer')}</button>` : ''}
      </div>

      <p class="modal-overview">${escapeHtml(media.overview || '')}</p>
      ${director ? `<p class="modal-crew">${t('modal.director')}: <b>${escapeHtml(director.name)}</b></p>` : ''}
      ${creator ? `<p class="modal-crew">${t('modal.show')}: <b>${escapeHtml(creator.name)}</b></p>` : ''}

      ${type === 'tv' && seasons.length ? `
      <div class="modal-section">
        <h3>${t('modal.seasons')}</h3>
        <div class="season-pick">
          <select class="set-select" id="season-select">
            ${seasons.map((s) => `<option value="${s.season_number}">${escapeHtml(s.name || `S${s.season_number}`)}</option>`).join('')}
          </select>
          <div class="episode-grid" id="episode-grid"><div class="sk sk-line"></div></div>
        </div>
      </div>` : ''}

      ${cast.length ? `<div class="modal-section"><h3>${t('modal.cast')}</h3><div class="cast-row">${cast.map((c) => `
        <div class="cast-card">
          ${c.profile_path ? `<img src="${IMG.profile + c.profile_path}" alt="${escapeHtml(c.name)}" loading="lazy">` : `<div class="ph">${escapeHtml((c.name || '?')[0])}</div>`}
          <b>${escapeHtml(c.name)}</b><span>${escapeHtml(c.character || '')}</span>
        </div>`).join('')}</div></div>` : ''}

      <div class="modal-section">
        <h3>${t('modal.where')} <small>${t('modal.justwatch')}</small></h3>
        <div class="providers-panel" id="providers-panel"><div class="sk sk-line" style="margin:0"></div></div>
      </div>

      ${similar.length ? `<div class="modal-section similar-row"><h3>${t('modal.similar')}</h3>
        <div class="carousel-wrap"><div class="carousel" id="modal-similar"></div></div></div>` : ''}
    </div>`;

  requestAnimationFrame(() => requestAnimationFrame(() => {
    const rr = modal.querySelector('.rr-val');
    if (rr) rr.style.strokeDashoffset = String(C * (1 - score / 100));
  }));

  modal.querySelector('.modal-close').addEventListener('click', closeMediaModal);
  modal.querySelector('[data-act="play"]').addEventListener('click', () => openPlayer(media, { type }));
  modal.querySelector('[data-act="wl"]').addEventListener('click', (e) => {
    const added = toggleWatchlist(media);
    e.currentTarget.textContent = added ? '✓ ' + t('modal.watchlist.remove') : '+ ' + t('modal.watchlist.add');
  });
  const tBtn = modal.querySelector('[data-act="trailer"]');
  if (tBtn) tBtn.addEventListener('click', () => openTrailer(media, trailer.key));

  // season / episode picker
  const sel = modal.querySelector('#season-select');
  if (sel) {
    const grid = modal.querySelector('#episode-grid');
    const paint = async (n) => {
      grid.innerHTML = `<div class="sk sk-line"></div>`;
      try {
        const data = await getSeason(media.id, n);
        grid.innerHTML = '';
        (data.episodes || []).forEach((ep) => {
          const b = document.createElement('button');
          b.className = 'ep-chip';
          b.innerHTML = `<b>${ep.episode_number}</b><span>${escapeHtml(ep.name || '')}</span>`;
          b.title = ep.overview || ep.name || '';
          b.addEventListener('click', () => openPlayer(media, { type: 'tv', season: n, episode: ep.episode_number }));
          grid.appendChild(b);
        });
      } catch { grid.innerHTML = `<span class="muted">${t('modal.nowhere')}</span>`; }
    };
    sel.addEventListener('change', () => paint(Number(sel.value)));
    paint(Number(sel.value));
  }

  const simRow = modal.querySelector('#modal-similar');
  if (simRow) {
    similar.forEach((m) => simRow.appendChild(movieCard(m)));
    initCarousel(simRow.closest('.carousel-wrap'));
  }
  modal.scrollTop = 0;
}

async function loadProviders(type, id) {
  const panel = document.getElementById('providers-panel');
  if (!panel) return;
  try {
    const data = await getProviders(type, id);
    const regions = data.results || {};
    const regionKey = regions.ID ? 'ID' : regions.US ? 'US' : Object.keys(regions)[0];
    if (!regionKey) { panel.innerHTML = `<p class="muted" style="font-size:.9rem">${t('modal.nowhere')}</p>`; return; }
    const r = regions[regionKey];
    const group = (key, label) => {
      if (!r[key]?.length) return '';
      return `<div class="prov-group"><div class="prov-label">${label}</div><div class="prov-logos">${r[key].map((p) =>
        `<a href="${r.link}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(p.provider_name)}">
          <img src="${IMG.profile}${p.logo_path}" alt="${escapeHtml(p.provider_name)}" loading="lazy"></a>`).join('')}</div></div>`;
    };
    panel.innerHTML = `
      <div class="prov-label" style="margin-bottom:14px">${t('modal.region')}: ${regionKey === 'ID' ? '🇮🇩 Indonesia' : regionKey}</div>
      ${group('flatrate', 'Streaming')}${group('rent', 'Rent')}${group('buy', 'Buy')}${group('free', 'Free')}
      ${!r.flatrate && !r.rent && !r.buy && !r.free ? `<p class="muted" style="font-size:.9rem">${t('modal.nowhere')}</p>` : ''}`;
  } catch {
    panel.innerHTML = `<p class="muted" style="font-size:.9rem">${t('modal.nowhere')}</p>`;
  }
}

export function closeMediaModal() {
  const modal = document.getElementById('media-modal');
  const backdrop = document.getElementById('modal-backdrop');
  modal.classList.remove('open');
  backdrop.classList.remove('open');
  document.body.style.overflow = '';
  if (lastFocused) { lastFocused.focus?.(); lastFocused = null; }
}

document.getElementById('modal-backdrop')?.addEventListener('click', closeMediaModal);

document.addEventListener('keydown', (e) => {
  const modal = document.getElementById('media-modal');
  if (!modal?.classList.contains('open')) return;
  if (e.key === 'Escape') { closeMediaModal(); return; }
  if (e.key !== 'Tab') return;
  const focusables = modal.querySelectorAll('button, a[href], input, select, [tabindex]:not([tabindex="-1"])');
  if (!focusables.length) return;
  const first = focusables[0], last = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

export { CERTIFICATIONS };
