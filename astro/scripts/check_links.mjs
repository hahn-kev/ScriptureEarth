// One-off external link checker for the baked catalog.
//
// Reads content/languages.json (the projector's output) and validates every
// EXTERNAL resource URL, reporting where each dead link came from (language +
// section + source). Designed to be gentle: URLs are deduplicated across
// languages, playlists collapse to their first item (parent.url === clips[0].url),
// and each host is hit one request at a time with a delay so no site sees a burst.
//
//   node scripts/check_links.mjs [flags]
//
// Flags (all optional):
//   --delay <ms>              per-host spacing between requests (default 1000)
//   --host-concurrency <n>    concurrent requests to the SAME host (default 1)
//   --global-concurrency <n>  hosts processed in parallel (default 20)
//   --timeout <ms>            per-request timeout (default 15000)
//   --limit <n>              check only the first N unique URLs (smoke testing)
//   --only-domain <substr>    check only URLs whose host contains <substr>
//   --out <dir>               report output dir (default ./reports)
//   --resume                  skip URLs already present in the JSONL cache
//   --no-fail                 always exit 0 (report only)
//
// Exit code: non-zero iff any BROKEN link is found (SUSPECT/SKIPPED never fail).
//
// Classification:
//   OK       2xx (soft-404 domains must also pass their heuristic)
//   BROKEN   404/410, DNS failure, connection refused, or soft-404 heuristic fail
//   SUSPECT  401/403/429/5xx, timeouts, TLS errors — transient / bot-block, review
//   SKIPPED  host on SKIP_DOMAINS (never requested)
//
// See .claude/plans + the investigation notes: live.bible.is and bible.com return
// 200 for dead pages (SPA soft-404); globalrecordings.net sits behind a BunnyCDN
// bot-challenge that 403s valid pages, so it is skipped wholesale.

import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, '..', 'content', 'languages.json');

// SE server 406s an empty UA; keep a real, honest identifier (mirrors fetch_dump.mjs).
const UA = 'ScriptureEarth-LinkCheck/1.0 (dead-link audit; SIL; +https://scriptureearth.org)';

// Hosts we do not check at all. globalrecordings.net returns 403 (BunnyCDN
// "Bunny Shield" JS challenge) for valid pages once its bot-shield engages —
// status codes there are meaningless, so checking would be all false positives.
const SKIP_DOMAINS = new Set(['globalrecordings.net']);

// Hosts whose 200 cannot be trusted (SPA soft-404). Handled by softCheck().
const SOFT_404 = new Set(['live.bible.is', 'bible.com']);

const GROUPS = ['read', 'listen', 'watch', 'use'];

