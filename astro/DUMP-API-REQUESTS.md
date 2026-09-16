# `db_dump.php` — requested additions

The static Astro rebuild builds entirely from `GET /api/db_dump.php?v=1&key=…` (one JSON
object keyed by row ordinal; the real key is `relationships.idx`). Comparing the JSON build
against the data the **old SQLite dump** produced surfaced fields the dump drops. Everything
below **already exists in the database and in the committed granular API** — the aggregated
`db_dump.php` just needs to carry it. File/line refs are to the current committed API.

The dump is already inconsistent about this: `se_media.playlist_video` carries
`{ title:{…}, filename:{…} }`, but `watch` and `buy` are bare URL lists. The ask is to make
the rest consistent with the playlist pattern.

## Priority 1 — titles/organizations that were on the old site

| dump field | today | add | source in DB / committed API |
|---|---|---|---|
| `watch` | `{ "0": "<url>" }` | `{ title:{…}, organization:{…}, url:{…} }` (parallel maps, like `playlist_video`) | `watch.watch_what`, `watch.organization` — already emitted by [`api/general_links.php:315-362`](api/general_links.php) as `title`/`organization`/`URL` |
| `buy` | `{ "0": "<url>" }` | `{ title:{…}, organization:{…}, url:{…} }` | `buy.buy_what`, `buy.organization` — rendered on the live page ([`include/00-SpecificLanguage.inc.php:3807`](include/00-SpecificLanguage.inc.php)) |
| `se_apps` (`android`/`ios`), `se_google_play` | `{ "0": "<url>" }` | include the app title | `CellPhone.Cell_Phone_Title` — emitted as `title` in [`api/languageNames.php`](api/languageNames.php) |
| `links_media` (`YouVersion`, `eBible`, `Bible.is`) | `{ "0": "<url>" }` | include the edition/version title | `links.company_title` (+ eBible `title`) — see [`api/general_links.php`](api/general_links.php) |

The projector reads whatever it can; where a title is absent it falls back to a generic label
("Printed edition", "YouTube", "eBible edition"). These labels are the visible symptom.

## Priority 2 — resources missing from the dump entirely

| what | status | source | notes |
|---|---|---|---|
| **Bible.is audio** | dump can't distinguish text vs audio | `scripture_main.BibleIs` code (1–4) | The old site listed Bible.is under **both read and listen** using the `BibleIs` code (2,3,4 → text; 1,3,4 → audio). The dump gives one `links_media["Bible.is"]` URL with no type, so ~2,000 languages lost their Bible.is **listen** entry. Please expose the type (a code, or split `Bible.is_text` / `Bible.is_audio`). |
| **Study tools** | absent from the dump | `study` table (`ScriptureURL` / `othersiteURL`, `ScriptureDescription`) | ~600 languages had a study/tools resource; there is no `study` field in the dump at all. |

## Priority 3 — confirmations (no change needed, just verify stability)

- `se_media.text` / `audio` values are now **full URLs** (were basenames). Fine — just confirm this is intentional and stable.
- `se_media.playlist_video` / `playlist_audio` = `{ title:{…}, filename:{…} }` with full URLs. Good — this is the shape we want everywhere.
- Has the dump format changed more than once recently? Two different shapes have been observed within a few days. A `v=` bump on breaking shape changes would let the build pin a known-good version.

## How we guard against silent breakage

`extract.mjs` has a data audit (`SE_STRICT=1` to fail the build): for every dump field it
compares "languages that have raw data" vs "languages we emitted a row from" — if a field has
data but yields nothing, the shape changed. It also reports `watch`/`buy` title coverage. This
is how the playlist-format change was caught; adding the fields above will turn the audit green.
