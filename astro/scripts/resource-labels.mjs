// Shared vocabulary for the projector (extract.mjs): Bible books, testament-audio
// filename parsing, and the dictionary of generic phrases that are shown in the UI
// language instead of as baked text.
//
// A resource name is either free text from the dump (a real title, kept as-is) or a
// generic phrase ("Audio recording", "texto bíblico", "Nuevo Testamento"). Generic
// phrases become `label` parts — [[i18nKey, englishText], [null, literal], …] — that
// ResourceRow renders as <span data-i18n=key>, so the client localizer swaps them.
// Every key used here must exist in scripts/i18n/en.json and public/i18n/chrome.*.json.

// --- Bible books -------------------------------------------------------------------
export const OT = 'GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB PSA PRO ECC SNG ISA JER LAM EZK DAN HOS JOL AMO OBA JON MIC NAM HAB ZEP HAG ZEC MAL'.split(' ');
export const NT = 'MAT MRK LUK JHN ACT ROM 1CO 2CO GAL EPH PHP COL 1TH 2TH 1TI 2TI TIT PHM HEB JAS 1PE 2PE 1JN 2JN 3JN JUD REV'.split(' ');
export const BOOK_EN = {
  GEN: 'Genesis', EXO: 'Exodus', LEV: 'Leviticus', NUM: 'Numbers', DEU: 'Deuteronomy', JOS: 'Joshua', JDG: 'Judges', RUT: 'Ruth',
  '1SA': '1 Samuel', '2SA': '2 Samuel', '1KI': '1 Kings', '2KI': '2 Kings', '1CH': '1 Chronicles', '2CH': '2 Chronicles',
  EZR: 'Ezra', NEH: 'Nehemiah', EST: 'Esther', JOB: 'Job', PSA: 'Psalms', PRO: 'Proverbs', ECC: 'Ecclesiastes',
  SNG: 'Song of Solomon', ISA: 'Isaiah', JER: 'Jeremiah', LAM: 'Lamentations', EZK: 'Ezekiel', DAN: 'Daniel', HOS: 'Hosea',
  JOL: 'Joel', AMO: 'Amos', OBA: 'Obadiah', JON: 'Jonah', MIC: 'Micah', NAM: 'Nahum', HAB: 'Habakkuk', ZEP: 'Zephaniah',
  HAG: 'Haggai', ZEC: 'Zechariah', MAL: 'Malachi',
  MAT: 'Matthew', MRK: 'Mark', LUK: 'Luke', JHN: 'John', ACT: 'Acts', ROM: 'Romans', '1CO': '1 Corinthians',
  '2CO': '2 Corinthians', GAL: 'Galatians', EPH: 'Ephesians', PHP: 'Philippians', COL: 'Colossians',
  '1TH': '1 Thessalonians', '2TH': '2 Thessalonians', '1TI': '1 Timothy', '2TI': '2 Timothy', TIT: 'Titus',
  PHM: 'Philemon', HEB: 'Hebrews', JAS: 'James', '1PE': '1 Peter', '2PE': '2 Peter', '1JN': '1 John', '2JN': '2 John',
  '3JN': '3 John', JUD: 'Jude', REV: 'Revelation',
};

