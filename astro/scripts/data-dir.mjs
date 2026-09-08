// Resolve the shared data directory that holds the DB snapshot + secrets, so every
// git worktree reads/writes ONE copy instead of re-downloading the dump per worktree.
//
// The `data/` folder is gitignored, so a freshly-created worktree starts without it.
// Rather than committing a machine-specific path, we stash that path in ONE shared
// git config key (`se.datadir`) that all worktrees see (it lives in the common
// .git/config, not the per-worktree config). The folder it points at holds both the
// data (scripture.sql / scripture.db) and a gitignored `config.env` with the secrets
// (SE_KEY, SE_DUMP_PATH, ...). See scripts/README-dump.md and `npm run setup:data`.
//
// Resolution order (first hit wins):
//   1. SE_DATA_DIR env var            — explicit, one-off override
//   2. `git config --get se.datadir`  — the shared pointer (recommended)
//   3. <package>/data                 — today's behavior (worktree-local fallback)
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DATA_DIR = path.join(HERE, '..', 'data');
export const GIT_CONFIG_KEY = 'se.datadir';

function fromGitConfig() {
  try {
    const v = execFileSync('git', ['config', '--get', GIT_CONFIG_KEY], {
      cwd: HERE,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return v || null;
  } catch {
    return null; // key unset, or git not on PATH
  }
}

/** Absolute path to the folder holding the DB snapshot + config.env. */
export function resolveDataDir() {
  const dir = process.env.SE_DATA_DIR || fromGitConfig() || DEFAULT_DATA_DIR;
  return path.resolve(dir);
}

/** Where the resolved dir came from — for diagnostics. */
export function dataDirSource() {
  if (process.env.SE_DATA_DIR) return 'SE_DATA_DIR env';
  if (fromGitConfig()) return `git config ${GIT_CONFIG_KEY}`;
  return 'default (<package>/data)';
}

/**
 * Load `<dataDir>/config.env` (simple KEY=VALUE lines) into process.env WITHOUT
 * clobbering anything already set — real env / CI vars always win. Returns the
 * keys that were applied. No-op if the file is absent.
 */
export function loadDataEnv(dataDir = resolveDataDir()) {
  const file = path.join(dataDir, 'config.env');
  if (!existsSync(file)) return [];
  const applied = [];
  for (let line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    // Strip one layer of surrounding quotes, if present.
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = val;
      applied.push(key);
    }
  }
  return applied;
}

/** Convenience: resolved paths for the two data artifacts. */
export function dataPaths(dataDir = resolveDataDir()) {
  return {
    dir: dataDir,
    sql: path.join(dataDir, 'scripture.sql'),
    db: path.join(dataDir, 'scripture.db'),
    playlistCache: path.join(dataDir, 'playlist-txt-cache'),
    configEnv: path.join(dataDir, 'config.env'),
  };
}
