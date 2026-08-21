# search-index.txt size bench

Compares candidate encodings of the client search index for correctness
(same data) and cost (bytes shipped to the browser).

**Status: done.** `attempts/combined-columnar-delimited-text/` won (-16.4%
brotli vs. a plain JSON array) and is shipped as the real thing —
`scripts/build_search_index.mjs` is that attempt's `build.mjs` pointed at
`public/search-index.txt` instead of a bench fixture, and the decode logic
lives inline in `src/pages/index.astro`. `scripts/precompress_dist.mjs`
additionally re-compresses it to brotli quality 11 at deploy time, since
Cloudflare's own edge compression doesn't use max quality — see that
script's comments for why, and the caveats around the fallback it ships
alongside (`search-index.fallback.txt`).

`attempts/baseline/` (plain JSON, what shipped before this) is kept as the
harness's reference point. Other attempts that were tried and rejected —
row-major vs. columnar, msgpack, a hand-rolled binary layout, front-coding
— aren't kept around; see git history / prior conversation if you want to
resurrect one.

```
npm run bench:search-index               # all attempts
node bench/harness.mjs baseline my-idea   # just these
```

## Adding an attempt

Copy `attempts/baseline/` to `attempts/<name>/` and change:

- **`build.mjs`** (optional) — `export async function build({ sourcePath, dir })`.
  Regenerates this attempt's data file(s) in `dir` from the canonical source
  (`content/search-index.json`, produced by `scripts/extract.py`). Runs
  before every measurement, so an attempt never ships stale hand-edited data.
- **`load.mjs`** (required) — `export async function load({ dir })`. Reads
  the attempt's data file(s), does whatever decoding a browser would have to
  do (decompress, expand shorthand keys, rebuild arrays, whatever the trick
  is), and returns the record array in the original shape: `{idx, slug,
  code, nm, auto, nms, alt, where, cc, r}`.

Any other file left in the attempt's directory (`.json`, `.bin`, ...) is
counted as shipped **data**. Every `.mjs` file other than `build.mjs` counts
as shipped **script** (minified via esbuild before measuring) — the code
needed to turn the data back into records, since a cleverer format is only
a win if decoding it doesn't cost more than it saves.

## What's measured

- **hash** — sha256 of the decoded records (sorted by `idx`, keys sorted).
  Must match `baseline`'s hash or the attempt is marked `FAIL`. Exception:
  `nms` and `alt` are sorted before hashing, so their element order doesn't
  count as a correctness violation — checked against
  `src/pages/index.astro`, both fields are only ever spread into a
  space-joined string for MiniSearch indexing, never displayed or order-
  sensitive. `cc` and `r` are NOT included in that exception: `cc`'s order
  is baked into the displayed `where` string, and `r`'s order drives pill
  display order.
- **data / script / total raw/gz/br** — byte sizes uncompressed, gzip -9,
  and brotli -11. Brotli -11 is NOT what Cloudflare's automatic edge
  compression actually serves (it uses a lower quality tuned for CPU cost at
  request time) — these numbers are the ceiling you get by pre-compressing
  and declaring `Content-Encoding` yourself, which is what
  `scripts/precompress_dist.mjs` does for the shipped file.
