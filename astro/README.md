# ScriptureEarth — static Astro site (PoC)

Static rebuild of the ScriptureEarth **public discovery site**: Astro-generated, Cloudflare-hosted,
client-side search, built from the ScriptureEarth database. Proof-of-concept produced by the
`/wayfinder` planning effort (decision records live in `.scratch/scriptureearth-rewrite/`).

## Prerequisites
- **Node 18+** and **Python 3** (the extractor is Python).
- A **data source** (one of):
  - `data/scripture.db` — a SQLite snapshot of the ScriptureEarth DB (git-ignored). *Default.*
  - the JSON API — harvest via `scripts/harvest/harvest.mjs` (`SE_KEY=… node harvest.mjs`), then project.
  - Override the DB path with `SE_DB=/path/to.db`.

## Build & run
Two mutually-exclusive data sources produce the **same** `content/` schema (ticket 12):
```bash
npm install

# (A) DUMP build — full parity. Needs data/scripture.db (or SE_DB=/path).
npm run build:dump           # extract.py (DB -> content/) then astro build -> dist/

# (B) API build — from the JSON API. Needs a harvest first (your key):
node scripts/harvest/harvest.mjs        # SE_KEY=… ; -> scripts/harvest/data/  (throttled, resumable)
npm run build:api                        # project.mjs (harvest cache -> content/) then astro build

npm run dev                  # dev server (build content once first: npm run extract | extract:api)
npm run preview              # serve dist/
```
- `npm run extract` / `npm run extract:api` regenerate `content/` without building.
- **DUMP** = complete (incl. `buy` links); **API** = fresher but no `buy` links (no buy endpoint) — see `RESULTS-datasource.md`.
- `npm run extract:i18n` regenerates the per-locale UI catalogs — rarely needed (see note below).

## Layout
- `src/pages/` — routes: `/` (lean search-first home), `/browse/` (full grid), `/language/<slug>/`
  (per-entry, slug = `<iso>[-<rod>][-<var>]`), `/country/<CC>/`.
- `src/components/`, `src/layouts/`, `src/lib/` — card, switcher, base layout, UI helpers.
- `public/` — static assets: `site.css`, `i18n.js` (client localizer), `favicon.ico`, `sil-logo.webp`,
  and **`i18n/*.json`** (see below). `search-index.json` is generated (git-ignored).
- `functions/index.php.js` + `public/_redirects` — Cloudflare legacy-URL redirects (see `REDIRECTS.md`).
- `scripts/` — `extract.py` (`--source=dump|api` → content JSON), `extract_i18n.py`, `harvest/` (API client).
- `content/`, `content-api/`, `data/`, `public/search-index.json` — **generated / local; git-ignored.**

## i18n (important)
UI shows in English by default; the other locales are a **client-side** enhancement (`i18n.js` swaps text
from `public/i18n/*.json`). Those catalogs are **code-owned** — committed to the repo and edited here; the
DB `translations_*` tables were a one-time seed (`extract_i18n.py`), **not** re-run on every build.

## Deploy
See `deploy.md` (Cloudflare Pages via Wrangler direct upload). Design/rationale: `RESULTS-capstone.md`.
