# ScriptureEarth — static Astro site (PoC)

Static rebuild of the ScriptureEarth **public discovery site**: Astro-generated, Cloudflare-hosted,
client-side search, built from the ScriptureEarth database. Proof-of-concept produced by the
`/wayfinder` planning effort (decision records live in `.scratch/scriptureearth-rewrite/`).

## Prerequisites
- **Node 18+** — all extractors/generators are Node `.mjs`. The default JSON path needs no extra tools. No Python.
- A **data source** — `data/scripture.json`, the consolidated JSON dump of the ScriptureEarth DB (git-ignored).
  Get one via **`npm run setup:data`** (downloads a prebuilt dump — no key needed) or fetch it fresh
  from the live **dump API** (needs `SE_KEY`; see [`scripts/README-dump.md`](scripts/README-dump.md)).
  Override the data dir with `SE_DATA_DIR`, or the dump path with `SE_JSON=/path/to.json`.

## Data source: the JSON dump (source of truth)
The site is built from a single pre-joined JSON dump of the production `scripture` DB, downloaded
from the API — **not** per-record scraping. Confirmed endpoint:
```
https://www.scriptureearth.org/api/db_dump.php?v=1&key=<your key>
```
`<your key>` is a row in the server's `api_users` table. Flow:
`fetch_dump.mjs` (→ `data/scripture.json`) → `extract.mjs` (projector → `content/*.json`) → `astro build`.
The dump keys entries by a row ordinal (the real key is `relationships.idx`); the projector builds asset
URLs as `scriptureearth.org/data/<iso>/<PDF|audio|video>/<file>`. Details + how to test your key:
[`scripts/README-dump.md`](scripts/README-dump.md).

Two older ingest paths are **deprecated**, fallback only (not in any default build): the SQLite/`mysqldump`
path (`npm run build:sqlite`) and the JSON API harvest (`scripts/harvest/`, `npm run build:api`).

## Build & run
```bash
npm install
npm run setup:data           # one-time: get data/scripture.json (prebuilt; no key needed)

# (A) Build from an existing data/scripture.json — source of truth.
npm run build:dump           # extract.mjs (project -> content/) then astro build -> dist/

# (B) FRESH build — re-download the live dump first (maintainers; needs SE_KEY).
SE_KEY=… npm run build:fresh  # fetch:dump -> extract -> astro build

# Deprecated fallbacks:
npm run build:sqlite         # SQLite/mysqldump path (needs awk + node:sqlite)
npm run build:api            # JSON-harvest path (no buy rows)

npm run dev                  # dev server (build content once first: npm run extract)
npm run preview              # serve dist/
```
- `npm run extract` regenerates `content/` (and `public/search-index.txt`) from `data/scripture.json` without building.
  Add `SE_SKIP_PLAYLISTS=1` for a fast dev build (skips the per-playlist `.txt` fetch).
- `npm run extract:i18n` regenerates the per-locale UI catalogs — rarely needed (see note below).

## Layout
- `src/pages/` — routes: `/` (lean search-first home), `/browse/` (full grid), `/language/<slug>/`
  (per-entry, slug = `<iso>[-<rod>][-<var>]`), `/country/<CC>/`.
- `src/components/`, `src/layouts/`, `src/lib/` — card, switcher, base layout, UI helpers.
- `public/` — static assets: `site.css`, `i18n.js` (client localizer), `favicon.ico`, `sil-logo.webp`,
  and **`i18n/*.json`** (see below). `search-index.json` is generated (git-ignored).
- `functions/index.php.js` + `public/_redirects` — Cloudflare legacy-URL redirects (see `REDIRECTS.md`).
- `scripts/` — `fetch_dump.mjs` (dump API → `data/scripture.json`), `extract.mjs` (projector → content JSON), `extract_i18n.mjs`; `extract_sqlite.mjs`/`convert_dump.mjs` + `harvest/` are deprecated fallbacks.
- `content/`, `content-api/`, `data/`, `public/search-index.json` — **generated / local; git-ignored.**

## i18n (important)
UI shows in English by default; the other locales are a **client-side** enhancement (`i18n.js` swaps text
from `public/i18n/*.json`). Those catalogs are **code-owned** — committed to the repo and edited here; the
DB `translations_*` tables were a one-time seed (`extract_i18n.py`), **not** re-run on every build.

## Deploy
See `deploy.md` (Cloudflare Pages via Wrangler direct upload). Design/rationale: `RESULTS-capstone.md`.
