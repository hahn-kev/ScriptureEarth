// Builds src/data/geo.json from committed data:
//   - scripts/data/zone1970.tab       (IANA, canonical) -> IANA zone -> [ISO country codes]
//   - scripts/data/country-regions.json (hand-maintained) -> ISO country -> continent
// Output is consumed at build time (countries page grouping) and inlined for the
// client-side "Browsing from X?" guess. No runtime network, no permissions.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

// zone1970.tab: "CC1,CC2<TAB>coords<TAB>Zone/Name<TAB>comment"; first CC is primary.
const tz = {};
for (const line of read('scripts/data/zone1970.tab').split('\n')) {
  if (!line || line[0] === '#') continue;
  const [codes, , zone] = line.split('\t');
  if (!zone) continue;
  tz[zone] = codes.split(',');
}

// backward: "Link<ws>TARGET<ws>LINKNAME" — deprecated aliases (Africa/Kinshasa,
// Asia/Calcutta, America/Buenos_Aires…) that some OSes/browsers still report.
// Point each alias at its target's country list so those visitors resolve too.
const links = [];
for (const line of read('scripts/data/backward').split('\n')) {
  if (!line.startsWith('Link')) continue;
  const [, target, name] = line.split(/\s+/);
  if (target && name) links.push([target, name]);
}
// Resolve, chasing link→link chains until a real zone or we give up.
for (const [target, name] of links) {
  if (tz[name]) continue;
  let t = target;
  for (let hop = 0; hop < 5 && !tz[t]; hop++) {
    const next = links.find(([, n]) => n === t);
    if (!next) break;
    t = next[0];
  }
  if (tz[t]) tz[name] = tz[t];
}

const regions = JSON.parse(read('scripts/data/country-regions.json'));
delete regions._note;

// names: English name for every browseable country (languages > 0). Doubles as
// the "is this a country we can link to?" set, so the hint is self-contained and
// needs neither a rendered list nor the (lazy) search index.
const countries = JSON.parse(read('content/countries.json')).filter((c) => c.languages.length > 0);
const names = {};
for (const c of countries) names[c.code] = c.name.eng;

// Sanity: every browseable country should have a region.
const missing = countries.map((c) => c.code).filter((c) => !regions[c]);
if (missing.length) {
  console.error(`WARN ${missing.length} countries missing a region: ${missing.join(', ')}`);
}

// Display order for continent groups.
const order = ['Africa', 'Americas', 'Asia', 'Europe', 'Oceania'];

const out = { order, tz, regions, names };
writeFileSync(path.join(root, 'src/data/geo.json'), JSON.stringify(out), 'utf8');
console.error(
  `geo.json  ${Object.keys(tz).length} zones, ${Object.keys(names).length} countries` +
    (missing.length ? `  (${missing.length} missing region)` : ''),
);
