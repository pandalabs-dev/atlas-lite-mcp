import { describe, expect, it } from 'vitest';
import { spaceKeyForId } from '../../../src/confluence/api.js';
import { confluenceModule } from '../../../src/confluence/module.js';
import { pageTools } from '../../../src/confluence/tools/pages.js';
import { executeTool, type ToolDef } from '../../../src/core/tools.js';
import type { Route } from '../../helpers/fetch.js';
import { fixture } from '../../helpers/fixtures.js';
import { testRuntime } from '../../helpers/runtime.js';

const page = fixture('confluence/rich-page.xml');
const PAGE = '/wiki/api/v2/pages/7';

const routes: Route[] = [
  {
    method: 'GET',
    path: PAGE,
    json: { id: '7', title: 'Costs', spaceId: '100', version: { number: 13 }, body: { storage: { value: page } }, _links: { webui: '/spaces/DOCS/pages/7/Costs' } },
  },
  { method: 'GET', path: '/wiki/api/v2/spaces/100', json: { id: '100', key: 'DOCS' } },
  { method: 'PUT', path: PAGE, json: { version: { number: 14 } } },
];

function byName(name: string): ToolDef {
  const def = pageTools.find((t) => t.name === name);
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

function lastPut(calls: { method: string; body: any }[]): any {
  const put = calls.filter((c) => c.method === 'PUT').at(-1);
  if (put === undefined) throw new Error('no PUT');
  return put.body;
}

describe('page_get', () => {
  it('page_get markdown starts with a header line', async () => {
    const r = await run('page_get', { url: 'https://northstar.atlassian.net/wiki/spaces/DOCS/pages/7/Costs' });
    expect(r.isError).toBe(false);
    expect(r.text.split('\n').slice(0, 3)).toEqual(['# Costs', 'Page 7 in DOCS, v13', '']);
    expect(r.text).toContain('{{atlas:1}} [macro: toc]');
  });

  it('page_get section shows only that section with page-wide numbers', async () => {
    expect((await run('page_get', { id: '7', section: 'left' })).text).toBe('# Costs > Left\nPage 7 in DOCS, v13\n\nAna\n\n{{atlas:7}} [image: ana.png]');
  });

  it('page_get outline and storage', async () => {
    expect((await run('page_get', { id: '7', format: 'outline' })).text).toContain('    [table 1: 4 rows x 3 cols]');
    expect((await run('page_get', { id: '7', format: 'storage' })).text).toContain('ac:macro-id="m-toc"');
  });

  it('page_get storage with a section returns that section markup only', async () => {
    const r = await run('page_get', { id: '7', format: 'storage', section: 'Right' });
    expect(r.text).toBe('# Costs > Right\nPage 7 in DOCS, v13\n\n<p>Marko</p>');
  });

  it('page_get refuses a section with the outline format', async () => {
    expect(await run('page_get', { id: '7', format: 'outline', section: 'Left' })).toEqual({ text: 'Pass section with format markdown or storage, not outline.', isError: true });
  });

  it('page_get lists the headings when the section is missing', async () => {
    const r = await run('page_get', { id: '7', section: 'Nope' });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/^No heading "Nope"\. Headings: Overview, Budget/);
  });

  it('page_get requires url or id', async () => {
    expect(await run('page_get', {})).toEqual({ text: 'Pass url or id.', isError: true });
  });
});

describe('spaceKeyForId', () => {
  it('caches the space key per site and space id', async () => {
    const { rt, calls } = testRuntime(routes);
    const srt = rt.resolve({});
    expect(await spaceKeyForId(srt, '100')).toBe('DOCS');
    expect(await spaceKeyForId(srt, '100')).toBe('DOCS');
    expect(calls.filter((c) => c.url.includes('/spaces/'))).toHaveLength(1);
    expect(srt.cache.get('confluence:spaceKey:northstar:100')).toBe('DOCS');
  });
});

describe('page_edit', () => {
  it('page_edit returns count and versions and sends only the changed body', async () => {
    const { text, calls } = await runWithCalls('page_edit', { url: '7', find: 'Numbers in CHF.', replace: 'Numbers in EUR.' });
    expect(text).toBe('Updated "Costs" v13 -> v14 (1 replacement)');
    const body = lastPut(calls);
    expect(body.body.value).toBe(page.replace('Numbers in CHF.', 'Numbers in EUR.'));
    expect(body.version).toEqual({ number: 14, message: 'atlas-lite-mcp page_edit' });
  });

  it('page_edit counts every replacement with all', async () => {
    const { text, calls } = await runWithCalls('page_edit', { url: '7', find: '40', replace: '45', all: true });
    expect(text).toBe('Updated "Costs" v13 -> v14 (2 replacements)');
    expect(lastPut(calls).body.value).toBe(page.replaceAll('40', '45'));
    const several = await run('page_edit', { url: '7', find: '40', replace: '45' });
    expect(several.isError).toBe(true);
    expect(several.text).toMatch(/^Found 2 matches; pass all: true/);
  });

  it('page_edit says so when the replacement leaves the page as it was', async () => {
    const { text, isError, calls } = await runWithCalls('page_edit', { url: '7', find: 'Numbers in CHF.', replace: 'Numbers in CHF.' });
    expect({ text, isError }).toEqual({ text: 'No change to "Costs" (v13)', isError: false });
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
  });

  it('rejects a URL whose host is not the given site', async () => {
    const r = await run('page_edit', { url: 'https://bluebird.atlassian.net/wiki/pages/viewpage.action?pageId=7', find: 'a', replace: 'b', site: 'northstar' });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('bluebird.atlassian.net');
  });
});

