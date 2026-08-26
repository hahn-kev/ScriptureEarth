// Converts content/search-index.json (written by scripts/extract.mjs) into
// public/search-index.txt: a columnar, delimited-text encoding that ships
// ~16% smaller (brotli) than the plain JSON array it replaces. See
// bench/attempts/combined-columnar-delimited-text/ for how this was
// derived and measured — this file is that attempt's build.mjs, pointed at
// the real source/output paths instead of a benchmark fixture.
//
// Client-side decoding lives inline in src/pages/index.astro (the counterpart
// to that attempt's load.mjs) since it needs to run in the browser, not Node.
//
// Run as part of `npm run extract` (see package.json) — always after
// extract.mjs, since it reads that script's output.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_PATH = path.join(__dirname, '..', 'content', 'search-index.json');
const OUT_PATH = path.join(__dirname, '..', 'public', 'search-index.txt');

const RECORD_SEP = '\x1f';
const ELEMENT_SEP = '\t';
const LINE_SEP = '\n';

export const RIGHTS = ['read', 'listen', 'watch', 'app', 'buy'];

function assertSafe(value, context) {
  if (typeof value !== 'string') return;
  if (value.includes(RECORD_SEP) || value.includes(ELEMENT_SEP) || value.includes(LINE_SEP)) {
    throw new Error(`${context} contains a reserved delimiter character: ${JSON.stringify(value)}`);
  }
}

async function main() {
  const records = JSON.parse(await readFile(SOURCE_PATH, 'utf8'));

  for (const r of records) {
    if (r.auto !== null) {
      throw new Error(`record ${r.idx} has non-null auto (${r.auto}) — this format assumes it's always null (the real autonym data lives in public/i18n/autonyms.json)`);
    }
  }

  const countries = {};
  for (const r of records) {
    const segs = r.where.split(', ');
    if (segs.length !== r.cc.length) throw new Error(`record ${r.idx}: where segment count != cc length`);
    r.cc.forEach((c, i) => {
      if (countries[c] !== undefined && countries[c] !== segs[i]) {
        throw new Error(`code ${c} maps to conflicting names: "${countries[c]}" vs "${segs[i]}"`);
      }
      countries[c] = segs[i];
    });
  }
  for (const r of records) {
    const predicted = r.cc.map((c) => countries[c]).join(', ');
    if (predicted !== r.where) throw new Error(`record ${r.idx}: predicted where != actual`);
  }

  const countryCodes = Object.keys(countries);
  for (const c of countryCodes) assertSafe(countries[c], `country ${c}`);
  const headerLine = countryCodes.map((c) => `${c}${ELEMENT_SEP}${countries[c]}`).join(RECORD_SEP);

  for (const r of records) {
    if (r.slug === '') throw new Error(`record ${r.idx} has an empty-string slug`);
    assertSafe(r.slug, `record ${r.idx} slug`);
    assertSafe(r.code, `record ${r.idx} code`);
    assertSafe(r.nm, `record ${r.idx} nm`);
    for (const key of ['nms', 'alt', 'cc']) {
      for (const el of r[key]) {
        if (el === '') throw new Error(`record ${r.idx} field "${key}" contains an empty-string element`);
        assertSafe(el, `record ${r.idx} field "${key}" element`);
      }
    }
  }

  const idxCol = records.map((r) => String(r.idx)).join(RECORD_SEP);
  const codeCol = records.map((r) => r.code).join(RECORD_SEP);
  const slugCol = records.map((r) => (r.slug === r.code ? '' : r.slug)).join(RECORD_SEP);
  const nmCol = records.map((r) => r.nm).join(RECORD_SEP);
  const nmsCol = records.map((r) => r.nms.join(ELEMENT_SEP)).join(RECORD_SEP);
  const altCol = records.map((r) => r.alt.join(ELEMENT_SEP)).join(RECORD_SEP);
  const ccCol = records.map((r) => r.cc.join(ELEMENT_SEP)).join(RECORD_SEP);
  const rCol = records
    .map((r) => {
      let mask = 0;
      for (const right of r.r) {
        const bit = RIGHTS.indexOf(right);
        if (bit === -1) throw new Error(`unknown right "${right}" on record ${r.idx}`);
        mask |= 1 << bit;
      }
      return String(mask);
    })
    .join(RECORD_SEP);

  const lines = [headerLine, idxCol, codeCol, slugCol, nmCol, nmsCol, altCol, ccCol, rCol];
  await writeFile(OUT_PATH, lines.join(LINE_SEP), 'utf8');
  console.error(`  search-index.txt        ${records.length}  ${Math.round((await import('node:fs')).statSync(OUT_PATH).size / 1024)} KB`);
}

main();
