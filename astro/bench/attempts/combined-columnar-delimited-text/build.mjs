// Same as combined-delimited-text, but keeping the COLUMNAR layout instead
// of row-major lines — a fairer isolation of "JSON vs delimited text" given
// combined-single-file is columnar JSON, and columnar layout alone was
// already shown to matter a lot (attempts/columnar: -10.1% brotli by
// itself). This attempt = combined-single-file's exact column structure,
// serialized as delimited text instead of JSON.
//
// Layout: line 0 is the country table (same as combined-delimited-text).
// Each subsequent line is one COLUMN, values for that column joined by
// RECORD_SEP; for the array-valued columns (nms/alt/cc) each record's own
// elements are first joined by ELEMENT_SEP, then those per-record strings
// are joined across records by RECORD_SEP (empty string = that record has
// no elements in that column).
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const RECORD_SEP = '\x1f';
const ELEMENT_SEP = '\t';
const LINE_SEP = '\n';

const RIGHTS = ['read', 'listen', 'watch', 'app', 'buy'];

function assertSafe(value, context) {
  if (typeof value !== 'string') return;
  if (value.includes(RECORD_SEP) || value.includes(ELEMENT_SEP) || value.includes(LINE_SEP)) {
    throw new Error(`${context} contains a reserved delimiter character: ${JSON.stringify(value)}`);
  }
}

export async function build({ sourcePath, dir }) {
  const records = JSON.parse(await readFile(sourcePath, 'utf8'));

  for (const r of records) {
    if (r.auto !== null) throw new Error(`record ${r.idx} has non-null auto (${r.auto})`);
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
  await writeFile(path.join(dir, 'data.txt'), lines.join(LINE_SEP), 'utf8');
}
