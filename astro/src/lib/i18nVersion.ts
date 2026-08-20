import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

/**
 * Content hash of the client localizer (src/scripts/i18n.js) + every i18n catalog
 * (public/i18n/*.json). The localizer script is bundled+hashed by Astro (so it busts
 * itself); this token is set on window (Base.astro) and threaded onto the runtime
 * catalog fetches as `?v=<hash>`, so those URLs change ONLY when their content
 * changes — content-addressed cache-busting. This lets returning visitors always get
 * the current catalogs instead of a stale cached copy, while allowing them to be
 * cached immutably (see public/_headers).
 *
 * Computed once at build time (Node); the module cache means the filesystem work
 * happens a single time, not per page.
 */
function compute(): string {
  // Resolve from the project root (cwd during `astro build`), not import.meta.url —
  // this module gets bundled into dist/chunks, where relative depth would differ.
  const root = process.cwd();
  const h = createHash('sha256');
  h.update(readFileSync(join(root, 'src/scripts/i18n.js')));
  const dir = join(root, 'public/i18n');
  for (const f of readdirSync(dir).sort()) {
    h.update(f);
    h.update(readFileSync(join(dir, f)));
  }
  return h.digest('hex').slice(0, 10);
}

export const I18N_VERSION = compute();
