/* ============================================================================
   StreamVault — account.js
   Local vault accounts: sign-up / sign-in, sessions, per-account watch
   history, owner (admin) controls and the settings panel.
   Profiles live in localStorage — no server, no tracking.
   NOTE: client-side demo auth. For production wire Supabase Auth (see README);
   the storage keys are already namespaced for migration.
   ============================================================================ */

import { t, LANGS } from './i18n.js';
import { toast } from './ui.js';

const ACC_KEY = 'sv:accounts';
const SES_KEY = 'sv:user';
const LOG_KEY = 'sv:log';
const SET_KEY = 'sv:settings';

export const OWNER_EMAIL = 'admin@streamvault.local';
export const OWNER_PASSWORD = 'vaultmaster'; // demo owner credentials (README)

export const DEFAULT_SETTINGS = {
  quality: 'Auto',        // pinned embed rendition: Auto/1080p/720p/480p
  heroRotate: true,       // auto-rotate hero backdrops
  reduceMotion: false,    // force-disable decorative animation
  accent: 'gold',         // gold | violet | emerald | ice
};

export const ACCENTS = {
  gold: { gold: '#F5C518', gold2: '#D4AF37', glow: '#6D28D9' },
  violet: { gold: '#A78BFA', gold2: '#7C3AED', glow: '#2563EB' },
  emerald: { gold: '#34D399', gold2: '#059669', glow: '#0EA5E9' },
  ice: { gold: '#7DD3FC', gold2: '#38BDF8', glow: '#6D28D9' },
};

// ---------------------------------------------------------------------------
// Password hashing (SHA-256 via SubtleCrypto, tiny fallback for http:// hosts)
// ---------------------------------------------------------------------------
export async function hashPw(pw) {
  const salted = 'streamvault::' + pw;
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salted));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    let h = 5381;
    for (let i = 0; i < salted.length; i++) h = ((h << 5) + h + salted.charCodeAt(i)) >>> 0;
    return 'plain-' + h.toString(16);
  }
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------
export function listAccounts() {
  try { return JSON.parse(localStorage.getItem(ACC_KEY)) || {}; } catch { return {}; }
}
function saveAccounts(all) { localStorage.setItem(ACC_KEY, JSON.stringify(all)); }

export function getAccount(email) { return listAccounts()[String(email).toLowerCase()] || null; }
export function saveAccount(acc) {
  const all = listAccounts();
  acc.email = acc.email.toLowerCase();
  all[acc.email] = acc;
  saveAccounts(all);
  return acc;
}

export function getUser() {
  try { return JSON.parse(localStorage.getItem(SES_KEY)); } catch { return null; }
}
export function isAdmin() { const u = getUser(); return !!u && u.role === 'admin'; }

export function getLog() {
  try { return JSON.parse(localStorage.getItem(LOG_KEY)) || []; } catch { return []; }
}
export function logEvent(type, email = '', detail = '') {
  const log = getLog();
  log.unshift({ at: Date.now(), type, email, detail });
  localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(0, 400)));
}

