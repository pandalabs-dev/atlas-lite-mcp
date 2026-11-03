import { describe, expect, it } from 'vitest';
import { addFooterComment, createPage, searchPages, spaceIdForKey } from '../../../src/confluence/api.js';
import { buildCql, publishTools } from '../../../src/confluence/tools/publish.js';
import type { Site } from '../../../src/core/config.js';
import { executeTool, type ToolDef } from '../../../src/core/tools.js';
import type { Call, Route } from '../../helpers/fetch.js';
import { gumperr, testRuntime } from '../../helpers/runtime.js';

const site: Site = { ...gumperr, defaultConfluenceSpace: 'SD' };
const noDefault: Site = { ...gumperr };
const qint: Site = { ...gumperr, name: 'qint', baseUrl: 'https://qint.atlassian.net', host: 'qint.atlassian.net' };

const routes: Route[] = [
  {
    method: 'GET',
    path: /^\/wiki\/api\/v2\/spaces\?/,
    reply: (call) => {
      const key = new URL(call.url).searchParams.get('keys');
      return { json: { results: key === 'SD' ? [{ id: '100', key: 'SD' }] : [] } };
    },
  },
  {
    method: 'GET',
    path: '/wiki/api/v2/pages/7',
    json: { id: '7', title: 'Costs', spaceId: '100', version: { number: 13 }, body: { storage: { value: '<p>x</p>' } } },
  },
  { method: 'POST', path: '/wiki/api/v2/pages', json: { id: '900', version: { number: 1 }, _links: { webui: '/spaces/SD/pages/900/Notes' } } },
  {
    method: 'GET',
    path: '/wiki/rest/api/content/search',
    reply: (call) => {
      const cql = new URL(call.url).searchParams.get('cql') ?? '';
      const results = cql.includes('zzz') ? [] : [{ id: '7', title: 'Costs', space: { key: 'SD' }, version: { when: '2026-11-01T09:30:00.000Z' } }];
      return { json: { results } };
    },
  },
  { method: 'POST', path: '/wiki/api/v2/footer-comments', json: { id: '555' } },
];

function byName(name: string): ToolDef {
  const def = publishTools.find((t) => t.name === name);
  if (def === undefined) throw new Error(`no tool ${name}`);
  return def;
}

async function runOn(sites: Site[], name: string, args: Record<string, unknown>) {
  const { rt, calls } = testRuntime(routes, sites);
  const result = await executeTool(byName(name), args, rt);
  return { ...result, calls };
}

const runWithCalls = (name: string, args: Record<string, unknown>) => runOn([site], name, args);
const runNoDefaultSpace = (name: string, args: Record<string, unknown>) => runOn([noDefault], name, args);
const runTwoSites = (name: string, args: Record<string, unknown>) => runOn([site, qint], name, args);
const run = async (name: string, args: Record<string, unknown>) => {
  const { text, isError } = await runWithCalls(name, args);
  return { text, isError };
};

function post(calls: Call[]): Call {
  const found = calls.find((c) => c.method === 'POST');
  if (found === undefined) throw new Error('no POST');
  return found;
}

describe('buildCql', () => {
  it('buildCql turns plain text into a quoted text search and scopes CQL to a space', () => {
    expect(buildCql('budget "Q3" plan')).toBe('type = page AND text ~ "budget \\"Q3\\" plan"');
    expect(buildCql('budget', 'SD')).toBe('type = page AND space = "SD" AND text ~ "budget"');
    expect(buildCql('title ~ "Costs" ORDER BY lastmodified DESC', 'SD')).toBe('space = "SD" AND (title ~ "Costs") ORDER BY lastmodified DESC');
    expect(buildCql('space = SD AND title ~ x', 'QA')).toBe('space = SD AND title ~ x');
    expect(buildCql('title ~ "order by x"', 'SD')).toBe('space = "SD" AND (title ~ "order by x")');
    expect(buildCql('ORDER BY created DESC', 'SD')).toBe('space = "SD" ORDER BY created DESC');
  });

  it('escapes backslashes in plain text and leaves CQL alone without a space', () => {
    expect(buildCql('C:\\temp')).toBe('type = page AND text ~ "C:\\\\temp"');
    expect(buildCql('label in (a, b)')).toBe('label in (a, b)');
    expect(buildCql('title ~ x', 'my "sp"')).toBe('space = "my \\"sp\\"" AND (title ~ x)');
  });
});

describe('page_search', () => {
  it('page_search returns a compact table with default limit 10', async () => {
    const { text, calls } = await runWithCalls('page_search', { query: 'budget' });
    const params = new URL(calls[0]!.url).searchParams;
    expect(params.get('limit')).toBe('10');
    expect(params.get('expand')).toBe('space,version');
    expect(params.get('cql')).toBe('type = page AND space = "SD" AND text ~ "budget"');
    expect(text).toBe('| id | title | space | modified |\n| --- | --- | --- | --- |\n| 7 | Costs | SD | 2026-11-01 |');
  });

  it('page_search uses an explicit space and limit over the site default', async () => {
    const { calls } = await runWithCalls('page_search', { query: 'budget', space: 'QA', limit: 3 });
    const params = new URL(calls[0]!.url).searchParams;
    expect(params.get('limit')).toBe('3');
    expect(params.get('cql')).toBe('type = page AND space = "QA" AND text ~ "budget"');
  });

  it('page_search does not scope by space when the site has no default', async () => {
    const { calls } = await runNoDefaultSpace('page_search', { query: 'budget' });
    expect(new URL(calls[0]!.url).searchParams.get('cql')).toBe('type = page AND text ~ "budget"');
  });

  it('page_search says when nothing matched', async () => {
    expect((await run('page_search', { query: 'zzz' })).text).toBe('No pages found.');
  });
});

