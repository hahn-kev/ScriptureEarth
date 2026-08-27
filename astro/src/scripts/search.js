// Home MiniSearch: prefix + fuzzy over names, ISO, country. Exact English
// country names list that country's languages instead of ranking one hit first.
import MiniSearch from 'minisearch';

const RECORD_SEP = '\x1f';
const ELEMENT_SEP = '\t';
const LINE_SEP = '\n';
const RIGHTS = ['read', 'listen', 'watch', 'app', 'buy'];
const PILL_LABEL = { read: 'Read', listen: 'Listen', watch: 'Watch', app: 'App', buy: 'Buy' };

function decodeSearchIndex(raw) {
  const [headerLine, idxLine, codeLine, slugLine, nmLine, nmsLine, altLine, ccLine, rLine] = raw.split(LINE_SEP);
  const countries = {};
  for (const entry of headerLine.split(RECORD_SEP)) {
    const sepIdx = entry.indexOf(ELEMENT_SEP);
    countries[entry.slice(0, sepIdx)] = entry.slice(sepIdx + 1);
  }
  const idxCol = idxLine.split(RECORD_SEP);
  const codeCol = codeLine.split(RECORD_SEP);
  const slugCol = slugLine.split(RECORD_SEP);
  const nmCol = nmLine.split(RECORD_SEP);
  const nmsCol = nmsLine.split(RECORD_SEP);
  const altCol = altLine.split(RECORD_SEP);
  const ccCol = ccLine.split(RECORD_SEP);
  const rCol = rLine.split(RECORD_SEP);
  const data = idxCol.map((idxStr, i) => {
    const cc = ccCol[i] === '' ? [] : ccCol[i].split(ELEMENT_SEP);
    const mask = Number(rCol[i]);
    return {
      idx: Number(idxStr),
      slug: slugCol[i] === '' ? codeCol[i] : slugCol[i],
      code: codeCol[i],
      nm: nmCol[i],
      nms: nmsCol[i] === '' ? [] : nmsCol[i].split(ELEMENT_SEP),
      alt: altCol[i] === '' ? [] : altCol[i].split(ELEMENT_SEP),
      where: cc.map((c) => countries[c]).join(', '),
      cc,
      r: RIGHTS.filter((_, bit) => mask & (1 << bit)),
      _text: '',
    };
  });
  return { countries, data };
}

function esc(s) {
  return String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function fold(s) {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f\u064b-\u065f\u0670]/g, '')
    .replace(/[\u0623\u0625\u0622]/g, '\u0627')
    .replace(/[\u0649\u06cc]/g, '\u064a')
    .replace(/\u0629/g, '\u0647')
    .toLowerCase();
}

function tokenize(text) {
  const tokens = [];
  const words = String(text).replace(/['\u2019\u02bc\u02bb\ua78c`]/g, '').match(/[\p{L}\p{N}]+/gu) || [];
  for (const w of words) {
    if (/[\u3400-\u9fff\uf900-\ufaff]/.test(w)) {
      for (const ch of w) tokens.push(ch);
    } else {
      tokens.push(w);
    }
  }
  return tokens;
}

function card(r) {
  const pills = (r.r || [])
    .map((k) => `<span class="pill" data-r="${k}"><span class="dot"></span><span data-i18n="pill.${k}">${PILL_LABEL[k]}</span></span>`)
    .join('');
  return (
    `<a class="lang" href="/language/${r.slug}/">` +
    `<div class="top"><span class="code">${esc(r.code)}</span><span class="nm" data-i18n-name="${r.idx}">${esc(r.nm)}</span></div>` +
    (r.where ? `<div class="where">${esc(r.where)}</div>` : '') +
    `<div class="pills">${pills}</div></a>`
  );
}

async function loadSearchData() {
  // /search-index.txt is served with a hardcoded Content-Encoding: br. Unusual
  // clients can fail to decode; fall back to the plain copy.
  try {
    const res = await fetch('/search-index.txt');
    if (!res.ok) throw new Error(`search-index.txt: HTTP ${res.status}`);
    const decoded = decodeSearchIndex(await res.text());
    if (!Array.isArray(decoded.data) || decoded.data.length < 100) throw new Error('decoded search index looks wrong');
    return decoded;
  } catch (e) {
    console.warn('falling back to uncompressed search index:', e);
    const text = await fetch('/search-index.fallback.txt').then((r) => r.text());
    return decodeSearchIndex(text);
  }
}

const q = document.getElementById('q');
const results = document.getElementById('results');
const rhead = document.getElementById('rhead');
const rcount = document.getElementById('rcount');
const featured = document.getElementById('featured');
const heroStats = document.getElementById('hero-stats');
const browseLink = document.getElementById('browse-link');
const form = document.getElementById('hero-form');
if (!q || !form || !results) throw new Error('home search markup missing');

let engine = null;
let records = [];
let countryByFoldedName = new Map();

async function getIndex() {
  if (engine) return engine;
  const { data, countries } = await loadSearchData();
  data.forEach((d) => {
    d._text = [d.nm, ...(d.nms || []), ...(d.alt || []), d.code, d.where].filter(Boolean).join(' ');
  });
  engine = new MiniSearch({
    idField: 'idx',
    fields: ['_text'],
    storeFields: ['idx', 'slug', 'code', 'nm', 'where', 'r'],
    processTerm: (term) => fold(term) || null,
    tokenize,
  });
  engine.addAll(data);
  records = data;
  countryByFoldedName = new Map();
  for (const [code, name] of Object.entries(countries)) {
    const k = fold(String(name));
    const list = countryByFoldedName.get(k);
    if (list) list.push(code);
    else countryByFoldedName.set(k, [code]);
  }
  return engine;
}

function setSearching(on) {
  [heroStats, browseLink, featured].forEach((el) => { if (el) el.hidden = on; });
  results.hidden = rhead.hidden = !on;
}

function syncQueryUrl(term) {
  const want = term ? `/?q=${encodeURIComponent(term)}` : '/';
  if (location.pathname + location.search !== want) history.replaceState(null, '', want);
}

async function search(term) {
  const t = String(term || '').trim();
  if (!t) {
    setSearching(false);
    syncQueryUrl('');
    return;
  }
  const ms = await getIndex();
  const codes = countryByFoldedName.get(fold(t));
  const hits = codes?.length
    ? records.filter((d) => (d.cc || []).some((c) => codes.includes(c))).sort((a, b) => a.nm.localeCompare(b.nm))
    : ms.search(t, { prefix: true, fuzzy: 0.2, combineWith: 'AND' }).slice(0, 300);
  results.innerHTML = hits.map(card).join('');
  rcount.textContent = hits.length;
  setSearching(true);
  window.__seApplyI18n?.(results);
  syncQueryUrl(t);
}

let debounce;
q.addEventListener('input', () => {
  clearTimeout(debounce);
  debounce = setTimeout(() => search(q.value.trim()), 120);
});
form.addEventListener('submit', (e) => {
  e.preventDefault();
  search(q.value.trim());
});

const initial = new URLSearchParams(location.search).get('q');
if (initial) {
  q.value = initial;
  const headerQ = document.querySelector('header input[name="q"]');
  if (headerQ) headerQ.value = initial;
  if (initial.trim()) search(initial.trim());
}
