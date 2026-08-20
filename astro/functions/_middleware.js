// ScriptureEarth — Cloudflare Pages Function (ticket 08, §3.3-3.5)
// Handles the legacy QUERY-STRING deep links that public/_redirects cannot match
// (_redirects is path-only). These queries only ever land on the legacy PHP entry
// points (index.php, 00<loc>.php, and the alias index files), so we use ONE root
// _middleware.js and bail out immediately (next()) for every non-.php request —
// this keeps Functions off the hot path for pages/assets while still covering
// *every* locale page in a single file (spec §3.3 "one function file covers all").
//
// Why _middleware.js (not functions/index.php.js): the deep links appear on ~17
// different .php paths; a middleware with a cheap `.php` guard covers them all,
// whereas a per-path file would need 17 near-identical files. Trade-off: a root
// middleware is invoked on every request. The guard makes non-.php requests a
// single string check + next(); if Functions-invocation cost on static assets
// ever matters, narrow this to functions/index.php.js (the primary target per
// index.php L3) and accept that 00*.php deep-link queries are the rarer residual.
//
// Slug strategy (B): iso->slug is pure string assembly (no DB/idx lookup), so this
// stays tiny. Legacy forms mapped (see research/08 §2):
//   L6 ?sortby=lang&iso=&rod=&var=   |  ?name=&ROD_Code=&Variant_Code= (verbose synonym)
//   L6 ?idx= / ?ISO_ROD_index=       (rare, machine-generated — client-resolved)
//   L7 ?sortby=country&name=<CC>

export const onRequest = (context) => {
  const { request, next } = context;
  const url = new URL(request.url);

  // Only legacy PHP entry points carry these deep-link queries. Everything else
  // (static pages, assets, the vanity paths handled by _redirects) falls through.
  if (!url.pathname.endsWith('.php')) return next();

  const q = url.searchParams;
  const redir = (path, status) =>
    new Response(null, { status, headers: { Location: path } });

  // L7 — country deep link: ?sortby=country&name=<CC>  (name=all -> whole grid)
  if (q.get('sortby') === 'country') {
    const cc = (q.get('name') || '').trim();
    if (!cc || cc.toLowerCase() === 'all') return redir('/browse/', 301);
    return redir(`/country/${cc.toUpperCase()}/`, 301);
  }

  // L6 — idx-keyed deep links (rare, machine-generated). Target slug is the iso
  // string, not the integer, so this is the one form still needing a lookup. Hand
  // off to a static /language/ landing whose JS reads ?idx= and resolves it against
  // the already-shipped search-index.json (keyed by idx) -> location.replace(slug).
  // (That client resolver is built elsewhere; we only route to it here.) 302 while
  // provisional — promote to a true 301 here if logs show real ?idx= traffic.
  const idx = q.get('idx') || q.get('ISO_ROD_index');
  if (idx && /^\d+$/.test(idx)) return redir(`/language/?idx=${idx}`, 302);

  // L6/L3 — iso-keyed deep links. Accept both the canonical (?iso=&rod=&var=) and
  // the verbose synonym (?name=&ROD_Code=&Variant_Code=).
  const iso = (q.get('iso') || q.get('name') || '').trim().toLowerCase();
  if (iso) {
    let rod = (q.get('rod') || q.get('ROD_Code') || '').trim();
    const varc = (q.get('var') || q.get('Variant_Code') || '').trim().toLowerCase();
    // Legacy holds segment position when a variant exists but rod is absent:
    // /acr-00000-a came from ?iso=acr&var=a  (rod defaults to 00000).
    if (varc && !rod) rod = '00000';
    let slug = iso;
    if (rod) slug += `-${rod}`;
    if (varc) slug += `-${varc}`;
    // Bare ?iso= (no rod/var) is ambiguous for the 96 multi-ROD isos, so send it
    // to the grid filtered by iso (the new 00-moreThanOneRODCode.php) — always a
    // valid target, avoids 404 on ambiguous codes. 302 (provisional target).
    // Single-target iso+rod[+var] gets a clean 301 to the exact detail page.
    if (!rod && !varc) return redir(`/browse/?iso=${iso}`, 302);
    return redir(`/language/${slug}/`, 301);
  }

  // Recognized .php path but no deep-link query (e.g. /00eng.php, /index.php):
  // let public/_redirects map it to / + ?lang=.
  return next();
};
