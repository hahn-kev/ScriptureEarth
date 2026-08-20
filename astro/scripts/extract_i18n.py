#!/usr/bin/env python3
"""
Seed the per-locale LOCALIZED-NAME catalogs (public/i18n/names.<loc>.json) from the DB's
LN_<Locale> tables, for the client-side localizer to swap language names by idx. Also emits
a small locales registry.

NOTE: UI *chrome* catalogs (public/i18n/chrome.<loc>.json) are code-owned and live from
scripts/i18n/en.json (translated per locale) — this script does NOT touch them.

Names are localized-language-name DATA seeded once from the dump; committed (code-owned),
reused across builds. English names are baked into the pages, so no names.eng.json.
"""
import json, os, sqlite3, sys

HERE = os.path.dirname(os.path.abspath(__file__))                # astro/scripts/
DB   = os.environ.get("SE_DB") or os.path.join(HERE, "..", "data", "scripture.db")
OUT  = os.path.join(HERE, "..", "public", "i18n")
os.makedirs(OUT, exist_ok=True)

# 3-letter locale -> LN_<Locale> column (localized language names). English excluded (baked).
LOCALES = {
    "spa": "LN_Spanish", "por": "LN_Portuguese", "fra": "LN_French", "nld": "LN_Dutch",
    "deu": "LN_German", "cmn": "LN_Chinese", "kor": "LN_Korean", "rus": "LN_Russian", "arb": "LN_Arabic",
}
REGISTRY = {
    "eng": {"label": "English",    "dir": "ltr", "bcp": "en"},
    "spa": {"label": "Español",    "dir": "ltr", "bcp": "es"},
    "por": {"label": "Português",  "dir": "ltr", "bcp": "pt"},
    "fra": {"label": "Français",   "dir": "ltr", "bcp": "fr"},
    "nld": {"label": "Nederlands", "dir": "ltr", "bcp": "nl"},
    "deu": {"label": "Deutsch",    "dir": "ltr", "bcp": "de"},
    "cmn": {"label": "中文",        "dir": "ltr", "bcp": "zh"},
    "kor": {"label": "한국어",       "dir": "ltr", "bcp": "ko"},
    "rus": {"label": "Русский",    "dir": "ltr", "bcp": "ru"},
    "arb": {"label": "العربية",     "dir": "rtl", "bcp": "ar"},
    # Chrome-only locales (no LN_ name table in the DB — language names fall back to English).
    "ind": {"label": "Bahasa Indonesia", "dir": "ltr", "bcp": "id"},
    "hin": {"label": "हिन्दी",       "dir": "ltr", "bcp": "hi"},
    "swa": {"label": "Kiswahili",   "dir": "ltr", "bcp": "sw"},
    "fil": {"label": "Filipino",    "dir": "ltr", "bcp": "fil"},
    "fas": {"label": "فارسی",       "dir": "rtl", "bcp": "fa"},
}

db = sqlite3.connect(DB)
db.row_factory = sqlite3.Row

def dump(name, obj):
    p = os.path.join(OUT, name)
    json.dump(obj, open(p, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"  {name:20} {len(obj):>5} entries  {os.path.getsize(p)//1024 or 1} KB", file=sys.stderr)

print("seeding per-locale name catalogs ->", OUT, file=sys.stderr)
for loc, col in LOCALES.items():
    names = {}
    for r in db.execute(f"SELECT ISO_ROD_index i, {col} n FROM {col} WHERE ISO_ROD_index IS NOT NULL"):
        if r["n"] and r["n"].strip():
            names[str(r["i"])] = r["n"].strip()
    dump(f"names.{loc}.json", names)
dump("locales.json", REGISTRY)
print("done", file=sys.stderr)
