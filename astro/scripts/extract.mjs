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
const ext = (u) => /^https?:/i.test(String(u || ''));
const s = (v) => (typeof v === 'string' ? v.trim() : '');
// The dump has used three shapes for a resource group over time; normalize all to
// [{ url, title, organization, ... }]. The format has changed repeatedly, so tolerate
// every shape we've seen:
//   flat:  { "0": url, "1": url }
//   rows:  { "0": { url, title, ... }, "1": {...} }   (numeric keys → row objects)  ← current
//   cols:  { url:{0:..}, title:{0:..}, ... }           (field keys → parallel maps)
function linkRows(obj) {
  if (!obj || typeof obj !== 'object') return [];
  const entries = Object.entries(obj);
  if (!entries.length) return [];
  const norm = (row) => ({ ...row, url: row.url || row.URL });
  if (entries.every(([, v]) => typeof v === 'string')) {
    return vals(obj).map((u) => ({ url: u })); // flat
  }
  if (entries.every(([k]) => /^\d+$/.test(k))) { // rows
    return entries
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([, v]) => v)
      .filter((v) => v && typeof v === 'object')
      .map(norm)
      .filter((v) => v.url);
  }
  const subs = entries.filter(([, v]) => v && typeof v === 'object'); // cols
  const idxs = new Set();
  for (const [, v] of subs) for (const k of Object.keys(v)) idxs.add(k);
  const out = [];
  for (const i of [...idxs].sort((x, y) => Number(x) - Number(y))) {
    const row = {};
    for (const [name, v] of subs) if (v[i] !== undefined && v[i] !== '') row[name] = v[i];
    const n = norm(row);
    if (n.url) out.push(n);
  }
  return out;
}
// Bible.is media_type code (1–8) → which resource groups the link belongs in.
const bibleIsGroups = (m) => ({
  read: [1, 2, 3, 4, 8].includes(m) || !m,
  listen: [1, 3, 4, 5, 6].includes(m),
  watch: [4, 6, 7, 8].includes(m),
});
function asset(iso, kind, file) {
  // The dump gives media as full URLs now (older captures used basenames); use the
  // URL as-is, else build it under the standard /data/<iso>/<kind>/ path.
  const s = String(file || '');
  return /^https?:/i.test(s) ? s : `${ASSET_BASE}/data/${iso}/${kind}/${base(s)}`;
}
// Playlists have used the same three shapes as other groups; the file lives under
// `filename` (or `url`). Normalize to [{ file, title }].
//   rows: { 0:{ title, filename } }  ← current    cols: { title:{0}, filename:{0} }    flat: { 0:file }
function playlistItems(pl) {
  if (!pl || typeof pl !== 'object') return [];
  const entries = Object.entries(pl);
  if (!entries.length) return [];
  if (entries.every(([, v]) => typeof v === 'string')) {
    return vals(pl).map((f) => ({ file: f, title: null })); // flat
  }
  if (entries.every(([k]) => /^\d+$/.test(k))) { // rows
    return entries
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([, v]) => v)
      .filter((v) => v && typeof v === 'object')
      .map((v) => ({ file: v.filename || v.url || v.URL, title: s(v.title) || null }))
      .filter((v) => v.file);
  }
  if (pl.filename && typeof pl.filename === 'object') { // cols
    const titles = pl.title || {};
    return Object.entries(pl.filename)
      .filter(([, f]) => typeof f === 'string' && f.trim())
      .map(([k, f]) => ({ file: f, title: s(titles[k]) || null }));
  }
  return [];
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

