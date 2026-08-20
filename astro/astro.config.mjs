import { defineConfig } from 'astro/config';

// THROWAWAY bake-off config. Static output; English-only PoC (i18n routing is a
// production concern — see research/09-i18n-catalog.md). Trailing slash "always"
// so /language/812/ emits index.html (Cloudflare-friendly, Pagefind-friendly).
export default defineConfig({
  output: 'static',
  trailingSlash: 'always',
  build: { format: 'directory' },
  compressHTML: true,
});
