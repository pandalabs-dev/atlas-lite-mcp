import { describe, expect, it } from 'vitest';
import type { Site } from '../../src/core/config.js';
import { AtlasError } from '../../src/core/errors.js';
import { resolveSite } from '../../src/core/sites.js';

function site(name: string, host: string): Site {
  return { name, baseUrl: `https://${host}`, host, email: 'me@example.com', apiToken: 'tok-SECRET-123', tokenType: 'classic' };
}

const northstar = site('northstar', 'northstar.atlassian.net');
const bluebird = site('bluebird', 'bluebird.atlassian.net');
const two = [northstar, bluebird];

describe('resolveSite', () => {
  it('selects by URL host', () => {
    expect(resolveSite(two, { host: 'bluebird.atlassian.net' }).name).toBe('bluebird');
    expect(resolveSite(two, { host: 'BLUEBIRD.atlassian.net' }).name).toBe('bluebird');
  });

  it('accepts an explicit site that agrees with the URL host', () => {
    expect(resolveSite(two, { site: 'bluebird', host: 'bluebird.atlassian.net' }).name).toBe('bluebird');
    expect(resolveSite(two, { site: 'Bluebird.Atlassian.net', host: 'bluebird.atlassian.net' }).name).toBe('bluebird');
  });

  it('fails when site and URL host disagree', () => {
    expect(() => resolveSite(two, { site: 'northstar', host: 'bluebird.atlassian.net' })).toThrow(/URL belongs to bluebird\.atlassian\.net but site "northstar" was given/);
  });

  it('matches site by name or host case-insensitively', () => {
    expect(resolveSite(two, { site: 'BLUEBIRD' }).name).toBe('bluebird');
    expect(resolveSite(two, { site: 'Northstar.Atlassian.net' }).name).toBe('northstar');
  });

  it('prefers a name match over a host match when a name equals another site host', () => {
    const odd = site('northstar.atlassian.net', 'odd.atlassian.net');
    expect(resolveSite([northstar, odd], { site: 'northstar.atlassian.net' }).name).toBe('northstar.atlassian.net');
    expect(resolveSite([odd, northstar], { site: 'northstar.atlassian.net' }).name).toBe('northstar.atlassian.net');
    expect(() => resolveSite([northstar, odd], { site: 'northstar.atlassian.net', host: 'northstar.atlassian.net' })).toThrow(
      /URL belongs to northstar\.atlassian\.net but site "northstar\.atlassian\.net" was given/,
    );
  });

  it('reports an unknown site name with configured names', () => {
    expect(() => resolveSite(two, { site: 'other' })).toThrow('No configured site named "other"; pass site as one of: northstar, bluebird.');
  });

  it('uses the only site when nothing is given', () => {
    expect(resolveSite([northstar], {}).name).toBe('northstar');
  });

  it('lists names when ambiguous', () => {
    expect(() => resolveSite(two, {})).toThrow('Several sites are configured; pass site as one of: northstar, bluebird.');
  });

  it('reports unknown hosts with configured names', () => {
    expect(() => resolveSite(two, { host: 'other.atlassian.net' })).toThrow(/No configured site for other\.atlassian\.net; configured: northstar, bluebird/);
  });

  it('reports unavailable sites with the reason', () => {
    expect(() => resolveSite([{ ...northstar, unavailable: 'env NORTHSTAR_ATLASSIAN_TOKEN is not set' }], {})).toThrow(
      'Site northstar is unavailable: env NORTHSTAR_ATLASSIAN_TOKEN is not set.',
    );
    expect(() => resolveSite([{ ...northstar, unavailable: 'env X is not set' }, bluebird], { host: 'northstar.atlassian.net' })).toThrow(
      'Site northstar is unavailable: env X is not set.',
    );
    expect(resolveSite([{ ...northstar, unavailable: 'env X is not set' }, bluebird], { site: 'bluebird' }).name).toBe('bluebird');
  });

  it('tells the user how to configure when there are no sites', () => {
    expect(() => resolveSite([], {})).toThrow(
      'No Atlassian sites are configured. Run "npx atlas-lite-mcp init" or set ATLASSIAN_URL, ATLASSIAN_EMAIL and ATLASSIAN_TOKEN.',
    );
  });

  it('throws AtlasError', () => {
    expect(() => resolveSite(two, {})).toThrow(AtlasError);
  });
});
