// Small download + unzip helpers used by scripts/setup-data.mjs to pull prebuilt
// artifacts (the SQLite DB and the playlist-txt cache) so cloners without an API
// key still get a working data folder. No external deps: global fetch + a tiny
// pure-Node ZIP extractor over node:zlib (Node has gzip/deflate but not ZIP).
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { inflateRawSync } from 'node:zlib';
import path from 'node:path';

const UA = 'ScriptureEarth-Build/1.0 (static-site rebuild; SIL)';

/** Build a direct-download URL for a Google Drive file id (bypasses the scan page). */
export function driveUrl(id) {
  return `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`;
}

/** Stream a URL to destFile. Throws on non-2xx or an HTML body (Drive error page). */
export async function download(url, destFile) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  const ct = res.headers.get('content-type') || '';
  if (/text\/html/i.test(ct)) {
    throw new Error(`got HTML, not a file (${url}) — the link may need "confirm=t" or isn't shared publicly.`);
  }
  mkdirSync(path.dirname(destFile), { recursive: true });
  await pipeline(Readable.fromWeb(res.body), createWriteStream(destFile));
}

/**
 * Extract a ZIP buffer into destDir (creates it). Handles stored (0) and
 * deflate (8) entries via the central directory. Guards against zip-slip.
 */
export function unzipInto(buf, destDir) {
  // End Of Central Directory record: scan back from the end for its signature.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 0x10000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a ZIP (no end-of-central-directory record)');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const destRoot = path.resolve(destDir) + path.sep;
  let files = 0;
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('corrupt ZIP central directory');
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    off += 46 + nameLen + extraLen + commentLen;

    const outPath = path.resolve(destDir, name);
    if (outPath !== path.resolve(destDir) && !outPath.startsWith(destRoot)) {
      throw new Error(`unsafe ZIP entry escapes destination: ${name}`);
    }
    if (name.endsWith('/')) { mkdirSync(outPath, { recursive: true }); continue; }

    // Local header at localOff: its name/extra lengths can differ from the
    // central directory's, so read them here to find the data offset.
    const lhNameLen = buf.readUInt16LE(localOff + 26);
    const lhExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lhNameLen + lhExtraLen;
    const comp = buf.subarray(dataStart, dataStart + compSize);
    const data = method === 0 ? comp : inflateRawSync(comp);
    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileSync(outPath, data);
    files++;
  }
  return files;
}
