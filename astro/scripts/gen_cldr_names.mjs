// Localized language-name catalogs (public/i18n/names.<loc>.json) for locales
// with no LN_<Locale> dump table. Names come from Unicode CLDR via Babel
// locale data frozen at conversion time (Intl.DisplayNames coverage and
// strings differ from Babel, so the lookup uses the same language maps
// Babel's Locale.languages would).
//
// Keyed by ISO_ROD_index. CLDR only names major languages; the rest omit
// the key and fall back to the baked English name.
//
// Usage:  node scripts/gen_cldr_names.mjs
import { readFileSync, writeFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { ISO639_ALPHA2 } from "./iso639_alpha2.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB = process.env.SE_DB || path.join(__dirname, "..", "data", "scripture.db");
const OUT = path.join(__dirname, "..", "public", "i18n");

const TARGETS = { ind: "id", hin: "hi", swa: "sw", fas: "fa" };

const X = { ...ISO639_ALPHA2 };
Object.assign(X, {
  cmn: "zh", arb: "ar", zho: "zh", ara: "ar", fas: "fa",
  pes: "fa", msa: "ms", zsm: "ms", swh: "sw",
});

const BABEL_LANGUAGES = JSON.parse(
  readFileSync(path.join(__dirname, "cldr_babel_languages.json"), "utf8"),
);

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
console.error(`idx->iso: ${Object.keys(idx2iso).length} entries`);

function dump(name, obj) {
  const p = path.join(OUT, name);
  writeFileSync(p, JSON.stringify(obj), "utf8");
  const kb = Math.floor(statSync(p).size / 1024) || 1;
  console.error(`  ${name.padEnd(18)} ${String(Object.keys(obj).length).padStart(5)} names  ${kb} KB`);
}

for (const [loc, bcp] of Object.entries(TARGETS)) {
  const langs = BABEL_LANGUAGES[bcp];
  const out = {};
  for (const [idx, iso] of Object.entries(idx2iso)) {
    const nm = langs[iso] || langs[X[iso] || ""];
    if (nm) out[idx] = nm;
  }
  dump(`names.${loc}.json`, out);
}
console.error("done");
