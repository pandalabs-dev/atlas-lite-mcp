import { TOKEN_RE } from '../../core/placeholders.js';
import type { StoragePlaceholder } from './placeholders.js';

/** A paragraph holding only one token (plus its optional hint). */
const TOKEN_PARAGRAPH_RE = new RegExp(`<p>\\s*${TOKEN_RE.source}\\s*</p>`, 'g');
/** CDATA sections are literal code: tokens inside them are left as written. */
const CDATA_RE = /(<!\[CDATA\[[\s\S]*?\]\]>)/;

/**
 * Swaps `{{atlas:N}}` tokens (and the hint after each) in converted storage back for the original markup.
 * A paragraph holding only a token becomes the original itself when it is a block, else `<p>original</p>`;
 * any other token is replaced in place. Unknown numbers are removed and listed once each in `unknown`.
 */
export function restoreStorageTokens(
  storage: string,
  tokens: Map<number, StoragePlaceholder>,
): { storage: string; used: Set<number>; unknown: number[] } {
  const used = new Set<number>();
  const unknown: number[] = [];
  const lookup = (digits: string): StoragePlaceholder | undefined => {
    const n = Number(digits);
    const token = tokens.get(n);
    if (token) used.add(n);
    else if (!unknown.includes(n)) unknown.push(n);
    return token;
  };
  const restore = (part: string): string =>
    part
      .replace(TOKEN_PARAGRAPH_RE, (_m, digits: string) => {
        const token = lookup(digits);
        if (!token) return '';
        return token.block ? token.original : `<p>${token.original}</p>`;
      })
      .replace(TOKEN_RE, (_m, digits: string) => lookup(digits)?.original ?? '');
  const out = storage
    .split(CDATA_RE)
    .map((part, i) => (i % 2 === 1 ? part : restore(part)))
    .join('');
  return { storage: out, used, unknown };
}
