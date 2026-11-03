import { type AnyNode, type Document, type Element, isDocument, isTag, isText } from 'domhandler';
import { decodeHTML } from 'entities';
import type { Placeholder } from '../../core/placeholders.js';
import { textOf } from './dom.js';

/** A storage placeholder: `original` is the element's exact markup at `[start, end)` (end exclusive). */
export interface StoragePlaceholder extends Placeholder<string> {
  start: number;
  end: number;
}

/** Layout elements render as transparent containers and are never tokenised. */
export const LAYOUT_TAGS = new Set(['ac:layout', 'ac:layout-section', 'ac:layout-cell']);

const MACRO_TAGS = new Set(['ac:structured-macro', 'ac:macro']);
const PANEL_MACROS = new Set(['info', 'note', 'warning', 'tip', 'panel']);
const BLOCK_PARENTS = new Set(['ac:layout-cell', 'ac:rich-text-body', 'td', 'th', 'li', 'blockquote']);
const PANEL_TEXT_CHARS = 30;
const URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/[^\s[\]]+/gi;

function attr(el: Element, name: string): string {
  const value = el.attribs[name];
  return value === undefined ? '' : decodeHTML(value).replace(/\s+/g, ' ').trim();
}

function childTags(el: Element): Element[] {
  return el.children.filter(isTag);
}

function findTag(el: Element, test: (e: Element) => boolean): Element | undefined {
  for (const child of childTags(el)) {
    if (test(child)) return child;
    const deep = findTag(child, test);
    if (deep) return deep;
  }
  return undefined;
}

function param(el: Element, name: string): string {
  const p = childTags(el).find((c) => c.name === 'ac:parameter' && attr(c, 'ac:name') === name);
  return p ? textOf(p) : '';
}

/** A code macro the markdown view shows as a fenced block: a plain-text body and no parameter other than `language`. */
export function isPlainCodeMacro(el: Element): boolean {
  if (!MACRO_TAGS.has(el.name) || attr(el, 'ac:name') !== 'code') return false;
  if (el.children.some((c) => isText(c) && c.data.trim() !== '')) return false;
  const tags = childTags(el);
  const ok = (c: Element): boolean =>
    c.name === 'ac:plain-text-body' || (c.name === 'ac:parameter' && attr(c, 'ac:name') === 'language');
  return tags.every(ok) && tags.filter((c) => c.name === 'ac:plain-text-body').length === 1;
}

function isPlaceholderElement(el: Element): boolean {
  if (LAYOUT_TAGS.has(el.name) || isPlainCodeMacro(el)) return false;
  return el.name.startsWith('ac:') || el.name.startsWith('ri:') || el.name === 'time';
}

function hostOnly(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

function labelled(label: string, value: string): string {
  return value ? `${label}: ${value}` : label;
}

function rawHint(el: Element): string {
  if (MACRO_TAGS.has(el.name)) {
    const name = attr(el, 'ac:name');
    if (PANEL_MACROS.has(name)) {
      const body = childTags(el).find((c) => c.name === 'ac:rich-text-body');
      const text = body ? stripUrls(textOf(body)).slice(0, PANEL_TEXT_CHARS).trim() : '';
      return text ? `panel: ${name}, ${text}` : `panel: ${name}`;
    }
    if (name === 'status') return labelled('status', param(el, 'title'));
    return labelled('macro', name);
  }
  switch (el.name) {
    case 'ac:image': {
      const ref = findTag(el, (c) => c.name.startsWith('ri:') && (c.attribs['ri:filename'] !== undefined || c.attribs['ri:value'] !== undefined));
      return labelled('image', ref ? attr(ref, 'ri:filename') || attr(ref, 'ri:value') : '');
    }
    case 'ac:emoticon':
      return labelled('emoticon', attr(el, 'ac:name'));
    case 'ac:link': {
      const page = findTag(el, (c) => c.attribs['ri:content-title'] !== undefined);
      return labelled('link', (page && attr(page, 'ri:content-title')) || textOf(el));
    }
    case 'ac:task-list':
      return `tasks: ${childTags(el).filter((c) => c.name === 'ac:task').length}`;
    case 'ac:inline-comment-marker':
      return 'comment';
    case 'time':
      return labelled('date', attr(el, 'datetime'));
    default:
      return el.name;
  }
}

/** Replaces every URL with its host, so hints never carry a URL. */
function stripUrls(text: string): string {
  return text.replace(URL_RE, hostOnly);
}

function hintFor(el: Element): string {
  return stripUrls(rawHint(el))
    .replace(/[[\]\n]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isBlock(el: Element): boolean {
  const parent = el.parent;
  if (!parent || isDocument(parent)) return true;
  return isTag(parent) && BLOCK_PARENTS.has(parent.name);
}

/**
 * Every outermost element the markdown view cannot express, numbered 1..N in document order over the whole body.
 * `doc` must be `parseStorage(storage)`.
 */
export function collectStoragePlaceholders(storage: string, doc: Document): StoragePlaceholder[] {
  const out: StoragePlaceholder[] = [];
  const visit = (node: AnyNode): void => {
    if (!isTag(node)) return;
    if (isPlainCodeMacro(node)) return;
    if (isPlaceholderElement(node)) {
      if (node.startIndex === null || node.endIndex === null) throw new Error(`Element <${node.name}> has no source offsets; parse with parseStorage.`);
      const start = node.startIndex;
      const end = node.endIndex + 1;
      out.push({ n: out.length + 1, hint: hintFor(node), original: storage.slice(start, end), block: isBlock(node), start, end });
      return;
    }
    node.children.forEach(visit);
  };
  doc.children.forEach(visit);
  return out;
}
