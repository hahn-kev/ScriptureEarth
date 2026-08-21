#!/usr/bin/env node
// Benchmark harness for search-index.json size experiments.
//
// Each subdirectory of bench/attempts/ is one attempt:
//   build.mjs   (optional) export async function build({ sourcePath, dir })
//               regenerates this attempt's data file(s) from the canonical
//               source of truth (content/search-index.json). Runs before
//               every measurement so attempts can't go stale.
//   load.mjs    (required) export async function load({ dir })
//               reads this attempt's data file(s) + does whatever decoding
//               work would happen client-side, and returns the record array
//               in the canonical shape (idx, slug, code, nm, auto, nms, alt,
//               where, cc, r). The harness hashes this to check correctness.
//   (anything else in the dir is counted as shipped "data" — json, bin, etc.)
//
// Usage: node bench/harness.mjs [attemptName ...]   (default: all attempts)

import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync, brotliCompressSync, constants as zlibConstants } from 'node:zlib';
import { createHash } from 'node:crypto';
import { transform } from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ATTEMPTS_DIR = path.join(__dirname, 'attempts');
const SOURCE_PATH = path.join(__dirname, '..', 'content', 'search-index.json');
const BASELINE_NAME = 'baseline';

const BROTLI_OPTS = { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 } };

function fmt(n) {
  return n.toLocaleString('en-US');
}

// Stable, order-preserving canonicalization: sort records by idx, sort each
// record's own keys alphabetically. Array-valued fields (nms/alt/cc/r) keep
// their original order — an attempt that reorders/dedupes those on purpose
// should do so in a way a real client would too, and will show up as a hash
// mismatch here, which is the point.
//
// Exception: `nms` and `alt` are order-INsensitive. Checked against
// src/pages/index.astro — both fields are only ever spread into a
// space-joined `_text` string for MiniSearch indexing (never in
// `storeFields`, never displayed), so their element order carries no
// product meaning. Sorting them before hashing lets attempts reorder them
// freely (e.g. for prefix-sharing tricks) without that counting as a
// correctness violation. `cc` and `r` are NOT included here: `cc`'s order
// is baked into the displayed `where` string by the where-from-cc trick,
// and `r`'s order drives pill display order.
const ORDER_INSENSITIVE_FIELDS = new Set(['nms', 'alt']);

function canonicalize(records) {
  const sorted = [...records].sort((a, b) => a.idx - b.idx);
  const normalized = sorted.map((r) => {
    const out = {};
    for (const key of Object.keys(r).sort()) {
      out[key] = ORDER_INSENSITIVE_FIELDS.has(key) && Array.isArray(r[key])
        ? [...r[key]].sort()
        : r[key];
    }
    return out;
  });
  return JSON.stringify(normalized);
}

function hash(str) {
  return createHash('sha256').update(str).digest('hex');
}

async function dirFiles(dir, exclude) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    if (!e.isFile() || exclude.has(e.name)) continue;
    files.push(path.join(dir, e.name));
  }
  return files;
}

async function sizesOf(files) {
  let raw = 0, gzip = 0, brotli = 0;
  for (const f of files) {
    const buf = await readFile(f);
    raw += buf.length;
    gzip += gzipSync(buf, { level: 9 }).length;
    brotli += brotliCompressSync(buf, BROTLI_OPTS).length;
  }
  return { raw, gzip, brotli };
}

// Script files ship minified in production, so measure them that way — the
// harness would otherwise overstate script cost (comments, whitespace,
// long-form identifiers) relative to what a browser actually downloads.
async function minifiedSizesOf(files) {
  let raw = 0, gzip = 0, brotli = 0;
  for (const f of files) {
    const source = await readFile(f, 'utf8');
    const { code } = await transform(source, { minify: true, format: 'esm', loader: 'js' });
    const buf = Buffer.from(code, 'utf8');
    raw += buf.length;
    gzip += gzipSync(buf, { level: 9 }).length;
    brotli += brotliCompressSync(buf, BROTLI_OPTS).length;
  }
  return { raw, gzip, brotli };
}

async function runAttempt(name) {
  const dir = path.join(ATTEMPTS_DIR, name);
  const buildPath = path.join(dir, 'build.mjs');
  const loadPath = path.join(dir, 'load.mjs');

  if (await stat(buildPath).catch(() => null)) {
    const { build } = await import(pathToFileURL(buildPath).href);
    await build({ sourcePath: SOURCE_PATH, dir });
  }

  if (!(await stat(loadPath).catch(() => null))) {
    throw new Error(`attempt "${name}" has no load.mjs`);
  }
  const { load } = await import(pathToFileURL(loadPath).href + `?t=${Date.now()}`);
  const records = await load({ dir });
  const recordHash = hash(canonicalize(records));

  const dataFiles = await dirFiles(dir, new Set(['build.mjs', 'load.mjs', 'meta.json']));
  const scriptFiles = await dirFiles(dir, new Set(['build.mjs', 'meta.json'])).then(
    (all) => all.filter((f) => f.endsWith('.mjs'))
  );

  const data = await sizesOf(dataFiles);
  const script = await minifiedSizesOf(scriptFiles);

  return {
    name,
    recordCount: records.length,
    hash: recordHash,
    data,
    script,
    total: {
      raw: data.raw + script.raw,
      gzip: data.gzip + script.gzip,
      brotli: data.brotli + script.brotli,
    },
  };
}

async function main() {
  const requested = process.argv.slice(2);
  const allNames = (await readdir(ATTEMPTS_DIR, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  const names = requested.length ? requested : allNames;
  if (!names.includes(BASELINE_NAME) && allNames.includes(BASELINE_NAME)) {
    names.unshift(BASELINE_NAME);
  }

  const results = [];
  for (const name of names) {
    try {
      results.push(await runAttempt(name));
    } catch (err) {
      results.push({ name, error: err.message });
    }
  }

  const baseline = results.find((r) => r.name === BASELINE_NAME && !r.error);

  const rows = results.map((r) => {
    if (r.error) {
      return [r.name, 'ERROR', r.error, '', '', '', ''];
    }
    const match = baseline ? (r.hash === baseline.hash ? 'PASS' : 'FAIL') : 'n/a';
    return [
      r.name,
      match,
      fmt(r.recordCount),
      `${fmt(r.data.raw)} / ${fmt(r.data.gzip)} / ${fmt(r.data.brotli)}`,
      `${fmt(r.script.raw)} / ${fmt(r.script.gzip)} / ${fmt(r.script.brotli)}`,
      `${fmt(r.total.raw)} / ${fmt(r.total.gzip)} / ${fmt(r.total.brotli)}`,
      r.hash ? r.hash.slice(0, 12) : '',
    ];
  });

  const header = ['attempt', 'hash', 'records', 'data raw/gz/br', 'script raw/gz/br', 'total raw/gz/br', 'hash'];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((row) => String(row[i]).length)));
  const printRow = (row) => console.log(row.map((c, i) => String(c).padEnd(widths[i])).join('  '));
  printRow(header);
  printRow(widths.map((w) => '-'.repeat(w)));
  rows.forEach(printRow);

  const anyFail = results.some((r) => !r.error && baseline && r.hash !== baseline.hash);
  if (anyFail) process.exitCode = 1;
}

main();
