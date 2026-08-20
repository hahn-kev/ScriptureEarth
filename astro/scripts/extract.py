#!/usr/bin/env python3
"""
THROWAWAY PROTOTYPE — SSG bake-off shared extractor (ticket 11).

Reads the git-ignored SQLite PoC dump (prototypes/db/scripture.db) and emits the
content-JSON documents defined in research/06-content-schema.md (English-only PoC):

    content/languages.json      array of per-language-entry docs   (~4,054)
    content/countries.json      array of per-country docs          (~245)
    content/search-index.json   flat search records                (~4,054)
    content/messages.eng.json   UI message catalog (from translations_eng)

The SAME output feeds all three SSGs (Astro / Statiq / Hugo) so the bake-off
compares the engines, not the data. Media rows (audio/PDF chapters, up to 260 per
language) are AGGREGATED into grouped resource rows with counts — mirroring how the
real detail page groups them — instead of emitting hundreds of chapter links.

Not production code: no error handling beyond runnability, no incremental refresh.
"""
import json, os, sqlite3, sys, time
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))               # astro/scripts/
DB   = os.environ.get("SE_DB") or os.path.join(HERE, "..", "data", "scripture.db")
# Source-pluggable (ticket 12/17): `--source=dump` (full parity) or `--source=api` (standalone,
# partial — models the /api/* field coverage). Mutually exclusive; same schema either way.
# In this no-key prototype BOTH read the SQLite dump, but api-mode emits only what the /api/*
# surface can express, so the diff shows exactly what a standalone API build loses.
SOURCE = "api" if any(a == "--source=api" for a in sys.argv) else "dump"
OUT  = os.path.join(HERE, "..", "content-api" if SOURCE == "api" else "content")
ASSET_BASE = "https://scriptureearth.org"   # §5 — PoC resolves SE-hosted paths to legacy origin at render

os.makedirs(OUT, exist_ok=True)
t0 = time.time()
db = sqlite3.connect(DB)
db.row_factory = sqlite3.Row
def q(sql, *a): return db.execute(sql, a).fetchall()

# ---- one-to-many helpers keyed by ISO_ROD_index -----------------------------
def group_by_idx(rows):
    d = defaultdict(list)
    for r in rows:
        d[r["ISO_ROD_index"]].append(r)
    return d

print("reading spine...", file=sys.stderr)
spine     = q("SELECT * FROM scripture_main")
ln_eng    = {r["ISO_ROD_index"]: r["LN_English"] for r in q("SELECT ISO_ROD_index, LN_English FROM LN_English")}
# all localized names (for the cross-locale MiniSearch index — ticket 07: find regardless of UI locale)
LN_TABLES = {"eng":"LN_English","spa":"LN_Spanish","por":"LN_Portuguese","fra":"LN_French","nld":"LN_Dutch",
             "deu":"LN_German","cmn":"LN_Chinese","kor":"LN_Korean","rus":"LN_Russian","arb":"LN_Arabic"}
ln_all = defaultdict(dict)
for _loc, _tbl in LN_TABLES.items():
    for r in q(f"SELECT ISO_ROD_index i, {_tbl} n FROM {_tbl} WHERE ISO_ROD_index IS NOT NULL"):
        if r["n"] and r["n"].strip():
            ln_all[r["i"]][_loc] = r["n"].strip()

_seen_slugs = {}
def make_slug(iso, rod, var, idx):
    # slug = the legacy vanity string <iso>[-<rod>][-<var>] (ticket 08); idx stays the internal key
    if var:                       s = f"{iso}-{rod}-{var}"
    elif rod and rod != "00000":  s = f"{iso}-{rod}"
    else:                         s = iso
    s = s.lower()
    if s in _seen_slugs and _seen_slugs[s] != idx:  # defensive: never collide
        s = f"{s}-{idx}"
    _seen_slugs[s] = idx
    return s
navdef    = {r["ISO_ROD_index"]: r["Def_LN"] for r in q("SELECT ISO_ROD_index, Def_LN FROM nav_ln")}
variants  = {r["Variant_Code"]: r["Variant_Eng"] for r in q("SELECT Variant_Code, Variant_Eng FROM Variants")}
country_name = {r["ISO_Country"]: r["English"] for r in q("SELECT ISO_Country, English FROM countries")}