function parseArgs(argv) {
  const a = {
    delay: 1000,
    hostConcurrency: 1,
    globalConcurrency: 20,
    timeout: 15_000,
    limit: null,
    onlyDomain: null,
    out: path.join(__dirname, '..', 'reports'),
    resume: false,
    fail: true,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const v = argv[i];
    if (v === '--') continue; // pnpm forwards the arg separator; npm strips it
    else if (v === '--delay') a.delay = Number(argv[++i]);
    else if (v === '--host-concurrency') a.hostConcurrency = Number(argv[++i]);
    else if (v === '--global-concurrency') a.globalConcurrency = Number(argv[++i]);
    else if (v === '--timeout') a.timeout = Number(argv[++i]);
    else if (v === '--limit') a.limit = Number(argv[++i]);
    else if (v === '--only-domain') a.onlyDomain = argv[++i];
    else if (v === '--out') a.out = argv[++i];
    else if (v === '--resume') a.resume = true;
    else if (v === '--no-fail') a.fail = false;
    else { console.error(`Unknown flag: ${v}`); process.exit(2); }
  }
  return a;
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return null; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- 1. gather unique external URLs with their occurrences ------------------
// occurrence: { iso, slug, group, source, name }
function gather() {
  if (!existsSync(SRC)) {
    console.error(`ERROR: ${SRC} not found. Run \`pnpm run extract\` first.`);
    process.exit(1);
  }
  const langs = JSON.parse(readFileSync(SRC, 'utf8'));
  const urls = new Map(); // url -> { host, occ: [] }
  let items = 0;
  for (const lang of langs) {
    const iso = lang.identity?.iso ?? '';
    const slug = lang.identity?.slug ?? iso;
    const r = lang.resources || {};
    for (const g of GROUPS) {
      for (const it of r[g] || []) {
        // parent.url === clips[0].url in 100% of cases, so the top-level url IS
        // the first playlist item. We intentionally never descend into
        // meta.clips[], meta.clips[].image, or meta.zipUrl.
        if (!it.url || !it.external) continue;
        items += 1;
        const host = hostOf(it.url);
        if (!urls.has(it.url)) urls.set(it.url, { host, occ: [] });
        urls.get(it.url).occ.push({
          iso, slug, group: g, source: it.source || '', name: it.name || '',
        });
      }
    }
  }
  return { urls, items };
}

// --- 2. soft-404 heuristics for SPA domains ---------------------------------
// Returns 'OK' | 'BROKEN' for a 2xx response on a soft-404 host.
function softCheck(host, requestedUrl, res) {
  const finalUrl = res.url || requestedUrl;
  if (host === 'live.bible.is') {
    // valid: /bible/{ID} -> redirects to /bible/{ID}/{BOOK}/{CH}
    // dead:  stays at /bible/{ID} (no redirect)
    let reqPath = '', finPath = '';
    try { reqPath = new URL(requestedUrl).pathname.replace(/\/$/, ''); } catch {}
    try { finPath = new URL(finalUrl).pathname.replace(/\/$/, ''); } catch {}
    const grew = res.redirected && finPath.length > reqPath.length && finPath.startsWith(reqPath);
    return grew ? 'OK' : 'BROKEN';
  }
  if (host === 'bible.com') {
    // valid: /bible/{ID}/ -> redirect preserves {ID} in final path
    // dead:  falls back to /bible/111/JHN.1.KJV
    let id = '';
    try { id = (new URL(requestedUrl).pathname.match(/\/bible\/(\d+)/) || [])[1] || ''; } catch {}
    let finPath = '';
    try { finPath = new URL(finalUrl).pathname; } catch {}
    if (!id) return 'OK'; // unusual shape — don't guess it dead
    return finPath.includes(`/bible/${id}/`) || finPath.includes(`/bible/${id}.`)
      ? 'OK' : 'BROKEN';
  }
  return 'OK';
}

// --- 3. check a single URL --------------------------------------------------
async function fetchStatus(url, method, timeout) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      method,
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'User-Agent': UA, Accept: '*/*' },
    });
    return { res };
  } finally {
    clearTimeout(timer);
  }
}

// Returns { class, status, finalUrl, note }
async function checkUrl(url, host, timeout) {
  const classify = (res) => {
    const s = res.status;
    if (s >= 200 && s < 300) {
      if (SOFT_404.has(host)) {
        const c = softCheck(host, url, res);
        return { class: c, status: s, finalUrl: res.url || url,
          note: c === 'BROKEN' ? 'soft-404 heuristic' : '' };
      }
      return { class: 'OK', status: s, finalUrl: res.url || url, note: '' };
    }
    if (s === 404 || s === 410) return { class: 'BROKEN', status: s, finalUrl: res.url || url, note: '' };
    // 401/403/429/5xx and anything else: transient or bot-block — review, don't fail.
    return { class: 'SUSPECT', status: s, finalUrl: res.url || url, note: '' };
  };

  // HEAD first; fall back to GET when the server rejects HEAD.
  try {
    const { res } = await fetchStatus(url, 'HEAD', timeout);
    if (res.status === 405 || res.status === 501 || res.status === 403 || SOFT_404.has(host)) {
      // Some servers/CDNs mishandle HEAD, and soft-404 hosts need the real GET
      // redirect chain — retry with GET before trusting the verdict.
      try {
        const g = await fetchStatus(url, 'GET', timeout);
        return classify(g.res);
      } catch (e) {
        return classify(res); // GET failed too — trust the HEAD result
      }
    }
    return classify(res);
  } catch (e) {
    // network-level failure — try GET once (some hosts drop HEAD connections)
    try {
      const g = await fetchStatus(url, 'GET', timeout);
      return classify(g.res);
    } catch (e2) {
      const msg = String(e2?.cause?.code || e2?.name || e2?.message || e2);
      // DNS / refused / reset are confirmed-dead; timeouts/TLS are suspect.
      const dead = /ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|ERR_INVALID_URL/.test(msg);
      return { class: dead ? 'BROKEN' : 'SUSPECT', status: 0, finalUrl: url, note: msg };
    }
  }
}

