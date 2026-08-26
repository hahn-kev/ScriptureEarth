// Reads the SQLite PoC dump and emits content-JSON documents
// (languages, countries, search-index, English UI messages).
// `--source=api` writes content-api/ without BUY rows; default dump writes content/.
import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { jsonDump } from './json_dump.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DB = process.env.SE_DB || path.join(HERE, '..', 'data', 'scripture.db');
const SOURCE = process.argv.includes('--source=api') ? 'api' : 'dump';
const OUT = path.join(HERE, '..', SOURCE === 'api' ? 'content-api' : 'content');
const ASSET_BASE = 'https://scriptureearth.org';

mkdirSync(OUT, { recursive: true });
const t0 = Date.now();
const db = new DatabaseSync(DB);

function int(v) {
  return typeof v === 'bigint' ? Number(v) : v;
}

function q(sql, ...a) {
  return db.prepare(sql).all(...a);
}

function groupByIdx(rows) {
  const d = new Map();
  for (const r of rows) {
    const k = int(r.ISO_ROD_index);
    let list = d.get(k);
    if (!list) {
      list = [];
      d.set(k, list);
    }
    list.push(r);
  }
  return d;
}

function at(map, idx) {
  return map.get(idx) ?? [];
}

console.error('reading spine...');
const spine = q('SELECT * FROM scripture_main');
const lnEng = new Map();
for (const r of q('SELECT ISO_ROD_index, LN_English FROM LN_English')) {
  lnEng.set(int(r.ISO_ROD_index), r.LN_English);
}

const LN_TABLES = {
  eng: 'LN_English',
  spa: 'LN_Spanish',
  por: 'LN_Portuguese',
  fra: 'LN_French',
  nld: 'LN_Dutch',
  deu: 'LN_German',
  cmn: 'LN_Chinese',
  kor: 'LN_Korean',
  rus: 'LN_Russian',
  arb: 'LN_Arabic',
};
const lnAll = new Map();
for (const [loc, tbl] of Object.entries(LN_TABLES)) {
  for (const r of q(`SELECT ISO_ROD_index i, ${tbl} n FROM ${tbl} WHERE ISO_ROD_index IS NOT NULL`)) {
    if (r.n && String(r.n).trim()) {
      const i = int(r.i);
      let names = lnAll.get(i);
      if (!names) {
        names = {};
        lnAll.set(i, names);
      }
      names[loc] = String(r.n).trim();
    }
  }
}

const seenSlugs = new Map();
function makeSlug(iso, rod, variant, idx) {
  let s;
  if (variant) s = `${iso}-${rod}-${variant}`;
  else if (rod && rod !== '00000') s = `${iso}-${rod}`;
  else s = iso;
  s = String(s).toLowerCase();
  if (seenSlugs.has(s) && seenSlugs.get(s) !== idx) {
    s = `${s}-${idx}`;
  }
  seenSlugs.set(s, idx);
  return s;
}

const variants = new Map();
for (const r of q('SELECT Variant_Code, Variant_Eng FROM Variants')) {
  variants.set(r.Variant_Code, r.Variant_Eng);
}
const countryName = new Map();
for (const r of q('SELECT ISO_Country, English FROM countries')) {
  countryName.set(r.ISO_Country, r.English);
}

const altByIdx = groupByIdx(q('SELECT ISO_ROD_index, alt_lang_name FROM alt_lang_names'));
const isoCtry = groupByIdx(q('SELECT ISO_ROD_index, ISO_countries FROM ISO_countries'));

const otPdf = groupByIdx(q('SELECT ISO_ROD_index, OT_PDF, OT_PDF_Filename FROM OT_PDF_Media'));
const ntPdf = groupByIdx(q('SELECT ISO_ROD_index, NT_PDF, NT_PDF_Filename FROM NT_PDF_Media'));
const otAud = groupByIdx(q('SELECT ISO_ROD_index, OT_Audio_Book, OT_Audio_Filename FROM OT_Audio_Media'));
const ntAud = groupByIdx(q('SELECT ISO_ROD_index, NT_Audio_Book, NT_Audio_Filename FROM NT_Audio_Media'));
const links = groupByIdx(q('SELECT * FROM links'));
const watchRows = groupByIdx(q('SELECT * FROM watch'));
const cell = groupByIdx(q('SELECT * FROM CellPhone'));
const buy = groupByIdx(q('SELECT * FROM buy'));
const study = groupByIdx(q('SELECT * FROM study'));
const ebible = groupByIdx(q('SELECT ISO_ROD_index, homeDomain, translationId, title FROM eBible_list'));
const plAud = groupByIdx(q('SELECT ISO_ROD_index, PlaylistAudioTitle FROM PlaylistAudio'));
const plVid = groupByIdx(q('SELECT ISO_ROD_index, PlaylistVideoTitle FROM PlaylistVideo'));