alt_by_idx = group_by_idx(q("SELECT ISO_ROD_index, alt_lang_name FROM alt_lang_names"))
iso_ctry   = group_by_idx(q("SELECT ISO_ROD_index, ISO_countries FROM ISO_countries"))

# resource tables
ot_pdf  = group_by_idx(q("SELECT ISO_ROD_index, OT_PDF, OT_PDF_Filename FROM OT_PDF_Media"))
nt_pdf  = group_by_idx(q("SELECT ISO_ROD_index, NT_PDF, NT_PDF_Filename FROM NT_PDF_Media"))
ot_aud  = group_by_idx(q("SELECT ISO_ROD_index, OT_Audio_Book, OT_Audio_Filename FROM OT_Audio_Media"))
nt_aud  = group_by_idx(q("SELECT ISO_ROD_index, NT_Audio_Book, NT_Audio_Filename FROM NT_Audio_Media"))
links   = group_by_idx(q("SELECT * FROM links"))
watch   = group_by_idx(q("SELECT * FROM watch"))
cell    = group_by_idx(q("SELECT * FROM CellPhone"))
buy     = group_by_idx(q("SELECT * FROM buy"))
study   = group_by_idx(q("SELECT * FROM study"))
ebible  = group_by_idx(q("SELECT ISO_ROD_index, homeDomain, translationId, title FROM eBible_list"))
pl_aud  = group_by_idx(q("SELECT ISO_ROD_index, PlaylistAudioTitle FROM PlaylistAudio"))
pl_vid  = group_by_idx(q("SELECT ISO_ROD_index, PlaylistVideoTitle FROM PlaylistVideo"))

def resolve(path):
    if not path: return None, True
    p = str(path)
    if p.startswith("http://") or p.startswith("https://"):
        return p, True
    return f"{ASSET_BASE}/{p.lstrip('/')}", False

def res(group, kind, fmt, name, source, url, external, **meta):
    return {"group": group, "kind": kind, "format": fmt, "name": name,
            "source": source, "url": url, "external": external,
            "meta": {k: v for k, v in meta.items() if v not in (None, "")}}

def strip_prefix(title, prefix):
    """Pull the version name out of a links.company_title (e.g. 'Bible.com (YouVersion) - Reina Valera 1960')."""
    t = (title or "").strip()
    if t.startswith(prefix):
        t = t[len(prefix):]
    return t.lstrip(" -–—:").strip()

