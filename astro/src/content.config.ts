import { defineCollection } from 'astro:content';
import { file } from 'astro/loaders';

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
