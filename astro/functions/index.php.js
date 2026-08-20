// ScriptureEarth — Cloudflare Pages Function scoped to /index.php ONLY (ticket 08, §3).
//
// Handles the legacy QUERY-STRING deep links (?iso=, ?idx=, ?sortby=country) that
// public/_redirects (path-only) cannot match. Named `functions/index.php.js` so Pages
// routes Functions to `/index.php` alone — every other request (home, language/country
// pages, assets, the vanity paths handled by _redirects) is served as a pure static file
// and is NOT counted as a Functions invocation.
//
// Coverage note: legacy deep links landed on index.php. The 00<loc>.php locale homepages
// are redirected (path-only) by _redirects; their rare query-bearing deep links are an
// accepted residual (add functions/00<loc>.php.js files sharing this handler if needed).
//
// Slug strategy (B): iso -> slug is pure string assembly (no DB/idx lookup).

export const onRequest = (context) => {
  const url = new URL(context.request.url);
  const q = url.searchParams;
  const redir = (path, status) => new Response(null, { status, headers: { Location: path } });

  // L7 — country deep link: ?sortby=country&name=<CC>  (name=all -> whole grid)
  if (q.get('sortby') === 'country') {
    const cc = (q.get('name') || '').trim();
    if (!cc || cc.toLowerCase() === 'all') return redir('/browse/', 301);
    return redir(`/country/${cc.toUpperCase()}/`, 301);
  }

  // L6 — idx-keyed deep links (rare, machine-generated). Target slug is the iso string,
  // not the integer, so this one still needs a lookup: route to a /language/ landing whose
  // JS resolves ?idx= against the shipped search-index.json. 302 while provisional.
  const idx = q.get('idx') || q.get('ISO_ROD_index');
  if (idx && /^\d+$/.test(idx)) return redir(`/language/?idx=${idx}`, 302);

  // L6/L3 — iso-keyed deep links (canonical ?iso=&rod=&var= and verbose synonyms).
  const iso = (q.get('iso') || q.get('name') || '').trim().toLowerCase();
  if (iso) {
    let rod = (q.get('rod') || q.get('ROD_Code') || '').trim();
    const varc = (q.get('var') || q.get('Variant_Code') || '').trim().toLowerCase();
    if (varc && !rod) rod = '00000';               // variant present but rod omitted -> default rod
    let slug = iso;
    if (rod) slug += `-${rod}`;
    if (varc) slug += `-${varc}`;
    if (!rod && !varc) return redir(`/browse/?iso=${iso}`, 302);   // bare iso is ambiguous (multi-ROD)
    return redir(`/language/${slug}/`, 301);
  }

  // Bare /index.php with no recognized query -> home.
  return redir('/', 301);
};
