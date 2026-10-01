// Builds content/world-map.svg — the home-page world map (countries shaded by how many
// languages have Scripture, clickable through to /country/<code>/).
//
// Inputs (all committed or generated earlier in `extract`):
//   content/countries.json            — per-country language lists (from extract.mjs)
//   scripts/data/ne_110m_countries.geojson — Natural Earth 1:110m outlines, trimmed
//   scripts/data/map-points.json      — lon/lat for countries too small to have an outline
//
// Output is generated, not committed (content/ is gitignored), and imported by
// src/components/WorldMap.astro with `?url`, so Vite gives it a content-hashed
// /_astro/ name that _headers caches immutably.
//
// Design decisions: .scratch/home-language-map/ (wayfinder map) — Web Mercator cropped to
// 83.7°N…56°S, no simplification, integer coordinates (~30 KB brotli), Antarctica dropped,
// countries without an outline (or too small to see) drawn as circles, four shading buckets,
// and a baked centroid per shape for the tap-to-list hit test in src/scripts/world-map.js.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants as Z } from 'node:zlib';
import { geoMercator, geoPath } from 'd3-geo';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(path.join(root, p), 'utf8'));

const countries = read('content/countries.json');
const outlines = read('scripts/data/ne_110m_countries.geojson');
const points = read('scripts/data/map-points.json');
delete points._note;

const count = new Map(countries.map((c) => [c.code, c.languages.length]));
const nameOf = new Map(countries.map((c) => [c.code, c.name.eng]));

// --- projection: Web Mercator, 1000 wide, cropped so Greenland and Tierra del Fuego fit
const W = 1000;
const LAT_N = 83.7;
const LAT_S = -56;
const proj = geoMercator().scale(W / (2 * Math.PI)).translate([W / 2, 0]);
proj.translate([W / 2, -proj([0, LAT_N])[1]]);
const H = Math.round(proj([0, LAT_S])[1]);
const path0 = geoPath(proj).digits(0);

// --- shading buckets (languages with Scripture per country); edges match the legend
// in WorldMap.astro.
const BUCKETS = [1, 5, 20, 80];
const bucket = (n) => (n <= 0 ? 0 : BUCKETS.filter((b) => n >= b).length);

// Below this projected area (px² at width 1000) an outline is invisible on a phone,
// so the country also gets a circle at its centroid.
const AREA_MIN = 12;
const CIRCLE_R = 4;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const attrs = (n, extra = '') => `class="b${bucket(n)}${extra}" data-n="${n}"`;

// Group features by ISO code (Natural Earth splits some countries across rows).
const byCode = new Map();
for (const f of outlines.features) {
  const code = f.properties.iso;
  if (!code || code === '-99') continue;
  const g = byCode.get(code);
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  if (g) g.polys.push(...polys);
  else byCode.set(code, { name: f.properties.name, polys: [...polys] });
}

let shapes = '';
let circles = '';
const tiny = [];
for (const code of [...byCode.keys()].sort()) {
  const { name, polys } = byCode.get(code);
  const geom = { type: 'MultiPolygon', coordinates: polys };
  const d = path0(geom);
  if (!d) continue;
  const n = count.get(code) ?? 0;
  // Centroid of the LARGEST polygon, so FR/US/NO keep it on the mainland.
  let main = polys[0];
  let best = -1;
  for (const p of polys) {
    const a = path0.area({ type: 'Polygon', coordinates: p });
    if (a > best) { best = a; main = p; }
  }
  const [cx, cy] = path0.centroid({ type: 'Polygon', coordinates: main }).map(Math.round);
  const title = esc(nameOf.get(code) ?? name);
  shapes += `<path id="${code}" ${attrs(n)} data-cx="${cx}" data-cy="${cy}" d="${d}"><title>${title}</title></path>\n`;
  if (n > 0 && path0.area(geom) < AREA_MIN) {
    tiny.push(code);
    circles += `<circle id="${code}-pt" ${attrs(n, ' pt')} data-cx="${cx}" data-cy="${cy}" cx="${cx}" cy="${cy}" r="${CIRCLE_R}"><title>${title}</title></circle>\n`;
  }
}

const missing = [];
for (const c of countries) {
  if (byCode.has(c.code) || c.languages.length === 0) continue;
  const p = points[c.code];
  if (!p) { missing.push(c.code); continue; }
  const [x, y] = proj(p).map(Math.round);
  const n = c.languages.length;
  circles += `<circle id="${c.code}" ${attrs(n, ' pt')} data-cx="${x}" data-cy="${y}" cx="${x}" cy="${y}" r="${CIRCLE_R}"><title>${esc(c.name.eng)}</title></circle>\n`;
}

// Circles render last so they sit on top of neighbouring outlines.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" aria-hidden="true">\n<g>\n${shapes}</g>\n<g>\n${circles}</g>\n</svg>\n`;
writeFileSync(path.join(root, 'content/world-map.svg'), svg);

const raw = Buffer.byteLength(svg);
const br = brotliCompressSync(svg, { params: { [Z.BROTLI_PARAM_QUALITY]: 4 } }).length;
const nCircles = (circles.match(/<circle /g) || []).length;
console.log(`gen_map: ${byCode.size} outlines + ${nCircles} circles (${tiny.length} for tiny outlines), ${(raw / 1024).toFixed(1)} KiB raw, ${(br / 1024).toFixed(1)} KiB brotli q4 → content/world-map.svg`);
if (br > 40 * 1024) console.warn(`gen_map: WARNING map is ${(br / 1024).toFixed(1)} KiB brotli, over the 40 KiB budget`);
if (missing.length) {
  console.warn(`gen_map: WARNING ${missing.length} countries have no outline and no point, so they are not on the map: ${missing.join(' ')}. Add them to scripts/data/map-points.json.`);
}
