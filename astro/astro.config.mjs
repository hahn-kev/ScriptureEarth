import { defineConfig } from 'astro/config';

// THROWAWAY bake-off config. Static output; English-only PoC (i18n routing is a
// production concern — see research/09-i18n-catalog.md). Trailing slash "always"
// so /language/812/ emits index.html (Cloudflare-friendly, Pagefind-friendly).
export default defineConfig({
  output: 'static',
  trailingSlash: 'always',
  build: { format: 'directory' },
  compressHTML: true,
  vite: {
    build: {
      // Keep hoisted <script> bundles as EXTERNAL, hashed, cache-shared files.
      // Astro inlines a script only when it has no imports AND is under the asset
      // inline limit — which would inline the small i18n localizer into all 4,300
      // pages (re-sent on every navigation). Returning false for .js disables that;
      // undefined defers to Vite's default 4KB threshold for other assets.
      assetsInlineLimit: (path) => (path.endsWith('.js') ? false : undefined),
    },
  },
});
