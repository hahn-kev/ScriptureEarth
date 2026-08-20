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
```bash
npm install
npm run extract        # DB -> content/ + public/search-index.json  (also runs automatically before build)
npm run dev            # local dev server
npm run build          # -> dist/   (runs extract first via prebuild)
npm run preview        # serve dist/
```
`npm run extract:i18n` regenerates the per-locale UI catalogs — but see the note below; you rarely need it.

## Layout
- `src/pages/` — routes: `/` (lean search-first home), `/browse/` (full grid), `/language/<slug>/`
  (per-entry, slug = `<iso>[-<rod>][-<var>]`), `/country/<CC>/`.
- `src/components/`, `src/layouts/`, `src/lib/` — card, switcher, base layout, UI helpers.
- `public/` — static assets: `site.css`, `i18n.js` (client localizer), `favicon.ico`, `sil-logo.webp`,
  and **`i18n/*.json`** (see below). `search-index.json` is generated (git-ignored).
- `functions/_middleware.js` + `public/_redirects` — Cloudflare legacy-URL redirects (see `REDIRECTS.md`).
- `scripts/` — `extract.py` (`--source=dump|api` → content JSON), `extract_i18n.py`, `harvest/` (API client).
- `content/`, `content-api/`, `data/`, `public/search-index.json` — **generated / local; git-ignored.**

## i18n (important)
UI shows in English by default; the other locales are a **client-side** enhancement (`i18n.js` swaps text
from `public/i18n/*.json`). Those catalogs are **code-owned** — committed to the repo and edited here; the
DB `translations_*` tables were a one-time seed (`extract_i18n.py`), **not** re-run on every build.

## Deploy
See `deploy.md` (Cloudflare Pages via Wrangler direct upload). Design/rationale: `RESULTS-capstone.md`.
