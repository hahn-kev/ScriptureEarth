# End-to-end PoC capstone — what's proven / what's stubbed (ticket 16)

One coherent Astro sample assembling every resolved decision, built from the real SQLite dump and
**verified in a real browser**. Build: **4,301 pages / 4,315 files (~22% of the 20k Free cap), 41 MB**.

## Proven (works, verified)
- **Full pipeline:** SQLite dump → **source-pluggable extractor** (`extract.py --source=dump|api`) → content
  JSON → `astro build` → 4,301 pages → deploy-ready. (API mode validated against a real harvest, ticket 18.)
- **IA (04):** four-activity-group detail records (Read/Listen/Watch/Apps & Print — verified 4 groups on
  Kekchi), country card grids, breadcrumbs, sticky TOC.
- **Home = lean search-first D (15)** + `/browse` full grid; **design system "Calm" light (10)**.
- **URLs (08):** vanity **`/language/<slug>/`** (4,054 slug pages, e.g. `kek-00000-s`; idx internal),
  `/country/<CC>/`, `/`, `/browse/`. **`_redirects`** (65 lines, ≪ 2,100 cap) + **`functions/_middleware.js`**
  for query-string deep links.
- **i18n (13/14):** single English shell + client localizer; chrome + names swap; **RTL**; and
  **i18n re-applied to dynamically-rendered search results** (verified: a result card localized to Spanish
  "Achiꞌ de Cubulco" via `window.__seApplyI18n`).
- **Search (07): MiniSearch** over the global index — verified **cross-locale** ("Хауса" → Hausa while UI=es),
  **diacritic-insensitive**, **alt-names** ("quiche" → Kꞌicheꞌ), **glottal/apostrophe** ("qeqchi" → Kekchi
  via apostrophe-stripping tokenizer), CJK per-char tokenize, prefix + fuzzy.
- **Free-tier viable** (13): 4,315 files, no per-locale page fan-out.

## Stubbed / build-team follow-ons
- **Asset hashing (the big one):** `i18n.js`, `search-index.json`, and the i18n catalogs are plain `/public`
  files → the browser cached the old `i18n.js` across rebuilds during this build (why the i18n-on-results
  test first failed). **Production must content-hash these** + `Cache-Control: immutable` and key the
  localStorage cache by the hash with a version-sweep — the decided fix (ticket 07); not wired in the PoC.
- **English-only content + partial catalogs:** chrome catalog has 14 seeded slugs (not the full 293), names
  for spa/rus/arb only. Production = full 293-phrase catalog + all 10 locales' names (code-owned per 09 amendment).
- **Result-card availability pills stay English** (hardcoded label map, not `data-i18n`) — tag them in production.
- **`/browse` full grid is heavy** (2.3 MB / ~46k nodes) — virtualize if it janks (variation C's technique).
- **Prod extractor** reads MariaDB/API (PoC reads SQLite); add **retry/tolerance for `general_links` 500s**
  and a **dump-freshness guard** (ticket 18); media stays link-out via `ASSET_BASE`.
- **Deploy is user-run** — `deploy.md` has the Wrangler steps (needs your Cloudflare auth); `functions/` deploys
  from the project root alongside `dist/`.

## Run
```
python extract.py            # (or --source=api)  -> content/
python extract_i18n.py       # per-locale catalogs -> public/i18n/
cd astro && npm install && npm run build   # -> dist/  (4,301 pages)
python -m http.server 8600 -d dist         # browse; deploy per deploy.md
```
