# PoC data harvester

Throwaway tooling for the ScriptureEarth static-rewrite proof-of-concept. Pulls **English-only** catalog data from the live `/api/` JSON endpoints, **once**, **throttled**, caching every response to disk so re-runs never re-hit the server. **API data only** — never downloads media files, PDFs, audio, or zip bundles.

## Prerequisites
- **Node 18+** (uses built-in `fetch`).
- A valid **API key** — a row in the server's `api_users` table. Supplied by the site owner; passed via env var; never written to disk or committed.

## Run

Test on a handful of entries first (validates endpoint params politely):
```bash
SE_KEY=yourkey SE_LIMIT=5 node harvest.mjs
```

Full one-time harvest:
```bash
SE_KEY=yourkey node harvest.mjs
```

It's **resumable** — if interrupted, re-run and it skips everything already cached under `data/raw/`.

### Knobs (env vars)
| var | default | meaning |
|---|---|---|
| `SE_KEY` | *(required)* | API key |
| `SE_BASE` | `https://scriptureearth.org` | API host |
| `SE_V` | `1` | API version (`0.5`\|`1`\|`2`) |
| `SE_RPS` | `2` | requests/second (throttle) |
| `SE_LIMIT` | `0` | 0 = all; else cap entry count |
| `SE_OUT` | `./data` | output dir (git-ignored) |

## What it does
1. **One call** to `all_iso.php` → the whole catalog (every entry's `idx`, ISO/ROD/variant, localized names, countries, and resource **counts/flags**). This alone drives the directory list, search index, and availability pills.
2. **Per-language detail** — for each entry, calls a detail endpoint **only when the entry's flags say it has that resource** (`records.php` always; `media_se`/`other_se`/`apps`/`sab`/`general_links`/`website_links` conditionally). This minimizes requests.

## Output (git-ignored `data/`)
- `data/raw/<endpoint>/<idx>.json` — raw cached responses (resumable).
- `data/poc-english.json` — consolidated English projection, one object per language entry (identity, English name, alt names, countries, availability, and the fetched detail).
- `data/summary.json` — entry count, live-call count, and any errors.

## Notes
- The consolidated shape is a first pass; the formal content schema is being designed in the *DB → content schema mapping* ticket and may rename/restructure fields — the raw cache lets us re-project without re-fetching.
- Endpoints beyond `all_iso`/`records` (their exact params/response shapes) are assumed to take `idx`; the `SE_LIMIT=5` test run confirms this before the full harvest.
