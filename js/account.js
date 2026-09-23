/* ============================================================================
   StreamVault — account.js
   Local account system (sign in / sign up), user menu, settings panel and
   AdShield. Profiles live in localStorage — no server, no tracking.
   NOTE: this is a client-side demo auth. For production wire Supabase Auth
   (see README) — the storage keys are already namespaced for migration.
   ============================================================================ */

import { t } from './i18n.js';
import { toast } from './ui.js';

const USER_KEY = 'sv:user';
const SET_KEY = 'sv:settings';

export const DEFAULT_SETTINGS = {
  adshield: true,        // block pop-ups / pop-unders opened from this page
  reduceMotion: false,   // force-disable decorative animation
  heroRotate: true,      // auto-rotate hero backdrops
  quality: 'Auto',       // pinned VidRift rendition: Auto/1080p/720p/480p
};

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------
export function getUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; }
}
function saveUser(u) { localStorage.setItem(USER_KEY, JSON.stringify(u)); }

export function getSettings() {
  try { return { ...DEFAULT_SETTINGS, ...(JSON.parse(localStorage.getItem(SET_KEY)) || {}) }; }
  catch { return { ...DEFAULT_SETTINGS }; }
}
export function saveSettings(patch) {
  const next = { ...getSettings(), ...patch };
  localStorage.setItem(SET_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent('sv:settings', { detail: next }));
  return next;
}

// ---------------------------------------------------------------------------
// AdShield — pop-up / pop-under guard
// ---------------------------------------------------------------------------
// A cross-origin player iframe cannot be ad-filtered from the parent page
// (and VidRift explicitly breaks under a sandbox attribute), but everything
// that tries to open a window THROUGH this page gets filtered here.
const ALLOWED_POPUP_HOSTS = [
  'github.com', 'discord.com', 'instagram.com', 'www.instagram.com',
  'themoviedb.org', 'www.themoviedb.org', 'justwatch.com', 'www.justwatch.com',
  'archive.org', 'embed.vidrift.in', 'vidrift.net', 'youtube.com',
  'www.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com',
];

let blockedCount = Number(sessionStorage.getItem('sv:adblocked') || 0);
const nativeOpen = window.open.bind(window);

function hostAllowed(url) {
  try { return ALLOWED_POPUP_HOSTS.some((h) => new URL(url, location.href).hostname.endsWith(h)); }
  catch { return false; }
}

export function initAdShield() {
  window.open = function (url, ...rest) {
    if (!getSettings().adshield) return nativeOpen(url, ...rest);
    if (url && hostAllowed(url)) return nativeOpen(url, ...rest);
    blockedCount++;
    sessionStorage.setItem('sv:adblocked', String(blockedCount));
    updateShieldBadge();
    toast(`🛡 ${t('shield.blocked')}`);
    return null;
  };
  updateShieldBadge();
}

function updateShieldBadge() {
  const el = document.getElementById('shield-count');
  if (el) el.textContent = String(blockedCount);
}

// ---------------------------------------------------------------------------
// Reduce-motion override (settings → CSS class on <html>)
// ---------------------------------------------------------------------------
export function applyMotionSetting() {
  document.documentElement.classList.toggle('force-reduced-motion', getSettings().reduceMotion);
}

// ---------------------------------------------------------------------------
// Auth view
// ---------------------------------------------------------------------------
const AVATAR_HUES = [46, 262, 217, 340, 152, 20];

function avatarFor(name) {
  const hue = AVATAR_HUES[(name || 'v').charCodeAt(0) % AVATAR_HUES.length];
  return { hue, initial: (name || '?').trim()[0]?.toUpperCase() || '?' };
}

