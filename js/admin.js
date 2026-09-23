/* ============================================================================
   StreamVault — admin.js
   Owner console: every account stored in this browser, their credentials hash,
   sign-in history, watch history, plus live moderation — kick, timeout, ban,
   promote, message, reset password and delete.
   Client-side demo (no backend): the console sees accounts created in THIS
   browser. Wire it to Supabase/your API for multi-device moderation.
   ============================================================================ */

import { t } from './i18n.js';
import { toast } from './ui.js';
import {
  listAccounts, saveAccount, getAccount, getLog, logEvent, getUser, isAdmin,
  hashPw, enforceSession, signOut, renderUserArea,
} from './account.js';

let filter = '';
let selected = null;

const state = (acc) => {
  if (acc.status === 'banned') return 'banned';
  if (acc.status === 'timeout' && acc.until > Date.now()) return 'timeout';
  if (acc.status === 'kicked') return 'kicked';
  return 'active';
};

const statusLabel = (s) => `<span class="ad-status ${s}">${t(`admin.status.${s}`)}</span>`;
const when = (ts) => (ts ? new Date(ts).toLocaleString() : '—');

export function renderAdminView() {
  const view = document.getElementById('view-admin');
  if (!view) return;

  if (!isAdmin()) {
    view.innerHTML = `
      <section class="container" style="padding-top:calc(var(--nav-h) + 70px);text-align:center">
        <svg class="sv-logo" width="80" height="80" viewBox="0 0 512 512" aria-hidden="true"><use href="#sv-mark"/></svg>
        <h2 style="margin-top:18px">${t('admin.title')}</h2>
        <p class="muted" style="margin-top:10px">${getUser() ? t('admin.noAccess') : t('admin.loginPrompt')}</p>
        <button class="btn btn-gold" data-goto="auth" style="margin-top:22px">${getUser() ? t('account.title') : t('auth.signin')}</button>
      </section>`;
    return;
  }

  const accounts = listAccounts();
  const rows = Object.values(accounts).sort((a, b) => (b.lastLogin || b.createdAt) - (a.lastLogin || a.createdAt));
  const dayAgo = Date.now() - 86400000;
  const log = getLog();
  const stats = {
    users: rows.length,
    active: rows.filter((a) => (a.lastLogin || 0) > dayAgo).length,
    events: log.filter((l) => l.type === 'watch').length,
    restricted: rows.filter((a) => ['banned', 'timeout'].includes(state(a))).length,
  };
  const needle = filter.trim().toLowerCase();
  const shown = needle
    ? rows.filter((a) => `${a.name} ${a.email} ${state(a)} ${a.role}`.toLowerCase().includes(needle))
    : rows;

  view.innerHTML = `
    <section class="container admin-wrap">
      <div class="admin-head">
        <div>
          <span class="eyebrow">${t('footer.admin')}</span>
          <h2>${t('admin.title')}</h2>
          <p class="muted">${t('admin.sub')}</p>
        </div>
        <div class="admin-badge">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2 4 6v6c0 5 3.4 8.5 8 10 4.6-1.5 8-5 8-10V6z"/><path d="m9 12 2 2 4-4"/></svg>
          <b>${getUser().name}</b>
        </div>
      </div>

      <div class="admin-stats">
        <div class="astat"><b>${stats.users}</b><span>${t('admin.stat.users')}</span></div>
        <div class="astat"><b>${stats.active}</b><span>${t('admin.stat.active')}</span></div>
        <div class="astat"><b>${stats.events}</b><span>${t('admin.stat.events')}</span></div>
        <div class="astat"><b>${stats.restricted}</b><span>${t('admin.stat.timedout')}</span></div>
      </div>

      <div class="admin-grid">
        <div class="admin-panel">
          <div class="admin-panel-head">
            <h3>${t('admin.stat.users')}</h3>
            <input class="admin-search" type="search" placeholder="${t('admin.search')}" value="${filter.replace(/"/g, '&quot;')}">
          </div>
          ${shown.length ? `
          <div class="admin-table">
            <div class="ad-row head">
              <span>${t('admin.user')}</span><span>${t('admin.role')}</span><span>${t('admin.status')}</span>
              <span>${t('admin.logins')}</span><span>${t('admin.lastSeen')}</span><span></span>
            </div>
            ${shown.map((a) => `
              <div class="ad-row ${selected === a.email ? 'sel' : ''}" data-user="${a.email}">
                <span class="ad-user">
                  <i class="ad-avatar" style="--hue:${(a.name.charCodeAt(0) % 6) * 47 + 20}">${a.name[0].toUpperCase()}</i>
                  <b>${esc(a.name)}</b><small>${esc(a.email)}</small>
                </span>
                <span class="tag role">${t(a.role === 'admin' ? 'admin.role.admin' : 'admin.role.user')}</span>
                <span>${statusLabel(state(a))}</span>
                <span>${(a.logins || []).length}</span>
                <span class="muted">${when(a.lastLogin)}</span>
                <span class="ad-open">›</span>
              </div>`).join('')}
          </div>` : `<p class="muted" style="padding:22px">${t('admin.noUsers')}</p>`}
        </div>

        <aside class="admin-detail">${selected ? detailHtml(getAccount(selected)) : `<p class="muted">${t('admin.selectUser')}</p>`}</aside>
      </div>

      <div class="admin-panel admin-log">
        <div class="admin-panel-head"><h3>${t('admin.log')}</h3></div>
        ${log.length ? `<div class="log-list">${log.slice(0, 40).map((l) => `
          <div class="log-row">
            <span class="log-type ${l.type}">${l.type}</span>
            <span class="log-who">${esc(l.email || '—')}</span>
            <span class="log-what">${t(`admin.event.${l.type}`) || l.type}${l.detail ? ` · ${esc(l.detail)}` : ''}</span>
            <span class="log-when muted">${when(l.at)}</span>
          </div>`).join('')}</div>` : `<p class="muted" style="padding:18px">${t('admin.noLog')}</p>`}
      </div>
    </section>`;

  // events
  const search = view.querySelector('.admin-search');
  search.addEventListener('input', () => { filter = search.value; renderAdminView(); });
  if (needle) { search.focus(); search.setSelectionRange(search.value.length, search.value.length); }

  view.querySelectorAll('[data-user]').forEach((row) =>
    row.addEventListener('click', () => { selected = row.dataset.user; renderAdminView(); }));

  view.querySelectorAll('[data-act]').forEach((btn) =>
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      runAction(btn.dataset.act, btn.dataset.email, btn.dataset.arg);
    }));
}

