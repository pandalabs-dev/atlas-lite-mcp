import { XMLValidator } from 'fast-xml-parser';
import { AtlasError } from '../../core/errors.js';
import { escapeXml } from './dom.js';

const CONTEXT = 30;
const MAX_CONTEXTS = 3;

/** Start offsets of non-overlapping literal occurrences of `find`. */
function occurrences(storage: string, find: string): number[] {
  const out: number[] = [];
  for (let i = storage.indexOf(find); i !== -1; i = storage.indexOf(find, i + find.length)) out.push(i);
  return out;
}

function context(storage: string, at: number, length: number): string {
  const from = Math.max(0, at - CONTEXT);
  const to = Math.min(storage.length, at + length + CONTEXT);
  const body = storage.slice(from, to).replace(/\s*\n\s*/g, ' ');
  return `${from > 0 ? '...' : ''}${body}${to < storage.length ? '...' : ''}`;
}

/**
 * Exact find and replace on a storage string. Without `all` exactly one match is required.
 * When the literal text misses but its XML-escaped form matches, both find and replace are escaped.
 * Everything outside the matched spans stays byte-identical.
 */
export function findReplace(
  storage: string,
  find: string,
  replace: string,
  all: boolean,
): { storage: string; count: number } {
  if (find === '') throw new AtlasError('find must not be empty.');
  let needle = find;
  let replacement = replace;
  let hits = occurrences(storage, needle);
  if (hits.length === 0) {
    const escaped = escapeXml(find);
    if (escaped !== find) {
      const escapedHits = occurrences(storage, escaped);
      if (escapedHits.length > 0) {
        needle = escaped;
        replacement = escapeXml(replace);
        hits = escapedHits;
      }
    }
  }
  if (hits.length === 0) {
    throw new AtlasError(
      'No match for the find text. Text seen in markdown may be split by inline markup or entities; call page_get with format "storage" or a section to copy the exact markup.',
    );
  }
  if (hits.length > 1 && !all) {
    const shown = hits
      .slice(0, MAX_CONTEXTS)
      .map((at) => `"${context(storage, at, needle.length)}"`)
      .join(', ');
    throw new AtlasError(`Found ${hits.length} matches; pass all: true or use a longer find text. Matches: ${shown}`);
  }
  let out = '';
  let last = 0;
  for (const at of hits) {
    out += storage.slice(last, at) + replacement;
    last = at + needle.length;
  }
  out += storage.slice(last);
  return { storage: out, count: hits.length };
}

/** Throws unless the storage string is well-formed XML (checked inside a synthetic root element). */
export function assertWellFormed(storage: string): void {
  const result = XMLValidator.validate(`<r>${storage}</r>`);
  if (result === true) return;
  const reason = result.err.msg.replace(/\s+/g, ' ').trim().replace(/\.$/, '');
  throw new AtlasError(`Edit would produce malformed XML (${reason}); nothing was written.`);
}
