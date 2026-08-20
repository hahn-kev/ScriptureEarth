// ScriptureEarth PoC data harvester — THROWAWAY tooling for the static-rewrite proof-of-concept.
//
// Pulls ENGLISH-ONLY catalog data from the live /api/ JSON endpoints, once, throttled,
// and caches every response to disk so re-runs never re-hit the server (resumable).
// API DATA ONLY — it never downloads media files, PDFs, audio, or zip bundles.
//
// Requires Node 18+ (global fetch). Run:  SE_KEY=... node harvest.mjs
// The key is a valid row in the server's `api_users` table — supplied by the site owner,
// passed via env var, and NEVER written to disk or committed.
//
// Env knobs:
//   SE_KEY   (required)  API key
//   SE_BASE  default https://scriptureearth.org
//   SE_V     default 1            (allowed: 0.5 | 1 | 2)
//   SE_RPS   default 2            requests/second (be polite)
//   SE_LIMIT default 0            0 = all entries; set e.g. 5 for a first test run
//   SE_OUT   default ./data       output dir (git-ignored)

import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

const KEY = process.env.SE_KEY;
const BASE = (process.env.SE_BASE || "https://scriptureearth.org").replace(/\/$/, "");
const V = process.env.SE_V || "1";
const RPS = Number(process.env.SE_RPS || 2);
const LIMIT = Number(process.env.SE_LIMIT || 0);
const OUT = process.env.SE_OUT || "./data";
const RAW = path.join(OUT, "raw");
const UA = "ScriptureEarth-PoC-Harvester/0.1 (one-time rebuild snapshot; SIL)";

if (!KEY) {
  console.error("ERROR: SE_KEY is required (a valid /api/ key from the api_users table).");
  console.error("Usage:  SE_KEY=yourkey node harvest.mjs   (optionally SE_LIMIT=5 to test first)");
  process.exit(1);
}

const minInterval = 1000 / Math.max(RPS, 0.1);
let lastReq = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exists = (p) => access(p, constants.F_OK).then(() => true).catch(() => false);

const stats = { calls: 0, cached: 0, errors: [] };

// Fetch /api/<endpoint>?v&key&<extra>, cache by (endpoint, cacheKey). Resumable + throttled.
async function apiGet(endpoint, extra = "", cacheKey = "all") {
  const dir = path.join(RAW, endpoint.replace(/\.php$/, ""));
  const file = path.join(dir, `${cacheKey}.json`);
  if (await exists(file)) {
    stats.cached++;
    try { return JSON.parse(await readFile(file, "utf8")); } catch { return null; }
  }
  const wait = minInterval - (Date.now() - lastReq);
  if (wait > 0) await sleep(wait);
  lastReq = Date.now();

  const url = `${BASE}/api/${endpoint}?v=${encodeURIComponent(V)}&key=${encodeURIComponent(KEY)}${extra ? "&" + extra : ""}`;
  stats.calls++;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (!res.ok) { stats.errors.push({ endpoint, cacheKey, status: res.status }); return null; }
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { stats.errors.push({ endpoint, cacheKey, parse: true }); return null; }
    await mkdir(dir, { recursive: true });
    await writeFile(file, JSON.stringify(json)); // raw cache (never contains the key)
    return json;
  } catch (e) {
    stats.errors.push({ endpoint, cacheKey, error: String(e) });
    return null;
  }
}

const n = (x) => Number(x) || 0;

function englishProjection(rel, detail) {
  return {
    idx: rel.idx,
    iso: rel.iso ?? undefined,
    rod: rel.rod,
    variantCode: rel.var_code,
    variantName: rel.var_name,
    name: rel.language_name?.English || "",
    altNames: Object.values(rel.alternate_language_names || {}),
    countries: Object.values(rel.countries_names || {}),
    countryCodes: Object.values(rel.countries_codes || {}),
    availability: {
      textPdf: n(rel.se_media?.text),
      ePub: n(rel.se_media?.ePub),
      audio: n(rel.se_media?.audio),
      playlistAudio: n(rel.se_media?.playlist_audio),
      playlistVideo: n(rel.se_media?.playlist_video),
      apps: rel.se_apps,
      sab: rel.se_sab,
      viewer: n(rel.se_online_viewer),
      googlePlay: n(rel.se_google_play),
      otherSoftware: rel.se_other_software,
      linksMedia: rel.links_media,
      buy: n(rel.buy),
      maps: n(rel.maps),
      watch: n(rel.watch),
      websites: n(rel.websites),
      otherTitles: n(rel.other_titles),
      silLink: n(rel.SIL_link),
    },
    detail, // raw per-language endpoint responses (only those the flags warranted)
  };
}

async function main() {
  await mkdir(OUT, { recursive: true });
  console.log(`Harvest → ${BASE}/api  (v=${V}, ${RPS} req/s${LIMIT ? `, limit ${LIMIT}` : ""})`);

  // 1) Whole catalog in a single call.
  const all = await apiGet("all_iso.php", "", "all");
  if (!all) { console.error("all_iso.php failed — check SE_KEY / SE_V. Aborting."); process.exit(2); }
  let entries = Object.values(all).filter((e) => e && e.relationships);
  console.log(`all_iso.php → ${entries.length} entries`);
  if (LIMIT > 0) entries = entries.slice(0, LIMIT);

  // 2) Per-language detail — only the endpoints a language's flags say it has.
  const out = [];
  let i = 0;
  for (const entry of entries) {
    const rel = entry.relationships;
    const idx = rel.idx;
    const a = rel; // availability flags live on relationships
    const detail = {};

    detail.record = await apiGet("records.php", `idx=${idx}`, String(idx));
    if (n(a.se_media?.text) || n(a.se_media?.audio) || n(a.se_media?.ePub))
      detail.media = await apiGet("media_se.php", `idx=${idx}`, String(idx));
    if (n(a.other_titles))
      detail.other = await apiGet("other_se.php", `idx=${idx}`, String(idx));
    if (n(a.se_apps?.android) || n(a.se_apps?.ios) || n(a.se_google_play))
      detail.apps = await apiGet("apps.php", `idx=${idx}`, String(idx));
    if (n(a.se_sab?.text) || n(a.se_sab?.audio) || n(a.se_sab?.video))
      detail.sab = await apiGet("sab.php", `idx=${idx}`, String(idx));
    if (n(a.buy) || n(a.maps) || n(a.watch) || Object.values(a.links_media || {}).some(n))
      detail.links = await apiGet("general_links.php", `idx=${idx}`, String(idx));
    if (n(a.websites))
      detail.websites = await apiGet("website_links.php", `idx=${idx}`, String(idx));

    out.push(englishProjection(rel, detail));
    if (++i % 100 === 0) console.log(`  …${i}/${entries.length}  (calls ${stats.calls}, cached ${stats.cached}, errors ${stats.errors.length})`);
  }

  await writeFile(path.join(OUT, "poc-english.json"), JSON.stringify(out, null, 2));
  await writeFile(path.join(OUT, "summary.json"), JSON.stringify({
    generatedFromEntries: entries.length,
    totalEntriesInCatalog: Object.values(all).filter((e) => e && e.relationships).length,
    liveCalls: stats.calls, cacheHits: stats.cached, errors: stats.errors,
  }, null, 2));

  console.log(`\nDone. ${out.length} entries → ${path.join(OUT, "poc-english.json")}`);
  console.log(`Live calls: ${stats.calls} · cache hits: ${stats.cached} · errors: ${stats.errors.length}`);
  if (stats.errors.length) console.log(`See ${path.join(OUT, "summary.json")} for error detail.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
