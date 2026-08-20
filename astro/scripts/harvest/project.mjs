// Projects harvest.mjs output -> the Astro content schema (the API build path).
// Reuses the scraper's cache — NO re-fetch. Reads data/poc-english.json (which embeds
// each entry's raw endpoint `detail`) and emits ../../content/*.json + ../../public/search-index.json,
// matching scripts/extract.py's schema so `astro build` is source-agnostic.
//
//   node project.mjs            # reads ./data/poc-english.json
//   SE_HARVEST=/path node project.mjs
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const HARVEST = process.env.SE_HARVEST || path.join(HERE, "data");
const CONTENT = path.join(HERE, "..", "..", "content");
const PUBLIC  = path.join(HERE, "..", "..", "public");

const arr = (o) => !o ? [] : Array.isArray(o) ? o : Object.values(o);   // API uses {0:..,1:..} objects a lot
const first = (o) => arr(o)[0] || null;
const clean = (s) => (s == null ? "" : String(s)).replace(/^[\s\-–—]+/, "").trim();

function slug(iso, rod, varc) {
  if (varc) return `${iso}-${rod}-${varc}`.toLowerCase();
  if (rod && rod !== "00000") return `${iso}-${rod}`.toLowerCase();
  return String(iso).toLowerCase();
}
function res(group, kind, format, name, source, url) {
  return { group, kind, format, name, source, url: url || null, external: url ? /^https?:\/\//.test(url) : false, meta: {} };
}

function resourcesFrom(detail) {
  const R = { read: [], listen: [], watch: [], use: [] };
  const media = first(detail?.media)?.relationships || {};
  const links = first(detail?.links)?.relationships || {};
  const apps  = first(detail?.apps)?.relationships || {};

  // --- READ / LISTEN from media_se texts + audio (aggregate to one counted row) ---
  const texts = media.texts || {};
  const nPdf = arr(texts.nt_pdf_media).length, oPdf = arr(texts.ot_pdf_media).length;
  if (oPdf) R.read.push(res("read","pdf","PDF",`Old Testament — ${oPdf} book(s)`,"ScriptureEarth", null));
  if (nPdf) R.read.push(res("read","pdf","PDF",`New Testament — ${nPdf} book(s)`,"ScriptureEarth", null));
  const audio = media.audio || {};
  const nAud = arr(audio.nt_audio_media).length, oAud = arr(audio.ot_audio_media).length;
  if (oAud) R.listen.push(res("listen","audio","Audio",`Old Testament — ${oAud} chapter(s)`,"ScriptureEarth", null));
  if (nAud) R.listen.push(res("listen","audio","Audio",`New Testament — ${nAud} chapter(s)`,"ScriptureEarth", null));
  for (const p of arr(media.playlist_video)) R.watch.push(res("watch","video","Video", p?.title || "Video playlist","ScriptureEarth", p?.URL));
  for (const s of arr(media.study))          R.use.push(res("use","app","Study", s?.title || "Study tool","—", s?.URL || s?.url));

  // --- general_links: the version-named providers (the useful detail) ---
  for (const y of arr(links.YouVersion))
    R.read.push(res("read","web","Web", y?.title || "YouVersion","Bible.com (YouVersion)", y?.URL));
  const bis = links["Bible.Is"] || {};
  for (const [section, items] of Object.entries(bis)) {
    const isRead = /read/i.test(section), isListen = /listen/i.test(section);
    for (const it of arr(items)) {
      const nm = clean(it?.version) || "Bible.is edition";
      if (isRead || !isListen) R.read.push(res("read","web","Web", nm, "Bible.is", it?.URL));
      if (isListen) R.listen.push(res("listen","audio","Audio", nm, "Bible.is", it?.URL));
    }
  }
  for (const g of arr(links.GRN))       R.listen.push(res("listen","audio","MP3", g?.title || "GRN recordings","Global Recordings Network", g?.URL));
  for (const j of arr(links.JesusFilm)) R.watch.push(res("watch","video","Video","JESUS Film", j?.organization || "Jesus Film Project", j?.URL));
  for (const v of arr(links.YouTube))   R.watch.push(res("watch","video","Video", v?.title || "YouTube", v?.organization || "YouTube", v?.URL));
  for (const v of arr(links["other_videos"])) R.watch.push(res("watch","video","Video", v?.title || "Video", v?.organization || "—", v?.URL));
  for (const f of arr(links["Bible.is Gospel Film"])) R.watch.push(res("watch","video","Video","Bible.is Gospel Film","Faith Comes By Hearing", f?.URL));
  for (const b of arr(links["Bibles.org"])) R.read.push(res("read","web","Web", b?.version || b?.organization || "Bibles.org edition","Bibles.org", b?.URL));
  for (const e of arr(links.eBible))    R.read.push(res("read","web","Web", e?.title || "eBible edition","eBible.org", e?.URL));

  // --- apps ---
  for (const u of arr(apps.android_app)) R.use.push(res("use","app","App","Android App","Scripture App Builder", typeof u === "string" ? u : u?.apk || u?.URL));
  for (const u of arr(apps.iOS))         R.use.push(res("use","app","App","iOS Asset Package","Scripture App Builder", typeof u === "string" ? u : u?.asset || u?.URL));
  return R;
}

function availabilityFrom(a, R) {
  const n = (x) => Number(x) || 0;
  return {
    read:   !!(n(a.textPdf) || n(a.ePub) || n(a.viewer) || R.read.length),
    listen: !!(n(a.audio) || n(a.playlistAudio) || R.listen.length),
    watch:  !!(n(a.playlistVideo) || n(a.watch) || R.watch.length),
    app:    !!(a.apps?.android || a.apps?.ios || n(a.googlePlay) || R.use.some(x => x.kind === "app")),
    buy:    !!n(a.buy),   // buy is count-only via the API — pill only, no rows
  };
}

const localeMap = { English:"eng", Spanish:"spa", Portuguese:"por", Portugues:"por", French:"fra",
  Dutch:"nld", German:"deu", Chinese:"cmn", Korean:"kor", Russian:"rus", Arabic:"arb" };

async function main() {
  const t0 = Date.now();
  const poc = JSON.parse(await readFile(path.join(HARVEST, "poc-english.json"), "utf8"));
  const languages = [], search = [], byCountry = {};

  for (const e of poc) {
    // iso: harvest stored it from relationships (undefined); fall back to the record's attributes / iso_query
    const rec0 = first(e.detail?.record);
    const iso = e.iso || rec0?.attributes?.iso
      || (rec0?.relationships?.iso_query_string || "").match(/iso=([^&]+)/)?.[1] || "";
    const idx = e.idx, rod = e.rod || "00000", varc = e.variantCode || "";
    const sl = slug(iso, rod, varc);
    const R = resourcesFrom(e.detail || {});
    const avail = availabilityFrom(e.availability || {}, R);
    const countries = (e.countryCodes || []).map((c, i) => ({ code: c, name_eng: (e.countries || [])[i] || c }));
    // all-locale names for cross-locale search (records.php language_name)
    const lnames = first(e.detail?.record)?.relationships?.language_name || {};
    const nms = [];
    for (const [k, v] of Object.entries(lnames)) if (localeMap[k] && v && v !== e.name) nms.push(v);

    languages.push({
      idx, identity: { iso, slug: sl, rod, variant_code: varc, variant_name: e.variantName || "",
        iso_query: `iso=${iso}`, idx_query: `idx=${idx}` },
      names: { default_locale: "eng", localized: { eng: e.name || iso }, autonym: null, alt_names: e.altNames || [] },
      countries, availability: avail, resources: R,
    });
    search.push({ idx, slug: sl, code: iso, nm: e.name || iso, auto: null, nms: [...new Set(nms)],
      alt: e.altNames || [], where: countries.map(c => c.name_eng).join(", "),
      cc: (e.countryCodes || []), r: Object.keys(avail).filter(k => avail[k]) });

    countries.forEach(c => { (byCountry[c.code] ||= { code: c.code, name: { eng: c.name_eng }, language_idxs: [], languages: [] });
      byCountry[c.code].language_idxs.push(idx);
      byCountry[c.code].languages.push({ idx, slug: sl, iso, name_eng: e.name || iso, alt_names: (e.altNames||[]).slice(0,3), variant_name: e.variantName || "" }); });
  }

  await mkdir(CONTENT, { recursive: true }); await mkdir(PUBLIC, { recursive: true });
  const w = (dir, name, obj) => writeFile(path.join(dir, name), JSON.stringify(obj));
  await w(CONTENT, "languages.json", languages);
  await w(CONTENT, "countries.json", Object.values(byCountry).sort((a,b)=>a.name.eng.localeCompare(b.name.eng)));
  await w(CONTENT, "search-index.json", search);
  await w(PUBLIC,  "search-index.json", search);
  console.error(`projected ${languages.length} languages, ${Object.keys(byCountry).length} countries from API harvest in ${((Date.now()-t0)/1000).toFixed(1)}s`);
}
main().catch(e => { console.error(e); process.exit(1); });
