// Projects the consolidated JSON dump (data/scripture.json) into content-JSON
// documents (languages, countries, search-index). This is the CURRENT source of
// truth — the ScriptureEarth /api/db_dump.php endpoint returns one pre-joined JSON
// object (keyed by a row ordinal; the real language key is relationships.idx), the
// same data the live site's per-language nav renders. See scripts/README-dump.md.
//
// The old SQLite/mysqldump path (extract_sqlite.mjs) and JSON harvest (harvest/)
// are DEPRECATED. This projector emits the identical content/ schema they did, so
// src/ (pages, search, i18n) is unchanged.
//
// Run: node scripts/extract.mjs   (then build_search_index.mjs — `npm run extract`)
import { mkdirSync, writeFileSync, statSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaylistClips } from './playlistTxt.mjs';
import { dataPaths } from './data-dir.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = dataPaths();
const SRC = process.env.SE_JSON || DATA.json;
const OUT = path.join(HERE, '..', 'content');
const ASSET_BASE = 'https://scriptureearth.org';
const PLAYLIST_CACHE = DATA.playlistCache;

// language_name locale keys → our locale codes (matches extract_sqlite.mjs LN_*).
const LN = {
  English: 'eng', Spanish: 'spa', Portuguese: 'por', French: 'fra', Dutch: 'nld',
  German: 'deu', Chinese: 'cmn', Korean: 'kor', Russian: 'rus', Arabic: 'arb',
};
const AUTONYM_KEY = 'autonym(s)';

mkdirSync(OUT, { recursive: true });
const t0 = Date.now();

const raw = JSON.parse(readFileSync(SRC, 'utf8'));
if (raw && typeof raw === 'object' && !Array.isArray(raw) && '__error' in raw) {
  console.error(`ERROR: ${SRC} looks like an API error payload, not a dump.`);
  process.exit(1);
}
// Top-level object is keyed by a row ordinal, NOT the idx. Take the values.
const entries = Array.isArray(raw) ? raw : Object.values(raw);
if (!entries.length) {
  console.error(`ERROR: ${SRC} has no entries.`);
  process.exit(1);
}

const base = (f) => String(f || '').trim().replace(/\\/g, '/').split('/').pop();
// Numeric-keyed maps ({"0":"a","1":"b"}) → array of non-empty string values.
function vals(m) {
  if (!m || typeof m !== 'object') return [];
  return Object.values(m).filter((v) => typeof v === 'string' && v.trim());
}
function asset(iso, kind, file) {
  // The dump gives media as full URLs now (older captures used basenames); use the
  // URL as-is, else build it under the standard /data/<iso>/<kind>/ path.
  const s = String(file || '');
  return /^https?:/i.test(s) ? s : `${ASSET_BASE}/data/${iso}/${kind}/${base(s)}`;
}
// Playlists come as { title:{0:..}, filename:{0:url} } in the current dump (older
// captures used a flat { 0:file } with no title). Normalize to [{file, title}].
function playlistItems(pl) {
  if (!pl || typeof pl !== 'object') return [];
  if (pl.filename && typeof pl.filename === 'object') {
    const titles = pl.title || {};
    return Object.entries(pl.filename)
      .filter(([, f]) => typeof f === 'string' && f.trim())
      .map(([k, f]) => ({ file: f, title: (typeof titles[k] === 'string' && titles[k].trim()) ? titles[k].trim() : null }));
  }
  return vals(pl).map((f) => ({ file: f, title: null }));
}
// Fallback title when the dump gives no playlist title: drop .txt + trailing language
// code, special-case JESUS Film, else split CamelCase/separators into words.
function playlistTitle(file) {
  let s = base(file).replace(/\.txt$/i, '').replace(/-[A-Za-z]{2,4}\d*$/, '');
  if (/^JESUS ?Film/i.test(s)) return 'JESUS Film';
  s = s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim();
  return s || 'Video playlist';
}
function res(group, kind, fmt, name, source, url, external, meta = {}) {
  const cleaned = {};
  for (const [k, v] of Object.entries(meta)) {
    if (v !== null && v !== undefined && v !== '') cleaned[k] = v;
  }
  return { group, kind, format: fmt, name, source, url, external, meta: cleaned };
}