// Testament audio filenames carry no structured book/chapter in the dump, only names like
// mil-41-MAT-15.mp3, 43-JHNtau-10.mp3, A19__001_Psalms.mp3. Parse a USFM code from a token
// (optionally after a 2-digit number, optionally followed by the language code), else a
// 2-digit book number (OT 01–39; NT is 40- or 41-based depending on who made the files —
// decided per set). Checked against the legacy DB's OT/NT_Audio_Media book column: ~99%
// agree, and most of the rest look like DB errors. Unparsed files get book -1.
const ALIAS = { MAR: 'MRK', MRC: 'MRK', JUA: 'JHN', JOH: 'JHN', LUC: 'LUK', EZE: 'EZK', JOE: 'JOL', NAH: 'NAM', JAM: 'JAS' };
function bookOfToken(tok, list) {
  const t = tok.toUpperCase().replace(/^\d{2}(?=\d?[A-Z])/, '');
  for (const n of [3, 4]) {
    const c = t.slice(0, n);
    const i = list.indexOf(ALIAS[c] || c);
    // Accept "MAT", "MAT01", "JHNtau" — but not a longer word that merely starts with a code.
    if (i >= 0 && (t.length === n || !/[A-Z]/.test(t[n]) || t.length > n + 1)) return i;
  }
  return -1;
}
export function parseAudioSet(files, iso, T) {
  const list = T === 'OT' ? OT : NT;
  const isoRe = new RegExp(`^${iso}`, 'i');
  const parsed = files.map((file) => {
    const b = decodeURIComponent(String(file).split('/').pop()).replace(/\.[a-z0-9]+$/i, '').replace(isoRe, '');
    const toks = b.split(/[-_ .()]+/).filter(Boolean);
    let book = -1;
    for (const tk of toks) { book = bookOfToken(tk, list); if (book >= 0) break; }
    const nm = toks.map((x) => x.match(/^[A-Za-z]?(\d{2})(?!\d)/)).find(Boolean);
    const nums = b.match(/\d+/g);
    return { file, book, num: nm ? Number(nm[1]) : null, chapter: nums ? Number(nums[nums.length - 1]) : null };
  });
  const ntNums = parsed.filter((p) => p.book < 0 && p.num != null).map((p) => p.num);
  const off = T === 'OT' ? 1 : (ntNums.length && Math.min(...ntNums) === 40 ? 40 : 41);
  for (const p of parsed) {
    if (p.book < 0 && p.num != null) { const v = p.num - off; if (v >= 0 && v < list.length) p.book = v; }
  }
  return parsed.map(({ file, book, chapter }) => ({ file, book, code: book >= 0 ? list[book] : null, chapter }));
}

// --- generic phrases -----------------------------------------------------------------
// key → [English UI text, ...variants seen in the dump (matched case/accent-insensitively)].
// Variants come from a frequency survey of every title/description field in the dump; the
// dump is entered partly in Spanish, so Spanish variants matter as much as English ones.
export const PHRASES = {
  'res.rlv': ['Read, listen and view', 'read/listen/view', 'read, listen, and view', 'leer/escuchar/ver', 'leer, escuchar y ver'],
  'res.viewer': ['Online viewer', 'the online viewer', 'go to the online viewer', 'scripture viewer'],
  'res.ot': ['Old Testament', 'antiguo testamento', 'the old testament', 'ot'],
  'res.nt': ['New Testament', 'nuevo testamento', 'nuevo testamonto', 'the new testament', 'nt'],
  'res.bible': ['Bible', 'biblia', 'the bible', 'holy bible', 'la biblia', 'the holy bible'],
  'res.scriptures': ['Scriptures', 'the scriptures', 'escrituras', 'las escrituras'],
  'res.ntOtPortions': ['New Testament with Old Testament portions', 'nuevo testamento con porciones del antiguo testamento'],
  'res.ntPortions': ['New Testament portions', 'porciones del nuevo testamento'],
  'res.portion': ['Scripture portion', 'scripture portions', 'porcion de las escrituras'],
  'res.bibleText': ['Bible text', 'texto biblico', 'scripture text', 'texto de la biblia'],
  'res.bibleTextAV': ['Bible text with audio and video', 'bible text with audio and video links', 'texto biblico con audio y videos', 'texto biblico con audio y video'],
  'res.ntAV': ['New Testament with audio and video', 'new testament with audio and video links', 'nuevo testamento con audio y videos'],
  'res.childStories': ['Bible stories for children', 'historias biblicas para ninos'],
  'res.audioRecordings': ['Audio recordings', 'audio recording', 'grabaciones de audio', 'grabacion de audio'],
  'res.website': ['Website', 'sitio web', 'web site', 'site web'],
  'res.langCulture': ['Language and culture resources'],
  'res.printed': ['Printed edition'],
  'res.ebible': ['eBible edition'],
  'res.jesusFilm': ['The JESUS Film', 'jesus film', 'view the jesus film', 'la pelicula jesus'],
  'res.lukeVideo': ['The LUKE Video', 'luke video', 'el video de san lucas'],
  'res.scriptureVideos': ['Scripture videos', 'videos de las escrituras', 'videos de escrituras'],
  'res.johnVideos': ['Videos of the Gospel of John', 'videos de san juan'],
  'res.storyJesusChildren': ['The Story of Jesus for Children', 'la historia de jesus para ninos'],
  'res.bibleSelections': ['Bible selections', 'selecciones biblicas'],
  'res.gospelMat': ['Gospel of Matthew', 'evangelio de mateo'],
  'res.gospelMrk': ['Gospel of Mark', 'evangelio de marcos'],
  'res.gospelLuk': ['Gospel of Luke', 'evangelio de lucas'],
  'res.gospelJhn': ['Gospel of John', 'evangelio de juan'],
  'res.otSummary': ['Summary of the Old Testament', 'resumen del antiguo testamento'],
  'res.genesisSummary': ['Summary of Genesis', 'resumen de genesis'],
  'res.lifeOfChrist': ['The life of Christ', 'life of christ', 'la vida de cristo'],
  'res.androidApp': ['Android app', 'app de android', 'android'],
  'res.iosApp': ['iOS app', 'ios'],
  'res.bibleApp': ['Bible app', 'app de la biblia'],
  'res.video': ['Video'],
  'res.audioPlaylist': ['Audio playlist'],
  'res.videoPlaylist': ['Video playlist'],
  'res.gobible': ['GoBible app (Java phones)'],
  'res.mysword': ['MySword module (Android)'],
  'res.alphaStd': ['standard alphabet'],
  'res.alphaTrad': ['traditional alphabet'],
  'res.alphaNew': ['new alphabet'],
  'src.pod': ['Print-on-demand'],
  'res.contact': ['Contact'],
  'res.map': ['Map'],
};

