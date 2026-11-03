import { isTag } from 'domhandler';
import { describe, expect, it } from 'vitest';
import { parseStorage } from '../../../src/confluence/storage/dom.js';
import { findSection, listHeadings, outline, rowCount } from '../../../src/confluence/storage/sections.js';
import { fixture } from '../../helpers/fixtures.js';

const page = fixture('confluence/rich-page.xml');
const doc = parseStorage(page);

function region(name: string): string {
  const { start, end } = findSection(page, doc, name);
  return page.slice(start, end);
}

function sectionOf(storage: string, name: string): string {
  const { start, end } = findSection(storage, parseStorage(storage), name);
  return storage.slice(start, end);
}

describe('listHeadings', () => {
  it('lists headings at any depth in document order with level and decoded text', () => {
    expect(listHeadings(doc).map((h) => `${h.level} ${h.text}`)).toEqual([
      '1 Overview',
      '2 Budget',
      '3 Notes',
      '2 Team',
      '2 Left',
      '2 Right',
      '2 Done',
    ]);
  });
});

describe('findSection', () => {
  it('starts just after the heading element', () => {
    const s = '<h2>A</h2><p>1</p>';
    const r = findSection(s, parseStorage(s), 'A');
    expect(r.start).toBe('<h2>A</h2>'.length);
    expect(r.end).toBe(s.length);
    expect(r.heading.level).toBe(2);
    expect(r.heading.el.name).toBe('h2');
  });

  it('ends a section at the next heading of same or higher level, including deeper headings', () => {
    const r = region('Budget');
    expect(r).toContain('<p>Numbers in CHF.</p>');
    expect(r).toContain('<h3>Notes</h3>');
    expect(r).toContain('m-code');
    expect(r).not.toContain('<h2>Team</h2>');
    expect(page.slice(findSection(page, doc, 'Budget').end).startsWith('<h2>Team</h2>')).toBe(true);
  });

  it('ends a deeper section at a higher-level heading', () => {
    expect(region('Notes')).not.toContain('<h2>Team</h2>');
    expect(region('Notes')).toContain('m-code');
  });

  it('stops before a sibling that contains a heading of same or higher level', () => {
    expect(region('Team').trim()).toBe('<p>Two columns below.</p>');
  });

  it('does not stop at a sibling that only contains deeper headings', () => {
    expect(sectionOf('<h2>A</h2><div><h3>B</h3></div><p>x</p><h2>C</h2>', 'A')).toBe('<div><h3>B</h3></div><p>x</p>');
  });

  it('ends at the end of the containing layout cell', () => {
    expect(region('Left')).toBe('<p>Ana</p><ac:image ac:width="200"><ri:attachment ri:filename="ana.png"/></ac:image>');
    expect(region('Right')).toBe('<p>Marko</p>');
  });

  it('ends at the end of the containing macro body', () => {
    const s =
      '<ac:structured-macro ac:name="expand"><ac:rich-text-body><h2>In</h2><p>x</p></ac:rich-text-body></ac:structured-macro><p>after</p>';
    expect(sectionOf(s, 'In')).toBe('<p>x</p>');
  });

  it('runs to the end of the body for the last section', () => {
    expect(region('Done').trim()).toMatch(/^<ac:task-list>.*<\/ac:task-list>$/s);
    expect(findSection(page, doc, 'Done').end).toBe(page.length);
  });

  it('matches trimmed, case-insensitive, entity-decoded text', () => {
    const s = '<h2> R&amp;D&nbsp;Plan </h2><p>x</p>';
    expect(findSection(s, parseStorage(s), 'r&d plan').heading.text).toBe('R&D Plan');
    expect(findSection(s, parseStorage(s), '  R&D   PLAN ').heading.text).toBe('R&D Plan');
  });

  it('matches headings with inline markup by their plain text', () => {
    const s = '<h3><strong>Item</strong> one</h3><p>x</p>';
    expect(sectionOf(s, 'item one')).toBe('<p>x</p>');
  });

  it('lists every heading when the heading is missing', () => {
    expect(() => region('Nope')).toThrow('No heading "Nope". Headings: Overview, Budget, Notes, Team, Left, Right, Done.');
    expect(() => findSection('<p>x</p>', parseStorage('<p>x</p>'), 'A')).toThrow('No heading "A". The page has no headings.');
  });

  it('lists the matching headings when the heading is ambiguous', () => {
    const dup = '<h2>A</h2><p>1</p><h2>a</h2>';
    expect(() => findSection(dup, parseStorage(dup), 'A')).toThrow(
      'Heading "A" matches 2 headings: A, a; use page_edit or make the heading unique.',
    );
    const many = '<h1>x</h1><h2>X</h2><h3>x</h3><h4>X</h4><h5>x</h5><h6>X</h6><h2>x</h2>';
    expect(() => findSection(many, parseStorage(many), 'x')).toThrow(
      'Heading "x" matches 7 headings: x, X, x, X, x (and 2 more); use page_edit or make the heading unique.',
    );
  });
});

describe('rowCount', () => {
  it('counts only rows that belong to the table', () => {
    const s =
      '<table><tbody><tr><td><table><tbody><tr><td>x</td></tr></tbody></table></td></tr><tr><td>y</td></tr></tbody></table>';
    const table = parseStorage(s).children[0];
    if (!table || !isTag(table)) throw new Error('expected a table element');
    expect(rowCount(table)).toBe(2);
  });

  it('counts the header row of the fixture table', () => {
    const table = parseStorage(page).children.find((c) => isTag(c) && c.name === 'table');
    if (!table || !isTag(table)) throw new Error('expected a table element');
    expect(rowCount(table)).toBe(4);
  });
});

describe('outline', () => {
  it('outlines headings and tables', () => {
    expect(outline(page)).toBe(
      [
        'h1 Overview',
        '  h2 Budget',
        '    [table 1: 4 rows x 3 cols]',
        '    h3 Notes',
        '  h2 Team',
        '  h2 Left',
        '  h2 Right',
        '  h2 Done',
      ].join('\n'),
    );
  });

  it('numbers nested tables in document order and does not indent tables before the first heading', () => {
    const s =
      '<table><tbody><tr><td>a</td><td><table><tbody><tr><td>n</td></tr><tr><td>m</td></tr></tbody></table></td></tr><tr><td>b</td></tr></tbody></table><h2>H</h2>';
    expect(outline(s)).toBe(['[table 1: 2 rows x 2 cols]', '[table 2: 2 rows x 1 cols]', '  h2 H'].join('\n'));
  });
});