// --- canonical country name per code (first seen; verified conflict-free) ---
const countryName = new Map();
function countriesOf(r) {
  const codes = vals(r.countries_codes);
  const names = vals(r.countries_names);
  return codes.map((code, i) => {
    const nm = names[i] || code;
    if (!countryName.has(code)) countryName.set(code, nm);
    return { code, name_eng: countryName.get(code) };
  });
}

// --- slug (same collision rule as extract_sqlite.mjs) ---
const seenSlugs = new Map();
function makeSlug(iso, rod, variant, idx) {
  let s;
  if (variant) s = `${iso}-${rod}-${variant}`;
  else if (rod && rod !== '00000') s = `${iso}-${rod}`;
  else s = iso;
  s = String(s).toLowerCase();
  if (seenSlugs.has(s) && seenSlugs.get(s) !== idx) s = `${s}-${idx}`;
  seenSlugs.set(s, idx);
  return s;
}

function testament(iso, map, kind, label, unit) {
  const files = vals(map);
  if (!files.length) return null;
  const combined = files.find((f) => /^00-/.test(base(f)));
  const count = files.filter((f) => !/^00-/.test(base(f))).length || files.length;
  const dir = kind === 'audio' ? 'audio' : 'PDF';
  const fmt = kind === 'audio' ? 'Audio' : 'PDF';
  return res(kind === 'audio' ? 'listen' : 'read', kind === 'audio' ? 'audio' : 'pdf', fmt,
    `${label} — ${count} ${unit}(s)`, 'ScriptureEarth', asset(iso, dir, combined || files[0]), false,
    kind === 'audio' ? { chapters: count } : { books: count });
}

// --- playlist videos: gather (iso, filename) pairs, fetch clip listings once ---
const playlistClips = new Map();
async function poolMap(items, concurrency, fn) {
  let next = 0;
  const worker = async () => { while (next < items.length) await fn(items[next++]); };
  const n = Math.min(concurrency, items.length);
  if (n > 0) await Promise.all(Array.from({ length: n }, worker));
}
{
  const seen = new Set();
  const pairs = [];
  for (const e of entries) {
    const iso = e.attributes?.iso;
    for (const it of playlistItems(e.relationships?.se_media?.playlist_video)) {
      const key = `${iso}\t${base(it.file)}`;
      if (!iso || seen.has(key)) continue;
      seen.add(key);
      pairs.push({ iso, filename: it.file, key });
    }
  }
  if (process.env.SE_SKIP_PLAYLISTS) {
    console.error(`skipping ${pairs.length} playlist txt files (SE_SKIP_PLAYLISTS set — video playlists get no clip URLs)`);
  } else {
    console.error(`fetching ${pairs.length} playlist txt files...`);
    await poolMap(pairs, 12, async (p) => {
      playlistClips.set(p.key, await loadPlaylistClips({ iso: p.iso, filename: p.filename, cacheDir: PLAYLIST_CACHE }));
    });
  }
}

