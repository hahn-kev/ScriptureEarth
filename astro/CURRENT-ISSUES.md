# Current issues / known gaps

Running list of known limitations in the Astro rebuild. Each entry: what, why, and
where to look. Remove an entry when it's fixed.

## Data projection (JSON dump → `content/`)

The projector is `scripts/extract.mjs` (reads `data/scripture.json`). The consolidated
JSON dump is now the source of truth; the old SQLite/`mysqldump` and JSON-harvest paths
are deprecated (`build:sqlite` / `build:api`). See `scripts/README-dump.md`. The items
below are places the JSON projection differs from what the deprecated SQLite extractor
produced, or where the dump doesn't carry enough to build a link.

### 1. ePub / SAB-html / GoBible·MySword·theWord are not emitted as links
The dump lists these as **basenames only** (`se_media.ePub`, `other_titles.*`,
`se_sab.text/audio`, `se_other_software.*`), and their public URL scheme isn't the
`/data/<iso>/{PDF,audio,video}/` convention the resolvable assets use — the obvious
guesses 404. The old SQLite extractor didn't emit these as resources either, so this is
parity, not a regression.
- **Effect:** `se_sab` presence still counts toward `read` availability (a pill shows),
  but there's no SAB/ePub/software download link on the detail page.
- **Fix path:** confirm the real URL scheme for these with the API developer, then add
  the mapping in `extract.mjs` (search for `hasSab` and the `use`/`read` sections).

### 2. Dump-vs-old-SQLite gaps — mostly RESOLVED (see `DUMP-API-REQUESTS.md`)
A full diff of the JSON build against the old SQLite dump found several gaps. As of 2026-09-22
the dev delivered most: `watch`/`buy`/`se_apps`/`links_media` were restructured into nested maps
carrying **titles/organizations**, and Bible.is read/listen/view is now split via
`links_media["Bible.is"].media_type` (1–8) — restoring the ~2082 lost Bible.is audio entries.
`extract.mjs` consumes every shape the dump has used. As of 2026-09-23 buy's title is the
`title` key, `eBible` has `title`+`description`, and new `se_iPhone`/`se_ePub` fields exist.
Audio playlists now emit per-track mp3 links (parsed from the JS-object audio `.txt`), and video
playlist clips carry thumbnails (`data/~images/<subfolder>/<img>` from the video `.txt`'s image
column). **Still open:**
- **Study tools (~610)** — no `study` field in the dump at all.
- **`se_ePub`** — bare filename `url` (no resolvable path) + junk title; not emitted yet.
- **`other_websites`** — sometimes only `organization`, no title (minor).

`SE_STRICT=1 npm run extract` audits a dump and fails when a field has data but nothing is
projected (its raw-detectors are shape-agnostic, so a nested/flat change is caught), and reports
`watch`/`buy` title coverage. It is **not** in CI (CI must still deploy).

### 3. Countries with zero languages are dropped
`countries.json` is built by inverting languages → countries, so a country code that no
language references never appears. The old extractor seeded from a full `countries`
table and could include empty countries.
- **Effect:** the countries list only contains countries that have ≥1 language (almost
  certainly the desired behavior, but noting the difference).

### 4. `messages.eng.json` is no longer emitted
The dump doesn't carry the `translations_eng` table. That file was unused by `src`
(UI chrome is code-owned in `public/i18n/`), so this is intentional — listed only so its
absence isn't mistaken for a bug.

### 5. Video playlists depend on fetching `.txt` listings — never skip for a deploy
Video playlists (e.g. JESUS Film) are stored as a `.txt` filename; `extract.mjs` fetches
each to expand its per-clip rows. A playlist with no fetched clips has no URL, so the
**whole row is dropped**. A build made with `SE_SKIP_PLAYLISTS=1` (a dev-speed flag) drops
them all — the flag is documented dev-only. CI does **not** use `setup:data`; it lets
`extract.mjs` fetch the `.txt` listings from the server (`npm run setup:data` is local-dev
convenience only).

### 5b. RESOLVED: the dump's playlist format changed
The live dump changed `se_media.playlist_video`/`playlist_audio` from a flat
`{ "0": "file.txt" }` (basenames) to `{ title: {0:..}, filename: {0: <full URL>} }`, and
`se_media.text`/`audio` values from basenames to full URLs. The old projector read the flat
shape and found nothing (a CI build shipped with 0 video playlists). Fixed: `playlistItems()`
normalizes both shapes and uses the dump-provided title ("The JESUS Film"); `asset()` uses a
full URL as-is. The dump format has been in flux, so the projector now tolerates both shapes —
re-verify against a fresh dump if resources go missing again.

## CI

### 6. size-benchmark duplicates the preview build on astro-poc PRs
`astro-poc.yml`, `astro-preview.yml`, and `size-benchmark.yml` each independently
`fetch:dump` + `build:dump`. On an astro-poc PR, preview and size-benchmark run the same
fetch+build in parallel. They could be consolidated (preview uploads
`dist/assets/sizes.json` as an artifact; a `workflow_run`-triggered size job consumes it),
but size-benchmark also runs on `main` PRs (where preview doesn't) and preview self-gates
without secrets, so it can't fully piggyback. Deferred until real run times are visible
(secrets set).
