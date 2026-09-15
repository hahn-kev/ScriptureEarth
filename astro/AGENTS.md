# Repository Guidelines

PoC static rebuild of the ScriptureEarth **public discovery site**: English HTML baked at build time, client MiniSearch + i18n overlays, Cloudflare Pages upload of `dist/`.

`content/` is generated and gitignored. Run an extract **before** `astro dev` / `astro build`.

## Project Overview

Catalog of languages and countries with scripture resources (read / listen / watch / apps / buy). Ingest is one consolidated JSON dump (`data/scripture.json`) projected into the `content/` schema. Live preview: https://se-proto-en.pages.dev/. Decision records live outside this tree (`.scratch/scriptureearth-rewrite/`).

## Architecture & Data Flow

**Static SSG, no adapter, no SSR.** Astro Content Layer loads two JSON arrays. English is the source of truth; locale catalogs swap chrome and names in the browser.

```
/api/db_dump.php?v=1 ── fetch_dump.mjs ──► data/scripture.json ── extract.mjs ──┬─► content/{languages,countries}.json ─► Astro pages
  (www host, SE_KEY auth)                   (one JSON object)      (projector)   └─► content/search-index.json ─► build_search_index.mjs ─► public/search-index.txt
```

**Source of truth = the consolidated JSON dump** (`data/scripture.json`), one pre-joined object from the API (see `scripts/README-dump.md`). Top-level keys are row ordinals; the real language key is `relationships.idx`. `extract.mjs` (the projector) builds asset URLs from basenames as `scriptureearth.org/data/<iso>/<PDF|audio|video>/<file>`.

**Deprecated ingest, fallback only** (not in any default build): the SQLite/`mysqldump` path (`convert_dump.mjs` + `extract_sqlite.mjs`, `npm run build:sqlite`) and the JSON API harvest (`scripts/harvest/`, `npm run build:api`).

Unlike the old SQLite path, the JSON projector does **not** emit `messages.eng.json` (UI chrome is code-owned in `public/i18n/`, and that file was unused by `src`). It also does not write `public/search-index.json` (only `search-index.json` in `content/`).

**Build:** `getCollection('languages'|'countries')` → English HTML. Language `id` = `String(idx)`; country `id` = `code`. Internal key is `idx`; vanity slug is `iso[-rod[-var]]` (ISO is not unique; dump may suffix `-{idx}`).

**Client search (home only):** lazy MiniSearch on first query, 120ms debounce, fetch `/search-index.txt` (columnar `\x1f` / tab / newline). Decode looks wrong (`length < 100`) → `/search-index.fallback.txt`. Prefix + fuzzy 0.2 + AND, cap 300. Then `window.__seApplyI18n(results)`. Header form `GET /?q=` is **not** read; only `#q` on the hero form searches.

**i18n:** sync boot in `src/layouts/Base.astro` (`?lang=` → `localStorage se-loc` → `navigator.language` → `eng`). Bundled `src/scripts/i18n.js` fetches `/i18n/chrome.<loc>.json`, `names.<loc>.json`, `autonyms.json` with `?v=` from `src/lib/i18nVersion.ts`. Name chain: locale names → autonyms → baked English. 15 locales hardcoded in **both** `Base.astro` and `i18n.js`. RTL: `arb`, `fas`. `public/i18n/locales.json` unused by `src`.

**Redirects:** `public/_redirects` (path-only, first-match-wins) + `functions/index.php.js` (query-string `/index.php` only). Functions run **before** `_redirects`. Vanity `/:iso` → `/language/<same>/` 301. Guard `200` rewrites for real routes/assets **above** the ISO catch-all. HTTP/www: Cloudflare dashboard, not this repo. Details: `REDIRECTS.md`.

## Key Directories

