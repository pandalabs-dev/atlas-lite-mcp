import { type Element, isTag } from 'domhandler';
import { describe, expect, it } from 'vitest';
import { escapeXml, innerRange, openTag, openTagEnd, parseStorage, textOf } from '../../../src/confluence/storage/dom.js';
import { fixture } from '../../helpers/fixtures.js';

const page = fixture('confluence/rich-page.xml');

describe('storage dom helpers', () => {
  it('textOf decodes entities and nbsp and collapses whitespace', () => {
    const doc = parseStorage('<p> R&amp;D&nbsp;team\n x </p>');
    expect(textOf(doc.children[0]!)).toBe('R&D team x');
  });

  it('textOf includes CDATA bodies without decoding them twice', () => {
    const doc = parseStorage('<ac:plain-text-body><![CDATA[if (a < b && c) {}]]></ac:plain-text-body>');
    expect(textOf(doc.children[0]!)).toBe('if (a < b && c) {}');
  });

  it('innerRange and openTag respect quotes containing >', () => {
    const src = '<p title="a>b">x</p><p/>';
    const [p1, p2] = parseStorage(src).children as [Element, Element];
    const r = innerRange(src, p1);
    expect(r).not.toBeNull();
    expect(src.slice(r!.start, r!.end)).toBe('x');
    expect(openTag(src, p1)).toBe('<p title="a>b">');
    expect(openTagEnd(src, p1)).toBe('<p title="a>b">'.length);
    expect(innerRange(src, p2)).toBeNull();
    expect(openTag(src, p2)).toBe('<p>');
  });

  it('offsets point into the original fixture string', () => {
    const doc = parseStorage(page);
    const table = doc.children.find((n): n is Element => isTag(n) && n.name === 'table');
    expect(table).toBeDefined();
    expect(openTag(page, table!)).toBe('<table data-layout="default">');
    const r = innerRange(page, table!)!;
    expect(page.slice(r.start, r.end).startsWith('<colgroup>')).toBe(true);
    expect(page.slice(r.end, table!.endIndex! + 1)).toBe('</table>');
    expect(textOf(table!)).toContain('Q1 2026');
  });

  it('escapeXml escapes ampersand, angle brackets and double quotes', () => {
    expect(escapeXml('a & b < c > d "e"')).toBe('a &amp; b &lt; c &gt; d &quot;e&quot;');
  });
});
