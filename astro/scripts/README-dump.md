# DB dump → SQLite → build

The site is built from a **SQLite snapshot of the production `scripture` database**.
The snapshot is produced from a MySQL/MariaDB `mysqldump` downloaded from the API — no
per-record scraping. Three steps, then the normal build:

```
fetch_dump.mjs        convert_dump.mjs                 extract.mjs + astro build
────────────────      ───────────────────────         ─────────────────────────
/api dump endpoint ─► data/scripture.sql ─► mysql2sqlite.awk ─► data/scripture.db ─► content/*.json ─► dist/
   (SE_KEY auth)          (MySQL SQL)        (+ node:sqlite import)   (SQLite)
```

`data/scripture.db` and `data/scripture.sql` are git-ignored (`data/`); every build regenerates them.

## Worktrees: share one data folder (`npm run setup:data`)

Because `data/` is git-ignored, a freshly-created **git worktree starts with no DB** — and you
don't want each worktree re-downloading the dump. The fix is one shared folder that every
worktree points at, recorded in a single **shared git config key** (lives in the common
`.git/config`, so every worktree sees it — no machine path is ever committed):

```bash
# once per machine, from any worktree — pick any absolute path (the main checkout's is fine):
git config se.datadir "C:/dev/ScriptureEarth/astro/data"

# put the API key in that folder (git-ignored, never committed):
#   <that folder>/config.env
#     SE_KEY=your-api-key
#     # SE_DUMP_PATH=/api/db_dump.php   # once the real endpoint is confirmed

npm run setup:data     # resolves the folder, fetch+convert the DB there IF missing, else no-op
```

After that, every worktree's `fetch:dump` / `convert:dump` / `extract` reads and writes that
one folder. Resolution order for the data dir: `SE_DATA_DIR` env → `git config se.datadir` →
`<package>/data` (the old worktree-local behavior, used when nothing is configured).
`setup:data` is idempotent — if the DB is already there it does nothing. If you have no key
but already possess a `scripture.sql` or `scripture.db`, just drop it in the folder and re-run.

## Run it

```bash
# One shot: fetch + convert + extract + astro build
SE_KEY=yourkey npm run build:fresh

# Or step by step
SE_KEY=yourkey npm run fetch:dump     # → data/scripture.sql
npm run convert:dump                  # → data/scripture.db
npm run build:dump                    # extract.mjs + astro build → dist/
```

**Windows:** run from **Git Bash** — `convert_dump.mjs` shells out to `awk`, which ships with
Git for Windows. (On Linux/CI `awk` is always present.) Node 18+ is required for the built-in
`node:sqlite` importer, so no `sqlite3` CLI is needed.

## Configuration (env)

| var | default | meaning |
|---|---|---|
| `SE_KEY` | *(required for fetch)* | API key — a row in the server's `api_users` table. Never logged or committed. |
| `SE_DUMP_PATH` | `/api/db_dump.php` | **PLACEHOLDER** — the real dump endpoint path. Confirm with the API developer and update the default here (or pass this var / the CI variable). |
| `SE_BASE` | `https://scriptureearth.org` | API host. |
| `SE_V` | `1` | API version query param. |
| `SE_DUMP_URL` | *(unset)* | Full endpoint URL, auth included — overrides `SE_BASE`+`SE_DUMP_PATH` and disables key-appending. Escape hatch for local testing. |
| `SE_DUMP_OUT` | `<data dir>/scripture.sql` | Where the dump is written / read. |
| `SE_DB` | `<data dir>/scripture.db` | Output SQLite DB (also read by `extract.mjs`). |
| `SE_DATA_DIR` | *(unset)* | Override the shared data dir for one command (else `git config se.datadir`, else `<package>/data`). Also the folder `config.env` is read from. |
| `SE_STRICT` | *(unset)* | `1` → `convert_dump.mjs` exits non-zero if `scripture_main` is empty (used in CI). |
| `AWK` | `awk` | Override the awk binary if it isn't on `PATH`. |

## Files

| file | role |
|---|---|
| `data-dir.mjs` | Resolves the shared data dir (`SE_DATA_DIR` → `git config se.datadir` → `<package>/data`) and loads `<dir>/config.env` secrets without clobbering real env. Imported by the three scripts below. |
| `setup-data.mjs` | `npm run setup:data` — worktree bootstrap: ensure the shared DB exists (fetch+convert once), else no-op; guides you to set `se.datadir` / `config.env` when unconfigured. |
| `fetch_dump.mjs` | Download the MySQL dump (same `?v=&key=` auth as the rest of `/api/`). Detects gzip; rejects HTML error pages. |
| `convert_dump.mjs` | `awk mysql2sqlite` → SQLite SQL, imported into a **fresh** `data/scripture.db` via `node:sqlite`. Reports table/row counts. |
| `mysql2sqlite.awk` | Vendored converter (MIT, github.com/dumblob/mysql2sqlite) — handles MySQL escaping, `AUTO_INCREMENT`, `KEY`→`CREATE INDEX`, charset/collation stripping. Do not edit; re-vendor from upstream. |

## Deprecated: JSON API harvest

`scripts/harvest/` (`harvest.mjs` + `project.mjs`, `npm run build:api`) scraped the per-language
JSON endpoints. It is **superseded** by the dump path (strictly more complete — includes `buy`
rows and full media/links/SAB tables the API never served) and kept only as a fallback. Prefer
`build:fresh` / `build:dump`.
