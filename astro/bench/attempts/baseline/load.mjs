// Decodes this attempt's data file(s) back into the canonical record shape
// (the same shape scripts/extract.py produces) so the harness can hash it
// and compare against the baseline for correctness.
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export async function load({ dir }) {
  const raw = await readFile(path.join(dir, 'data.json'), 'utf8');
  return JSON.parse(raw);
}