const languages = [];
const search = [];
for (const e of entries) {
  const a = e.attributes || {};
  const r = e.relationships || {};
  const iso = a.iso;
  const idx = Number(r.idx);
  if (!iso || !Number.isFinite(idx)) continue;

  const R = { read: [], listen: [], watch: [], use: [] };
  const media = r.se_media || {};

  // read
  const otPdf = testament(iso, media.text?.OT, 'pdf', 'Old Testament', 'book');
  const ntPdf = testament(iso, media.text?.NT, 'pdf', 'New Testament', 'book');
  if (otPdf) R.read.push(otPdf);
  if (ntPdf) R.read.push(ntPdf);
  const lm = r.links_media || {};
  for (const u of vals(lm.YouVersion)) R.read.push(res('read', 'web', 'Web', 'YouVersion', 'Bible.com (YouVersion)', u, true));
  for (const u of vals(lm.eBible)) R.read.push(res('read', 'web', 'Web', 'eBible edition', 'eBible.org', u, true));
  for (const u of vals(lm['Bible.is'])) R.read.push(res('read', 'web', 'Web', 'Bible.is', 'Faith Comes By Hearing', u, true));
  for (const u of vals(lm.Kalaam_websites)) R.read.push(res('read', 'web', 'Web', 'Website', 'Kalaam Media', u, true));
  for (const u of vals(lm.other_websites)) R.read.push(res('read', 'web', 'Web', 'Website', '—', u, true));
  if (typeof r.se_online_viewer === 'string' && r.se_online_viewer.trim()) {
    R.read.push(res('read', 'web', 'Web', 'Online viewer', 'ScriptureEarth', r.se_online_viewer.trim(), true));
  }

  // listen
  const otAud = testament(iso, media.audio?.OT, 'audio', 'Old Testament', 'chapter');
  const ntAud = testament(iso, media.audio?.NT, 'audio', 'New Testament', 'chapter');
  if (otAud) R.listen.push(otAud);
  if (ntAud) R.listen.push(ntAud);
  for (const it of playlistItems(media.playlist_audio)) {
    R.listen.push(res('listen', 'audio', 'MP3', it.title || base(it.file).replace(/\.txt$/i, '') || 'Audio playlist', 'ScriptureEarth', null, false));
  }
  for (const u of vals(lm.GRN)) R.listen.push(res('listen', 'audio', 'MP3', 'GRN recordings', 'Global Recordings Network', u, true));

  // watch
  for (const u of vals(r.watch)) {
    const [nm, src] = /jesusfilm\.org/i.test(u) ? ['JESUS Film', 'Jesus Film Project']
      : /youtu\.?be/i.test(u) ? ['YouTube', 'YouTube'] : ['Video', '—'];
    R.watch.push(res('watch', 'video', 'Video', nm, src, u, true));
  }
  for (const it of playlistItems(media.playlist_video)) {
    const clips = playlistClips.get(`${iso}\t${base(it.file)}`) || [];
    const first = clips[0];
    R.watch.push(res('watch', 'video', 'Video', it.title || playlistTitle(it.file), 'ScriptureEarth',
      first ? first.url : null, first ? /^https?:/.test(first.url) : false,
      { clips: clips.length > 1 ? clips : undefined, playlistFile: base(it.file) }));
  }
  for (const u of vals(lm['Bible.is_Gospel_Film'])) R.watch.push(res('watch', 'video', 'Video', 'Bible.is Gospel Film', 'Faith Comes By Hearing', u, true));

  // use (apps + buy)
  const apps = r.se_apps || {};
  for (const u of vals(apps.android)) R.use.push(res('use', 'app', 'App', 'Android app', 'Scripture App Builder', u, true));
  for (const u of vals(apps.ios)) R.use.push(res('use', 'app', 'App', 'iOS app', 'Scripture App Builder', u, true));
  for (const u of vals(r.se_google_play)) R.use.push(res('use', 'app', 'App', 'Google Play', 'Google Play', u, true));
  for (const u of vals(lm.AppleStore)) R.use.push(res('use', 'app', 'App', 'iOS app', 'App Store', u, true));
  for (const u of vals(r.buy)) R.use.push(res('use', 'buy', 'Buy', 'Printed edition', 'Print-on-demand', u, true));

  // se_sab: HTML reader files whose public URL scheme isn't resolvable here — count
  // toward read availability (as extract_sqlite.mjs did for the SAB flag) w/o a link.
  const sab = r.se_sab || {};
  const hasSab = vals(sab.text).length > 0 || vals(sab.audio).length > 0;

  const avail = {
    read: R.read.length > 0 || hasSab,
    listen: R.listen.length > 0,
    watch: R.watch.length > 0,
    app: R.use.some((x) => x.kind === 'app'),
    buy: R.use.some((x) => x.kind === 'buy'),
  };

  const ln = r.language_name || {};
  const name = (typeof ln.English === 'string' && ln.English.trim()) ? ln.English.trim() : iso;
  const localizedNames = [];
  for (const key of Object.keys(LN)) {
    const v = ln[key];
    if (typeof v === 'string' && v.trim()) localizedNames.push(v.trim());
  }
  const alt = vals(r.alternate_language_names);
  const countries = countriesOf(r);
  const slug = makeSlug(iso, r.rod, r.var_code, idx);

  languages.push({
    idx,
    identity: {
      iso,
      slug,
      rod: r.rod,
      variant_code: r.var_code || '',
      variant_name: r.var_name || '',
      iso_query: `iso=${iso}`,
      idx_query: `idx=${idx}`,
    },
    names: { default_locale: 'eng', localized: { eng: name }, autonym: null, alt_names: alt },
    countries,
    availability: avail,
    resources: R,
  });

  search.push({
    idx,
    slug,
    code: iso,
    nm: name,
    auto: null,
    nms: [...new Set(localizedNames)].filter((n) => n !== name),
    alt,
    where: countries.map((c) => c.name_eng).join(', '),
    cc: countries.map((c) => c.code),
    r: Object.entries(avail).filter(([, v]) => v).map(([k]) => k),
  });
}

