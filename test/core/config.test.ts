import { describe, expect, it, vi } from 'vitest';
import { AtlasError } from '../../src/core/errors.js';
import { configPath, loadConfig, type ConfigDeps } from '../../src/core/config.js';

const HOME = '/h';
const DEFAULT_PATH = '/h/.config/atlas-lite-mcp/sites.json';

interface DepsOptions {
  env?: Record<string, string | undefined>;
  /** Extra in-memory files keyed by absolute path. */
  files?: Record<string, string>;
  /** JSON value written to the default config path. */
  file?: unknown;
  /** Raw text written to the default config path. */
  raw?: string;
  /** File mode for every in-memory file, default 0o600. */
  mode?: number;
}

function deps(o: DepsOptions = {}): ConfigDeps & { warn: ReturnType<typeof vi.fn<(line: string) => void>> } {
  const files: Record<string, string> = { ...o.files };
  if (o.file !== undefined) files[DEFAULT_PATH] = JSON.stringify(o.file);
  if (o.raw !== undefined) files[DEFAULT_PATH] = o.raw;
  return {
    env: o.env ?? {},
    home: HOME,
    readFile: (path) => files[path],
    fileMode: (path) => (path in files ? (o.mode ?? 0o600) : undefined),
    warn: vi.fn<(line: string) => void>(),
  };
}

function site(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { name: 'gumperr', baseUrl: 'https://gumperr.atlassian.net', email: 'a@example.com', apiToken: 'tok-SECRET-123', ...overrides };
}

const validFile = { sites: [site()] };
const twoSites = {
  sites: [
    site({ apiToken: '${GUMPERR_ATLASSIAN_TOKEN}' }),
    site({ name: 'qint', baseUrl: 'https://qint.atlassian.net', apiToken: '${QINT_TOKEN}' }),
  ],
};
const dupNames = { sites: [site(), site({ name: 'GUMPERR', baseUrl: 'https://other.atlassian.net' })] };
const badTokenType = { sites: [site({ tokenType: 'oauth' })] };
const acmeEnv = { ATLASSIAN_URL: 'https://acme.atlassian.net', ATLASSIAN_EMAIL: 'a@b.c', ATLASSIAN_TOKEN: 't' };

function errorOf(run: () => unknown): Error {
  try {
    run();
  } catch (e) {
    return e as Error;
  }
  throw new Error('expected a throw');
}

