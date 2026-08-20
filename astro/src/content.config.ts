import { defineCollection } from 'astro:content';
import { file } from 'astro/loaders';

// Content Layer file() loader over the shared extractor output. The array items
// key on `idx`/`code`; we synthesise the required `id`. This is the "arbitrary
// source incl. a DB export" ingestion path the SSG research flagged as Astro's
// strength — no per-file glob needed, one JSON array cached between builds.
const languages = defineCollection({
  loader: file('content/languages.json', {
    parser: (text) => JSON.parse(text).map((d: any) => ({ ...d, id: String(d.idx) })),
  }),
});

const countries = defineCollection({
  loader: file('content/countries.json', {
    parser: (text) => JSON.parse(text).map((d: any) => ({ ...d, id: d.code })),
  }),
});

export const collections = { languages, countries };
