// Size-benchmark comparison + gate. Reads the freshly built dist/assets/sizes.json,
// fetches the baseline currently deployed to production, diffs each tracked metric
// against percentage bands (+ a byte floor), renders a report, and exits non-zero
// on any fail-band breach. See bench/SIZE-BENCH-SPEC.md §4–§6.
//
//   node scripts/check_sizes.mjs [--report file.md] [--verdict file.txt]
//
// First run / missing or schema-mismatched baseline → report-only, exit 0.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CURRENT_PATH = path.join(__dirname, '..', 'dist', 'assets', 'sizes.json');
const DEFAULT_BASELINE_URL = 'https://se-proto-en.pages.dev/assets/sizes.json';
const BASELINE_URL = process.env.SIZE_BENCH_BASELINE_URL || DEFAULT_BASELINE_URL;

// Gating config (spec §5). Provisional — tune once run-to-run noise is observed.
const CONFIG = {
  floorBytes: 300, // ignore any per-metric delta smaller than this — noise
  bands: {
    archetypeStrict: { warn: 2, fail: 5 },
    archetypeDeferred: { warn: 2, fail: 5 },
    totalWire: { warn: 2, fail: 5 },
    buckets: { warn: 2, fail: null }, // shared buckets warn-only
  },
};

function parseArgs(argv) {
  const args = { report: null, verdict: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--report') args.report = argv[++i];
    else if (argv[i] === '--verdict') args.verdict = argv[++i];
  }
  return args;
}

// --- flatten a sizes.json into the flat list of gated/tracked metrics --------
function metricsOf(sizes) {
  const out = [];
  const push = (name, band, wire) => {
    if (typeof wire === 'number') out.push({ name, band, wire });
  };
  const a = sizes.archetypes || {};
  for (const key of ['home', 'browse', 'countries', 'country']) {
    const e = a[key];
    if (!e) continue;
    push(`${key} strict`, 'archetypeStrict', e.strict?.wire);
    push(`${key} deferred`, 'archetypeDeferred', e.deferred?.wire);
  }
  if (a.language) {
    push('language strict avg', 'archetypeStrict', a.language.strict?.avg?.wire);
    push('language strict p95', 'archetypeStrict', a.language.strict?.p95?.wire);
    push('language deferred avg', 'archetypeDeferred', a.language.deferred?.avg?.wire);
    push('language deferred p95', 'archetypeDeferred', a.language.deferred?.p95?.wire);
  }
  push('total-site wire', 'totalWire', sizes.site?.wire);
  for (const [type, b] of Object.entries(sizes.buckets || {})) {
    push(`bucket ${type}`, 'buckets', b.wire);
  }
  return out;
}

// classify one metric's delta against its band → { status, delta, pct }
function classify(band, current, baseline) {
  const delta = current - baseline;
  if (Math.abs(delta) < CONFIG.floorBytes) return { status: 'ok', delta, pct: pctOf(delta, baseline) };
  const pct = pctOf(delta, baseline);
  const { warn, fail } = CONFIG.bands[band] || {};
  if (fail != null && pct >= fail) return { status: 'fail', delta, pct };
  if (warn != null && pct >= warn) return { status: 'warn', delta, pct };
  return { status: 'ok', delta, pct };
}

function pctOf(delta, baseline) {
  return baseline > 0 ? (delta / baseline) * 100 : 0;
}

function diff(current, baseline) {
  const base = new Map(metricsOf(baseline).map((m) => [m.name, m]));
  const rows = [];
  for (const m of metricsOf(current)) {
    const b = base.get(m.name);
    if (!b) {
      rows.push({ ...m, status: 'new', delta: null, pct: null, baseline: null });
      continue;
    }
    const c = classify(m.band, m.wire, b.wire);
    rows.push({ ...m, baseline: b.wire, ...c });
  }
  return rows;
}

