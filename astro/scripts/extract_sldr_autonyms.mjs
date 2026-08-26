// Extract language autonyms (each language's name in its own language) from
// SLDR LDML files (SIL Locale Data Repository), e.g. C:\dev\sldr\sldr.
//
// Output: public/i18n/autonyms.json  { "<idx>": "<autonym>" }, keyed by
// ISO_ROD_index like the other name catalogs.
//
// Usage:  node scripts/extract_sldr_autonyms.mjs
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { ISO639_ALPHA2 } from "./iso639_alpha2.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SLDR = process.env.SLDR_DIR || "C:\\dev\\sldr\\sldr";
const DB = process.env.SE_DB || path.join(__dirname, "..", "data", "scripture.db");
const OUT = path.join(__dirname, "..", "public", "i18n");
const BASE = /^[a-z]{2,3}\.xml$/;

function attr(raw, name) {
  const m = raw.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`));
  return m ? m[1] : null;
}

function autonymOf(xml) {
  const ident = xml.match(/<identity\b[^>]*>([\s\S]*?)<\/identity>/);
  if (!ident) return null;
  const langTag = ident[1].match(/<language\b([^>]*?)\s*\/?>/);
  if (!langTag) return null;
  const selfCode = attr(langTag[1], "type");
  if (!selfCode) return null;

  let auto = null;
  const ldn = xml.match(/<localeDisplayNames\b[^>]*>([\s\S]*?)<\/localeDisplayNames>/);
  if (ldn) {
    const langs = ldn[1].match(/<languages\b[^>]*>([\s\S]*?)<\/languages>/);
    if (langs) {
      const re = /<language\b([^>]*?)>([^<]*)<\/language>/g;
      let m;
      while ((m = re.exec(langs[1]))) {
        if (attr(m[1], "alt") != null) continue;
        if (attr(m[1], "type") !== selfCode) continue;
        const text = m[2].trim();
        if (text) { auto = text; break; }
      }
    }
  }
  return [selfCode, auto];
}

const by_code = {};
let n_files = 0;
for (const shard of readdirSync(SLDR).sort()) {
  const d = path.join(SLDR, shard);
  let st;
  try { st = statSync(d); } catch { continue; }
  if (!st.isDirectory()) continue;
  for (const fn of readdirSync(d)) {
    if (!BASE.test(fn)) continue;
    n_files++;
    let xml;
    try { xml = readFileSync(path.join(d, fn), "utf8"); }
    catch { continue; }
    const r = autonymOf(xml);
    if (r && r[1]) by_code[r[0]] = r[1];
  }
}
console.error(`scanned ${n_files} base files -> ${Object.keys(by_code).length} autonyms`);

const db = new DatabaseSync(DB, { readOnly: true });
const idx2iso = {};
for (const row of db.prepare(
  "SELECT DISTINCT ISO_ROD_index, ISO FROM ISO_countries " +
  "WHERE ISO_ROD_index IS NOT NULL AND ISO IS NOT NULL",
).iterate()) {
  const idx = String(row.ISO_ROD_index);
  if (!(idx in idx2iso)) idx2iso[idx] = String(row.ISO);
}
db.close();

const out = {};
for (const [idx, iso] of Object.entries(idx2iso)) {
  const a = by_code[iso] || by_code[ISO639_ALPHA2[iso] || ""];
  if (a) out[idx] = a;
}

const p = path.join(OUT, "autonyms.json");
writeFileSync(p, JSON.stringify(out), "utf8");
const kb = Math.floor(statSync(p).size / 1024) || 1;
console.error(`autonyms.json: ${Object.keys(out).length}/${Object.keys(idx2iso).length} idx covered  (${kb} KB)`);