// --- 4. per-host worker pool ------------------------------------------------
async function poolMap(items, concurrency, fn) {
  let next = 0;
  const worker = async () => { while (next < items.length) await fn(items[next++]); };
  const n = Math.min(concurrency, items.length);
  if (n > 0) await Promise.all(Array.from({ length: n }, worker));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const t0 = Date.now();

  const { urls, items } = gather();
  console.error(`Loaded ${items} external items → ${urls.size} unique URLs`);

  // Partition into skip / check.
  const skipped = [];
  let candidates = [];
  for (const [url, info] of urls) {
    if (info.host && SKIP_DOMAINS.has(info.host)) { skipped.push([url, info]); continue; }
    if (args.onlyDomain && !(info.host || '').includes(args.onlyDomain)) continue;
    candidates.push([url, info]);
  }
  candidates.sort((a, b) => a[0].localeCompare(b[0])); // stable order for --limit/--resume
  if (args.limit != null) candidates = candidates.slice(0, args.limit);
  console.error(`Skipped ${skipped.length} URLs on skip-list (${[...SKIP_DOMAINS].join(', ')})`);
  console.error(`Checking ${candidates.length} URLs across ${new Set(candidates.map(([, i]) => i.host)).size} hosts`);

  mkdirSync(args.out, { recursive: true });
  const cachePath = path.join(args.out, 'check-cache.jsonl');
  const done = new Map(); // url -> result
  if (args.resume && existsSync(cachePath)) {
    for (const line of readFileSync(cachePath, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { const r = JSON.parse(line); done.set(r.url, r); } catch {}
    }
    console.error(`Resume: ${done.size} URLs already in cache`);
  }

  // Bucket remaining work by host.
  const byHost = new Map();
  for (const [url, info] of candidates) {
    if (done.has(url)) continue;
    const h = info.host || '(invalid)';
    if (!byHost.has(h)) byHost.set(h, []);
    byHost.get(h).push([url, info]);
  }

  const results = [...done.values()];
  let checked = 0;
  const total = byHost.size ? candidates.length - done.size : 0;

  // Each host is processed by ONE task that walks its URLs with the configured
  // per-host concurrency + delay. Hosts run in parallel up to globalConcurrency.
  const hostEntries = [...byHost.entries()];
  await poolMap(hostEntries, args.globalConcurrency, async ([host, list]) => {
    let idx = 0;
    const hostWorker = async () => {
      while (idx < list.length) {
        const [url, info] = list[idx++];
        const r = await checkUrl(url, host, args.timeout);
        const rec = {
          url, host, class: r.class, status: r.status, finalUrl: r.finalUrl,
          note: r.note, occ: info.occ,
        };
        results.push(rec);
        appendFileSync(cachePath, JSON.stringify(rec) + '\n');
        checked += 1;
        if (checked % 200 === 0) {
          console.error(`  ${checked}/${total} checked (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
        }
        if (args.delay > 0 && idx < list.length) await sleep(args.delay);
      }
    };
    await poolMap(Array.from({ length: args.hostConcurrency }), args.hostConcurrency, hostWorker);
  });

  writeReports(args, results, skipped, urls, t0);

  const brokenCount = results.filter((r) => r.class === 'BROKEN').length;
  if (args.fail && brokenCount > 0) {
    console.error(`FAIL: ${brokenCount} broken URLs`);
    process.exit(1);
  }
}

// --- 5. reports -------------------------------------------------------------
function csvCell(s) {
  const v = String(s ?? '');
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function writeReports(args, results, skipped, urls, t0) {
  const byClass = { OK: 0, BROKEN: 0, SUSPECT: 0, SKIPPED: skipped.length };
  for (const r of results) byClass[r.class] = (byClass[r.class] || 0) + 1;

  // CSV: one row per (broken/suspect URL × occurrence), most-impactful first.
  const rows = results
    .filter((r) => r.class === 'BROKEN' || r.class === 'SUSPECT')
    .sort((a, b) => {
      if (a.class !== b.class) return a.class === 'BROKEN' ? -1 : 1;
      return b.occ.length - a.occ.length;
    });
  const csv = ['status_class,http_status,url,final_url,domain,group,source,iso,slug,name'];
  for (const r of rows) {
    for (const o of r.occ) {
      csv.push([r.class, r.status, r.url, r.finalUrl, r.host, o.group, o.source, o.iso, o.slug, o.name]
        .map(csvCell).join(','));
    }
  }
  const csvPath = path.join(args.out, 'dead-links.csv');
  writeFileSync(csvPath, csv.join('\n'), 'utf8');

  // JSON: full structured results (all classes) for tooling.
  const jsonPath = path.join(args.out, 'dead-links.json');
  writeFileSync(jsonPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    durationSec: Math.round((Date.now() - t0) / 1000),
    totals: byClass,
    skippedDomains: [...SKIP_DOMAINS],
    results,
  }), 'utf8');

  // Per-domain broken/suspect breakdown.
  const domStats = new Map();
  for (const r of results) {
    if (r.class === 'OK') continue;
    const d = domStats.get(r.host) || { BROKEN: 0, SUSPECT: 0 };
    d[r.class] += 1;
    domStats.set(r.host, d);
  }

  // GitHub job-summary markdown (also handy locally).
  const md = [];
  md.push('# External link check');
  md.push('');
  md.push(`Checked in ${Math.round((Date.now() - t0) / 1000)}s.`);
  md.push('');
  md.push('| Class | Count |');
  md.push('|---|---|');
  md.push(`| OK | ${byClass.OK || 0} |`);
  md.push(`| BROKEN | ${byClass.BROKEN || 0} |`);
  md.push(`| SUSPECT | ${byClass.SUSPECT || 0} |`);
  md.push(`| SKIPPED (${[...SKIP_DOMAINS].join(', ')}) | ${byClass.SKIPPED || 0} |`);
  md.push('');
  const topDoms = [...domStats.entries()]
    .sort((a, b) => (b[1].BROKEN + b[1].SUSPECT) - (a[1].BROKEN + a[1].SUSPECT))
    .slice(0, 25);
  if (topDoms.length) {
    md.push('## Problem domains (top 25)');
    md.push('');
    md.push('| Domain | Broken | Suspect |');
    md.push('|---|---|---|');
    for (const [d, s] of topDoms) md.push(`| ${d} | ${s.BROKEN} | ${s.SUSPECT} |`);
    md.push('');
  }
  const sampleBroken = rows.filter((r) => r.class === 'BROKEN').slice(0, 40);
  if (sampleBroken.length) {
    md.push('## Sample broken links (up to 40)');
    md.push('');
    md.push('| Status | URL | Section | Source | Language | Uses |');
    md.push('|---|---|---|---|---|---|');
    for (const r of sampleBroken) {
      const o = r.occ[0];
      md.push(`| ${r.status || r.note} | ${r.url} | ${o.group} | ${o.source} | ${o.iso} | ${r.occ.length} |`);
    }
    md.push('');
  }
  md.push('Full details: `dead-links.csv` (per-occurrence) and `dead-links.json` (structured) in the run artifact.');
  const mdPath = path.join(args.out, 'summary.md');
  writeFileSync(mdPath, md.join('\n'), 'utf8');

  // If running in GitHub Actions, append to the job summary.
  if (process.env.GITHUB_STEP_SUMMARY) {
    try { appendFileSync(process.env.GITHUB_STEP_SUMMARY, md.join('\n') + '\n'); } catch {}
  }

  console.error('');
  console.error(`OK ${byClass.OK || 0}  BROKEN ${byClass.BROKEN || 0}  SUSPECT ${byClass.SUSPECT || 0}  SKIPPED ${byClass.SKIPPED || 0}`);
  console.error(`Reports: ${csvPath}`);
  console.error(`         ${jsonPath}`);
  console.error(`         ${mdPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
