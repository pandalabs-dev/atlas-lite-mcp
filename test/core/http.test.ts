import { describe, expect, it, vi } from 'vitest';
import type { Site } from '../../src/core/config.js';
import { AtlasError } from '../../src/core/errors.js';
import { baseUrlFor, createHttpClient, type HttpDeps } from '../../src/core/http.js';
import { mockFetch, type Route } from '../helpers/fetch.js';

const gumperr: Site = {
  name: 'gumperr',
  baseUrl: 'https://gumperr.atlassian.net',
  host: 'gumperr.atlassian.net',
  email: 'a@b.c',
  apiToken: 'tok-SECRET-123',
  tokenType: 'classic',
};

const MYSELF = '/rest/api/3/myself';

function noSleep() {
  return vi.fn(async (_ms: number) => {});
}

function client(routes: Route[], deps: HttpDeps = {}) {
  const m = mockFetch(routes);
  const sleep = noSleep();
  return { m, sleep, c: createHttpClient(gumperr, { fetch: m.fetch, sleep, ...deps }) };
}

function getMyself(routes: Route[], deps: HttpDeps = {}): Promise<unknown> {
  return client(routes, deps).c.request('jira', 'GET', MYSELF);
}

function reqStatus(status: number, json?: unknown): Promise<unknown> {
  return getMyself([{ method: 'GET', path: MYSELF, status, json }]);
}

function reqNetwork(): Promise<unknown> {
  const failing = (async () => {
    throw new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) });
  }) as typeof fetch;
  return createHttpClient(gumperr, { fetch: failing, sleep: noSleep() }).request('jira', 'GET', MYSELF);
}

async function caught(p: Promise<unknown>): Promise<AtlasError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(AtlasError);
    return e as AtlasError;
  }
  throw new Error('expected the request to fail');
}

describe('baseUrlFor', () => {
  it('uses the site origin for classic tokens', () => {
    expect(baseUrlFor(gumperr, 'jira')).toBe('https://gumperr.atlassian.net');
    expect(baseUrlFor(gumperr, 'confluence')).toBe('https://gumperr.atlassian.net');
  });

  it('uses api.atlassian.com per product for scoped tokens', () => {
    const scoped: Site = { ...gumperr, tokenType: 'scoped' };
    expect(baseUrlFor(scoped, 'jira', 'c-1')).toBe('https://api.atlassian.com/ex/jira/c-1');
    expect(baseUrlFor(scoped, 'confluence', 'c-1')).toBe('https://api.atlassian.com/ex/confluence/c-1');
    expect(baseUrlFor({ ...scoped, cloudId: 'c-9' }, 'jira')).toBe('https://api.atlassian.com/ex/jira/c-9');
  });
});

