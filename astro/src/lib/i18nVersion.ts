import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

/**
 * Content hash of the client localizer (public/i18n.js) + every i18n catalog
 * (public/i18n/*.json). Threaded onto the localizer's <script> URL and its
 * runtime catalog fetches as `?v=<hash>`, so those URLs change ONLY when their
 * content changes — content-addressed cache-busting. This is what lets returning
 * visitors always get the current i18n.js/catalogs instead of a stale cached copy,
 * while still allowing the assets to be cached immutably (see public/_headers).
 *
 * Computed once at build time (Node); the module cache means the filesystem work
 * happens a single time, not per page.
 */
function compute(): string {
  const pub = fileURLToPath(new URL('../../public/', import.meta.url));
  const h = createHash('sha256');
  h.update(readFileSync(pub + 'i18n.js'));
  const dir = pub + 'i18n';
  for (const f of readdirSync(dir).sort()) {
    h.update(f);
    h.update(readFileSync(dir + '/' + f));
  }
  return h.digest('hex').slice(0, 10);
}

export const I18N_VERSION = compute();
