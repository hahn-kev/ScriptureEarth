import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

/** Build-time hash of i18n.js + catalogs, used as `?v=` on catalog fetches. */
function compute(): string {
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