export function renderAuthView() {
  const view = document.getElementById('view-auth');
  const mode = view.dataset.mode || 'signin';
  const signin = mode === 'signin';

  view.innerHTML = `
    <section class="auth-wrap">
      <div class="auth-glow" aria-hidden="true"></div>
      <div class="auth-card">
        <svg class="sv-logo auth-logo spin-in" viewBox="0 0 512 512" aria-hidden="true"><use href="#sv-mark"/></svg>
        <h2 class="auth-title">${signin ? t('auth.welcome') : t('auth.create')}</h2>
        <p class="muted auth-sub">${signin ? t('auth.welcomeSub') : t('auth.createSub')}</p>

        <div class="auth-tabs" role="tablist">
          <button role="tab" aria-selected="${signin}" class="${signin ? 'active' : ''}" data-mode="signin">${t('auth.signin')}</button>
          <button role="tab" aria-selected="${!signin}" class="${!signin ? 'active' : ''}" data-mode="signup">${t('auth.signup')}</button>
          <span class="auth-tab-pill" style="transform:translateX(${signin ? 0 : 100}%)"></span>
        </div>

        <form class="auth-form" novalidate>
          ${signin ? '' : `
          <label class="auth-field">
            <span>${t('auth.name')}</span>
            <input type="text" name="name" required minlength="2" autocomplete="name" placeholder="Zwoz">
          </label>`}
          <label class="auth-field">
            <span>Email</span>
            <input type="email" name="email" required autocomplete="email" placeholder="you@vault.com">
          </label>
          <label class="auth-field">
            <span>${t('auth.password')}</span>
            <input type="password" name="password" required minlength="4" autocomplete="${signin ? 'current-password' : 'new-password'}" placeholder="••••••••">
          </label>
          <p class="auth-err" aria-live="polite"></p>
          <button class="btn btn-gold btn-shimmer auth-submit" type="submit">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>
            ${signin ? t('auth.signin') : t('auth.signup')}
          </button>
        </form>

        <p class="auth-note">${t('auth.note')}</p>
        <div class="social-row" data-socials style="justify-content:center;margin-top:18px"></div>
      </div>
    </section>`;

  // tab switching
  view.querySelectorAll('[data-mode]').forEach((b) =>
    b.addEventListener('click', () => {
      view.dataset.mode = b.dataset.mode;
      renderAuthView();
      window.dispatchEvent(new CustomEvent('sv:rerender-socials'));
    }));

  // submit
  view.querySelector('.auth-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    const err = view.querySelector('.auth-err');
    const email = f.email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { err.textContent = t('news.invalid'); shake(f); return; }
    if (f.password.value.length < 4) { err.textContent = t('auth.shortpw'); shake(f); return; }
    const name = signin ? email.split('@')[0] : f.name.value.trim();
    if (!signin && name.length < 2) { err.textContent = t('auth.noname'); shake(f); return; }

    saveUser({ name, email, ...avatarFor(name), since: Date.now() });
    // vault-unlock celebration, then go home
    const logo = view.querySelector('.auth-logo');
    logo.classList.add('unlock');
    view.querySelector('.auth-card').classList.add('auth-success');
    setTimeout(() => {
      toast(`🔓 ${t('auth.welcomeBack')}, ${name}!`);
      renderUserArea();
      window.dispatchEvent(new CustomEvent('sv:goto', { detail: { view: 'home' } }));
    }, 700);
  });
}

function shake(el) {
  el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake');
}

export function signOut() {
  localStorage.removeItem(USER_KEY);
  renderUserArea();
  toast(t('auth.signedout'));
}

// ---------------------------------------------------------------------------
// Navbar user area (Sign In button ⇄ avatar + dropdown)
// ---------------------------------------------------------------------------
export function renderUserArea() {
  const slot = document.getElementById('user-area');
  const user = getUser();
  if (!user) {
    slot.innerHTML = `
      <button class="btn btn-ghost btn-sm user-signin" data-goto="auth">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a7 7 0 0 1 14 0v1"/></svg>
        <span>${t('auth.signin')}</span>
      </button>`;
    return;
  }
  slot.innerHTML = `
    <div class="user-menu-wrap">
      <button class="user-avatar" aria-haspopup="true" aria-expanded="false" style="--hue:${user.hue}">
        <span>${user.initial}</span>
      </button>
      <div class="user-menu" role="menu">
        <div class="um-head">
          <div class="user-avatar sm" style="--hue:${user.hue}"><span>${user.initial}</span></div>
          <div><b>${escape(user.name)}</b><small>${escape(user.email)}</small></div>
        </div>
        <button role="menuitem" data-goto="watchlist">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 3h12v18l-6-4-6 4z"/></svg>${t('nav.watchlist')}
        </button>
        <button role="menuitem" data-open-settings>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.51 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z"/></svg>${t('settings.title')}
        </button>
        <div class="um-sep"></div>
        <button role="menuitem" class="um-danger" data-signout>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>${t('auth.signout')}
        </button>
      </div>
    </div>`;

  const wrap = slot.querySelector('.user-menu-wrap');
  const avatar = slot.querySelector('.user-avatar');
  avatar.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = wrap.classList.toggle('open');
    avatar.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', () => wrap.classList.remove('open'));
  slot.querySelector('[data-signout]').addEventListener('click', signOut);
}

