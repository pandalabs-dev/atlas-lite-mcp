import { type AnyNode, type Document, type Element, hasChildren, isDocument, isTag } from 'domhandler';
import { AtlasError } from '../../core/errors.js';
import { innerRange, parseStorage, textOf } from './dom.js';

/** A heading element with its level (1 to 6) and its decoded, whitespace-collapsed text. */
export interface Heading {
  level: number;
  text: string;
  el: Element;
}

const HEADING_RE = /^h([1-6])$/;
const MAX_CANDIDATES = 5;

function headingLevel(el: Element): number | null {
  const m = HEADING_RE.exec(el.name);
  return m ? Number(m[1]) : null;
}

function elementsIn(node: AnyNode): Element[] {
  const out: Element[] = [];
  const walk = (n: AnyNode): void => {
    if (isTag(n)) out.push(n);
    if (hasChildren(n)) for (const c of n.children) walk(c);
  };
  walk(node);
  return out;
}

/** Every heading in document order, at any depth. */
export function listHeadings(doc: Document): Heading[] {
  const out: Heading[] = [];
  for (const el of elementsIn(doc)) {
    const level = headingLevel(el);
    if (level !== null) out.push({ level, text: textOf(el), el });
  }
  return out;
}

function normalize(text: string): string {
  return text.replace(/ /g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** True when `el` is, or contains, a heading of level `level` or higher (numerically at most `level`). */
function holdsHeadingAtMost(el: Element, level: number): boolean {
  return elementsIn(el).some((e) => {
    const l = headingLevel(e);
    return l !== null && l <= level;
  });
}

function listNames(names: string[]): string {
  const shown = names.slice(0, MAX_CANDIDATES).join(', ');
  return names.length > MAX_CANDIDATES ? `${shown} (and ${names.length - MAX_CANDIDATES} more)` : shown;
}

/**
 * Locates the section under `heading` (trimmed, case-insensitive, entity-decoded match).
 * `start` is just after the heading element; `end` (exclusive) is the next sibling that is or holds a
 * heading of the same or higher level, else the end of the containing element (layout cell, macro
 * body) or of the document, so a section never cuts across a container.
 */
export function findSection(
  storage: string,
  doc: Document,
  heading: string,
): { heading: Heading; start: number; end: number } {
  const headings = listHeadings(doc);
  const wanted = normalize(heading);
  const matches = headings.filter((h) => h.text.toLowerCase() === wanted);
  if (matches.length === 0) {
    const available = headings.length ? `Headings: ${headings.map((h) => h.text).join(', ')}.` : 'The page has no headings.';
    throw new AtlasError(`No heading "${heading}". ${available}`);
  }
  if (matches.length > 1) {
    throw new AtlasError(
      `Heading "${heading}" matches ${matches.length} headings: ${listNames(matches.map((h) => h.text))}; use page_edit or make the heading unique.`,
    );
  }
  const match = matches[0]!;
  const { el, level } = match;
  if (el.endIndex === null) throw new Error(`Heading <${el.name}> has no end offset; parse with parseStorage.`);
  const start = el.endIndex + 1;
  const parent = el.parent;
  if (!parent) throw new Error(`Heading <${el.name}> has no parent; parse with parseStorage.`);
  const siblings = parent.children;
  for (let i = siblings.indexOf(el) + 1; i < siblings.length; i++) {
    const sib = siblings[i]!;
    if (isTag(sib) && holdsHeadingAtMost(sib, level)) {
      if (sib.startIndex === null) throw new Error(`Element <${sib.name}> has no source offset; parse with parseStorage.`);
      return { heading: match, start, end: sib.startIndex };
    }
  }
  if (isDocument(parent)) return { heading: match, start, end: storage.length };
  const inner = isTag(parent) ? innerRange(storage, parent) : null;
  if (!inner) throw new Error('The heading container has no closing tag.');
  return { heading: match, start, end: inner.end };
}

function ownRows(table: Element): Element[] {
  const rows: Element[] = [];
  const walk = (el: Element): void => {
    for (const c of el.children) {
      if (!isTag(c) || c.name === 'table') continue;
      if (c.name === 'tr') rows.push(c);
      walk(c);
    }
  };
  walk(table);
  return rows;
}

/** Number of `tr` elements whose nearest `table` ancestor is `table`, header row included. */
export function rowCount(table: Element): number {
  return ownRows(table).length;
}

/** Cells of the widest own row. */
function colCount(table: Element): number {
  const widths = ownRows(table).map((tr) => tr.children.filter((c) => isTag(c) && (c.name === 'th' || c.name === 'td')).length);
  return Math.max(0, ...widths);
}

/**
 * One line per heading (`h2 Text`, indented two spaces per level below 1) and per table
 * (`[table N: R rows x C cols]`, indented one level deeper than the most recent heading).
 */
export function outline(storage: string): string {
  const lines: string[] = [];
  let depth = 0;
  let tables = 0;
  for (const el of elementsIn(parseStorage(storage))) {
    const level = headingLevel(el);
    if (level !== null) {
      lines.push(`${'  '.repeat(level - 1)}h${level} ${textOf(el)}`.trimEnd());
      depth = level;
    } else if (el.name === 'table') {
      tables++;
      lines.push(`${'  '.repeat(depth)}[table ${tables}: ${rowCount(el)} rows x ${colCount(el)} cols]`);
    }
  }
  return lines.join('\n');
}
