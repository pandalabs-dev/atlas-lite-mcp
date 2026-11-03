import { isTag } from 'domhandler';
import { describe, expect, it } from 'vitest';
import { parseStorage, textOf } from '../../../src/confluence/storage/dom.js';
import { assertWellFormed } from '../../../src/confluence/storage/edit.js';
import { rowCount } from '../../../src/confluence/storage/sections.js';
import { addRow, listTables, selectTable, updateCell } from '../../../src/confluence/storage/tables.js';
import { fixture } from '../../helpers/fixtures.js';

const page = fixture('confluence/rich-page.xml');
const extra = '<h2>Extra</h2><table><tbody><tr><th>K</th></tr><tr><td>v</td></tr></tbody></table>';
const multi = page + extra;

/** Decoded text of every cell of table `n` (1-based), row by row. */
function cellTexts(storage: string, n: number): string[][] {
  const t = listTables(parseStorage(storage))[n - 1];
  if (!t) throw new Error(`no table ${n}`);
  return t.rows.map((tr) => tr.children.filter((c) => isTag(c) && (c.name === 'td' || c.name === 'th')).map(textOf));
}

describe('listTables', () => {
  it('lists tables in document order with header, own rows and size', () => {
    const tables = listTables(parseStorage(multi));
    expect(tables.map((t) => [t.index, t.header, t.rowCount, t.colCount])).toEqual([
      [1, ['Item', 'Q1 2026', 'Q2'], 4, 3],
      [2, ['K'], 2, 1],
    ]);
    expect(tables[0]!.rows).toHaveLength(4);
  });

  it('counts nested tables but keeps their rows out of the outer table', () => {
    const s =
      '<table><tbody><tr><th>A</th></tr><tr><td><table><tbody><tr><td>in1</td></tr><tr><td>in2</td></tr></tbody></table></td></tr></tbody></table>';
    const tables = listTables(parseStorage(s));
    expect(tables.map((t) => t.index)).toEqual([1, 2]);
    expect(tables[0]!.rows).toHaveLength(2);
    expect(tables[0]!.rowCount).toBe(rowCount(tables[0]!.el));
    expect(tables[1]!.rows).toHaveLength(2);
    expect(tables[1]!.header).toEqual(['in1']);
  });
});

describe('selectTable', () => {
  it('selects by index, by heading text, or the only table', () => {
    expect(selectTable(page, parseStorage(page)).index).toBe(1);
    expect(selectTable(multi, parseStorage(multi), 2).header).toEqual(['K']);
    expect(selectTable(multi, parseStorage(multi), 'extra').index).toBe(2);
    expect(selectTable(multi, parseStorage(multi), ' BUDGET ').index).toBe(1);
    expect(() => selectTable(multi, parseStorage(multi))).toThrow(
      'The page has 2 tables; pass table as a number or the heading above it. Tables: 1 under "Budget" (4 rows x 3 cols), 2 under "Extra" (2 rows x 1 cols).',
    );
  });

  it('rejects an index out of range and lists the tables', () => {
    expect(() => selectTable(multi, parseStorage(multi), 3)).toThrow(
      'No table 3; the page has 2 tables. Tables: 1 under "Budget" (4 rows x 3 cols), 2 under "Extra" (2 rows x 1 cols).',
    );
    expect(() => selectTable(page, parseStorage(page), 0)).toThrow('No table 0; the page has 1 table. Tables: 1 under "Budget" (4 rows x 3 cols).');
  });

  it('rejects a heading with no table in its section', () => {
    expect(() => selectTable(multi, parseStorage(multi), 'Team')).toThrow(
      'No table under heading "Team". Tables: 1 under "Budget" (4 rows x 3 cols), 2 under "Extra" (2 rows x 1 cols).',
    );
    expect(() => selectTable(multi, parseStorage(multi), 'Nope')).toThrow('No heading "Nope".');
  });

  it('errors when the page has no tables and caps the table list at five', () => {
    expect(() => selectTable('<p>x</p>', parseStorage('<p>x</p>'))).toThrow('The page has no tables.');
    const many = '<table><tr><td>a</td></tr></table>'.repeat(7);
    expect(() => selectTable(many, parseStorage(many))).toThrow(
      'The page has 7 tables; pass table as a number or the heading above it. Tables: 1 (1 rows x 1 cols), 2 (1 rows x 1 cols), 3 (1 rows x 1 cols), 4 (1 rows x 1 cols), 5 (1 rows x 1 cols) (and 2 more).',
    );
  });
});