| Path | Role |
|---|---|
| `src/pages/` | Routes: `/`, `/browse/`, `/language/[slug]/`, `/countries/`, `/country/[code]/` |
| `src/layouts/Base.astro` | Chrome, locale boot, header search |
| `src/components/` | `LangCard.astro` (home/browse; country pages inline cards without pills) |
| `src/lib/ui.ts` | Shared vocab: `GROUPS` vs `PILLS`, action labels |
| `src/scripts/i18n.js` | Client localizer (hashed Vite bundle; never inline) |
| `src/content.config.ts` | File loaders over `content/*.json` — no Zod |
| `scripts/` | Projector (`extract.mjs`), dump fetch, search-index encoder, precompress |
| `scripts/harvest/` | DEPRECATED API harvest + projector |
| `public/i18n/` | Chrome + names catalogs (committed) |
| `functions/` | Pages Function for `/index.php` |
| `bench/` | Search-index size/hash bake-off |
| `content/` | Generated catalog JSON (gitignored) |

## Development Commands

CWD is this directory (`astro/`). npm + Node 18+.

```bash
npm install

# NEW WORKTREE / fresh checkout: data/ is gitignored so it starts empty. Bootstrap the
# shared dump + playlist cache once (reads `git config se.datadir`; downloads prebuilt
# artifacts — no API key needed — only if missing). Set the shared folder once per machine:
#   git config se.datadir "C:/dev/ScriptureEarth/astro/data"   # any absolute path
# See scripts/README-dump.md § "Worktrees: share one data folder".
npm run setup:data

# Fresh build from the live JSON dump (source of truth) — needs SE_KEY only
SE_KEY=… npm run build:fresh    # fetch:dump → extract (project) → astro build
#   or step by step:
SE_KEY=… npm run fetch:dump     # www.scriptureearth.org/api/db_dump.php?v=1&key=… → data/scripture.json
npm run build:dump              # extract.mjs && build_search_index.mjs, then astro build

# Build from an existing data/scripture.json (skip fetch)
npm run extract                 # extract.mjs && build_search_index.mjs → public/search-index.txt
#   SE_SKIP_PLAYLISTS=1 npm run extract   # fast dev build (no playlist .txt fetch)
npm run build:dump

# DEPRECATED fallbacks (not in any default build):
npm run build:sqlite            # convert:dump (mysql2sqlite.awk + node:sqlite) + extract_sqlite.mjs
npm run build:api               # harvest projector (no buy rows)

npm run dev              # after extract
npm run preview          # serves dist/; not after predeploy (brotli bytes look like garbage)

npm run deploy:fresh     # fetch + extract + build + precompress + wrangler pages deploy
npm run deploy:dump      # extract + build + precompress + wrangler pages deploy
npm run deploy           # current dist/ only (still runs predeploy)
```

CI (`.github/workflows/astro-poc.yml`, astro-poc branch only) runs `build:fresh` (fetch JSON → project → build) and deploys to Cloudflare Pages **only if** `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` secrets exist (else build-only). Config: `secrets.SE_KEY` is all that's required — the endpoint (`/api/db_dump.php` on `www.scriptureearth.org`, `v=1`) is the built-in default; `vars.SE_DUMP_PATH`/`vars.SE_BASE`/`vars.SE_DUMP_URL` are optional overrides. `astro-preview.yml` and `size-benchmark.yml` use the same steps. See `scripts/README-dump.md`.

Key is env-only (`SE_KEY`); never cached.

`npm run extract:i18n` seeds DB-backed `public/i18n/names.*.json` once. Chrome catalogs and autonyms/CLDR names are separate generators — not part of every build.

## Code Conventions & Common Patterns

- Trailing slashes always (`trailingSlash: 'always'`, `build.format: 'directory'`). Links: `/language/${slug}/`.
- `GROUPS`: `read|listen|watch|use` (detail resource sections). `PILLS`: `read|listen|watch|app|buy` (cards/facets). `availability.watch` can be true with empty `resources.watch`.
- Cards: `<a class="lang" href="…">`. i18n chrome: `data-i18n`, placeholders `data-i18n-ph`, names `data-i18n-name={idx}`.
- Collection data typed as `any`. Home MiniSearch lives in an Astro `<script>` (processed); browse facets are `is:inline`.
- CSS: logical properties for RTL; light theme only. Mobile ≤760px hides `nav.main`.
- Adding a top-level dotted file under `public/` needs a `_redirects` `200` guard or `/:iso` swallows it.
- Changing chrome keys: update `scripts/i18n/en.json` (English master, not copied to public) **and** every `public/i18n/chrome.<loc>.json`. Adding a UI locale: both hardcoded locale lists + catalogs.
- `I18N_VERSION` hashes `src/scripts/i18n.js` + `public/i18n/*` via `process.cwd()` — build from repo root of this package.