describe('page_update_section', () => {
  it.each([
    '<ac:structured-macro ac:name="info"><ac:rich-text-body><h2>Inner</h2><p>Keep</p></ac:rich-text-body></ac:structured-macro>',
    '<h2>Inner</h2><ac:layout><ac:layout-section ac:type="two_equal"><ac:layout-cell><p>Left</p></ac:layout-cell><ac:layout-cell><p>Right</p></ac:layout-cell></ac:layout-section></ac:layout>',
  ])('does not PUT an unchanged rich section after a real tool read', async (storage) => {
    const { rt, calls } = testRuntime([
      { method: 'GET', path: PAGE, json: { id: '7', title: 'Rich', spaceId: '100', version: { number: 13 }, body: { storage: { value: storage } } } },
      ...routes.slice(1),
    ]);
    const read = await executeTool(byName('page_get'), { id: '7', section: 'Inner' }, rt);
    expect(read.isError).toBe(false);
    const result = await executeTool(byName('page_update_section'), { url: '7', heading: 'Inner', markdown: read.text.split('\n').slice(3).join('\n') }, rt);
    expect(result).toEqual({ text: 'No change to section "Inner" in "Rich" (v13)', isError: false });
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('rejects enclosing layout tokens without making a PUT request', async () => {
    const { text, isError, calls } = await runWithCalls('page_update_section', { url: '7', heading: 'Left', markdown: '{{atlas:6}}' });
    expect(isError).toBe(true);
    expect(text).toMatch(/outside this section/);
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('page_update_section restores tokens and reports drops', async () => {
    const { text, calls } = await runWithCalls('page_update_section', { url: '7', heading: 'Left', markdown: 'Ana and Ivan' });
    expect(text).toBe('Updated section "Left" in "Costs" v13 -> v14\nDropped: 1 item: [image: ana.png]');
    const body = lastPut(calls);
    expect(body.body.value).toBe(page.replace('<p>Ana</p><ac:image ac:width="200"><ri:attachment ri:filename="ana.png"/></ac:image>', '<p>Ana and Ivan</p>'));
    expect(body.version.message).toBe('atlas-lite-mcp page_update_section');
  });

  it('restores tokens in a fresh runtime that never served page_get', async () => {
    const { rt, calls } = testRuntime(routes);
    const r = await executeTool(byName('page_update_section'), { url: '7', heading: 'Left', markdown: 'Ana\n\n{{atlas:7}} [image: ana.png]' }, rt);
    expect(r).toEqual({ text: 'No change to section "Left" in "Costs" (v13)', isError: false });
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
  });

  it('restores tokens after page_get in the same runtime', async () => {
    const { rt, calls } = testRuntime(routes);
    await executeTool(byName('page_get'), { id: '7', section: 'Left' }, rt);
    const r = await executeTool(byName('page_update_section'), { url: '7', heading: 'Left', markdown: 'Ana and Ivan\n\n{{atlas:7}} [image: ana.png]' }, rt);
    expect(r).toEqual({ text: 'Updated section "Left" in "Costs" v13 -> v14', isError: false });
    expect(lastPut(calls).body.value).toBe(page.replace('<p>Ana</p>', '<p>Ana and Ivan</p>'));
  });
  it('rebuilds a token map stored for an older page version', async () => {
    const v13 = routes[0]!;
    const v12: Route = { ...v13, times: 1, json: { id: '7', title: 'Costs', spaceId: '100', version: { number: 12 }, body: { storage: { value: '<h2>Left</h2><p>Old</p>' } } } };
    const { rt, calls } = testRuntime([v12, ...routes]);
    await executeTool(byName('page_get'), { id: '7' }, rt);
    const r = await executeTool(byName('page_update_section'), { url: '7', heading: 'Left', markdown: 'Ana and Ivan\n\n{{atlas:7}} [image: ana.png]' }, rt);
    expect(r).toEqual({ text: 'Updated section "Left" in "Costs" v13 -> v14', isError: false });
    expect(lastPut(calls).body.value).toBe(page.replace('<p>Ana</p>', '<p>Ana and Ivan</p>'));
  });
});

describe('page_append', () => {
  it('page_append returns versions', async () => {
    const { text, calls } = await runWithCalls('page_append', { url: '7', markdown: 'Bye' });
    expect(text).toBe('Appended to "Costs" v13 -> v14');
    const body = lastPut(calls);
    expect(body.body.value).toBe(`${page}<p>Bye</p>`);
    expect(body.version.message).toBe('atlas-lite-mcp page_append');
  });

  it('page_append restores a token copied from the page', async () => {
    const { calls } = await runWithCalls('page_append', { url: '7', markdown: '{{atlas:1}} [macro: toc]' });
    expect(lastPut(calls).body.value).toBe(`${page}<ac:structured-macro ac:name="toc" ac:schema-version="1" ac:macro-id="m-toc"/>`);
  });

  it('page_append reports unknown tokens as dropped', async () => {
    expect((await run('page_append', { url: '7', markdown: 'Bye {{atlas:99}}' })).text).toBe('Appended to "Costs" v13 -> v14\nDropped: 1 item: {{atlas:99}} [unknown token]');
  });
});

describe('confluenceModule', () => {
  it('registers the page, publish and table tools under the confluence name', () => {
    expect(confluenceModule.name).toBe('confluence');
    expect(confluenceModule.tools.map((t) => t.name)).toEqual(['page_get', 'page_edit', 'page_update_section', 'page_append', 'page_create', 'page_search', 'page_comment', 'table_get', 'table_update', 'table_add_row']);
  });
});
