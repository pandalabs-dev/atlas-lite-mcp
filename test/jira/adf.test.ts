import { describe, expect, it } from 'vitest';
import { markdownToAdf } from '../../src/jira/adf/fromMarkdown.js';
import { adfToMarkdown, type AdfDoc, type AdfNode, type AdfPlaceholder } from '../../src/jira/adf/toMarkdown.js';
import { fixture } from '../helpers/fixtures.js';

const fx = JSON.parse(fixture('jira/issue-rich.json')) as { description: AdfDoc; comments: AdfDoc[] };

const doc = (...content: AdfNode[]): AdfDoc => ({ type: 'doc', version: 1, content });
const p = (...content: AdfNode[]): AdfNode => ({ type: 'paragraph', content });
const t = (text: string, ...marks: string[]): AdfNode =>
  marks.length ? { type: 'text', text, marks: marks.map((type) => ({ type })) } : { type: 'text', text };
const tokens = (...list: AdfPlaceholder[]): Map<number, AdfPlaceholder> => new Map(list.map((x) => [x.n, x]));
const md = (node: AdfNode): string => adfToMarkdown(node).markdown;
const roundTrip = (d: AdfDoc): AdfDoc => {
  const { markdown, placeholders } = adfToMarkdown(d);
  return markdownToAdf(markdown, tokens(...placeholders)).doc;
};

