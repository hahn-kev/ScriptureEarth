// "Browsing from X?" hint (home + countries pages). Pure client, no permission,
// no network: guesses country from the IANA timezone (Intl) with navigator
// language region as a tiebreaker, and offers a few same-continent neighbours
// that share the timezone. Self-contained — names and the browseable-country set
// come from geo.json, so it needs neither a rendered list nor the (lazy) search
// index. Progressive enhancement: absent JS, the page renders untouched.
//
// The mount can narrow it (used by the /ios/ app page):
//   data-geo-only="MX GT …"  suggest only these countries
//   data-geo-href="/ios/?cc={cc}"  where a country links to (default /country/{cc}/)
//   data-geo-key="…"  its own "dismissed" flag, so hiding it on one page leaves the others
// Each country link carries data-cc, so a page can catch the click and filter in place.
import geo from '../data/geo.json';

let hideKey = 'se-geo-hide';
let only = null;
let hrefTpl = '/country/{cc}/';
const known = (code) => Boolean(geo.names[code]) && (!only || only.has(code));

function regionCountry(langs) {
  for (const l of langs) {
    // en-US is the default UI locale on countless non-US devices, so it is not a
    // reliable location signal — ignore it (but keep en-GB, en-KE, en-NG, …).
    if (/^en[-_]US$/i.test(l || '')) continue;
    const m = /[-_]([A-Za-z]{2})(?:[-_]|$)/.exec(l || '');
    if (m) {
      const cc = m[1].toUpperCase();
      if (known(cc)) return cc;
    }
  }
  return '';
}

function run() {
  const mount = document.getElementById('geo-suggest');
  if (!mount) return;
  if (mount.dataset.geoOnly !== undefined) only = new Set(mount.dataset.geoOnly.split(/\s+/).filter(Boolean));
  if (mount.dataset.geoHref) hrefTpl = mount.dataset.geoHref;
  if (mount.dataset.geoKey) hideKey = mount.dataset.geoKey;
  try { if (localStorage.getItem(hideKey) === '1') return; } catch { /* private mode */ }

  let zone = '';
  try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { /* very old browser */ }
  const zoneCodes = geo.tz[zone] || [];
  const langs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ''];
  const langCC = regionCountry(langs);

  // Primary: if the browser's language region is one of this zone's countries,
  // trust it as the specific country (disambiguates zones shared by several
  // countries, e.g. West/Central Africa). Otherwise the zone's primary
  // (most-populous) country, and only as a last resort the language region alone.
  const primary = (langCC && zoneCodes.includes(langCC)) ? langCC : (zoneCodes.find(known) || langCC);
  if (!primary) return;

  // Nearby: other countries sharing the exact timezone, limited to the primary's
  // own continent (drops far-flung same-offset outliers like Indian Ocean islands
  // on Gulf time). Language region is deliberately NOT used here — en-US is the
  // default UI locale for countless non-US visitors, so it is noise as a neighbour.
  const primRegion = geo.regions[primary];
  const seen = new Set([primary]);
  const nearby = [];
  for (const c of zoneCodes) {
    if (seen.has(c) || !known(c) || geo.regions[c] !== primRegion) continue;
    nearby.push(c);
    seen.add(c);
    if (nearby.length >= 3) break;
  }

  render(mount, primary, nearby);
}

function facet(code, cls) {
  const a = document.createElement('a');
  a.className = 'facet' + (cls ? ' ' + cls : '');
  a.href = hrefTpl.replace('{cc}', code);
  a.dataset.cc = code;
  a.textContent = geo.names[code];
  return a;
}

function render(mount, primary, nearby) {
  const card = document.createElement('div');
  card.className = 'geo-card';

  const lead = document.createElement('span');
  lead.className = 'geo-lead';
  lead.setAttribute('data-i18n', 'geo.here');
  lead.textContent = 'Browsing from';
  card.append(lead, ' ', facet(primary, 'geo-primary'));

  if (nearby.length) {
    const or = document.createElement('span');
    or.className = 'geo-or';
    or.setAttribute('data-i18n', 'geo.orNearby');
    or.textContent = 'or nearby';
    card.append(document.createTextNode(' '), or, document.createTextNode(' '));
    nearby.forEach((c) => card.append(facet(c), ' '));
  }

  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'geo-x';
  x.setAttribute('aria-label', 'Dismiss');
  x.setAttribute('data-i18n-label', 'geo.dismiss');
  x.textContent = '×';
  x.addEventListener('click', () => {
    mount.hidden = true;
    mount.dataset.geoShown = '0';
    try { localStorage.setItem(hideKey, '1'); } catch { /* private mode */ }
  });
  card.appendChild(x);

  mount.replaceChildren(card);
  mount.hidden = false;
  mount.dataset.geoShown = '1';
  if (typeof window.__seApplyI18n === 'function') window.__seApplyI18n(mount);
  mount.dispatchEvent(new CustomEvent('geo-shown', { bubbles: true }));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', run);
} else {
  run();
}
