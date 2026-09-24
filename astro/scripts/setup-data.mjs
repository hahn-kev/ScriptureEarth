// One-shot data bootstrap for a fresh git worktree.  `pnpm run setup:data`
//
// LOCAL DEV ONLY. CI does not use this — a CI build fetches the dump fresh
// (`fetch:dump`) and lets `extract.mjs` fetch video playlist listings from the
// server. This script just saves local devs the downloads.
//
// The dump (data/scripture.json) is gitignored, so a new worktree starts without
// it. This resolves the SHARED data folder (see scripts/data-dir.mjs), makes sure
// the JSON dump is present there, and downloads it exactly once per machine — every
// worktree then reads that same copy.
//
// It NEVER puts a machine path or secret in the tree: the folder location lives
// in one shared git config key (`se.datadir`), and secrets live in a gitignored
// `config.env` inside that folder.
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, copyFileSync, statSync } from 'node:fs';
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
// JSON_URL points at a Drive zip of scripture.json (the current source of truth).
const JSON_URL = process.env.SE_JSON_URL || driveUrl('1c99YGqRwlEH6U252CdPy30CJVeKvvXnx');
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
if (src.startsWith('default') && !existsSync(P.json)) {
  console.error(`
No shared data folder configured, and none found locally.

Point all worktrees at one shared folder (run ONCE, from any worktree — it lands
in the shared .git/config and every worktree sees it):

    git config ${GIT_CONFIG_KEY} "${suggestedSharedDir().replace(/\\/g, '/')}"

Use whatever absolute path you like — the main checkout's data/ folder (above) is
a fine choice. A prebuilt scripture.json downloads with no key. To rebuild it from
the live API instead, put your key in that folder's config.env:

    ${path.join(dir, 'config.env')}
    # ---- example ----
    SE_KEY=your-api-key
    # endpoint defaults are correct; override only for testing:
    # SE_DUMP_URL=https://www.scriptureearth.org/api/db_dump.php?v=1  # or a file:// path

...then re-run:  pnpm run setup:data
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

# Rebuild scripture.json from the live API dump (maintainers):
# SE_KEY=your-api-key
# Endpoint defaults to https://www.scriptureearth.org/api/db_dump.php?v=1 — override only for testing:
# SE_DUMP_URL=https://www.scriptureearth.org/api/db_dump.php?v=1

# Or override the prebuilt-artifact download links (defaults are baked into setup-data.mjs):
# SE_JSON_URL=https://.../scripture.json.zip   # zip (or raw .json) of the dump
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

// Find the largest *.json under a directory (recursively) — the dump inside a zip
// may be named anything (scripture.json, scripture.unexpected.json, ...).
function findLargestJson(root) {
  let best = null;
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = path.join(d, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (/\.json$/i.test(name) && (!best || st.size > best.size)) best = { p, size: st.size };
    }
  };
  walk(root);
  return best?.p ?? null;
}

// ---- JSON dump (data/scripture.json) ----
// Prefer the prebuilt download (fast, no key). To rebuild from the live API use
// `pnpm run fetch:dump` (or `build:fresh`), or run this with SE_KEY/SE_DUMP_URL set
// and no JSON_URL. SE_JSON_URL may point at a zip OR a raw .json.
if (existsSync(P.json)) {
  console.error(`✓ dump already present: ${P.json}`);
} else if (JSON_URL) {
  console.error(`\n> download dump  (${JSON_URL})`);
  const tmp = path.join(dir, '.scripture-json.download');
  try {
    await download(JSON_URL, tmp);
    const buf = readFileSync(tmp);
    if (buf.length > 1 && buf[0] === 0x50 && buf[1] === 0x4b) {         // 'PK' → ZIP
      const unzipDir = path.join(dir, '.scripture-json.unzip');
      rmSync(unzipDir, { recursive: true, force: true });
      unzipInto(buf, unzipDir);
      const found = findLargestJson(unzipDir);
      if (!found) throw new Error('zip contained no .json file');
      copyFileSync(found, P.json);
      rmSync(unzipDir, { recursive: true, force: true });
    } else {                                                            // raw JSON
      writeFileSync(P.json, buf);
    }
    console.error(`  wrote ${P.json}`);
  } catch (e) {
    console.error(`ERROR: dump download failed: ${e.message}`);
    console.error('  Set SE_JSON_URL to a reachable link, or add SE_KEY/SE_DUMP_URL to fetch from the API.');
    process.exit(1);
  } finally {
    try { rmSync(tmp, { force: true }); } catch {}
  }
} else if (process.env.SE_KEY || process.env.SE_DUMP_URL) {
  run('fetch_dump.mjs', 'fetch:dump  (download JSON dump → scripture.json)');
} else {
  console.error(`
No dump, and no way to get one.

Set ONE of these (in ${P.configEnv} or the environment):
    SE_JSON_URL          a link to a prebuilt scripture.json (zip or raw)
    SE_KEY (+ SE_DUMP_URL / SE_DUMP_PATH)   to fetch from the API
or drop an existing scripture.json into ${dir}, then re-run.
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

console.error(`\n✓ Data ready in ${dir}\nNext:  pnpm run extract  &&  pnpm run dev`);
