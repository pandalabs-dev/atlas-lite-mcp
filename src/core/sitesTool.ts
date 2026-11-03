import type { Site } from './config.js';
import { AtlasError } from './errors.js';
import { mdTable } from './format.js';
import type { Product } from './http.js';
import type { Runtime } from './runtime.js';
import { NO_SITES } from './sites.js';
import { defineTool, type ProductModule } from './tools.js';

const PROBES: { product: Product; path: string; query?: Record<string, number> }[] = [
  { product: 'jira', path: '/rest/api/3/myself' },
  { product: 'confluence', path: '/wiki/api/v2/spaces', query: { limit: 1 } },
];

export const sitesTool = defineTool({
  name: 'sites_list',
  description: 'List configured Atlassian sites and what they can reach.',
  shape: {},
  async run(_args, rt) {
    if (rt.configError !== undefined) return rt.configError;
    const sites = rt.sites();
    if (sites.length === 0) return NO_SITES;
    const rows = await Promise.all(
      sites.map(async (s) => [s.name, s.host, await reachable(s, rt), s.defaultJiraProject ?? '-', s.defaultConfluenceSpace ?? '-']),
    );
    return mdTable(['site', 'host', 'reachable', 'project', 'space'], rows);
  },
});

/** Core tools that belong to no product. */
export const coreModule: ProductModule = { name: 'core', tools: [sitesTool] };

/** `jira, confluence`, `jira (confluence: 401)` or `unavailable: <reason>`. */
async function reachable(site: Site, rt: Runtime): Promise<string> {
  if (site.unavailable !== undefined) return `unavailable: ${site.unavailable}`;
  const { http } = rt.resolve({ site: site.name });
  const results = await Promise.all(
    PROBES.map(async ({ product, path, query }) => {
      try {
        await http.request(product, 'GET', path, { query });
        return { product, failure: undefined };
      } catch (e) {
        return { product, failure: probeFailure(e) };
      }
    }),
  );
  const ok = results.filter((r) => r.failure === undefined).map((r) => r.product);
  const failed = results.filter((r) => r.failure !== undefined).map((r) => `${r.product}: ${r.failure}`);
  const head = ok.length > 0 ? ok.join(', ') : 'none';
  return failed.length > 0 ? `${head} (${failed.join(', ')})` : head;
}

/** The HTTP status when known, else the detail in parentheses, else the first words of the message. */
function probeFailure(e: unknown): string {
  if (e instanceof AtlasError && e.status !== undefined) return String(e.status);
  const message = e instanceof Error ? e.message : String(e);
  const detail = /\(([^)]+)\)/.exec(message)?.[1];
  return detail ?? message.split(/\s+/).slice(0, 4).join(' ').replace(/[.;:,]$/, '');
}

