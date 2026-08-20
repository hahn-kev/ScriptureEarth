#!/usr/bin/env python3
"""
Extract language AUTONYMS (each language's name in its OWN language) from the SLDR
(SIL Locale Data Repository) LDML files, e.g. C:\\dev\\sldr\\sldr.

SLDR ships one LDML file per language; the file's own name lives in
  <localeDisplayNames><languages><language type="SELF">Autonym</language>
where SELF == <identity><language type="SELF"/>. (A file may also list names of OTHER
languages — those are that locale's exonyms, which we ignore here.) We also grab the
English name from <sil:names><sil:name xml:lang="en">.

Output: public/i18n/autonyms.json  { "<idx>": "<autonym>" }, keyed by ISO_ROD_index like
the other name catalogs, so it can serve as a locale-independent fallback tier
(locale name -> autonym -> baked English) for the ~3,500 catalogue languages CLDR/DB miss.

Generator-only dep: pycountry (639-3 -> 639-1 crosswalk, since SLDR names files by the
shortest subtag: en.xml not eng.xml). Usage:  python scripts/extract_sldr_autonyms.py
"""
import json, os, re, sqlite3, sys, xml.etree.ElementTree as ET
import pycountry

HERE = os.path.dirname(os.path.abspath(__file__))
SLDR = os.environ.get("SLDR_DIR") or r"C:\dev\sldr\sldr"
DB   = os.environ.get("SE_DB") or os.path.join(HERE, "..", "data", "scripture.db")
OUT  = os.path.join(HERE, "..", "public", "i18n")
SIL  = "{urn://www.sil.org/ldml/0.1}"

BASE = re.compile(r"^[a-z]{2,3}\.xml$")   # base-language files only (skip region/script variants)

def autonym_of(path):
    """Return (selfcode, autonym, english) from one base LDML file, or None."""
    try:
        root = ET.parse(path).getroot()
    except ET.ParseError:
        return None
    ident = root.find("./identity/language")
    if ident is None:
        return None
    self_code = ident.get("type")
    auto = None
    for lang in root.findall("./localeDisplayNames/languages/language"):
        if lang.get("type") == self_code and lang.get("alt") is None and (lang.text or "").strip():
            auto = lang.text.strip(); break
    eng = None
    for nm in root.findall(f"./localeDisplayNames/special/{SIL}names/{SIL}name"):
        if nm.get("{http://www.w3.org/XML/1998/namespace}lang") == "en" and (nm.text or "").strip():
            eng = nm.text.strip(); break
    return (self_code, auto, eng)

# 1) sweep SLDR -> filecode -> autonym
by_code = {}
n_files = 0
for shard in sorted(os.listdir(SLDR)):
    d = os.path.join(SLDR, shard)
    if not os.path.isdir(d):
        continue
    for fn in os.listdir(d):
        if not BASE.match(fn):
            continue
        n_files += 1
        r = autonym_of(os.path.join(d, fn))
        if r and r[1]:
            by_code[r[0]] = r[1]
print(f"scanned {n_files} base files -> {len(by_code)} autonyms", file=sys.stderr)

# 2) map catalogue idx -> iso, then iso -> autonym (direct 639-3, or via 639-1 crosswalk)
A2 = {l.alpha_3: l.alpha_2 for l in pycountry.languages
      if getattr(l, "alpha_3", None) and getattr(l, "alpha_2", None)}
db = sqlite3.connect(DB)
idx2iso = {}
for idx, iso in db.execute("SELECT DISTINCT ISO_ROD_index, ISO FROM ISO_countries "
                           "WHERE ISO_ROD_index IS NOT NULL AND ISO IS NOT NULL"):
    idx2iso.setdefault(str(idx), iso)

out = {}
for idx, iso in idx2iso.items():
    a = by_code.get(iso) or by_code.get(A2.get(iso, ""))
    if a:
        out[idx] = a

p = os.path.join(OUT, "autonyms.json")
with open(p, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False)
print(f"autonyms.json: {len(out)}/{len(idx2iso)} idx covered  "
      f"({os.path.getsize(p)//1024 or 1} KB)", file=sys.stderr)
