// Convert a MySQL/MariaDB dump (data/scripture.sql) into the SQLite database the
// build reads (data/scripture.db). Two steps, no external CLIs beyond `awk`:
//   1. scripts/mysql2sqlite.awk  — MySQL dump  → SQLite-dialect SQL (proven tool,
//      the same one used for the original one-off conversion).
//   2. node:sqlite DatabaseSync  — execute that SQL into a fresh .db file.
//
// After this, `npm run extract` (extract.mjs) reads data/scripture.db exactly as
// before — the DB → content → Astro path is unchanged.
//
// Run:  node scripts/convert_dump.mjs
//
// Env knobs:
//   SE_DUMP_OUT  default data/scripture.sql   input MySQL dump
//   SE_DB        default data/scripture.db    output SQLite DB
//   AWK          default awk                   awk binary (override if not on PATH)
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { dataPaths } from './data-dir.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = dataPaths();
const SQL_IN = process.env.SE_DUMP_OUT || DATA.sql;
const DB_OUT = process.env.SE_DB || DATA.db;
const AWK = process.env.AWK || 'awk';
const CONVERTER = path.join(HERE, 'mysql2sqlite.awk');

if (!existsSync(SQL_IN)) {
  console.error(`ERROR: input dump not found: ${SQL_IN}`);
  console.error('  Run `node scripts/fetch_dump.mjs` first (or set SE_DUMP_OUT).');
  process.exit(1);
}

const t0 = Date.now();
console.error(`converting ${SQL_IN} → SQLite SQL via ${AWK} -f mysql2sqlite.awk ...`);

// mysql2sqlite does not accept stdin ("-" means stdin and dashes are unsupported),
// so pass the file path as an argument. stdout = SQLite SQL; stderr = benign warnings.
const awk = spawnSync(AWK, ['-f', CONVERTER, SQL_IN], {
  encoding: 'utf8',
  maxBuffer: 512 * 1024 * 1024, // dumps can be tens of MB
});

if (awk.error) {
  if (awk.error.code === 'ENOENT') {
    console.error(`ERROR: '${AWK}' not found on PATH. Install awk (gawk/mawk) or set AWK=/path/to/awk.`);
    console.error('  On Windows, run this from Git Bash (awk ships with Git for Windows).');
  } else {
    console.error(`ERROR: awk failed: ${awk.error}`);
  }
  process.exit(1);
}
if (awk.status !== 0) {
  console.error(`ERROR: awk exited ${awk.status}\n${awk.stderr}`);
  process.exit(1);
}
// awk warnings (case-sensitivity / hex trimming) are expected and non-fatal.
if (awk.stderr && awk.stderr.trim()) {
  const warnLines = awk.stderr.trim().split('\n').length;
  console.error(`  awk emitted ${warnLines} warning line(s) (expected: case-sensitivity/INFO) — continuing.`);
}

const sql = awk.stdout;
if (!sql || !/CREATE TABLE/i.test(sql)) {
  console.error('ERROR: converter produced no CREATE TABLE statements — is the input a real MySQL dump?');
  process.exit(1);
}

// Fresh DB every time: the dump is the whole database, so never merge into a stale file.
for (const f of [DB_OUT, `${DB_OUT}-journal`, `${DB_OUT}-wal`, `${DB_OUT}-shm`]) {
  if (existsSync(f)) rmSync(f);
}

console.error(`importing into ${DB_OUT} ...`);
const db = new DatabaseSync(DB_OUT);
try {
  db.exec(sql);
} catch (e) {
  console.error(`ERROR: SQLite import failed: ${e.message}`);
  process.exit(1);
}

// Report table + row counts so a bad/partial dump is obvious in CI logs.
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
let totalRows = 0;
const spot = ['scripture_main', 'LN_English', 'countries', 'links'];
const spotCounts = {};
for (const { name } of tables) {
  const n = Number(db.prepare(`SELECT COUNT(*) c FROM "${name}"`).get().c);
  totalRows += n;
  if (spot.includes(name)) spotCounts[name] = n;
}
db.close();

const mb = (statSync(DB_OUT).size / (1024 * 1024)).toFixed(1);
console.error(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${tables.length} tables, ${totalRows.toLocaleString()} rows, ${mb} MB`);
console.error(`  spot check: ${spot.map((t) => `${t}=${spotCounts[t] ?? 'MISSING'}`).join('  ')}`);

// Guard: scripture_main is the spine the whole build hangs off. Empty → fail loud.
if (!spotCounts.scripture_main) {
  console.error('WARNING: scripture_main is empty or missing. The build will produce no pages.');
  if (process.env.SE_STRICT === '1') process.exit(1);
}