describe('updateCell', () => {
  it('updates only the text inside the innermost wrapper, keeping markup and other bytes', () => {
    const r = updateCell(page, undefined, 'licences', 'Q1 2026', '45');
    expect(r.old).toBe('40');
    expect(r.table).toBe(1);
    expect(r.storage).toBe(page.replace('<td><p><strong>40</strong></p></td>', '<td><p><strong>45</strong></p></td>'));
  });

  it('matches row and column on decoded, trimmed, case-insensitive text', () => {
    const r = updateCell(page, 1, 'SUPPORT', 'q2', 'n/a');
    expect(r.old).toBe('');
    expect(r.storage).toContain('<td><p>n/a</p></td></tr></tbody>');
    const amp = '<table><tbody><tr><th><strong>Item</strong></th><th>Q1&nbsp;2026</th></tr><tr><td> R&amp;D </td><td>1</td></tr></tbody></table>';
    expect(updateCell(amp, 1, 'r&d', 'item', 'x').storage).toBe(amp.replace(' R&amp;D ', 'x'));
    expect(updateCell(amp, 1, 'R&D', 'Q1 2026', '2').storage).toBe(amp.replace('<td>1</td>', '<td>2</td>'));
  });

  it('escapes values', () => {
    expect(updateCell(page, 1, 'Hosting', 'Q2', 'a & <b>').storage).toContain('<td><p>a &amp; &lt;b&gt;</p></td>');
  });

  it('keeps storage well-formed and reads back the same text for &, <, ]]> and |', () => {
    const value = 'a & <b> ]]> | c';
    const out = updateCell(page, 1, 'Hosting', 'Q2', value).storage;
    assertWellFormed(out);
    expect(cellTexts(out, 1)[1]).toEqual(['Hosting', '100', value]);
  });

  it('fills an empty cell with a paragraph', () => {
    const s = '<table><tbody><tr><th>A</th><th>B</th><th>C</th></tr><tr><td>x</td><td></td><td/></tr></tbody></table>';
    const b = updateCell(s, 1, 'x', 'B', '1').storage;
    expect(b).toBe(s.replace('<td></td>', '<td><p>1</p></td>'));
    expect(updateCell(s, 1, 'x', 'C', '2').storage).toBe(s.replace('<td/>', '<td><p>2</p></td>'));
  });

  it('replaces the whole cell content when there is no single wrapper chain', () => {
    const s = '<table><tbody><tr><th>A</th><th>B</th></tr><tr><td>x</td><td><p>1</p><p>2</p></td></tr></tbody></table>';
    expect(updateCell(s, 1, 'x', 'B', '3').storage).toBe(s.replace('<td><p>1</p><p>2</p></td>', '<td>3</td>'));
    const attrs = '<table><tbody><tr><th>A</th><th>B</th></tr><tr><td>x</td><td class="c"> <p style="a">\n<em>1</em> </p> </td></tr></tbody></table>';
    expect(updateCell(attrs, 1, 'x', 'B', '9').storage).toBe(attrs.replace('<em>1</em>', '<em>9</em>'));
  });

  it('refuses cells with macros, images or nested tables', () => {
    expect(() => updateCell(page, 1, 'Support', 'Q1 2026', 'x')).toThrow(
      'Cell Support / Q1 2026 holds a macro, image or nested table; use page_edit with format "storage" markup.',
    );
    const img = '<table><tbody><tr><th>A</th><th>B</th></tr><tr><td>x</td><td><p><img src="a.png"/></p></td></tr></tbody></table>';
    expect(() => updateCell(img, 1, 'x', 'B', 'y')).toThrow('Cell x / B holds a macro, image or nested table');
    const nested = '<table><tbody><tr><th>A</th><th>B</th></tr><tr><td>x</td><td><table><tr><td>i</td></tr></table></td></tr></tbody></table>';
    expect(() => updateCell(nested, 1, 'x', 'B', 'y')).toThrow('Cell x / B holds a macro, image or nested table');
  });

  it('lists candidates for unknown or ambiguous rows and columns', () => {
    expect(() => updateCell(page, 1, 'Nope', 'Q2', 'x')).toThrow('No row "Nope" in table 1. Rows: Hosting, Licences, Support.');
    expect(() => updateCell(page, 1, 'Hosting', 'Q9', 'x')).toThrow('No column "Q9" in table 1. Columns: Item, Q1 2026, Q2.');
    const dup =
      '<table><tbody><tr><th>K</th><th>V</th><th>v</th></tr><tr><td>a</td><td>1</td><td>2</td></tr><tr><td>A</td><td>3</td><td>4</td></tr></tbody></table>';
    expect(() => updateCell(dup, 1, 'a', 'K', 'x')).toThrow('Row "a" matches 2 rows in table 1: a, A; use page_edit or make the row label unique.');
    expect(() => updateCell(dup, 1, 'x', 'v', 'x')).toThrow('No row "x" in table 1. Rows: a, A.');
    expect(() => addRow(dup, 1, { v: 'x' })).toThrow('Column "v" matches 2 columns in table 1: V, v; use page_edit or make the column header unique.');
  });

  it('caps long candidate lists at five', () => {
    const rows = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((l) => `<tr><td>${l}</td></tr>`).join('');
    const s = `<table><tbody><tr><th>K</th></tr>${rows}</tbody></table>`;
    expect(() => updateCell(s, 1, 'z', 'K', 'x')).toThrow('No row "z" in table 1. Rows: a, b, c, d, e (and 2 more).');
  });

  it('refuses a row that has no cell under the column', () => {
    const s = '<table><tbody><tr><th>A</th><th>B</th></tr><tr><td>x</td></tr></tbody></table>';
    expect(() => updateCell(s, 1, 'x', 'B', '1')).toThrow('Row x has no cell under column B in table 1; use page_edit with format "storage" markup.');
  });

  it('refuses rowspan or colspan in the targeted rows', () => {
    const s = '<table><tbody><tr><th>A</th><th>B</th></tr><tr><td rowspan="2">x</td><td>1</td></tr></tbody></table>';
    expect(() => updateCell(s, 1, 'x', 'B', '2')).toThrow(
      'Table 1 uses rowspan or colspan in the targeted rows; use page_edit with format "storage" markup.',
    );
    const head = '<table><tbody><tr><th colspan="2">A</th></tr><tr><td>x</td><td>1</td></tr></tbody></table>';
    expect(() => updateCell(head, 1, 'x', 'A', '2')).toThrow('Table 1 uses rowspan or colspan in the targeted rows');
  });

  it('allows merged cells below the target and span attributes of 1', () => {
    const s =
      '<table><tbody><tr><th>A</th><th colspan="1">B</th></tr><tr><td>x</td><td>1</td></tr><tr><td colspan="2">y</td></tr></tbody></table>';
    expect(updateCell(s, 1, 'x', 'B', '2').storage).toBe(s.replace('<td>1</td>', '<td>2</td>'));
  });

  it('keeps the rest of the page byte-identical after updateCell', () => {
    const r = updateCell(page, 1, 'Hosting', 'Q2', '125');
    const i = page.indexOf('<p>120</p>');
    expect(r.storage.slice(0, i)).toBe(page.slice(0, i));
    expect(r.storage.slice(i, i + '<p>125</p>'.length)).toBe('<p>125</p>');
    expect(r.storage.slice(i + '<p>125</p>'.length)).toBe(page.slice(i + '<p>120</p>'.length));
  });

  it('updates the selected table of several', () => {
    const r = updateCell(multi, 'Extra', 'v', 'k', 'w');
    expect(r.table).toBe(2);
    expect(r.storage).toBe(page + extra.replace('<td>v</td>', '<td>w</td>'));
  });
});

