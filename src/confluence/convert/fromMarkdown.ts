import type { Nodes, Root, TableRow } from 'mdast';
import { parseMarkdown } from '../../markdown/parse.js';
import { escapeXml } from '../storage/dom.js';

/** Soft line breaks render as spaces; text is XML-escaped. */
function text(value: string): string {
  return escapeXml(value.replace(/\n/g, ' '));
}

/** A CDATA section; `]]>` in the body is split across two sections. */
function cdata(body: string): string {
  return `<![CDATA[${body.replaceAll(']]>', ']]]]><![CDATA[>')}]]>`;
}

function definitions(tree: Root): Map<string, string> {
  const urls = new Map<string, string>();
  const walk = (node: Nodes): void => {
    if (node.type === 'definition') urls.set(node.identifier, node.url);
    if ('children' in node) node.children.forEach(walk);
  };
  walk(tree);
  return urls;
}

class Emitter {
  constructor(private readonly urls: Map<string, string>) {}

  all(nodes: Nodes[]): string {
    return nodes.map((n) => this.node(n)).join('');
  }

  /** Flow content: raw HTML at block level becomes a paragraph of visible text. */
  blocks(nodes: Nodes[]): string {
    return nodes.map((n) => (n.type === 'html' ? `<p>${text(n.value)}</p>` : this.node(n))).join('');
  }

  private link(url: string, inner: string): string {
    return `<a href="${escapeXml(url)}">${inner}</a>`;
  }

  private row(row: TableRow, cell: 'th' | 'td'): string {
    const cells = row.children.map((c) => {
      const inner = this.all(c.children);
      return `<${cell}>${inner ? `<p>${inner}</p>` : '<p/>'}</${cell}>`;
    });
    return `<tr>${cells.join('')}</tr>`;
  }

  node(node: Nodes): string {
    switch (node.type) {
      case 'root':
        return this.blocks(node.children);
      case 'heading':
        return `<h${node.depth}>${this.all(node.children)}</h${node.depth}>`;
      case 'paragraph':
        return `<p>${this.all(node.children)}</p>`;
      case 'list': {
        const tag = node.ordered ? 'ol' : 'ul';
        return `<${tag}>${this.all(node.children)}</${tag}>`;
      }
      case 'listItem': {
        const box = typeof node.checked === 'boolean' ? (node.checked ? '[x] ' : '[ ] ') : '';
        const [first, ...rest] = node.children;
        if (box && first?.type === 'paragraph') return `<li><p>${box}${this.all(first.children)}</p>${this.blocks(rest)}</li>`;
        return `<li>${this.blocks(node.children)}</li>`;
      }
      case 'blockquote':
        return `<blockquote>${this.blocks(node.children)}</blockquote>`;
      case 'thematicBreak':
        return '<hr/>';
      case 'code': {
        const lang = node.lang ? `<ac:parameter ac:name="language">${escapeXml(node.lang)}</ac:parameter>` : '';
        return `<ac:structured-macro ac:name="code">${lang}<ac:plain-text-body>${cdata(node.value)}</ac:plain-text-body></ac:structured-macro>`;
      }
      case 'table': {
        const [head, ...body] = node.children;
        const rows = head ? [this.row(head, 'th'), ...body.map((r) => this.row(r, 'td'))] : [];
        return `<table><tbody>${rows.join('')}</tbody></table>`;
      }
      case 'html':
        // Raw HTML is never passed through: it becomes visible text.
        return text(node.value);
      case 'text':
        return text(node.value);
      case 'strong':
        return `<strong>${this.all(node.children)}</strong>`;
      case 'emphasis':
        return `<em>${this.all(node.children)}</em>`;
      case 'delete':
        return `<s>${this.all(node.children)}</s>`;
      case 'inlineCode':
        return `<code>${text(node.value)}</code>`;
      case 'break':
        return '<br/>';
      case 'link':
        return this.link(node.url, this.all(node.children));
      case 'image':
        return this.link(node.url, text(node.alt || node.url));
      case 'linkReference': {
        const url = this.urls.get(node.identifier);
        const inner = this.all(node.children);
        return url === undefined ? inner : this.link(url, inner);
      }
      case 'imageReference': {
        const url = this.urls.get(node.identifier);
        const alt = text(node.alt ?? '');
        return url === undefined ? alt : this.link(url, alt || text(url));
      }
      case 'footnoteReference':
        return text(`[^${node.label ?? node.identifier}]`);
      case 'footnoteDefinition':
        return this.blocks(node.children);
      case 'definition':
      case 'yaml':
        return '';
      default:
        // Table rows and cells render through their table.
        return this.all(node.children);
    }
  }
}

/**
 * Markdown (GFM) to clean Confluence storage XHTML, with no newlines between elements.
 * Fenced code becomes a code macro with a CDATA body; raw HTML is escaped as text.
 */
export function markdownToStorage(md: string): string {
  const tree = parseMarkdown(md);
  return new Emitter(definitions(tree)).node(tree);
}
