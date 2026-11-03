import type { List, ListItem, Nodes, PhrasingContent, RootContent, Table, TableRow } from 'mdast';
import { TOKEN_RE } from '../../core/placeholders.js';
import { parseMarkdown } from '../../markdown/parse.js';
import type { AdfDoc, AdfMark, AdfNode, AdfPlaceholder } from './toMarkdown.js';

/**
 * A token plus its optional hint in markdown source, as `TOKEN_RE`, except that a bracket followed by
 * `(` or `[` is a markdown link or reference link after a bare token, not a hint, and is kept.
 * Same rule as the Confluence write path (`confluence/storage/rewrite.ts`).
 */
const SOURCE_TOKEN_RE = /\{\{atlas:(\d+)\}\}(?: \[[^\]\n]*\](?![(\[]))?/g;

/**
 * Cuts the hint after every token outside code, so hint text never turns into links, emphasis or
 * code. Code spans and fenced blocks are literal and keep tokens and hints as written.
 */
function stripHints(md: string): string {
  if (!md.includes('{{atlas:')) return md;
  const code: [number, number][] = [];
  const walk = (node: Nodes): void => {
    if (node.type === 'code' || node.type === 'inlineCode') {
      code.push([node.position?.start.offset ?? 0, node.position?.end.offset ?? 0]);
    } else if ('children' in node) node.children.forEach(walk);
  };
  walk(parseMarkdown(md));
  return md.replace(SOURCE_TOKEN_RE, (match: string, digits: string, offset: number) =>
    code.some(([start, end]) => offset >= start && offset < end) ? match : `{{atlas:${digits}}}`,
  );
}

function definitions(tree: Nodes): Map<string, string> {
  const urls = new Map<string, string>();
  const walk = (node: Nodes): void => {
    if (node.type === 'definition') urls.set(node.identifier, node.url);
    if ('children' in node) node.children.forEach(walk);
  };
  walk(tree);
  return urls;
}

function para(content: AdfNode[]): AdfNode {
  return { type: 'paragraph', content };
}

function textNode(text: string, marks: AdfMark[]): AdfNode[] {
  if (!text) return [];
  return [marks.length ? { type: 'text', text, marks } : { type: 'text', text }];
}

function withMark(marks: AdfMark[], mark: AdfMark): AdfMark[] {
  return marks.some((m) => m.type === mark.type) ? marks : [...marks, mark];
}

function link(href: string): AdfMark {
  return { type: 'link', attrs: { href } };
}

function sameMarks(a: AdfMark[] = [], b: AdfMark[] = []): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Joins adjacent text nodes whose marks match. */
function merge(nodes: AdfNode[]): AdfNode[] {
  const out: AdfNode[] = [];
  for (const node of nodes) {
    const prev = out[out.length - 1];
    if (prev?.type === 'text' && node.type === 'text' && sameMarks(prev.marks, node.marks)) {
      out[out.length - 1] = { ...prev, text: `${prev.text ?? ''}${node.text ?? ''}` };
    } else out.push(node);
  }
  return out;
}

/** Merges text and trims whitespace at both edges of an inline run, dropping text left empty. */
function tidy(nodes: AdfNode[]): AdfNode[] {
  const out = merge(nodes);
  while (out[0]?.type === 'text') {
    const text = (out[0].text ?? '').trimStart();
    if (text) {
      out[0] = { ...out[0], text };
      break;
    }
    out.shift();
  }
  while (out[out.length - 1]?.type === 'text') {
    const last = out[out.length - 1]!;
    const text = (last.text ?? '').trimEnd();
    if (text) {
      out[out.length - 1] = { ...last, text };
      break;
    }
    out.pop();
  }
  return out;
}

class Emitter {
  constructor(private readonly urls: Map<string, string>) {}

  /** Flow content. `nested` (list items, quotes) turns headings into paragraphs and flattens quotes, as ADF requires. */
  blocks(nodes: RootContent[], nested: boolean): AdfNode[] {
    return nodes.flatMap((n) => this.block(n, nested));
  }

  private block(node: RootContent, nested: boolean): AdfNode[] {
    switch (node.type) {
      case 'heading': {
        const content = this.inline(node.children);
        return [nested ? para(content) : { type: 'heading', attrs: { level: node.depth }, content }];
      }
      case 'paragraph':
        return [para(this.inline(node.children))];
      case 'list':
        return [this.list(node)];
      case 'blockquote': {
        const content = this.blocks(node.children, true);
        return nested ? content : [{ type: 'blockquote', content: content.length ? content : [para([])] }];
      }
      case 'thematicBreak':
        return [{ type: 'rule' }];
      case 'code':
        return [{ type: 'codeBlock', ...(node.lang ? { attrs: { language: node.lang } } : {}), content: textNode(node.value, []) }];
      case 'table':
        return [this.table(node)];
      case 'html':
        // Raw HTML is never passed through: it becomes visible text.
        return [para(textNode(node.value, []))];
      case 'footnoteDefinition':
        return this.blocks(node.children, nested);
      default:
        return [];
    }
  }

  private list(node: List): AdfNode {
    const content = node.children.map((li) => this.listItem(li));
    if (!node.ordered) return { type: 'bulletList', content };
    const start = typeof node.start === 'number' && node.start !== 1 ? { attrs: { order: node.start } } : {};
    return { type: 'orderedList', ...start, content };
  }

  /** A list item always starts with a paragraph; a task box becomes `[ ] ` or `[x] ` text. */
  private listItem(li: ListItem): AdfNode {
    const content = this.blocks(li.children, true);
    if (content[0]?.type !== 'paragraph') content.unshift(para([]));
    if (typeof li.checked === 'boolean') {
      const first = content[0]!;
      content[0] = para(merge([...textNode(li.checked ? '[x] ' : '[ ] ', []), ...(first.content ?? [])]));
    }
    return { type: 'listItem', content };
  }

  private table(node: Table): AdfNode {
    const [head, ...body] = node.children;
    const rows = head ? [this.row(head, 'tableHeader'), ...body.map((r) => this.row(r, 'tableCell'))] : [];
    return { type: 'table', content: rows };
  }

  private row(row: TableRow, cell: 'tableHeader' | 'tableCell'): AdfNode {
    return { type: 'tableRow', content: row.children.map((c) => ({ type: cell, content: [para(this.inline(c.children))] })) };
  }

  private inline(nodes: PhrasingContent[], marks: AdfMark[] = []): AdfNode[] {
    return merge(nodes.flatMap((n) => this.phrase(n, marks)));
  }

  private phrase(node: PhrasingContent, marks: AdfMark[]): AdfNode[] {
    switch (node.type) {
      case 'text':
        // Soft line breaks become spaces.
        return textNode(node.value.replace(/\n/g, ' '), marks);
      case 'strong':
        return this.inline(node.children, withMark(marks, { type: 'strong' }));
      case 'emphasis':
        return this.inline(node.children, withMark(marks, { type: 'em' }));
      case 'delete':
        return this.inline(node.children, withMark(marks, { type: 'strike' }));
      case 'inlineCode':
        // The code mark combines with links only.
        return textNode(node.value, [...marks.filter((m) => m.type === 'link'), { type: 'code' }]);
      case 'break':
        return [{ type: 'hardBreak' }];
      case 'link':
        return this.inline(node.children, withMark(marks, link(node.url)));
      case 'image':
        return textNode(node.alt || node.url, withMark(marks, link(node.url)));
      case 'linkReference': {
        const url = this.urls.get(node.identifier);
        return this.inline(node.children, url === undefined ? marks : withMark(marks, link(url)));
      }
      case 'imageReference': {
        const url = this.urls.get(node.identifier);
        const alt = node.alt ?? '';
        return url === undefined ? textNode(alt, marks) : textNode(alt || url, withMark(marks, link(url)));
      }
      case 'footnoteReference':
        return textNode(`[^${node.label ?? node.identifier}]`, marks);
      case 'html':
        return textNode(node.value, marks);
      default:
        return [];
    }
  }
}

type Segment = AdfNode | { token: number };

const isToken = (s: Segment): s is { token: number } => 'token' in s;

/** Swaps tokens in the produced tree back for their original ADF nodes. */
class Restorer {
  readonly used = new Set<number>();
  readonly unknown: number[] = [];

  constructor(private readonly tokens: Map<number, AdfPlaceholder>) {}

  private lookup(n: number): AdfPlaceholder | undefined {
    const token = this.tokens.get(n);
    if (token) this.used.add(n);
    else if (!this.unknown.includes(n)) this.unknown.push(n);
    return token;
  }

  children(nodes: AdfNode[]): AdfNode[] {
    return nodes.flatMap((node) => this.child(node));
  }

  private child(node: AdfNode): AdfNode[] {
    if (node.type === 'paragraph') return this.paragraph(node);
    if (node.type === 'heading') return this.heading(node);
    if (node.type === 'codeBlock' || !node.content) return [node];
    const content = this.children(node.content);
    return [{ ...node, content: content.length ? content : [para([])] }];
  }

  /** Text nodes split on tokens; code text is literal. Null when the run holds no token. */
  private segments(nodes: AdfNode[]): Segment[] | null {
    const out: Segment[] = [];
    let found = false;
    for (const node of nodes) {
      const text = node.text ?? '';
      if (node.type !== 'text' || node.marks?.some((m) => m.type === 'code')) {
        out.push(node);
        continue;
      }
      let last = 0;
      for (const m of text.matchAll(TOKEN_RE)) {
        found = true;
        if (m.index > last) out.push({ ...node, text: text.slice(last, m.index) });
        out.push({ token: Number(m[1]) });
        last = m.index + m[0].length;
      }
      if (last === 0) out.push(node);
      else if (last < text.length) out.push({ ...node, text: text.slice(last) });
    }
    return found ? out : null;
  }

  /**
   * A paragraph holding only a token becomes the original when it is a block, else a paragraph around it.
   * Otherwise inline originals go in place (surrounding marks dropped) and a block original splits the
   * paragraph into the text before it, the original and the text after it. Unknown tokens are removed.
   */
  private paragraph(node: AdfNode): AdfNode[] {
    const segs = this.segments(node.content ?? []);
    if (!segs) return [node];
    const meaningful = segs.filter((s) => isToken(s) || s.type !== 'text' || (s.text ?? '').trim() !== '');
    const only = meaningful.length === 1 ? meaningful[0]! : undefined;
    if (only && isToken(only)) {
      const token = this.lookup(only.token);
      if (!token) return [];
      return token.block ? [token.original] : [{ ...node, content: [token.original] }];
    }
    const out: AdfNode[] = [];
    let run: AdfNode[] = [];
    const flush = (): void => {
      const content = tidy(run);
      if (content.length) out.push({ ...node, content });
      run = [];
    };
    for (const s of segs) {
      if (!isToken(s)) {
        run.push(s);
        continue;
      }
      const token = this.lookup(s.token);
      if (!token) continue;
      if (token.block) {
        flush();
        out.push(token.original);
      } else run.push(token.original);
    }
    flush();
    return out;
  }

  /** Inline originals go in place; block originals cannot live in a heading and follow it. */
  private heading(node: AdfNode): AdfNode[] {
    const segs = this.segments(node.content ?? []);
    if (!segs) return [node];
    const content: AdfNode[] = [];
    const after: AdfNode[] = [];
    for (const s of segs) {
      if (!isToken(s)) {
        content.push(s);
        continue;
      }
      const token = this.lookup(s.token);
      if (token) (token.block ? after : content).push(token.original);
    }
    return [{ ...node, content: tidy(content) }, ...after];
  }
}

/**
 * Markdown (GFM) to an ADF document. `{{atlas:N}}` tokens are swapped back for the original nodes in
 * `tokens` (hints after them are ignored); `used` lists the restored numbers and `unknown` the numbers
 * not in the map, which are left out.
 */
export function markdownToAdf(
  md: string,
  tokens: Map<number, AdfPlaceholder> = new Map(),
): { doc: AdfDoc; used: Set<number>; unknown: number[] } {
  const tree = parseMarkdown(stripHints(md));
  const content = new Emitter(definitions(tree)).blocks(tree.children, false);
  const restorer = new Restorer(tokens);
  return { doc: { type: 'doc', version: 1, content: restorer.children(content) }, used: restorer.used, unknown: restorer.unknown };
}
