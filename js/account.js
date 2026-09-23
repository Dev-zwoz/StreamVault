/* ============================================================================
   StreamVault — account.js
   Local account system (sign in / sign up), the accounts store shared with the
   owner console (js/admin.js), the user menu with a premium avatar, settings
   panel and notice delivery. Everything lives in localStorage — no server,
   no tracking. Passwords are stored as SHA-256 hashes, never in plain text.
   NOTE: this is a client-side demo auth. For production wire Supabase Auth
   (see README) — the storage keys are already namespaced for migration.
   ============================================================================ */

import { t } from './i18n.js';
import { toast } from './ui.js';

const USER_KEY = 'sv:user';
const SET_KEY = 'sv:settings';
const ACCOUNTS_KEY = 'sv:accounts';
const EVENTS_KEY = 'sv:admin-events';

/** The seeded owner demo account (documented in the README). */
export const OWNER_SEED = { name: 'Vault Owner', email: 'admin@streamvault.local', password: 'vaultmaster' };

export const DEFAULT_SETTINGS = {
  reduceMotion: false,   // force-disable decorative animation
  heroRotate: true,      // auto-rotate hero backdrops
  embedNotice: true,     // gold “Open standalone player” banner when framed
  quality: 'Auto',       // pinned VidRift rendition: Auto/1080p/720p/480p
};

// ---------------------------------------------------------------------------
// SHA-256 (pure JS — deterministic, sync, works in every JS runtime)
// ---------------------------------------------------------------------------
export function sha256(ascii) {
  const rightRotate = (v, a) => (v >>> a) | (v << (32 - a));
  const maxWord = Math.pow(2, 32);
  let result = '';
  const words = [];
  const asciiBitLength = ascii.length * 8;
  const k = [];
  let hash = [];
  let primeCounter = 0;
  const isComposite = {};
  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (let i = 0; i < 313; i += candidate) isComposite[i] = candidate;
      hash[primeCounter] = (Math.pow(candidate, 0.5) * maxWord) | 0;
      k[primeCounter++] = (Math.pow(candidate, 1 / 3) * maxWord) | 0;
    }
  }
  ascii += '\x80';
  while (ascii.length % 64 - 56) ascii += '\x00';
  for (let i = 0; i < ascii.length; i++) {
    const j = ascii.charCodeAt(i);
    if (j >> 8) return ''; // UTF-8 input required
    words[i >> 2] |= j << ((3 - i) % 4) * 8;
  }
  words[words.length] = ((asciiBitLength / maxWord) | 0);
  words[words.length] = (asciiBitLength);
  for (let j = 0; j < words.length;) {
    const w = words.slice(j, j += 16);
    const oldHash = hash.slice(0);
    hash = hash.slice(0, 8);
    for (let i = 0; i < 64; i++) {
      const w15 = w[i - 15], w2 = w[i - 2];
      const a = hash[0], e = hash[4];
      const temp1 = hash[7]
        + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25))
        + ((e & hash[5]) ^ ((~e) & hash[6])) + k[i]
        + (w[i] = (i < 16) ? w[i] : (w[i - 16] + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) + w[i - 7] + (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))) | 0);
      const temp2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
      hash = [(temp1 + temp2) | 0].concat(hash);
      hash[4] = (hash[4] + temp1) | 0;
    }
    for (let i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
  }
  for (let i = 0; i < 8; i++) {
    for (let j = 3; j + 1; j--) {
      const b = (hash[i] >> (j * 8)) & 255;
      result += ((b < 16) ? 0 : '') + b.toString(16);
    }
  }
  return result;
}

/** Password hash for an account — salted with the (lowercased) email. */
export function hashPassword(email, password) {
  return sha256(`sv1:${String(email).toLowerCase()}:${password}`);
}

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
// Accounts store (shared with the owner console)
// ---------------------------------------------------------------------------
export function getAccounts() {
  try { return JSON.parse(localStorage.getItem(ACCOUNTS_KEY)) || {}; }
  catch { return {}; }
}
export function saveAccounts(accounts) {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
  window.dispatchEvent(new CustomEvent('sv:accounts'));
}

/** Seed the owner demo account on first load. Returns the store. */
export function ensureOwnerSeed() {
  const accounts = getAccounts();
  const email = OWNER_SEED.email.toLowerCase();
  if (!accounts[email]) {
    accounts[email] = makeAccount(OWNER_SEED.name, OWNER_SEED.email, OWNER_SEED.password, 'owner');
    saveAccounts(accounts);
  }
  return accounts;
}

