# Redirect layer (ticket 08) — Cloudflare Pages

Implements the resolved URL-scheme decision (`issues/08-url-scheme-redirect-map.md` §Answer,
`research/08-url-redirects.md`). Two files:

- **`public/_redirects`** — path-only redirects (Cloudflare copies it to the deploy root).
- **`functions/_middleware.js`** — the one Function, for query-string deep links `_redirects` can't read.

Assumes **slug strategy (B)**: the language-detail slug *is* the legacy vanity string
`<iso>[-<rod>][-<var>]`, so `/language/kek/`, `/language/abt-3053/`, `/language/acr-00000-a/`.
This is what collapses ~3,779 legacy rows to 3 rules and removes the iso→idx lookup entirely.

## What each rule group does

### `public/_redirects`
| Group | Rows | Effect |
|---|---|---|
| L1 HTTP→HTTPS / www→apex | 0 | **Not in this file** — handled by CF "Always Use HTTPS" + one www→apex Redirect Rule (see below). |
| Precedence guards | 11 | Reserved dirs (`/browse/ /country/ /language/ /i18n/ /pagefind/`) + the 5 known top-level dotted assets. `200` = serve-in-place, stops matching, so the `/:iso` catch-all can't shadow them. |
| L3/L4/L5 homepages + aliases | 17 | 10 `00<loc>.php` + 6 localized alias index files → `/?lang=<loc>` (301); `/index.php` → `/` (302, provisional). |
| L2 vanity → detail | 3 | `/:iso-:rod-:var`, `/:iso-:rod`, `/:iso` → `/language/<same>/` (301). Most-specific first. Replaces all 3,779 legacy `Redirect 301` lines 1:1, no lookup. |

### `functions/_middleware.js` (query-string deep links)
Bails out (`next()`) on any non-`.php` request. On a `.php` path it maps:
- `?sortby=country&name=<CC>` → `/country/<CC>/` (301); `name=all`/empty → `/browse/` (301).  *(L7)*
- `?idx=` / `?ISO_ROD_index=<n>` → `/language/?idx=<n>` (302) for a **client resolver** to finish.  *(L6 idx-form)*
- `?iso=`/`?name=` (+ `rod`/`ROD_Code`, `var`/`Variant_Code`) → `/language/<slug>/` (301); bare `?iso=` → `/browse/?iso=<iso>` (302).  *(L3/L6 iso-form)*
- `.php` with no recognized query → `next()`, so `_redirects` maps it to `/` + `?lang=`.

**`?idx=` client resolver (built elsewhere, not here):** the `/language/` landing reads `?idx=`
from the URL and looks it up in the already-shipped `public/search-index.json` (keyed by `idx`),
then `location.replace('/language/<slug>/')`. Chosen over an edge lookup because these URLs are
rare/machine-generated (§3.4). The search index currently carries `idx` + `code` (iso) but **not**
`rod`/`var`/`slug` — the resolver needs a `slug` (or `rod`+`var`) field added to each index row, or
it can only resolve single-entry isos. Flag for whoever builds the resolver / extends the extractor.

## Cap headroom
Cloudflare Pages cap: **2,000 static + 100 dynamic = 2,100**.

| | Used | Cap |
|---|---|---|
| `_redirects` static rows | **31** (11 guards + 17 homepages/aliases + 3 vanity) | 2,000 |
| `_redirects` dynamic (splat/placeholder) rows | counted within the 31; ≪ 100 | 100 |
| Pages Functions files | 1 | — |

~31 of 2,000 — >98% headroom. The 2,100 cap is a non-issue once slug=(B) removes per-entry enumeration.

## Shadowing / precedence reasoning
`_redirects` placeholders are **not** anchored regex and `/:iso` matches *any* single path segment —
including top-level asset files (`site.css`, `sil-logo.webp`, …) and bare section names. First match
wins, so the fix is ordering: the **guard block sits above the vanity rules**, matching the real
routes/assets first (`200` serve-in-place) so `/:iso` never reaches them. The dashed forms
(`/:iso-:rod`) are also guarded because `sil-logo.webp` etc. contain a dash. `/index.php` and
`/00*.php` are `.php`, so the Function inspects them *before* `_redirects` (Functions run first on
Pages); with no deep-link query it calls `next()` and the static `.php` rules fire.

## Caveats for the build team
1. **Adopt slug=(B).** Everything here assumes the public route is the iso-vanity slug with `idx` kept
   internal. If the team keeps raw `[idx]` in the URL, the `?iso=`→slug map still works but the vanity
   `_redirects` rules and the `?idx=` client-resolve both need a real idx↔slug map (edge Function
   mandatory) — see research/08 §3.4.
2. **HTTP→HTTPS / www→apex** live in CF settings, not this repo: enable *SSL/TLS → Always Use HTTPS*
   and add a Bulk/Single Redirect `www.scriptureearth.org/* → https://scriptureearth.org/:splat` (301).
3. **New top-level dotted assets** must get a guard line in `_redirects`, or the `/:iso` catch-all will
   redirect them to `/language/<file>/`. Safer long-term: move the bare `/:iso` rule into the Function
   (regex `^[a-z]{2,3}(-[0-9A-Za-z]{1,5})?(-[a-z])?$` won't match dotted assets or reserved words);
   the dashed `/:iso-:rod[-var]` forms can stay as placeholders.
4. **Landing target** for the homepage redirects is `/` pending the ticket-04 landing decision; flip to
   `/browse/` in one place. `/index.php` is 302 until that target is final, then make it 301.
5. **Root `_middleware.js` runs on every request.** The `.php` guard makes non-`.php` requests a string
   check + `next()`, but every hit is still a Functions invocation. If that cost matters on a mostly
   static site, narrow to `functions/index.php.js` (primary deep-link target) per caveat in the file.
6. **`?st=<iso>`** ("start at", L4) and niche `.php` (`iso_direct.php`, `00<loc>-CTPHC.php`) are not
   mapped; they fall to the `.php`→`/`+`?lang=` rules. Add a final `/*.php / 302` safety net only if
   server-log sweep shows meaningful traffic (§5.6).
7. **Validate ordering with `wrangler pages dev` / preview** before launch — confirm `/site.css`,
   `/browse/`, `/aaa`, `/abt-3053`, `/index.php?iso=abt&rod=3053`, and `?sortby=country&name=GT` all
   resolve as intended.
