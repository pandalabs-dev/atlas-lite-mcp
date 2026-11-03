import { describe, expect, it } from 'vitest';
import { assertWellFormed, findReplace } from '../../../src/confluence/storage/edit.js';
import { fixture } from '../../helpers/fixtures.js';

const page = fixture('confluence/rich-page.xml');

describe('findReplace', () => {
  it('replaces exactly one match and leaves every other byte identical', () => {
    const r = findReplace(page, '<p>Numbers in CHF.</p>', '<p>Numbers in EUR.</p>', false);
    expect(r.count).toBe(1);
    const i = page.indexOf('<p>Numbers in CHF.</p>');
    expect(r.storage.slice(0, i)).toBe(page.slice(0, i));
    expect(r.storage.slice(i, i + '<p>Numbers in EUR.</p>'.length)).toBe('<p>Numbers in EUR.</p>');
    expect(r.storage.slice(i + '<p>Numbers in EUR.</p>'.length)).toBe(page.slice(i + '<p>Numbers in CHF.</p>'.length));
  });

  it('errors on zero matches with the storage hint', () => {
    expect(() => findReplace(page, 'Budget is frozen', 'x', false)).toThrow(
      'No match for the find text. Text seen in markdown may be split by inline markup or entities; call page_get with format "storage" or a section to copy the exact markup.',
    );
  });

  it('errors on several matches without all, showing the count and up to three contexts', () => {
    expect(() => findReplace(page, '<td><p>1', 'x', false)).toThrow(
      /^Found 2 matches; pass all: true or use a longer find text\. Matches: "/,
    );
  });

  it('shows at most three contexts with newlines collapsed', () => {
    let message = '';
    try {
      findReplace(page, 'ac:schema-version="1"', 'x', false);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message.startsWith('Found 5 matches; pass all: true or use a longer find text. Matches: "')).toBe(true);
    expect(message.match(/ac:schema-version="1"/g)?.length).toBe(3);
    expect(message).not.toContain('\n');
    expect(message).toContain('ac:name="toc" ac:schema-version="1" ac:macro-id="m-toc"/> <p>Stat..."');
  });

  it('replaces a single match with all: true and reports the count', () => {
    const r = findReplace(page, '<p>Hosting</p>', '<p>Web hosting</p>', true);
    expect(r.count).toBe(1);
    expect(r.storage).toBe(page.replace('<p>Hosting</p>', '<p>Web hosting</p>'));
  });

  it('replaces every match with all: true', () => {
    const r = findReplace(page, 'ac:schema-version="1"', 'ac:schema-version="2"', true);
    expect(r.count).toBe(5);
    expect(r.storage).toBe(page.split('ac:schema-version="1"').join('ac:schema-version="2"'));
  });

  it('counts non-overlapping occurrences', () => {
    const r = findReplace('<p>aaaa</p>', 'aa', 'b', true);
    expect(r.count).toBe(2);
    expect(r.storage).toBe('<p>bb</p>');
  });

  it('falls back to the XML-escaped form and escapes replace the same way', () => {
    const r = findReplace(page, 'R&D', 'R&D & Ops', false);
    expect(r.count).toBe(1);
    expect(r.storage).toContain('for R&amp;D &amp; Ops&nbsp;team');
    expect(r.storage).toBe(page.replace('R&amp;D', 'R&amp;D &amp; Ops'));
  });

  it('uses the literal form and leaves replace unescaped when the literal matches', () => {
    const r = findReplace(page, 'b=1&amp;c=2', 'b=1&amp;c=3', false);
    expect(r.count).toBe(1);
    expect(r.storage).toContain('href="https://example.com/a?b=1&amp;c=3"');
  });

  it('rejects empty find', () => {
    expect(() => findReplace(page, '', 'x', false)).toThrow('find must not be empty.');
  });
});

describe('assertWellFormed', () => {
  it('accepts the fixture and rejects broken markup', () => {
    expect(() => assertWellFormed(page)).not.toThrow();
    expect(() => assertWellFormed('<p>a<strong>b</p>')).toThrow(/^Edit would produce malformed XML \(.+\); nothing was written\.$/);
    expect(() => assertWellFormed('<p>a & b</p>')).toThrow(/malformed XML/);
  });
});