// Placeholder texts — shown (styled as warnings) where the dump lacks what we need to
// show a resource properly, so a gap is visible instead of silently missing. Not matched
// against dump titles. `ph.<missing>` keys pair with res().missing values in extract.mjs.
export const PLACEHOLDERS = {
  'ph.title': 'Title missing',
  'ph.book': 'Book not recognized',
  'ph.link': 'Link missing',
  'ph.playlist': 'Playlist file not found',
  'ph.file': 'File location unknown',
  'ph.zip': 'Zip not available',
};
export const ph = (key) => [key, PLACEHOLDERS[key]];

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').replace(/^[\s\-–—:]+|[\s.:;,]+$/g, '').trim();
const BY_VARIANT = new Map();
for (const [key, [en, ...vs]] of Object.entries(PHRASES)) {
  for (const v of [en, ...vs]) BY_VARIANT.set(fold(v), key);
}

export const en = (key) => PHRASES[key][0];
/** A single generic phrase as label parts. */
export const part = (key) => [key, en(key)];

const PLATFORM = /\s*\((?:app (?:de|for) )?(android|ios)(?: app)?\)\s*:?$/i;
const PLAYLIST = /\s*[-–]?\s*playlist$/i;

/**
 * Recognize a dump title as a generic phrase. Returns label parts, or null for a real
 * title. Handles a trailing "(app de Android)" / "(iOS)" platform note and a trailing
 * "playlist" (both kept as untranslated literals / dropped).
 */
export function generic(raw) {
  let s = String(raw || '').trim();
  if (!s) return null;
  let suffix = null;
  const pm = s.match(PLATFORM);
  if (pm) { suffix = ` (${/ios/i.test(pm[1]) ? 'iOS' : 'Android'})`; s = s.slice(0, pm.index); }
  s = s.replace(PLAYLIST, '');
  const key = BY_VARIANT.get(fold(s));
  if (!key) return null;
  return suffix ? [part(key), [null, suffix]] : [part(key)];
}

/** Name + label for a dump title, falling back to a generic key when the title is empty. */
export function label(raw, fallbackKey) {
  const title = String(raw || '').trim();
  const g = generic(title);
  if (g) return { name: g.map((p) => p[1]).join(''), label: g };
  if (title) return { name: title };
  if (fallbackKey && PHRASES[fallbackKey]) return { name: en(fallbackKey), label: [part(fallbackKey)] };
  return { name: '' };
}

/** Compose label parts into { name, label }. */
export function compose(...parts) {
  return { name: parts.map((p) => p[1]).join(''), label: parts };
}
