// Download the consolidated JSON dump from the ScriptureEarth API and write it to
// data/scripture.json, ready for scripts/extract.mjs → content/.
//
// The endpoint returns ONE pre-joined JSON object: keyed by a row ordinal, each
// value is `{ type, id, attributes, relationships }` for a language (the real key
// is relationships.idx). This is the SAME data the live site's per-language nav
// renders — strictly more complete than the deprecated JSON harvest (it includes
// buy links) and simpler than the deprecated mysqldump path (no awk/SQLite step).
// Auth is the same key the rest of /api/ uses (a row in the `api_users` table).
//
// Requires Node 18+ (global fetch). Run:  SE_KEY=... node scripts/fetch_dump.mjs
//
// Endpoint (confirmed production):
//   https://www.scriptureearth.org/api/db_dump.php?v=1&key=<your key>
// NOTE: the server (Apache + mod_security) rejects the default/empty User-Agent
// with 406 Not Acceptable, so this script always sends a real User-Agent (see UA
// below). With a UA present you get 403 for a bad/missing key and 200 for a valid one.
//
// Env knobs:
//   SE_KEY       (required)  API key (never logged, never written to disk)
//   SE_DUMP_URL  (optional)  Full endpoint URL. Overrides SE_BASE/SE_DUMP_PATH.
//   SE_BASE      default https://www.scriptureearth.org
//   SE_DUMP_PATH default /api/db_dump.php   (confirmed production endpoint)
//   SE_V         default 1            API version query param (0.5 | 1 | 2)
//   SE_DUMP_OUT  default <data dir>/scripture.json   output path
import { mkdir, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataPaths, loadDataEnv } from './data-dir.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = dataPaths();
// Pull SE_KEY / SE_DUMP_PATH / ... from <dataDir>/config.env if not already in the
// environment (real env / CI vars win). Keeps secrets out of the tree.
loadDataEnv(DATA.dir);
const KEY = process.env.SE_KEY;
const BASE = (process.env.SE_BASE || 'https://www.scriptureearth.org').replace(/\/$/, '');
const DUMP_PATH = process.env.SE_DUMP_PATH || '/api/db_dump.php';
const V = process.env.SE_V || '1';
const OUT = process.env.SE_DUMP_OUT || DATA.json;
const UA = 'ScriptureEarth-Build/1.0 (static-site rebuild; SIL)';

if (!KEY && !process.env.SE_DUMP_URL) {
  console.error('ERROR: SE_KEY is required (a valid /api/ key from the api_users table).');
  console.error('Usage:  SE_KEY=yourkey node scripts/fetch_dump.mjs');
  process.exit(1);
}

const url = process.env.SE_DUMP_URL
  || `${BASE}${DUMP_PATH.startsWith('/') ? '' : '/'}${DUMP_PATH}?v=${encodeURIComponent(V)}&key=${encodeURIComponent(KEY)}`;

// Redacted form for logs — never print the key.
const shown = url.replace(/key=[^&]+/, 'key=***');
console.error(`fetching dump: ${shown}`);

const t0 = Date.now();
let res;
try {
  res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json, */*' } });
} catch (e) {
  console.error(`ERROR: request failed: ${e}`);
  process.exit(1);
}
let buf = Buffer.from(await res.arrayBuffer());
// fetch() transparently decodes Content-Encoding (gzip/br). If the *body itself*
// is gzip (e.g. served as application/gzip with a .gz payload), gunzip it here.
if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
  console.error('  body is gzip — decompressing...');
  buf = gunzipSync(buf);
}

const text = buf.toString('utf8');

if (!res.ok) {
  console.error(`ERROR: HTTP ${res.status} ${res.statusText} from dump endpoint.`);
  console.error('  401/403: bad or missing SE_KEY (or wrong SE_V).');
  console.error('  406 Not Acceptable: the server blocked the User-Agent — should not happen from this script (it sends one); check any proxy stripping headers.');
  console.error('  404: SE_DUMP_PATH is wrong — expected /api/db_dump.php on https://www.scriptureearth.org.');
  console.error('  500: server-side error — see the response body below for a PHP message/stack trace.');
  const ctype = res.headers.get('content-type') || '(none)';
  const LIMIT = 4000;
  const body = text.trim() || '(empty response body)';
  console.error(`  content-type: ${ctype}  size: ${buf.length} bytes`);
  console.error(`  --- response body${body.length > LIMIT ? ` (first ${LIMIT} chars of ${body.length})` : ''} ---`);
  console.error(body.slice(0, LIMIT));
  console.error('  --- end response body ---');
  // Persist the full body next to the output so a long trace isn't truncated in the terminal.
  try {
    const dir = path.dirname(OUT);
    const errFile = path.join(dir, `${path.basename(OUT).replace(/\.[^.]+$/, '')}.error.${res.status}.txt`);
    await mkdir(dir, { recursive: true });
    await writeFile(errFile, buf);
    console.error(`  full body written to: ${errFile}`);
  } catch { /* best-effort */ }
  process.exit(1);
}

function saveUnexpected(reason) {
  const ctype = (res.headers.get('content-type') || '').toLowerCase();
  const ext = /json/.test(ctype) ? 'json' : /html/.test(ctype) ? 'html' : /xml/.test(ctype) ? 'xml' : 'txt';
  const dir = path.dirname(OUT);
  const stem = path.basename(OUT).replace(/\.[^.]+$/, '');
  const bad = path.join(dir, `${stem}.unexpected.${ext}`);
  return mkdir(dir, { recursive: true })
    .then(() => writeFile(bad, buf))
    .then(() => {
      console.error(`ERROR: ${reason}`);
      console.error(`  content-type: ${ctype || '(none)'}  size: ${buf.length} bytes`);
      console.error(`  wrote raw response to: ${bad}`);
      console.error(`  First 300 bytes:\n${text.slice(0, 300)}`);
      process.exit(1);
    });
}

// Validate: a JSON object/array of language entries, not an HTML error page.
let data;
try {
  data = JSON.parse(text);
} catch {
  await saveUnexpected('response is not valid JSON (HTML error page? bad key?).');
}
const values = Array.isArray(data) ? data : (data && typeof data === 'object' ? Object.values(data) : []);
const sample = values[0];
const looksLikeDump = values.length > 0 && sample && typeof sample === 'object'
  && sample.attributes && sample.relationships && 'idx' in sample.relationships;
if (!looksLikeDump) {
  await saveUnexpected('JSON parsed but does not look like the language dump (no attributes/relationships.idx).');
}

await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, buf);
const mb = (buf.length / (1024 * 1024)).toFixed(1);
console.error(`wrote ${OUT}  (${mb} MB, ${values.length} languages) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
