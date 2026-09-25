export const GROUPS = [
  { key: 'read', label: 'Read' },
  { key: 'listen', label: 'Listen' },
  { key: 'watch', label: 'Watch' },
  { key: 'app', label: 'Apps' },
  { key: 'buy', label: 'Buy' },
  { key: 'other', label: 'Other' },
] as const;

export const PILLS = [
  { key: 'read', label: 'Read' },
  { key: 'listen', label: 'Listen' },
  { key: 'watch', label: 'Watch' },
  { key: 'app', label: 'Apps' },
  { key: 'buy', label: 'Buy' },
] as const;

// icon = a key of src/lib/icons.mjs (rendered as <span class="ic ic-<icon>">).
type Action = { label: string; slug: string; icon: string };
const OPEN: Action = { label: 'Open', slug: 'action.open', icon: 'open' };
const ACTIONS: Record<string, Record<string, Action>> = {
  read: {
    pdf: { label: 'Download PDF', slug: 'action.downloadpdf', icon: 'download' },
    viewer: { label: 'Open viewer', slug: 'action.openviewer', icon: 'read' },
    _: { label: 'Read online', slug: 'action.readonline', icon: 'read' },
  },
  listen: {
    audio: { label: 'Play', slug: 'action.play', icon: 'play' },
    _: { label: 'Download', slug: 'action.download', icon: 'download' },
  },
  watch: {
    _: { label: 'Watch', slug: 'action.watch', icon: 'watch' },
  },
  app: {
    _: { label: 'Get app', slug: 'action.getapp', icon: 'app' },
  },
  buy: {
    _: { label: 'Order', slug: 'action.order', icon: 'buy' },
  },
  other: {
    _: { label: 'Visit website', slug: 'action.visit', icon: 'open' },
  },
};

function action(group: string, kind: string): Action {
  const g = ACTIONS[group];
  return (g && (g[kind] || g._)) || OPEN;
}

export function actionLabel(group: string, kind: string) {
  return action(group, kind).label;
}

export function actionSlug(group: string, kind: string) {
  return action(group, kind).slug;
}

export function actionIcon(group: string, kind: string) {
  return action(group, kind).icon;
}

// Format badge shown at the left of a resource row: an icon (key of src/lib/icons.mjs)
// plus the label read out to screen readers. Brand marks where the host is unmistakable
// (YouTube, Google Play, App Store); otherwise a generic icon for the format.
function host(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function badge(group: string, r: { format?: string; kind?: string; url?: string }) {
  const h = host(r.url || '');
  const fmt = r.format || '';
  if (/(^|\.)youtube\.com$|^youtu\.be$/.test(h)) return { icon: 'youtube', label: 'YouTube' };
  if (h === 'play.google.com') return { icon: 'googleplay', label: 'Google Play' };
  if (h === 'apps.apple.com') return { icon: 'apple', label: 'App Store' };
  switch (r.kind) {
    case 'pdf': return { icon: 'pdf', label: fmt || 'PDF' };
    case 'web': return { icon: 'web', label: fmt || 'Web' };
    case 'audio': return { icon: 'audio', label: fmt || 'Audio' };
    case 'video': return { icon: 'video', label: fmt || 'Video' };
    case 'app': return { icon: 'phone', label: fmt || 'App' };
    case 'buy': return { icon: 'print', label: fmt || 'Print' };
  }
  const byGroup: Record<string, string> = { read: 'read', listen: 'audio', watch: 'video', app: 'phone', buy: 'print', other: 'web' };
  return { icon: byGroup[group] || 'open', label: fmt || group };
}
