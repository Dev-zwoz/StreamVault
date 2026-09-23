<div align="center">

# 🏦 StreamVault

**Premium cinema, unlocked.**

*Unlock premium cinema. Free, forever. · Your vault of endless movies.*

[![GitHub](https://img.shields.io/badge/GitHub-Dev--zwoz-0B0B0F?logo=github&logoColor=F5C518)](https://github.com/Dev-zwoz)
[![Discord](https://img.shields.io/badge/Discord-Chat-5865F2?logo=discord&logoColor=white)](https://discord.com/users/1469638087268110399)
[![Instagram](https://img.shields.io/badge/Instagram-%40vzowzz-E4405F?logo=instagram&logoColor=white)](https://www.instagram.com/vzowzz/)

A free, ad-supported premium movie streaming platform powered by live TMDB data,
with real playable public-domain films (Internet Archive), the VidRift embed
player for HD titles, and legal "Where to Watch" links for everything else.

</div>

---

## File structure

```
StreamVault/
├── index.html               # Single-page app: Home / Movies / Watchlist views
├── logo-showcase.html       # Every logo variant on dark & light backgrounds
├── assets/
│   └── logo.svg             # Standalone brand mark (vector, animatable)
├── styles/
│   ├── base.css             # Tokens, reset, typography, layout (8px grid)
│   ├── components.css       # Navbar, hero, cards, modals, player, footer…
│   └── animations.css       # Reveals, logo motion, view transitions
├── js/
│   ├── config.js            # ⚙️ Keys, endpoints, LICENSED_SOURCES hook
│   ├── api.js               # TMDB layer: throttle, 30-min cache, fallback
│   ├── archive.js           # Playable-source resolution (PD map → VidRift)
│   ├── ui.js                # Cards, carousels, modal, watchlist, toasts
│   ├── animations.js        # Preloader, parallax, count-up, cursor glow
│   ├── player.js            # Cinema-mode player + keyboard + resume
│   ├── i18n.js              # 13 languages (EN/ID full, rest core) + RTL
│   ├── account.js           # Accounts, sessions, settings, kick/timeout/ban
│   ├── admin.js             # Owner console: users, credentials, history
│   └── app.js               # Boot, views, hero, library, search, language menu
├── data/
│   ├── fallback-movies.json # 20-entry offline catalogue (SVG posters)
│   └── public-domain-map.json # TMDB id → Internet Archive identifier
├── api/
│   └── tmdb.js              # Serverless proxy example (Vercel/Netlify)
└── README.md
```

No build step. Vanilla HTML/CSS/JS with ES modules — serve the folder with any
static server and it runs.

```bash
# local preview
python3 -m http.server 8000 --bind 0.0.0.0
# → http://localhost:8000
```

---

## Swapping the TMDB key

1. Get a free v3 key at [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api).
2. Open `js/config.js` and replace the value of `TMDB_API_KEY`.
3. Reload. The app calls `/configuration` on boot; the console logs
   `TMDB key verified ✓` on success. A 401 shows a friendly banner and the app
   switches to `data/fallback-movies.json` — the UI never goes blank.

> ⚠️ **A key in a static frontend is publicly visible.** Fine for demos
> (TMDB keys are free & rate-limited), but for production use the proxy below.

### Serverless proxy (production)

`api/tmdb.js` is a ready-to-deploy proxy for **Vercel** (works as-is in `/api`)
or **Netlify** (adapter included in the file — move to `netlify/functions/`).

1. Deploy, set the `TMDB_API_KEY` environment variable in the dashboard.
2. In `js/config.js`, point `TMDB_BASE` at `/api/tmdb`.
3. Remove the `api_key` param from `js/api.js` — the proxy injects it and adds
   a path allowlist plus 30-minute CDN caching.

---

## How playback works (and the `LICENSED_SOURCES` hook)

When a user presses play, `js/archive.js → resolveSource(tmdbId)` walks a
priority chain:

1. **`LICENSED_SOURCES`** (in `js/config.js`) — a hook for streams you have the
   rights to serve. Map a TMDB id to `{ type: 'mp4'|'hls'|'iframe', url, label }`:

   ```js
   export const LICENSED_SOURCES = {
     4808: { type: 'hls', url: 'https://cdn.example.com/charade/master.m3u8', label: 'StreamVault CDN' },
   };
   ```

2. **`data/public-domain-map.json`** — verified public-domain classics streamed
   from the Internet Archive in the native `<video>` player (keyboard shortcuts,
   resume-from-position, ambient glow).

3. **VidRift embed** (`https://embed.vidrift.in/embed/movie/{tmdbId}`) — a free
   video embed API addressed by TMDB id. StreamVault passes white-label
   branding (`brand=StreamVault&brandColor=F5C518`), listens for
   `vidrift:progress` postMessages to save watch position, and sends
   `vidrift:resume` on reopen. Public embeds carry a single ad — that's what
   keeps the platform free.

### Extending `public-domain-map.json`

```jsonc
"films": {
  "<tmdbId>": {
    "archiveId": "<archive.org item identifier>",
    "file": "movie.mp4",        // optional — omit to auto-pick the best MP4
    "title": "Movie Title",
    "year": 1950
  }
}
```

1. Find the TMDB id from the movie's URL (`themoviedb.org/movie/10331` → `10331`).
2. Find the film on [archive.org](https://archive.org) and confirm it is
   genuinely public domain.
3. The identifier is the last URL segment of the item page.
4. If `file` is omitted, `archive.js` queries the Archive metadata API at play
   time and picks the largest h.264 MP4 derivative automatically.

Currently mapped classics (12): Night of the Living Dead · His Girl Friday ·
House on Haunted Hill · Carnival of Souls · Detour · The Stranger · The Little
Shop of Horrors · Plan 9 from Outer Space · Suddenly · Nosferatu · The General
· Charade.

---

## APIs used (found via [APIVault](https://apivault.dev/))

| API | Category | Endpoint | Key? | Rate limits | Used for |
| --- | --- | --- | --- | --- | --- |
| **TMDB** | Video | `https://api.themoviedb.org/3` | ✅ v3 key (`config.js`) | ~50 req/s (we throttle to 40) | All movie data, images, providers |
| **Internet Archive** | Video / Open Data | `https://archive.org/metadata/{id}` | ❌ none | generous; HTTPS + CORS | Resolving public-domain MP4 streams |
| **VidRift** | Video | `https://embed.vidrift.in/embed/movie/{tmdbId}` | ❌ none | per-client embed rate limit | HD playback iframe for non-PD titles |
| **Disify** | Data Validation | `https://www.disify.com/api/email/{email}` | ❌ none | fair-use, HTTPS + CORS | Newsletter email validation (syntax + disposable + DNS/MX). Degrades to client-side regex if down |

**Notes per the brief:**

- **Authentication (future):** best free option researched on APIVault —
  **Supabase Auth** (generous free tier, email+OAuth, JS SDK, row-level
  security) with **Auth0** (7k free MAU) as runner-up. Watchlist/positions are
  already namespaced in `localStorage`, so migrating them to a user profile
  later is a straight key→table mapping. *Not built now, by design.*
- **URL safety checks:** Google Safe Browsing requires a keyed server-side
  integration and per-key quotas that don't fit a static frontend. Documented
  approach instead: all outbound "Where to Watch" links come exclusively from
  the TMDB/JustWatch provider API (a curated, trusted allowlist) and open with
  `rel="noopener noreferrer"`, so arbitrary-URL scanning isn't needed. If
  user-submitted links are ever added, route them through a serverless Safe
  Browsing `threatMatches:find` call first.
- Everything in this section loads lazily after the hero is interactive —
  Disify is only called on newsletter submit, Archive metadata only on play.

---

## Language support — 19 languages

The navbar globe switches the whole UI dictionary (`js/i18n.js`) **and** the
TMDB `language=` param, so titles, overviews and genre names re-localize live:

`English · Bahasa Indonesia · Español · Português (BR) · Français · Deutsch ·
Русский · Türkçe · हिन्दी · 日本語 · 한국어 · 中文 · العربية · Tiếng Việt ·
ไทย · Filipino · Nederlands · Polski · Українська`

English and Indonesian are translated in full. The other seventeen packs cover
the core shell (navigation, hero, rows, library tabs, sorts, filters, player
and account strings, toasts) and fall back to English for long-form copy; the
language menu and the settings select show each pack's coverage percentage.
Arabic switches the document to RTL automatically (`<html dir="rtl">` +
mirrored menu/rank CSS). TMDB's content language follows the UI choice, and the
library has a separate content-language filter with 30 languages.

---

## Accounts, history & the owner console

Accounts are a **client-side demo**: everything lives in `localStorage` under
`sv:accounts` (email → record), `sv:user` (session), `sv:log` (event log).
Passwords are hashed with SHA-256 (`crypto.subtle`, with a tiny fallback for
plain-http hosts) — the console shows the hash, never the plaintext.

| Role | What they can do |
| --- | --- |
| **Viewer** | Watchlist, resume positions, watch history, profile page, settings (language, quality, accent, motion) |
| **Owner (admin)** | Everything above + **Admin console**: every account in this browser with email, password hash, sign-in history, watch history — and live moderation: **kick**, **timeout** (1h / 24h / 7d / permanent), **ban / unban**, **promote / demote**, **message** (surfaces as a toast for that member), **reset password**, **clear history**, **delete account** |

Demo owner login (created automatically on first load):

```
email:    admin@streamvault.local
password: vaultmaster
```

Owner actions are enforced on the member's next interaction: `enforceSession()`
runs at boot, timeouts block playback (`playbackBlocked()`), kicks force a
sign-out, bans lock the account out entirely. Because there is no backend, the
console only sees accounts created **in that browser** — wire `js/account.js`
and `js/admin.js` to Supabase/your API for real multi-device moderation.

---

## Library — unlimited movies, TV & anime

The Library view (`#view-movies`) is deliberately **not** paginated by design:

- **Type tabs:** All · Movies · TV Shows · Anime (`/discover/tv` + animation genre + Japanese origin for anime)
- **Sort:** most popular, highest rated, newest, oldest, most voted, A–Z, biggest box office
- **Filters:** genre, age rating (G/PG/PG-13/R/NC-17, US scheme), original language, minimum score, year from/to, and **Playable now** (verified public-domain titles)
- **Infinite scroll** — the loader keeps pulling pages (up to TMDB's 500-page ceiling per query) until you stop scrolling; every result is filterable and no section is capped.

---

## Standalone player page (`watch.html`)

Browsers refuse to run a third-party player (VidRift) inside a *nested* frame —
which is exactly what happens when the site is shown inside a preview panel, an
in-app browser or any other wrapper. StreamVault therefore ships a top-level
player page:

```
watch.html?type=movie&id=550&title=Fight%20Club
watch.html?type=tv&id=1399&s=1&e=1&title=Game%20of%20Thrones
```

It carries the source switcher (Internet Archive MP4 vs VidRift HD), resume,
season/episode context and the credit line. Two entry points use it:

- the **↗ Standalone player** pill in the cinema player (always available), and
- a gold notice inside the player that appears automatically whenever the site
  detects it is running inside a nested frame.

No `sandbox` attribute is used anywhere — the player iframes carry
`allow="autoplay; fullscreen; encrypted-media; picture-in-picture"`,
`allowfullscreen` and `referrerpolicy="origin"`, which is what VidRift needs.

## Player sources

`js/archive.js` resolves the best source per title, best first:

1. **`LICENSED_SOURCES`** — streams you own the rights to (config hook)
2. **Internet Archive** — verified public-domain features, played natively in a
   `<video>` element (works even where third-party iframes are blocked)
3. **VidRift** — the HD embed for everything else, with the branded player
   (`brand=StreamVault&brandColor=F5C518`), resume + quality postMessage API,
   season/episode picker for TV and anime

The player bar lets the viewer **switch source at any time** and always offers
an “open in new tab” escape hatch. Public-domain map currently holds **18
verified features** (add more in `data/public-domain-map.json`).

> ⚠️ Never add a `sandbox` attribute to the VidRift iframe — it disables playback.

---

## Deploying

**Vercel** — `vercel deploy` from the repo root. Static files serve as-is; the
proxy in `/api/tmdb.js` activates automatically. Set `TMDB_API_KEY` env var.

**Netlify** — drag-and-drop the folder, or `netlify deploy`. For the proxy,
move `api/tmdb.js` to `netlify/functions/tmdb.js` and use the exported
`handler` adapter (commented at the bottom of the file).

**Any static host** (GitHub Pages, Cloudflare Pages, nginx…) — upload the
folder. Everything works client-side; you only lose the key-hiding proxy.

---

## Attribution & legal

- Movie data & images: [TMDB](https://www.themoviedb.org/). *This product uses
  the TMDB API but is not endorsed or certified by TMDB.*
- Watch-provider data: **Powered by [JustWatch](https://www.justwatch.com/)**.
- Public-domain streams: [Internet Archive](https://archive.org).
- Embedded playback: [VidRift](https://vidrift.net/) — built and hosted by
  **[Rust (cinrift)](https://discord.com/users/1515548260196941864)**. Huge
  thanks for keeping a free HD embed available. VidRift is not endorsed or
  certified by TMDB.
- Takedown / content reports: [message me on Discord](https://discord.com/users/1469638087268110399).

## Credits

Built by **[Dev-zwoz](https://github.com/Dev-zwoz)** ·
[Discord](https://discord.com/users/1469638087268110399) ·
[Instagram @vzowzz](https://www.instagram.com/vzowzz/)

Embedded player **VidRift** by **Rust (cinrift)** —
[Discord](https://discord.com/users/1515548260196941864). Thank you for the
free embed that makes HD playback possible.

© 2026 StreamVault — Premium cinema, unlocked.
