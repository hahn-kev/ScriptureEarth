#!/usr/bin/env python3
"""
THROWAWAY — i18n localizer prototype (ticket 14).

Emits the per-locale catalogs the client-side localizer consumes, proving the
"single English shell + client-side enhancement" model (ticket 13):

    astro/public/i18n/chrome.<loc>.json   {slug: phrase}   UI chrome (finite set)
    astro/public/i18n/names.<loc>.json    {idx: name}      localized language names

Chrome slugs map to REAL `translations_eng` ids so translations are genuine
(`translations_<loc>` id-matched); slugs with no DB translation are simply omitted
=> the runtime keeps the baked English text (the English-fallback path from ticket 09).
Names come from the `LN_<Locale>` tables.
"""
import json, os, sqlite3, sys

HERE = os.path.dirname(os.path.abspath(__file__))               # astro/scripts/
DB   = os.environ.get("SE_DB") or os.path.join(HERE, "..", "data", "scripture.db")
OUT  = os.path.join(HERE, "..", "public", "i18n")
os.makedirs(OUT, exist_ok=True)

# locale 3-letter -> (translations_<loc> table suffix, LN_<Locale> column)
LOCALES = {
    "spa": ("translations_spa", "LN_Spanish"),
    "rus": ("translations_rus", "LN_Russian"),
    "arb": ("translations_arb", "LN_Arabic"),
}

# chrome slug -> translations_eng.id  (only slugs with a real DB phrase; the rest
# are tagged in the HTML but absent here, so they fall back to baked English).
SLUG_TO_ID = {
    "read": 47, "listen": 56, "download": 61, "search": 38,
    "country": 16, "countries": 250, "app": 293, "audio": 291,
    "video": 292, "view": 73, "home": 29,
    "langname": 39, "langcode": 42, "altnames": 40,
}

db = sqlite3.connect(DB); db.row_factory = sqlite3.Row

def phrases(table):
    out = {}
    for r in db.execute(f"SELECT id, phrase FROM {table}"):
        if r["phrase"] and r["phrase"].strip() and r["phrase"].strip() != "�":
            out[r["id"]] = r["phrase"].strip()
    return out

def dump(name, obj):
    p = os.path.join(OUT, name)
    json.dump(obj, open(p, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"  {name:20} {len(obj):>5} entries  {os.path.getsize(p)//1024 or 1} KB", file=sys.stderr)

print("writing per-locale i18n catalogs ->", OUT, file=sys.stderr)
for loc, (ttable, lncol) in LOCALES.items():
    tp = phrases(ttable)
    chrome = {slug: tp[i] for slug, i in SLUG_TO_ID.items() if i in tp}
    dump(f"chrome.{loc}.json", chrome)
    names = {}
    for r in db.execute(f"SELECT ISO_ROD_index idx, {lncol} nm FROM {lncol} WHERE ISO_ROD_index IS NOT NULL"):
        if r["nm"] and r["nm"].strip():
            names[str(r["idx"])] = r["nm"].strip()
    dump(f"names.{loc}.json", names)

# tiny locale registry the picker + head script read (label in its own language)
registry = {
    "eng": {"label": "English",  "dir": "ltr", "bcp": "en"},
    "spa": {"label": "Español",  "dir": "ltr", "bcp": "es"},
    "rus": {"label": "Русский",  "dir": "ltr", "bcp": "ru"},
    "arb": {"label": "العربية",  "dir": "rtl", "bcp": "ar"},
}
dump("locales.json", registry)
print("done", file=sys.stderr)
