/* ============================================================================
   StreamVault — player.js
   Cinema-mode player modal: native <video> for public-domain MP4s,
   VidRift iframe for everything else, YouTube iframe for trailers.
   Keyboard shortcuts, resume-from-last-position, ambient glow from poster.
   ============================================================================ */

import { IMG, VIDRIFT } from './config.js';
import { t } from './i18n.js';
import { resolveSource } from './archive.js';
import { getSettings } from './account.js';

const POS_KEY = 'sv:positions';

function getPositions() {
  try { return JSON.parse(localStorage.getItem(POS_KEY)) || {}; } catch { return {}; }
}
function savePosition(id, time, duration) {
  const pos = getPositions();
  // Don't store near-complete positions — treat as watched
  if (duration && time > duration - 60) delete pos[id];
  else pos[id] = { t: Math.floor(time), d: Math.floor(duration || 0), at: Date.now() };
  localStorage.setItem(POS_KEY, JSON.stringify(pos));
}

let currentVideo = null;
let currentMovieId = null;
let saveTimer = null;
let vidriftListener = null;

const modal = () => document.getElementById('player-modal');
const frame = () => document.getElementById('player-frame');

/** Ambient glow tinted from the poster via a tiny canvas sample */
function tintAmbient(movie) {
  const el = document.getElementById('player-ambient');
  el.style.removeProperty('--ambient');
  if (!movie.poster_path) return;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = IMG.posterSm + movie.poster_path;
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

/**
 * watch.html link for the movie that is loaded right now. The standalone page
 * is a top-level document, so browsers let the VidRift embed play there even
 * when StreamVault itself is nested inside a preview panel or in-app browser.
 */
function standaloneUrl(movie) {
  const q = new URLSearchParams({ type: 'movie', id: String(movie.id) });
  if (movie.title) q.set('title', movie.title);
  if (movie.poster_path) q.set('poster', IMG.posterSm + movie.poster_path);
  return `watch.html?${q}`;
}

const framed = () => { try { return window.self !== window.top; } catch { return true; } };

/** Open the cinema player for a movie (resolves best source automatically) */
export async function openPlayer(movie) {
  const m = modal();
  currentMovieId = movie.id;
  tintAmbient(movie);
  document.getElementById('player-title').textContent = movie.title;
  document.getElementById('player-source').textContent = '';
  const sa = document.getElementById('player-standalone');
  if (sa) sa.href = standaloneUrl(movie);
  frame().innerHTML = '<div class="sk" style="position:absolute;inset:0"></div>';
  m.classList.add('open');
  document.body.style.overflow = 'hidden';

  const src = await resolveSource(movie.id, movie.title);
  document.getElementById('player-source').textContent = src.label;
  document.getElementById('player-keys').style.display = src.type === 'mp4' ? '' : 'none';

  if (src.type === 'mp4' || src.type === 'hls') {
    const video = document.createElement('video');
    video.controls = true;
    video.autoplay = true;
    video.playsInline = true;
    video.src = src.url;
    video.setAttribute('aria-label', movie.title);
    frame().innerHTML = '';
    frame().appendChild(video);
    currentVideo = video;

    // resume
    const saved = getPositions()[movie.id];
    if (saved && saved.t > 20) {
      video.currentTime = saved.t;
      import('./ui.js').then(({ toast }) => toast(t('player.resume')));
    }
    // persist position every 5s
    saveTimer = setInterval(() => {
      if (!video.paused) savePosition(movie.id, video.currentTime, video.duration);
    }, 5000);
  } else {
    // VidRift iframe — progress + resume + quality via postMessage.
    // IMPORTANT: never add a `sandbox` attribute — a sandboxed iframe cannot
    // play (per VidRift docs). referrerpolicy stays at its browser default.
    const iframe = document.createElement('iframe');
    iframe.src = src.url;
    iframe.setAttribute('allowfullscreen', '');
    iframe.setAttribute('allow', 'autoplay; fullscreen; encrypted-media; picture-in-picture');
    iframe.setAttribute('referrerpolicy', 'origin');
    iframe.title = movie.title;
    frame().innerHTML = '';
    frame().appendChild(iframe);

    // Nested frames are the one environment that genuinely blocks third-party
    // players — hand the viewer a top-level page instead.
    if (framed()) {
      const note = document.createElement('div');
      note.className = 'player-framed-note';
      note.innerHTML = `<p>${t('player.framed')}</p>`;
      const go = document.createElement('a');
      go.className = 'btn btn-gold';
      go.href = standaloneUrl(movie);
      go.target = '_blank';
      go.rel = 'noopener noreferrer';
      go.textContent = t('player.framedBtn');
      go.addEventListener('click', (e) => { e.preventDefault(); window.open(go.href, '_blank', 'noopener'); });
      note.appendChild(go);
      frame().appendChild(note);
    }

    // Escape hatch: give the viewer a one-click way out.
    const hint = document.createElement('div');
    hint.className = 'player-newtab-hint';
    hint.innerHTML = `<span>${t('player.iframeHint')}</span>`;
    const btn = document.createElement('a');
    btn.className = 'btn btn-gold btn-sm';
    btn.href = standaloneUrl(movie);
    btn.target = '_blank';
    btn.rel = 'noopener noreferrer';
    btn.textContent = '↗ ' + t('player.standalone');
    hint.appendChild(btn);
    frame().appendChild(hint);
    setTimeout(() => hint.classList.add('show'), 4000); // only surfaces if they linger

    const saved = getPositions()[movie.id];
    iframe.addEventListener('load', () => {
      hint.classList.remove('show'); // player responded — hide the hint
      if (saved && saved.t > 20) {
        iframe.contentWindow?.postMessage({ type: 'vidrift:resume', currentTime: saved.t }, VIDRIFT.origin);
      }
      // Pin quality if the user chose one in Settings
      const q = getSettings().quality;
      if (q && q !== 'Auto') {
        iframe.contentWindow?.postMessage({ type: 'vidrift:quality-preference', label: q }, VIDRIFT.origin);
      }
    });
    vidriftListener = (e) => {
      if (e.origin !== VIDRIFT.origin) return;
      if (e.data?.type === 'vidrift:progress' && e.data.tmdbId === movie.id) {
        savePosition(movie.id, e.data.currentTime, e.data.duration);
      }
      if (e.data?.type === 'vidrift:ended') savePosition(movie.id, 0, 0);
    };
    window.addEventListener('message', vidriftListener);
  }
}

/** Open a YouTube trailer in the same cinema shell */
export function openTrailer(movie, ytKey) {
  const m = modal();
  currentMovieId = null;
  tintAmbient(movie);
  document.getElementById('player-title').textContent = `${movie.title} — ${t('modal.trailer')}`;
  document.getElementById('player-source').textContent = 'YouTube';
  document.getElementById('player-keys').style.display = 'none';
  const iframe = document.createElement('iframe');
  iframe.src = `https://www.youtube-nocookie.com/embed/${ytKey}?autoplay=1&rel=0`;
  iframe.allowFullscreen = true;
  iframe.allow = 'autoplay; fullscreen; encrypted-media';
  iframe.title = `${movie.title} trailer`;
  frame().innerHTML = '';
  frame().appendChild(iframe);
  m.classList.add('open');
  document.body.style.overflow = 'hidden';
}

export function closePlayer() {
  const m = modal();
  if (!m.classList.contains('open')) return;
  if (currentVideo && currentMovieId) {
    savePosition(currentMovieId, currentVideo.currentTime, currentVideo.duration);
  }
  clearInterval(saveTimer); saveTimer = null;
  if (vidriftListener) { window.removeEventListener('message', vidriftListener); vidriftListener = null; }
  frame().innerHTML = '';
  currentVideo = null; currentMovieId = null;
  m.classList.remove('open');
  // Only restore scroll if the detail modal isn't still open underneath
  if (!document.getElementById('movie-modal').classList.contains('open')) {
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
  if (!currentVideo) return;
  switch (e.key) {
    case ' ':
      e.preventDefault();
      currentVideo.paused ? currentVideo.play() : currentVideo.pause();
      break;
    case 'ArrowLeft': e.preventDefault(); currentVideo.currentTime -= 10; break;
    case 'ArrowRight': e.preventDefault(); currentVideo.currentTime += 10; break;
    case 'f': case 'F':
      document.fullscreenElement ? document.exitFullscreen() : frame().requestFullscreen?.();
      break;
    case 'm': case 'M': currentVideo.muted = !currentVideo.muted; break;
  }
});

// Close on backdrop click / close button
document.addEventListener('click', (e) => {
  const m = modal();
  if (!m.classList.contains('open')) return;
  if (e.target === m || e.target.closest('#player-close')) closePlayer();
});
