import { describe, expect, it } from 'vitest';
import { tableTools } from '../../../src/confluence/tools/tables.js';
import { executeTool, type ToolDef } from '../../../src/core/tools.js';
import type { Call, Route } from '../../helpers/fetch.js';
import { fixture } from '../../helpers/fixtures.js';
import { testRuntime } from '../../helpers/runtime.js';

const page = fixture('confluence/rich-page.xml');
const twoTables = [
  '<h2>Costs</h2>',
  '<table><tbody><tr><th><p>Item</p></th><th><p>CHF</p></th></tr><tr><td><p>Hosting</p></td><td><p>100</p></td></tr></tbody></table>',
  '<h2>People</h2>',
  '<table><tbody><tr><th><p>Name</p></th><th><p>Role</p></th></tr><tr><td><p>Ana</p></td><td><p>Dev</p></td></tr><tr><td><p>Marko</p></td><td/></tr></tbody></table>',
].join('');

function pageRoutes(id: string, storage: string): Route[] {
  const path = `/wiki/api/v2/pages/${id}`;
  return [
    {
      method: 'GET',
      path,
      json: { id, title: 'Costs', spaceId: '100', version: { number: 13 }, body: { storage: { value: storage } }, _links: { webui: `/spaces/DOCS/pages/${id}/Costs` } },
    },
    { method: 'PUT', path, json: { version: { number: 14 } } },
  ];
}

const routes: Route[] = [...pageRoutes('7', page), ...pageRoutes('8', twoTables)];

function byName(name: string): ToolDef {
  const def = tableTools.find((t) => t.name === name);
  if (def === undefined) throw new Error(`no tool ${name}`);
  return def;
}

async function runWithCalls(name: string, args: Record<string, unknown>) {
  const { rt, calls } = testRuntime(routes);
  const result = await executeTool(byName(name), args, rt);
  return { ...result, calls };
}

async function run(name: string, args: Record<string, unknown>) {
  const { text, isError } = await runWithCalls(name, args);
  return { text, isError };
}

function puts(calls: Call[]): Call[] {
  return calls.filter((c) => c.method === 'PUT');
}

function lastPut(calls: Call[]): any {
  const put = puts(calls).at(-1);
  if (put === undefined) throw new Error('no PUT');
  return put.body;
}

describe('table_get', () => {
  it('table_get returns a header and the markdown table with tokens', async () => {
    expect((await run('table_get', { url: '7' })).text).toBe(
      [
        'Table 1 (4 rows x 3 cols)',
        '',
        '| **Item** | **Q1 2026** | **Q2** |',
        '| --- | --- | --- |',
        '| Hosting | 100 | 120 |',
        '| Licences | **40** | 40 |',
        '| Support | {{atlas:5}} [status: TBD] |  |',
      ].join('\n'),
    );
  });

  it('selects a table by the heading above it', async () => {
    const r = await run('table_get', { url: '8', table: 'people' });
    expect(r).toEqual({ text: ['Table 2 (3 rows x 2 cols)', '', '| Name | Role |', '| --- | --- |', '| Ana | Dev |', '| Marko |  |'].join('\n'), isError: false });
  });

  it('treats a digits-only string as a table index', async () => {
    expect((await run('table_get', { url: '8', table: '2' })).text.split('\n')[0]).toBe('Table 2 (3 rows x 2 cols)');
    expect((await run('table_get', { url: '8', table: 1 })).text.split('\n')[0]).toBe('Table 1 (2 rows x 2 cols)');
  });

  it('passes the table list through when the page has several tables', async () => {
    expect(await run('table_get', { url: '8' })).toEqual({
      text: 'The page has 2 tables; pass table as a number or the heading above it. Tables: 1 under "Costs" (2 rows x 2 cols), 2 under "People" (3 rows x 2 cols).',
      isError: true,
    });
  });

  it('rejects a non-positive index before any call', async () => {
    const r = await runWithCalls('table_get', { url: '8', table: 0 });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/^Invalid arguments: table /);
    expect(r.calls).toEqual([]);
  });
});

describe('table_update', () => {
  it('table_update reports old and new values and versions', async () => {
    expect((await run('table_update', { url: '7', row: 'Hosting', column: 'Q2', value: '125' })).text).toBe('Hosting / Q2: 120 -> 125, v13 -> v14');
  });

  it('table_update keeps every byte outside the cell (spec 6.11)', async () => {
    const { calls } = await runWithCalls('table_update', { url: '7', row: 'Hosting', column: 'Q2', value: '125' });
    const body = lastPut(calls);
    expect(body.body.value).toBe(page.replace('<td><p>120</p></td>', '<td><p>125</p></td>'));
    expect(body.version).toEqual({ number: 14, message: 'atlas-lite-mcp table_update' });
  });

  it('says so and writes nothing when the cell already holds the value', async () => {
    const r = await runWithCalls('table_update', { url: '7', row: 'Hosting', column: 'Q2', value: '120' });
    expect(r.text).toBe('Hosting / Q2 already 120 (v13)');
    expect(puts(r.calls)).toEqual([]);
  });

  it('shows an empty cell as (empty)', async () => {
    const r = await runWithCalls('table_update', { url: '8', table: 'People', row: 'Marko', column: 'Role', value: 'PM' });
    expect(r.text).toBe('Marko / Role: (empty) -> PM, v13 -> v14');
    expect(lastPut(r.calls).body.value).toBe(twoTables.replace('<td><p>Marko</p></td><td/>', '<td><p>Marko</p></td><td><p>PM</p></td>'));
  });

  it('passes matching errors through as isError', async () => {
    expect(await run('table_update', { url: '7', row: 'Nope', column: 'Q2', value: '1' })).toEqual({ text: 'No row "Nope" in table 1. Rows: Hosting, Licences, Support.', isError: true });
  });

  it('refuses a cell holding a macro with a pointer to page_edit', async () => {
    const r = await runWithCalls('table_update', { url: '7', row: 'Support', column: 'Q1 2026', value: 'x' });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('page_edit');
    expect(puts(r.calls)).toEqual([]);
  });
});

describe('table_add_row', () => {
  it('table_add_row returns versions', async () => {
    expect((await run('table_add_row', { url: '7', cells: { Item: 'CDN' } })).text).toBe('Row added to table 1, v13 -> v14');
  });

  it('inserts after the named row in the selected table', async () => {
    const r = await runWithCalls('table_add_row', { url: '8', table: '2', cells: { Name: 'Iva', Role: 'QA' }, position: 'after:Ana' });
    expect(r.text).toBe('Row added to table 2, v13 -> v14');
    const body = lastPut(r.calls);
    expect(body.body.value).toBe(twoTables.replace('<td><p>Dev</p></td></tr>', '<td><p>Dev</p></td></tr><tr><td><p>Iva</p></td><td><p>QA</p></td></tr>'));
    expect(body.version.message).toBe('atlas-lite-mcp table_add_row');
  });

  it('rejects an unknown column with the header list', async () => {
    expect(await run('table_add_row', { url: '7', cells: { Cost: '1' } })).toEqual({ text: 'Unknown column "Cost" in table 1. Columns: Item, Q1 2026, Q2.', isError: true });
  });
});

describe('tableTools', () => {
  it('uses the catalogue names and descriptions', () => {
    expect(tableTools.map((t) => [t.name, t.description])).toEqual([
      ['table_get', 'Read one page table as markdown.'],
      ['table_update', 'Set one table cell, matched by row label and column header.'],
      ['table_add_row', 'Add a table row; cells map column names to values.'],
    ]);
  });
});
