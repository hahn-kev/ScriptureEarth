// ScriptureEarth — Cloudflare Pages Function scoped to /index.php ONLY (REDIRECTS.md §3).
//
// Handles the legacy QUERY-STRING deep links (?iso=, ?idx=, ?sortby=country) that
// public/_redirects (path-only) cannot match. Named `functions/index.php.js` so Pages
// routes Functions to `/index.php` alone — every other request (home, language/country
// pages, assets, the vanity paths handled by _redirects) is served as a pure static file
// and is NOT counted as a Functions invocation.
//
// Lookups use content/lang-map.json, written by scripts/extract.mjs and bundled into this
// Function by wrangler at deploy time (so a deploy always needs a prior extract — same as
// dist/ itself). idx -> slug for ?idx=; iso -> slug for ISOs with one entry; `multi` lists
// ISOs shared by several entries, which go to the /language/ chooser page.
//
// Coverage note: legacy deep links landed on index.php. The 00<loc>.php locale homepages
// are redirected (path-only) by _redirects; their rare query-bearing deep links are an
// accepted residual (add functions/00<loc>.php.js files sharing this handler if needed).

import map from '../content/lang-map.json';

let slugSet = null; // lazily built once per isolate
const isSlug = (s) => (slugSet ??= new Set(Object.values(map.idx))).has(s);

export const onRequest = (context) => {
  const url = new URL(context.request.url);
  const q = url.searchParams;
  const redir = (path, status) => new Response(null, { status, headers: { Location: path } });
  const chooser = (params) => redir(`/language/?${params}`, 302); // chooser / not-found landing

  // L7 — country deep link: ?sortby=country&name=<CC>  (name=all -> whole grid)
  if (q.get('sortby') === 'country') {
    const cc = (q.get('name') || '').trim();
    if (!cc || cc.toLowerCase() === 'all') return redir('/browse/', 301);
    return redir(`/country/${cc.toUpperCase()}/`, 301);
  }

  // L6 — idx-keyed deep links (machine-generated integer key). Direct 301 via the map;
  // an unknown idx lands on the /language/ page, which shows the not-found fallback.
  const idx = q.get('idx') || q.get('ISO_ROD_index');
  if (idx && /^\d+$/.test(idx)) {
    const slug = map.idx[idx];
    return slug ? redir(`/language/${slug}/`, 301) : chooser(`idx=${idx}`);
  }

  // L6/L3 — iso-keyed deep links (canonical ?iso=&rod=&var= and verbose synonyms).
  const iso = (q.get('iso') || q.get('name') || '').trim().toLowerCase();
  if (iso) {
    let rod = (q.get('rod') || q.get('ROD_Code') || '').trim();
    const varc = (q.get('var') || q.get('Variant_Code') || '').trim().toLowerCase();
    if (varc && !rod) rod = '00000';               // variant present but rod omitted -> default rod
    if (rod || varc) {
      let slug = iso;
      if (rod) slug += `-${rod}`;
      if (varc) slug += `-${varc}`;
      if (isSlug(slug)) return redir(`/language/${slug}/`, 301);
      // Assembled slug doesn't exist (stale rod/var) — fall through to bare-iso resolution.
    }
    if (map.iso[iso]) return redir(`/language/${map.iso[iso]}/`, 301);   // one entry for this ISO
    return chooser(`iso=${encodeURIComponent(iso)}`);                    // shared ISO -> chooser; unknown -> not found
  }

  // Bare /index.php with no recognized query -> home.
  return redir('/', 301);
};
