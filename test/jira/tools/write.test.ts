import { describe, expect, it } from 'vitest';
import { executeTool, type ToolDef } from '../../../src/core/tools.js';
import type { AdfDoc } from '../../../src/jira/adf/toMarkdown.js';
import { jiraModule } from '../../../src/jira/module.js';
import { writeTools } from '../../../src/jira/tools/write.js';
import type { Route } from '../../helpers/fetch.js';
import { fixture } from '../../helpers/fixtures.js';
import { northstar, testRuntime } from '../../helpers/runtime.js';

const fx = JSON.parse(fixture('jira/issue-rich.json')) as { description: AdfDoc; comments: AdfDoc[] };
const ISSUE = '/rest/api/3/issue/DEMO-12';
const site = { ...northstar, defaultJiraProject: 'DEMO' };

const severities = Array.from({ length: 12 }, (_, i) => ({ id: String(1001 + i), value: `S${i + 1}`, self: `https://x/${i}` }));

const bugFields = [
  { fieldId: 'summary', name: 'Summary', required: true, hasDefaultValue: false, schema: { type: 'string', system: 'summary' } },
  { fieldId: 'project', name: 'Project', required: true, hasDefaultValue: false, schema: { type: 'project', system: 'project' } },
  { fieldId: 'issuetype', name: 'Issue Type', required: true, hasDefaultValue: false, schema: { type: 'issuetype', system: 'issuetype' } },
  { fieldId: 'reporter', name: 'Reporter', required: true, hasDefaultValue: true, schema: { type: 'user', system: 'reporter' } },
  { fieldId: 'description', name: 'Description', required: false, hasDefaultValue: false, schema: { type: 'string', system: 'description' } },
  { fieldId: 'labels', name: 'Labels', required: false, hasDefaultValue: false, schema: { type: 'array', items: 'string', system: 'labels' } },
  { fieldId: 'assignee', name: 'Assignee', required: false, hasDefaultValue: false, schema: { type: 'user', system: 'assignee' } },
  {
    fieldId: 'customfield_10050',
    name: 'Severity',
    required: true,
    hasDefaultValue: false,
    schema: { type: 'option', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:select' },
    allowedValues: severities,
  },
];

const createRoutes: Route[] = [
  {
    method: 'GET',
    path: '/rest/api/3/issue/createmeta/DEMO/issuetypes',
    json: {
      issueTypes: [
        { id: '1', name: 'Bug' },
        { id: '2', name: 'Task' },
      ],
    },
  },
  { method: 'GET', path: '/rest/api/3/issue/createmeta/DEMO/issuetypes/1', json: { startAt: 0, maxResults: 50, total: bugFields.length, fields: bugFields } },
  { method: 'GET', path: '/rest/api/3/user/search', json: [{ accountId: 'u1', displayName: 'Ana', emailAddress: 'ana@x.y', active: true }] },
  { method: 'POST', path: '/rest/api/3/issue', json: { id: '10013', key: 'DEMO-13' } },
];

const issue = {
  id: '10012',
  key: 'DEMO-12',
  fields: {
    updated: '2026-11-02T10:00:00.000+0100',
    description: fx.description,
    comment: {
      total: 2,
      comments: [
        { id: '10001', body: fx.comments[0] },
        { id: '10002', body: fx.comments[1] },
      ],
    },
  },
};

const updateRoutes: Route[] = [
  {
    method: 'GET',
    path: `${ISSUE}/editmeta`,
    json: {
      fields: {
        priority: {
          name: 'Priority',
          required: false,
          schema: { type: 'priority', system: 'priority' },
          allowedValues: [
            { id: '2', name: 'High' },
            { id: '3', name: 'Low' },
          ],
        },
        summary: { name: 'Summary', required: true, schema: { type: 'string', system: 'summary' } },
        description: { name: 'Description', required: false, schema: { type: 'string', system: 'description' } },
      },
    },
  },
  { method: 'GET', path: ISSUE, json: issue },
  { method: 'PUT', path: ISSUE, status: 204 },
];

const routes = [...createRoutes, ...updateRoutes];

function byName(name: string): ToolDef {
  const def = writeTools.find((t) => t.name === name);
  if (def === undefined) throw new Error(`no tool ${name}`);
  return def;
}

async function runWithCalls(name: string, args: Record<string, unknown>) {
  const { rt, calls } = testRuntime(routes, [site]);
  const result = await executeTool(byName(name), args, rt);
  return { ...result, calls };
}

async function run(name: string, args: Record<string, unknown>) {
  const { text, isError } = await runWithCalls(name, args);
  return { text, isError };
}

async function runNoDefault(name: string, args: Record<string, unknown>) {
  const { rt } = testRuntime(routes, [northstar]);
  return executeTool(byName(name), args, rt);
}

describe('jiraModule', () => {
  it('exposes the write tools after the read tools', () => {
    expect(jiraModule.tools.map((t) => t.name)).toEqual(['issue_get', 'issue_search', 'issue_transition', 'issue_comment', 'issue_create', 'issue_update']);
  });
});

describe('issue_create', () => {
  it('issue_create resolves type, converts description, resolves assignee and returns key and URL', async () => {
    const { text, isError, calls } = await runWithCalls('issue_create', {
      type: 'bug',
      summary: 'Login fails',
      description: '**Steps**',
      labels: ['web'],
      assignee: 'Ana',
      fields: { Severity: 'S1' },
    });
    expect(calls.find((c) => c.method === 'POST')!.body.fields).toEqual({
      project: { key: 'DEMO' },
      issuetype: { id: '1' },
      summary: 'Login fails',
      description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Steps', marks: [{ type: 'strong' }] }] }] },
      labels: ['web'],
      assignee: { accountId: 'u1' },
      customfield_10050: { id: '1001' },
    });
    expect(new URL(calls.find((c) => c.url.includes('/user/search'))!.url).searchParams.get('query')).toBe('Ana');
    expect(text).toBe('Created DEMO-13 https://northstar.atlassian.net/browse/DEMO-13');
    expect(isError).toBe(false);
  });

  it('issue_create returns missing required fields instead of creating', async () => {
    const { text, isError, calls } = await runWithCalls('issue_create', { type: 'Bug', summary: 'x' });
    expect(text).toMatch(/^Not created: DEMO Bug needs these fields:\n- Severity: /);
    expect(text).toBe('Not created: DEMO Bug needs these fields:\n- Severity: S1, S2, S3, S4, S5, S6, S7, S8, S9, S10 (and 2 more)');
    expect(isError).toBe(true);
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('issue_create upper-cases the project key', async () => {
    const { text, calls } = await runWithCalls('issue_create', { project: 'demo', type: 'Bug', summary: 'x', fields: { Severity: 'S1' } });
    expect(new URL(calls[0]!.url).pathname).toBe('/rest/api/3/issue/createmeta/DEMO/issuetypes');
    expect(calls.find((c) => c.method === 'POST')!.body.fields.project).toEqual({ key: 'DEMO' });
    expect(text).toBe('Created DEMO-13 https://northstar.atlassian.net/browse/DEMO-13');
  });

  it('issue_create lists issue types when the type does not match', async () => {
    expect(await run('issue_create', { type: 'Epic', summary: 'x' })).toEqual({ text: 'No issue type "Epic" in DEMO. Types: Bug, Task.', isError: true });
  });

  it('issue_create needs a project when the site has no default', async () => {
    expect(await runNoDefault('issue_create', { type: 'Bug', summary: 'x' })).toEqual({ text: 'Pass project; site northstar has no defaultJiraProject.', isError: true });
  });

  it('issue_create reuses cached create metadata', async () => {
    const { rt, calls } = testRuntime(createRoutes, [site]);
    for (const summary of ['a', 'b']) {
      const r = await executeTool(byName('issue_create'), { type: 'Bug', summary, fields: { Severity: 'S1' } }, rt);
      expect(r.isError).toBe(false);
    }
    const gets = (path: string) => calls.filter((c) => c.method === 'GET' && new URL(c.url).pathname === path).length;
    expect(gets('/rest/api/3/issue/createmeta/DEMO/issuetypes')).toBe(1);
    expect(gets('/rest/api/3/issue/createmeta/DEMO/issuetypes/1')).toBe(1);
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(2);
  });
});

describe('issue_update', () => {
  it('does not PUT when an editable display name matches two field ids', async () => {
    const { rt, calls } = testRuntime([{ method: 'GET', path: `${ISSUE}/editmeta`, json: { fields: {
      customfield_1: { name: 'Severity', schema: { type: 'string' } },
      customfield_2: { name: 'Severity', schema: { type: 'string' } },
    } } }]);
    const result = await executeTool(byName('issue_update'), { key: 'DEMO-12', fields: { Severity: 'High' } }, rt);
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/Several fields.*customfield_1.*customfield_2/);
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('sends an explicit null to clear an optional Jira field', async () => {
    const { isError, calls } = await runWithCalls('issue_update', { key: 'DEMO-12', fields: { Priority: null } });
    expect(isError).toBe(false);
    expect(calls.at(-1)).toMatchObject({ method: 'PUT', body: { fields: { priority: null } } });
  });

  it('issue_update names changed fields and reports dropped description tokens', async () => {
    const r = await runWithCalls('issue_update', { key: 'DEMO-12', summary: 'New', description: 'Only text now' });
    expect(r.text).toBe('Updated DEMO-12: summary, description\nDropped: 3 items: [mention: @Ana], [media: shot.png], [panel: info, Careful]');
    expect(new URL(r.calls[0]!.url).searchParams.get('fields')).toBe('description,comment,updated');
    expect(r.calls.some((c) => c.url.includes('/editmeta'))).toBe(false);
    expect(r.calls.at(-1)).toMatchObject({
      method: 'PUT',
      body: { fields: { summary: 'New', description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Only text now' }] }] } } },
    });
  });

  it('issue_update restores description tokens it keeps', async () => {
    const r = await runWithCalls('issue_update', { key: 'DEMO-12', description: 'Now {{atlas:2}} [media: shot.png]' });
    expect(r.text).toBe('Updated DEMO-12: description\nDropped: 2 items: [mention: @Ana], [panel: info, Careful]');
    expect(r.calls.at(-1)!.body.fields.description.content.map((n: { type: string }) => n.type)).toEqual(['paragraph', 'mediaSingle']);
  });

  it('issue_update resolves fields against editmeta', async () => {
    const { text, calls } = await runWithCalls('issue_update', { key: 'DEMO-12', fields: { Priority: 'low' } });
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual(['/rest/api/3/issue/DEMO-12/editmeta', '/rest/api/3/issue/DEMO-12']);
    expect(calls[1]!.body).toEqual({ fields: { priority: { id: '3' } } });
    expect(text).toBe('Updated DEMO-12: Priority');
  });

  it('issue_update refuses description inside fields', async () => {
    const { text, isError, calls } = await runWithCalls('issue_update', { key: 'DEMO-12', fields: { Description: 'Only text now' } });
    expect({ text, isError }).toEqual({ text: 'Pass description as its own parameter.', isError: true });
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual(['/rest/api/3/issue/DEMO-12/editmeta']);
  });

  it('issue_update lists each changed field once', async () => {
    const { text, calls } = await runWithCalls('issue_update', { key: 'DEMO-12', fields: { priority: 'high', Priority: 'low', Summary: 'Old' }, summary: 'New' });
    expect(calls.at(-1)!.body).toEqual({ fields: { priority: { id: '3' }, summary: 'New' } });
    expect(text).toBe('Updated DEMO-12: Priority, summary');
  });

  it('issue_update rejects a field missing from the edit screen', async () => {
    expect(await run('issue_update', { key: 'DEMO-12', fields: { Severity: 'S1' } })).toEqual({ text: 'Field "Severity" is not available for DEMO-12.', isError: true });
  });

  it('issue_update fails when there is nothing to change', async () => {
    const { text, isError, calls } = await runWithCalls('issue_update', { key: 'DEMO-12', fields: {} });
    expect({ text, isError }).toEqual({ text: 'Nothing to update; pass fields, summary or description.', isError: true });
    expect(calls).toHaveLength(0);
  });
});