describe('loadConfig', () => {
  it('loads the file named by ATLAS_MCP_CONFIG and expands ${VAR} tokens', () => {
    const file = {
      sites: [site({ baseUrl: 'https://gumperr.atlassian.net/', apiToken: '${GUMPERR_ATLASSIAN_TOKEN}', defaultJiraProject: 'GUM', defaultConfluenceSpace: 'SD', cloudId: 'c-1' })],
    };
    const cfg = loadConfig(
      deps({ files: { '/x/sites.json': JSON.stringify(file) }, env: { ATLAS_MCP_CONFIG: '/x/sites.json', GUMPERR_ATLASSIAN_TOKEN: 'tok-SECRET-123' } }),
    );
    expect(cfg.source).toBe('file');
    expect(cfg.path).toBe('/x/sites.json');
    expect(cfg.sites[0]).toMatchObject({
      name: 'gumperr',
      baseUrl: 'https://gumperr.atlassian.net',
      host: 'gumperr.atlassian.net',
      apiToken: 'tok-SECRET-123',
      tokenType: 'classic',
      defaultJiraProject: 'GUM',
      defaultConfluenceSpace: 'SD',
      cloudId: 'c-1',
    });
    expect(cfg.sites[0]?.unavailable).toBeUndefined();
  });

  it('normalises baseUrl to its origin', () => {
    const cfg = loadConfig(deps({ file: { sites: [site({ baseUrl: 'https://gumperr.atlassian.net/wiki/spaces/SD' })] } }));
    expect(cfg.sites[0]?.baseUrl).toBe('https://gumperr.atlassian.net');
  });

  it('keeps a token literal unless the whole string is one ${VAR} reference', () => {
    const cfg = loadConfig(deps({ file: { sites: [site({ apiToken: 'abc${X}' })] }, env: { X: 'nope' } }));
    expect(cfg.sites[0]?.apiToken).toBe('abc${X}');
  });

  it('defaults to ~/.config/atlas-lite-mcp/sites.json', () => {
    expect(loadConfig(deps({ files: { [DEFAULT_PATH]: JSON.stringify(validFile) } })).path).toBe(DEFAULT_PATH);
  });

  it('configPath honours ATLAS_MCP_CONFIG, else the default path', () => {
    expect(configPath({ ATLAS_MCP_CONFIG: '/x/sites.json' }, '/h')).toBe('/x/sites.json');
    expect(configPath({}, '/h')).toBe(DEFAULT_PATH);
  });

  it('marks a site unavailable when its env reference is unset and keeps the others', () => {
    const cfg = loadConfig(deps({ file: twoSites, env: { QINT_TOKEN: 'x' } }));
    expect(cfg.sites.find((s) => s.name === 'gumperr')?.unavailable).toBe('env GUMPERR_ATLASSIAN_TOKEN is not set');
    expect(cfg.sites.find((s) => s.name === 'qint')?.unavailable).toBeUndefined();
    expect(cfg.sites.find((s) => s.name === 'qint')?.apiToken).toBe('x');
  });

  it('rejects duplicate names case-insensitively', () => {
    expect(() => loadConfig(deps({ file: dupNames }))).toThrow(/Duplicate site name "gumperr"/);
  });

  it('reports the invalid field path and never the token', () => {
    const run = () => loadConfig(deps({ file: { sites: [{ name: 'g', baseUrl: 'https://g.atlassian.net', apiToken: 'tok-SECRET-123' }] } }));
    expect(run).toThrow(AtlasError);
    expect(run).toThrow(/sites\[0\]\.email is required/);
    expect(errorOf(run).message).not.toContain('tok-SECRET-123');
  });

  it('rejects tokenType other than classic or scoped', () => {
    expect(() => loadConfig(deps({ file: badTokenType }))).toThrow(/sites\[0\]\.tokenType must be classic or scoped/);
  });

  it('rejects a baseUrl that is not an http or https URL', () => {
    expect(() => loadConfig(deps({ file: { sites: [site({ baseUrl: 'gumperr' })] } }))).toThrow(/sites\[0\]\.baseUrl must be a URL/);
  });

  it('throws a parse error naming the path for invalid JSON', () => {
    expect(() => loadConfig(deps({ raw: '{nope' }))).toThrow(/Could not parse \/h\/\.config\/atlas-lite-mcp\/sites\.json/);
  });

  it('never echoes file content in a parse error', () => {
    const err = errorOf(() => loadConfig(deps({ raw: '{"sites":[{"apiToken":"tok-SECRET-123",' })));
    expect(err).toBeInstanceOf(AtlasError);
    expect(err.message).not.toContain('tok-SECRET-123');
  });

  it('builds one site from ATLASSIAN_* env when no file exists', () => {
    const cfg = loadConfig(deps({ env: { ...acmeEnv, ATLASSIAN_TOKEN_TYPE: 'scoped' } }));
    expect(cfg.source).toBe('env');
    expect(cfg.sites).toEqual([
      expect.objectContaining({ name: 'acme', baseUrl: 'https://acme.atlassian.net', host: 'acme.atlassian.net', email: 'a@b.c', apiToken: 't', tokenType: 'scoped' }),
    ]);
  });

  it('defaults the env site to a classic token', () => {
    expect(loadConfig(deps({ env: acmeEnv })).sites[0]?.tokenType).toBe('classic');
  });

  it('names the missing variable when the env site is incomplete', () => {
    expect(() => loadConfig(deps({ env: { ATLASSIAN_URL: 'https://acme.atlassian.net', ATLASSIAN_TOKEN: 't' } }))).toThrow(/ATLASSIAN_EMAIL is not set/);
  });

  it('rejects an invalid ATLASSIAN_TOKEN_TYPE', () => {
    expect(() => loadConfig(deps({ env: { ...acmeEnv, ATLASSIAN_TOKEN_TYPE: 'oauth' } }))).toThrow(/ATLASSIAN_TOKEN_TYPE must be classic or scoped/);
  });

  it('prefers the file over env and says so once on stderr', () => {
    const d = deps({ file: validFile, mode: 0o600, env: acmeEnv });
    expect(loadConfig(d).sites.map((s) => s.name)).toEqual(['gumperr']);
    expect(d.warn).toHaveBeenCalledTimes(1);
    expect(d.warn).toHaveBeenCalledWith('Using /h/.config/atlas-lite-mcp/sites.json; ATLASSIAN_URL, ATLASSIAN_EMAIL and ATLASSIAN_TOKEN are ignored.');
  });

  it('warns about group or world readable files', () => {
    const d = deps({ file: validFile, mode: 0o644 });
    loadConfig(d);
    expect(d.warn).toHaveBeenCalledWith('/h/.config/atlas-lite-mcp/sites.json is readable by other users; run chmod 600 /h/.config/atlas-lite-mcp/sites.json');
    const quiet = deps({ file: validFile, mode: 0o600 });
    loadConfig(quiet);
    expect(quiet.warn).not.toHaveBeenCalled();
  });

  it('returns no sites and source none when nothing is configured', () => {
    expect(loadConfig(deps({}))).toMatchObject({ sites: [], source: 'none', path: DEFAULT_PATH });
  });
});
