import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AtlasError } from '../../src/core/errors.js';
import { createRuntime } from '../../src/core/runtime.js';
import type { Placeholder } from '../../src/core/placeholders.js';
import { defineTool, executeTool, registerModules, siteParam } from '../../src/core/tools.js';
import { northstar, testRuntime } from '../helpers/runtime.js';

const { rt } = testRuntime([]);
const echo = defineTool({ name: 'echo', description: 'Echo.', shape: { text: z.string(), site: siteParam }, run: async (a) => a.text });

describe('executeTool', () => {
  it('returns text for success and isError for AtlasError', async () => {
    expect(await executeTool(echo, { text: 'hi' }, rt)).toEqual({ text: 'hi', isError: false });
    const bad = defineTool({ ...echo, run: async () => { throw new AtlasError('Nope.'); } });
    expect(await executeTool(bad, { text: 'x' }, rt)).toEqual({ text: 'Nope.', isError: true });
  });

  it('reports invalid arguments in one sentence', async () => {
    const r = await executeTool(echo, {}, rt);
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/^Invalid arguments: text/);
    expect(r.text).toBe('Invalid arguments: text is required.');
    expect((await executeTool(echo, { text: 3 }, rt)).text).toMatch(/^Invalid arguments: text .*expected string/);
  });

  it('treats missing arguments as an empty object', async () => {
    const none = defineTool({ name: 'none', description: 'None.', shape: {}, run: async () => 'ok' });
    expect(await executeTool(none, undefined, rt)).toEqual({ text: 'ok', isError: false });
  });

  it('redacts configured tokens from unexpected errors', async () => {
    const leak = defineTool({ ...echo, run: async () => { throw new Error('boom tok-SECRET-123'); } });
    expect(await executeTool(leak, { text: 'x' }, rt)).toEqual({ text: 'Unexpected error: boom ***', isError: true });
  });

  it('every tool call fails with the config error when config is broken', async () => {
    const broken = createRuntime({ error: 'Could not parse /h/sites.json: Unexpected token.' });
    const t = defineTool({ ...echo, run: async (_a, r) => (r.resolve({}), 'ok') });
    expect(await executeTool(t, { text: 'x' }, broken)).toEqual({ text: 'Could not parse /h/sites.json: Unexpected token.', isError: true });
    expect(broken.configError).toBe('Could not parse /h/sites.json: Unexpected token.');
    expect(broken.sites()).toEqual([]);
  });

  it('passes the site argument through to site resolution', async () => {
    const bluebird = { ...northstar, name: 'bluebird', baseUrl: 'https://bluebird.atlassian.net', host: 'bluebird.atlassian.net' };
    const { rt: two } = testRuntime([], [northstar, bluebird]);
    const which = defineTool({ ...echo, run: async (a, r) => r.resolve({ site: a.site }).site.name });
    expect(await executeTool(which, { text: 'x', site: 'BLUEBIRD' }, two)).toEqual({ text: 'bluebird', isError: false });
    expect(await executeTool(which, { text: 'x' }, two)).toEqual({ text: 'Several sites are configured; pass site as one of: northstar, bluebird.', isError: true });
  });
});

describe('createRuntime', () => {
  it('creates one site runtime per site and reuses it', () => {
    const a = rt.resolve({});
    expect(a.site.name).toBe('northstar');
    expect(rt.resolve({ site: 'northstar.atlassian.net' })).toBe(a);
    a.cache.set('confluence:spaceId:northstar:DOCS', '100');
    expect(rt.resolve({ host: 'northstar.atlassian.net' }).cache.get('confluence:spaceId:northstar:DOCS')).toBe('100');
  });

  it('keeps one placeholder store per product', () => {
    const p: Placeholder<string> = { n: 1, hint: 'macro: toc', original: '<x/>', block: true };
    const confluence = rt.placeholders.get<Placeholder<string>>('confluence');
    expect(rt.placeholders.get<Placeholder<string>>('confluence')).toBe(confluence);
    expect(rt.placeholders.get('jira')).not.toBe(confluence);
    confluence.getOrBuild('confluence:page:northstar:7', '13', () => [p]);
    let rebuilt = false;
    rt.placeholders.get<Placeholder<string>>('confluence').getOrBuild('confluence:page:northstar:7', '13', () => ((rebuilt = true), []));
    expect(rebuilt).toBe(false);
  });
});

describe('registerModules', () => {
  it('serves each tool over MCP and returns errors as tool results', async () => {
    const bad = defineTool({ ...echo, name: 'bad', run: async () => { throw new AtlasError('Nope.'); } });
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerModules(server, [{ name: 'test', tools: [echo, bad] }], rt);
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'c', version: '0.0.0' });
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['echo', 'bad']);
    expect(tools[0]!.description).toBe('Echo.');
    expect(tools[0]!.inputSchema.properties).toHaveProperty('site');
    expect(await client.callTool({ name: 'echo', arguments: { text: 'hi' } })).toMatchObject({ content: [{ type: 'text', text: 'hi' }], isError: false });
    expect(await client.callTool({ name: 'bad', arguments: { text: 'x' } })).toMatchObject({ content: [{ type: 'text', text: 'Nope.' }], isError: true });
    await client.close();
  });
});