function resolve(p) {
  if (!p) return [null, true];
  const s = String(p);
  if (s.startsWith('http://') || s.startsWith('https://')) return [s, true];
  return [`${ASSET_BASE}/${s.replace(/^\/+/, '')}`, false];
}

function res(group, kind, fmt, name, source, url, external, meta = {}) {
  const cleaned = {};
  for (const [k, v] of Object.entries(meta)) {
    if (v !== null && v !== '') cleaned[k] = v;
  }
  return { group, kind, format: fmt, name, source, url, external, meta: cleaned };
}

function stripPrefix(title, prefix) {
  let t = (title || '').trim();
  if (t.startsWith(prefix)) t = t.slice(prefix.length);
  return t.replace(/^[ \-\u2013\u2014:]+/, '').trim();
}

function buildResources(idx, _iso, _flags) {
  const R = { read: [], listen: [], watch: [], use: [] };

  if (otPdf.has(idx)) {
    const rows = otPdf.get(idx);
    const [url, ext] = resolve(rows[0].OT_PDF_Filename);
    R.read.push(res('read', 'pdf', 'PDF', `Old Testament — ${rows.length} book(s)`,
      'ScriptureEarth', url, ext, { books: rows.length }));
  }
  if (ntPdf.has(idx)) {
    const rows = ntPdf.get(idx);
    const [url, ext] = resolve(rows[0].NT_PDF_Filename);
    R.read.push(res('read', 'pdf', 'PDF', `New Testament — ${rows.length} book(s)`,
      'ScriptureEarth', url, ext, { books: rows.length }));
  }
  for (const r of at(ebible, idx).slice(0, 3)) {
    const [url, ext] = resolve(r.homeDomain ? `https://${r.homeDomain}/${r.translationId}` : null);
    R.read.push(res('read', 'web', 'Web', r.title || 'eBible edition', 'eBible.org', url, true));
  }
  for (const l of at(links, idx)) {
    const [u, ext] = resolve(l.URL);
    if (l.YouVersion) {
      const ver = stripPrefix(l.company_title, 'Bible.com (YouVersion)');
      R.read.push(res('read', 'web', 'Web', ver || 'YouVersion', 'Bible.com (YouVersion)', u, ext));
    } else if (l.Bibles_org) {
      R.read.push(res('read', 'web', 'Web', l.company_title || l.company || 'Bibles.org edition', 'Bibles.org', u, ext));
    } else if ([2, 3, 4].includes(Number(l.BibleIs))) {
      R.read.push(res('read', 'web', 'Web', l.company_title || 'Bible.is edition', 'Bible.is', u, ext));
    }
  }

  if (otAud.has(idx)) {
    const rows = otAud.get(idx);
    const [url, ext] = resolve(rows[0].OT_Audio_Filename);
    R.listen.push(res('listen', 'audio', 'Audio', `Old Testament — ${rows.length} chapter(s)`,
      'ScriptureEarth', url, ext, { chapters: rows.length }));
  }
  if (ntAud.has(idx)) {
    const rows = ntAud.get(idx);
    const [url, ext] = resolve(rows[0].NT_Audio_Filename);
    R.listen.push(res('listen', 'audio', 'Audio', `New Testament — ${rows.length} chapter(s)`,
      'ScriptureEarth', url, ext, { chapters: rows.length }));
  }
  for (const p of at(plAud, idx)) {
    R.listen.push(res('listen', 'audio', 'MP3', p.PlaylistAudioTitle || 'Audio playlist', 'ScriptureEarth', null, false));
  }
  for (const l of at(links, idx)) {
    const [u, ext] = resolve(l.URL);
    if (l.GRN) {
      R.listen.push(res('listen', 'audio', 'MP3', l.company_title || 'GRN recordings', 'Global Recordings Network', u, ext));
    } else if ([1, 3, 4].includes(Number(l.BibleIs))) {
      R.listen.push(res('listen', 'audio', 'Audio', l.company_title || 'Bible.is audio', 'Bible.is', u, ext));
    }
  }

  for (const w of at(watchRows, idx)) {
    const [u, ext] = resolve(w.URL);
    const nm = w.JesusFilm ? 'JESUS Film' : (w.YouTube ? 'YouTube' : (w.watch_what || 'Video'));
    R.watch.push(res('watch', 'video', 'Video', nm, w.organization || '—', u, ext));
  }
  for (const p of at(plVid, idx)) {
    R.watch.push(res('watch', 'video', 'Video', p.PlaylistVideoTitle || 'Video playlist', 'ScriptureEarth', null, false));
  }
  for (const l of at(links, idx)) {
    if (l.BibleIsGospelFilm) {
      const [u, ext] = resolve(l.URL);
      R.watch.push(res('watch', 'video', 'Video', 'Bible.is Gospel Film', 'Faith Comes By Hearing', u, ext));
    }
  }

  for (const c of at(cell, idx)) {
    const [u, ext] = resolve(c.Cell_Phone_File);
    R.use.push(res('use', 'app', 'App', c.Cell_Phone_Title || 'Mobile app', 'Scripture App Builder', u, ext));
  }
  for (const s of at(study, idx)) {
    const [u, ext] = resolve(s.ScriptureURL || s.othersiteURL);
    R.use.push(res('use', 'app', 'Study', s.ScriptureDescription || 'Study tool', '—', u, ext));
  }
  if (SOURCE !== 'api') {
    for (const b of at(buy, idx)) {
      const [u, ext] = resolve(b.URL);
      R.use.push(res('use', 'buy', 'Buy', b.buy_what || 'Printed edition', b.organization || 'Print-on-demand', u, ext));
    }
  }
  return R;
}

