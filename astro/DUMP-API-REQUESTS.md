# `db_dump.php` — requested additions

The static Astro rebuild builds entirely from `GET /api/db_dump.php?v=1&key=…` (one JSON
object keyed by row ordinal; the real key is `relationships.idx`). Comparing the JSON build
against the data the **old SQLite dump** produced surfaced fields the dump drops. Everything
below **already exists in the database and in the committed granular API** — the aggregated
`db_dump.php` just needs to carry it. File/line refs are to the current committed API.

The dump is already inconsistent about this: `se_media.playlist_video` carries
`{ title:{…}, filename:{…} }`, but `watch` and `buy` are bare URL lists. The ask is to make
the rest consistent with the playlist pattern.

## Status (2026-09-22)

Most of this is **done** — the dev added the columns and restructured `watch`, `buy`,
`se_apps`, and `links_media` into nested `{ field:{…} }` maps (like `playlist_video`), and
`extract.mjs` now consumes them: watch/buy/app/link **titles** are back, and Bible.is
read/listen/view is split via `links_media["Bible.is"].media_type` (1–8). Still open:

- **`study` table** — still absent from the dump (~610 languages have no study/tools resource).
- **`eBible` title** — `links_media.eBible` is still flat `{0:url}` with no title (comes from
  `eBible_list.title`, a different table than the `links.company_title` that was added).
- **`other_websites` title** — still flat `{0:url}`.
- **naming nit:** buy's title arrives under the key `testament` (not `buy_what`/`title`); the
  projector accepts either, so this is cosmetic — worth renaming for consistency with `watch`.

## Columns at a glance

One row per DB column the dump should carry but currently doesn't:

| Table | Column | Why we want it |
|---|---|---|
| `watch` | `watch_what` | The video's title (e.g. "My Last Day"), instead of a generic "YouTube". |
| `watch` | `organization` | Who produced/hosts the video (often the local-language title) — shown as the source. |
| `buy` | `buy_what` | The printed edition's title, instead of a generic "Printed edition". |
| `buy` | `organization` | The store/publisher selling it (Lulu.com, Virtual Storehouse, …). |
| `CellPhone` | `Cell_Phone_Title` | The app's name, instead of a generic "Android app" / "iOS app". |
| `links` | `company_title` | The edition/version name for web links (YouVersion, Bibles.org, GRN, Bible.is). |
| `links` | `BibleIs` | Code marking a Bible.is link as text / audio / both, so it can be listed under Read **and** Listen (~2000 languages lost their Bible.is audio without it). |
| `eBible_list` | `title` | The eBible edition's title, instead of a generic "eBible edition". |
| `study` | `ScriptureDescription` | The study/reference tool's title (the whole `study` table is absent; ~610 languages). |
| `study` | `ScriptureURL` | The study tool's link (fall back to `othersiteURL` when empty). |

The first 8 are columns the dump can already reach (the granular API emits them); the two
`study` rows plus `links.BibleIs` are the additions that need real work. Detail below.

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
