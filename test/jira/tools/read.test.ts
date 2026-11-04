import { describe, expect, it } from 'vitest';
import { executeTool, type ToolDef } from '../../../src/core/tools.js';
import type { AdfDoc, AdfNode } from '../../../src/jira/adf/toMarkdown.js';
import { jiraModule } from '../../../src/jira/module.js';
import { readTools } from '../../../src/jira/tools/read.js';
import type { Route } from '../../helpers/fetch.js';
import { fixture } from '../../helpers/fixtures.js';
import { northstar, testRuntime } from '../../helpers/runtime.js';

const fx = JSON.parse(fixture('jira/issue-rich.json')) as { description: AdfDoc; comments: AdfDoc[] };
const ISSUE = '/rest/api/3/issue/DEMO-12';
const site = { ...northstar, defaultJiraProject: 'DEMO' };

const issue = {
  id: '10012',
  key: 'DEMO-12',
  fields: {
    summary: 'Login fails on Safari',
    issuetype: { name: 'Bug' },
    status: { name: 'In Progress' },
    priority: { name: 'High' },
    assignee: { displayName: 'Ana', accountId: 'u1' },
    reporter: { displayName: 'Marko', accountId: 'u2' },
    labels: ['web'],
    parent: { key: 'DEMO-1', fields: { summary: 'Accounts' } },
    created: '2026-11-01T09:00:00.000+0100',
    updated: '2026-11-02T10:00:00.000+0100',
    description: fx.description,
    customfield_10042: 5,
    comment: {
      total: 2,
      comments: [
        { id: '10001', author: { displayName: 'Ana' }, created: '2026-11-02T11:00:00.000+0100', body: fx.comments[0] },
        { id: '10002', author: { displayName: 'Marko' }, created: '2026-11-03T08:00:00.000+0100', body: fx.comments[1] },
      ],
    },
  },
};

const row = (n: number) => ({
  id: String(n),
  key: `DEMO-${n}`,
  fields: { summary: `Issue ${n}`, issuetype: { name: 'Task' }, status: { name: 'To Do' }, assignee: null },
});