describe('ADF to markdown', () => {
  it('renders supported nodes and tokens', () => {
    const { markdown, placeholders } = adfToMarkdown(fx.description);
    expect(markdown).toContain(
      '## Steps\n\nOpen **login** then *wait* and run `npm test` see [docs](https://x.y) cc {{atlas:1}} [mention: @Ana]',
    );
    expect(markdown).toContain('- one\n- two');
    expect(markdown).toContain('```ts\na < b\n```');
    expect(markdown).toContain('{{atlas:2}} [media: shot.png]\n\n{{atlas:3}} [panel: info, Careful]');
    expect(markdown).toContain('| A | B |\n| --- | --- |\n| 1 | 2 |');
    expect(placeholders.map((x) => [x.n, x.block])).toEqual([[1, false], [2, true], [3, true]]);
    expect(placeholders.map((x) => x.hint)).toEqual(['mention: @Ana', 'media: shot.png', 'panel: info, Careful']);
    expect(placeholders[2]!.original).toBe(fx.description.content[5]);
  });

  it('continues numbering across comments', () => {
    const { markdown, placeholders } = adfToMarkdown(fx.comments[0], 4);
    expect(markdown).toBe('Looks good {{atlas:4}} [card: x.y]');
    expect(placeholders.map((x) => x.n)).toEqual([4]);
    expect(adfToMarkdown(fx.comments[1], 5)).toEqual({ markdown: 'Done', placeholders: [] });
  });

  it('renders nothing for a missing body', () => {
    expect(adfToMarkdown(null)).toEqual({ markdown: '', placeholders: [] });
    expect(adfToMarkdown(undefined)).toEqual({ markdown: '', placeholders: [] });
  });

  it('builds hints without URLs, brackets or newlines', () => {
    const { placeholders } = adfToMarkdown(
      doc(
        p(
          { type: 'emoji', attrs: { shortName: ':smile:' } },
          { type: 'status', attrs: { text: 'IN REVIEW', color: 'blue' } },
          { type: 'date', attrs: { timestamp: '1767225600000' } },
          { type: 'inlineCard', attrs: { url: 'https://example.com/browse/X-1?y=1' } },
          { type: 'mention', attrs: { id: 'u2' } },
          { type: 'placeholder', attrs: { text: 'x' } },
        ),
        { type: 'panel', attrs: { panelType: 'warning' }, content: [p(t('See https://example.com/a/b for [the] long story\nnow'))] },
        { type: 'mediaGroup', content: [{ type: 'media', attrs: { id: 'abc-123', type: 'file', collection: 'c' } }] },
        { type: 'blockCard', attrs: { url: 'https://docs.example.org/page' } },
        { type: 'expand', attrs: { title: 'More' }, content: [p(t('hidden'))] },
      ),
    );
    expect(placeholders.map((x) => [x.hint, x.block])).toEqual([
      ['emoji: :smile:', false],
      ['status: IN REVIEW', false],
      ['date: 2026-01-01', false],
      ['card: example.com', false],
      ['mention', false],
      ['placeholder', false],
      ['panel: warning, See example.com for the long', true],
      ['media: abc-123', true],
      ['card: docs.example.org', true],
      ['expand', true],
    ]);
  });

  it('treats any unsupported node standing at block level as a block token', () => {
    const { markdown, placeholders } = adfToMarkdown(doc(p(t('a')), { type: 'someFutureNode', attrs: {} }));
    expect(markdown).toBe('a\n\n{{atlas:1}} [someFutureNode]');
    expect(placeholders[0]!.block).toBe(true);
  });

  it('escapes markdown syntax in text and at the start of lines', () => {
    expect(md(doc(p(t('# not a heading')), p(t('1. not a list')), p(t('a*b_c `d` [e]')), p(t('- x'), { type: 'hardBreak' }, t('> y'))))).toBe(
      '\\# not a heading\n\n1\\. not a list\n\na\\*b\\_c \\`d\\` \\[e\\]\n\n\\- x\\\n\\> y',
    );
  });

  it('renders hard breaks, strike, nested marks and moves edge spaces outside emphasis', () => {
    const out = md(
      doc(
        p(t('a'), { type: 'hardBreak' }, t('b')),
        p(t('gone', 'strike'), t(' '), t('bold ', 'strong'), t('both', 'strong', 'em'), t(' x')),
        p({ type: 'text', text: 'run', marks: [{ type: 'code' }, { type: 'link', attrs: { href: 'https://e.f/(1)' } }] }),
      ),
    );
    expect(out).toBe('a\\\nb\n\n~~gone~~ **bold *both*** x\n\n[`run`](<https://e.f/(1)>)');
  });

  it('renders ordered lists with their start, nested lists, blockquotes and rules', () => {
    const out = md(
      doc(
        {
          type: 'orderedList',
          attrs: { order: 3 },
          content: [
            { type: 'listItem', content: [p(t('c')), { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('inner'))] }] }] },
            { type: 'listItem', content: [p(t('d'))] },
          ],
        },
        { type: 'blockquote', content: [p(t('q1')), p(t('q2'))] },
        { type: 'rule' },
      ),
    );
    expect(out).toBe('3. c\n   - inner\n4. d\n\n> q1\n>\n> q2\n\n---');
  });

  it('keeps table cells on one line and escapes pipes', () => {
    const cell = (type: string, ...content: AdfNode[]): AdfNode => ({ type, content });
    const out = md(
      doc({
        type: 'table',
        attrs: { layout: 'default' },
        content: [
          { type: 'tableRow', content: [cell('tableHeader', p(t('a|b'))), cell('tableHeader', p(t('c')))] },
          { type: 'tableRow', content: [cell('tableCell', p(t('x'), { type: 'hardBreak' }, t('y')), p(t('z'))), cell('tableCell')] },
        ],
      }),
    );
    expect(out).toBe('| a\\|b | c |\n| --- | --- |\n| x y z |  |');
  });
});

