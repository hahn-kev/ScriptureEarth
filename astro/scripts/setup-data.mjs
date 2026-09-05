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
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveDataDir, dataDirSource, dataPaths, loadDataEnv,
  DEFAULT_DATA_DIR, GIT_CONFIG_KEY,
} from './data-dir.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const dir = resolveDataDir();
const src = dataDirSource();
const P = dataPaths(dir);

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
# SE_KEY=your-api-key
# SE_DUMP_PATH=/api/db_dump.php
# SE_DUMP_URL=https://scriptureearth.org/api/db_dump.php?v=1
`);
  console.error(`seeded template: ${P.configEnv}`);
}

if (existsSync(P.db)) {
  console.error(`✓ DB already present: ${P.db}\nNothing to do. Run \`npm run extract\` then \`npm run dev\`.`);
  process.exit(0);
}

function run(script, label) {
  console.error(`\n> ${label}`);
  const r = spawnSync(process.execPath, [path.join(HERE, script)], { stdio: 'inherit', env: process.env });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (!existsSync(P.sql)) {
  if (!process.env.SE_KEY && !process.env.SE_DUMP_URL) {
    console.error(`
No DB and no dump to convert, and no SE_KEY / SE_DUMP_URL to fetch one.

Either add SE_KEY (and SE_DUMP_PATH/SE_DUMP_URL) to:
    ${P.configEnv}
or drop an existing dump at:
    ${P.sql}   (a mysqldump .sql)
    ${P.db}    (an already-built SQLite DB — skips fetch+convert entirely)

Then re-run:  npm run setup:data
`);
    process.exit(1);
  }
  run('fetch_dump.mjs', 'fetch:dump  (download mysqldump → scripture.sql)');
}

run('convert_dump.mjs', 'convert:dump  (scripture.sql → scripture.db)');

console.error(`\n✓ Data ready at ${P.db}\nNext:  npm run extract  &&  npm run dev`);
