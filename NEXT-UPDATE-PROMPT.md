# 🎬 StreamVault — Next Update Prompt

Copy-paste everything below the line into a new request (Arena) to build the next update.

---

## PROMPT — "Round 6: bring the good stuff back onto the current build"

Work in the existing checkout of **Dev-zwoz/StreamVault** on branch
`arena/01a0cccb-streamvault`. Do all work there, commit to it and push to it.
Preview server: static HTTP on `0.0.0.0:8000` (repo root = site root).

### Current state (base, do not break)
- `HEAD = 8677002` — the **restored earlier build** the user asked for: EN/ID pill
  toggle, Top 10 + Free Classics rows, AdShield, simple Movies view
  (genre / year / sort / "Playable now"), form-based sign-in, user menu, settings,
  watchlist, logo/idle animations, preloader, hero rotation.
- **Standalone player is already in and must stay**: `watch.html` + `js/watch.js`
  (top-level player page: source switcher, resume, TV season/episode context, credits).
  `js/archive.js` exposes `listSources()` + TV-aware `vidriftUrl()`, `js/config.js`
  exports `CREDITS`.
- Reference implementations of the features below still exist in git history and
  should be **ported/improved, not blindly reverted**:
  - `603379b` → 13 languages, owner/admin console, unlimited library (tabs, sorts,
    filters, infinite scroll), avatar redesign, i18n rewrite.
  - `bac80db` → 19 languages, profile banner, extra motion, standalone player.
  Cherry-pick by file where it helps (`js/admin.js`, `js/i18n.js`, `js/app.js`),
  then re-verify everything.

### Non-negotiable rules (the user said these explicitly)
1. **Never put a `sandbox` attribute on any iframe.** Not on VidRift, not anywhere.
   Keep the code comment that says why. Use `allow`, `allowfullscreen`,
   `referrerpolicy="origin"` instead.
2. **Playback must work.** Keep `watch.html`, the **↗ Standalone player** pill in the
   player and the automatic gold "Open standalone player" notice when the site runs
   inside a nested frame (that nesting is what blocks third-party embeds).
   Public-domain films must keep playing as a native `<video>` from archive.org.
3. **No AdShield / no adblock feature at all** — user: "there no ads". Delete the
   code, the settings switch, the navbar counter and the i18n keys.
4. **No Free Classics section** — remove the row, the navbar link, footer links,
   hero CTA and `.classics*` strings. Free playable titles live inside normal rows
   and behind a "Playable now" filter.
5. **Genre tiles show no numbers/counts** — icon + name only.
6. **"How It Works" must be filled** — 4 steps, actually visible (no empty boxes):
   Open the door → Pick your lane → Press play → Keep your shelf. If the steps are
   static markup, make sure the IntersectionObserver reveals `.step` children.
7. **Social logos must really navigate** to
   `https://github.com/Dev-zwoz` · `https://discord.com/users/1469638087268110399` ·
   `https://www.instagram.com/vzowzz/` (forced `window.open` + `window.top.location`
   fallback, `target="_blank" rel="noopener"`).
8. **Credit VidRift to Rust (cinrift)** with
   `https://discord.com/users/1515548260196941864` in the player, the standalone
   page, the footer and the README.
9. **Profile/avatar must look premium.** No per-name hue colors (that produced a
   yellow-green oval). Use one brand gradient, a clean ring, fixed square size,
   and a proper account header.

### Work items

**A. Admin / owner console**
- Bring back `js/admin.js`: owner-only view listing **every account** with name,
  email, **SHA-256 password hash**, role, status, sign-in log, watch history and
  notices, plus a live event log.
- Actions: **kick, timeout (1 h / 24 h / 7 d / permanent), ban / unban,
  promote / demote, send message, reset password, clear history, delete account**.
- Message composer must be inline (no `window.prompt` — it is blocked in previews).
- Seed the owner demo account on first load: `admin@streamvault.local` / `vaultmaster`,
  and show it in the README.

**B. More languages**
- Go to **19 interface languages**: English, Bahasa Indonesia (both complete) +
  Español, Português (BR), Français, Deutsch, Русский, Türkçe, हिन्दी, 日本語, 한국어,
  中文, العربية (RTL), Tiếng Việt, ไทย, Filipino, Nederlands, Polski, Українська.
- Every pack must cover nav, hero, rows, library tabs, sorts, filters, player,
  account, settings, toasts; fall back to English for long-form copy.
