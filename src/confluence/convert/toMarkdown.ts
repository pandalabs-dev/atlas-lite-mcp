import { type AnyNode, type Element, isCDATA, isTag, isText } from 'domhandler';
import { decodeHTML } from 'entities';
import { tokenText } from '../../core/placeholders.js';
import { parseStorage, rawText, textOf } from '../storage/dom.js';
import { collectStoragePlaceholders, isPlainCodeMacro, LAYOUT_TAGS, type StoragePlaceholder } from '../storage/placeholders.js';

type Range = { start: number; end: number };

const INLINE_MARKS: Record<string, string> = { strong: '**', b: '**', em: '*', i: '*', s: '~~', del: '~~' };
const INLINE_TAGS = new Set(['code', 'a', 'br', ...Object.keys(INLINE_MARKS)]);
const BLOCK_TAGS = new Set(['p', 'ul', 'ol', 'table', 'pre', 'blockquote', 'hr']);
const HEADING_RE = /^h([1-6])$/;

/** Decoded text with nbsp as a space and whitespace runs collapsed (not trimmed). */
function normalise(text: string): string {
  return decodeHTML(text).replace(/\s+/g, ' ');
}

function escapeText(text: string): string {
  return text.replace(/[\\*_`[\]]/g, '\\$&');
}

function codeSpan(text: string): string {
  if (!text.includes('`')) return `\`${text}\``;
  const longest = Math.max(...(text.match(/`+/g) ?? ['']).map((r) => r.length));
  const ticks = '`'.repeat(longest + 1);
  return `${ticks} ${text} ${ticks}`;
}

function fence(lang: string, body: string): string {
  const longest = Math.max(0, ...(body.match(/`{3,}/g) ?? []).map((r) => r.length));
  const ticks = '`'.repeat(Math.max(3, longest + 1));
  return `${ticks}${lang}\n${body}\n${ticks}`;
}

const HARD_BREAK = '\\\n';

/** Inline output with whitespace collapsed, line breaks kept tight and no hard break at either edge. */
function tidyInline(text: string): string {
  return text
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/^\s*(?:\\\n\s*)+|(?:\s*\\\n)+\s*$/g, '')
    .trim();
}

/**
 * Escapes text at the start of a paragraph line (paragraph start or after a hard break) that would
 * otherwise parse as a heading, list item, blockquote, thematic break or setext underline.
 */
function escapeLineStart(line: string): string {
  if (/^(?:#{1,6}|[-+]|=+|-+)(?:\s|\\?$)/.test(line) || line.startsWith('>')) return `\\${line}`;
  return line.replace(/^(\d+)([.)])(?=\s|$)/, '$1\\$2');
}

function paragraph(text: string): string {
  return tidyInline(text).split('\n').map(escapeLineStart).join('\n');
}

function indent(text: string, by: number): string {
  const pad = ' '.repeat(by);
  return text
    .split('\n')
    .map((line, i) => (i === 0 || line === '' ? line : pad + line))
    .join('\n');
}

class Renderer {
  private readonly tokens: Map<number, StoragePlaceholder>;

  constructor(
    private readonly src: string,
    placeholders: StoragePlaceholder[],
    private readonly within: Range | undefined,
  ) {
    this.tokens = new Map(placeholders.map((p) => [p.start, p] as const));
  }

  private span(node: AnyNode): Range {
    return { start: node.startIndex ?? 0, end: (node.endIndex ?? this.src.length - 1) + 1 };
  }

  /** 'out' skips the node, 'in' renders it, 'partial' descends into its children (tokens and code macros render whole). */
  private overlap(node: AnyNode): 'in' | 'out' | 'partial' {
    if (!this.within) return 'in';
    const { start, end } = this.span(node);
    if (end <= this.within.start || start >= this.within.end) return 'out';
    if (start >= this.within.start && end <= this.within.end) return 'in';
    return isTag(node) && (this.token(node) || isPlainCodeMacro(node)) ? 'in' : 'partial';
  }

  private token(el: Element): StoragePlaceholder | undefined {
    return el.startIndex === null ? undefined : this.tokens.get(el.startIndex);
  }

  private isBlockElement(el: Element): boolean {
    const token = this.token(el);
    if (token) return token.block;
    return BLOCK_TAGS.has(el.name) || HEADING_RE.test(el.name) || LAYOUT_TAGS.has(el.name) || isPlainCodeMacro(el);
  }

  /** Unknown elements have no markdown form of their own: their children join the surrounding flow. */
  private isTransparent(el: Element): boolean {
    return !this.token(el) && !isPlainCodeMacro(el) && !INLINE_TAGS.has(el.name) && !this.isBlockElement(el);
  }

  /** Renders a node sequence as markdown blocks; inline runs between blocks become paragraphs. */
  blocks(nodes: AnyNode[]): string[] {
    const out: string[] = [];
    let inline = '';
    const flush = (): void => {
      const text = paragraph(inline);
      if (text) out.push(text);
      inline = '';
    };
    const walk = (list: AnyNode[]): void => {
      for (const node of list) {
        const where = this.overlap(node);
        if (where === 'out') continue;
        if (isTag(node) && where === 'partial') {
          const block = this.isBlockElement(node);
          if (block) flush();
          walk(node.children);
          if (block) flush();
        } else if (isTag(node) && this.isBlockElement(node)) {
          flush();
          out.push(...this.block(node));
        } else if (isTag(node) && this.isTransparent(node)) {
          walk(node.children);
        } else {
          inline += this.inline(node);
        }
      }
    };
    walk(nodes);
    flush();
    return out;
  }

  private block(el: Element): string[] {
    const token = this.token(el);
    if (token) return [tokenText(token)];
    if (isPlainCodeMacro(el)) return [this.codeMacro(el)];
    const heading = HEADING_RE.exec(el.name);
    if (heading) {
      const text = tidyInline(this.inlineChildren(el));
      return text ? [`${'#'.repeat(Number(heading[1]))} ${text}`] : [];
    }
    switch (el.name) {
      case 'p': {
        const text = paragraph(this.inlineChildren(el));
        return text ? [text] : [];
      }
      case 'ul':
      case 'ol':
        return [this.list(el)].filter((s) => s !== '');
      case 'table':
        return [this.table(el)].filter((s) => s !== '');
      case 'pre':
        return [fence('', rawText(el).replace(/\n$/, ''))];
      case 'blockquote': {
        const inner = this.blocks(el.children).join('\n\n');
        return inner ? [inner.split('\n').map((line) => (line ? `> ${line}` : '>')).join('\n')] : [];
      }
      case 'hr':
        return ['---'];
      default:
        // Layout containers: children render as blocks, so cells end up separated by a blank line.
        return this.blocks(el.children);
    }
  }

  private codeMacro(el: Element): string {
    const tags = el.children.filter(isTag);
    const lang = tags.find((c) => c.name === 'ac:parameter');
    const body = tags.find((c) => c.name === 'ac:plain-text-body');
    return fence(lang ? textOf(lang) : '', body ? rawText(body) : '');
  }

  private list(el: Element): string {
    const ordered = el.name === 'ol';
    const items: string[] = [];
    for (const li of el.children) {
      if (!isTag(li) || li.name !== 'li' || this.overlap(li) === 'out') continue;
      const marker = ordered ? `${items.length + 1}. ` : '- ';
      const parts = this.blocks(li.children);
      let body = '';
      parts.forEach((part, i) => {
        if (i > 0) body += /^(- |\d+\. )/.test(part) ? '\n' : '\n\n';
        body += part;
      });
      items.push(`${marker}${indent(body, marker.length)}`.trimEnd());
    }
    return items.join('\n');
  }

  private rows(el: Element): Element[] {
    const out: Element[] = [];
    for (const child of el.children) {
      if (!isTag(child) || this.overlap(child) === 'out') continue;
      if (child.name === 'tr') out.push(child);
      else if (child.name !== 'table') out.push(...this.rows(child));
    }
    return out;
  }

  private table(el: Element): string {
    const rows = this.rows(el).map((tr) =>
      tr.children
        .filter((c): c is Element => isTag(c) && (c.name === 'th' || c.name === 'td') && this.overlap(c) !== 'out')
        .map((cell) => this.blocks(cell.children).join(' ').replaceAll(HARD_BREAK, ' ').replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|')),
    );
    const width = Math.max(0, ...rows.map((r) => r.length));
    if (width === 0) return '';
    const line = (cells: string[]): string => `| ${Array.from({ length: width }, (_, i) => cells[i] ?? '').join(' | ')} |`;
    const [head = [], ...body] = rows;
    return [line(head), line(Array(width).fill('---')), ...body.map(line)].join('\n');
  }

  private inlineChildren(el: Element): string {
    let out = '';
    for (const child of el.children) {
      const where = this.overlap(child);
      if (where === 'out') continue;
      out += where === 'partial' && isTag(child) ? this.inlineChildren(child) : this.inline(child);
    }
    return out;
  }

  private inline(node: AnyNode): string {
    if (isText(node)) return escapeText(normalise(this.clippedText(node)));
    if (isCDATA(node)) return escapeText(rawText(node));
    if (!isTag(node)) return '';
    const token = this.token(node);
    if (token) return tokenText(token);
    const mark = INLINE_MARKS[node.name];
    if (mark) {
      const inner = this.inlineChildren(node).replace(/[ \t]+/g, ' ');
      const core = inner.trim();
      if (!core) return inner;
      const lead = inner.startsWith(' ') ? ' ' : '';
      const trail = inner.endsWith(' ') ? ' ' : '';
      return `${lead}${mark}${core}${mark}${trail}`;
    }
    switch (node.name) {
      case 'code': {
        const text = textOf(node);
        return text ? codeSpan(text) : '';
      }
      case 'a': {
        const text = tidyInline(this.inlineChildren(node));
        const href = node.attribs.href === undefined ? '' : decodeHTML(node.attribs.href).trim();
        if (!href) return text;
        return `[${text || escapeText(href)}](${/[\s()]/.test(href) ? `<${href}>` : href})`;
      }
      case 'br':
        return HARD_BREAK;
      default:
        return this.inlineChildren(node);
    }
  }

  /** Text of a node, cut to the range when the node straddles it. */
  private clippedText(node: AnyNode & { data: string }): string {
    if (!this.within || this.overlap(node) !== 'partial') return node.data;
    const { start } = this.span(node);
    return node.data.slice(Math.max(0, this.within.start - start), this.within.end - start);
  }
}

/**
 * Confluence storage to markdown. Content markdown cannot express becomes `{{atlas:N}} [hint]` tokens.
 * With `within`, only nodes inside that source range render; `placeholders` always cover the whole body,
 * so a section view shows the same numbers as the full page.
 */
export function storageToMarkdown(
  storage: string,
  opts?: { within?: { start: number; end: number } },
): { markdown: string; placeholders: StoragePlaceholder[] } {
  const doc = parseStorage(storage);
  const placeholders = collectStoragePlaceholders(storage, doc);
  const markdown = new Renderer(storage, placeholders, opts?.within).blocks(doc.children).join('\n\n');
  return { markdown, placeholders };
}