describe('createHttpClient', () => {
  it('sends Basic auth and JSON headers to the site URL for classic tokens', async () => {
    const { m, c } = client([{ method: 'GET', path: MYSELF, json: { accountId: '1' } }]);
    await expect(c.request('jira', 'GET', MYSELF)).resolves.toEqual({ accountId: '1' });
    const call = m.calls[0]!;
    expect(call.url).toBe('https://gumperr.atlassian.net/rest/api/3/myself');
    expect(call.headers.authorization).toBe('Basic ' + Buffer.from('a@b.c:tok-SECRET-123').toString('base64'));
    expect(call.headers.accept).toBe('application/json');
    expect(call.headers['user-agent']).toBe('atlas-lite-mcp');
    expect(call.headers['content-type']).toBeUndefined();
  });

  it('uses api.atlassian.com with a cloudId resolved once from tenant_info for scoped tokens', async () => {
    const m = mockFetch([
      { method: 'GET', path: '/_edge/tenant_info', json: { cloudId: 'c-1' } },
      { method: 'GET', path: '/ex/jira/c-1/rest/api/3/myself', json: {} },
      { method: 'GET', path: '/ex/confluence/c-1/wiki/api/v2/spaces', json: { results: [] } },
    ]);
    const c = createHttpClient({ ...gumperr, tokenType: 'scoped' }, { fetch: m.fetch });
    await c.request('jira', 'GET', MYSELF);
    await c.request('confluence', 'GET', '/wiki/api/v2/spaces');
    await c.request('jira', 'GET', MYSELF);
    expect(m.calls.map((x) => x.url)).toEqual([
      'https://gumperr.atlassian.net/_edge/tenant_info',
      'https://api.atlassian.com/ex/jira/c-1/rest/api/3/myself',
      'https://api.atlassian.com/ex/confluence/c-1/wiki/api/v2/spaces',
      'https://api.atlassian.com/ex/jira/c-1/rest/api/3/myself',
    ]);
    expect(m.calls[0]!.headers.authorization).toBeUndefined();
    expect(m.calls[1]!.headers.authorization).toBe('Basic ' + Buffer.from('a@b.c:tok-SECRET-123').toString('base64'));
  });

  it('skips tenant_info when cloudId is configured', async () => {
    const m = mockFetch([{ method: 'GET', path: '/ex/jira/c-9/rest/api/3/myself', json: {} }]);
    await createHttpClient({ ...gumperr, tokenType: 'scoped', cloudId: 'c-9' }, { fetch: m.fetch }).request('jira', 'GET', MYSELF);
    expect(m.calls.map((c) => c.url)).toEqual(['https://api.atlassian.com/ex/jira/c-9/rest/api/3/myself']);
  });

  it('explains a tenant_info answer without a cloudId and tries again on the next request', async () => {
    const m = mockFetch([
      { method: 'GET', path: '/_edge/tenant_info', json: {}, times: 1 },
      { method: 'GET', path: '/_edge/tenant_info', json: { cloudId: 'c-1' } },
      { method: 'GET', path: '/ex/jira/c-1/rest/api/3/myself', json: { ok: true } },
    ]);
    const c = createHttpClient({ ...gumperr, tokenType: 'scoped' }, { fetch: m.fetch });
    await expect(c.request('jira', 'GET', MYSELF)).rejects.toThrow(
      'Could not resolve the cloudId of site gumperr from /_edge/tenant_info; set cloudId for this site in sites.json.',
    );
    await expect(c.request('jira', 'GET', MYSELF)).resolves.toEqual({ ok: true });
  });

  it('retries 429 honouring Retry-After, capped at 60 s, and succeeds', async () => {
    const { c, sleep } = client([
      { method: 'GET', path: MYSELF, status: 429, headers: { 'retry-after': '120' }, times: 1 },
      { method: 'GET', path: MYSELF, json: { ok: true } },
    ]);
    await expect(c.request('jira', 'GET', MYSELF)).resolves.toEqual({ ok: true });
    expect(sleep.mock.calls).toEqual([[60000]]);
  });

  it('reads Retry-After as seconds or an HTTP date and backs off exponentially when it is absent', async () => {
    const now = Date.parse('2026-11-03T12:00:00Z');
    vi.spyOn(Date, 'now').mockReturnValue(now);
    try {
      const { c, sleep } = client([
        { method: 'GET', path: MYSELF, status: 429, headers: { 'retry-after': '5' }, times: 1 },
        { method: 'GET', path: MYSELF, status: 429, headers: { 'retry-after': new Date(now + 7000).toUTCString() }, times: 1 },
        { method: 'GET', path: MYSELF, status: 429, times: 1 },
        { method: 'GET', path: MYSELF, json: { ok: true } },
      ]);
      await expect(c.request('jira', 'GET', MYSELF)).resolves.toEqual({ ok: true });
      expect(sleep.mock.calls).toEqual([[5000], [7000], [4000]]);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('gives up after 3 retries and includes RateLimit-Reason', async () => {
    const { m, c, sleep } = client([
      { method: 'GET', path: MYSELF, status: 429, headers: { 'retry-after': '1', 'ratelimit-reason': 'jira-burst-based' } },
    ]);
    const e = await caught(c.request('jira', 'GET', MYSELF));
    expect(e.message).toBe('Rate limited by site gumperr after 3 retries (jira-burst-based); try again in a minute.');
    expect(e.status).toBe(429);
    expect(m.calls).toHaveLength(4);
    expect(sleep).toHaveBeenCalledTimes(3);
  });

  it('omits the reason when RateLimit-Reason is absent', async () => {
    await expect(reqStatus(429)).rejects.toThrow('Rate limited by site gumperr after 3 retries; try again in a minute.');
  });

  it('maps 401 to the expiry hint', async () => {
    await expect(reqStatus(401)).rejects.toThrow(
      'Token for site gumperr rejected (401). Tokens expire after at most 365 days; create a new one at id.atlassian.com/manage-profile/security/api-tokens and update sites.json.',
    );
  });

  it('maps 403 naming site and likely causes', async () => {
    await expect(reqStatus(403)).rejects.toThrow(
      'Access denied on site gumperr (403): the account may lack access to this product or item, or a scoped token is missing a scope.',
    );
  });

  it('maps 404 with the caller description and the permission note', async () => {
    const { c } = client([{ method: 'GET', path: '/wiki/api/v2/pages/9', status: 404 }]);
    await expect(c.request('confluence', 'GET', '/wiki/api/v2/pages/9', { notFound: 'page 9' })).rejects.toThrow(
      'Not found on site gumperr: page 9. Atlassian also returns 404 when the account lacks permission.',
    );
  });

  it('falls back to the path when no 404 description is given', async () => {
    await expect(reqStatus(404)).rejects.toThrow(
      'Not found on site gumperr: /rest/api/3/myself. Atlassian also returns 404 when the account lacks permission.',
    );
  });

  it('surfaces the first Atlassian error message for other 4xx', async () => {
    await expect(reqStatus(400, { errorMessages: [], errors: { summary: 'You must specify a summary of the issue.' } })).rejects.toThrow(
      'Site gumperr rejected the request (400): You must specify a summary of the issue.',
    );
    await expect(reqStatus(400, { errorMessages: ['JQL is invalid'], errors: { x: 'second' } })).rejects.toThrow(
      'Site gumperr rejected the request (400): JQL is invalid.',
    );
    await expect(reqStatus(400, { errors: [{ title: 'Version must be incremented' }] })).rejects.toThrow(
      'Site gumperr rejected the request (400): Version must be incremented.',
    );
    await expect(reqStatus(400, { message: 'Bad thing' })).rejects.toThrow('Site gumperr rejected the request (400): Bad thing.');
    await expect(reqStatus(400)).rejects.toThrow('Site gumperr rejected the request (400).');
  });

  it('keeps the status on errors so callers can react to 409', async () => {
    await expect(reqStatus(409, { message: 'Version conflict' })).rejects.toMatchObject({ status: 409 });
    await expect(reqStatus(401)).rejects.toMatchObject({ status: 401 });
  });

  it('maps 5xx to a try-again message without retrying', async () => {
    const { m, c } = client([{ method: 'GET', path: MYSELF, status: 502 }]);
    const e = await caught(c.request('jira', 'GET', MYSELF));
    expect(e.message).toBe('Site gumperr returned 502; try again shortly.');
    expect(e.status).toBe(502);
    expect(m.calls).toHaveLength(1);
  });

  it('times out after 30 s', async () => {
    let signal: AbortSignal | undefined;
    const hanging = (async (_input: unknown, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    }) as typeof fetch;
    await expect(createHttpClient(gumperr, { fetch: hanging }).request('jira', 'GET', MYSELF)).rejects.toThrow(
      'Request to site gumperr timed out after 30 s.',
    );
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it('aborts a request that runs past timeoutMs', async () => {
    const waitForAbort = ((_input: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      })) as typeof fetch;
    await expect(createHttpClient(gumperr, { fetch: waitForAbort, timeoutMs: 5 }).request('jira', 'GET', MYSELF)).rejects.toThrow(
      /^Request to site gumperr timed out after/,
    );
  });

  it('names the network error code when the site cannot be reached', async () => {
    await expect(reqNetwork()).rejects.toThrow('Could not reach site gumperr (ECONNREFUSED).');
  });

  it('never includes the token in any error message', async () => {
    const echo = { errorMessages: ['bad token tok-SECRET-123'] };
    const failures = [reqStatus(401), reqStatus(403), reqStatus(400, echo), reqStatus(500), reqNetwork()];
    for (const p of failures) {
      const e = await caught(p);
      expect(e.message).not.toContain('tok-SECRET-123');
    }
  });

  it('encodes query params and JSON bodies, returns undefined for 204', async () => {
    const { m, c } = client([{ method: 'PUT', path: '/rest/api/3/issue/GUM-1', status: 204 }]);
    const r = await c.request('jira', 'PUT', '/rest/api/3/issue/GUM-1', {
      query: { a: 'x y', b: 2, c: undefined },
      body: { fields: { summary: 'S' } },
    });
    expect(r).toBeUndefined();
    const call = m.calls[0]!;
    expect(call.method).toBe('PUT');
    expect(call.url).toBe('https://gumperr.atlassian.net/rest/api/3/issue/GUM-1?a=x+y&b=2');
    expect(call.headers['content-type']).toBe('application/json');
    expect(call.body).toEqual({ fields: { summary: 'S' } });
  });
});
