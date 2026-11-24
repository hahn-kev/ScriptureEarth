// Soft-launch feedback: validation + D1 insert for functions/api/feedback.js.
// Pure functions so `node --test functions-lib/` (pnpm run test:redirects) covers them.
//
// Storage is a Cloudflare D1 database bound to the Pages project as FEEDBACK_DB
// (Pages → Settings → Bindings). Schema: functions-lib/feedback.sql. With no binding the
// endpoint answers 503 and the dialog offers the contact email instead, so the button is
// safe to ship before the database exists.

export const KINDS = ['problem', 'idea', 'other'];
export const LIMITS = { message: 4000, email: 254, page: 2048, locale: 8, ua: 512 };

const clip = (v, n) => String(v ?? '').trim().slice(0, n);
// Loose on purpose: we only use it to reply. A typo should not lose the message.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Check and normalise a submitted body. Returns { ok: true, row } or { ok: false, error }.
 * `website` is a honeypot: real visitors never see it, so any value means a bot.
 */
export function validateFeedback(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'bad_body' };
  if (clip(body.website, 200)) return { ok: false, error: 'spam' };
  const message = clip(body.message, LIMITS.message);
  if (message.length < 2) return { ok: false, error: 'message_required' };
  const email = clip(body.email, LIMITS.email);
  if (email && !EMAIL.test(email)) return { ok: false, error: 'bad_email' };
  const kind = KINDS.includes(body.kind) ? body.kind : 'other';
  let page = clip(body.page, LIMITS.page);
  // Keep only the path + query of our own pages; drop anything that is not a URL.
  try {
    const u = new URL(page);
    page = /^https?:$/.test(u.protocol) ? u.pathname + u.search : '';
  } catch {
    page = page.startsWith('/') && !page.startsWith('//') ? page : '';
  }
  const locale = /^[a-z]{3}$/.test(body.locale) ? body.locale : '';
  const width = Number.isInteger(body.width) && body.width > 0 && body.width < 20000 ? body.width : null;
  return { ok: true, row: { kind, message, email, page, locale, width } };
}

/** Same-origin check: the browser always sends Origin on a fetch POST. */
export function sameOrigin(request) {
  const origin = request.headers.get('Origin');
  return !!origin && origin === new URL(request.url).origin;
}

const json = (status, data) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

/** Pages Function handler factory (POST only; Pages answers 405 for other methods). */
export function makeFeedbackHandler() {
  return async ({ request, env }) => {
    if (!sameOrigin(request)) return json(403, { ok: false, error: 'origin' });
    const db = env && env.FEEDBACK_DB;
    if (!db) return json(503, { ok: false, error: 'not_configured' });
    if (Number(request.headers.get('Content-Length') || 0) > 16384) return json(413, { ok: false, error: 'too_large' });
    let body;
    try { body = await request.json(); } catch { return json(400, { ok: false, error: 'bad_body' }); }
    const v = validateFeedback(body);
    // Pretend a bot succeeded so it does not retry with another value.
    if (!v.ok) return v.error === 'spam' ? json(200, { ok: true }) : json(400, v);
    const r = v.row;
    const ua = clip(request.headers.get('User-Agent'), LIMITS.ua);
    const country = (request.cf && request.cf.country) || '';
    await db
      .prepare(
        'INSERT INTO feedback (created_at, kind, message, email, page, locale, width, user_agent, country) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(new Date().toISOString(), r.kind, r.message, r.email, r.page, r.locale, r.width, ua, country)
      .run();
    return json(200, { ok: true });
  };
}