// --- rendering ---------------------------------------------------------------
const kib = (n) => (n == null ? '—' : (n / 1024).toFixed(1) + 'K');
const signed = (n) => (n == null ? '—' : (n >= 0 ? '+' : '') + n.toLocaleString('en-US'));
const pctStr = (n) => (n == null ? '—' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%');
const MARK = { ok: '✅', warn: '⚠️', fail: '❌', new: '🆕', report: 'ℹ️' };

function renderMarkdown(rows, meta) {
  const lines = [];
  lines.push('### Size benchmark');
  if (meta.reportOnly) {
    lines.push('');
    lines.push(`> ${MARK.report} **Report-only** — ${meta.reason}. No baseline comparison; these are the current sizes.`);
  }
  lines.push('');
  lines.push(`Baseline: \`${meta.baselineUrl}\` · current commit \`${(meta.commit || '—').slice(0, 12)}\` · worstLocale \`${meta.worstLocale || '—'}\``);
  lines.push('');
  lines.push('| Metric | Current (wire) | Baseline | Δ bytes | Δ % | |');
  lines.push('|---|--:|--:|--:|--:|:-:|');
  for (const r of rows) {
    lines.push(`| ${r.name} | ${kib(r.wire)} | ${kib(r.baseline)} | ${signed(r.delta)} | ${pctStr(r.pct)} | ${MARK[r.status] || ''} |`);
  }
  lines.push('');
  const warns = rows.filter((r) => r.status === 'warn').length;
  const fails = rows.filter((r) => r.status === 'fail').length;
  if (meta.reportOnly) lines.push('_Inaugural run — this build becomes the baseline once deployed._');
  else if (fails) lines.push(`**${fails} metric(s) over the fail band, ${warns} warning(s).** Cold-load size regressed past budget.`);
  else if (warns) lines.push(`**${warns} warning(s), no fail-band breaches.** Within budget.`);
  else lines.push('**All tracked metrics within budget.**');
  lines.push('');
  return lines.join('\n');
}

function renderConsole(rows, meta) {
  console.log('');
  console.log(`Size benchmark  (baseline: ${meta.baselineUrl})`);
  if (meta.reportOnly) console.log(`  REPORT-ONLY — ${meta.reason}`);
  const w = Math.max(...rows.map((r) => r.name.length), 6);
  for (const r of rows) {
    const cur = kib(r.wire).padStart(8);
    const base = kib(r.baseline).padStart(8);
    const d = meta.reportOnly ? '' : `  Δ ${signed(r.delta).padStart(9)}  ${pctStr(r.pct).padStart(8)}`;
    console.log(`  ${(MARK[r.status] || ' ')} ${r.name.padEnd(w)}  ${cur}  base ${base}${d}`);
  }
  console.log('');
}

// --- baseline fetch ----------------------------------------------------------
async function fetchBaseline(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return { ok: false, reason: `baseline fetch ${res.status}` };
    return { ok: true, data: await res.json() };
  } catch (e) {
    return { ok: false, reason: `baseline fetch failed (${e.message})` };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!existsSync(CURRENT_PATH)) {
    console.error(`No sizes.json at ${CURRENT_PATH} — run \`node scripts/build_sizes.mjs\` first.`);
    process.exit(1);
  }
  const current = JSON.parse(readFileSync(CURRENT_PATH, 'utf8'));

  const meta = {
    baselineUrl: BASELINE_URL,
    commit: current.commit,
    worstLocale: current.config?.worstLocale,
    reportOnly: false,
    reason: '',
  };

  const baseline = await fetchBaseline(BASELINE_URL);
  if (!baseline.ok) {
    meta.reportOnly = true;
    meta.reason = baseline.reason;
  } else if (baseline.data.schema !== current.schema) {
    meta.reportOnly = true;
    meta.reason = `schema changed (baseline ${baseline.data.schema} → current ${current.schema})`;
  }

  const rows = meta.reportOnly
    ? metricsOf(current).map((m) => ({ ...m, status: 'report', delta: null, pct: null, baseline: null }))
    : diff(current, baseline.data);

  const verdict = !meta.reportOnly && rows.some((r) => r.status === 'fail') ? 'fail' : 'pass';

  renderConsole(rows, meta);
  const md = renderMarkdown(rows, meta);
  if (args.report) {
    writeFileSync(args.report, md, 'utf8');
    console.error(`  wrote report → ${args.report}`);
  }
  if (args.verdict) {
    writeFileSync(args.verdict, verdict, 'utf8');
    console.error(`  wrote verdict → ${args.verdict} (${verdict})`);
  }

  if (verdict === 'fail') {
    console.error('Cold-load size exceeds the fail-band budget.');
    process.exit(1);
  }
  process.exit(0);
}

main();
