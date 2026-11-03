import { adfToMarkdown, type AdfDoc } from './adf/toMarkdown.js';

const NAME_KEYS = ['displayName', 'name', 'value', 'key'];
/** A token inside a field value cannot be restored on write, so only its hint is shown. */
const BARE_TOKEN = /\{\{atlas:\d+\}\} /g;

/** A plain-text view of a Jira field value; missing values are `-`. */
export function displayValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '-';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.length === 0 ? '-' : v.map(displayValue).join(', ');
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (o.type === 'doc') return adfToMarkdown(o as AdfDoc).markdown.replace(BARE_TOKEN, '') || '-';
    for (const key of NAME_KEYS) {
      const name = o[key];
      if (typeof name === 'string' || typeof name === 'number') return String(name);
    }
    return JSON.stringify(v);
  }
  return String(v);
}