const routes: Route[] = [
  { method: 'GET', path: ISSUE, json: issue },
  {
    method: 'GET',
    path: '/rest/api/3/field',
    json: [
      { id: 'summary', name: 'Summary', schema: { type: 'string' } },
      { id: 'customfield_10042', name: 'Story Points', schema: { type: 'number', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:float' } },
    ],
  },
  {
    method: 'POST',
    path: '/rest/api/3/search/jql',
    reply: (call) =>
      call.body.nextPageToken === undefined
        ? { json: { issues: [row(1), row(2)], isLast: false, nextPageToken: 'tok2' } }
        : { json: { issues: [row(3), row(4)], isLast: true } },
  },
  {
    method: 'GET',
    path: `${ISSUE}/transitions`,
    json: {
      transitions: [
        { id: '31', name: 'Done', to: { name: 'Done' } },
        { id: '11', name: 'Stop progress', to: { name: 'To Do' } },
      ],
    },
  },
  { method: 'POST', path: `${ISSUE}/transitions`, status: 204 },
  { method: 'POST', path: `${ISSUE}/comment`, json: { id: '10050' } },
];

function byName(name: string): ToolDef {
  const def = readTools.find((t) => t.name === name);
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

describe('jiraModule', () => {
  it('exposes the read tools', () => {
    expect(jiraModule.name).toBe('jira');
    expect(jiraModule.tools.map((t) => t.name).slice(0, 4)).toEqual(['issue_get', 'issue_search', 'issue_transition', 'issue_comment']);
  });
});

describe('issue_get', () => {
  it('issue_get prints a compact header and the description with tokens', async () => {
    const r = await run('issue_get', { key: 'https://northstar.atlassian.net/browse/DEMO-12' });
    expect(r.isError).toBe(false);
    expect(r.text.split('\n').slice(0, 3)).toEqual([
      'DEMO-12 [Bug] Login fails on Safari',
      'Status: In Progress | Priority: High | Assignee: Ana | Reporter: Marko',
      'Labels: web | Parent: DEMO-1 | Created: 2026-11-01 | Updated: 2026-11-02',
    ]);
    expect(r.text).toContain('{{atlas:2}} [media: shot.png]');
    expect(r.text).not.toContain('Comments');
  });

  it('issue_get requests default fields plus extras resolved by display name', async () => {
    const { text, calls } = await runWithCalls('issue_get', { key: 'DEMO-12', fields: ['Story Points'] });
    expect(new URL(calls.at(-1)!.url).searchParams.get('fields')).toBe(
      'summary,issuetype,status,priority,assignee,reporter,labels,parent,created,updated,description,customfield_10042',
    );
    expect(text.split('\n')[3]).toBe('Story Points: 5');
  });

  it('issue_get rejects an unknown extra field', async () => {
    expect(await run('issue_get', { key: 'DEMO-12', fields: ['Nope'] })).toEqual({ text: 'Unknown field "Nope".', isError: true });
  });

  it('issue_get includes comments on request, numbering after the description', async () => {
    const { text, calls } = await runWithCalls('issue_get', { key: 'DEMO-12', include_comments: true });
    expect(text).toContain('Comments (2):\n\n### Ana, 2026-11-02 (id 10001)\nLooks good {{atlas:4}} [card: x.y]');
    expect(text).toContain('### Marko, 2026-11-03 (id 10002)\nDone');
    expect(new URL(calls.at(-1)!.url).searchParams.get('fields')).toMatch(/,description,comment$/);
  });
});

describe('issue_search', () => {
  it('issue_search posts to /rest/api/3/search/jql with fields and follows nextPageToken up to the limit', async () => {
    const { text, calls } = await runWithCalls('issue_search', { query: 'login', limit: 3 });
    expect(calls[0]).toMatchObject({
      method: 'POST',
      body: { jql: 'project = "DEMO" AND (text ~ "login") ORDER BY updated DESC', maxResults: 3, fields: ['summary', 'issuetype', 'status', 'assignee'] },
    });
    expect(calls[0]!.body.nextPageToken).toBeUndefined();
    expect(calls[1]!.body.nextPageToken).toBe('tok2');
    expect(calls).toHaveLength(2);
    expect(text.split('\n')[0]).toBe('| key | type | status | assignee | summary |');
    expect(text.split('\n')).toHaveLength(5);
    expect(text.split('\n')[2]).toBe('| DEMO-1 | Task | To Do | - | Issue 1 |');
  });
});

describe('issue_transition', () => {
  it('issue_transition matches status or transition name case-insensitively', async () => {
    const { text, calls } = await runWithCalls('issue_transition', { key: 'DEMO-12', to: 'done' });
    expect(text).toBe('DEMO-12: In Progress -> Done');
    expect(calls.at(-1)).toMatchObject({ method: 'POST', body: { transition: { id: '31' } } });
  });

  it('issue_transition lists what is available on failure', async () => {
    expect(await run('issue_transition', { key: 'DEMO-12', to: 'Shipped' })).toEqual({
      text: 'No transition to "Shipped" from In Progress. Available: Done (Done), Stop progress (To Do).',
      isError: true,
    });
  });

  it('issue_transition is a no-op when already there', async () => {
    const { text, calls } = await runWithCalls('issue_transition', { key: 'DEMO-12', to: 'in progress' });
    expect(text).toBe('DEMO-12 is already In Progress.');
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });
});

describe('issue_comment', () => {
  it('issue_comment converts markdown to ADF and restores tokens in a fresh runtime', async () => {
    const { text, calls } = await runWithCalls('issue_comment', { key: 'DEMO-12', markdown: 'See {{atlas:2}} [media: shot.png]' });
    expect(new URL(calls[0]!.url).searchParams.get('fields')).toBe('description,comment,updated');
    expect(calls.at(-1)!.body.body.content.map((n: AdfNode) => n.type)).toEqual(['paragraph', 'mediaSingle']);
    expect(text).toBe('Comment 10050 added to DEMO-12');
  });

  it('issue_comment posts directly when there are no tokens', async () => {
    const { text, calls } = await runWithCalls('issue_comment', { key: 'DEMO-12', markdown: 'Fixed in **main**' });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: 'POST',
      body: { body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Fixed in ' }, { type: 'text', text: 'main', marks: [{ type: 'strong' }] }] }] } },
    });
    expect(text).toBe('Comment 10050 added to DEMO-12');
  });

  it('issue_comment reports unknown tokens as dropped', async () => {
    const r = await run('issue_comment', { key: 'DEMO-12', markdown: 'See {{atlas:9}}' });
    expect(r).toEqual({ text: 'Comment 10050 added to DEMO-12\nDropped: 1 item: {{atlas:9}} [unknown token]', isError: false });
  });
});