- Show pack coverage in the language menu; the TMDB `language=` param follows the UI.
- Run the key audit (`/tmp/keys.cjs` style script) after every i18n edit — it must
  print **ALL STATIC KEYS PRESENT**.

**C. Movies / TV / Anime — required features**
- Tabs: **All · Movies · TV Shows · Anime**.
- **Show ALL content, not limited** — infinite "Load more"/scroll, no hard cap.
- **Sort**: Popularity, Rating, Newest, Oldest, A–Z, Most voted, Revenue (release date).
- **Filters**: Genre, **Age rating (G / PG / PG-13 / R / NC-17** via TMDB
  certifications**), Language (30+ languages), Minimum score, Year range,
  "Playable now", plus a Reset button and a live result count.

**D. Motion pass (more animation everywhere)**
- transform/opacity only, easing `cubic-bezier(0.22,1,0.36,1)`, all disabled under
  `prefers-reduced-motion` **and** the settings-driven `html.force-reduced-motion`.
- Include: aurora/orbs drift, ticker marquee, card shine + tilt, rank breathing,
  genre/feature/step hovers, eyebrow sheen, CTA pulse, chip sheens, stat pop,
  modal/toast entrances, player chrome entrance, avatar hover, pulse rings.

**E. Fixes & polish**
- Clear-history toast must say something correct (not "Message sent").
- Make everything look good: consistent spacing/typography, no clipped text,
  mobile-first (check 360 px), RTL mirrored for Arabic, focus states visible.

### Verification before you commit
- Write/extend a jsdom harness (jsdom is installed at `/tmp/node_modules`) with the
  TMDB / archive.org / Disify responses stubbed, and require **all checks green**:
  boot without console errors, hero rotation, rows filled, Top 10, genre tiles
  without numbers, How-It-Works steps visible, AdShield **absent**, Free Classics
  **absent**, admin console (list users, hashed credential, kick/timeout/message),
  library tabs + sort + cert + language + score + year filters, load-more grows the
  list, 19 languages (Indonesian copy, Vietnamese copy, Arabic RTL), player iframe
  **without sandbox**, source chips, PD title → native `<video>` on archive.org,
  and a separate `watch.html` test (chips, VidRift url with `brand=StreamVault`,
  resume via `postMessage`, credits).
- Then: commit to `arena/01a0cccb-streamvault`, push, and reply **point by point**
  to every item above with what changed, plus the live preview link and the real
  reason playback is blocked inside nested preview iframes.

### Definition of done
The site looks premium, plays free films for real, has an owner console, 19
languages, an unlimited sortable/filterable Movies–TV–Anime library, no AdShield,
no Free Classics, no numbers on genre tiles, a filled How-It-Works, working social
links and the VidRift/Rust credit — all verified by an automated harness and pushed
to the branch.

---

### Quick reference (values the implementation needs)

| Thing | Value |
| --- | --- |
| TMDB key | `d722b1fbda5442499e514e438a092a5a` (in `js/config.js`, verified by `/configuration`) |
| VidRift embed | `https://embed.vidrift.in/embed/movie/{tmdbId}` · TV `…/embed/tv/{id}/{s}/{e}` |
| VidRift params | `title`, `brand=StreamVault`, `brandColor=F5C518`, `brandLogo`, `mobileSheets=1` |
| VidRift postMessage | `vidrift:progress`, `vidrift:ended`, `vidrift:nextup`, `vidrift:nextup-play`, `vidrift:resume`, `vidrift:quality-preference`, `vidrift:nextup-info` (origin `https://embed.vidrift.in`) |
| Brand | bg `#0B0B0F`, surface `#15151C`, gold `#F5C518` / `#D4AF37`, text `#F5F5F7`, muted `#9A9AA5`, glow `#6D28D9` → `#2563EB` |
| Socials | GitHub `https://github.com/Dev-zwoz` · Discord `https://discord.com/users/1469638087268110399` · Instagram `https://www.instagram.com/vzowzz/` |
| VidRift credit | Rust (cinrift) — `https://discord.com/users/1515548260196941864` |
| Free playable films | `data/public-domain-map.json` → Internet Archive metadata API → best MP4 |
| Where to watch | TMDB `/movie/{id}/watch/providers`, "Powered by JustWatch" |
| Standalone player | `watch.html?type=movie&id={tmdbId}&title={title}` (add `&s=&e=` for TV) |