// --- playlists: gather (iso, filename) pairs, fetch clip/track listings once ---
const playlistClips = new Map();       // video: iso\tbasename → [{title,url,image?}]
const playlistAudioClips = new Map();  // audio: iso\tbasename → [{title,url}]
async function poolMap(items, concurrency, fn) {
  let next = 0;
  const worker = async () => { while (next < items.length) await fn(items[next++]); };
  const n = Math.min(concurrency, items.length);
  if (n > 0) await Promise.all(Array.from({ length: n }, worker));
}
function gatherPlaylists(field) {
  const seen = new Set();
  const pairs = [];
  for (const e of entries) {
    const iso = e.attributes?.iso;
    for (const it of playlistItems(e.relationships?.se_media?.[field])) {
      const key = `${iso}\t${base(it.file)}`;
      if (!iso || seen.has(key)) continue;
      seen.add(key);
      pairs.push({ iso, filename: it.file, key });
    }
  }
  return pairs;
}
{
  const videoPairs = gatherPlaylists('playlist_video');
  const audioPairs = gatherPlaylists('playlist_audio');
  if (process.env.SE_SKIP_PLAYLISTS) {
    console.error(`skipping ${videoPairs.length} video + ${audioPairs.length} audio playlist txt files (SE_SKIP_PLAYLISTS set — playlists get no clip URLs)`);
  } else {
    console.error(`fetching ${videoPairs.length} video + ${audioPairs.length} audio playlist txt files...`);
    await poolMap(videoPairs, 12, async (p) => {
      playlistClips.set(p.key, await loadPlaylistClips({ iso: p.iso, filename: p.filename, cacheDir: PLAYLIST_CACHE, kind: 'video' }));
    });
    await poolMap(audioPairs, 12, async (p) => {
      playlistAudioClips.set(p.key, await loadPlaylistClips({ iso: p.iso, filename: p.filename, cacheDir: PLAYLIST_CACHE, kind: 'audio' }));
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
  const url = (x) => x.url || x.URL;
  for (const l of linkRows(lm.YouVersion)) R.read.push(res('read', 'web', 'Web', s(l.title) || 'YouVersion', 'Bible.com (YouVersion)', url(l), ext(url(l))));
  for (const l of linkRows(lm.eBible)) R.read.push(res('read', 'web', 'Web', s(l.title) || 'eBible edition', 'eBible.org', url(l), ext(url(l))));
  for (const l of linkRows(lm.Kalaam_websites)) R.read.push(res('read', 'web', 'Web', s(l.title) || 'Website', s(l.organization) || 'Kalaam Media', url(l), ext(url(l))));
  for (const l of linkRows(lm.other_websites)) R.read.push(res('read', 'web', 'Web', s(l.title) || 'Website', s(l.organization) || '—', url(l), ext(url(l))));
  if (s(r.se_online_viewer)) R.read.push(res('read', 'web', 'Web', 'Online viewer', 'ScriptureEarth', s(r.se_online_viewer), true));

  // listen
  const otAud = testament(iso, media.audio?.OT, 'audio', 'Old Testament', 'chapter');
  const ntAud = testament(iso, media.audio?.NT, 'audio', 'New Testament', 'chapter');
  if (otAud) R.listen.push(otAud);
  if (ntAud) R.listen.push(ntAud);
  for (const it of playlistItems(media.playlist_audio)) {
    const clips = playlistAudioClips.get(`${iso}\t${base(it.file)}`) || [];
    const first = clips[0];
    R.listen.push(res('listen', 'audio', 'MP3', it.title || base(it.file).replace(/\.txt$/i, '') || 'Audio playlist', 'ScriptureEarth',
      first ? first.url : null, first ? ext(first.url) : false,
      { clips: clips.length > 1 ? clips : undefined, playlistFile: base(it.file) }));
  }
  for (const l of linkRows(lm.GRN)) R.listen.push(res('listen', 'audio', 'MP3', s(l.title) || 'GRN recordings', 'Global Recordings Network', url(l), ext(url(l))));

  // Bible.is: read/listen/watch per its media_type code (1–8); restores the audio
  // listings the old DB split via BibleIs but the flat dump had dropped.
  for (const l of linkRows(lm['Bible.is'])) {
    const g = bibleIsGroups(Number(l.media_type));
    const nm = s(l.title) || 'Bible.is', src = 'Faith Comes By Hearing', u = url(l);
    if (g.read) R.read.push(res('read', 'web', 'Web', nm, src, u, ext(u)));
    if (g.listen) R.listen.push(res('listen', 'audio', 'Audio', nm, src, u, ext(u)));
    if (g.watch) R.watch.push(res('watch', 'video', 'Video', nm, src, u, ext(u)));
  }

  // watch
  for (const w of linkRows(r.watch)) {
    const jf = String(w.JesusFilm) === '1', yt = String(w.YouTube) === '1';
    const nm = s(w.watch_what) || (jf ? 'JESUS Film' : yt ? 'YouTube' : 'Video');
    const src = s(w.organization) || (jf ? 'Jesus Film Project' : yt ? 'YouTube' : '—');
    R.watch.push(res('watch', 'video', 'Video', nm, src, url(w), ext(url(w))));
  }
  for (const it of playlistItems(media.playlist_video)) {
    const clips = playlistClips.get(`${iso}\t${base(it.file)}`) || [];
    const first = clips[0];
    R.watch.push(res('watch', 'video', 'Video', it.title || playlistTitle(it.file), 'ScriptureEarth',
      first ? first.url : null, first ? /^https?:/.test(first.url) : false,
      { clips: clips.length > 1 ? clips : undefined, playlistFile: base(it.file) }));
  }
  for (const l of linkRows(lm['Bible.is_Gospel_Film'])) R.watch.push(res('watch', 'video', 'Video', s(l.title) || 'Bible.is Gospel Film', 'Faith Comes By Hearing', url(l), ext(url(l))));

  // use (apps + buy). se_apps sections are { <Platform>: { title:{}, url:{} } }.
  const apps = r.se_apps || {};
  for (const [section, data] of Object.entries(apps)) {
    const platform = /ios|apple|asset/i.test(section) ? 'iOS app' : 'Android app';
    for (const app of linkRows(data)) R.use.push(res('use', 'app', 'App', s(app.title) || platform, 'Scripture App Builder', url(app), ext(url(app))));
  }
  for (const l of linkRows(r.se_google_play)) R.use.push(res('use', 'app', 'App', s(l.title) || 'Google Play', 'Google Play', url(l), ext(url(l))));
  for (const l of linkRows(r.se_iPhone)) R.use.push(res('use', 'app', 'App', s(l.title) || 'iOS app', 'App Store', url(l), ext(url(l))));
  for (const l of linkRows(lm.AppleStore)) R.use.push(res('use', 'app', 'App', s(l.title) || 'iOS app', 'App Store', url(l), ext(url(l))));
  for (const b of linkRows(r.buy)) R.use.push(res('use', 'buy', 'Buy', s(b.title) || s(b.testament) || s(b.buy_what) || 'Printed edition', s(b.organization) || 'Print-on-demand', url(b), ext(url(b))));

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
  // raw detectors are shape-agnostic (linkRows handles flat and nested) so a shape
  // change shows up as emitted==0 rather than silently reading raw==0 too.
  const anyApp = (r) => Object.values(r.se_apps || {}).some((sec) => linkRows(sec).length)
    || linkRows(r.se_google_play).length || linkRows(r.se_iPhone).length || linkRows(r.links_media?.AppleStore).length;
  const checks = [
    ['se_media.text',    (r) => vals(r.se_media?.text?.OT).length || vals(r.se_media?.text?.NT).length, (d) => some(d.resources.read, (x) => x.kind === 'pdf')],
    ['se_media.audio',   (r) => vals(r.se_media?.audio?.OT).length || vals(r.se_media?.audio?.NT).length, (d) => some(d.resources.listen, (x) => x.kind === 'audio' && /Testament/.test(x.name))],
    ['playlist_video',   (r) => playlistItems(r.se_media?.playlist_video).length, (d) => some(d.resources.watch, isPlaylist)],
    ['playlist_audio',   (r) => playlistItems(r.se_media?.playlist_audio).length, (d) => some(d.resources.listen, (x) => x.meta && x.meta.playlistFile)],
    ['links.YouVersion', (r) => linkRows(r.links_media?.YouVersion).length, (d) => some(d.resources.read, (x) => x.source === 'Bible.com (YouVersion)')],
    ['links.eBible',     (r) => linkRows(r.links_media?.eBible).length, (d) => some(d.resources.read, (x) => x.source === 'eBible.org')],
    ['links.Bible.is',   (r) => linkRows(r.links_media?.['Bible.is']).length, (d) => some([...d.resources.read, ...d.resources.listen, ...d.resources.watch], (x) => x.source === 'Faith Comes By Hearing' && x.name !== 'Bible.is Gospel Film')],
    ['links.GRN',        (r) => linkRows(r.links_media?.GRN).length, (d) => some(d.resources.listen, (x) => x.source === 'Global Recordings Network')],
    ['watch',            (r) => linkRows(r.watch).length, (d) => some(d.resources.watch, (x) => !isPlaylist(x) && x.source !== 'Faith Comes By Hearing')],
    ['buy',              (r) => linkRows(r.buy).length, (d) => some(d.resources.use, (x) => x.kind === 'buy')],
    ['se_apps',          anyApp, (d) => some(d.resources.use, (x) => x.kind === 'app')],
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
