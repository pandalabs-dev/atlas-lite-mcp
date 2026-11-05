import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Site } from '../src/core/config.js';
import { createRuntime, type Runtime } from '../src/core/runtime.js';
import { createServer, packageVersion } from '../src/server.js';
import { northstar, testRuntime } from './helpers/runtime.js';

const SETUP = 'No Atlassian sites are configured. Run "npx atlas-lite-mcp init" or set ATLASSIAN_URL, ATLASSIAN_EMAIL and ATLASSIAN_TOKEN.';
const NAMES = ['issue_comment', 'issue_create', 'issue_delete', 'issue_get', 'issue_search', 'issue_transition', 'issue_update', 'page_append', 'page_comment', 'page_create', 'page_delete', 'page_edit', 'page_get', 'page_search', 'page_update_section', 'sites_list', 'table_add_row', 'table_get', 'table_update'];

const clients: Client[] = [];

async function connect(rt: Runtime): Promise<Client> {
  const server = createServer(rt);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([server.connect(serverSide), c.connect(clientSide)]);
  clients.push(c);
  return c;
}

const bluebird: Site = { name: 'bluebird', baseUrl: 'https://bluebird.atlassian.net', host: 'bluebird.atlassian.net', email: 'q@b.c', apiToken: '', tokenType: 'classic', unavailable: 'env BLUEBIRD_TOKEN is not set' };
const sites: Site[] = [{ ...northstar, defaultJiraProject: 'DEMO', defaultConfluenceSpace: 'DOCS' }, bluebird];

let client: Client;

beforeAll(async () => {
  const { rt } = testRuntime(
    [
      { method: 'GET', path: '/rest/api/3/myself', json: { accountId: 'a1' } },
      { method: 'GET', path: /^\/wiki\/api\/v2\/spaces\?limit=1$/, json: { results: [] } },
    ],
    sites,
  );
  client = await connect(rt);
});

afterAll(async () => {
  for (const c of clients) await c.close();
});

describe('server', () => {
  it('reports the package version and name', () => {
    expect(packageVersion()).toBe('0.2.0');
    expect(client.getServerVersion()).toEqual({ name: 'atlas-lite-mcp', version: '0.2.0' });
  });

  it('exposes exactly the catalogue and marks both delete tools as destructive', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(NAMES);
    for (const name of ['issue_delete', 'page_delete']) {
      expect(tools.find((t) => t.name === name)?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    }
  });

  it('calls both delete tools over MCP and returns remote failures as tool errors', async () => {
    const { rt, calls } = testRuntime([
      { method: 'DELETE', path: '/wiki/api/v2/pages/7', status: 204 },
      { method: 'DELETE', path: '/rest/api/3/issue/DEMO-12', status: 204 },
      { method: 'DELETE', path: '/rest/api/3/issue/DEMO-13', status: 403 },
    ]);
    const c = await connect(rt);
    expect(await c.callTool({ name: 'page_delete', arguments: { url: '7' } })).toMatchObject({
      isError: false, content: [{ type: 'text', text: 'Moved page 7 to trash on northstar.' }],
    });
    expect(await c.callTool({ name: 'issue_delete', arguments: { key: 'DEMO-12' } })).toMatchObject({
      isError: false, content: [{ type: 'text', text: 'Deleted DEMO-12 on northstar.' }],
    });
    expect(await c.callTool({ name: 'issue_delete', arguments: { key: 'DEMO-13' } })).toMatchObject({
      isError: true, content: [{ type: 'text', text: expect.stringContaining('Access denied') }],
    });
    expect(calls).toHaveLength(3);
  });

  it('keeps the tools/list payload under 3,000 tokens (chars / 4 < 12,000 chars)', async () => {
    const { tools } = await client.listTools();
    const chars = JSON.stringify(tools).length;
    expect(chars, `payload ${chars} chars ~ ${Math.round(chars / 4)} tokens`).toBeLessThan(12000);
  });

  it('keeps every description short and dash-free', async () => {
    for (const t of (await client.listTools()).tools) {
      expect(t.description!.length, t.name).toBeLessThanOrEqual(120);
      expect(JSON.stringify(t)).not.toMatch(/[\u2013\u2014]/);
    }
  });

  it('answers with the setup sentence when nothing is configured', async () => {
    const c = await connect(createRuntime({ sites: [], source: 'none', path: '/h/sites.json' }));
    const r = await c.callTool({ name: 'page_get', arguments: { id: '1' } });
    expect(r).toMatchObject({ isError: true, content: [{ type: 'text', text: SETUP }] });
    const s = await c.callTool({ name: 'sites_list', arguments: {} });
    expect(s.content).toEqual([{ type: 'text', text: SETUP }]);
    expect(s.isError).toBe(false);
  });

  it('sites_list reports the config error as an error', async () => {
    const c = await connect(createRuntime({ error: 'Config file /h/sites.json is not valid JSON; fix it or remove it.' }));
    const s = await c.callTool({ name: 'sites_list', arguments: {} });
    expect(s).toMatchObject({ isError: true, content: [{ type: 'text', text: 'Config file /h/sites.json is not valid JSON; fix it or remove it.' }] });
  });

  it('sites_list probes each site and shows defaults', async () => {
    expect((await client.callTool({ name: 'sites_list', arguments: {} })).content).toEqual([{ type: 'text', text: [
      '| site | host | reachable | project | space |', '| --- | --- | --- | --- | --- |',
      '| northstar | northstar.atlassian.net | jira, confluence | DEMO | DOCS |',
      '| bluebird | bluebird.atlassian.net | unavailable: env BLUEBIRD_TOKEN is not set | - | - |',
    ].join('\n') }]);
  });

  it('sites_list names the status of a failed probe', async () => {
    const { rt } = testRuntime([
      { method: 'GET', path: '/rest/api/3/myself', json: { accountId: 'a1' } },
      { method: 'GET', path: '/wiki/api/v2/spaces', status: 401, json: {} },
    ]);
    const c = await connect(rt);
    expect((await c.callTool({ name: 'sites_list', arguments: {} })).content).toEqual([{ type: 'text', text: [
      '| site | host | reachable | project | space |', '| --- | --- | --- | --- | --- |',
      '| northstar | northstar.atlassian.net | jira (confluence: 401) | - | - |',
    ].join('\n') }]);
  });

  it('sites_list labels a timed out probe', async () => {
    const timeout = (): never => { throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }); };
    const { rt } = testRuntime([
      { method: 'GET', path: '/rest/api/3/myself', reply: timeout },
      { method: 'GET', path: '/wiki/api/v2/spaces', json: { results: [] } },
    ]);
    const c = await connect(rt);
    expect((await c.callTool({ name: 'sites_list', arguments: {} })).content).toEqual([{ type: 'text', text: [
      '| site | host | reachable | project | space |', '| --- | --- | --- | --- | --- |',
      '| northstar | northstar.atlassian.net | confluence (jira: timeout) | - | - |',
    ].join('\n') }]);
  });

  it('sites_list labels a scoped site whose cloudId lookup fails', async () => {
    const { rt } = testRuntime([{ method: 'GET', path: '/_edge/tenant_info', json: {} }], [{ ...northstar, tokenType: 'scoped' }]);
    const c = await connect(rt);
    expect((await c.callTool({ name: 'sites_list', arguments: {} })).content).toEqual([{ type: 'text', text: [
      '| site | host | reachable | project | space |', '| --- | --- | --- | --- | --- |',
      '| northstar | northstar.atlassian.net | none (jira: no cloudId, confluence: no cloudId) | - | - |',
    ].join('\n') }]);
  });
});
