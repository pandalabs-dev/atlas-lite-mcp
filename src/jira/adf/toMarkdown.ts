import { type Placeholder, tokenText } from '../../core/placeholders.js';

export interface AdfMark {
  type: string;
  attrs?: Record<string, unknown>;
}

/** One Atlassian Document Format node. */
export interface AdfNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
  marks?: AdfMark[];
  text?: string;
}

/** A Jira description or comment body. */
export type AdfDoc = { type: 'doc'; version: 1; content: AdfNode[] };

/** An ADF placeholder: `original` is the node the token stands for. */
export type AdfPlaceholder = Placeholder<AdfNode>;

/** Unsupported nodes that stand on their own as blocks; any other unsupported node is inline unless it sits at block level. */
const BLOCK_TYPES = new Set([
  'mediaSingle',
  'mediaGroup',
  'panel',
  'blockCard',
  'embedCard',
  'expand',
  'nestedExpand',
  'extension',
  'bodiedExtension',
  'taskList',
  'decisionList',
  'layoutSection',
]);
/** Marks the markdown view renders, outermost first. `code` renders at the leaf. */
const RENDERED_MARKS = ['link', 'strong', 'em', 'strike'];
const SUPPORTED_MARKS = new Set([...RENDERED_MARKS, 'code']);
const EMPHASIS: Record<string, string> = { strong: '**', em: '*', strike: '~~' };
const PANEL_TEXT_CHARS = 30;
const URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/[^\s[\]]+/gi;
const HARD_BREAK = '\\\n';

