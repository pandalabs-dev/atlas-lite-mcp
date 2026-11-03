import { describe, expect, it } from 'vitest';
import { markdownToStorage } from '../../../src/confluence/convert/fromMarkdown.js';
import { storageToMarkdown } from '../../../src/confluence/convert/toMarkdown.js';
import { parseMarkdown } from '../../../src/markdown/parse.js';
import { fixture } from '../../helpers/fixtures.js';

describe('parseMarkdown', () => {
  it('parses GFM tables, strikethrough and autolinks', () => {
    const tree = parseMarkdown('| A |\n|---|\n| 1 |\n\n~~x~~ www.example.com');
    expect(tree.children.map((n) => n.type)).toEqual(['table', 'paragraph']);
    const para = tree.children[1];
    expect(para?.type === 'paragraph' ? para.children.map((n) => n.type) : []).toEqual(['delete', 'text', 'link']);
  });
});

describe('markdown to storage', () => {
  it('emits clean XHTML for standard markdown', () => {
    expect(markdownToStorage('## Plan\n\nA **b** *c* `d` [e](https://x.y/?a=1&b=2)')).toBe(
      '<h2>Plan</h2><p>A <strong>b</strong> <em>c</em> <code>d</code> <a href="https://x.y/?a=1&amp;b=2">e</a></p>',
    );
    expect(markdownToStorage('- one\n  - two')).toBe('<ul><li><p>one</p><ul><li><p>two</p></li></ul></li></ul>');
    expect(markdownToStorage('| A | B |\n|---|---|\n| 1 | 2 |')).toBe(
      '<table><tbody><tr><th><p>A</p></th><th><p>B</p></th></tr><tr><td><p>1</p></td><td><p>2</p></td></tr></tbody></table>',
    );
  });

  it('emits fenced code as a code macro with CDATA, splitting ]]>', () => {
    expect(markdownToStorage('```ts\na ]]> b\n```')).toBe(
      '<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">ts</ac:parameter><ac:plain-text-body><![CDATA[a ]]]]><![CDATA[> b]]></ac:plain-text-body></ac:structured-macro>',
    );
  });

  it('omits the language parameter when the fence has none', () => {
    expect(markdownToStorage('```\nx\n```')).toBe(
      '<ac:structured-macro ac:name="code"><ac:plain-text-body><![CDATA[x]]></ac:plain-text-body></ac:structured-macro>',
    );
  });

  it('escapes XML specials and raw HTML in text', () => {
    expect(markdownToStorage('a < b & <script>x</script>')).toBe('<p>a &lt; b &amp; &lt;script&gt;x&lt;/script&gt;</p>');
    expect(markdownToStorage('<div>\nhi\n</div>')).toBe('<p>&lt;div&gt; hi &lt;/div&gt;</p>');
  });

  it('emits ordered lists, strikethrough, quotes, rules, breaks and images', () => {
    expect(markdownToStorage('1. a\n2. b')).toBe('<ol><li><p>a</p></li><li><p>b</p></li></ol>');
    expect(markdownToStorage('~~old~~ new')).toBe('<p><s>old</s> new</p>');
    expect(markdownToStorage('> quoted')).toBe('<blockquote><p>quoted</p></blockquote>');
    expect(markdownToStorage('a\n\n---\n\nb')).toBe('<p>a</p><hr/><p>b</p>');
    expect(markdownToStorage('a\\\nb')).toBe('<p>a<br/>b</p>');
    expect(markdownToStorage('a\nb')).toBe('<p>a b</p>');
    expect(markdownToStorage('![shot](https://x.y/s.png)')).toBe('<p><a href="https://x.y/s.png">shot</a></p>');
  });

  it('resolves reference links through their definitions', () => {
    expect(markdownToStorage('See [docs][d].\n\n[d]: https://x.y/d')).toBe('<p>See <a href="https://x.y/d">docs</a>.</p>');
  });

  it('keeps task-list boxes and footnotes as visible text', () => {
    expect(markdownToStorage('- [x] done\n- [ ] open')).toBe('<ul><li><p>[x] done</p></li><li><p>[ ] open</p></li></ul>');
    expect(markdownToStorage('a[^1]\n\n[^1]: note')).toBe('<p>a[^1]</p><p>note</p>');
  });

  it('round-trips the clean fixture byte for byte', () => {
    const clean = fixture('confluence/clean-section.xml');
    expect(markdownToStorage(storageToMarkdown(clean).markdown)).toBe(clean);
  });

  it('round-trips text with &, < and | through storage and back', () => {
    const md = '| a |\n| --- |\n| x \\| y & <z> |';
    expect(storageToMarkdown(markdownToStorage(md)).markdown.trim()).toBe(md);
  });

  it('round-trips escaped line-start markers and hard breaks', () => {
    const md = '1\\. not a list\\\n\\- nor this';
    expect(markdownToStorage(md)).toBe('<p>1. not a list<br/>- nor this</p>');
    expect(storageToMarkdown(markdownToStorage(md)).markdown).toBe(md);
  });
});