function availability(_idx, f, R) {
  return {
    read: Boolean(f.OT_PDF || f.NT_PDF || f.YouVersion || f.Bibles_org || f.eBible || f.viewer || f.BibleIs || f.SAB || R.read.length),
    listen: Boolean(f.OT_Audio || f.NT_Audio || f.PlaylistAudio || f.GRN || R.listen.length),
    watch: Boolean(f.watch || f.PlaylistVideo || f.BibleIsGospelFilm || R.watch.length),
    app: Boolean(f.CellPhone || f.study || (R.use.length && R.use.some((x) => x.kind === 'app'))),
    buy: Boolean(f.buy),
  };
}

const FLAGCOLS = ['OT_PDF', 'NT_PDF', 'OT_Audio', 'NT_Audio', 'links', 'other_titles', 'watch', 'buy', 'study',
  'viewer', 'CellPhone', 'BibleIs', 'BibleIsGospelFilm', 'YouVersion', 'Bibles_org',
  'PlaylistAudio', 'PlaylistVideo', 'SAB', 'eBible', 'GRN'];

const languages = [];
const search = [];
for (const r of spine) {
  const idx = int(r.ISO_ROD_index);
  const iso = r.ISO;
  const flags = {};
  for (const c of FLAGCOLS) flags[c] = r[c];
  const R = buildResources(idx, iso, flags);
  const avail = availability(idx, flags, R);
  const ccodes = at(isoCtry, idx).map((c) => c.ISO_countries);
  const countries = ccodes.map((c) => ({ code: c, name_eng: countryName.get(c) ?? c }));
  const slug = makeSlug(iso, r.ROD_Code, r.Variant_Code, idx);
  const name = lnEng.get(idx) || iso;
  const alt = at(altByIdx, idx).map((a) => a.alt_lang_name).filter(Boolean);
  const doc = {
    idx,
    identity: {
      iso,
      slug,
      rod: r.ROD_Code,
      variant_code: r.Variant_Code,
      variant_name: r.Variant_Code ? (variants.get(r.Variant_Code) ?? '') : '',
      iso_query: `iso=${iso}`,
      idx_query: `idx=${idx}`,
    },
    names: { default_locale: 'eng', localized: { eng: name }, autonym: null, alt_names: alt },
    countries,
    availability: avail,
    resources: R,
  };
  languages.push(doc);
  const allNames = [...new Set(Object.values(lnAll.get(idx) ?? {}))];
  search.push({
    idx,
    slug,
    code: iso,
    nm: name,
    auto: null,
    nms: allNames.filter((n) => n !== name),
    alt,
    where: countries.map((c) => c.name_eng).join(', '),
    cc: ccodes,
    r: Object.entries(avail).filter(([, v]) => v).map(([k]) => k),
  });
}

const langsByCountry = new Map();
const byidx = new Map(languages.map((d) => [d.idx, d]));
for (const [cidx, rows] of isoCtry) {
  const d = byidx.get(cidx);
  if (!d) continue;
  for (const c of rows) {
    const code = c.ISO_countries;
    let ls = langsByCountry.get(code);
    if (!ls) {
      ls = [];
      langsByCountry.set(code, ls);
    }
    ls.push(d);
  }
}

const countriesOut = [];
const countryEntries = [...countryName.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
for (const [code, name] of countryEntries) {
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

const msg = {};
let transRows;
try {
  transRows = q('SELECT id, phrase FROM translations_eng WHERE active=1');
} catch {
  transRows = q('SELECT id, phrase FROM translations_eng');
}
for (const r of transRows) {
  msg[String(r.id)] = r.phrase;
}
const messages = { locale: 'eng', language_code: 'en', direction: 'ltr', name: 'English', messages: msg };

function dump(name, obj) {
  const p = path.join(OUT, name);
  writeFileSync(p, jsonDump(obj), 'utf8');
  const count = Array.isArray(obj) ? obj.length : Object.keys(obj.messages ?? obj).length;
  const kb = Math.floor(statSync(p).size / 1024);
  console.error(`  ${name.padEnd(22)} ${String(count).padStart(6)}  ${kb} KB`);
}

console.error('writing content/...');
dump('languages.json', languages);
dump('countries.json', countriesOut);
dump('search-index.json', search);
dump('messages.eng.json', messages);

console.error(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s  (${languages.length} languages, ${countriesOut.length} countries)`);