function escape(s) { return String(s ?? '').replace(/</g, '&lt;'); }

// ---------------------------------------------------------------------------
// Settings modal
// ---------------------------------------------------------------------------
export function openSettings() {
  const modal = document.getElementById('settings-modal');
  const s = getSettings();
  modal.innerHTML = `
    <div class="settings-card">
      <div class="settings-head">
        <h3>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.51 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z"/></svg>
          ${t('settings.title')}
        </h3>
        <button class="modal-close" data-close aria-label="Close" style="position:static;margin:0">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>

      <div class="setting-row">
        <div>
          <b>🛡 AdShield</b>
          <small>${t('settings.adshieldDesc')} <span class="gold" id="shield-inline">${sessionStorage.getItem('sv:adblocked') || 0} ${t('settings.blocked')}</span></small>
        </div>
        <button class="switch ${s.adshield ? 'on' : ''}" data-set="adshield" role="switch" aria-checked="${s.adshield}"><span></span></button>
      </div>

      <div class="setting-row">
        <div><b>${t('settings.quality')}</b><small>${t('settings.qualityDesc')}</small></div>
        <div class="quality-pills" role="radiogroup">
          ${['Auto', '1080p', '720p', '480p'].map((q) =>
            `<button role="radio" aria-checked="${s.quality === q}" class="${s.quality === q ? 'active' : ''}" data-q="${q}">${q}</button>`).join('')}
        </div>
      </div>

      <div class="setting-row">
        <div><b>${t('settings.hero')}</b><small>${t('settings.heroDesc')}</small></div>
        <button class="switch ${s.heroRotate ? 'on' : ''}" data-set="heroRotate" role="switch" aria-checked="${s.heroRotate}"><span></span></button>
      </div>

      <div class="setting-row">
        <div><b>${t('settings.motion')}</b><small>${t('settings.motionDesc')}</small></div>
        <button class="switch ${s.reduceMotion ? 'on' : ''}" data-set="reduceMotion" role="switch" aria-checked="${s.reduceMotion}"><span></span></button>
      </div>

      <div class="setting-row">
        <div><b>${t('settings.data')}</b><small>${t('settings.dataDesc')}</small></div>
        <button class="btn btn-ghost btn-sm" data-cleardata>${t('settings.clear')}</button>
      </div>
    </div>`;

  modal.classList.add('open');
  document.getElementById('modal-backdrop').classList.add('open');
  document.body.style.overflow = 'hidden';

  modal.querySelectorAll('.switch').forEach((sw) =>
    sw.addEventListener('click', () => {
      const key = sw.dataset.set;
      const val = !getSettings()[key];
      saveSettings({ [key]: val });
      sw.classList.toggle('on', val);
      sw.setAttribute('aria-checked', String(val));
      if (key === 'reduceMotion') applyMotionSetting();
    }));

  modal.querySelectorAll('[data-q]').forEach((b) =>
    b.addEventListener('click', () => {
      saveSettings({ quality: b.dataset.q });
      modal.querySelectorAll('[data-q]').forEach((x) => {
        x.classList.toggle('active', x === b);
        x.setAttribute('aria-checked', String(x === b));
      });
    }));

  modal.querySelector('[data-cleardata]').addEventListener('click', () => {
    ['sv:watchlist', 'sv:positions', 'sv:user', 'sv:settings'].forEach((k) => localStorage.removeItem(k));
    sessionStorage.clear();
    toast(t('settings.cleared'));
    closeSettings();
    renderUserArea();
  });

  modal.querySelector('[data-close]').addEventListener('click', closeSettings);
}

export function closeSettings() {
  const modal = document.getElementById('settings-modal');
  modal.classList.remove('open');
  if (!document.getElementById('movie-modal').classList.contains('open')) {
    document.getElementById('modal-backdrop').classList.remove('open');
    document.body.style.overflow = '';
  }
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.getElementById('settings-modal')?.classList.contains('open')) closeSettings();
});
document.getElementById('modal-backdrop')?.addEventListener('click', () => {
  if (document.getElementById('settings-modal')?.classList.contains('open')) closeSettings();
});
