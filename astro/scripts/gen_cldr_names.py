#!/usr/bin/env python3
"""
One-time generator: localized language-NAME catalogs (public/i18n/names.<loc>.json) for locales
that have NO LN_<Locale> table in the dump, sourced from Unicode CLDR via Babel.

Keyed by ISO_ROD_index (the `idx` the client swaps via data-i18n-name), same schema as the
DB-seeded names catalogs. CLDR only names the world's major languages (~400 of the catalogue's
~3,900), so the long tail is simply omitted and falls back to the baked English name.

Generator-only deps (NOT build deps): `pip install Babel pycountry`. The output JSON is committed
and reused across builds, exactly like the DB-seeded names.<loc>.json.

Usage:  python scripts/gen_cldr_names.py
"""
import json, os, sqlite3, sys
from babel import Locale
import pycountry

HERE = os.path.dirname(os.path.abspath(__file__))
DB   = os.environ.get("SE_DB") or os.path.join(HERE, "..", "data", "scripture.db")
OUT  = os.path.join(HERE, "..", "public", "i18n")

# CLDR-backed locales lacking a dump LN_ table. (Filipino excluded: CLDR data is ~English passthrough.)
TARGETS = {"ind": "id", "hin": "hi", "swa": "sw", "fas": "fa"}

# ISO 639-3 -> 639-1 crosswalk (CLDR keys majors by their 2-letter code).
X = {l.alpha_3: l.alpha_2 for l in pycountry.languages
     if getattr(l, "alpha_3", None) and getattr(l, "alpha_2", None)}
# Individual codes under a macrolanguage that CLDR keys by the macro's 2-letter code.
X.update({"cmn": "zh", "arb": "ar", "zho": "zh", "ara": "ar", "fas": "fa",
          "pes": "fa", "msa": "ms", "zsm": "ms", "swh": "sw"})

db = sqlite3.connect(DB)
# idx (ISO_ROD_index) -> iso (639-3). Distinct; dialects sharing an iso share the language name.
idx2iso = {}
for idx, iso in db.execute(
        "SELECT DISTINCT ISO_ROD_index, ISO FROM ISO_countries "
        "WHERE ISO_ROD_index IS NOT NULL AND ISO IS NOT NULL"):
    idx2iso.setdefault(str(idx), iso)
print(f"idx->iso: {len(idx2iso)} entries", file=sys.stderr)

def dump(name, obj):
    p = os.path.join(OUT, name)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False)
    print(f"  {name:18} {len(obj):>5} names  {os.path.getsize(p)//1024 or 1} KB", file=sys.stderr)

for loc, bcp in TARGETS.items():
    langs = Locale.parse(bcp).languages
    out = {}
    for idx, iso in idx2iso.items():
        nm = langs.get(iso) or langs.get(X.get(iso, ""))
        if nm:
            out[idx] = nm
    dump(f"names.{loc}.json", out)
print("done", file=sys.stderr)
