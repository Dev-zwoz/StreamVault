/* ============================================================================
   StreamVault — animations.js
   Preloader, scroll reveals, navbar behaviour, hero motion (word reveal,
   parallax, magnetic CTA), count-up stats, ripple, cursor glow, Discord pill.
   CSS + vanilla JS only; everything respects prefers-reduced-motion.
   ============================================================================ */

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;

// ---------------------------------------------------------------------------
// Preloader — vault unlock sequence, once per session, skippable, max 1.8s
// ---------------------------------------------------------------------------
export function initPreloader() {
  const pre = document.getElementById('preloader');
  if (!pre) return;
  if (reducedMotion || sessionStorage.getItem('sv:seen-intro')) {
    pre.remove();
    return;
  }
  sessionStorage.setItem('sv:seen-intro', '1');
  const logo = pre.querySelector('.sv-logo');
  const done = () => {
    pre.classList.add('done');
    setTimeout(() => pre.remove(), 600);
  };
  // "unlock" near the end of the sequence
  setTimeout(() => logo.classList.add('unlock'), 1050);
  setTimeout(done, 1800);
  pre.addEventListener('click', done, { once: true });
}

// ---------------------------------------------------------------------------
// Navbar shrink + scroll progress + logo click unlock
// ---------------------------------------------------------------------------
export function initNavbar() {
  const nav = document.getElementById('navbar');
  const bar = document.getElementById('scroll-progress');
  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      nav.classList.toggle('scrolled', scrollY > 24);
      const h = document.documentElement;
      const max = h.scrollHeight - h.clientHeight;
      bar.style.transform = `scaleX(${max > 0 ? scrollY / max : 0})`;
    });
  };
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // logo click → unlock spin
  document.querySelectorAll('.sv-logo').forEach((logo) => {
    logo.addEventListener('click', () => {
      logo.classList.remove('unlock');
      void logo.offsetWidth; // restart animation
      logo.classList.add('unlock');
      setTimeout(() => logo.classList.remove('unlock'), 1200);
    });
  });
}

// ---------------------------------------------------------------------------
// Section reveals + stats count-up
// ---------------------------------------------------------------------------
export function initReveals() {
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      e.target.classList.add('in');
      io.unobserve(e.target);
      if (e.target.id === 'stats') countUp(e.target);
    });
  }, { rootMargin: '-40px' });
  document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
}

function countUp(section) {
  section.querySelectorAll('[data-count]').forEach((el) => {
    const target = Number(el.dataset.count);
    const suffix = el.dataset.suffix || '';
    if (reducedMotion || target === 0) { el.textContent = target.toLocaleString() + suffix; return; }
    const dur = 1600, start = performance.now();
    const tick = (now) => {
      const p = Math.min((now - start) / dur, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(target * eased).toLocaleString() + suffix;
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

// ---------------------------------------------------------------------------
// Hero: word-by-word title reveal, mouse parallax, magnetic CTA
// ---------------------------------------------------------------------------
export function splitHeroTitle(text) {
  const h = document.getElementById('hero-title');
  h.innerHTML = '';
  text.split(' ').forEach((word, i) => {
    const wrap = document.createElement('span');
    wrap.className = 'w';
    const inner = document.createElement('span');
    inner.textContent = word;
    inner.style.animationDelay = `${120 + i * 110}ms`;
    wrap.appendChild(inner);
    h.appendChild(wrap);
    h.appendChild(document.createTextNode(' '));
  });
}

export function initHeroMotion() {
  if (!finePointer || reducedMotion) return;
  const bg = document.getElementById('hero-bg');
  const inner = document.querySelector('.hero-inner');
  const hero = document.getElementById('hero');
  let raf = 0;
  hero.addEventListener('mousemove', (e) => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const nx = (e.clientX / innerWidth - .5), ny = (e.clientY / innerHeight - .5);
      bg.style.transform = `translate(${nx * -14}px, ${ny * -10}px)`;      // backdrop 1–2%
      inner.style.transform = `translate(${nx * 18}px, ${ny * 12}px)`;     // content opposite 3–5%
    });
  });
  hero.addEventListener('mouseleave', () => { bg.style.transform = ''; inner.style.transform = ''; });

  // magnetic CTA (follows cursor within 8px)
  document.querySelectorAll('[data-magnetic]').forEach((btn) => {
    btn.addEventListener('mousemove', (e) => {
      const r = btn.getBoundingClientRect();
      const dx = (e.clientX - r.left - r.width / 2) / (r.width / 2);
      const dy = (e.clientY - r.top - r.height / 2) / (r.height / 2);
      btn.style.transform = `translate(${dx * 8}px, ${dy * 8}px)`;
    });
    btn.addEventListener('mouseleave', () => { btn.style.transform = ''; });
  });
}

// ---------------------------------------------------------------------------
// Button ripple (event delegation)
// ---------------------------------------------------------------------------
export function initRipples() {
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn');
    if (!btn || reducedMotion) return;
    const r = btn.getBoundingClientRect();
    const d = Math.max(r.width, r.height);
    const s = document.createElement('span');
    s.className = 'ripple';
    s.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
    btn.appendChild(s);
    setTimeout(() => s.remove(), 600);
  });
}

// ---------------------------------------------------------------------------
// Desktop cursor glow follower
// ---------------------------------------------------------------------------
export function initCursorGlow() {
  if (!finePointer || reducedMotion) return;
  const glow = document.getElementById('cursor-glow');
  let x = innerWidth / 2, y = innerHeight / 2, tx = x, ty = y, running = false;
  const loop = () => {
    x += (tx - x) * .08; y += (ty - y) * .08;
    glow.style.transform = `translate(${x - 250}px, ${y - 250}px)`;
    if (Math.abs(tx - x) > .5 || Math.abs(ty - y) > .5) requestAnimationFrame(loop);
    else running = false;
  };
  addEventListener('mousemove', (e) => {
    tx = e.clientX; ty = e.clientY;
    glow.classList.add('on');
    if (!running) { running = true; requestAnimationFrame(loop); }
  }, { passive: true });
}

// ---------------------------------------------------------------------------
// Discord pill: hide on scroll down, show on scroll up
// ---------------------------------------------------------------------------
export function initDiscordPill() {
  const pill = document.getElementById('discord-pill');
  let lastY = scrollY, ticking = false;
  addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const y = scrollY;
      if (Math.abs(y - lastY) > 8) {
        pill.classList.toggle('hidden-pill', y > lastY && y > 300);
        lastY = y;
      }
    });
  }, { passive: true });
}

// ---------------------------------------------------------------------------
// View switch helper — uses the View Transitions API where supported
// ---------------------------------------------------------------------------
export function withViewTransition(fn) {
  if (document.startViewTransition && !reducedMotion) document.startViewTransition(fn);
  else fn();
}