function makeAccount(name, email, password, role = 'member') {
  return {
    name, email: email.toLowerCase(),
    hash: hashPassword(email, password),
    role,                                  // 'owner' | 'admin' | 'member'
    status: 'active',                      // 'active' | 'banned'
    timeoutUntil: 0,
    createdAt: Date.now(),
    signinLog: [],                         // [{ at, ok }]
    history: [],                           // [{ id, title, mediaType, at }]
    notices: [],                           // [{ msg, at, read }]
    kickedAt: 0,
  };
}

/** Owner/admin event log (live console feed) */
export function getEvents() {
  try { return JSON.parse(localStorage.getItem(EVENTS_KEY)) || []; } catch { return []; }
}
export function logEvent(text) {
  const events = getEvents();
  events.unshift({ at: Date.now(), text });
  localStorage.setItem(EVENTS_KEY, JSON.stringify(events.slice(0, 100)));
  window.dispatchEvent(new CustomEvent('sv:admin-events'));
}

// ---------------------------------------------------------------------------
// Sign-in / sign-up engine used by the auth view
// ---------------------------------------------------------------------------
export function signInAccount({ email, name, password }) {
  const accounts = getAccounts();
  const key = email.toLowerCase();
  const acc = accounts[key];

  if (!acc) {
    // Forgiving demo auth: first sign-in creates the account.
    accounts[key] = makeAccount(name || email.split('@')[0], email, password, 'member');
    saveAccounts(accounts);
    return { ok: true, account: accounts[key], created: true };
  }
  if (acc.hash !== hashPassword(email, password)) {
    acc.signinLog.unshift({ at: Date.now(), ok: false });
    saveAccounts(accounts);
    return { ok: false, reason: 'badpw' };
  }
  if (acc.status === 'banned') return { ok: false, reason: 'banned' };
  if (acc.timeoutUntil > Date.now()) return { ok: false, reason: 'timeout', until: acc.timeoutUntil };

  acc.signinLog.unshift({ at: Date.now(), ok: true });
  acc.signinLog = acc.signinLog.slice(0, 30);
  if (acc.kickedAt) acc.kickedAt = 0;
  saveAccounts(accounts);
  return { ok: true, account: acc };
}

export function signUpAccount({ email, name, password }) {
  const accounts = getAccounts();
  const key = email.toLowerCase();
  if (accounts[key]) return { ok: false, reason: 'exists' };
  accounts[key] = makeAccount(name, email, password, 'member');
  accounts[key].signinLog.unshift({ at: Date.now(), ok: true });
  saveAccounts(accounts);
  return { ok: true, account: accounts[key] };
}

/** Record a playback into the signed-in account's watch history. */
export function recordWatch(movie, mediaType = 'movie') {
  const user = getUser();
  if (!user) return;
  const accounts = getAccounts();
  const acc = accounts[user.email?.toLowerCase()];
  if (!acc) return;
  acc.history = acc.history.filter((h) => h.id !== movie.id);
  acc.history.unshift({ id: movie.id, title: movie.title || movie.name || `#${movie.id}`, mediaType, at: Date.now() });
  acc.history = acc.history.slice(0, 50);
  saveAccounts(accounts);
}

/**
 * Apply admin state to the currently signed-in user on boot:
 * bans, timeouts and kicks sign the user out with the correct toast.
 */
