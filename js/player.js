/* ============================================================================
   StreamVault — player.js
   Cinema-mode player: native <video> for public-domain MP4s, VidRift iframe for
   everything else, YouTube for trailers. Season/episode picker for TV & anime,
   source switching, resume-from-last-position, ambient glow, watch history.
   The embedded player is powered by VidRift — thanks to Rust (cinrift).
   ============================================================================ */

import { IMG, CREDITS } from './config.js';
import { t } from './i18n.js';
import { listSources } from './archive.js';
import { getSettings, recordWatch, playbackBlocked } from './account.js';

const POS_KEY = 'sv:positions';

function getPositions() {
  try { return JSON.parse(localStorage.getItem(POS_KEY)) || {}; } catch { return {}; }
}
function savePosition(id, time, duration, meta = {}) {
  const pos = getPositions();
  const key = String(id);
  if (duration && time > duration - 60) delete pos[key];
  else pos[key] = { t: Math.floor(time), d: Math.floor(duration || 0), at: Date.now(), ...meta };
  localStorage.setItem(POS_KEY, JSON.stringify(pos));
}

let cur = null; // { media, type, sources, idx, video, saveTimer, listener, season, episode }

const modal = () => document.getElementById('player-modal');
const frame = () => document.getElementById('player-frame');

/** Ambient glow tinted from the poster via a tiny canvas sample */
function tintAmbient(media) {
  const el = document.getElementById('player-ambient');
  el.style.removeProperty('--ambient');
  if (!media.poster_path || typeof Image !== 'function') return;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = IMG.posterSm + media.poster_path;
  img.onload = () => {
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 8;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, 8, 8);
      const d = ctx.getImageData(0, 0, 8, 8).data;
      let r = 0, g = 0, b = 0;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
      const n = d.length / 4;
      el.style.setProperty('--ambient',
        `radial-gradient(circle, rgba(${(r / n) | 0},${(g / n) | 0},${(b / n) | 0},.55), transparent 70%)`);
    } catch { /* canvas tainted — keep default glow */ }
  };
}

// ---------------------------------------------------------------------------
// Open the cinema player
// ---------------------------------------------------------------------------
export async function openPlayer(media, opts = {}) {
  const m = modal();
  const type = opts.type || media.media_type || 'movie';
  const title = media.title || media.name || 'Untitled';

  if (playbackBlocked()) {
    const { toast } = await import('./ui.js');
    toast(`⏳ ${t('admin.timedout.msg')}`, 5000);
    return;
  }

  tintAmbient(media);
  document.getElementById('player-title').textContent = title;
  document.getElementById('player-source').textContent = '';
  document.getElementById('player-sources').innerHTML = '';
  frame().innerHTML = '<div class="sk" style="position:absolute;inset:0"></div>';
  m.classList.add('open');
  document.body.style.overflow = 'hidden';

  const seasons = (media.seasons || []).filter((s) => s.season_number >= 0);
  cur = {
    media, type, title, seasons,
    season: opts.season ?? seasons[0]?.season_number ?? 1,
    episode: opts.episode ?? 1,
    sources: [], idx: 0, video: null, saveTimer: null, listener: null,
  };
  recordWatch(media, type);

  await buildSources();
}

async function buildSources() {
  cur.sources = await listSources(cur.media.id, cur.title, cur.type, cur.season, cur.episode);
  const preferArchive = cur.sources.findIndex((s) => s.kind === 'public-domain');
  cur.idx = preferArchive >= 0 ? preferArchive : 0;
  renderControls();
  loadSource(cur.idx);
}

