// Shared presentation logic for the bake-off (Astro copy). Mirrors the design
// system's res-group / pill vocabulary. Kept engine-neutral in spirit so the
// Hugo/Statiq templates reproduce identical output.
export const GROUPS = [
  { key: 'read',   label: 'Read',          color: 'var(--r-read)' },
  { key: 'listen', label: 'Listen',        color: 'var(--r-listen)' },
  { key: 'watch',  label: 'Watch',         color: 'var(--r-watch)' },
  { key: 'use',    label: 'Apps & Print',  color: 'var(--r-app)' },
] as const;

export const PILLS = [
  { key: 'read', label: 'Read' }, { key: 'listen', label: 'Listen' },
  { key: 'watch', label: 'Watch' }, { key: 'app', label: 'App' }, { key: 'buy', label: 'Buy' },
];

export function actionLabel(group: string, kind: string): string {
  if (group === 'read')   return kind === 'pdf' ? 'Download PDF' : kind === 'viewer' ? 'Open viewer →' : 'Read online →';
  if (group === 'listen') return kind === 'audio' ? 'Play →' : 'Download →';
  if (group === 'watch')  return 'Watch →';
  if (group === 'use')    return kind === 'buy' ? 'Order →' : kind === 'app' ? 'Get app →' : 'Open →';
  return 'Open →';
}
