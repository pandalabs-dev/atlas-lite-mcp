import { describe, expect, it } from 'vitest';
import { storageToMarkdown } from '../../../src/confluence/convert/toMarkdown.js';
import { parseStorage } from '../../../src/confluence/storage/dom.js';
import { collectStoragePlaceholders } from '../../../src/confluence/storage/placeholders.js';
import { replaceSection } from '../../../src/confluence/storage/rewrite.js';
import { findSection } from '../../../src/confluence/storage/sections.js';

const panel = (body: string): string => `<ac:structured-macro ac:name="info"><ac:rich-text-body>${body}</ac:rich-text-body></ac:structured-macro>`;
const layout = (left: string, right: string): string => `<ac:layout><ac:layout-section ac:type="two_equal"><ac:layout-cell>${left}</ac:layout-cell><ac:layout-cell>${right}</ac:layout-cell></ac:layout-section></ac:layout>`;
const image = '<ac:image><ri:attachment ri:filename="keep.png"/></ac:image>';
const mapFor = (page: string) => new Map(collectStoragePlaceholders(page, parseStorage(page)).map((p) => [p.n, p]));
const read = (page: string, heading: string) => storageToMarkdown(page, { within: findSection(page, parseStorage(page), heading) });

describe('nested rich-content section preservation', () => {
  it('round-trips a heading inside a panel without duplicating its enclosing macro', () => {
    const page = panel('<h2>Inner</h2><p>Keep me</p>');
    const view = read(page, 'Inner');
    expect(view.markdown).toBe('Keep me');
    expect(replaceSection(page, 'Inner', view.markdown, mapFor(page))).toEqual({ storage: page, dropped: [], unknown: [] });
  });

  it('keeps a full two-column layout and nested panel through an enclosing section rewrite', () => {
    const page = `<h2>Section</h2>${layout(panel(`<p>Left ${image}</p>`), '<p>Right</p>')}<h2>Next</h2>`;
    const view = read(page, 'Section');
    expect(view.markdown).toBe('{{atlas:1}} [layout]');
    expect(view.placeholders.map((p) => p.hint)).toEqual(['layout', 'panel: info, Left', 'image: keep.png']);
    expect(replaceSection(page, 'Section', view.markdown, mapFor(page))).toEqual({ storage: page, dropped: [], unknown: [] });
    expect(replaceSection(page, 'Section', 'Replacement', mapFor(page)).dropped.map((p) => p.hint)).toEqual(['layout']);
  });

  it('descends through nested panels in a layout cell with stable page-wide token numbers', () => {
    const page = layout(panel(panel(`<h2>Inner</h2><p>Keep ${image}</p>`)), '<p>Other cell</p>');
    const view = read(page, 'Inner');
    expect(view.markdown).toBe('Keep {{atlas:4}} [image: keep.png]');
    expect(view.placeholders).toEqual(storageToMarkdown(page).placeholders);
    expect(replaceSection(page, 'Inner', view.markdown, mapFor(page)).storage).toBe(page);
    const changed = replaceSection(page, 'Inner', view.markdown.replace('Keep', 'Updated'), mapFor(page));
    expect(changed.storage).toBe(page.replace('<p>Keep ', '<p>Updated '));
    expect(changed.dropped).toEqual([]);
  });

  it('rejects restoring an enclosing layout or panel into its own section', () => {
    const page = layout(panel('<h2>Inner</h2><p>Keep</p>'), '<p>Other cell</p>');
    for (const n of [1, 2]) expect(() => replaceSection(page, 'Inner', `{{atlas:${n}}}`, mapFor(page))).toThrow(/outside.*section/);
  });

  it('reports only removed nested content when editing inside a panel', () => {
    const page = panel(`<h2>Inner</h2><p>Keep ${image}</p>`);
    expect(replaceSection(page, 'Inner', 'New text', mapFor(page)).dropped.map((p) => p.hint)).toEqual(['image: keep.png']);
  });

  it('restores original macro markup atomically even when it contains token-like text', () => {
    const page = `<h2>Section</h2>${panel('<p>Literal {{atlas:2}}</p>')}${image}<h2>Next</h2>`;
    const view = read(page, 'Section');
    expect(replaceSection(page, 'Section', view.markdown, mapFor(page)).storage).toBe(page);
  });
});
