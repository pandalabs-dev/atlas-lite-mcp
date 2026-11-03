import type { Site } from '../../src/core/config.js';
import { createRuntime, type Runtime } from '../../src/core/runtime.js';
import { mockFetch, type Call, type Route } from './fetch.js';

export const gumperr: Site = {
  name: 'gumperr',
  baseUrl: 'https://gumperr.atlassian.net',
  host: 'gumperr.atlassian.net',
  email: 'a@b.c',
  apiToken: 'tok-SECRET-123',
  tokenType: 'classic',
};

/** A runtime over mocked routes; one site `gumperr` by default, sleep is a no-op. */
export function testRuntime(routes: Route[], sites: Site[] = [gumperr]): { rt: Runtime; calls: Call[] } {
  const { fetch, calls } = mockFetch(routes);
  const rt = createRuntime({ sites, source: 'file', path: '/h/sites.json' }, { fetch, sleep: async () => {} });
  return { rt, calls };
}
