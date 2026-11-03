import { describe, expect, it } from 'vitest';
import { storageToMarkdown } from '../../../src/confluence/convert/toMarkdown.js';
import { collectStoragePlaceholders } from '../../../src/confluence/storage/placeholders.js';
import { parseStorage } from '../../../src/confluence/storage/dom.js';
import { fixture } from '../../helpers/fixtures.js';

const page = fixture('confluence/rich-page.xml');
const md = (s: string): string => storageToMarkdown(s).markdown;

describe('storage to markdown', () => {
  it('numbers placeholders over the whole body in document order', () => {
    const { placeholders } = storageToMarkdown(page);
    expect(placeholders.map((x) => [x.n, x.hint, x.block])).toEqual([
      [1, 'macro: toc', true],
      [2, 'status: ON TRACK', false],
      [3, 'emoticon: smile', false],
      [4, 'panel: info, Budget is frozen.', true],
      [5, 'status: TBD', false],
      [6, 'image: ana.png', true],
      [7, 'tasks: 1', true],
    ]);
    const toc = placeholders[0]!;
    expect(page.slice(toc.start, toc.end)).toBe('<ac:structured-macro ac:name="toc" ac:schema-version="1" ac:macro-id="m-toc"/>');
    expect(toc.original).toBe(page.slice(toc.start, toc.end));
    expect(collectStoragePlaceholders(page, parseStorage(page))).toEqual(placeholders);
  });

  it('renders standard elements and tokens', () => {
    const out = md(page);
    expect(out).toContain(
      '# Overview\n\n{{atlas:1}} [macro: toc]\n\nStatus: {{atlas:2}} [status: ON TRACK] for R&D team {{atlas:3}} [emoticon: smile]',
    );
    expect(out).toContain('| **Item** | **Q1 2026** | **Q2** |\n| --- | --- | --- |\n| Hosting | 100 | 120 |');
    expect(out).toContain('See [the sheet](https://example.com/a?b=1&c=2) and `cfg.json`.');
    expect(out).toContain('```ts\nif (a < b && c) {}\n```');
    expect(out).toContain('## Left\n\nAna\n\n{{atlas:6}} [image: ana.png]');
    expect(out).toContain('Marko\n\n## Done\n\n{{atlas:7}} [tasks: 1]');
    expect(out).not.toMatch(/ac:|ri:|<\/?p>/);
  });

  it('renders only nodes inside a range while keeping page-wide numbers', () => {
    const start = page.indexOf('<h2>Left</h2>') + '<h2>Left</h2>'.length;
    const end = page.indexOf('</ac:layout-cell>');
    const r = storageToMarkdown(page, { within: { start, end } });
    expect(r.markdown.trim()).toBe('Ana\n\n{{atlas:6}} [image: ana.png]');
    expect(r.placeholders).toHaveLength(7);
  });

  it('renders a whole table range as a GFM table', () => {
    const start = page.indexOf('<table');
    const end = page.indexOf('</table>') + '</table>'.length;
    expect(storageToMarkdown(page, { within: { start, end } }).markdown).toBe(
      [
        '| **Item** | **Q1 2026** | **Q2** |',
        '| --- | --- | --- |',
        '| Hosting | 100 | 120 |',
        '| Licences | **40** | 40 |',
        '| Support | {{atlas:5}} [status: TBD] |  |',
      ].join('\n'),
    );
  });

  it('keeps a code macro with parameters other than language as a placeholder', () => {
    const s =
      '<ac:structured-macro ac:name="code"><ac:parameter ac:name="title">x</ac:parameter><ac:plain-text-body><![CDATA[a]]></ac:plain-text-body></ac:structured-macro>';
    expect(md(s).trim()).toBe('{{atlas:1}} [macro: code]');
  });

  it('fences a code macro only at block level and tokenises it inside cells and paragraphs', () => {
    const code = '<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">ts</ac:parameter><ac:plain-text-body><![CDATA[x = 1\ny = 2]]></ac:plain-text-body></ac:structured-macro>';
    const s = `<table><tbody><tr><td>${code}</td></tr></tbody></table><p>see ${code}</p><ul><li>${code}</li></ul>`;
    const r = storageToMarkdown(s);
    expect(r.markdown).toBe('| {{atlas:1}} [macro: code] |\n| --- |\n\nsee {{atlas:2}} [macro: code]\n\n- ```ts\n  x = 1\n  y = 2\n  ```');
    expect(r.placeholders.map((x) => [x.n, x.block, x.original])).toEqual([
      [1, true, code],
      [2, false, code],
    ]);
  });

  it('renders a code macro without a language as a plain fence', () => {
    const s = '<ac:structured-macro ac:name="code"><ac:plain-text-body><![CDATA[a  ``` b]]></ac:plain-text-body></ac:structured-macro>';
    expect(md(s)).toBe('````\na  ``` b\n````');
    expect(storageToMarkdown(s).placeholders).toEqual([]);
  });

  it('escapes pipes inside table cells and markdown specials in text', () => {
    expect(md('<table><tbody><tr><th>a|b</th></tr><tr><td>1*2</td></tr></tbody></table>')).toContain('| a\\|b |\n| --- |\n| 1\\*2 |');
    expect(md('<p>a_b [c] `d` \\ *e*</p>')).toBe('a\\_b \\[c\\] \\`d\\` \\\\ \\*e\\*');
  });

  it('renders inline marks, breaks, rules, quotes and pre blocks', () => {
    expect(md('<p><strong>b </strong><em>i</em> <s>s</s> <del>d</del> <b>x</b> <i>y</i></p>')).toBe('**b** *i* ~~s~~ ~~d~~ **x** *y*');
    expect(md('<p>one<br/>two</p><hr/><blockquote><p>q1</p><p>q2</p></blockquote>')).toBe('one\\\ntwo\n\n---\n\n> q1\n>\n> q2');
    expect(md('<pre>a  &lt;b&gt;\n  c\n</pre>')).toBe('```\na  <b>\n  c\n```');
    expect(md('<h3>T&nbsp;x</h3><p><span>in <u>span</u></span></p>')).toBe('### T x\n\nin span');
  });

  it('renders br as a CommonMark hard break, dropped at paragraph edges and flattened in cells', () => {
    expect(md('<p>a<br/>b<br/>c</p>')).toBe('a\\\nb\\\nc');
    expect(md('<p><br/>a<br/></p>')).toBe('a');
    expect(md('<p>a\\<br/>b</p>')).toBe('a\\\\\\\nb');
    expect(md('<ul><li>a<br/>b</li></ul>')).toBe('- a\\\n  b');
    expect(md('<table><tbody><tr><td>a<br/>b</td></tr></tbody></table>')).toBe('| a b |\n| --- |');
    expect(md('<p><strong>Title<br/></strong>rest</p>')).toBe('**Title**\\\nrest');
    expect(md('<p>x <em>a<br/></em> y</p>')).toBe('x *a*\\\ny');
    expect(md('<p>a<em><br/> b</em></p>')).toBe('a\\\n*b*');
    expect(md('<p><strong>a\\<br/></strong>b</p>')).toBe('**a\\\\**\\\nb');
  });

  it('escapes line-start block markers at paragraph start and after a hard break', () => {
    expect(md('<p>1. Scope</p><p>- dash</p><p>&gt; quote</p>')).toBe('1\\. Scope\n\n\\- dash\n\n\\> quote');
    expect(md('<p>## h</p><p>+ plus</p><p>2) two</p><p>a<br/>---<br/>===<br/>- x</p>')).toBe(
      '\\## h\n\n\\+ plus\n\n2\\) two\n\na\\\n\\---\\\n\\===\\\n\\- x',
    );
    expect(md('<ul><li><p>1. nested</p></li></ul><blockquote><p>- q</p></blockquote>')).toBe('- 1\\. nested\n\n> \\- q');
    expect(md('<p>#tag 1.5 -x a - b</p><h2>1. Intro</h2>')).toBe('#tag 1.5 -x a - b\n\n## 1. Intro');
  });

  it('renders nested lists indented under their item', () => {
    expect(md('<ul><li><p>one</p><ul><li><p>two</p></li></ul></li><li>three</li></ul>')).toBe('- one\n  - two\n- three');
    expect(md('<ol><li>a<ol><li>b</li></ol></li><li>c</li></ol>')).toBe('1. a\n   1. b\n2. c');
  });

  it('builds hints for links, dates, comments, external images and unknown elements without URLs', () => {
    const s =
      '<p><ac:link><ri:page ri:content-title="Roadmap [Q1]"/></ac:link> <time datetime="2026-01-02"/> ' +
      '<ac:inline-comment-marker ac:ref="r1">note</ac:inline-comment-marker> ' +
      '<ac:image><ri:url ri:value="https://img.example.com/a.png?x=1&amp;y=2"/></ac:image> <ac:placeholder>Type here</ac:placeholder></p>' +
      '<ac:structured-macro ac:name="warning"><ac:rich-text-body><p>See https://example.com/very/long/path for the details of this</p></ac:rich-text-body></ac:structured-macro>';
    const { markdown, placeholders } = storageToMarkdown(s);
    expect(placeholders.map((x) => [x.hint, x.block])).toEqual([
      ['link: Roadmap Q1', false],
      ['date: 2026-01-02', false],
      ['comment', false],
      ['image: img.example.com', false],
      ['ac:placeholder', false],
      ['panel: warning, See example.com for the detail', true],
    ]);
    expect(markdown).not.toMatch(/https?:/);
    expect(markdown).toContain('{{atlas:4}} [image: img.example.com]');
  });

  it('marks placeholders block by their parent', () => {
    const s =
      '<ac:layout><ac:layout-section><ac:layout-cell><ac:emoticon ac:name="a"/></ac:layout-cell></ac:layout-section></ac:layout>' +
      '<table><tbody><tr><td><ac:emoticon ac:name="b"/></td></tr></tbody></table><ul><li><ac:emoticon ac:name="c"/></li></ul>' +
      '<blockquote><ac:emoticon ac:name="d"/></blockquote><p><ac:emoticon ac:name="e"/></p>';
    expect(storageToMarkdown(s).placeholders.map((x) => [x.hint, x.block])).toEqual([
      ['emoticon: a', true],
      ['emoticon: b', true],
      ['emoticon: c', true],
      ['emoticon: d', true],
      ['emoticon: e', false],
    ]);
  });
});