describe('markdown to ADF', () => {
  it('builds valid ADF for supported markdown', () => {
    const { doc: out } = markdownToAdf('# T\n\nA **b** `c` [d](https://e.f)\n\n1. x\n\n```js\ny\n```');
    expect(out).toEqual({
      type: 'doc',
      version: 1,
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'T' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'A ' },
            { type: 'text', text: 'b', marks: [{ type: 'strong' }] },
            { type: 'text', text: ' ' },
            { type: 'text', text: 'c', marks: [{ type: 'code' }] },
            { type: 'text', text: ' ' },
            { type: 'text', text: 'd', marks: [{ type: 'link', attrs: { href: 'https://e.f' } }] },
          ],
        },
        { type: 'orderedList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] }] },
        { type: 'codeBlock', attrs: { language: 'js' }, content: [{ type: 'text', text: 'y' }] },
      ],
    });
  });

  it('keeps the code mark apart from other marks except links, and merges equal neighbours', () => {
    const { doc: out } = markdownToAdf('**a `b` c** [`d`](https://e.f) ~~s~~\\\nnext <b>raw</b>');
    expect(out.content).toEqual([
      p(
        t('a ', 'strong'),
        t('b', 'code'),
        t(' c', 'strong'),
        t(' '),
        { type: 'text', text: 'd', marks: [{ type: 'link', attrs: { href: 'https://e.f' } }, { type: 'code' }] },
        t(' '),
        t('s', 'strike'),
        { type: 'hardBreak' },
        t('next <b>raw</b>'),
      ),
    ]);
  });

  it('starts every list item with a paragraph and uses tableHeader for the first row', () => {
    const { doc: out } = markdownToAdf('- - nested\n\n5. five\n\n| H |  |\n| --- | --- |\n| v | w |');
    expect(out.content).toEqual([
      {
        type: 'bulletList',
        content: [{ type: 'listItem', content: [p(), { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('nested'))] }] }] }],
      },
      { type: 'orderedList', attrs: { order: 5 }, content: [{ type: 'listItem', content: [p(t('five'))] }] },
      {
        type: 'table',
        content: [
          { type: 'tableRow', content: [{ type: 'tableHeader', content: [p(t('H'))] }, { type: 'tableHeader', content: [p()] }] },
          { type: 'tableRow', content: [{ type: 'tableCell', content: [p(t('v'))] }, { type: 'tableCell', content: [p(t('w'))] }] },
        ],
      },
    ]);
  });

  it('turns raw HTML blocks into text, and headings and nested quotes inside quotes into paragraphs', () => {
    const { doc: out } = markdownToAdf('<div>x</div>\n\n> # h\n>\n> > inner');
    expect(out.content).toEqual([p(t('<div>x</div>')), { type: 'blockquote', content: [p(t('h')), p(t('inner'))] }]);
  });

  it('round-trips the fixture description unchanged when tokens are kept', () => {
    const { markdown, placeholders } = adfToMarkdown(fx.description);
    const back = markdownToAdf(markdown, tokens(...placeholders));
    expect(back.doc).toEqual(fx.description);
    expect(back.unknown).toEqual([]);
    expect([...back.used].sort()).toEqual([1, 2, 3]);
  });

  it('round-trips the fixture comments', () => {
    for (const c of fx.comments) expect(roundTrip(c)).toEqual(c);
  });

  it('round-trips escaped text, hard breaks, nested lists and inline tokens in headings and cells', () => {
    const mention: AdfNode = { type: 'mention', attrs: { id: 'u1', text: '@Ana' } };
    const panel: AdfNode = { type: 'panel', attrs: { panelType: 'note' }, content: [p(t('n'))] };
    const original = doc(
      { type: 'heading', attrs: { level: 3 }, content: [t('Hi '), mention] },
      p(t('# a*b_c [d] 1. x'), { type: 'hardBreak' }, t('next line')),
      { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('a')), { type: 'orderedList', content: [{ type: 'listItem', content: [p(t('b'))] }] }] }] },
      {
        type: 'table',
        content: [
          { type: 'tableRow', content: [{ type: 'tableHeader', content: [p(t('k'))] }] },
          { type: 'tableRow', content: [{ type: 'tableCell', content: [panel] }] },
        ],
      },
    );
    expect(roundTrip(original)).toEqual(original);
  });

  it('splits a paragraph when a block token sits inside text', () => {
    const media = fx.description.content[4]!;
    const out = markdownToAdf('before {{atlas:2}} [media: shot.png] after', tokens({ n: 2, hint: 'media: shot.png', block: true, original: media }));
    expect(out.doc.content.map((n) => n.type)).toEqual(['paragraph', 'mediaSingle', 'paragraph']);
    expect(out.doc.content).toEqual([p(t('before')), media, p(t('after'))]);
  });

  it('reports unknown tokens and leaves them out', () => {
    const out = markdownToAdf('x {{atlas:7}} and {{atlas:7}} [gone]\n\n{{atlas:8}} [media: a.png]');
    expect(out.unknown).toEqual([7, 8]);
    expect(out.used.size).toBe(0);
    expect(out.doc.content).toEqual([p(t('x  and'))]);
  });

  it('restores a leading token, dropping only its hint and keeping the text after it', () => {
    const card: AdfNode = { type: 'inlineCard', attrs: { url: 'https://example.com/x' } };
    const map = tokens({ n: 2, hint: 'card: example.com', block: false, original: card });
    expect(markdownToAdf('{{atlas:2}} [card: example.com]', map).doc).toEqual(doc(p(card)));
    expect(markdownToAdf('{{atlas:2}} [card: example.com] and https://example.com/more text', map).doc).toEqual(
      doc(p(card, t(' and '), { type: 'text', text: 'https://example.com/more', marks: [{ type: 'link', attrs: { href: 'https://example.com/more' } }] }, t(' text'))),
    );
  });

  it('drops hints that markdown would autolink or emphasise, and keeps a link after a bare token', () => {
    const card: AdfNode = { type: 'inlineCard', attrs: { url: 'https://example.com/x' } };
    const map = tokens({ n: 1, hint: 'card: example.com', block: false, original: card });
    expect(markdownToAdf('{{atlas:1}} [see www.example.com *now*] ok', map).doc).toEqual(doc(p(card, t(' ok'))));
    expect(markdownToAdf('{{atlas:1}} [docs](https://x.y/d)', map).doc).toEqual(
      doc(p(card, t(' '), { type: 'text', text: 'docs', marks: [{ type: 'link', attrs: { href: 'https://x.y/d' } }] })),
    );
  });

  it('places inline originals without the surrounding marks', () => {
    const mention: AdfNode = { type: 'mention', attrs: { id: 'u1', text: '@Ana' } };
    const out = markdownToAdf('**hi {{atlas:1}} [mention: @Ana]**', tokens({ n: 1, hint: 'mention: @Ana', block: false, original: mention }));
    expect(out.doc).toEqual(doc(p(t('hi ', 'strong'), mention)));
  });

  it('leaves tokens inside code untouched', () => {
    const mention: AdfNode = { type: 'mention', attrs: { id: 'u1', text: '@Ana' } };
    const out = markdownToAdf('`{{atlas:1}} [x]`\n\n```\n{{atlas:1}} [y]\n```', tokens({ n: 1, hint: 'x', block: false, original: mention }));
    expect(out.doc.content).toEqual([p(t('{{atlas:1}} [x]', 'code')), { type: 'codeBlock', content: [t('{{atlas:1}} [y]')] }]);
    expect(out.used.size).toBe(0);
    expect(out.unknown).toEqual([]);
  });

  it('keeps a list item valid when its only token is unknown', () => {
    expect(markdownToAdf('- {{atlas:9}}').doc.content).toEqual([{ type: 'bulletList', content: [{ type: 'listItem', content: [p()] }] }]);
  });

  it('moves a block original out of a heading, after it', () => {
    const panel: AdfNode = { type: 'panel', attrs: { panelType: 'info' }, content: [p(t('x'))] };
    expect(markdownToAdf('## Title {{atlas:1}}', tokens({ n: 1, hint: 'panel: info, x', block: true, original: panel })).doc.content).toEqual([
      { type: 'heading', attrs: { level: 2 }, content: [t('Title')] },
      panel,
    ]);
  });
});
