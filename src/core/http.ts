import type { Site } from './config.js';
import { AtlasError } from './errors.js';

export type Product = 'jira' | 'confluence';
export type HttpMethod = 'GET' | 'POST' | 'PUT';

export interface RequestOptions {
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  /** What was looked up, for the 404 message, e.g. "page 9". Defaults to the path. */
  notFound?: string;
}

export interface HttpClient {
  /** Resolves to the parsed JSON body, or undefined for 204 and empty bodies. */
  request<T>(product: Product, method: HttpMethod, path: string, opts?: RequestOptions): Promise<T>;
}

export interface HttpDeps {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

const MAX_RETRIES = 3;
const MAX_WAIT_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 30_000;
const TOKEN_URL = 'id.atlassian.com/manage-profile/security/api-tokens';

/**
 * Base URL for a product. Paths always carry their full /rest/... or /wiki/... prefix;
 * this is the one place to change if scoped Confluence turns out to drop /wiki.
 */
export function baseUrlFor(site: Site, product: Product, cloudId?: string): string {
  if (site.tokenType === 'classic') return site.baseUrl;
  const id = cloudId ?? site.cloudId;
  if (!id) throw new AtlasError(`Site ${site.name} uses a scoped token but has no cloudId; set cloudId for this site in sites.json.`);
  return `https://api.atlassian.com/ex/${product}/${id}`;
}

export function createHttpClient(site: Site, deps: HttpDeps = {}): HttpClient {
  const doFetch: typeof fetch = deps.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const credentials = Buffer.from(`${site.email}:${site.apiToken}`).toString('base64');
  let cloudId: Promise<string> | undefined;

  /** Builds an AtlasError whose message never carries the token. */
  function fail(message: string, status?: number): AtlasError {
    let safe = message;
    for (const secret of [site.apiToken, credentials]) if (secret) safe = safe.split(secret).join('[redacted]');
    return new AtlasError(safe, status === undefined ? undefined : { status });
  }

  async function send<T>(method: HttpMethod, url: string, auth: boolean, body: unknown, notFound: string): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json', 'user-agent': 'atlas-lite-mcp' };
    if (auth) headers.authorization = `Basic ${credentials}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const payload = body === undefined ? undefined : JSON.stringify(body);

    for (let attempt = 0; ; attempt++) {
      let res: Response;
      let text: string;
      try {
        res = await doFetch(url, { method, headers, body: payload, signal: AbortSignal.timeout(timeoutMs) });
        text = await res.text();
      } catch (e) {
        throw transportError(e);
      }

      if (res.status === 429 && attempt < MAX_RETRIES) {
        await sleep(retryDelayMs(res.headers.get('retry-after'), attempt));
        continue;
      }
      if (res.ok) return parseBody<T>(res.status, text);
      throw statusError(res, text, notFound);
    }
  }

  function transportError(e: unknown): AtlasError {
    if (e instanceof Error && e.name === 'TimeoutError') {
      return fail(`Request to site ${site.name} timed out after ${timeoutMs / 1000} s.`);
    }
    const cause = e instanceof Error ? (e.cause as { code?: unknown; message?: unknown } | undefined) : undefined;
    const detail = [cause?.code, cause?.message, e instanceof Error ? e.message : String(e)].find(
      (d): d is string => typeof d === 'string' && d !== '',
    );
    return fail(`Could not reach site ${site.name} (${detail ?? 'unknown error'}).`);
  }

  function parseBody<T>(status: number, text: string): T {
    if (status === 204 || text === '') return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw fail(`Site ${site.name} returned a response that is not JSON (${status}).`, status);
    }
  }

  function statusError(res: Response, text: string, notFound: string): AtlasError {
    const { status } = res;
    const name = site.name;
    switch (status) {
      case 401:
        return fail(`Token or email for site ${name} rejected (401). Check the email in sites.json; tokens expire after at most 365 days, create a new one at ${TOKEN_URL} and update sites.json.`, status);
      case 403:
        return fail(`Access denied on site ${name} (403): the account may lack access to this product or item, or a scoped token is missing a scope.`, status);
      case 404:
        return fail(`Not found on site ${name}: ${notFound}. Atlassian also returns 404 when the account lacks permission.`, status);
      case 429: {
        const reason = res.headers.get('ratelimit-reason');
        return fail(`Rate limited by site ${name} after ${MAX_RETRIES} retries${reason ? ` (${reason})` : ''}; try again in a minute.`, status);
      }
    }
    if (status >= 500) return fail(`Site ${name} returned ${status}; try again shortly.`, status);
    const detail = firstAtlassianMessage(text);
    return fail(detail ? `Site ${name} rejected the request (${status}): ${sentence(detail)}` : `Site ${name} rejected the request (${status}).`, status);
  }

  async function resolveCloudId(): Promise<string> {
    const info = await send<{ cloudId?: unknown } | undefined>('GET', `${site.baseUrl}/_edge/tenant_info`, false, undefined, '/_edge/tenant_info');
    if (typeof info?.cloudId === 'string' && info.cloudId !== '') return info.cloudId;
    throw fail(`Could not resolve the cloudId of site ${site.name} from /_edge/tenant_info; set cloudId for this site in sites.json.`);
  }

  async function baseFor(product: Product): Promise<string> {
    if (site.tokenType === 'classic' || site.cloudId) return baseUrlFor(site, product);
    if (cloudId === undefined) {
      cloudId = resolveCloudId();
      // A failed lookup is not cached, so the next request tries again.
      cloudId.catch(() => {
        cloudId = undefined;
      });
    }
    return baseUrlFor(site, product, await cloudId);
  }

  return {
    async request<T>(product: Product, method: HttpMethod, path: string, opts: RequestOptions = {}): Promise<T> {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(opts.query ?? {})) if (value !== undefined) query.append(key, String(value));
      const qs = query.toString();
      const url = (await baseFor(product)) + path + (qs ? `?${qs}` : '');
      return send<T>(method, url, true, opts.body, opts.notFound ?? path);
    },
  };
}

/** Retry-After is seconds or an HTTP date; without it the wait doubles per attempt. Capped at 60 s. */
function retryDelayMs(header: string | null, attempt: number): number {
  let ms = 2 ** attempt * 1000;
  if (header !== null) {
    const value = header.trim();
    if (/^\d+$/.test(value)) ms = Number(value) * 1000;
    else {
      const at = Date.parse(value);
      if (!Number.isNaN(at)) ms = Math.max(0, at - Date.now());
    }
  }
  return Math.min(ms, MAX_WAIT_MS);
}

/** First message from a Jira or Confluence error body: errorMessages, errors map, v2 errors list, then message. */
function firstAtlassianMessage(text: string): string | undefined {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (data === null || typeof data !== 'object') return undefined;
  const body = data as { errorMessages?: unknown; errors?: unknown; message?: unknown };
  const candidates: unknown[] = [];
  if (Array.isArray(body.errorMessages)) candidates.push(body.errorMessages[0]);
  if (Array.isArray(body.errors)) candidates.push((body.errors[0] as { title?: unknown } | undefined)?.title);
  else if (body.errors !== null && typeof body.errors === 'object') candidates.push(Object.values(body.errors)[0]);
  candidates.push(body.message);
  return candidates.find((c): c is string => typeof c === 'string' && c.trim() !== '')?.trim();
}

function sentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}
