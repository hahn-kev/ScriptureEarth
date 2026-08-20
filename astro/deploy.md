# One-off Cloudflare Pages deploy (Astro English PoC)

Throwaway prototype share — the **English-only** Astro build. `dist/` is **~4,303 files
(~28 MB)**, comfortably under Cloudflare Pages' **20,000-file Free** limit, so no paid plan
and no `PAGES_WRANGLER_MAJOR_VERSION` needed. (The 100k paid-plan concern only bites at the
full 10-locale ~40k-page scale — see `../RESULTS.md`.)

Direct upload via Wrangler — **no Git, no build-on-Cloudflare.** Run from this `astro/` dir.

## Steps

**1. Clean rebuild** (→ ~4,303 files, light theme, favicon included; empties `dist/` of the
Pagefind measurement leftovers):
```bash
npm run build
```

**2. Authenticate** (one-time; opens a browser for Cloudflare OAuth):
```bash
npx wrangler login
```

**3. Create the Pages project** (once):
```bash
npx wrangler pages project create se-proto-en --production-branch main
```

**4. Deploy the built folder:**
```bash
npx wrangler pages deploy dist --project-name se-proto-en --branch main
```

Wrangler prints a public URL like `https://<hash>.se-proto-en.pages.dev` — the shareable link.

## Notes
- The URL is **public to anyone who has it** (ScriptureEarth catalog data — already public on
  scriptureearth.org, so low sensitivity).
- **Absolute paths + trailing-slash routing** work at the `pages.dev` root as-is (`/language/812/`
  → `index.html`). No base-path config needed.
- **Favicon fix:** `public/favicon.ico` (pulled from scriptureearth.org) + `<link rel="icon">` in
  `src/layouts/Base.astro` — without it, `/favicon.ico` fell through to the SPA/index fallback and
  re-shipped the 2.2 MB index page on every load. The canonical copy lives in `../shared/favicon.ico`.
- **Re-deploy** later = just re-run step 4 (project already exists).
- The **all-cards index page is 2.2 MB**; fine for a share, but pagination is a real to-do before
  production (noted in `../RESULTS.md`).
