import { describe, expect, it } from 'vitest';
import type { SiteRuntime } from '../../src/core/runtime.js';
import { formatMissing, missingRequired, normalizeCreateMeta, normalizeEditMeta, resolveFields, type FieldMeta } from '../../src/jira/fields.js';
import { findUser } from '../../src/jira/users.js';
import type { Route } from '../helpers/fetch.js';
import { testRuntime } from '../helpers/runtime.js';

const severities = Array.from({ length: 12 }, (_, i) => ({ id: String(1001 + i), value: `S${i + 1}` }));

const meta: FieldMeta[] = [
  { id: 'summary', name: 'Summary', required: true, hasDefaultValue: false, schema: { type: 'string', system: 'summary' } },
  { id: 'project', name: 'Project', required: true, hasDefaultValue: false, schema: { type: 'project', system: 'project' } },
  { id: 'issuetype', name: 'Issue Type', required: true, hasDefaultValue: false, schema: { type: 'issuetype', system: 'issuetype' } },
  { id: 'reporter', name: 'Reporter', required: true, hasDefaultValue: true, schema: { type: 'user', system: 'reporter' } },
  {
    id: 'priority',
    name: 'Priority',
    required: false,
    hasDefaultValue: true,
    schema: { type: 'priority', system: 'priority' },
    allowedValues: [
      { id: '2', name: 'High' },
      { id: '4', name: 'Medium' },
      { id: '3', name: 'Low' },
    ],
  },
  { id: 'customfield_10042', name: 'Story Points', required: false, hasDefaultValue: false, schema: { type: 'number', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:float' } },
  {
    id: 'customfield_10050',
    name: 'Severity',
    required: true,
    hasDefaultValue: false,
    schema: { type: 'option', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:select' },
    allowedValues: severities,
  },
  {
    id: 'components',
    name: 'Components',
    required: false,
    hasDefaultValue: false,
    schema: { type: 'array', items: 'component', system: 'components' },
    allowedValues: [
      { id: '30', name: 'Web' },
      { id: '31', name: 'API' },
    ],
  },
  { id: 'duedate', name: 'Due date', required: false, hasDefaultValue: false, schema: { type: 'date', system: 'duedate' } },
  { id: 'customfield_10060', name: 'Watchers', required: false, hasDefaultValue: false, schema: { type: 'user', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:userpicker' } },
  { id: 'labels', name: 'Labels', required: false, hasDefaultValue: false, schema: { type: 'array', items: 'string', system: 'labels' } },
  { id: 'customfield_10020', name: 'Sprint', required: false, hasDefaultValue: false, schema: { type: 'array', items: 'json', custom: 'com.pyxis.greenhopper.jira:gh-sprint' } },
  { id: 'parent', name: 'Parent', required: false, hasDefaultValue: false, schema: { type: 'issuelink', system: 'parent' } },
  { id: 'environment', name: 'Environment', required: false, hasDefaultValue: false, schema: { type: 'string', system: 'environment' } },
];

const USERS = '/rest/api/3/user/search';
const ana = { accountId: 'u1', displayName: 'Ana', emailAddress: 'ana@x.y', active: true };

function srtWith(routes: Route[]): { srt: SiteRuntime; calls: ReturnType<typeof testRuntime>['calls'] } {
  const { rt, calls } = testRuntime(routes);
  return { srt: rt.resolve({}), calls };
}

const { srt } = srtWith([{ method: 'GET', path: USERS, json: [ana] }]);

describe('resolveFields', () => {
  it('matches keys by id or display name and values case-insensitively', async () => {
    const r = await resolveFields(srt, meta, { priority: 'high', 'story points': '5', Severity: 's2', Components: ['web'], duedate: '2026-12-01', Labels: ['a'] }, 'DEMO Bug');
    expect(r.fields).toEqual({ priority: { id: '2' }, customfield_10042: 5, customfield_10050: { id: '1002' }, components: [{ id: '30' }], duedate: '2026-12-01', labels: ['a'] });
    expect(r.names).toEqual(['Priority', 'Story Points', 'Severity', 'Components', 'Due date', 'Labels']);
  });

  it('resolves user fields by display name or email', async () => {
    const { srt: s, calls } = srtWith([{ method: 'GET', path: USERS, json: [ana] }]);
    expect((await resolveFields(s, meta, { customfield_10060: 'ana@x.y' }, 'x')).fields).toEqual({ customfield_10060: { accountId: 'u1' } });
    expect(new URL(calls[0]!.url).searchParams.get('query')).toBe('ana@x.y');
    expect(calls[0]!.url).toContain('query=ana%40x.y');
  });

  it('rejects unknown values with up to 10 allowed values', async () => {
    await expect(resolveFields(srt, meta, { Severity: 'S99' }, 'DEMO Bug')).rejects.toThrow(
      'Severity has no value "S99". Allowed: S1, S2, S3, S4, S5, S6, S7, S8, S9, S10 (and 2 more).',
    );
  });

  it('rejects unknown fields naming the screen', async () => {
    await expect(resolveFields(srt, meta, { Foo: 1 }, 'DEMO Bug')).rejects.toThrow('Field "Foo" is not available for DEMO Bug.');
  });

  it('requires a numeric sprint id', async () => {
    await expect(resolveFields(srt, meta, { Sprint: 'Sprint 4' }, 'DEMO Bug')).rejects.toThrow('Sprint needs the numeric sprint id.');
    expect((await resolveFields(srt, meta, { Sprint: '42' }, 'DEMO Bug')).fields).toEqual({ customfield_10020: 42 });
  });

  it('rejects a non-numeric number field', async () => {
    await expect(resolveFields(srt, meta, { 'Story Points': 'many' }, 'DEMO Bug')).rejects.toThrow('Story Points needs a number.');
  });

  it('shapes parent, rich text and scalar labels', async () => {
    const r = await resolveFields(srt, meta, { Parent: 'DEMO-1', Environment: '**Safari**', labels: 'web' }, 'DEMO Bug');
    expect(r.fields).toEqual({
      parent: { key: 'DEMO-1' },
      environment: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Safari', marks: [{ type: 'strong' }] }] }] },
      labels: ['web'],
    });
  });
});

describe('findUser', () => {
  it('lists candidates for ambiguous users', async () => {
    const { srt: srtTwoAnas } = srtWith([
      {
        method: 'GET',
        path: USERS,
        json: [
          { accountId: 'u7', displayName: 'Ana Kovac', emailAddress: 'ana.k@x.y', active: true },
          { accountId: 'u8', displayName: 'Ana Petrovic', emailAddress: 'ana.p@x.y', active: true },
          { accountId: 'u9', displayName: 'Ana Old', emailAddress: 'ana.o@x.y', active: false },
        ],
      },
    ]);
    await expect(findUser(srtTwoAnas, 'Ana')).rejects.toThrow('"Ana" matches 2 users: Ana Kovac (ana.k@x.y), Ana Petrovic (ana.p@x.y). Use an email.');
  });

  it('prefers an exact display name match over other results', async () => {
    const { srt: s } = srtWith([{ method: 'GET', path: USERS, json: [{ accountId: 'u7', displayName: 'Ana Kovac', active: true }, ana] }]);
    expect(await findUser(s, 'ana')).toEqual({ accountId: 'u1', displayName: 'Ana' });
  });

  it('fails when no active user matches', async () => {
    const { srt: s } = srtWith([{ method: 'GET', path: USERS, json: [] }]);
    await expect(findUser(s, 'Zed')).rejects.toThrow('No Jira user matches "Zed".');
  });
});

describe('required fields', () => {
  it('formats missing required fields', () => {
    expect(formatMissing('DEMO Bug', missingRequired(meta, new Set(['summary'])))).toBe(
      'Not created: DEMO Bug needs these fields:\n- Severity: S1, S2, S3, S4, S5, S6, S7, S8, S9, S10 (and 2 more)',
    );
  });

  it('ignores supplied fields and fields with a default', () => {
    expect(missingRequired(meta, new Set(['customfield_10050']))).toEqual([]);
  });
});

describe('metadata normalization', () => {
  it('normalizes createmeta pages that use either fields or results', () => {
    expect(normalizeCreateMeta({ results: [{ fieldId: 'priority', name: 'Priority', required: false, schema: { type: 'priority' } }] })[0]!.id).toBe('priority');
    expect(normalizeCreateMeta({ fields: [{ fieldId: 'x', name: 'X', required: true, schema: { type: 'string' } }] })[0]!.required).toBe(true);
    expect(normalizeCreateMeta({ fields: [{ key: 'y', name: 'Y', required: false, schema: { type: 'string' } }] })[0]!.id).toBe('y');
  });

  it('normalizes editmeta keyed by field id', () => {
    expect(
      normalizeEditMeta({
        fields: { priority: { name: 'Priority', required: false, schema: { type: 'priority', system: 'priority' }, allowedValues: [{ id: '3', name: 'Low' }] } },
      }),
    ).toEqual([
      { id: 'priority', name: 'Priority', required: false, hasDefaultValue: false, schema: { type: 'priority', system: 'priority' }, allowedValues: [{ id: '3', name: 'Low' }] },
    ]);
  });
});
