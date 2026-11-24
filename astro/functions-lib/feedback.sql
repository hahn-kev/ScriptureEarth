-- D1 schema for soft-launch feedback (functions/api/feedback.js).
-- Create once:
--   pnpm exec wrangler d1 create se-feedback
--   pnpm exec wrangler d1 execute se-feedback --remote --file functions-lib/feedback.sql
-- Then bind it to the Pages project se-proto-en as FEEDBACK_DB
-- (Settings → Bindings → D1 database; add it for Production and Preview).
-- Read it:
--   pnpm exec wrangler d1 execute se-feedback --remote --command "SELECT * FROM feedback ORDER BY id DESC LIMIT 50"
CREATE TABLE IF NOT EXISTS feedback (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT    NOT NULL,          -- ISO 8601 UTC
  kind       TEXT    NOT NULL,          -- problem | idea | other
  message    TEXT    NOT NULL,
  email      TEXT    NOT NULL DEFAULT '', -- optional, only to reply
  page       TEXT    NOT NULL DEFAULT '', -- path + query the visitor was on
  locale     TEXT    NOT NULL DEFAULT '', -- site UI locale (eng, spa, ...)
  width      INTEGER,                   -- viewport width in CSS px
  user_agent TEXT    NOT NULL DEFAULT '',
  country    TEXT    NOT NULL DEFAULT '', -- Cloudflare request.cf.country
  status     TEXT    NOT NULL DEFAULT 'new' -- for triage: new | seen | done
);
CREATE INDEX IF NOT EXISTS feedback_created ON feedback (created_at);
