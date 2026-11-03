import { describe, expect, it } from 'vitest';
import { storageToMarkdown } from '../../../src/confluence/convert/toMarkdown.js';
import { parseStorage } from '../../../src/confluence/storage/dom.js';
import { collectStoragePlaceholders, type StoragePlaceholder } from '../../../src/confluence/storage/placeholders.js';
import { restoreStorageTokens } from '../../../src/confluence/storage/restore.js';
import { appendMarkdown, replaceSection } from '../../../src/confluence/storage/rewrite.js';
import { findSection } from '../../../src/confluence/storage/sections.js';
import { fixture } from '../../helpers/fixtures.js';

const page = fixture('confluence/placeholder-section.xml');
const tokens = (s: string): Map<number, StoragePlaceholder> =>
  new Map(collectStoragePlaceholders(s, parseStorage(s)).map((p) => [p.n, p] as const));
const IMAGE = '<ac:image ac:width="400"><ri:attachment ri:filename="screenshot.png"/></ac:image>';
const TOC = '<ac:structured-macro ac:name="toc" ac:schema-version="1" ac:macro-id="abc"/>';

describe('restoreStorageTokens', () => {
  it('restores block and inline originals and reports used and unknown numbers', () => {
    const r = restoreStorageTokens('<p>{{atlas:1}} [macro: toc]</p><p>{{atlas:2}}</p><p>x {{atlas:2}} [image: a] {{atlas:7}} y</p><p>{{atlas:7}}</p>', tokens(page));
    expect(r.storage).toBe(`${TOC}<p>${IMAGE}</p><p>x ${IMAGE}  y</p>`);
    expect([...r.used].sort()).toEqual([1, 2]);
    expect(r.unknown).toEqual([7]);
  });

  it('leaves tokens inside CDATA code bodies untouched', () => {
    const code = '<ac:structured-macro ac:name="code"><ac:plain-text-body><![CDATA[<p>{{atlas:1}}</p>]]></ac:plain-text-body></ac:structured-macro>';
    const r = restoreStorageTokens(code, tokens(page));
    expect(r.storage).toBe(code);
    expect(r.used.size).toBe(0);
  });
});

describe('replaceSection', () => {
  it('shows the section as markdown with tokens', () => {
    const { start, end } = findSection(page, parseStorage(page), 'Gallery');
    expect(storageToMarkdown(page, { within: { start, end } }).markdown.trim()).toBe(
      'Intro text.\n\n{{atlas:1}} [macro: toc]\n\nSee {{atlas:2}} [image: screenshot.png] above.\n\n- one\n- two **bold**',
    );
  });

  it('writes the section back unchanged when tokens are kept (spec 6.11)', () => {
    const md = 'Intro text.\n\n{{atlas:1}} [macro: toc]\n\nSee {{atlas:2}} [image: screenshot.png] above.\n\n- one\n- two **bold**';
    const r = replaceSection(page, 'Gallery', md, tokens(page));
    expect(r.storage).toBe(page);
    expect(r.dropped).toEqual([]);
    expect(r.unknown).toEqual([]);
  });

  it('reports a removed token as dropped and keeps bytes outside the section', () => {
    const r = replaceSection(page, 'Gallery', 'Intro text.\n\nSee {{atlas:2}} [image: screenshot.png] above.', tokens(page));
    expect(r.dropped.map((d) => d.hint)).toEqual(['macro: toc']);
    expect(r.storage).toBe(`<h2>Gallery</h2><p>Intro text.</p><p>See ${IMAGE} above.</p><h2>Next</h2><p>Tail</p>`);
  });

  it('ignores edited hint text and reports unknown tokens', () => {
    const r = replaceSection(page, 'Gallery', '{{atlas:1}} [whatever]\n\n{{atlas:99}} [x]', tokens(page));
    expect(r.storage).toBe(`<h2>Gallery</h2>${TOC}<h2>Next</h2><p>Tail</p>`);
    expect(r.unknown).toEqual([99]);
    expect(r.dropped.map((d) => d.n)).toEqual([2]);
  });

  it('drops a hint that markdown would autolink or emphasise, keeping the text after it', () => {
    const r = replaceSection(page, 'Gallery', '{{atlas:2}} [card: www.example.com *x] and https://example.com/more text', tokens(page));
    expect(r.storage).toBe(
      `<h2>Gallery</h2><p>${IMAGE} and <a href="https://example.com/more">https://example.com/more</a> text</p><h2>Next</h2><p>Tail</p>`,
    );
    expect(r.unknown).toEqual([]);
  });

  it('keeps a markdown link that follows a bare token', () => {
    const r = replaceSection(page, 'Gallery', '{{atlas:2}} [docs](https://x.y/d)\n\n{{atlas:2}} [ref][d]\n\n[d]: https://x.y/r', tokens(page));
    expect(r.storage).toBe(
      `<h2>Gallery</h2><p>${IMAGE} <a href="https://x.y/d">docs</a></p><p>${IMAGE} <a href="https://x.y/r">ref</a></p><h2>Next</h2><p>Tail</p>`,
    );
    expect(r.unknown).toEqual([]);
  });

  it('keeps the rich page byte-identical outside the targeted section', () => {
    const rich = fixture('confluence/rich-page.xml');
    const { start, end } = findSection(rich, parseStorage(rich), 'Left');
    const r = replaceSection(rich, 'Left', 'Ana and Ivan\n\n{{atlas:6}} [image: ana.png]', tokens(rich));
    expect(r.storage.slice(0, start)).toBe(rich.slice(0, start));
    expect(r.storage.slice(r.storage.length - (rich.length - end))).toBe(rich.slice(end));
    expect(r.storage.slice(start, r.storage.length - (rich.length - end))).toBe(
      '<p>Ana and Ivan</p><ac:image ac:width="200"><ri:attachment ri:filename="ana.png"/></ac:image>',
    );
    expect(r.dropped).toEqual([]);
  });
});

describe('appendMarkdown', () => {
  it('appends converted markdown and restores tokens copied from the page', () => {
    const r = appendMarkdown(page, 'More {{atlas:2}} [image: screenshot.png]', tokens(page));
    expect(r.storage).toBe(`${page}<p>More ${IMAGE}</p>`);
    expect(r.unknown).toEqual([]);
    expect(appendMarkdown(page, 'x {{atlas:99}}', tokens(page)).unknown).toEqual([99]);
  });
});