## Important Files

| File | Why |
|---|---|
| `src/pages/index.astro` | Home + MiniSearch decode/load |
| `src/pages/language/[slug].astro` | `getStaticPaths` on `identity.slug` |
| `src/lib/ui.ts` | Pill/group/kind mapping |
| `src/lib/i18nVersion.ts` | Catalog cache-bust query |
| `astro.config.mjs` | Static output; JS never inlined (`assetsInlineLimit`) |
| `scripts/extract.mjs` | **Projector**: `data/scripture.json` → `content/` (builds asset URLs, fetches playlist clips) |
| `scripts/fetch_dump.mjs` | JSON dump download → `data/scripture.json` (see `scripts/README-dump.md`) |
| `scripts/extract_sqlite.mjs`, `scripts/convert_dump.mjs`, `scripts/mysql2sqlite.awk` | DEPRECATED SQLite path (`build:sqlite`) |
| `scripts/build_search_index.mjs` | JSON → `public/search-index.txt` (`auto` stays null) |
| `scripts/harvest/{harvest,project}.mjs` | API cache → `content/` |
| `scripts/precompress_dist.mjs` | In-place brotli on `dist/search-index.txt` + `_headers` |
| `public/_redirects`, `functions/index.php.js` | Legacy URL map |
| `public/_headers` | Long-cache `/_astro/*` and `/i18n/*` only |

Known gaps / fidelity notes live in `CURRENT-ISSUES.md` (JSON-projection differences vs the old SQLite extractor, CI duplication). Docs with useful detail and some drift (`public/i18n.js`, `search-index.json`): `README.md`, `deploy.md`, `REDIRECTS.md`, `scripts/harvest/README.md`, `bench/README.md`. `RESULTS-datasource.md` is linked from README and absent.

## Runtime/Tooling Preferences

- **npm** (`package-lock.json`); not Bun/pnpm/yarn.
- **Node 18+** (Astro 5 lock: `18.20.8 \| ^20.3.0 \| >=22.0.0`). ESM (`"type": "module"`). Extractors/generators are all Node `.mjs`. The default JSON path needs no extra tools.
- **`awk`** + `node:sqlite` only for the DEPRECATED `build:sqlite` fallback (`convert_dump.mjs`); Git Bash provides `awk` on Windows.
- No `tsconfig.json`, no Wrangler project file, no Git-connected Pages build. CI: `.github/workflows/astro-poc.yml` (astro-poc branch, GitHub Actions). Wrangler via `npx` (unpinned).
- Deploy from `astro/` so sibling `functions/` uploads with `dist/`. Project name `se-proto-en`. File count ~4.3k (Pages Free 20k cap).
- `predeploy` always runs before `deploy` (npm `pre*` lifecycle). Brotli is hardcoded `Content-Encoding: br` on the search index; every client gets br bytes; fallback file is for broken decoders.

## Testing & QA

No unit/e2e suite, no `test`/`lint`/`typecheck` scripts, no Zod on collections.

The only automated gate is the search-index bench:

```bash
npm run bench:search-index
# or: node bench/harness.mjs baseline combined-columnar-delimited-text
```

Needs `content/search-index.json`. Hash mismatch → exit 1. Attempt **ERROR** (missing loader) does not fail the process.

Manual smoke: `SE_KEY=… SE_LIMIT=5 node scripts/harvest/harvest.mjs`; then extract + `astro build` + `astro preview`. Harvest per-endpoint errors accumulate in `summary.json` and do not fail the process.

Untested in-repo: pages/components, i18n.js, `_redirects` / Pages Function, dump-vs-API schema equality, precompress fallback path, slug collision logic.
