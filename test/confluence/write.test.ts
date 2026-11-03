import { describe, expect, it, vi } from 'vitest';
import { getPage, putPage, type PageData } from '../../src/confluence/api.js';
import { writePage } from '../../src/confluence/write.js';
import { AtlasError } from '../../src/core/errors.js';
import type { Route } from '../helpers/fetch.js';
import { testRuntime } from '../helpers/runtime.js';

const PAGE = '/wiki/api/v2/pages/7';

function pageAt(version: number): Route {
  return {
    method: 'GET',
    path: PAGE,
    json: { id: '7', title: 'Costs', spaceId: '100', version: { number: version }, body: { storage: { value: '<p>a</p>' } }, _links: { webui: '/spaces/SD/pages/7/Costs' } },
  };
}
const getPage13 = pageAt(13);
const getPage14 = pageAt(14);
const conflict: Route = { method: 'PUT', path: PAGE, status: 409, json: {}, times: 1 };

const aToB = (p: PageData) => ({ storage: p.storage.replace('a', 'b') });

async function run409ThenTransformThrows(): Promise<unknown> {
  const { rt } = testRuntime([{ ...getPage13, times: 1 }, conflict, getPage14]);
  let n = 0;
  return writePage(rt.resolve({}), '7', 'page_edit', (p) => {
    if (++n > 1) throw new AtlasError('No match for the find text.');
    return aToB(p);
  });
}

describe('getPage', () => {
  it('reads the page in storage format', async () => {
    const { rt, calls } = testRuntime([getPage13]);
    expect(await getPage(rt.resolve({}), '7')).toEqual({ id: '7', title: 'Costs', spaceId: '100', version: 13, storage: '<p>a</p>', webui: '/spaces/SD/pages/7/Costs' });
    expect(calls[0]!.url).toBe('https://gumperr.atlassian.net/wiki/api/v2/pages/7?body-format=storage');
  });

  it('getPage names the page in 404 errors', async () => {
    const { rt: rt404 } = testRuntime([{ method: 'GET', path: '/wiki/api/v2/pages/9', status: 404, json: {} }]);
    await expect(getPage(rt404.resolve({}), '9')).rejects.toThrow('Not found on site gumperr: page 9. Atlassian also returns 404 when the account lacks permission.');
  });
});

describe('putPage', () => {
  it('returns the version Confluence reports', async () => {
    const { rt } = testRuntime([getPage13, { method: 'PUT', path: PAGE, json: { version: { number: 14 } } }]);
    const srt = rt.resolve({});
    expect(await putPage(srt, await getPage(srt, '7'), '<p>b</p>', 'atlas-lite-mcp page_edit')).toBe(14);
  });
});

describe('writePage', () => {
  it('PUTs version + 1 with the tool message and the full required body', async () => {
    const { rt, calls } = testRuntime([getPage13, { method: 'PUT', path: PAGE, json: { version: { number: 14 } } }]);
    const r = await writePage(rt.resolve({}), '7', 'page_edit', (p) => ({ ...aToB(p), note: '1 replacement' }));
    expect(r).toMatchObject({ from: 13, to: 14, note: '1 replacement', page: { title: 'Costs', version: 13 } });
    expect(calls[1]!.method).toBe('PUT');
    expect(calls[1]!.body).toEqual({ id: '7', status: 'current', title: 'Costs', body: { representation: 'storage', value: '<p>b</p>' }, version: { number: 14, message: 'atlas-lite-mcp page_edit' } });
  });

  it('re-fetches once and re-applies on 409', async () => {
    const { rt, calls } = testRuntime([{ ...getPage13, times: 1 }, conflict, getPage14, { method: 'PUT', path: PAGE, json: { version: { number: 15 } } }]);
    const transform = vi.fn(aToB);
    const r = await writePage(rt.resolve({}), '7', 'page_edit', transform);
    expect(transform).toHaveBeenCalledTimes(2);
    expect(transform.mock.calls[1]![0].version).toBe(14);
    expect(r).toMatchObject({ from: 14, to: 15 });
    expect(calls.map((c) => c.method)).toEqual(['GET', 'PUT', 'GET', 'PUT']);
    expect(calls[3]!.body.version).toEqual({ number: 15, message: 'atlas-lite-mcp page_edit' });
  });

  it('says so when the transform no longer applies after a 409', async () => {
    await expect(run409ThenTransformThrows()).rejects.toThrow('Page "Costs" changed during the edit and the change no longer applies: No match for the find text.');
  });

  it('gives up after a second 409', async () => {
    const { rt, calls } = testRuntime([{ ...getPage13, times: 1 }, conflict, getPage14, { ...conflict }]);
    await expect(writePage(rt.resolve({}), '7', 'page_edit', aToB)).rejects.toThrow('Page "Costs" is being edited by someone else; try again.');
    expect(calls.map((c) => c.method)).toEqual(['GET', 'PUT', 'GET', 'PUT']);
  });

  it('passes other errors through without retrying', async () => {
    const { rt, calls } = testRuntime([getPage13, { method: 'PUT', path: PAGE, status: 400, json: { errors: [{ title: 'Bad body' }] } }]);
    await expect(writePage(rt.resolve({}), '7', 'page_edit', aToB)).rejects.toThrow('Site gumperr rejected the request (400): Bad body.');
    expect(calls).toHaveLength(2);
  });

  it('writes nothing when the result is malformed', async () => {
    const { rt, calls } = testRuntime([getPage13]);
    await expect(writePage(rt.resolve({}), '7', 'page_edit', () => ({ storage: '<p>' }))).rejects.toThrow(/malformed XML/);
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
  });
});
