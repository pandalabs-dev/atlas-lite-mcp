import { describe, expect, it } from 'vitest';
import type { Site } from '../../src/core/config.js';
import { AtlasError } from '../../src/core/errors.js';
import { resolveSite } from '../../src/core/sites.js';

function site(name: string, host: string): Site {
  return { name, baseUrl: `https://${host}`, host, email: 'me@example.com', apiToken: 'tok-SECRET-123', tokenType: 'classic' };
}

const gumperr = site('gumperr', 'gumperr.atlassian.net');
const qint = site('qint', 'qint.atlassian.net');
const two = [gumperr, qint];

describe('resolveSite', () => {
  it('selects by URL host', () => {
    expect(resolveSite(two, { host: 'qint.atlassian.net' }).name).toBe('qint');
    expect(resolveSite(two, { host: 'QINT.atlassian.net' }).name).toBe('qint');
  });

  it('accepts an explicit site that agrees with the URL host', () => {
    expect(resolveSite(two, { site: 'qint', host: 'qint.atlassian.net' }).name).toBe('qint');
    expect(resolveSite(two, { site: 'Qint.Atlassian.net', host: 'qint.atlassian.net' }).name).toBe('qint');
  });

  it('fails when site and URL host disagree', () => {
    expect(() => resolveSite(two, { site: 'gumperr', host: 'qint.atlassian.net' })).toThrow(/URL belongs to qint\.atlassian\.net but site "gumperr" was given/);
  });

  it('matches site by name or host case-insensitively', () => {
    expect(resolveSite(two, { site: 'QINT' }).name).toBe('qint');
    expect(resolveSite(two, { site: 'Gumperr.Atlassian.net' }).name).toBe('gumperr');
  });

  it('prefers a name match over a host match when a name equals another site host', () => {
    const odd = site('gumperr.atlassian.net', 'odd.atlassian.net');
    expect(resolveSite([gumperr, odd], { site: 'gumperr.atlassian.net' }).name).toBe('gumperr.atlassian.net');
    expect(resolveSite([odd, gumperr], { site: 'gumperr.atlassian.net' }).name).toBe('gumperr.atlassian.net');
    expect(() => resolveSite([gumperr, odd], { site: 'gumperr.atlassian.net', host: 'gumperr.atlassian.net' })).toThrow(
      /URL belongs to gumperr\.atlassian\.net but site "gumperr\.atlassian\.net" was given/,
    );
  });

  it('reports an unknown site name with configured names', () => {
    expect(() => resolveSite(two, { site: 'other' })).toThrow('No configured site named "other"; pass site as one of: gumperr, qint.');
  });

  it('uses the only site when nothing is given', () => {
    expect(resolveSite([gumperr], {}).name).toBe('gumperr');
  });

  it('lists names when ambiguous', () => {
    expect(() => resolveSite(two, {})).toThrow('Several sites are configured; pass site as one of: gumperr, qint.');
  });

  it('reports unknown hosts with configured names', () => {
    expect(() => resolveSite(two, { host: 'other.atlassian.net' })).toThrow(/No configured site for other\.atlassian\.net; configured: gumperr, qint/);
  });

  it('reports unavailable sites with the reason', () => {
    expect(() => resolveSite([{ ...gumperr, unavailable: 'env GUMPERR_ATLASSIAN_TOKEN is not set' }], {})).toThrow(
      'Site gumperr is unavailable: env GUMPERR_ATLASSIAN_TOKEN is not set.',
    );
    expect(() => resolveSite([{ ...gumperr, unavailable: 'env X is not set' }, qint], { host: 'gumperr.atlassian.net' })).toThrow(
      'Site gumperr is unavailable: env X is not set.',
    );
    expect(resolveSite([{ ...gumperr, unavailable: 'env X is not set' }, qint], { site: 'qint' }).name).toBe('qint');
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