/** Source chips + TV season/episode pickers, injected under the frame */
function renderControls() {
  const bar = document.getElementById('player-sources');
  const s = cur.sources[cur.idx];
  bar.innerHTML = '';

  const chipWrap = document.createElement('div');
  chipWrap.className = 'ps-chips';
  const label = document.createElement('span');
  label.className = 'ps-label';
  label.textContent = `${t('player.source')}:`;
  chipWrap.appendChild(label);

  cur.sources.forEach((src, i) => {
    const b = document.createElement('button');
    b.className = 'ps-chip' + (i === cur.idx ? ' active' : '');
    b.textContent = src.kind === 'public-domain' ? t('player.source.archive') : src.kind === 'vidrift' ? t('player.source.vidrift') : src.label;
    b.addEventListener('click', () => { cur.idx = i; renderControls(); loadSource(i); });
    chipWrap.appendChild(b);
  });

  // Escape hatch — some embedded previews refuse third-party players entirely
  const ext = document.createElement('a');
  ext.className = 'ps-chip ext';
  ext.href = s.url;
  ext.target = '_blank';
  ext.rel = 'noopener noreferrer';
  ext.textContent = '↗ ' + t('player.newtab');
  chipWrap.appendChild(ext);

  const credit = document.createElement('a');
  credit.className = 'ps-credit';
  credit.href = CREDITS.vidrift.url;
  credit.target = '_blank';
  credit.rel = 'noopener noreferrer';
  credit.innerHTML = `${t('player.credited')} <b>${CREDITS.vidrift.label}</b> — ${CREDITS.vidrift.author}`;
  chipWrap.appendChild(credit);

  bar.appendChild(chipWrap);

  if (cur.type === 'tv' && cur.seasons.length) {
    const pick = document.createElement('div');
    pick.className = 'ps-pick';
    const mk = (name, opts, value, onChange) => {
      const sel = document.createElement('select');
      sel.className = 'set-select sm';
      sel.setAttribute('aria-label', name);
      opts.forEach(([v, lbl]) => {
        const o = document.createElement('option');
        o.value = String(v); o.textContent = lbl;
        sel.appendChild(o);
      });
      sel.value = String(value);
      sel.addEventListener('change', () => onChange(Number(sel.value)));
      return sel;
    };
    pick.appendChild(mk(t('modal.seasons'), cur.seasons.map((x) => [x.season_number, x.name || `${t('modal.seasons')} ${x.season_number}`]), cur.season, (v) => {
      cur.season = v; cur.episode = 1; buildSources();
    }));
    const count = cur.seasons.find((x) => x.season_number === cur.season)?.episode_count || 24;
    pick.appendChild(mk(t('modal.episode'), Array.from({ length: count }, (_, i) => [i + 1, `${t('modal.episode')} ${i + 1}`]), cur.episode, (v) => {
      cur.episode = v; buildSources();
    }));
    bar.appendChild(pick);
  }
}

/** Load a source into the frame */
function loadSource(i) {
  const s = cur.sources[i];
  const keys = document.getElementById('player-keys');
  document.getElementById('player-source').textContent = s.label;
  clearTimers();

  if (s.type === 'mp4' || s.type === 'hls') {
    keys.style.display = '';
    const video = document.createElement('video');
    video.controls = true;
    video.autoplay = true;
    video.playsInline = true;
    video.src = s.url;
    video.setAttribute('aria-label', cur.title);
    frame().innerHTML = '';
    frame().appendChild(video);
    cur.video = video;

    const saved = getPositions()[cur.media.id];
    if (saved && saved.t > 20) {
      video.currentTime = saved.t;
      import('./ui.js').then(({ toast }) => toast(t('player.resume')));
    }
    cur.saveTimer = setInterval(() => {
      if (!video.paused) savePosition(cur.media.id, video.currentTime, video.duration, meta());
    }, 5000);
    return;
  }

  // VidRift iframe — progress + resume + quality via postMessage.
  // IMPORTANT: never add a `sandbox` attribute — a sandboxed iframe cannot play
  // (per VidRift docs). referrerpolicy stays at its browser default.
  keys.style.display = 'none';
  const iframe = document.createElement('iframe');
  iframe.src = s.url;
  iframe.allowFullscreen = true;
  iframe.allow = 'autoplay; fullscreen; encrypted-media; picture-in-picture; clipboard-write';
  iframe.title = cur.title;
  frame().innerHTML = '';
  frame().appendChild(iframe);

  const hint = document.createElement('div');
  hint.className = 'player-newtab-hint';
  hint.innerHTML = `<span>${t('player.iframeHint')}</span>`;
  const btn = document.createElement('a');
  btn.className = 'btn btn-gold btn-sm';
  btn.href = s.url;
  btn.target = '_blank';
  btn.rel = 'noopener noreferrer';
  btn.textContent = '↗ ' + t('player.newtab');
  hint.appendChild(btn);
  frame().appendChild(hint);
  let frameLoaded = false;
  iframe.addEventListener('load', () => { frameLoaded = true; hint.classList.remove('show'); });
  setTimeout(() => hint.classList.add('show'), 4500);
  // if the embed never even loads (strict embed policy / offline), nudge harder
  setTimeout(() => { if (!frameLoaded) hint.classList.add('show', 'urgent'); }, 9000);

  const saved = getPositions()[cur.media.id];
  iframe.addEventListener('load', () => {
    hint.classList.remove('show');
    if (saved && saved.t > 20) {
      iframe.contentWindow?.postMessage({ type: 'vidrift:resume', currentTime: saved.t }, 'https://embed.vidrift.in');
    }
    const q = getSettings().quality;
    if (q && q !== 'Auto') {
      iframe.contentWindow?.postMessage({ type: 'vidrift:quality-preference', label: q }, 'https://embed.vidrift.in');
    }
  });
  cur.listener = (e) => {
    if (e.origin !== 'https://embed.vidrift.in') return;
    if (e.data?.type === 'vidrift:progress' && e.data.tmdbId === cur.media.id) {
      savePosition(cur.media.id, e.data.currentTime, e.data.duration, meta());
    }
    if (e.data?.type === 'vidrift:ended') savePosition(cur.media.id, 0, 0, meta());
  };
  window.addEventListener('message', cur.listener);
}

