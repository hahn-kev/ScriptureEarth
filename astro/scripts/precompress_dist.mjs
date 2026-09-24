// Cloudflare's own edge compression doesn't use Brotli quality 11 (it's
// tuned for CPU cost at request time, not maximum ratio) — see
// bench/README.md's numbers, which are all quality-11 brotli, being smaller
// than what actually ships today. Pages DOES pass through an origin
// response's compression as-is when it already carries a `Content-Encoding`
// header (developers.cloudflare.com/speed/optimization/content/compression/),
// so pre-compressing at build time and declaring the encoding via _headers
// gets us quality-11 bytes on the wire instead of Cloudflare's runtime pass.
//
// This runs on `dist/` AFTER `astro build`, not on `public/` — `public/`
// must stay plain, readable UTF-8 text so `astro dev`/`astro preview` (which
// don't implement Cloudflare's _headers semantics) keep serving/decoding it
// correctly. Only the final deploy artifact gets brotli'd in place.
//
// Caveat: Pages doesn't negotiate content-encoding for a file whose
// encoding is hardcoded via _headers — every client gets the same
// brotli-compressed bytes regardless of its Accept-Encoding. Cloudflare
// also doesn't support the "upload foo.txt AND foo.txt.br, let Cloudflare
// pick" pattern some servers do (confirmed: no such negotiation exists on
// Pages) — so this script also copies the ORIGINAL plain bytes to a
// `.fallback.txt` sibling with no forced encoding, left to Cloudflare's
// normal per-client negotiated compression. src/pages/index.astro fetches
// the fast (br-hardcoded) path first and falls back to that plain path if
// fetching or decoding it fails — see the comment there for why that's
// worth doing despite brotli support being universal in real browsers.
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants as zlibConstants } from 'node:zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, '..', 'dist');

// path (as served, relative to dist/) -> Content-Type to declare alongside
// the hardcoded Content-Encoding: br. A plain `<name>.fallback<ext>` sibling
// (untouched, no forced encoding) is written alongside each one.
const PRECOMPRESS = {
  'search-index.txt': 'text/plain; charset=utf-8',
};

function fallbackPath(relPath) {
  const dot = relPath.lastIndexOf('.');
  return dot === -1 ? `${relPath}.fallback` : `${relPath.slice(0, dot)}.fallback${relPath.slice(dot)}`;
}

async function main() {
  const headerBlocks = [];

  for (const [relPath, contentType] of Object.entries(PRECOMPRESS)) {
    const filePath = path.join(DIST, relPath);
    const original = await readFile(filePath);

    await writeFile(path.join(DIST, fallbackPath(relPath)), original);

    const compressed = brotliCompressSync(original, {
      params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 },
    });
    await writeFile(filePath, compressed);
    console.error(`  precompressed /${relPath}  ${original.length} -> ${compressed.length} bytes (br q11), plain fallback kept at /${fallbackPath(relPath)}`);

    headerBlocks.push(
      `/${relPath}\n  Content-Encoding: br\n  Content-Type: ${contentType}\n  Vary: Accept-Encoding\n`
    );
  }

  const headersPath = path.join(DIST, '_headers');
  const banner = '\n# Added by scripts/precompress_dist.mjs — these files are pre-compressed\n' +
    '# (brotli quality 11) in dist/, not served as plain text; Content-Encoding\n' +
    '# is hardcoded here rather than negotiated, so only touch files that are\n' +
    '# only ever fetched by clients guaranteed to decode Brotli (see that script).\n';
  await appendFile(headersPath, banner + '\n' + headerBlocks.join('\n'));

  console.error(`  updated ${path.relative(process.cwd(), headersPath)}`);
}

main();