export function enforceAccountState() {
  const user = getUser();
  if (!user) return false;
  const accounts = getAccounts();
  const acc = accounts[user.email?.toLowerCase()];
  if (!acc) return false;

  if (acc.status === 'banned') {
    signOut(true);
    toast(`⛔ ${t('admin.bannedToast')}`);
    return true;
  }
  if (acc.timeoutUntil > Date.now()) {
    signOut(true);
    toast(`⏳ ${t('admin.timedoutYou')}`);
    return true;
  }
  if (acc.kickedAt > (acc.signinLog[0]?.at || 0)) {
    signOut(true);
    toast(`👢 ${t('admin.kickedYou')}`);
    return true;
  }
  // deliver unread notices (messages from the owner console)
  const unread = (acc.notices || []).filter((n) => !n.read);
  unread.slice(0, 3).forEach((n, i) => setTimeout(() => toast(`💬 ${n.msg}`), 600 + i * 900));
  if (unread.length) {
    acc.notices = acc.notices.map((n) => ({ ...n, read: true }));
    saveAccounts(accounts);
  }
  return false;
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

/** Premium avatar — one brand gradient for everyone, square, ringed. */
function avatarInner(initial, cls = '') {
  return `<span class="user-avatar ${cls}" aria-hidden="true"><span class="ua-letter">${initial}</span></span>`;
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
    const fields = new FormData(f);
    const email = String(fields.get('email') || '').trim();
    const password = String(fields.get('password') || '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { err.textContent = t('news.invalid'); shake(f); return; }
    if (password.length < 4) { err.textContent = t('auth.shortpw'); shake(f); return; }

    let res;
    if (signin) {
      const guessName = email.split('@')[0];
      res = signInAccount({ email, name: guessName, password });
    } else {
      const name = String(fields.get('name') || '').trim();
      if (name.length < 2) { err.textContent = t('auth.noname'); shake(f); return; }
      res = signUpAccount({ email, name, password });
    }

    if (!res.ok) {
      if (res.reason === 'badpw') err.textContent = t('auth.badpw');
      else if (res.reason === 'exists') err.textContent = t('auth.exists');
      else if (res.reason === 'banned') err.textContent = t('admin.bannedToast');
      else if (res.reason === 'timeout') err.textContent = t('admin.timedoutYou');
      shake(f);
      return;
    }

    const acc = res.account;
    saveUser({
      name: acc.name, email: acc.email, role: acc.role,
      initial: (acc.name || '?').trim()[0]?.toUpperCase() || '?',
      since: acc.createdAt,
    });
    // vault-unlock celebration, then go home
    const logo = view.querySelector('.auth-logo');
    logo.classList.add('unlock');
    view.querySelector('.auth-card').classList.add('auth-success');
    setTimeout(() => {
      toast(`🔓 ${t('auth.welcomeBack')}, ${acc.name}!`);
      enforceAccountState();
      renderUserArea();
      window.dispatchEvent(new CustomEvent('sv:goto', { detail: { view: 'home' } }));
    }, 700);
  });
}

function shake(el) {
  el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake');
}

export function signOut(silent = false) {
  localStorage.removeItem(USER_KEY);
  renderUserArea();
  if (!silent) toast(t('auth.signedout'));
}

// ---------------------------------------------------------------------------
// Navbar user area (Sign In button ⇄ premium avatar + dropdown)
// ---------------------------------------------------------------------------
export function renderUserArea() {
  const slot = document.getElementById('user-area');
  const user = getUser();
  // Console link in the navbar is owner-only
  const navConsole = document.getElementById('nav-console');
  if (navConsole) navConsole.hidden = user?.role !== 'owner';

  if (!user) {
    slot.innerHTML = `
      <button class="btn btn-ghost btn-sm user-signin" data-goto="auth">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a7 7 0 0 1 14 0v1"/></svg>
        <span>${t('auth.signin')}</span>
      </button>`;
    return;
  }

  const roleKey = user.role === 'owner' ? 'admin.owner' : user.role === 'admin' ? 'admin.admin' : 'admin.member';
  const accounts = getAccounts();
  const acc = accounts[user.email?.toLowerCase()];
  const unread = (acc?.notices || []).filter((n) => !n.read).length;
  const since = user.since ? new Date(user.since).toLocaleDateString() : '';

  slot.innerHTML = `
    <div class="user-menu-wrap">
      <button class="user-avatar-btn" aria-haspopup="true" aria-expanded="false" aria-label="${escapeAttr(user.name)}">
        ${avatarInner(user.initial)}
        ${unread ? '<span class="notice-dot" aria-hidden="true"></span>' : ''}
      </button>
      <div class="user-menu" role="menu">
        <div class="um-account-header">
          ${avatarInner(user.initial, 'um-avatar')}
          <div class="um-id">
            <b>${escape(user.name)}</b>
            <small>${escape(user.email)}</small>
            <div class="um-meta">
              <span class="um-role role-${user.role}">${t(roleKey)}</span>
              ${since ? `<span class="um-since">${since}</span>` : ''}
            </div>
          </div>
        </div>
        <button role="menuitem" data-goto="watchlist">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 3h12v18l-6-4-6 4z"/></svg>${t('nav.watchlist')}
        </button>
        ${user.role === 'owner' ? `
        <button role="menuitem" data-goto="admin">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>${t('nav.console')}
        </button>` : ''}
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
  const btn = slot.querySelector('.user-avatar-btn');
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = wrap.classList.toggle('open');
    btn.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', () => wrap.classList.remove('open'));
  slot.querySelector('[data-signout]').addEventListener('click', () => signOut());
}

function escape(s) { return String(s ?? '').replace(/</g, '&lt;'); }
function escapeAttr(s) { return escape(s).replace(/"/g, '&quot;'); }

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
        <div><b>${t('settings.embedNotice')}</b><small>${t('settings.embedNoticeDesc')}</small></div>
        <button class="switch ${s.embedNotice ? 'on' : ''}" data-set="embedNotice" role="switch" aria-checked="${s.embedNotice}"><span></span></button>
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
    toast(t('settings.cleared'));  // the correct message for clearing local data
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
