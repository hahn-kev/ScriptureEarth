export const GROUPS = [
  { key: 'read', label: 'Read' },
  { key: 'listen', label: 'Listen' },
  { key: 'watch', label: 'Watch' },
  { key: 'use', label: 'Apps & Print' },
] as const;

export const PILLS = [
  { key: 'read', label: 'Read' },
  { key: 'listen', label: 'Listen' },
  { key: 'watch', label: 'Watch' },
  { key: 'app', label: 'App' },
  { key: 'buy', label: 'Buy' },
] as const;

const ACTIONS: Record<string, Record<string, { label: string; slug: string }>> = {
  read: {
    pdf: { label: 'Download PDF', slug: 'action.downloadpdf' },
    viewer: { label: 'Open viewer', slug: 'action.openviewer' },
    _: { label: 'Read online', slug: 'action.readonline' },
  },
  listen: {
    audio: { label: 'Play', slug: 'action.play' },
    _: { label: 'Download', slug: 'action.download' },
  },
  watch: {
    _: { label: 'Watch', slug: 'action.watch' },
  },
  use: {
    buy: { label: 'Order', slug: 'action.order' },
    app: { label: 'Get app', slug: 'action.getapp' },
    _: { label: 'Open', slug: 'action.open' },
  },
};

function action(group: string, kind: string) {
  const g = ACTIONS[group];
  return (g && (g[kind] || g._)) || { label: 'Open', slug: 'action.open' };
}

export function actionLabel(group: string, kind: string) {
  return action(group, kind).label;
}

export function actionSlug(group: string, kind: string) {
  return action(group, kind).slug;
}
