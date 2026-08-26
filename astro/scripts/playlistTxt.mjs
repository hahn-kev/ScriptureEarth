// Resolve ScriptureEarth PlaylistVideo .txt listings to clip URLs.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export function playlistTxtUrl(iso, filename) {
  return `https://scriptureearth.org/data/${iso}/video/${filename}`;
}

export function parsePlaylistTxt(text) {
  const clips = [];
  for (const line of String(text).split('\n')) {
    if (!line.trim()) continue;
    const cols = line.split('\t');
    if (!/^\d+$/.test(cols[0] ?? '')) continue;
    const title = (cols[1] && cols[1].trim()) || `Clip ${cols[0]}`;
    const raw = (cols[3] ?? '').trim();
    if (!raw) continue;
    const url = (raw.startsWith('http://') || raw.startsWith('https://'))
      ? raw
      : `https://scriptureearth.org/${raw.replace(/^\/+/, '')}`;
    clips.push({ title, url });
  }
  return clips;
}

export async function loadPlaylistClips({ iso, filename, cacheDir }) {
  if (!iso || !filename || !cacheDir) return [];
  const cachePath = path.join(cacheDir, iso, filename);
  try {
    return parsePlaylistTxt(readFileSync(cachePath, 'utf8'));
  } catch {
    // cache miss
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15_000);
    const res = await fetch(playlistTxtUrl(iso, filename), { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return [];
    const text = await res.text();
    const clips = parsePlaylistTxt(text);
    if (clips.length === 0) return [];
    mkdirSync(path.dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, text);
    return clips;
  } catch {
    return [];
  }
}
