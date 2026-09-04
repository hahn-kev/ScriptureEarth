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

const regions = JSON.parse(read('scripts/data/country-regions.json'));
delete regions._note;

// Sanity: every country we actually render should have a region.
const countries = JSON.parse(read('content/countries.json'));
const missing = countries.map((c) => c.code).filter((c) => !regions[c]);
if (missing.length) {
  console.error(`WARN ${missing.length} countries missing a region: ${missing.join(', ')}`);
}

// Display order for continent groups.
const order = ['Africa', 'Americas', 'Asia', 'Europe', 'Oceania'];

const out = { order, tz, regions };
writeFileSync(path.join(root, 'src/data/geo.json'), JSON.stringify(out), 'utf8');
console.error(
  `geo.json  ${Object.keys(tz).length} zones, ${Object.keys(regions).length} countries` +
    (missing.length ? `  (${missing.length} missing region)` : ''),
);
