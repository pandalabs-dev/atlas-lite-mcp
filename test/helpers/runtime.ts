import type { Site } from '../../src/core/config.js';
import { createRuntime, type Runtime } from '../../src/core/runtime.js';
import { mockFetch, type Call, type Route } from './fetch.js';

export const northstar: Site = {
  name: 'northstar',
  baseUrl: 'https://northstar.atlassian.net',
  host: 'northstar.atlassian.net',
  email: 'a@b.c',
  apiToken: 'tok-SECRET-123',
  tokenType: 'classic',
};

/** A runtime over mocked routes; one site `northstar` by default, sleep is a no-op. */
export function testRuntime(routes: Route[], sites: Site[] = [northstar]): { rt: Runtime; calls: Call[] } {
  const { fetch, calls } = mockFetch(routes);
  const rt = createRuntime({ sites, source: 'file', path: '/h/sites.json' }, { fetch, sleep: async () => {} });
  return { rt, calls };
}