describe('addRow', () => {
  it('adds a row cloned from a body row, filling by column name', () => {
    const r = addRow(page, 1, { item: 'Backups', Q2: '15' });
    expect(r.table).toBe(1);
    expect(r.storage).toContain('<tr><td><p>Support </p></td>');
    expect(r.storage).toContain('</tr><tr><td><p>Backups</p></td><td><p></p></td><td><p>15</p></td></tr></tbody>');
    const at = page.indexOf('</tbody>');
    expect(r.storage).toBe(page.slice(0, at) + '<tr><td><p>Backups</p></td><td><p></p></td><td><p>15</p></td></tr>' + page.slice(at));
  });

  it('inserts after a named row', () => {
    const out = addRow(page, 1, { Item: 'CDN' }, 'after:hosting').storage;
    expect(out).toMatch(/<td><p>Hosting<\/p><\/td>.*?<\/tr><tr><td><p>CDN<\/p><\/td>/);
    expect(cellTexts(out, 1).map((r) => r[0])).toEqual(['Item', 'Hosting', 'CDN', 'Licences', 'Support']);
  });

  it('copies cell and wrapper attributes from the template row', () => {
    const s =
      '<table><tbody><tr><th>A</th><th>B</th></tr><tr class="r"><td style="x"><p class="p"><strong>a</strong></p></td><td>1</td></tr></tbody></table>';
    expect(addRow(s, 1, { a: 'n', b: '2' }).storage).toBe(
      s.replace('</tbody>', '<tr class="r"><td style="x"><p class="p"><strong>n</strong></p></td><td><p>2</p></td></tr></tbody>'),
    );
  });

  it('escapes values and reads back the same text', () => {
    const out = addRow(page, 1, { Item: 'x ]]> & <y> | z' }).storage;
    assertWellFormed(out);
    expect(cellTexts(out, 1)[4]).toEqual(['x ]]> & <y> | z', '', '']);
  });

  it('rejects unknown columns with the header list', () => {
    expect(() => addRow(page, 1, { Q3: '1' })).toThrow('Unknown column "Q3" in table 1. Columns: Item, Q1 2026, Q2.');
  });

  it('rejects two keys that name the same column', () => {
    expect(() => addRow(page, 1, { Item: 'a', ITEM: 'b' })).toThrow('Columns "Item" and "ITEM" both name column Item in table 1; pass each column once.');
  });

  it('rejects an unknown row in after: and a bad position', () => {
    expect(() => addRow(page, 1, { Item: 'a' }, 'after:nope')).toThrow('No row "nope" in table 1. Rows: Hosting, Licences, Support.');
    expect(() => addRow(page, 1, { Item: 'a' }, 'start')).toThrow('Position "start" is not valid; use "end" or "after:<row label>".');
  });

  it('refuses a table with no body row', () => {
    const s = '<table><tbody><tr><th>A</th></tr></tbody></table>';
    expect(() => addRow(s, 1, { A: 'x' })).toThrow('Table 1 has no body row to copy; use page_edit with format "storage" markup.');
  });

  it('refuses rowspan or colspan up to the template row', () => {
    const s = '<table><tbody><tr><th>A</th><th>B</th></tr><tr><td rowspan="2">x</td><td>1</td></tr><tr><td>2</td></tr></tbody></table>';
    expect(() => addRow(s, 1, { A: 'y' })).toThrow('Table 1 uses rowspan or colspan in the targeted rows; use page_edit with format "storage" markup.');
  });

  it('refuses a value for a column the template row has no cell for', () => {
    const s = '<table><tbody><tr><th>A</th><th>B</th></tr><tr><td>x</td></tr></tbody></table>';
    expect(() => addRow(s, 1, { B: 'y' })).toThrow('Row x has no cell under column B in table 1; use page_edit with format "storage" markup.');
  });
});
