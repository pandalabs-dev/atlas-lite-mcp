import type { SiteRuntime } from '../core/runtime.js';
import type { AdfDoc } from './adf/toMarkdown.js';

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

const issuePath = (key: string) => `/rest/api/3/issue/${encodeURIComponent(key)}`;

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
