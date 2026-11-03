import { type AnyNode, type Document, type Element, hasChildren, isTag, isText } from 'domhandler';
import { AtlasError } from '../../core/errors.js';
import { escapeXml, innerRange, openTag, parseStorage, textOf } from './dom.js';
import { colCount, findSection, type Heading, listHeadings, listNames, ownRows, rowCount } from './sections.js';

/** A table in document order (1-based `index`) with its own rows, header texts and size. */
export interface TableInfo {
  index: number;
  el: Element;
  rows: Element[];
  header: string[];
  rowCount: number;
  colCount: number;
}

/** Inline and paragraph wrappers that a cell's text is descended into. */
const WRAPPERS = new Set(['p', 'span', 'strong', 'em', 'b', 'i', 'u', 's', 'code', 'sub', 'sup']);
const USE_STORAGE = 'use page_edit with format "storage" markup.';

function startOf(el: Element): number {
  if (el.startIndex === null) throw new Error(`Element <${el.name}> has no source offset; parse with parseStorage.`);
  return el.startIndex;
}

function endOf(el: Element): number {
  if (el.endIndex === null) throw new Error(`Element <${el.name}> has no end offset; parse with parseStorage.`);
  return el.endIndex;
}

function normalize(text: string): string {
  return text.replace(/ /g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

function tablesIn(node: AnyNode): Element[] {
  const out: Element[] = [];
  const walk = (n: AnyNode): void => {
    if (isTag(n) && n.name === 'table') out.push(n);
    if (hasChildren(n)) for (const c of n.children) walk(c);
  };
  walk(node);
  return out;
}

function cellsOf(tr: Element): Element[] {
  return tr.children.filter((c): c is Element => isTag(c) && (c.name === 'th' || c.name === 'td'));
}

function rowLabel(tr: Element): string {
  const first = cellsOf(tr)[0];
  return first ? textOf(first) : '';
}

/** Every table in document order, nested tables included; each table's rows exclude nested tables' rows. */
export function listTables(doc: Document): TableInfo[] {
  return tablesIn(doc).map((el, i) => {
    const rows = ownRows(el);
    const first = rows[0];
    return {
      index: i + 1,
      el,
      rows,
      header: first ? cellsOf(first).map(textOf) : [],
      rowCount: rowCount(el),
      colCount: colCount(el),
    };
  });
}

function describeTables(tables: TableInfo[], headings: Heading[]): string {
  const names = tables.map((t) => {
    const at = startOf(t.el);
    const above = headings.filter((h) => startOf(h.el) < at).at(-1);
    const under = above ? ` under "${above.text}"` : '';
    return `${t.index}${under} (${t.rowCount} rows x ${t.colCount} cols)`;
  });
  return `Tables: ${listNames(names)}.`;
}

/**
 * Picks a table: a number selects by 1-based document order, text selects the first table in that
 * heading's section, and no selector requires the page to have exactly one table.
 */
export function selectTable(storage: string, doc: Document, sel?: number | string): TableInfo {
  const tables = listTables(doc);
  if (tables.length === 0) throw new AtlasError('The page has no tables.');
  const list = (): string => describeTables(tables, listHeadings(doc));
  if (sel === undefined) {
    if (tables.length === 1) return tables[0]!;
    throw new AtlasError(`The page has ${tables.length} tables; pass table as a number or the heading above it. ${list()}`);
  }
  if (typeof sel === 'number') {
    const t = tables[sel - 1];
    if (t) return t;
    const count = tables.length === 1 ? '1 table' : `${tables.length} tables`;
    throw new AtlasError(`No table ${sel}; the page has ${count}. ${list()}`);
  }
  const { heading, start, end } = findSection(storage, doc, sel);
  const t = tables.find((x) => startOf(x.el) >= start && startOf(x.el) < end);
  if (!t) throw new AtlasError(`No table under heading "${heading.text}". ${list()}`);
  return t;
}

/** The body row whose first-cell text matches `label`, with its index in `t.rows`. */
function findRow(t: TableInfo, label: string): { tr: Element; at: number } {
  const wanted = normalize(label);
  const matches: number[] = [];
  for (let at = 1; at < t.rows.length; at++) if (normalize(rowLabel(t.rows[at]!)) === wanted) matches.push(at);
  if (matches.length === 0) {
    const labels = t.rows.slice(1).map(rowLabel).filter((l) => l !== '');
    const available = labels.length ? `Rows: ${listNames(labels)}.` : 'The table has no labelled body rows.';
    throw new AtlasError(`No row "${label}" in table ${t.index}. ${available}`);
  }
  if (matches.length > 1) {
    const names = matches.map((at) => rowLabel(t.rows[at]!));
    throw new AtlasError(
      `Row "${label}" matches ${matches.length} rows in table ${t.index}: ${listNames(names)}; use page_edit or make the row label unique.`,
    );
  }
  const at = matches[0]!;
  return { tr: t.rows[at]!, at };
}

/** Index of the header cell whose text matches `name`; `missing` opens the not-found message. */
function findColumn(t: TableInfo, name: string, missing: string): number {
  const wanted = normalize(name);
  const matches = t.header.flatMap((h, i) => (normalize(h) === wanted ? [i] : []));
  if (matches.length === 0) {
    const headers = t.header.filter((h) => h !== '');
    const available = headers.length ? `Columns: ${listNames(headers)}.` : 'The table has no column headers.';
    throw new AtlasError(`${missing} "${name}" in table ${t.index}. ${available}`);
  }
  if (matches.length > 1) {
    const names = matches.map((i) => t.header[i]!);
    throw new AtlasError(
      `Column "${name}" matches ${matches.length} columns in table ${t.index}: ${listNames(names)}; use page_edit or make the column header unique.`,
    );
  }
  return matches[0]!;
}

/** Refuses merged cells from the header row through row `upTo`: a span there shifts the target's columns. */
function assertNoMergedCells(t: TableInfo, upTo: number): void {
  for (const tr of t.rows.slice(0, upTo + 1)) {
    for (const cell of cellsOf(tr)) {
      for (const attr of ['rowspan', 'colspan']) {
        const span = cell.attribs[attr];
        if (span !== undefined && span.trim() !== '1') {
          throw new AtlasError(`Table ${t.index} uses rowspan or colspan in the targeted rows; ${USE_STORAGE}`);
        }
      }
    }
  }
}

function cellAt(t: TableInfo, tr: Element, column: number): Element {
  const cell = cellsOf(tr)[column];
  if (!cell) throw new AtlasError(`Row ${rowLabel(tr)} has no cell under column ${t.header[column]} in table ${t.index}; ${USE_STORAGE}`);
  return cell;
}

function holdsRefusedContent(cell: Element): boolean {
  const refused = (n: AnyNode): boolean =>
    isTag(n) && (n.name.startsWith('ac:') || n.name.startsWith('ri:') || n.name === 'img' || n.name === 'table');
  const walk = (n: AnyNode): boolean => hasChildren(n) && n.children.some((c) => refused(c) || walk(c));
  return walk(cell);
}

function isBlank(node: AnyNode): boolean {
  return isText(node) && node.data.trim() === '';
}

/** The chain of single wrapper elements below the cell, outermost first (empty when the cell has no single wrapper). */
function wrapperChain(cell: Element): Element[] {
  const chain: Element[] = [];
  let target = cell;
  for (;;) {
    const kids = target.children.filter((k) => !isBlank(k));
    const only = kids[0];
    if (kids.length !== 1 || !only || !isTag(only) || !WRAPPERS.has(only.name)) return chain;
    chain.push(only);
    target = only;
  }
}

function splice(storage: string, start: number, end: number, text: string): string {
  return storage.slice(0, start) + text + storage.slice(end);
}

/**
 * Sets one cell's text, found by row label (first cell) and column header (row 1). Only the text inside
 * the innermost single wrapper changes; every other byte of the storage stays identical.
 */
export function updateCell(
  storage: string,
  sel: number | string | undefined,
  row: string,
  column: string,
  value: string,
): { storage: string; old: string; table: number } {
  const doc = parseStorage(storage);
  const t = selectTable(storage, doc, sel);
  const { tr, at } = findRow(t, row);
  const ci = findColumn(t, column, 'No column');
  assertNoMergedCells(t, at);
  const cell = cellAt(t, tr, ci);
  if (holdsRefusedContent(cell)) {
    throw new AtlasError(`Cell ${rowLabel(tr)} / ${t.header[ci]} holds a macro, image or nested table; ${USE_STORAGE}`);
  }
  const old = textOf(cell);
  const text = escapeXml(value);
  const target = wrapperChain(cell).at(-1) ?? cell;
  const inner = innerRange(storage, target);
  if (target === cell && cell.children.every(isBlank)) {
    const filled = `<p>${text}</p>`;
    const out = inner
      ? splice(storage, inner.start, inner.end, filled)
      : splice(storage, startOf(cell), endOf(cell) + 1, `${openTag(storage, cell)}${filled}</${cell.name}>`);
    return { storage: out, old, table: t.index };
  }
  const out = inner
    ? splice(storage, inner.start, inner.end, text)
    : splice(storage, startOf(target), endOf(target) + 1, `${openTag(storage, target)}${text}</${target.name}>`);
  return { storage: out, old, table: t.index };
}

/**
 * Adds a body row cloned from the last body row (`end`, the default) or the row named in
 * `after:<row label>`, inserted right after it. Cells are filled by column header; the rest stay empty.
 */
export function addRow(
  storage: string,
  sel: number | string | undefined,
  cells: Record<string, string>,
  position = 'end',
): { storage: string; table: number } {
  const doc = parseStorage(storage);
  const t = selectTable(storage, doc, sel);
  const values = new Map<number, string>();
  const keys = new Map<number, string>();
  for (const [name, value] of Object.entries(cells)) {
    const ci = findColumn(t, name, 'Unknown column');
    const prev = keys.get(ci);
    if (prev !== undefined) {
      throw new AtlasError(`Columns "${prev}" and "${name}" both name column ${t.header[ci]} in table ${t.index}; pass each column once.`);
    }
    keys.set(ci, name);
    values.set(ci, value);
  }
  if (t.rows.length < 2) throw new AtlasError(`Table ${t.index} has no body row to copy; ${USE_STORAGE}`);
  const pos = position.trim();
  let at: number;
  if (pos.toLowerCase() === 'end') at = t.rows.length - 1;
  else if (pos.toLowerCase().startsWith('after:')) at = findRow(t, pos.slice('after:'.length)).at;
  else throw new AtlasError(`Position "${position}" is not valid; use "end" or "after:<row label>".`);
  assertNoMergedCells(t, at);
  const template = t.rows[at]!;
  for (const ci of values.keys()) cellAt(t, template, ci);
  let row = openTag(storage, template);
  cellsOf(template).forEach((cell, ci) => {
    const chain = holdsRefusedContent(cell) ? [] : wrapperChain(cell);
    const opens = chain.length ? chain.map((w) => openTag(storage, w)).join('') : '<p>';
    const closes = chain.length ? chain.map((w) => `</${w.name}>`).reverse().join('') : '</p>';
    row += `${openTag(storage, cell)}${opens}${escapeXml(values.get(ci) ?? '')}${closes}</${cell.name}>`;
  });
  row += `</${template.name}>`;
  const insertAt = endOf(template) + 1;
  return { storage: splice(storage, insertAt, insertAt, row), table: t.index };
}