def build_resources(idx, iso, flags):
    R = {"read": [], "listen": [], "watch": [], "use": []}

    # READ ---------------------------------------------------------------
    if idx in ot_pdf:
        url, ext = resolve(ot_pdf[idx][0]["OT_PDF_Filename"])
        R["read"].append(res("read","pdf","PDF", f"Old Testament — {len(ot_pdf[idx])} book(s)",
                              "ScriptureEarth", url, ext, books=len(ot_pdf[idx])))
    if idx in nt_pdf:
        url, ext = resolve(nt_pdf[idx][0]["NT_PDF_Filename"])
        R["read"].append(res("read","pdf","PDF", f"New Testament — {len(nt_pdf[idx])} book(s)",
                              "ScriptureEarth", url, ext, books=len(nt_pdf[idx])))
    for r in ebible.get(idx, [])[:3]:
        url, ext = resolve(f"https://{r['homeDomain']}/{r['translationId']}" if r["homeDomain"] else None)
        R["read"].append(res("read","web","Web", r["title"] or "eBible edition", "eBible.org", url, True))
    for l in links.get(idx, []):
        u, ext = resolve(l["URL"])
        if l["YouVersion"]:
            ver = strip_prefix(l["company_title"], "Bible.com (YouVersion)")
            R["read"].append(res("read","web","Web", ver or "YouVersion", "Bible.com (YouVersion)", u, ext))
        elif l["Bibles_org"]:
            R["read"].append(res("read","web","Web", l["company_title"] or l["company"] or "Bibles.org edition", "Bibles.org", u, ext))
        elif l["BibleIs"] in (2,3,4):
            R["read"].append(res("read","web","Web", l["company_title"] or "Bible.is edition", "Bible.is", u, ext))

    # LISTEN -------------------------------------------------------------
    if idx in ot_aud:
        url, ext = resolve(ot_aud[idx][0]["OT_Audio_Filename"])
        R["listen"].append(res("listen","audio","Audio", f"Old Testament — {len(ot_aud[idx])} chapter(s)",
                               "ScriptureEarth", url, ext, chapters=len(ot_aud[idx])))
    if idx in nt_aud:
        url, ext = resolve(nt_aud[idx][0]["NT_Audio_Filename"])
        R["listen"].append(res("listen","audio","Audio", f"New Testament — {len(nt_aud[idx])} chapter(s)",
                               "ScriptureEarth", url, ext, chapters=len(nt_aud[idx])))
    for p in pl_aud.get(idx, []):
        R["listen"].append(res("listen","audio","MP3", p["PlaylistAudioTitle"] or "Audio playlist","ScriptureEarth", None, False))
    for l in links.get(idx, []):
        u, ext = resolve(l["URL"])
        if l["GRN"]:
            R["listen"].append(res("listen","audio","MP3", l["company_title"] or "GRN recordings","Global Recordings Network", u, ext))
        elif l["BibleIs"] in (1,3,4):
            R["listen"].append(res("listen","audio","Audio", l["company_title"] or "Bible.is audio","Bible.is", u, ext))

    # WATCH --------------------------------------------------------------
    for w in watch.get(idx, []):
        u, ext = resolve(w["URL"])
        nm = "JESUS Film" if w["JesusFilm"] else ("YouTube" if w["YouTube"] else (w["watch_what"] or "Video"))
        R["watch"].append(res("watch","video","Video", nm, w["organization"] or "—", u, ext))
    for p in pl_vid.get(idx, []):
        R["watch"].append(res("watch","video","Video", p["PlaylistVideoTitle"] or "Video playlist","ScriptureEarth", None, False))
    for l in links.get(idx, []):
        if l["BibleIsGospelFilm"]:
            u, ext = resolve(l["URL"])
            R["watch"].append(res("watch","video","Video","Bible.is Gospel Film","Faith Comes By Hearing", u, ext))

    # USE (Apps & Print) -------------------------------------------------
    for c in cell.get(idx, []):
        u, ext = resolve(c["Cell_Phone_File"])
        R["use"].append(res("use","app","App", c["Cell_Phone_Title"] or "Mobile app","Scripture App Builder", u, ext))
    for s in study.get(idx, []):
        u, ext = resolve(s["ScriptureURL"] or s["othersiteURL"])
        R["use"].append(res("use","app","Study", s["ScriptureDescription"] or "Study tool","—", u, ext))
    # BUY: the /api/* surface has NO buy endpoint (ticket 06) — records.php gives only a count.
    # So api-mode keeps the "Buy" availability pill (from the count) but cannot emit orderable rows.
    if SOURCE != "api":
        for b in buy.get(idx, []):
            u, ext = resolve(b["URL"])
            R["use"].append(res("use","buy","Buy", b["buy_what"] or "Printed edition", b["organization"] or "Print-on-demand", u, ext))
    return R

def availability(idx, f, R):
    return {
        "read":   bool(f["OT_PDF"] or f["NT_PDF"] or f["YouVersion"] or f["Bibles_org"] or f["eBible"] or f["viewer"] or f["BibleIs"] or f["SAB"] or R["read"]),
        "listen": bool(f["OT_Audio"] or f["NT_Audio"] or f["PlaylistAudio"] or f["GRN"] or R["listen"]),
        "watch":  bool(f["watch"] or f["PlaylistVideo"] or f["BibleIsGospelFilm"] or R["watch"]),
        "app":    bool(f["CellPhone"] or f["study"] or R["use"] and any(x["kind"]=="app" for x in R["use"])),
        "buy":    bool(f["buy"]),
    }

FLAGCOLS = ["OT_PDF","NT_PDF","OT_Audio","NT_Audio","links","other_titles","watch","buy","study",
            "viewer","CellPhone","BibleIs","BibleIsGospelFilm","YouVersion","Bibles_org",
            "PlaylistAudio","PlaylistVideo","SAB","eBible","GRN"]

