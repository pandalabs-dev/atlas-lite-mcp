import type { Root } from 'mdast';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';

/** Markdown to an mdast tree with GFM (tables, strikethrough, autolinks, task lists, footnotes). */
export function parseMarkdown(md: string): Root {
  // Micromark recognizes unescaped autolinks. The additional text transform would
  // link escaped literals again after parsing, losing the user's original text marks.
  const extensions = gfmFromMarkdown().map((extension) =>
    extension.enter?.literalAutolink ? { ...extension, transforms: [] } : extension,
  );
  return fromMarkdown(md, { extensions: [gfm()], mdastExtensions: extensions });
}
