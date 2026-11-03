import { TOKEN_RE } from '../../core/placeholders.js';
import { markdownToStorage } from '../convert/fromMarkdown.js';
import { parseStorage } from './dom.js';
import type { StoragePlaceholder } from './placeholders.js';
import { restoreStorageTokens } from './restore.js';
import { findSection } from './sections.js';

/**
 * Converts markdown written by the model to storage with its tokens restored. Hints are cut from the
 * markdown before parsing, so hint text never turns into links, emphasis or code (whatever it holds).
 */
function convert(markdown: string, placeholders: Map<number, StoragePlaceholder>): ReturnType<typeof restoreStorageTokens> {
  const bare = markdown.replace(TOKEN_RE, (_m, digits: string) => `{{atlas:${digits}}}`);
  return restoreStorageTokens(markdownToStorage(bare), placeholders);
}

/**
 * Replaces the content under `heading` (the heading element itself is kept) with converted markdown,
 * splicing the original storage string so every byte outside the section stays as it was.
 * `placeholders` is the page-wide map for this exact storage version. `dropped` lists the section's
 * placeholders whose tokens are missing from `markdown`; `unknown` lists token numbers not in the map.
 */
export function replaceSection(
  storage: string,
  heading: string,
  markdown: string,
  placeholders: Map<number, StoragePlaceholder>,
): { storage: string; dropped: StoragePlaceholder[]; unknown: number[] } {
  const { start, end } = findSection(storage, parseStorage(storage), heading);
  const { storage: content, used, unknown } = convert(markdown, placeholders);
  const dropped = [...placeholders.values()]
    .filter((p) => p.start >= start && p.start < end && !used.has(p.n))
    .sort((a, b) => a.n - b.n);
  return { storage: storage.slice(0, start) + content + storage.slice(end), dropped, unknown };
}

/** Appends converted markdown at the end of the body, restoring tokens copied from the page. */
export function appendMarkdown(
  storage: string,
  markdown: string,
  placeholders: Map<number, StoragePlaceholder>,
): { storage: string; unknown: number[] } {
  const { storage: content, unknown } = convert(markdown, placeholders);
  return { storage: storage + content, unknown };
}