// --- countries.json: invert languages by country ---
const byidx = new Map(languages.map((d) => [d.idx, d]));
const langsByCountry = new Map();
for (const d of languages) {
  for (const c of d.countries) {
    let ls = langsByCountry.get(c.code);
    if (!ls) { ls = []; langsByCountry.set(c.code, ls); }
    ls.push(d);
  }
}
const countriesOut = [];
for (const [code, name] of [...countryName.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
  const ls = langsByCountry.get(code) ?? [];
  countriesOut.push({
    code,
    name: { eng: name },
    language_idxs: ls.map((d) => d.idx),
    languages: ls.map((d) => ({
      idx: d.idx,
      slug: d.identity.slug,
      iso: d.identity.iso,
      name_eng: d.names.localized.eng,
      alt_names: d.names.alt_names.slice(0, 3),
      variant_name: d.identity.variant_name,
    })),
  });
}

function dump(name, obj) {
  const p = path.join(OUT, name);
  writeFileSync(p, JSON.stringify(obj), 'utf8');
  const count = Array.isArray(obj) ? obj.length : Object.keys(obj).length;
  const kb = Math.floor(statSync(p).size / 1024);
  console.error(`  ${name.padEnd(22)} ${String(count).padStart(6)}  ${kb} KB`);
}

// --- data audit / strict mode -------------------------------------------------
// Catches the class of regression that has bitten us twice (dump field shapes
// changing so the projector silently emits nothing). For each dump field, count
// languages that HAVE raw data in it vs. languages we actually emitted a row from.
// raw>0 but emitted==0 ⇒ the field shape changed. SE_STRICT=1 turns findings into a
// non-zero exit (use it to audit a dump; NOT wired into CI, which must still deploy
// the best-available build). Also reports title coverage for watch/buy — data the
// old SQLite dump carried (watch_what/buy_what) that the JSON dump currently omits.
function auditData(ents, langs) {
  const byIdx = new Map(langs.map((d) => [d.idx, d]));
  const some = (a, p) => Array.isArray(a) && a.some(p);
  const isPlaylist = (x) => x.meta && x.meta.playlistFile;
  const checks = [
    ['se_media.text',    (r) => vals(r.se_media?.text?.OT).length || vals(r.se_media?.text?.NT).length, (d) => some(d.resources.read, (x) => x.kind === 'pdf')],
    ['se_media.audio',   (r) => vals(r.se_media?.audio?.OT).length || vals(r.se_media?.audio?.NT).length, (d) => some(d.resources.listen, (x) => x.kind === 'audio' && /Testament/.test(x.name))],
    ['playlist_video',   (r) => playlistItems(r.se_media?.playlist_video).length, (d) => some(d.resources.watch, isPlaylist)],
    ['playlist_audio',   (r) => playlistItems(r.se_media?.playlist_audio).length, (d) => some(d.resources.listen, (x) => x.format === 'MP3' && !x.url)],
    ['links.YouVersion', (r) => vals(r.links_media?.YouVersion).length, (d) => some(d.resources.read, (x) => x.source === 'Bible.com (YouVersion)')],
    ['links.eBible',     (r) => vals(r.links_media?.eBible).length, (d) => some(d.resources.read, (x) => x.source === 'eBible.org')],
    ['links.Bible.is',   (r) => vals(r.links_media?.['Bible.is']).length, (d) => some(d.resources.read, (x) => x.name === 'Bible.is')],
    ['links.GRN',        (r) => vals(r.links_media?.GRN).length, (d) => some(d.resources.listen, (x) => x.source === 'Global Recordings Network')],
    ['watch',            (r) => vals(r.watch).length, (d) => some(d.resources.watch, (x) => !isPlaylist(x))],
    ['buy',              (r) => vals(r.buy).length, (d) => some(d.resources.use, (x) => x.kind === 'buy')],
    ['se_apps',          (r) => vals(r.se_apps?.android).length || vals(r.se_apps?.ios).length, (d) => some(d.resources.use, (x) => x.kind === 'app')],
  ];
  const failures = [];
  console.error('data audit (languages with raw field → languages we emitted from it):');
  for (const [name, rawFn, emitFn] of checks) {
    let raw = 0, emitted = 0;
    for (const e of ents) {
      if (!rawFn(e.relationships || {})) continue;
      raw++;
      const d = byIdx.get(Number(e.relationships?.idx));
      if (d && emitFn(d)) emitted++;
    }
    const flag = raw > 0 && emitted === 0 ? '  ✗ SHAPE CHANGED' : (emitted < raw * 0.5 ? '  ⚠ partial' : '');
    console.error(`  ${name.padEnd(18)} ${String(raw).padStart(5)} → ${String(emitted).padStart(5)}${flag}`);
    if (raw > 0 && emitted === 0) failures.push(`${name}: ${raw} languages have data but none was projected — dump field shape likely changed`);
  }
  // Title coverage for watch/buy (data the JSON dump currently omits vs the old DB dump).
  const genericWatch = new Set(['JESUS Film', 'YouTube', 'Video']);
  let wRows = 0, wTitled = 0, bRows = 0, bTitled = 0;
  for (const d of langs) {
    for (const x of d.resources.watch) { if (isPlaylist(x)) continue; wRows++; if (!genericWatch.has(x.name)) wTitled++; }
    for (const x of d.resources.use) { if (x.kind !== 'buy') continue; bRows++; if (x.name !== 'Printed edition') bTitled++; }
  }
  console.error(`  watch titles: ${wTitled}/${wRows}   buy titles: ${bTitled}/${bRows}`);
  if (wRows > 0 && wTitled === 0) failures.push('watch: 0 rows have a real title (dump omits watch_what/organization)');
  if (bRows > 0 && bTitled === 0) failures.push('buy: 0 rows have a real title (dump omits buy_what/organization)');
  if (langs.length < Number(process.env.SE_MIN_LANGS || 4000)) failures.push(`only ${langs.length} languages (< ${process.env.SE_MIN_LANGS || 4000})`);
  return failures;
}

const auditFailures = auditData(entries, languages);
if (auditFailures.length) {
  console.error(`\n${process.env.SE_STRICT ? 'STRICT ' : ''}data audit: ${auditFailures.length} issue(s):`);
  for (const f of auditFailures) console.error(`  - ${f}`);
  if (process.env.SE_STRICT) {
    console.error('SE_STRICT set — failing without writing content/.');
    process.exit(1);
  }
}

console.error('writing content/...');
dump('languages.json', languages);
dump('countries.json', countriesOut);
dump('search-index.json', search);

console.error(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s  (${languages.length} languages, ${countriesOut.length} countries)`);
