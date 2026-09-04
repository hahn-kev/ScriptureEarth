// "Browsing from X?" hint on the countries page. Pure client, no permission,
// no network: guesses country from the IANA timezone (Intl) with navigator
// language region as a tiebreaker, and offers a few same-continent neighbours
// that share the timezone. Progressive enhancement — absent JS, the full
// alphabetical-by-continent list still renders untouched.
import geo from '../data/geo.json';

const HIDE_KEY = 'se-geo-hide';

function regionCountry(langs, links) {
  for (const l of langs) {
    const m = /[-_]([A-Za-z]{2})(?:[-_]|$)/.exec(l || '');
    if (m) {
      const cc = m[1].toUpperCase();
      if (links[cc]) return cc;
    }
  }
  return '';
}

function run() {
  const mount = document.getElementById('geo-suggest');
  if (!mount) return;
  try { if (localStorage.getItem(HIDE_KEY) === '1') return; } catch { /* private mode */ }

  // Only suggest countries that are actually in the rendered list.
  const links = {};
  document.querySelectorAll('.facets a[data-code]').forEach((a) => {
    links[a.getAttribute('data-code')] = { href: a.getAttribute('href'), name: a.dataset.name || a.textContent.trim() };
  });

  let zone = '';
  try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { /* very old browser */ }
  const zoneCodes = geo.tz[zone] || [];
  const langs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ''];
  const langCC = regionCountry(langs, links);

  // Primary: first timezone country present in the list, else the language region.
  const primary = zoneCodes.find((c) => links[c]) || (links[langCC] ? langCC : '');
  if (!primary) return;

  // Nearby: other countries sharing the exact timezone, limited to the primary's
  // own continent (drops far-flung same-offset outliers), plus the language region.
  const primRegion = geo.regions[primary];
  const seen = new Set([primary]);
  const nearby = [];
  for (const c of zoneCodes) {
    if (seen.has(c) || !links[c] || geo.regions[c] !== primRegion) continue;
    nearby.push(c);
    seen.add(c);
    if (nearby.length >= 3) break;
  }
  if (langCC && !seen.has(langCC) && nearby.length < 3) { nearby.push(langCC); seen.add(langCC); }

  render(mount, links, primary, nearby);
}

function facet(code, links, cls) {
  const a = document.createElement('a');
  a.className = 'facet' + (cls ? ' ' + cls : '');
  a.href = links[code].href;
  a.textContent = links[code].name;
  return a;
}

function render(mount, links, primary, nearby) {
  const card = document.createElement('div');
  card.className = 'geo-card';

  const lead = document.createElement('span');
  lead.className = 'geo-lead';
  lead.setAttribute('data-i18n', 'geo.here');
  lead.textContent = 'Browsing from';
  card.append(lead, ' ', facet(primary, links, 'geo-primary'));

  if (nearby.length) {
    const or = document.createElement('span');
    or.className = 'geo-or';
    or.setAttribute('data-i18n', 'geo.orNearby');
    or.textContent = 'or nearby';
    card.append(document.createTextNode(' '), or, document.createTextNode(' '));
    nearby.forEach((c) => card.append(facet(c, links), ' '));
  }

  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'geo-x';
  x.setAttribute('aria-label', 'Dismiss');
  x.textContent = '×';
  x.addEventListener('click', () => {
    mount.hidden = true;
    try { localStorage.setItem(HIDE_KEY, '1'); } catch { /* private mode */ }
  });
  card.appendChild(x);

  mount.replaceChildren(card);
  mount.hidden = false;
  if (typeof window.__seApplyI18n === 'function') window.__seApplyI18n(mount);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', run);
} else {
  run();
}
