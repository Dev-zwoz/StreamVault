/* ============================================================================
   StreamVault — admin.js
   Owner-only console: every account with name, email, SHA-256 password hash,
   role, status, sign-in log, watch history and notices — plus a live event log.

   Actions (all inline, no window.prompt/confirm — those are blocked in
   preview frames): kick, timeout (1h / 24h / 7d / permanent), ban / unban,
   promote / demote, inline message composer, reset password, clear history,
   delete account (two-step confirm).

   Data layer lives in account.js (getAccounts/saveAccounts/logEvent…).
   ============================================================================ */

import { t } from './i18n.js';
import {
  getUser, getAccounts, saveAccounts, getEvents, logEvent, signOut, hashPassword as hashFor,
} from './account.js';
import { toast, escapeHtml } from './ui.js';

const TIMEOUTS = [
  { label: 'admin.t1h', ms: 60 * 60 * 1000 },
  { label: 'admin.t24h', ms: 24 * 60 * 60 * 1000 },
  { label: 'admin.t7d', ms: 7 * 24 * 60 * 60 * 1000 },
  { label: 'admin.tperm', ms: 100 * 365 * 24 * 60 * 60 * 1000 },
];

const escapeAttr = (s) => escapeHtml(s).replace(/"/g, '&quot;');

const panel = () => document.getElementById('admin-panel');
const denied = () => document.getElementById('admin-denied');
const view = () => document.getElementById('view-admin');

const roleKey = (role) => (role === 'owner' ? 'admin.owner' : role === 'admin' ? 'admin.admin' : 'admin.member');

function fmtTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' +
         d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function statusChips(acc) {
  const chips = [];
  const timedOut = acc.timeoutUntil > Date.now();
  if (acc.status === 'banned') chips.push(`<span class="st-chip st-banned">${t('admin.banned')}</span>`);
  else if (timedOut) chips.push(`<span class="st-chip st-timeout" title="${fmtTime(acc.timeoutUntil)}">${t('admin.timedout')} · ${fmtTime(acc.timeoutUntil)}</span>`);
  else chips.push(`<span class="st-chip st-active">${t('admin.active')}</span>`);
  if (acc.kickedAt > (acc.signinLog[0]?.at || 0) && acc.status !== 'banned' && !timedOut) {
    chips.push(`<span class="st-chip st-kicked">👢</span>`);
  }
  return chips.join('');
}

function userCard(acc, email) {
  const isSelf = getUser()?.email?.toLowerCase() === email;
  const isOwner = acc.role === 'owner';
  const unread = (acc.notices || []).filter((n) => !n.read).length;
  const lastSeen = acc.signinLog.find((s) => s.ok);
  return `
  <article class="admin-user" data-user="${escapeHtml(email)}">
    <header class="au-head">
      <span class="user-avatar au-avatar" aria-hidden="true"><span class="ua-letter">${escapeHtml((acc.name || '?').trim()[0]?.toUpperCase() || '?')}</span></span>
      <div class="au-id">
        <b>${escapeHtml(acc.name || '—')}${isSelf ? ` <small class="muted">•</small>` : ''}</b>
        <small class="muted">${escapeHtml(acc.email)}</small>
      </div>
      <div class="au-chips">
        <span class="um-role role-${acc.role}">${t(roleKey(acc.role))}</span>
        ${statusChips(acc)}
        ${unread ? `<span class="st-chip st-unread">💬 ${unread}</span>` : ''}
      </div>
    </header>

    <div class="au-hash" title="${escapeHtml(acc.hash || '')}">
      <span class="au-hash-label">${t('admin.hash')}</span>
      <code>${escapeHtml(acc.hash || '—')}</code>
    </div>

    <div class="au-stats">
      <span><b>${(acc.signinLog || []).length}</b> ${t('admin.signins')}</span>
      <span><b>${(acc.history || []).length}</b> ${t('admin.history')}</span>
      <span><b>${(acc.notices || []).length}</b> ${t('admin.notices')}</span>
      <span class="muted">${lastSeen ? fmtTime(lastSeen.at) : t('admin.none')}</span>
    </div>

    <details class="au-details">
      <summary>${t('admin.signins')} · ${t('admin.history')} · ${t('admin.notices')}</summary>
      <div class="au-cols">
        <div>
          <h5>${t('admin.signins')}</h5>
          <ul>${(acc.signinLog || []).slice(0, 8).map((s) =>
            `<li class="${s.ok ? '' : 'bad'}">${fmtTime(s.at)} — ${s.ok ? '✓' : '✗'}</li>`).join('') || `<li class="muted">${t('admin.none')}</li>`}</ul>
        </div>
        <div>
          <h5>${t('admin.history')}</h5>
          <ul>${(acc.history || []).slice(0, 8).map((h) =>
            `<li>${escapeHtml(h.title || '')} <small class="muted">${fmtTime(h.at)}</small></li>`).join('') || `<li class="muted">${t('admin.none')}</li>`}</ul>
        </div>
        <div>
          <h5>${t('admin.notices')}</h5>
          <ul>${(acc.notices || []).slice(0, 8).map((n) =>
            `<li>${escapeHtml(n.msg || '')} <small class="muted">${fmtTime(n.at)}${n.read ? '' : ' ·●'}</small></li>`).join('') || `<li class="muted">${t('admin.none')}</li>`}</ul>
        </div>
      </div>
    </details>

    <div class="au-actions" data-actions-for="${escapeHtml(email)}">
      <button class="btn btn-ghost btn-xs" data-act="kick" ${isOwner ? 'disabled' : ''}>${t('admin.kick')}</button>
      <span class="au-timeout">
        <button class="btn btn-ghost btn-xs" data-act="timeout" ${isOwner ? 'disabled' : ''}>${t('admin.timeout')}</button>
        <select class="au-timeout-select" aria-label="${t('admin.timeout')}">
          ${TIMEOUTS.map((o, i) => `<option value="${i}" ${i === 0 ? 'selected' : ''}>${t(o.label)}</option>`).join('')}
        </select>
      </span>
      ${acc.status === 'banned'
        ? `<button class="btn btn-ghost btn-xs" data-act="unban">${t('admin.unban')}</button>`
        : `<button class="btn btn-ghost btn-xs" data-act="ban" ${isOwner ? 'disabled' : ''}>${t('admin.ban')}</button>`}
      ${acc.role === 'member'
        ? `<button class="btn btn-ghost btn-xs" data-act="promote" ${isOwner ? 'disabled' : ''}>${t('admin.promote')}</button>`
        : acc.role === 'admin' ? `<button class="btn btn-ghost btn-xs" data-act="demote" ${isOwner ? 'disabled' : ''}>${t('admin.demote')}</button>` : ''}
      <button class="btn btn-ghost btn-xs" data-act="message">${t('admin.message')}</button>
      <button class="btn btn-ghost btn-xs" data-act="resetpw">${t('admin.resetpw')}</button>
      <button class="btn btn-ghost btn-xs" data-act="clearhistory">${t('admin.clearhistory')}</button>
      <button class="btn btn-ghost btn-xs danger" data-act="delete" ${isOwner || isSelf ? 'disabled' : ''}>${t('admin.delete')}</button>
    </div>

    <div class="au-composer" data-composer-for="${escapeHtml(email)}" hidden>
      <label class="au-msg-row">
        <span class="sr-only">${t('admin.message')}</span>
        <textarea class="au-msg-input" rows="2" maxlength="280" placeholder="${escapeAttr(t('admin.message'))}…"></textarea>
      </label>
      <div class="au-composer-row">
        <button class="btn btn-gold btn-xs" data-act="send">${t('admin.send')}</button>
        <button class="btn btn-ghost btn-xs" data-act="cancel">${t('movies.reset')}</button>
      </div>
    </div>

    <div class="au-composer" data-pw-for="${escapeHtml(email)}" hidden>
      <label class="au-msg-row">
        <span class="sr-only">${t('admin.newpw')}</span>
        <input type="text" class="au-pw-input" minlength="4" placeholder="${escapeAttr(t('admin.newpw'))}">
      </label>
      <div class="au-composer-row">
        <button class="btn btn-gold btn-xs" data-act="savepw">${t('admin.save')}</button>
        <button class="btn btn-ghost btn-xs" data-act="cancel">${t('movies.reset')}</button>
      </div>
    </div>
  </article>`;
}

function eventLog() {
  const events = getEvents();
  return `
    <div class="admin-log">
      <h4><span class="live-dot" aria-hidden="true"></span>${t('admin.log')}</h4>
      <ul>${events.slice(0, 24).map((e) =>
        `<li><time>${fmtTime(e.at)}</time><span>${escapeHtml(e.text)}</span></li>`).join('') ||
        `<li class="muted">${t('admin.none')}</li>`}</ul>
    </div>`;
}

function statCard(num, label) {
  return `<div class="admin-stat"><b>${num}</b><span>${escapeHtml(label)}</span></div>`;
}

export function renderAdminView() {
  const user = getUser();
  const isOwner = user?.role === 'owner';
  if (denied()) denied().hidden = isOwner;
  if (panel()) panel().hidden = !isOwner;
  if (!isOwner) { if (panel()) panel().innerHTML = ''; return; }

  const accounts = getAccounts();
  const list = Object.entries(accounts).sort((a, b) => {
    const rank = (r) => (r[1].role === 'owner' ? 0 : r[1].role === 'admin' ? 1 : 2);
    return rank(a) - rank(b) || a[0].localeCompare(b[0]);
  });
  const admins = list.filter(([, a]) => a.role === 'admin' || a.role === 'owner').length;
  const banned = list.filter(([, a]) => a.status === 'banned').length;

  panel().innerHTML = `
    <div class="admin-stats">
      ${statCard(list.length, t('admin.users'))}
      ${statCard(admins, t('admin.admin'))}
      ${statCard(banned, t('admin.banned'))}
      ${statCard(getEvents().length, t('admin.log'))}
    </div>
    <div class="admin-grid">
      <div class="admin-users">
        ${list.map(([email, acc]) => userCard(acc, email)).join('')}
      </div>
      <aside class="admin-side">${eventLog()}</aside>
    </div>`;

  wireActions();
}

function wireActions() {
  const root = panel();
  if (!root) return;
  if (root.dataset.wired) return; // delegation survives re-renders — wire once
  root.dataset.wired = '1';

  const mutate = (email, fn) => {
    const accounts = getAccounts();
    const acc = accounts[email];
    if (!acc) return null;
    fn(acc, accounts);
    saveAccounts(accounts);
    renderAdminView();
    return acc;
  };

  const withAccount = (btn) => {
    const card = btn.closest('[data-user]');
    return card?.dataset.user;
  };

  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn || btn.disabled) return;
    const email = withAccount(btn);
    if (!email) return;
    const act = btn.dataset.act;

    if (act === 'cancel') {
      const composer = btn.closest('.au-composer');
      if (composer) composer.hidden = true;
      return;
    }
    if (act === 'message' || act === 'resetpw') {
      const card = btn.closest('.admin-user');
      const composer = card.querySelector(act === 'message' ? '[data-composer-for]' : '[data-pw-for]');
      const other = card.querySelector(act === 'message' ? '[data-pw-for]' : '[data-composer-for]');
      if (other) other.hidden = true;
      if (composer) {
        composer.hidden = !composer.hidden;
        if (!composer.hidden) composer.querySelector('textarea, input')?.focus();
      }
      return;
    }
    if (act === 'send') {
      const composer = btn.closest('[data-composer-for]');
      const input = composer?.querySelector('.au-msg-input');
      const msg = (input?.value || '').trim();
      if (!msg) { input?.focus(); return; }
      mutate(email, (acc) => {
        acc.notices = acc.notices || [];
        acc.notices.unshift({ msg, at: Date.now(), read: false });
        acc.notices = acc.notices.slice(0, 20);
      });
      logEvent(`💬 ${t('admin.msgSent')} ${email}`);
      toast(`💬 ${t('admin.msgSent')} ${email}`);
      return;
    }
    if (act === 'savepw') {
      const composer = btn.closest('[data-pw-for]');
      const input = composer?.querySelector('.au-pw-input');
      const pw = (input?.value || '').trim();
      if (pw.length < 4) { input?.focus(); return; }
      mutate(email, (acc, accounts) => {
        acc.hash = hashFor(email, pw);
        accounts[email] = acc;
      });
      logEvent(`🔑 ${t('admin.pwReset')} ${email}`);
      toast(`🔑 ${t('admin.pwReset')} ${email}`);
      return;
    }
    if (act === 'kick') {
      mutate(email, (acc) => { acc.kickedAt = Date.now(); });
      logEvent(`👢 ${email} ${t('admin.kicked')}`);
      toast(`👢 ${email} ${t('admin.kicked')}`);
      kickIfCurrent(email, 'admin.kickedYou');
      return;
    }
    if (act === 'timeout') {
      const sel = btn.parentElement.querySelector('.au-timeout-select');
      const opt = TIMEOUTS[Number(sel?.value || 0)];
      mutate(email, (acc) => { acc.timeoutUntil = Date.now() + opt.ms; });
      logEvent(`⏳ ${t('admin.timedoutSet')} ${email} (${t(opt.label)})`);
      toast(`⏳ ${t('admin.timedoutSet')} ${email}`);
      kickIfCurrent(email, 'admin.timedoutYou');
      return;
    }
    if (act === 'ban') {
      mutate(email, (acc) => { acc.status = 'banned'; });
      logEvent(`⛔ ${email} ${t('admin.bannedToast')}`);
      toast(`⛔ ${email} ${t('admin.bannedToast')}`);
      kickIfCurrent(email, 'admin.bannedToast');
      return;
    }
    if (act === 'unban') {
      mutate(email, (acc) => { acc.status = 'active'; acc.timeoutUntil = 0; });
      logEvent(`✅ ${t('admin.unbanned')} ${email}`);
      toast(`✅ ${t('admin.unbanned')} ${email}`);
      return;
    }
    if (act === 'promote') {
      mutate(email, (acc) => { acc.role = 'admin'; });
      logEvent(`⬆️ ${email} ${t('admin.promoted')}`);
      toast(`⬆️ ${email} ${t('admin.promoted')}`);
      return;
    }
    if (act === 'demote') {
      mutate(email, (acc) => { acc.role = 'member'; });
      logEvent(`⬇️ ${email} ${t('admin.demoted')}`);
      toast(`⬇️ ${email} ${t('admin.demoted')}`);
      return;
    }
    if (act === 'clearhistory') {
      mutate(email, (acc) => { acc.history = []; });
      logEvent(`🧹 ${t('admin.historyCleared')} ${email}`);
      toast(`🧹 ${t('admin.historyCleared')} ${email}`);  // correct toast — it cleared history, not "Message sent"
      return;
    }
    if (act === 'delete') {
      if (btn.dataset.confirm !== '1') {
        btn.dataset.confirm = '1';
        btn.textContent = t('admin.confirm');
        btn.classList.add('confirming');
        setTimeout(() => {
          if (btn.isConnected) { btn.dataset.confirm = ''; btn.textContent = t('admin.delete'); btn.classList.remove('confirming'); }
        }, 3000);
        return;
      }
      const accounts = getAccounts();
      delete accounts[email];
      saveAccounts(accounts);
      logEvent(`🗑 ${email} ${t('admin.deleted')}`);
      toast(`🗑 ${email} ${t('admin.deleted')}`);
      renderAdminView();
    }
  });
}

function kickIfCurrent(email, toastKey) {
  const user = getUser();
  if (user && user.email?.toLowerCase() === email.toLowerCase()) {
    signOut(true);
    toast(t(toastKey));
  }
}

// live refresh when anything in the store moves
window.addEventListener('sv:accounts', () => {
  if (view()?.classList.contains('active') && getUser()?.role === 'owner') renderAdminView();
});
window.addEventListener('sv:admin-events', () => {
  const side = document.querySelector('.admin-side');
  if (side && getUser()?.role === 'owner') side.innerHTML = eventLog();
});
