import { describe, expect, it } from 'vitest';
import { confluenceModule } from '../src/confluence/module.js';
import { executeTool } from '../src/core/tools.js';
import { jiraModule } from '../src/jira/module.js';
import { northstar, testRuntime } from './helpers/runtime.js';

const other = { ...northstar, name: 'bluebird', baseUrl: 'https://bluebird.atlassian.net', host: 'bluebird.atlassian.net' };
const profile = { ...northstar, name: 'writer', apiToken: 'writer-secret' };
const cases = [
  { name: 'page_delete', product: 'confluence', field: 'url', target: '7', url: `${northstar.baseUrl}/wiki/spaces/DOCS/pages/7/Notes`, path: '/wiki/api/v2/pages/7', success: 'Moved page 7 to trash on northstar.' },
  { name: 'issue_delete', product: 'jira', field: 'key', target: 'demo-12', url: `${northstar.baseUrl}/browse/DEMO-12`, path: '/rest/api/3/issue/DEMO-12', success: 'Deleted DEMO-12 on northstar.' },
];

describe.each(cases)('$name', ({ name, product, field, target, url, path, success }) => {
  const tool = [...confluenceModule.tools, ...jiraModule.tools].find((t) => t.name === name)!;
  const args = { [field]: target };

  it('deletes only the selected item and accepts the empty 204 response', async () => {
    const { rt, calls } = testRuntime([{ method: 'DELETE', path, status: 204 }]);
    expect(await executeTool(tool, args, rt)).toEqual({ text: success, isError: false });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toBeUndefined();
    const request = new URL(calls[0]!.url);
    expect(request.origin).toBe(northstar.baseUrl);
    expect([...request.searchParams]).toEqual(product === 'jira' ? [['deleteSubtasks', 'false']] : []);
  });

  it('selects the configured site from the URL', async () => {
    const { rt, calls } = testRuntime([{ method: 'DELETE', path, status: 204 }], [other, northstar]);
    expect(await executeTool(tool, { [field]: url }, rt)).toEqual({ text: success, isError: false });
    expect(new URL(calls[0]!.url).origin).toBe(northstar.baseUrl);
  });

  it('does not forward destructive query options embedded in a reference URL', async () => {
    const { rt, calls } = testRuntime([{ method: 'DELETE', path, status: 204 }]);
    expect((await executeTool(tool, { [field]: `${url}?purge=true&draft=true&deleteSubtasks=true` }, rt)).isError).toBe(false);
    expect([...new URL(calls[0]!.url).searchParams]).toEqual(product === 'jira' ? [['deleteSubtasks', 'false']] : []);
  });

  it('routes scoped credentials through the correct product gateway', async () => {
    const gatewayPath = `/ex/${product}/cloud-123${path}`;
    const { rt, calls } = testRuntime([{ method: 'DELETE', path: gatewayPath, status: 204 }], [
      { ...northstar, tokenType: 'scoped', cloudId: 'cloud-123' },
    ]);
    expect(await executeTool(tool, args, rt)).toEqual({ text: success, isError: false });
    expect(new URL(calls[0]!.url).origin).toBe('https://api.atlassian.com');
    expect(calls[0]!.headers.authorization).toBe(`Basic ${Buffer.from(`${northstar.email}:${northstar.apiToken}`).toString('base64')}`);
  });

  it.each([{}, { [field]: '' }, { [field]: '../other' }, { [field]: 7 }])('rejects invalid input before sending a request: %j', async (input) => {
    const { rt, calls } = testRuntime([]);
    expect((await executeTool(tool, input, rt)).isError).toBe(true);
    expect(calls).toEqual([]);
  });

  it('refuses an ambiguous bare reference before sending a request', async () => {
    const { rt, calls } = testRuntime([], [northstar, other]);
    expect(await executeTool(tool, args, rt)).toMatchObject({ isError: true, text: expect.stringContaining('Several sites') });
    expect(calls).toEqual([]);
  });

  it('refuses a URL that conflicts with the explicit site', async () => {
    const { rt, calls } = testRuntime([], [northstar, other]);
    expect((await executeTool(tool, { [field]: url, site: 'bluebird' }, rt)).isError).toBe(true);
    expect(calls).toEqual([]);
  });

  it('refuses an unconfigured URL host', async () => {
    const { rt, calls } = testRuntime([]);
    expect((await executeTool(tool, { [field]: url.replace('northstar.', 'unknown.') }, rt)).isError).toBe(true);
    expect(calls).toEqual([]);
  });

  it('requires a profile name when multiple credentials share the URL hostname', async () => {
    const { rt, calls } = testRuntime([], [northstar, profile]);
    expect((await executeTool(tool, { [field]: url }, rt)).isError).toBe(true);
    expect(calls).toEqual([]);
  });

  it('uses the explicitly selected profile credentials for a shared hostname', async () => {
    const { rt, calls } = testRuntime([{ method: 'DELETE', path, status: 204 }], [northstar, profile]);
    expect(await executeTool(tool, { [field]: url, site: 'writer' }, rt)).toEqual({
      isError: false, text: success.replace('northstar', 'writer'),
    });
    expect(calls[0]!.headers.authorization).toBe(`Basic ${Buffer.from(`${profile.email}:${profile.apiToken}`).toString('base64')}`);
  });

  it.each([400, 403, 404, 500])('reports HTTP %i without claiming success or retrying', async (status) => {
    const { rt, calls } = testRuntime([{ method: 'DELETE', path, status, json: { message: 'Cannot delete this item' } }]);
    const result = await executeTool(tool, args, rt);
    expect(result.isError).toBe(true);
    expect(result.text).not.toBe(success);
    expect(calls).toHaveLength(1);
  });

  it('does not retry a deletion after an ambiguous network failure', async () => {
    const { rt, calls } = testRuntime([{ method: 'DELETE', path, reply: () => { throw new Error('Connection reset'); } }]);
    expect(await executeTool(tool, args, rt)).toMatchObject({ isError: true, text: expect.stringContaining('Could not reach') });
    expect(calls).toHaveLength(1);
  });
});

describe('issue_delete subtasks', () => {
  const tool = jiraModule.tools.find((t) => t.name === 'issue_delete')!;
  const path = '/rest/api/3/issue/DEMO-12';

  it.each([true, false])('passes the explicit deleteSubtasks choice %s', async (deleteSubtasks) => {
    const { rt, calls } = testRuntime([{ method: 'DELETE', path, status: 204 }]);
    const result = await executeTool(tool, { key: 'DEMO-12', deleteSubtasks }, rt);
    expect(result).toEqual({ isError: false, text: `Deleted DEMO-12 on northstar${deleteSubtasks ? ' including subtasks' : ''}.` });
    expect(new URL(calls[0]!.url).searchParams.get('deleteSubtasks')).toBe(String(deleteSubtasks));
  });

  it('does not coerce a string into permission to delete subtasks', async () => {
    const { rt, calls } = testRuntime([]);
    expect((await executeTool(tool, { key: 'DEMO-12', deleteSubtasks: 'true' }, rt)).isError).toBe(true);
    expect(calls).toEqual([]);
  });

  it('surfaces Jira subtask refusal without automatically escalating to cascade deletion', async () => {
    const { rt, calls } = testRuntime([{ method: 'DELETE', path, status: 400, json: { errorMessages: ['Issue has subtasks'] } }]);
    expect(await executeTool(tool, { key: 'DEMO-12' }, rt)).toEqual({ isError: true, text: 'Site northstar rejected the request (400): Issue has subtasks.' });
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0]!.url).searchParams.get('deleteSubtasks')).toBe('false');
  });
});