describe('page_create', () => {
  it('page_create uses the site default space and returns url, id and version', async () => {
    const { text, calls } = await runWithCalls('page_create', { title: 'Notes', markdown: '# Hi' });
    expect(calls[0]!.url).toBe('https://gumperr.atlassian.net/wiki/api/v2/spaces?keys=SD');
    expect(post(calls).body).toEqual({ spaceId: '100', status: 'current', title: 'Notes', body: { representation: 'storage', value: '<h1>Hi</h1>' } });
    expect(text).toBe('Created "Notes" 900 v1 https://gumperr.atlassian.net/wiki/spaces/SD/pages/900/Notes');
  });

  it('page_create takes the space from the parent when space is omitted and no default exists', async () => {
    const { text, calls } = await runNoDefaultSpace('page_create', { title: 'Notes', markdown: '# Hi', parent: '7' });
    expect(calls.some((c) => new URL(c.url).pathname === '/wiki/api/v2/pages/7')).toBe(true);
    expect(post(calls).body).toEqual({ spaceId: '100', status: 'current', title: 'Notes', parentId: '7', body: { representation: 'storage', value: '<h1>Hi</h1>' } });
    expect(text).toBe('Created "Notes" 900 v1 https://gumperr.atlassian.net/wiki/spaces/SD/pages/900/Notes');
  });

  it('page_create with an explicit space and a parent URL does not read the parent', async () => {
    const { isError, calls } = await runTwoSites('page_create', {
      space: 'SD',
      title: 'Notes',
      markdown: 'x',
      parent: 'https://gumperr.atlassian.net/wiki/spaces/SD/pages/7/Costs',
    });
    expect(isError).toBe(false);
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual(['GET /wiki/api/v2/spaces', 'POST /wiki/api/v2/pages']);
    expect(post(calls).body.parentId).toBe('7');
  });

  it('page_create requires site when several sites exist', async () => {
    expect((await runTwoSites('page_create', { title: 'x', markdown: 'y' })).text).toBe('Several sites are configured; pass site as one of: gumperr, qint.');
  });

  it('page_create without any space asks for one', async () => {
    expect(await runNoDefaultSpace('page_create', { title: 'x', markdown: 'y' })).toMatchObject({
      text: 'No space for the new page; pass space or parent, or set defaultConfluenceSpace for site gumperr in sites.json.',
      isError: true,
    });
  });

  it('page_create names an unknown space', async () => {
    expect(await runOn([site], 'page_create', { space: 'XX', title: 'x', markdown: 'y' })).toMatchObject({
      text: 'No Confluence space "XX" on site gumperr.',
      isError: true,
    });
  });
});

describe('page_comment', () => {
  it('page_comment posts a footer comment', async () => {
    const { text, calls } = await runWithCalls('page_comment', { url: '7', markdown: 'Looks *good*' });
    expect(calls.at(-1)!.url).toBe('https://gumperr.atlassian.net/wiki/api/v2/footer-comments');
    expect(calls.at(-1)!.body).toEqual({ pageId: '7', body: { representation: 'storage', value: '<p>Looks <em>good</em></p>' } });
    expect(text).toBe('Comment 555 added to "Costs"');
  });
});

describe('Confluence publish API', () => {
  it('spaceIdForKey caches the id per site and key', async () => {
    const { rt, calls } = testRuntime(routes, [site]);
    const srt = rt.resolve({});
    expect(await spaceIdForKey(srt, 'SD')).toBe('100');
    expect(await spaceIdForKey(srt, 'SD')).toBe('100');
    expect(calls).toHaveLength(1);
    expect(srt.cache.get('confluence:spaceId:gumperr:SD')).toBe('100');
  });

  it('createPage, searchPages and addFooterComment map the responses', async () => {
    const { rt } = testRuntime(routes, [site]);
    const srt = rt.resolve({});
    expect(await createPage(srt, { spaceId: '100', title: 'Notes', storage: '<p>x</p>' })).toEqual({
      id: '900',
      version: 1,
      url: 'https://gumperr.atlassian.net/wiki/spaces/SD/pages/900/Notes',
    });
    expect(await searchPages(srt, 'type = page', 5)).toEqual([{ id: '7', title: 'Costs', space: 'SD', modified: '2026-11-01' }]);
    expect(await addFooterComment(srt, '7', '<p>x</p>')).toBe('555');
  });
});

describe('publishTools', () => {
  it('uses the brief descriptions', () => {
    expect(publishTools.map((t) => [t.name, t.description])).toEqual([
      ['page_create', 'Create a page from markdown.'],
      ['page_search', 'Search pages by CQL or plain text.'],
      ['page_comment', 'Add a footer comment to a page.'],
    ]);
  });
});