languages, search = [], []
for r in spine:
    idx = r["ISO_ROD_index"]; iso = r["ISO"]
    flags = {c: r[c] for c in FLAGCOLS}
    R = build_resources(idx, iso, flags)
    avail = availability(idx, flags, R)
    ccodes = [c["ISO_countries"] for c in iso_ctry.get(idx, [])]
    countries = [{"code": c, "name_eng": country_name.get(c, c)} for c in ccodes]
    slug = make_slug(iso, r["ROD_Code"], r["Variant_Code"], idx)
    name = ln_eng.get(idx) or iso
    alt = [a["alt_lang_name"] for a in alt_by_idx.get(idx, []) if a["alt_lang_name"]]
    doc = {
        "idx": idx,
        "identity": {"iso": iso, "slug": slug, "rod": r["ROD_Code"], "variant_code": r["Variant_Code"],
                     "variant_name": variants.get(r["Variant_Code"], "") if r["Variant_Code"] else "",
                     "iso_query": f"iso={iso}", "idx_query": f"idx={idx}"},
        "names": {"default_locale": "eng", "localized": {"eng": name},
                  "autonym": None, "alt_names": alt},
        "countries": countries,
        "availability": avail,
        "resources": R,
    }
    languages.append(doc)
    # search record (ticket 07): slug for linking, all-locale names + all alt-names for
    # cross-locale matching, country + availability facets. MiniSearch indexes nm/nms/alt/where/code.
    all_names = list(dict.fromkeys(ln_all.get(idx, {}).values()))   # every localized name, de-duped
    search.append({"idx": idx, "slug": slug, "code": iso, "nm": name, "auto": None,
                   "nms": [n for n in all_names if n != name],       # other-locale names (matching only)
                   "alt": alt, "where": ", ".join(c["name_eng"] for c in countries),
                   "cc": ccodes, "r": [k for k,v in avail.items() if v]})

# ---- per-country docs -------------------------------------------------------
langs_by_country = defaultdict(list)
byidx = {d["idx"]: d for d in languages}
for cidx, rows in iso_ctry.items():
    d = byidx.get(cidx)
    if not d: continue
    for c in rows:
        langs_by_country[c["ISO_countries"]].append(d)

countries_out = []
for code, name in sorted(country_name.items()):
    ls = langs_by_country.get(code, [])
    countries_out.append({
        "code": code, "name": {"eng": name},
        "language_idxs": [d["idx"] for d in ls],
        "languages": [{"idx": d["idx"], "slug": d["identity"]["slug"], "iso": d["identity"]["iso"],
                       "name_eng": d["names"]["localized"]["eng"],
                       "alt_names": d["names"]["alt_names"][:3],
                       "variant_name": d["identity"]["variant_name"]} for d in ls],
    })

# ---- UI message catalog (English master) ------------------------------------
msg = {}
try:
    for r in q("SELECT id, phrase FROM translations_eng WHERE active=1"):
        msg[str(r["id"])] = r["phrase"]
except sqlite3.OperationalError:
    for r in q("SELECT id, phrase FROM translations_eng"):
        msg[str(r["id"])] = r["phrase"]
messages = {"locale": "eng", "language_code": "en", "direction": "ltr", "name": "English", "messages": msg}

def dump(name, obj):
    p = os.path.join(OUT, name)
    with open(p, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, ensure_ascii=False)
    print(f"  {name:22} {len(obj) if isinstance(obj,list) else len(obj.get('messages',obj)):>6}  {os.path.getsize(p)//1024} KB", file=sys.stderr)

print("writing content/...", file=sys.stderr)
dump("languages.json", languages)
dump("countries.json", countries_out)
dump("search-index.json", search)
dump("messages.eng.json", messages)

# stage the client search index into public/ (served + MiniSearch fetches it at /search-index.json)
_pub = os.path.join(HERE, "..", "public")
os.makedirs(_pub, exist_ok=True)
with open(os.path.join(_pub, "search-index.json"), "w", encoding="utf-8") as fh:
    json.dump(search, fh, ensure_ascii=False)

print(f"done in {time.time()-t0:.1f}s  ({len(languages)} languages, {len(countries_out)} countries)", file=sys.stderr)