function meta() {
  return {
    id: cur.media.id,
    type: cur.type,
    title: cur.type === 'tv' && cur.seasons.length ? `${cur.title} · S${cur.season}E${cur.episode}` : cur.title,
    poster: cur.media.poster_path,
  };
}

function clearTimers() {
  clearInterval(cur?.saveTimer);
  if (cur?.listener) { window.removeEventListener('message', cur.listener); cur.listener = null; }
  if (cur) cur.video = null;
}

/** Open a YouTube trailer in the same cinema shell */
export function openTrailer(media, ytKey) {
  const m = modal();
  tintAmbient(media);
  document.getElementById('player-title').textContent = `${media.title || media.name} — ${t('modal.trailer')}`;
  document.getElementById('player-source').textContent = 'YouTube';
  document.getElementById('player-sources').innerHTML = '';
  document.getElementById('player-keys').style.display = 'none';
  const iframe = document.createElement('iframe');
  iframe.src = `https://www.youtube-nocookie.com/embed/${ytKey}?autoplay=1&rel=0`;
  iframe.allowFullscreen = true;
  iframe.allow = 'autoplay; fullscreen; encrypted-media';
  iframe.title = `${media.title || media.name} trailer`;
  frame().innerHTML = '';
  frame().appendChild(iframe);
  m.classList.add('open');
  document.body.style.overflow = 'hidden';
}

export function closePlayer() {
  const m = modal();
  if (!m.classList.contains('open')) return;
  if (cur?.video) savePosition(cur.media.id, cur.video.currentTime, cur.video.duration, meta());
  clearTimers();
  frame().innerHTML = '';
  cur = null;
  m.classList.remove('open');
  if (!document.getElementById('media-modal')?.classList.contains('open')) {
    document.body.style.overflow = '';
  }
}

// ---------------------------------------------------------------------------
// Keyboard shortcuts (native video only): Space, ←/→, F, M, Esc
// ---------------------------------------------------------------------------
document.addEventListener('keydown', (e) => {
  const m = modal();
  if (!m.classList.contains('open')) return;
  if (e.key === 'Escape') { closePlayer(); return; }
  const v = cur?.video;
  if (!v) return;
  switch (e.key) {
    case ' ':
      e.preventDefault();
      v.paused ? v.play() : v.pause();
      break;
    case 'ArrowLeft': e.preventDefault(); v.currentTime -= 10; break;
    case 'ArrowRight': e.preventDefault(); v.currentTime += 10; break;
    case 'f': case 'F':
      document.fullscreenElement ? document.exitFullscreen() : frame().requestFullscreen?.();
      break;
    case 'm': case 'M': v.muted = !v.muted; break;
  }
});

// Close on backdrop click / close button
document.addEventListener('click', (e) => {
  const m = modal();
  if (!m.classList.contains('open')) return;
  if (e.target === m || e.target.closest('#player-close')) closePlayer();
});
