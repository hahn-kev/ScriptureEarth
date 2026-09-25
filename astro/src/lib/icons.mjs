// Site icon registry: semantic name → Iconify icon, one map per candidate icon set.
// Values are `set:name`; a bare name means that set's own Iconify prefix. Plain .mjs so
// both scripts/gen_icons.mjs and Astro can import it.
//
// Several candidate sets are wired up while we choose between them. A footer switch (Base.astro)
// toggles <html data-icons="…">. DEFAULT_SET is baked into src/styles/icons.css.
// Every other set goes to public/icons/<set>.css as `[data-icons=<set>]` overrides,
// loaded only when a visitor picks that set, so the default page weight doesn't change.
//
// Add or change an icon here, then run `pnpm run gen:icons`. Every set must define every key.
// Browse: https://icon-sets.iconify.design/  (material-symbols, tabler, fluent-color, …)
export const DEFAULT_SET = 'material-symbols';

export const ICON_SETS = {
  // Material Symbols (Google, Apache-2.0). Brand marks it lacks come from mdi (Apache-2.0).
  'material-symbols': {
    label: 'Material',
    icons: {
      search: 'search',
      home: 'home-outline',
      languages: 'translate',
      countries: 'public',
      locale: 'language',
      // resource rights / groups — match the data-r keys used by pills, facets and groups
      read: 'menu-book-outline',
      listen: 'headphones-outline',
      watch: 'play-circle-outline',
      app: 'install-mobile-outline',
      buy: 'shopping-cart-outline',
      use: 'apps',
      // actions
      download: 'download',
      play: 'play-arrow',
      open: 'open-in-new',
      // resource-row format badges (see badge() in src/lib/ui.ts)
      web: 'public',
      pdf: 'picture-as-pdf-outline',
      audio: 'music-note',
      video: 'videocam-outline',
      youtube: 'mdi:youtube',
      phone: 'mobile',
      googleplay: 'mdi:google-play',
      apple: 'mdi:apple',
      print: 'print-outline',
    },
  },
  // Tabler Icons (MIT): thin-stroke outline style, includes brand marks.
  tabler: {
    label: 'Tabler',
    icons: {
      search: 'search',
      home: 'home',
      languages: 'language',
      countries: 'world',
      locale: 'language',
      read: 'book',
      listen: 'headphones',
      watch: 'circle-caret-right',
      app: 'device-mobile-down',
      buy: 'shopping-cart',
      use: 'apps',
      download: 'download',
      play: 'player-play',
      open: 'external-link',
      web: 'world-www',
      pdf: 'file-type-pdf',
      audio: 'music',
      video: 'video',
      youtube: 'brand-youtube',
      phone: 'device-mobile',
      googleplay: 'brand-google-play',
      apple: 'brand-apple',
      print: 'printer',
    },
  },
  // Fluent UI Color (Microsoft, MIT): multicolour, so these render as images, not
  // currentColor masks. It's a small set; gaps fall back to mono `fluent` (same family)
  // and brand marks come from `logos` (CC0).
  'fluent-color': {
    label: 'Fluent Color',
    icons: {
      search: 'search-sparkle-24',
      home: 'home-24',
      languages: 'fluent:translate-24-regular',
      countries: 'globe-24',
      locale: 'fluent:local-language-24-regular',
      read: 'book-open-24',
      listen: 'headphones-24',
      watch: 'video-24',
      app: 'phone-24',
      buy: 'building-store-24',
      use: 'apps-24',
      download: 'fluent:arrow-download-24-regular',
      play: 'fluent:play-24-filled',
      open: 'fluent:open-24-regular',
      web: 'link-24',
      pdf: 'document-text-24',
      audio: 'mic-24',
      video: 'video-24',
      youtube: 'logos:youtube-icon',
      phone: 'phone-24',
      googleplay: 'logos:google-play-icon',
      apple: 'logos:apple',
      print: 'fluent:print-24-regular',
    },
  },
};

/** The default set's registry (semantic name → value). */
export const ICONS = ICON_SETS[DEFAULT_SET].icons;

/** Split a registry value into { set, name }; a bare name belongs to `defaultSet`. */
export function parseIcon(value, defaultSet = DEFAULT_SET) {
  const i = value.indexOf(':');
  return i === -1 ? { set: defaultSet, name: value } : { set: value.slice(0, i), name: value.slice(i + 1) };
}
