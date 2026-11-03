import { AtlasError } from './errors.js';

export interface PageRef {
  id: string;
  /** Host of the URL the id came from; absent for a bare id. */
  host?: string;
}

export interface IssueRef {
  /** Upper-cased issue key such as KEY-123. */
  key: string;
  /** Host of the URL the key came from; absent for a bare key. */
  host?: string;
}

const PAGE_ID = /^\d+$/;
const PAGE_PATH = /\/pages\/(?:edit-v2\/)?(\d+)(?=\/|$)/;
const TINY_LINK = /\/wiki\/x\//;
const ISSUE_KEY = /^[A-Z][A-Z0-9_]+-\d+$/;
const BROWSE_PATH = /\/browse\/([^/]+)/;

/** Accepts a numeric page id, a page URL (`/pages/{id}`, `/pages/edit-v2/{id}`) or a `pageId=` URL. */
export function parsePageRef(input: string): PageRef {
  const text = input.trim();
  if (PAGE_ID.test(text)) return { id: text };

  const url = parseHttpUrl(text);
  if (url !== undefined) {
    if (TINY_LINK.test(url.pathname)) {
      throw new AtlasError('Tiny links are not supported; open the page and copy its full URL.');
    }
    const fromQuery = url.searchParams.get('pageId');
    if (fromQuery !== null && PAGE_ID.test(fromQuery)) return { id: fromQuery, host: url.host };
    const fromPath = PAGE_PATH.exec(url.pathname)?.[1];
    if (fromPath !== undefined) return { id: fromPath, host: url.host };
  }
  throw new AtlasError(`Not a Confluence page URL or id: "${text}"; pass a page URL or its numeric id.`);
}

/** Accepts an issue key, a `/browse/{key}` URL or a board URL with `selectedIssue={key}`. */
export function parseIssueRef(input: string): IssueRef {
  const text = input.trim();
  const bare = text.toUpperCase();
  if (ISSUE_KEY.test(bare)) return { key: bare };

  const url = parseHttpUrl(text);
  if (url !== undefined) {
    const candidates = [BROWSE_PATH.exec(url.pathname)?.[1], url.searchParams.get('selectedIssue')];
    for (const candidate of candidates) {
      const key = candidate?.toUpperCase();
      if (key !== undefined && ISSUE_KEY.test(key)) return { key, host: url.host };
    }
  }
  throw new AtlasError(`Not a Jira issue URL or key: "${text}"; pass an issue URL or a key such as KEY-123.`);
}

function parseHttpUrl(text: string): URL | undefined {
  try {
    const url = new URL(text);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : undefined;
  } catch {
    return undefined;
  }
}
