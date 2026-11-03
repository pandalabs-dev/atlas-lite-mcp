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
  const page: PageData = {
    id: String(res.id),
    title: res.title,
    spaceId: String(res.spaceId),
    version: res.version.number,
    storage: res.body?.storage?.value ?? '',
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
