// Seed the per-locale LOCALIZED-NAME catalogs (public/i18n/names.<loc>.json) from the DB's
// LN_<Locale> tables, for the client-side localizer to swap language names by idx. Also emits
// a small locales registry.
//
// NOTE: UI chrome catalogs (public/i18n/chrome.<loc>.json) are code-owned and live from
// scripts/i18n/en.json (translated per locale) — this script does NOT touch them.
//
// Names are localized-language-name DATA seeded once from the dump; committed (code-owned),
// reused across builds. English names are baked into the pages, so no names.eng.json.

import { mkdirSync, writeFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { jsonDump } from "./json_dump.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DB = process.env.SE_DB || path.join(HERE, "..", "data", "scripture.db");
const OUT = path.join(HERE, "..", "public", "i18n");
mkdirSync(OUT, { recursive: true });

// 3-letter locale -> LN_<Locale> column (localized language names). English excluded (baked).
const LOCALES = {
  spa: "LN_Spanish",
  por: "LN_Portuguese",
  fra: "LN_French",
  nld: "LN_Dutch",
  deu: "LN_German",
  cmn: "LN_Chinese",
  kor: "LN_Korean",
  rus: "LN_Russian",
  arb: "LN_Arabic",
};

const REGISTRY = {
  eng: { label: "English", dir: "ltr", bcp: "en" },
  spa: { label: "Español", dir: "ltr", bcp: "es" },
  por: { label: "Português", dir: "ltr", bcp: "pt" },
  fra: { label: "Français", dir: "ltr", bcp: "fr" },
  nld: { label: "Nederlands", dir: "ltr", bcp: "nl" },
  deu: { label: "Deutsch", dir: "ltr", bcp: "de" },
  cmn: { label: "中文", dir: "ltr", bcp: "zh" },
  kor: { label: "한국어", dir: "ltr", bcp: "ko" },
  rus: { label: "Русский", dir: "ltr", bcp: "ru" },
  arb: { label: "العربية", dir: "rtl", bcp: "ar" },
  // Chrome-only locales (no LN_ name table in the DB — language names fall back to English).
  ind: { label: "Bahasa Indonesia", dir: "ltr", bcp: "id" },
  hin: { label: "हिन्दी", dir: "ltr", bcp: "hi" },
  swa: { label: "Kiswahili", dir: "ltr", bcp: "sw" },
  fil: { label: "Filipino", dir: "ltr", bcp: "fil" },
  fas: { label: "فارسی", dir: "rtl", bcp: "fa" },
};

const db = new DatabaseSync(DB);

function dump(name, obj) {
  const p = path.join(OUT, name);
  writeFileSync(p, jsonDump(obj), "utf8");
  const kb = Math.floor(statSync(p).size / 1024) || 1;
  console.error(`  ${name.padEnd(20)} ${String(Object.keys(obj).length).padStart(5)} entries  ${kb} KB`);
}

console.error("seeding per-locale name catalogs ->", OUT);
for (const [loc, col] of Object.entries(LOCALES)) {
  const names = {};
  const rows = db.prepare(
    `SELECT ISO_ROD_index i, ${col} n FROM ${col} WHERE ISO_ROD_index IS NOT NULL`,
  ).all();
  for (const r of rows) {
    const n = r.n;
    if (n && String(n).trim()) names[String(r.i)] = String(n).trim();
  }
  dump(`names.${loc}.json`, names);
}
dump("locales.json", REGISTRY);
console.error("done");
db.close();
