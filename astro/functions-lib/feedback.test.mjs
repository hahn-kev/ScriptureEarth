// node --test functions-lib/   (pnpm run test:redirects)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeFeedbackHandler, validateFeedback } from './feedback.js';

test('validate: message is required, the rest is optional', () => {
  assert.deepEqual(validateFeedback({ message: '' }), { ok: false, error: 'message_required' });
  const v = validateFeedback({ message: '  The map is slow  ' });
  assert.equal(v.ok, true);
  assert.deepEqual(v.row, { kind: 'other', message: 'The map is slow', email: '', page: '', locale: '', width: null });
});

test('validate: honeypot, email, kind, page, locale, width', () => {
  assert.equal(validateFeedback({ message: 'hi there', website: 'x' }).error, 'spam');
  assert.equal(validateFeedback({ message: 'hi there', email: 'nope' }).error, 'bad_email');
  const v = validateFeedback({
    message: 'hi there', email: 'a@b.org', kind: 'problem',
    page: 'https://se-proto-en.pages.dev/language/ngu/?lang=spa#x', locale: 'spa', width: 390,
  });
  assert.deepEqual(v.row, { kind: 'problem', message: 'hi there', email: 'a@b.org', page: '/language/ngu/?lang=spa', locale: 'spa', width: 390 });
  const w = validateFeedback({ message: 'hi there', kind: 'drop table', page: 'javascript:alert(1)', locale: '../x', width: -4 });
  assert.deepEqual([w.row.kind, w.row.page, w.row.locale, w.row.width], ['other', '', '', null]);
});

const fakeDb = () => {
  const rows = [];
  return { rows, prepare: (sql) => ({ bind: (...a) => ({ run: async () => { rows.push({ sql, a }); } }) }) };
};
const post = (body, { origin = 'https://se.example', length } = {}) => {
  const headers = { 'Content-Type': 'application/json', 'User-Agent': 'test' };
  if (origin) headers.Origin = origin;
  if (length) headers['Content-Length'] = String(length);
  return new Request('https://se.example/api/feedback', { method: 'POST', headers, body: JSON.stringify(body) });
};
const handler = makeFeedbackHandler();

test('handler: stores a row and answers ok', async () => {
  const db = fakeDb();
  const res = await handler({ request: post({ message: 'Love it', kind: 'idea', page: '/' }), env: { FEEDBACK_DB: db } });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(db.rows.length, 1);
  assert.deepEqual(db.rows[0].a.slice(1, 5), ['idea', 'Love it', '', '/']);
});

test('handler: refusals', async () => {
  const db = fakeDb();
  assert.equal((await handler({ request: post({ message: 'x y' }, { origin: 'https://evil.example' }), env: { FEEDBACK_DB: db } })).status, 403);
  assert.equal((await handler({ request: post({ message: 'x y' }, { origin: null }), env: { FEEDBACK_DB: db } })).status, 403);
  assert.equal((await handler({ request: post({ message: 'x y' }), env: {} })).status, 503);
  assert.equal((await handler({ request: post({ message: '' }), env: { FEEDBACK_DB: db } })).status, 400);
  assert.equal((await handler({ request: post({ message: 'x y' }, { length: 99999 }), env: { FEEDBACK_DB: db } })).status, 413);
  const bot = await handler({ request: post({ message: 'buy now', website: 'http://spam' }), env: { FEEDBACK_DB: db } });
  assert.equal(bot.status, 200);
  assert.equal(db.rows.length, 0);
});