function detailHtml(acc) {
  if (!acc) return `<p class="muted">${t('admin.selectUser')}</p>`;
  const st = state(acc);
  return `
    <div class="ad-detail-head">
      <i class="ad-avatar lg" style="--hue:${(acc.name.charCodeAt(0) % 6) * 47 + 20}">${acc.name[0].toUpperCase()}</i>
      <div><b>${esc(acc.name)}</b><small>${esc(acc.email)}</small></div>
      ${statusLabel(st)}
    </div>

    <dl class="ad-facts">
      <div><dt>${t('admin.hash')}</dt><dd class="mono">${acc.pw || t('admin.pwnull')}</dd></div>
      <div><dt>${t('admin.role')}</dt><dd>${t(acc.role === 'admin' ? 'admin.role.admin' : 'admin.role.user')}</dd></div>
      <div><dt>${t('account.member')}</dt><dd>${when(acc.createdAt)}</dd></div>
      <div><dt>${t('admin.lastSeen')}</dt><dd>${when(acc.lastLogin)}</dd></div>
      ${acc.until ? `<div><dt>${t('admin.timeout')}</dt><dd>${when(acc.until)}</dd></div>` : ''}
      ${acc.message ? `<div><dt>${t('admin.message')}</dt><dd>${esc(acc.message)}</dd></div>` : ''}
    </dl>

    <div class="ad-actions">
      <button class="btn btn-ghost btn-sm" data-act="kick" data-email="${acc.email}">${t('admin.kick')}</button>
      ${st === 'banned'
        ? `<button class="btn btn-ghost btn-sm" data-act="unban" data-email="${acc.email}">${t('admin.unban')}</button>`
        : `<button class="btn btn-danger btn-sm" data-act="ban" data-email="${acc.email}">${t('admin.ban')}</button>`}
      <button class="btn btn-ghost btn-sm" data-act="promote" data-email="${acc.email}">${t(acc.role === 'admin' ? 'admin.demote' : 'admin.promote')}</button>
      <button class="btn btn-ghost btn-sm" data-act="message" data-email="${acc.email}">${t('admin.message')}</button>
      <button class="btn btn-ghost btn-sm" data-act="resetpw" data-email="${acc.email}">${t('admin.resetpw')}</button>
      <button class="btn btn-ghost btn-sm" data-act="clearhistory" data-email="${acc.email}">${t('admin.clearHistory')}</button>
      <button class="btn btn-danger btn-sm" data-act="delete" data-email="${acc.email}">${t('admin.delete')}</button>
    </div>

    <div class="ad-timeouts">
      <span class="muted">${t('admin.timeout')}:</span>
      ${[['1h', 'admin.hour'], ['24h', 'admin.day'], ['7d', 'admin.week'], ['perm', 'admin.permanent']].map(([v, k]) =>
        `<button class="chip-btn" data-act="timeout" data-arg="${v}" data-email="${acc.email}">${t(k)}</button>`).join('')}
    </div>

    <div class="ad-sub">
      <h4>${t('admin.sessions')}</h4>
      <div class="ad-sessions">${(acc.logins || []).slice(-8).reverse().map((ts) => `<span class="ad-session">${when(ts)}</span>`).join('') || `<span class="muted">—</span>`}</div>
    </div>

    <div class="ad-sub">
      <h4>${t('admin.history')}</h4>
      ${(acc.history || []).length
        ? `<div class="history-list">${acc.history.slice(0, 12).map((h) => `
            <div class="history-row"><span class="hr-dot"></span>
              <div><b>${esc(h.title)}</b><small>${h.type === 'tv' ? t('modal.badge.tv') : t('modal.badge.movie')} · ${when(h.at)}</small></div>
            </div>`).join('')}</div>`
        : `<p class="muted">${t('account.historyEmpty')}</p>`}
    </div>`;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
let armed = null; // two-step confirmation for destructive actions

async function runAction(act, email, arg) {
  const acc = getAccount(email);
  if (!acc) return;
  const me = getUser();
  const self = me && me.email === email;

  if (act === 'delete') {
    if (armed !== email) {
      armed = email;
      toast(`⚠ ${t('admin.delete')} — ${t('admin.confirm')}`, 3200);
      return;
    }
    armed = null;
    const all = listAccounts();
    delete all[email];
    localStorage.setItem('sv:accounts', JSON.stringify(all));
    logEvent('delete', email, acc.name);
    if (self) signOut({ silent: true });
    selected = null;
    toast(`🗑 ${t('admin.deleted')}`);
    enforceSession(); renderUserArea(); renderAdminView();
    return;
  }
  armed = null;

  switch (act) {
    case 'kick': {
      acc.status = 'kicked'; acc.until = null;
      logEvent('kick', email, acc.name);
      toast(`👋 ${acc.name} — ${t('admin.kick')}`);
      break;
    }
    case 'timeout': {
      const map = { '1h': 3600e3, '24h': 86400e3, '7d': 604800e3, perm: null };
      if (arg === 'perm') { acc.status = 'banned'; acc.until = null; logEvent('ban', email, acc.name); }
      else { acc.status = 'timeout'; acc.until = Date.now() + map[arg]; logEvent('timeout', email, `${acc.name} · ${t(`admin.${arg === '1h' ? 'hour' : arg === '24h' ? 'day' : 'week'}`)}`); }
      toast(`⏳ ${acc.name}`);
      break;
    }
    case 'ban': { acc.status = 'banned'; acc.until = null; logEvent('ban', email, acc.name); toast(`⛔ ${acc.name}`); break; }
    case 'unban': { acc.status = 'active'; acc.until = null; logEvent('unban', email, acc.name); toast(`✅ ${acc.name}`); break; }
    case 'promote': {
      acc.role = acc.role === 'admin' ? 'user' : 'admin';
      logEvent(acc.role === 'admin' ? 'promote' : 'demote', email, acc.name);
      toast(`★ ${acc.name} → ${t(acc.role === 'admin' ? 'admin.role.admin' : 'admin.role.user')}`);
      break;
    }
    case 'message': {
      // Inline composer (window.prompt is blocked inside sandboxed previews)
      const host = document.querySelector('.admin-detail');
      if (!host) return;
      if (host.querySelector('.ad-msg')) { host.querySelector('.ad-msg textarea').focus(); return; }
      const box = document.createElement('div');
      box.className = 'ad-msg';
      box.innerHTML = `<textarea class="ad-msg-input" rows="2" placeholder="${esc(t('admin.message'))}">${esc(acc.message || '')}</textarea>`;
      const send = document.createElement('button');
      send.className = 'btn btn-gold btn-sm';
      send.textContent = t('admin.message');
      send.addEventListener('click', () => {
        const text = box.querySelector('textarea').value.trim();
        if (!text) return;
        acc.message = text;
        acc.notices = [...(acc.notices || []), { at: Date.now(), text }];
        saveAccount(acc);
        logEvent('message', email, text);
        toast(`📩 ${t('admin.sent')}`);
        renderAdminView();
      });
      box.appendChild(send);
      host.insertBefore(box, host.firstChild);
      box.querySelector('textarea').focus();
      return;
    }
    case 'resetpw': {
      const fresh = 'vault-' + Math.random().toString(36).slice(2, 8);
      acc.pw = await hashPw(fresh);
      acc.pwPlainHint = fresh; // displayed once to the owner, never used for auth
      logEvent('reset', email, acc.name);
      toast(`🔑 ${acc.name}: ${fresh}`, 8000);
      break;
    }
    case 'clearhistory': { acc.history = []; logEvent('clearhistory', email, acc.name); toast(`🧽 ${acc.name}`); break; }
  }

  saveAccount(acc);
  enforceSession();
  renderUserArea();
  renderAdminView();
}

function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// keep the console fresh when the session changes underneath it
window.addEventListener('sv:session', () => {
  if (document.getElementById('view-admin')?.classList.contains('active')) renderAdminView();
});