function str(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
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

/** Plain text of a node; blocks are joined with a space. */
function textOf(node: AdfNode): string {
  if (node.type === 'text') return node.text ?? '';
  return (node.content ?? []).map(textOf).join(' ');
}

function findNode(node: AdfNode, test: (n: AdfNode) => boolean): AdfNode | undefined {
  if (test(node)) return node;
  for (const child of node.content ?? []) {
    const hit = findNode(child, test);
    if (hit) return hit;
  }
  return undefined;
}

function isoDate(timestamp: unknown): string {
  const ms = Number(timestamp);
  if (timestamp === undefined || timestamp === '' || !Number.isFinite(ms)) return '';
  return new Date(ms).toISOString().slice(0, 10);
}

function rawHint(node: AdfNode): string {
  const attrs = node.attrs ?? {};
  switch (node.type) {
    case 'mention':
      return labelled('mention', str(attrs.text));
    case 'media':
    case 'mediaInline':
    case 'mediaSingle':
    case 'mediaGroup': {
      const media = findNode(node, (n) => n.type === 'media' || n.type === 'mediaInline');
      return labelled('media', media ? str(media.attrs?.alt) || str(media.attrs?.id) : '');
    }
    case 'panel': {
      const text = stripUrls(textOf(node).replace(/\s+/g, ' ')).slice(0, PANEL_TEXT_CHARS).trim();
      const type = str(attrs.panelType);
      return [type ? `panel: ${type}` : 'panel', text].filter(Boolean).join(', ');
    }
    case 'inlineCard':
    case 'blockCard':
    case 'embedCard':
      return labelled('card', typeof attrs.url === 'string' ? hostOnly(attrs.url) : '');
    case 'emoji':
      return labelled('emoji', str(attrs.shortName));
    case 'status':
      return labelled('status', str(attrs.text));
    case 'date':
      return labelled('date', isoDate(attrs.timestamp));
    case 'table': {
      const rows = (node.content ?? []).filter((r) => r.type === 'tableRow');
      const cols = Math.max(0, ...rows.map((r) => (r.content ?? []).length));
      return `table: ${rows.length} rows x ${cols} cols`;
    }
    default:
      return node.type;
  }
}

/** Replaces every URL with its host, so hints never carry a URL. */
function stripUrls(text: string): string {
  return text.replace(URL_RE, hostOnly);
}

function hintFor(node: AdfNode): string {
  return stripUrls(rawHint(node))
    .replace(/[[\]\n]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeText(text: string): string {
  return text.replace(/[\\*_`[\]]/g, '\\$&');
}

function codeSpan(text: string): string {
  const body = text.replace(/\n/g, ' ');
  if (!body.includes('`')) return `\`${body}\``;
  const longest = Math.max(...(body.match(/`+/g) ?? ['']).map((r) => r.length));
  const ticks = '`'.repeat(longest + 1);
  return `${ticks} ${body} ${ticks}`;
}

function fence(lang: string, body: string): string {
  const longest = Math.max(0, ...(body.match(/`{3,}/g) ?? []).map((r) => r.length));
  const ticks = '`'.repeat(Math.max(3, longest + 1));
  return `${ticks}${lang}\n${body}\n${ticks}`;
}

/** Inline output with line breaks kept tight and no hard break at either edge. */
function tidyInline(text: string): string {
  return text
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

/**
 * A cell GFM can hold without loss: exactly one paragraph of text with rendered marks and inline tokens
 * (no hard breaks, which a table line cannot carry).
 */
function isInlineCell(cell: AdfNode): boolean {
  const [only, ...rest] = cell.content ?? [];
  if (!only || rest.length > 0 || only.type !== 'paragraph') return false;
  return (only.content ?? []).every((n) =>
    n.type === 'text' ? (n.marks ?? []).every((m) => SUPPORTED_MARKS.has(m.type)) : n.type !== 'hardBreak' && !BLOCK_TYPES.has(n.type),
  );
}

function sameMark(a: AdfMark, b: AdfMark): boolean {
  return a.type === b.type && JSON.stringify(a.attrs ?? {}) === JSON.stringify(b.attrs ?? {});
}

/** The rendered marks of a text node, outermost first; code text keeps only its link. */
function wrappable(node: AdfNode): AdfMark[] {
  if (node.type !== 'text') return [];
  const marks = node.marks ?? [];
  const allowed = marks.some((m) => m.type === 'code') ? ['link'] : RENDERED_MARKS;
  return marks.filter((m) => allowed.includes(m.type)).sort((a, b) => RENDERED_MARKS.indexOf(a.type) - RENDERED_MARKS.indexOf(b.type));
}

function wrap(mark: AdfMark, inner: string): string {
  if (mark.type === 'link') {
    const href = str(mark.attrs?.href);
    if (!href) return inner;
    const text = tidyInline(inner) || escapeText(href);
    return `[${text}](${/[\s()]/.test(href) ? `<${href}>` : href})`;
  }
  const delim = EMPHASIS[mark.type] ?? '';
  // Edge spaces and hard breaks move outside the mark: inside, they would break the emphasis.
  const lead = /^(?:\s|\\\n)*/.exec(inner)?.[0] ?? '';
  const trail = /(?:\s|\\\n)*$/.exec(inner.slice(lead.length))?.[0] ?? '';
  const core = inner.slice(lead.length, inner.length - trail.length);
  if (!core) return inner;
  return `${lead}${delim}${core}${delim}${trail}`;
}

class Renderer {
  readonly placeholders: AdfPlaceholder[] = [];

  constructor(private next: number) {}

  private token(node: AdfNode, block: boolean): string {
    const p: AdfPlaceholder = { n: this.next++, hint: hintFor(node), original: node, block };
    this.placeholders.push(p);
    return tokenText(p);
  }

  /** Renders a block-level node sequence as markdown blocks. */
  blocks(nodes: AdfNode[]): string[] {
    const out: string[] = [];
    for (const node of nodes) {
      const text = this.block(node);
      if (text) out.push(text);
    }
    return out;
  }

  private block(node: AdfNode): string {
    const content = node.content ?? [];
    switch (node.type) {
      case 'paragraph':
        return paragraph(this.inline(content));
      case 'heading': {
        const text = tidyInline(this.inline(content)).replaceAll(HARD_BREAK, ' ');
        const level = Math.min(6, Math.max(1, Number(node.attrs?.level) || 1));
        return text ? `${'#'.repeat(level)} ${text}` : '';
      }
      case 'bulletList':
      case 'orderedList':
        return this.list(node);
      case 'codeBlock':
        return fence(str(node.attrs?.language), content.map((c) => c.text ?? '').join(''));
      case 'blockquote': {
        const inner = this.blocks(content).join('\n\n');
        return inner ? inner.split('\n').map((line) => (line ? `> ${line}` : '>')).join('\n') : '';
      }
      case 'rule':
        return '---';
      case 'table':
        return this.table(node);
      default:
        return this.token(node, true);
    }
  }

  private list(node: AdfNode): string {
    const ordered = node.type === 'orderedList';
    const order = Number(node.attrs?.order);
    const start = Number.isInteger(order) && order >= 0 ? order : 1;
    const items: string[] = [];
    for (const li of node.content ?? []) {
      if (li.type !== 'listItem') continue;
      const marker = ordered ? `${start + items.length}. ` : '- ';
      let body = '';
      this.blocks(li.content ?? []).forEach((part, i) => {
        if (i > 0) body += /^(- |\d+\. )/.test(part) ? '\n' : '\n\n';
        body += part;
      });
      items.push(`${marker}${indent(body, marker.length)}`.trimEnd());
    }
    return items.join('\n');
  }

  /** GFM when every cell is a single inline paragraph; otherwise the whole table is one block token. */
  private table(node: AdfNode): string {
    const tableRows = (node.content ?? []).filter((r) => r.type === 'tableRow');
    if (!tableRows.every((r) => (r.content ?? []).every(isInlineCell))) return this.token(node, true);
    const rows = tableRows
      .map((r) =>
        (r.content ?? []).map((cell) =>
          this.blocks(cell.content ?? [])
            .join(' ')
            .replaceAll(HARD_BREAK, ' ')
            .replace(/\s*\n\s*/g, ' ')
            .replace(/\|/g, '\\|'),
        ),
      );
    const width = Math.max(0, ...rows.map((r) => r.length));
    if (width === 0) return '';
    const line = (cells: string[]): string => `| ${Array.from({ length: width }, (_, i) => cells[i] ?? '').join(' | ')} |`;
    const [head = [], ...body] = rows;
    return [line(head), line(Array(width).fill('---')), ...body.map(line)].join('\n');
  }

  /** Inline nodes; a run of text nodes sharing a mark is wrapped once, so `**a *b***` stays one emphasis. */
  private inline(nodes: AdfNode[], open: AdfMark[] = []): string {
    let out = '';
    let i = 0;
    while (i < nodes.length) {
      const node = nodes[i]!;
      const mark = wrappable(node).find((m) => !open.some((o) => sameMark(o, m)));
      if (!mark) {
        out += this.leaf(node);
        i++;
        continue;
      }
      let j = i + 1;
      while (j < nodes.length && wrappable(nodes[j]!).some((m) => sameMark(m, mark))) j++;
      out += wrap(mark, this.inline(nodes.slice(i, j), [...open, mark]));
      i = j;
    }
    return out;
  }

  private leaf(node: AdfNode): string {
    if (node.type === 'text') {
      const text = node.text ?? '';
      return node.marks?.some((m) => m.type === 'code') ? codeSpan(text) : escapeText(text.replace(/\n/g, ' '));
    }
    if (node.type === 'hardBreak') return HARD_BREAK;
    return this.token(node, BLOCK_TYPES.has(node.type));
  }
}

/**
 * ADF to markdown. Nodes the markdown view cannot express become `{{atlas:N}} [hint]` tokens numbered
 * from `startAt`, so a description and its comments can share one sequence.
 */
export function adfToMarkdown(
  doc: AdfDoc | AdfNode | null | undefined,
  startAt = 1,
): { markdown: string; placeholders: AdfPlaceholder[] } {
  if (!doc) return { markdown: '', placeholders: [] };
  const renderer = new Renderer(startAt);
  const nodes = doc.type === 'doc' ? (doc.content ?? []) : [doc];
  const markdown = renderer.blocks(nodes).join('\n\n');
  return { markdown, placeholders: renderer.placeholders };
}