/** Demo owner account — created once so the console is reachable immediately */
export async function seedOwner() {
  if (getAccount(OWNER_EMAIL)) return;
  saveAccount({
    name: 'Vault Owner', email: OWNER_EMAIL, pw: await hashPw(OWNER_PASSWORD),
    role: 'admin', status: 'active', until: null, createdAt: Date.now(), lastLogin: null,
    logins: [], notices: [], history: [], watchlistCount: 0,
  });
  logEvent('seed', OWNER_EMAIL, 'owner account created');
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
export function getSettings() {
  try { return { ...DEFAULT_SETTINGS, ...(JSON.parse(localStorage.getItem(SET_KEY)) || {}) }; }
  catch { return { ...DEFAULT_SETTINGS }; }
}
export function saveSettings(patch) {
  const next = { ...getSettings(), ...patch };
  localStorage.setItem(SET_KEY, JSON.stringify(next));
  if ('reduceMotion' in patch) applyMotionSetting();
  if ('accent' in patch) applyAccent();
  window.dispatchEvent(new CustomEvent('sv:settings', { detail: next }));
  return next;
}
export function applyMotionSetting() {
  document.documentElement.classList.toggle('force-reduced-motion', getSettings().reduceMotion);
}
export function applyAccent() {
  const a = ACCENTS[getSettings().accent] || ACCENTS.gold;
  const root = document.documentElement.style;
  root.setProperty('--gold', a.gold);
  root.setProperty('--gold-deep', a.gold2);
  root.setProperty('--glow-a', a.glow);
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
const AVATAR_HUES = [46, 262, 217, 340, 152, 20];

function avatarFor(name) {
  const n = (name || 'v').trim() || 'v';
  return { hue: AVATAR_HUES[n.charCodeAt(0) % AVATAR_HUES.length], initial: n[0].toUpperCase() };
}

function activeTimeout(acc) {
  return acc.status === 'timeout' && acc.until && acc.until > Date.now();
}

export async function signUp({ name, email, pw }) {
  email = email.toLowerCase();
  if (getAccount(email)) return { ok: false, error: 'exists' };
  const acc = saveAccount({
    name, email, pw: await hashPw(pw), role: 'user', status: 'active', until: null,
    createdAt: Date.now(), lastLogin: Date.now(), logins: [Date.now()], notices: [], history: [],
  });
  setSession(acc);
  logEvent('signup', email, name);
  renderUserArea();
  return { ok: true, account: acc };
}

export async function signIn({ email, pw }) {
  email = email.toLowerCase();
  const acc = getAccount(email);
  if (!acc) return { ok: false, error: 'notfound' };
  if (acc.status === 'banned') return { ok: false, error: 'banned' };
  if (activeTimeout(acc)) return { ok: false, error: 'timeout', until: acc.until };
  if (acc.pw !== await hashPw(pw)) return { ok: false, error: 'badpw' };
  const kicked = acc.status === 'kicked';
  acc.status = 'active'; acc.until = null;
  acc.lastLogin = Date.now();
  acc.logins = [...(acc.logins || []), Date.now()].slice(-50);
  saveAccount(acc);
  setSession(acc);
  logEvent('signin', email, acc.name);
  return { ok: true, account: acc, kicked };
}

function setSession(acc) {
  const { hue, initial } = avatarFor(acc.name);
  localStorage.setItem(SES_KEY, JSON.stringify({
    email: acc.email, name: acc.name, role: acc.role, hue, initial, since: acc.createdAt,
  }));
}

export function signOut({ silent = false } = {}) {
  const u = getUser();
  if (u) logEvent('signout', u.email, u.name);
  localStorage.removeItem(SES_KEY);
  renderUserArea();
  window.dispatchEvent(new CustomEvent('sv:session'));
  if (!silent) toast(t('auth.signedout'));
}

/** Draw a member's real-time status from the account record */
export function sessionStatus() {
  const u = getUser();
  if (!u) return { state: 'anonymous' };
  const acc = getAccount(u.email);
  if (!acc) return { state: 'ok', account: null };
  if (acc.status === 'banned') return { state: 'banned', account: acc };
  if (activeTimeout(acc)) return { state: 'timeout', account: acc };
  if (acc.status === 'kicked') return { state: 'kicked', account: acc };
  return { state: 'ok', account: acc };
}

/** Called at boot and after every owner action: enforces kick / timeout / ban */
export function enforceSession() {
  const st = sessionStatus();
  if (st.state === 'anonymous' || st.state === 'ok') {
    // Deliver any pending owner messages
    const u = getUser();
    const acc = u && getAccount(u.email);
    if (acc?.notices?.length) {
      acc.notices.forEach((n) => toast(`📩 ${t('admin.notice')}: ${n.text}`, 6000));
      acc.notices = [];
      saveAccount(acc);
    }
    return st;
  }
  const acc = st.account;
  if (st.state === 'banned') {
    toast(`⛔ ${t('admin.banned.msg')}`, 5000);
    signOut({ silent: true });
  } else if (st.state === 'timeout') {
    toast(`⏳ ${t('admin.timedout.msg')} ${new Date(acc.until).toLocaleTimeString()}`, 6000);
  } else if (st.state === 'kicked') {
    toast(`👋 ${t('admin.kicked.msg')}`, 5000);
    signOut({ silent: true });
    acc.status = 'active';
    saveAccount(acc);
  }
  return st;
}

/** True when the signed-in member may not press play (timeout / ban) */
export function playbackBlocked() {
  const st = sessionStatus();
  return st.state === 'timeout' || st.state === 'banned';
}

// ---------------------------------------------------------------------------
// Watch history
// ---------------------------------------------------------------------------
export function recordWatch(media, type = 'movie') {
  const u = getUser();
  if (!u) return;
  const acc = getAccount(u.email);
  if (!acc) return;
  acc.history = [
    { id: media.id, type, title: media.title || media.name, poster: media.poster_path, at: Date.now() },
    ...(acc.history || []).filter((h) => !(h.id === media.id && h.type === type)),
  ].slice(0, 60);
  saveAccount(acc);
  logEvent('watch', u.email, media.title || media.name);
}

export function clearHistory() {
  const u = getUser();
  if (!u) return;
  const acc = getAccount(u.email);
  if (!acc) return;
  acc.history = [];
  saveAccount(acc);
  renderAccountView();
  toast(t('admin.sent'));
}

export function getHistory() {
  const u = getUser();
  const acc = u && getAccount(u.email);
  return (acc?.history || []).slice();
}

// ---------------------------------------------------------------------------
// Auth view
// ---------------------------------------------------------------------------
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
            <span>${t('auth.email')}</span>
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
        <p class="auth-owner-hint">${t('auth.adminHint')}</p>
        <div class="social-row" data-socials style="justify-content:center;margin-top:18px"></div>
      </div>
    </section>`;

  view.querySelectorAll('[data-mode]').forEach((b) =>
    b.addEventListener('click', () => {
      view.dataset.mode = b.dataset.mode;
      renderAuthView();
      window.dispatchEvent(new CustomEvent('sv:rerender-socials'));
    }));

  view.querySelector('.auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const err = view.querySelector('.auth-err');
    const email = f.email.value.trim().toLowerCase();
    const pw = f.password.value;
    err.textContent = '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { err.textContent = t('news.invalid'); shake(f); return; }
    if (pw.length < 4) { err.textContent = t('auth.shortpw'); shake(f); return; }

    const name = signin ? email.split('@')[0] : f.name.value.trim();
    if (!signin && name.length < 2) { err.textContent = t('auth.noname'); shake(f); return; }

    const res = signin ? await signIn({ email, pw }) : await signUp({ name, email, pw });
    if (!res.ok) {
      err.textContent = res.error === 'notfound' ? `✕ ${t('auth.signin')} — ${t('auth.email')}`
        : res.error === 'badpw' ? `✕ ${t('auth.password')}`
        : res.error === 'exists' ? `✕ ${t('auth.email')}`
        : res.error === 'timeout' ? `⏳ ${t('admin.timedout.msg')} ${new Date(res.until).toLocaleTimeString()}`
        : `⛔ ${t('admin.banned.msg')}`;
      shake(f);
      return;
    }
    const acc = res.account;
    const logo = view.querySelector('.auth-logo');
    logo.classList.add('unlock');
    view.querySelector('.auth-card').classList.add('auth-success');
    setTimeout(() => {
      toast(res.kicked ? `👋 ${t('admin.kicked.msg')}` : `🔓 ${t('auth.welcomeBack')}, ${acc.name}!`);
      renderUserArea();
      window.dispatchEvent(new CustomEvent('sv:session'));
      window.dispatchEvent(new CustomEvent('sv:goto', { detail: { view: 'account' } }));
    }, 700);
  });
}

function shake(el) { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }

// ---------------------------------------------------------------------------
// Navbar user area (Sign In button ⇄ avatar + dropdown)
// ---------------------------------------------------------------------------
export function renderUserArea() {
  const slot = document.getElementById('user-area');
  if (!slot) return;
  const user = getUser();

  if (!user) {
    slot.innerHTML = `
      <button class="btn btn-ghost btn-sm user-signin" data-goto="auth">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a7 7 0 0 1 14 0v1"/></svg>
        <span>${t('auth.signin')}</span>
      </button>`;
    return;
  }

  const acc = getAccount(user.email);
  const st = sessionStatus().state;
  const statusChip = st === 'ok' ? '' : `<span class="um-status ${st}">${t(`admin.status.${st}`)}</span>`;

  slot.innerHTML = `
    <div class="user-menu-wrap">
      <button class="user-avatar" aria-haspopup="true" aria-expanded="false" style="--hue:${user.hue}">
        <span>${user.initial}</span>
        <i class="ua-ring" aria-hidden="true"></i>
        ${user.role === 'admin' ? '<i class="ua-crown" aria-hidden="true">★</i>' : ''}
      </button>
      <div class="user-menu" role="menu">
        <div class="um-head">
          <div class="user-avatar lg" style="--hue:${user.hue}"><span>${user.initial}</span></div>
          <div class="um-id">
            <b>${esc(user.name)}</b>
            <small>${esc(user.email)}</small>
            <div class="um-tags">
              <span class="tag role">${t(user.role === 'admin' ? 'admin.role.admin' : 'admin.role.user')}</span>
              ${statusChip}
            </div>
          </div>
        </div>
        <button role="menuitem" data-goto="account">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a7 7 0 0 1 14 0v1"/></svg>${t('account.title')}
        </button>
        <button role="menuitem" data-goto="watchlist">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 3h12v18l-6-4-6 4z"/></svg>${t('nav.watchlist')}
        </button>
        ${user.role === 'admin' ? `
        <button role="menuitem" class="um-admin" data-goto="admin">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2 4 6v6c0 5 3.4 8.5 8 10 4.6-1.5 8-5 8-10V6z"/><path d="m9 12 2 2 4-4"/></svg>${t('admin.title')}
        </button>` : ''}
        <button role="menuitem" data-open-settings>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M4.2 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1A1.7 1.7 0 0 0 0 19.4"/><path d="M10.3 3.6 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0z" opacity="0"/></svg>${t('settings.title')}
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
  slot.querySelector('[data-signout]').addEventListener('click', () => signOut());
  if (acc?.role === 'admin' && acc.unreadNotices) { /* placeholder for future */ }
}

function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// ---------------------------------------------------------------------------
// My Vault (account page)
// ---------------------------------------------------------------------------
export function renderAccountView() {
  const view = document.getElementById('view-account');
  if (!view) return;
  const user = getUser();
  if (!user) {
    view.innerHTML = `<section class="container" style="padding-top:calc(var(--nav-h) + 60px);text-align:center">
      <h2>${t('auth.haveAccount')}</h2>
      <button class="btn btn-gold" data-goto="auth" style="margin-top:20px">${t('auth.signin')}</button></section>`;
    return;
  }
  const acc = getAccount(user.email) || { history: [] };
  const wl = JSON.parse(localStorage.getItem('sv:watchlist') || '[]');
  const positions = JSON.parse(localStorage.getItem('sv:positions') || '{}');
  const watched = (acc.history || []).length;
  const minutes = Object.values(positions).reduce((n, p) => n + Math.round((p.t || 0) / 60), 0);

  const cont = Object.entries(positions)
    .filter(([, p]) => p.t > 20 && (!p.d || p.t < p.d - 30))
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, 10);

  view.innerHTML = `
    <section class="container account-wrap">
      <div class="account-hero">
        <div class="account-avatar" style="--hue:${user.hue}">
          <span>${user.initial}</span><i class="ua-ring"></i>
        </div>
        <div class="account-id">
          <span class="eyebrow">${t('account.title')}</span>
          <h2>${esc(user.name)}</h2>
          <p class="muted">${esc(user.email)}</p>
          <div class="account-tags">
            <span class="tag role">${t(user.role === 'admin' ? 'admin.role.admin' : 'admin.role.user')}</span>
            <span class="tag">${t('account.plan')}: ${t('account.planValue')}</span>
            <span class="tag">${t('account.member')} ${new Date(acc.createdAt || user.since).toLocaleDateString()}</span>
          </div>
          <div class="account-actions">
            <button class="btn btn-ghost btn-sm" data-goto="watchlist">${t('watchlist.title')}</button>
            <button class="btn btn-ghost btn-sm" data-open-settings>${t('settings.title')}</button>
            ${user.role === 'admin' ? `<button class="btn btn-gold btn-sm" data-goto="admin">${t('account.admin')}</button>` : ''}
            <button class="btn btn-ghost btn-sm um-danger" data-signout>${t('account.signout')}</button>
          </div>
        </div>
        <div class="account-stats">
          <div class="astat"><b>${wl.length}</b><span>${t('account.stat.watchlist')}</span></div>
          <div class="astat"><b>${watched}</b><span>${t('account.stat.watched')}</span></div>
          <div class="astat"><b>${(minutes / 60).toFixed(1)}</b><span>${t('account.stat.time')}</span></div>
        </div>
      </div>

      ${cont.length ? `
      <div class="account-block">
        <div class="row-head"><h2>${t('account.continue')}</h2></div>
        <div class="continue-grid">
          ${cont.map(([id, p]) => `
            <button class="cont-card" data-resume="${id}" data-type="${p.type || 'movie'}">
              <div class="cont-bar" style="--p:${Math.min(100, Math.round((p.t / (p.d || p.t)) * 100))}%"></div>
              <b>${esc(p.title || id)}</b>
              <small>${Math.floor(p.t / 60)}m ${String(Math.floor(p.t % 60)).padStart(2, '0')}s</small>
            </button>`).join('')}
        </div>
      </div>` : ''}

      <div class="account-block">
        <div class="row-head"><h2>${t('account.history')}</h2>
          ${watched ? `<button class="btn btn-ghost btn-sm" data-clear-history>${t('account.clear')}</button>` : ''}</div>
        ${watched ? `<div class="history-list">${acc.history.map((h) => `
          <div class="history-row">
            <span class="hr-dot"></span>
            <div><b>${esc(h.title)}</b><small>${h.type === 'tv' ? t('modal.badge.tv') : t('modal.badge.movie')} · ${new Date(h.at).toLocaleString()}</small></div>
          </div>`).join('')}</div>`
        : `<p class="muted">${t('account.historyEmpty')}</p>`}
      </div>
    </section>`;

  view.querySelectorAll('[data-signout]').forEach((b) => b.addEventListener('click', () => { signOut(); window.dispatchEvent(new CustomEvent('sv:goto', { detail: { view: 'home' } })); }));
  view.querySelector('[data-clear-history]')?.addEventListener('click', clearHistory);
  view.querySelectorAll('[data-resume]').forEach((b) => b.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('sv:resume', { detail: { id: b.dataset.resume, type: b.dataset.type } }));
  }));
}

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
        <div><b>🌐 ${t('settings.language')}</b><small>${t('settings.languageDesc')}</small></div>
        <select class="set-select" data-set="language">
          ${LANGS.map((l) => `<option value="${l.code}" ${document.documentElement.lang === l.code ? 'selected' : ''}>${l.flag} ${l.native}</option>`).join('')}
        </select>
      </div>

      <div class="setting-row">
        <div><b>🎬 ${t('settings.quality')}</b><small>${t('settings.qualityDesc')}</small></div>
        <div class="quality-pills" role="radiogroup">
          ${['Auto', '1080p', '720p', '480p'].map((q) =>
            `<button role="radio" aria-checked="${s.quality === q}" class="${s.quality === q ? 'active' : ''}" data-q="${q}">${q}</button>`).join('')}
        </div>
      </div>

      <div class="setting-row">
        <div><b>🎨 ${t('settings.accent')}</b><small>${t('settings.accentDesc')}</small></div>
        <div class="accent-pills">
          ${Object.keys(ACCENTS).map((a) => `<button class="accent-dot ${s.accent === a ? 'active' : ''}" data-accent="${a}" aria-label="${a}" style="--c:${ACCENTS[a].gold}"></button>`).join('')}
        </div>
      </div>

      <div class="setting-row">
        <div><b>🖼 ${t('settings.hero')}</b><small>${t('settings.heroDesc')}</small></div>
        <button class="switch ${s.heroRotate ? 'on' : ''}" data-set="heroRotate" role="switch" aria-checked="${s.heroRotate}"><span></span></button>
      </div>

      <div class="setting-row">
        <div><b>🌊 ${t('settings.motion')}</b><small>${t('settings.motionDesc')}</small></div>
        <button class="switch ${s.reduceMotion ? 'on' : ''}" data-set="reduceMotion" role="switch" aria-checked="${s.reduceMotion}"><span></span></button>
      </div>

      <div class="setting-row">
        <div><b>🗄 ${t('settings.data')}</b><small>${t('settings.dataDesc')}</small></div>
        <button class="btn btn-ghost btn-sm" data-cleardata>${t('settings.clear')}</button>
      </div>

      <p class="settings-note">${t('footer.credit')} <a href="https://discord.com/users/1515548260196941864" target="_blank" rel="noopener noreferrer" class="gold">VidRift</a> · ${t('footer.thanks')} Rust (cinrift)</p>
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
      toast(`✓ ${t('settings.saved')}`);
    }));

  modal.querySelectorAll('[data-q]').forEach((b) =>
    b.addEventListener('click', () => {
      saveSettings({ quality: b.dataset.q });
      modal.querySelectorAll('[data-q]').forEach((x) => {
        x.classList.toggle('active', x === b);
        x.setAttribute('aria-checked', String(x === b));
      });
    }));

  modal.querySelectorAll('[data-accent]').forEach((b) =>
    b.addEventListener('click', () => {
      saveSettings({ accent: b.dataset.accent });
      modal.querySelectorAll('[data-accent]').forEach((x) => x.classList.toggle('active', x === b));
      toast(`✓ ${t('settings.saved')}`);
    }));

  modal.querySelector('[data-set="language"]').addEventListener('change', async (e) => {
    const { setLang } = await import('./i18n.js');
    setLang(e.target.value);
    closeSettings();
  });

  modal.querySelector('[data-cleardata]').addEventListener('click', () => {
    ['sv:watchlist', 'sv:positions', 'sv:user', 'sv:settings', 'sv:accounts', 'sv:log'].forEach((k) => localStorage.removeItem(k));
    sessionStorage.clear();
    toast(t('settings.cleared'));
    closeSettings();
    renderUserArea();
    setTimeout(() => location.reload(), 900);
  });

  modal.querySelector('[data-close]').addEventListener('click', closeSettings);
}

export function closeSettings() {
  const modal = document.getElementById('settings-modal');
  modal.classList.remove('open');
  if (!document.getElementById('media-modal')?.classList.contains('open')) {
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
