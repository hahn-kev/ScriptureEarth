// Pre-build step: regenerate this attempt's data file(s) from the canonical
// source of truth (content/search-index.json, produced by scripts/extract.py).
// Runs before every benchmark so attempts never drift from stale hand-copied data.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function build({ sourcePath, dir }) {
  const raw = await readFile(sourcePath, 'utf8');
  await writeFile(path.join(dir, 'data.json'), raw);
}
