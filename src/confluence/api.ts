import { AtlasError } from '../core/errors.js';
import type { SiteRuntime } from '../core/runtime.js';

/** A Confluence page with its storage body, as the write path needs it. */
export interface PageData {
  id: string;
  title: string;
  spaceId: string;
  version: number;
  storage: string;
  /** Path below `<baseUrl>/wiki`, e.g. `/spaces/SD/pages/7/Costs`. */
  webui?: string;
}

interface PageResponse {
  id: string | number;
  title: string;
  spaceId: string | number;
  version: { number: number };
  body?: { storage?: { value?: string } };
  _links?: { webui?: string };
}

const pagePath = (id: string) => `/wiki/api/v2/pages/${encodeURIComponent(id)}`;

export async function getPage(rt: SiteRuntime, id: string): Promise<PageData> {
  const res = await rt.http.request<PageResponse>('confluence', 'GET', pagePath(id), {
    query: { 'body-format': 'storage' },
    notFound: `page ${id}`,
  });
  const storage = res.body?.storage?.value;
  // Building a write on an empty stand-in would replace the live body, so a missing body fails.
  if (typeof storage !== 'string') {
    throw new AtlasError(`Page "${res.title || id}" returned no storage body; retry or check that the page is a normal page.`);
  }
  const page: PageData = {
    id: String(res.id),
    title: res.title,
    spaceId: String(res.spaceId),
    version: res.version.number,
    storage,
  };
  if (res._links?.webui !== undefined) page.webui = res._links.webui;
  return page;
}

/** PUTs a new body as `version + 1` with the given version message; returns the new version. */
export async function putPage(rt: SiteRuntime, page: PageData, storage: string, message: string): Promise<number> {
  const next = page.version + 1;
  const res = await rt.http.request<{ version?: { number?: number } } | undefined>('confluence', 'PUT', pagePath(page.id), {
    body: {
      id: page.id,
      status: 'current',
      title: page.title,
      body: { representation: 'storage', value: storage },
      version: { number: next, message },
    },
    notFound: `page ${page.id}`,
  });
  return res?.version?.number ?? next;
}

/** The space key for a v2 space id, cached per site for the process lifetime. */
export async function spaceKeyForId(rt: SiteRuntime, spaceId: string): Promise<string> {
  const cacheKey = `confluence:spaceKey:${rt.site.name}:${spaceId}`;
  const cached = rt.cache.get(cacheKey);
  if (typeof cached === 'string') return cached;
  const res = await rt.http.request<{ key: string }>('confluence', 'GET', `/wiki/api/v2/spaces/${encodeURIComponent(spaceId)}`, {
    notFound: `space ${spaceId}`,
  });
  rt.cache.set(cacheKey, res.key);
  return res.key;
}

/** The v2 space id for a space key, cached per site for the process lifetime. */
export async function spaceIdForKey(rt: SiteRuntime, key: string): Promise<string> {
  const cacheKey = `confluence:spaceId:${rt.site.name}:${key}`;
  const cached = rt.cache.get(cacheKey);
  if (typeof cached === 'string') return cached;
  const res = await rt.http.request<{ results?: { id: string | number }[] }>('confluence', 'GET', '/wiki/api/v2/spaces', {
    query: { keys: key },
    notFound: `space ${key}`,
  });
  const space = res.results?.[0];
  if (space === undefined) throw new AtlasError(`No Confluence space "${key}" on site ${rt.site.name}.`);
  const id = String(space.id);
  rt.cache.set(cacheKey, id);
  return id;
}

/** Creates a current page from storage XHTML; v2 POST takes no version message. */
export async function createPage(
  rt: SiteRuntime,
  input: { spaceId: string; title: string; storage: string; parentId?: string },
): Promise<{ id: string; version: number; url: string }> {
  const res = await rt.http.request<{ id: string | number; version?: { number?: number }; _links?: { webui?: string } }>(
    'confluence',
    'POST',
    '/wiki/api/v2/pages',
    {
      body: {
        spaceId: input.spaceId,
        status: 'current',
        title: input.title,
        ...(input.parentId !== undefined && { parentId: input.parentId }),
        body: { representation: 'storage', value: input.storage },
      },
      notFound: input.parentId === undefined ? `space ${input.spaceId}` : `space ${input.spaceId} or parent page ${input.parentId}`,
    },
  );
  const id = String(res.id);
  const webui = res._links?.webui ?? `/pages/viewpage.action?pageId=${id}`;
  return { id, version: res.version?.number ?? 1, url: `${rt.site.baseUrl}/wiki${webui}` };
}

interface SearchResponse {
  results?: { id: string | number; title: string; space?: { key?: string }; version?: { when?: string } }[];
}

/** CQL search through REST v1; `modified` is the date part of the last version. */
export async function searchPages(rt: SiteRuntime, cql: string, limit: number): Promise<{ id: string; title: string; space: string; modified: string }[]> {
  const res = await rt.http.request<SearchResponse>('confluence', 'GET', '/wiki/rest/api/content/search', {
    query: { cql, limit, expand: 'space,version' },
  });
  return (res.results ?? []).map((r) => ({
    id: String(r.id),
    title: r.title,
    space: r.space?.key ?? '',
    modified: (r.version?.when ?? '').slice(0, 10),
  }));
}

/** Adds a footer comment in storage XHTML; returns the comment id. */
export async function addFooterComment(rt: SiteRuntime, pageId: string, storage: string): Promise<string> {
  const res = await rt.http.request<{ id: string | number }>('confluence', 'POST', '/wiki/api/v2/footer-comments', {
    body: { pageId, body: { representation: 'storage', value: storage } },
    notFound: `page ${pageId}`,
  });
  return String(res.id);
}
