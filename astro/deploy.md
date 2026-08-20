# Deploy to Cloudflare Pages

Live preview: **https://se-proto-en.pages.dev/** (project `se-proto-en`, already created).

Direct upload via Wrangler — **no Git integration, no build-on-Cloudflare.** The build runs locally
(it needs the DB or the API harvest), and only the finished `dist/` is uploaded. **Run everything from
this `astro/` dir** so Wrangler picks up `functions/` alongside `dist/`.

`dist/` is ~4,460 files (4,233 language pages + countries + home/browse/countries), well under the
**20,000-file Free** limit — no paid plan needed.

## Steps

**1. Authenticate** — one-time, only if not already logged in (opens a browser for Cloudflare OAuth):
```bash
npx wrangler login
```

**2. Build + deploy** — one command; pick the data source (same output schema either way):
```bash
npm run deploy:api      # API harvest cache -> build -> deploy   (fresher, no buy links)
```
```bash
npm run deploy:dump     # data/scripture.db -> build -> deploy   (full parity, incl. buy links)
```
Or deploy the current `dist/` as-is (no rebuild): `npm run deploy`.

Each publishes a new production deployment to **https://se-proto-en.pages.dev/** (~30 s), uploading
`dist/` and compiling `functions/index.php.js`. (First-time only, if recreating the project:
`npx wrangler pages project create se-proto-en --production-branch main`.)

### npm scripts
| script | does |
|---|---|
| `npm run deploy` | deploy current `dist/` (assumes you've built) |
| `npm run deploy:api` | `build:api` then deploy |
| `npm run deploy:dump` | `build:dump` then deploy |

## What ships alongside the pages
- **`public/_redirects`** (in `dist/`) — legacy path redirects: `00<loc>.php` → `/?lang=<loc>`, and the
  vanity `/‹iso›[-rod[-var]]` → `/language/‹slug›/` collapse (see `REDIRECTS.md`).
- **`functions/index.php.js`** — handles the legacy **query-string** deep links (`?iso=`, `?idx=`,
  `?sortby=country`) that `_redirects` can't read. It is **scoped to `/index.php` only** (named-file
  routing), so Pages invokes Functions solely on that path — home, pages, and assets are served as pure
  static files and are **not** counted as Functions invocations.

## Notes
- The URL is **public to anyone who has it** (ScriptureEarth catalog data — already public upstream).
- **Routing:** absolute paths + trailing slashes work at the `pages.dev` root as-is (`/language/hau/` →
  `index.html`); no base-path config.
- **Home is the lean search-first page**; the heavy full-catalog grid lives behind `/browse/`.
- **Cache caveat:** `i18n.js` and `search-index.json` are unhashed `/public` assets, so returning
  visitors may get cached copies until the production TODO (content-hash + immutable) lands.
- **Re-deploy** later = re-run steps 1 + 3.
