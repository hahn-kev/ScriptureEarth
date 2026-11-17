// The dump's autonym field is free text: one or more names separated by commas, each with an
// optional romanization in parentheses, e.g. "кыргыз тили (Kyrgyz tili), кыргызча (Kyrgyzcha)".
export interface AutonymPart { native: string; roman: string }

export function parseAutonym(s: string | null | undefined): AutonymPart[] {
  if (!s) return [];
  const parts: string[] = [];
  let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean).map((p) => {
    const m = p.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
    return m ? { native: m[1], roman: m[2] } : { native: p, roman: '' };
  });
}

/** Autonym parts for a card, or [] when the autonym is just the English name again. */
export function cardAutonym(d: any): AutonymPart[] {
  const parts = parseAutonym(d.names?.autonym);
  const eng = String(d.names?.localized?.eng ?? '').toLowerCase();
  if (!parts.length || parts[0].native.toLowerCase() === eng) return [];
  return parts;
}

// Card designs under review (PR: autonym card designs). Remove all but the chosen one afterwards.
export const AUTONYM_DESIGNS = [
  { key: 'none', label: 'Today', note: 'The card as it is now, with no autonym.' },
  { key: 'a', label: 'Subtitle, full text', note: 'Every name in the autonym field, with its romanization, on a muted line under the English name.' },
  { key: 'b', label: 'Native script only', note: 'Only the first native name, in normal text colour. Hover shows the full autonym field.' },
  { key: 'c', label: 'Native + romanization', note: 'The first native name, followed by its romanization in small italics when the data has one.' },
  { key: 'd', label: 'Inline after the name', note: 'The first native name on the same line as the English name, cut off with an ellipsis when it is long.' },
  { key: 'e', label: 'Autonym as the title', note: 'The native name becomes the card title, and the English name moves to the line below.' },
] as const;
export const DEFAULT_AUTONYM_DESIGN = 'c';
