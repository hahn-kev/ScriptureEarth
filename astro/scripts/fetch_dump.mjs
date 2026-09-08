// Download a MySQL/MariaDB dump from the ScriptureEarth API and write it to
// data/scripture.sql, ready for scripts/convert_dump.mjs → data/scripture.db.
//
// This replaces the throwaway JSON harvester (scripts/harvest/) as the source of
// truth: instead of scraping per-language endpoints, the server exposes one
// endpoint that streams a `mysqldump` of the `scripture` DB. Auth is the SAME key
// the rest of /api/ uses (a row in the server's `api_users` table).
//
// Requires Node 18+ (global fetch). Run:  SE_KEY=... node scripts/fetch_dump.mjs
//
// Env knobs:
//   SE_KEY       (required)  API key (never logged, never written to disk)
//   SE_DUMP_URL  (optional)  Full endpoint URL. Overrides SE_BASE/SE_DUMP_PATH.
//   SE_BASE      default https://scriptureearth.org
//   SE_DUMP_PATH default /api/db_dump.php   ← PLACEHOLDER: confirm the real path
//                                             with the API developer, then set it
//                                             here (or pass SE_DUMP_URL / the CI var).
//   SE_V         default 1            API version query param (0.5 | 1 | 2)
//   SE_DUMP_OUT  default data/scripture.sql   output path
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
const BASE = (process.env.SE_BASE || 'https://scriptureearth.org').replace(/\/$/, '');
const DUMP_PATH = process.env.SE_DUMP_PATH || '/api/db_dump.php';
const V = process.env.SE_V || '1';
const OUT = process.env.SE_DUMP_OUT || DATA.sql;
const UA = 'ScriptureEarth-Build/1.0 (static-site rebuild; SIL)';

if (!KEY) {
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
  res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/sql, application/octet-stream, */*' } });
} catch (e) {
  console.error(`ERROR: request failed: ${e}`);
  process.exit(1);
}
if (!res.ok) {
  console.error(`ERROR: HTTP ${res.status} ${res.statusText} from dump endpoint.`);
  console.error('  If 401/403: check SE_KEY / SE_V. If 404: SE_DUMP_PATH is wrong — confirm the endpoint with the API developer.');
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
// Sanity-check that this is actually a SQL dump and not an HTML error page.
if (!/CREATE\s+TABLE/i.test(text) || /<html/i.test(text.slice(0, 500))) {
  console.error('ERROR: response does not look like a SQL dump (no CREATE TABLE, or looks like HTML).');
  console.error(`  First 300 bytes:\n${text.slice(0, 300)}`);
  process.exit(1);
}

await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, buf);
const mb = (buf.length / (1024 * 1024)).toFixed(1);
const tables = (text.match(/CREATE\s+TABLE/gi) || []).length;
console.error(`wrote ${OUT}  (${mb} MB, ${tables} CREATE TABLE) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
