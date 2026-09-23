// Resolve ScriptureEarth playlist .txt listings to clip URLs.
// Video playlists are tab-separated (index ⇥ title ⇥ image ⇥ url) with a header line
// (subfolder ⇥ name ⇥ "images"). Audio playlists are JS-object lines
// ({ title:"…", mp3:"data/<iso>/audio/….mp3" }). See scripts/README-dump.md.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const ASSET_BASE = 'https://scriptureearth.org';

export function playlistBasename(filename) {
  const s = String(filename || "").trim().replace(/\\/g, "/");
  const i = s.lastIndexOf("/");
  return i >= 0 ? s.slice(i + 1) : s;
}

export function playlistTxtUrl(iso, filename, kind = 'video') {
  return `${ASSET_BASE}/data/${iso}/${kind}/${playlistBasename(filename)}`;
}

// Turn a raw path/URL from a txt into an absolute URL (spaces are common in mp3 names).
function absUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  return encodeURI(`${ASSET_BASE}/${s.replace(/^\/+/, '')}`);
}

export function parsePlaylistTxt(text) {
  const lines = String(text).split('\n');
  // Header (first non-empty line): [subfolder] ⇥ [name] ⇥ ["images"]. When the 3rd
  // field is "images", each clip's thumbnail lives under /data/~images/<subfolder>/.
  const header = (lines.find((l) => l.trim()) || '').split('\t');
  const subfolder = (header[0] || '').trim();
  const imagesMode = (header[2] || '').trim().toLowerCase() === 'images';
  const clips = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const cols = line.split('\t');
    if (!/^\d+$/.test(cols[0] ?? '')) continue; // skip header / non-clip lines
    const title = (cols[1] && cols[1].trim()) || `Clip ${cols[0]}`;
    const url = absUrl(cols[3]);
    if (!url) continue;
    const clip = { title, url };
    const img = (cols[2] ?? '').trim();
    if (img) {
      if (imagesMode && subfolder) clip.image = `${ASSET_BASE}/data/~images/${subfolder}/${encodeURIComponent(img)}`;
      else if (/^https?:\/\//i.test(img) || img.includes('/')) clip.image = absUrl(img);
      // else: bare filename with no images-mode → unknown location, no thumbnail
    }
    clips.push(clip);
  }
  return clips;
}

export function parseAudioPlaylistTxt(text) {
  const clips = [];
  for (const line of String(text).split('\n')) {
    const m = line.match(/title:\s*"([^"]*)"\s*,\s*mp3:\s*"([^"]*)"/i);
    if (!m) continue;
    const title = m[1].trim();
    const url = absUrl(m[2]);
    if (!url) continue;
    clips.push({ title: title || 'Audio', url });
  }
  return clips;
}

export async function loadPlaylistClips({ iso, filename, cacheDir, kind = 'video' }) {
  const name = playlistBasename(filename);
  if (!iso || !name || !cacheDir) return [];
  const parse = kind === 'audio' ? parseAudioPlaylistTxt : parsePlaylistTxt;
  const cachePath = path.join(cacheDir, iso, name);
  try {
    return parse(readFileSync(cachePath, 'utf8'));
  } catch {
    // cache miss
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15_000);
    const res = await fetch(playlistTxtUrl(iso, filename, kind), { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return [];
    const text = await res.text();
    const clips = parse(text);
    if (clips.length === 0) return [];
    mkdirSync(path.dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, text);
    return clips;
  } catch {
    return [];
  }
}
