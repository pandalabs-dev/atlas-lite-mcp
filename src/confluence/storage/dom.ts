import { type AnyNode, type Document, type Element, hasChildren, isCDATA, isText } from 'domhandler';
import { decodeHTML } from 'entities';
import { parseDocument } from 'htmlparser2';

/**
 * Parses Confluence storage XHTML without changing it. Entities stay encoded so
 * every node's startIndex/endIndex (endIndex inclusive) maps onto the original string.
 */
export function parseStorage(storage: string): Document {
  return parseDocument(storage, {
    xmlMode: true,
    withStartIndices: true,
    withEndIndices: true,
    recognizeCDATA: true,
    decodeEntities: false,
  });
}

function rawText(node: AnyNode): string {
  if (isText(node)) return decodeHTML(node.data);
  // CDATA content is literal: collect its text children without entity decoding.
  if (isCDATA(node)) return node.children.map((c) => (isText(c) ? c.data : '')).join('');
  if (hasChildren(node)) return node.children.map(rawText).join('');
  return '';
}

/** All descendant text and CDATA, entities decoded, nbsp as space, whitespace collapsed and trimmed. */
export function textOf(node: AnyNode): string {
  return rawText(node).replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}

function startOf(el: Element): number {
  if (el.startIndex === null) throw new Error(`Element <${el.name}> has no source offset; parse with parseStorage.`);
  return el.startIndex;
}

/** Index just after the `>` that ends the element's opening tag, skipping `>` inside quoted attribute values. */
export function openTagEnd(src: string, el: Element): number {
  let quote = '';
  for (let i = startOf(el); i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '>') {
      return i + 1;
    }
  }
  throw new Error(`Opening tag of <${el.name}> is not terminated.`);
}

function isSelfClosing(src: string, tagEnd: number): boolean {
  return src[tagEnd - 2] === '/';
}

/** Source range of the element's content between its tags, or null when the element is self-closing. */
export function innerRange(src: string, el: Element): { start: number; end: number } | null {
  const start = openTagEnd(src, el);
  if (isSelfClosing(src, start)) return null;
  if (el.endIndex === null) throw new Error(`Element <${el.name}> has no end offset; parse with parseStorage.`);
  const end = src.lastIndexOf('</', el.endIndex);
  if (end < start) throw new Error(`Element <${el.name}> has no closing tag.`);
  return { start, end };
}

/** Source text of the element's opening tag; a self-closing `/>` becomes `>`. */
export function openTag(src: string, el: Element): string {
  const end = openTagEnd(src, el);
  const tag = src.slice(startOf(el), end);
  return isSelfClosing(src, end) ? tag.replace(/\s*\/>$/, '>') : tag;
}

/** Escapes text for use in XML content or a double-quoted attribute. */
export function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
