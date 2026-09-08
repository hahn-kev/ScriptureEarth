// One-shot data bootstrap for a fresh git worktree.  `npm run setup:data`
//
// The DB snapshot (data/scripture.db) is gitignored, so a new worktree starts
// without it. This resolves the SHARED data folder (see scripts/data-dir.mjs),
// makes sure the SQLite DB is present there, and downloads/converts it exactly
// once per machine — every worktree then reads that same copy.
//
// It NEVER puts a machine path or secret in the tree: the folder location lives
// in one shared git config key (`se.datadir`), and secrets live in a gitignored
// `config.env` inside that folder.
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveDataDir, dataDirSource, dataPaths, loadDataEnv,
  DEFAULT_DATA_DIR, GIT_CONFIG_KEY,
} from './data-dir.mjs';
import { download, driveUrl, unzipInto } from './download.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const dir = resolveDataDir();
const src = dataDirSource();
const P = dataPaths(dir);

// Prebuilt-artifact sources so a clone WITHOUT an API key still gets working data.
// These are public distribution links (not secrets, not machine-specific), so they
// live in the tree. Override either via env or <dataDir>/config.env.
const DB_URL = process.env.SE_DB_URL || driveUrl('1vgm5sUaVY_6O16rZxPei-0qfK5F_pSEp');
const CACHE_URL = process.env.SE_PLAYLIST_CACHE_URL || driveUrl('1VStxsISzVW8mlHvtN7Ir-0u-7Ab0f_xr');

// Best guess at a SHARED folder to suggest: the main checkout's copy of this
// package's data/ (common .git dir's parent + this package's path within the tree),
// so the example we print isn't the throwaway worktree's own folder.
function suggestedSharedDir() {
  try {
    const commonGit = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { cwd: HERE, encoding: 'utf8' }).stdout.trim();
    const wtRoot = spawnSync('git', ['rev-parse', '--show-toplevel'],
      { cwd: HERE, encoding: 'utf8' }).stdout.trim();
    if (!commonGit || !wtRoot) throw new Error('no git');
    const mainRoot = path.dirname(commonGit);                 // parent of <main>/.git
    const relPkg = path.relative(wtRoot, path.join(HERE, '..')); // e.g. "astro"
    return path.join(mainRoot, relPkg, 'data');
  } catch {
    return DEFAULT_DATA_DIR;
  }
}

console.error(`data dir: ${dir}\n  (source: ${src})`);

// If we fell back to the worktree-local default AND it's empty, the pointer almost
// certainly isn't set up yet. Guide the user instead of silently downloading into
// a per-worktree folder (which defeats the whole point).
if (src.startsWith('default') && !existsSync(P.db) && !existsSync(P.sql)) {
  console.error(`
No shared data folder configured, and none found locally.

Point all worktrees at one shared folder (run ONCE, from any worktree — it lands
in the shared .git/config and every worktree sees it):

    git config ${GIT_CONFIG_KEY} "${suggestedSharedDir().replace(/\\/g, '/')}"

Use whatever absolute path you like — the main checkout's data/ folder (above) is
a fine choice. Then put your API key in that folder's config.env:

    ${path.join(dir, 'config.env')}
    # ---- example ----
    SE_KEY=your-api-key
    # SE_DUMP_PATH=/api/db_dump.php        # once the real endpoint is confirmed
    # SE_DUMP_URL=https://.../dump.sql     # or a full URL / file:// path

...then re-run:  npm run setup:data
`);
  process.exit(1);
}

mkdirSync(dir, { recursive: true });
const applied = loadDataEnv(dir);
if (applied.length) console.error(`loaded from config.env: ${applied.join(', ')}`);

// Seed a commented config.env template so the next person knows what goes there.
if (!existsSync(P.configEnv)) {
  writeFileSync(P.configEnv, `# Secrets + knobs for the ScriptureEarth data build. Gitignored — never committed.
# Real environment variables and CI vars override anything set here.

# Build the DB from the live API dump (maintainers):
# SE_KEY=your-api-key
# SE_DUMP_PATH=/api/db_dump.php
# SE_DUMP_URL=https://scriptureearth.org/api/db_dump.php?v=1

# Or override the prebuilt-artifact download links (defaults are baked into setup-data.mjs):
# SE_DB_URL=https://.../scripture.db
# SE_PLAYLIST_CACHE_URL=https://.../playlist-txt-cache.zip
`);
  console.error(`seeded template: ${P.configEnv}`);
}

function run(script, label) {
  console.error(`\n> ${label}`);
  const r = spawnSync(process.execPath, [path.join(HERE, script)], { stdio: 'inherit', env: process.env });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function dirHasFiles(d) {
  try { return readdirSync(d).length > 0; } catch { return false; }
}

// ---- DB (data/scripture.db) ----
// Prefer the prebuilt download (fast, no key). To rebuild from the live API use
// `npm run fetch:dump && npm run convert:dump` (or `build:fresh`), or run this with
// SE_KEY/SE_DUMP_URL set and no DB_URL.
if (existsSync(P.db)) {
  console.error(`✓ DB already present: ${P.db}`);
} else if (existsSync(P.sql)) {
  run('convert_dump.mjs', 'convert:dump  (existing scripture.sql → scripture.db)');
} else if (DB_URL) {
  console.error(`\n> download DB  (${DB_URL})`);
  try {
    await download(DB_URL, P.db);
    console.error(`  wrote ${P.db}`);
  } catch (e) {
    console.error(`ERROR: DB download failed: ${e.message}`);
    console.error('  Set SE_DB_URL to a reachable link, or add SE_KEY/SE_DUMP_URL to build from the API dump.');
    process.exit(1);
  }
} else if (process.env.SE_KEY || process.env.SE_DUMP_URL) {
  run('fetch_dump.mjs', 'fetch:dump  (download mysqldump → scripture.sql)');
  run('convert_dump.mjs', 'convert:dump  (scripture.sql → scripture.db)');
} else {
  console.error(`
No DB, no dump to convert, and no way to get one.

Set ONE of these (in ${P.configEnv} or the environment):
    SE_DB_URL            a link to a prebuilt scripture.db
    SE_KEY (+ SE_DUMP_URL / SE_DUMP_PATH)   to fetch + convert the API dump
or drop an existing scripture.db / scripture.sql into ${dir}, then re-run.
`);
  process.exit(1);
}

// ---- Playlist cache (data/playlist-txt-cache/) ----
// Non-fatal: extract.mjs re-fetches missing .txt files on demand, this just skips
// thousands of network round-trips. The zip already contains a top-level
// playlist-txt-cache/ folder, so it extracts straight into the data dir.
if (dirHasFiles(P.playlistCache)) {
  console.error(`✓ playlist cache present: ${P.playlistCache}`);
} else if (CACHE_URL) {
  console.error(`\n> download playlist cache  (${CACHE_URL})`);
  const tmp = path.join(dir, '.playlist-cache.download.zip');
  try {
    await download(CACHE_URL, tmp);
    const n = unzipInto(readFileSync(tmp), dir);
    console.error(`  extracted ${n} files → ${P.playlistCache}`);
  } catch (e) {
    console.error(`  WARNING: playlist cache setup failed: ${e.message}`);
    console.error('  Non-fatal — extract.mjs will fetch playlist .txt files on demand (slower).');
  } finally {
    try { rmSync(tmp, { force: true }); } catch {}
  }
} else {
  console.error('  (no SE_PLAYLIST_CACHE_URL — extract.mjs will fetch playlists on demand)');
}

console.error(`\n✓ Data ready in ${dir}\nNext:  npm run extract  &&  npm run dev`);
