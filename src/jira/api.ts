import type { SiteRuntime } from '../core/runtime.js';
import type { AdfDoc } from './adf/toMarkdown.js';
import { normalizeCreateMeta, normalizeEditMeta, type FieldMeta } from './fields.js';

export interface JiraIssue {
  id: string;
  key: string;
  fields: Record<string, any>;
}

export interface JiraField {
  id: string;
  name: string;
  schema?: { type: string; custom?: string };
}

export interface JiraTransition {
  id: string;
  name: string;
  to: { name: string };
}

/** The fields an `issue_search` row shows. */
const SEARCH_FIELDS = ['summary', 'issuetype', 'status', 'assignee'];
const MAX_PAGE = 100;
/** Page size for the createmeta endpoints. */
const META_PAGE = 200;

const issuePath = (key: string) => `/rest/api/3/issue/${encodeURIComponent(key)}`;

/** Deletes one issue; Jira refuses issues with subtasks unless explicitly opted in. */
export async function deleteIssue(rt: SiteRuntime, key: string, deleteSubtasks = false): Promise<void> {
  await rt.http.request<undefined>('jira', 'DELETE', issuePath(key), {
    query: { deleteSubtasks: String(deleteSubtasks) },
    notFound: `issue ${key}`,
  });
}

export async function getIssue(rt: SiteRuntime, key: string, fields: string[]): Promise<JiraIssue> {
  return rt.http.request<JiraIssue>('jira', 'GET', issuePath(key), {
    query: { fields: fields.join(',') },
    notFound: `issue ${key}`,
  });
}

interface SearchResponse {
  issues?: JiraIssue[];
  isLast?: boolean;
  nextPageToken?: string;
}

/** JQL search through `/rest/api/3/search/jql`, following `nextPageToken` until `limit` issues are in. */
export async function searchIssues(rt: SiteRuntime, jql: string, limit: number): Promise<JiraIssue[]> {
  const issues: JiraIssue[] = [];
  let nextPageToken: string | undefined;
  do {
    const res = await rt.http.request<SearchResponse>('jira', 'POST', '/rest/api/3/search/jql', {
      body: {
        jql,
        maxResults: Math.min(limit - issues.length, MAX_PAGE),
        fields: SEARCH_FIELDS,
        ...(nextPageToken !== undefined && { nextPageToken }),
      },
    });
    const page = res.issues ?? [];
    issues.push(...page);
    nextPageToken = res.isLast || page.length === 0 ? undefined : res.nextPageToken;
  } while (nextPageToken !== undefined && issues.length < limit);
  return issues.slice(0, limit);
}

/** All system and custom fields of the site, cached per site for the process lifetime. */
export async function listFields(rt: SiteRuntime): Promise<JiraField[]> {
  const cacheKey = `jira:fields:${rt.site.name}`;
  const cached = rt.cache.get(cacheKey);
  if (Array.isArray(cached)) return cached as JiraField[];
  const fields = await rt.http.request<JiraField[]>('jira', 'GET', '/rest/api/3/field');
  rt.cache.set(cacheKey, fields);
  return fields;
}

export async function getTransitions(rt: SiteRuntime, key: string): Promise<JiraTransition[]> {
  const res = await rt.http.request<{ transitions?: JiraTransition[] }>('jira', 'GET', `${issuePath(key)}/transitions`, {
    notFound: `issue ${key}`,
  });
  return res.transitions ?? [];
}

export async function doTransition(rt: SiteRuntime, key: string, id: string): Promise<void> {
  await rt.http.request<undefined>('jira', 'POST', `${issuePath(key)}/transitions`, {
    body: { transition: { id } },
    notFound: `issue ${key}`,
  });
}

/** Adds an ADF comment; returns the comment id. */
export async function addComment(rt: SiteRuntime, key: string, body: AdfDoc): Promise<string> {
  const res = await rt.http.request<{ id: string | number }>('jira', 'POST', `${issuePath(key)}/comment`, {
    body: { body },
    notFound: `issue ${key}`,
  });
  return String(res.id);
}

const createMetaPath = (project: string) => `/rest/api/3/issue/createmeta/${encodeURIComponent(project)}/issuetypes`;

/** Reads every page of a createmeta listing; a page without `total` is taken as the last one. */
async function metaPages<T>(rt: SiteRuntime, path: string, notFound: string, read: (page: unknown) => T[]): Promise<T[]> {
  const items: T[] = [];
  for (;;) {
    const page = await rt.http.request<{ total?: number }>('jira', 'GET', path, {
      query: { startAt: items.length, maxResults: META_PAGE },
      notFound,
    });
    const batch = read(page);
    items.push(...batch);
    if (batch.length === 0 || typeof page?.total !== 'number' || items.length >= page.total) return items;
  }
}

async function cached<T>(rt: SiteRuntime, cacheKey: string, load: () => Promise<T>): Promise<T> {
  if (rt.cache.has(cacheKey)) return rt.cache.get(cacheKey) as T;
  const value = await load();
  rt.cache.set(cacheKey, value);
  return value;
}

/** The issue types a project offers for create, cached per site and project for the process lifetime. */
export function projectIssueTypes(rt: SiteRuntime, project: string): Promise<{ id: string; name: string }[]> {
  return cached(rt, `jira:issueTypes:${rt.site.name}:${project}`, () =>
    metaPages(rt, createMetaPath(project), `project ${project}`, (page) => {
      const p = (page ?? {}) as { issueTypes?: unknown; values?: unknown };
      const list = p.issueTypes ?? p.values;
      return Array.isArray(list) ? (list as { id: string | number; name: string }[]).map((t) => ({ id: String(t.id), name: t.name })) : [];
    }),
  );
}

/** Create-screen fields for a project and issue type, cached per site, project and type for the process lifetime. */
export function createMeta(rt: SiteRuntime, project: string, issueTypeId: string): Promise<FieldMeta[]> {
  return cached(rt, `jira:createMeta:${rt.site.name}:${project}:${issueTypeId}`, () =>
    metaPages(rt, `${createMetaPath(project)}/${encodeURIComponent(issueTypeId)}`, `issue type ${issueTypeId} in ${project}`, normalizeCreateMeta),
  );
}

/** The fields editable on this issue right now; not cached, since they follow the issue's status and type. */
export async function editMeta(rt: SiteRuntime, key: string): Promise<FieldMeta[]> {
  return normalizeEditMeta(await rt.http.request<unknown>('jira', 'GET', `${issuePath(key)}/editmeta`, { notFound: `issue ${key}` }));
}

export async function createIssue(rt: SiteRuntime, fields: Record<string, unknown>): Promise<{ key: string }> {
  const res = await rt.http.request<{ key: string }>('jira', 'POST', '/rest/api/3/issue', { body: { fields } });
  return { key: res.key };
}

export async function updateIssue(rt: SiteRuntime, key: string, fields: Record<string, unknown>): Promise<void> {
  await rt.http.request<undefined>('jira', 'PUT', issuePath(key), { body: { fields }, notFound: `issue ${key}` });
}
