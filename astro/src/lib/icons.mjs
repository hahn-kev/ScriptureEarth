// Site icon registry: semantic name → Iconify icon. Values are `set:name`; a bare name
// means the Material Symbols set (`material-symbols`, Apache-2.0). Brand marks that
// Material Symbols lacks (YouTube, Google Play, Apple) come from `mdi` (Apache-2.0).
// Plain .mjs so both scripts/gen_icons.mjs and Astro can import it.
//
// Add an icon here, then run `pnpm run gen:icons` to regenerate src/styles/icons.css.
// Browse: https://icon-sets.iconify.design/material-symbols/  https://icon-sets.iconify.design/mdi/
export const DEFAULT_SET = 'material-symbols';

export const ICONS = {
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
  other: 'category-outline',
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
};

/** Split a registry value into { set, name }. */
export function parseIcon(value) {
  const i = value.indexOf(':');
  return i === -1 ? { set: DEFAULT_SET, name: value } : { set: value.slice(0, i), name: value.slice(i + 1) };
}
