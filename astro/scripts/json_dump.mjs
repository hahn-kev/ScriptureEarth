// Python json.dump default: ensure_ascii=False, separators=(', ', ': '), no trailing newline.
export function jsonDump(value) {
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'boolean') return value ? 'true' : 'false';
  if (t === 'number') {
    if (!Number.isFinite(value)) throw new Error(`cannot dump non-finite number ${value}`);
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(jsonDump).join(', ') + ']';
  if (t === 'object') {
    return '{' + Object.entries(value)
      .map(([k, v]) => JSON.stringify(k) + ': ' + jsonDump(v))
      .join(', ') + '}';
  }
  throw new Error(`cannot dump ${t}`);
}
