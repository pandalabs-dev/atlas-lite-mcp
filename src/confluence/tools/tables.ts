import { z } from 'zod';
import { defineTool, siteParam, type ToolDef } from '../../core/tools.js';
import { getPage } from '../api.js';
import { storageToMarkdown } from '../convert/toMarkdown.js';
import { parseStorage } from '../storage/dom.js';
import { addRow, selectTable, updateCell } from '../storage/tables.js';
import { writePage } from '../write.js';
import { pageTarget } from './pages.js';

const urlParam = z.string().describe('Page URL or id');
const tableParam = z.union([z.number().int().positive(), z.string()]).optional().describe('Index or heading above');

/** A digits-only string is an index; any other text is the heading above the table. */
function tableSel(table: number | string | undefined): number | string | undefined {
  return typeof table === 'string' && /^\s*\d+\s*$/.test(table) ? Number(table) : table;
}

function shown(text: string): string {
  return text === '' ? '(empty)' : text;
}

const tableGet = defineTool({
  name: 'table_get',
  description: 'Read one page table as markdown.',
  shape: { url: urlParam, table: tableParam, site: siteParam },
  async run(args, rt) {
    const { srt, id } = pageTarget(args, rt);
    const page = await getPage(srt, id);
    const t = selectTable(page.storage, parseStorage(page.storage), tableSel(args.table));
    const start = t.el.startIndex;
    const end = t.el.endIndex;
    if (start === null || end === null) throw new Error('Table has no source offsets.');
    // The table's outer range keeps the whole element inside `within`, and token numbers stay page-wide.
    const { markdown } = storageToMarkdown(page.storage, { within: { start, end: end + 1 } });
    return [`Table ${t.index} (${t.rowCount} rows x ${t.colCount} cols)`, '', markdown.trim()].join('\n');
  },
});

const tableUpdate = defineTool({
  name: 'table_update',
  description: 'Set one table cell, matched by row label and column header.',
  shape: { url: urlParam, row: z.string(), column: z.string(), value: z.string(), table: tableParam, site: siteParam },
  async run(args, rt) {
    const { srt, id } = pageTarget(args, rt);
    let old = '';
    const r = await writePage(srt, id, 'table_update', (page) => {
      const edit = updateCell(page.storage, tableSel(args.table), args.row, args.column, args.value);
      old = edit.old;
      return { storage: edit.storage };
    });
    const cell = `${args.row.trim()} / ${args.column.trim()}`;
    if (r.unchanged) return `${cell} already ${shown(old)} (v${r.from})`;
    return `${cell}: ${shown(old)} -> ${shown(args.value)}, v${r.from} -> v${r.to}`;
  },
});

const tableAddRow = defineTool({
  name: 'table_add_row',
  description: 'Add a table row; cells map column names to values.',
  shape: {
    url: urlParam,
    cells: z.record(z.string(), z.string()),
    table: tableParam,
    position: z.string().optional().describe('end or after:<row label>'),
    site: siteParam,
  },
  async run(args, rt) {
    const { srt, id } = pageTarget(args, rt);
    let table = 0;
    const r = await writePage(srt, id, 'table_add_row', (page) => {
      const edit = addRow(page.storage, tableSel(args.table), args.cells, args.position);
      table = edit.table;
      return { storage: edit.storage };
    });
    return `Row added to table ${table}, v${r.from} -> v${r.to}`;
  },
});

export const tableTools: ToolDef[] = [tableGet, tableUpdate, tableAddRow];
