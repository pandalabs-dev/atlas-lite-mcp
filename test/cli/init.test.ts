import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPrompter, InputEndedError, runInit, writePrivateFile, type InitDeps } from '../../src/cli/init.js';
import { mockFetch, type Call, type Route } from '../helpers/fetch.js';

const PATH = '/h/.config/atlas-lite-mcp/sites.json';
const SECRET = 'tok-SECRET-123';

const myselfOk = (displayName: string): Route => ({ method: 'GET', path: '/rest/api/3/myself', json: { displayName } });
const spacesOk: Route = { method: 'GET', path: '/wiki/api/v2/spaces', json: { results: [] } };
const myself401: Route = { method: 'GET', path: '/rest/api/3/myself', status: 401 };
const spaces404: Route = { method: 'GET', path: '/wiki/api/v2/spaces', status: 404 };

/** name, url, email, token, token type, project, space, another site. */
const DEFAULT_ANSWERS = ['northstar', 'northstar.atlassian.net', 'a@b.c', 'NORTHSTAR_ATLASSIAN_TOKEN', '', 'DEMO', 'DOCS', 'n'];

function literalTokenAnswers(token: string): string[] {
  return DEFAULT_ANSWERS.map((a, i) => (i === 3 ? token : a));
}

interface Opts {
  answers?: string[];
  env?: Record<string, string | undefined>;
  routes?: Route[];
  files?: Record<string, string>;
}

type Ask = (question: string, opts?: { default?: string; secret?: boolean }) => Promise<string>;

function deps(opts: Opts = {}) {
  const answers = [...(opts.answers ?? DEFAULT_ANSWERS)];
  const ask = vi.fn<Ask>(async () => {
    const next = answers.shift();
    if (next === undefined) throw new InputEndedError();
    return next;
  });
  const prompter = { ask, close: vi.fn() };
  const m = mockFetch(opts.routes ?? [myselfOk('Alex Example'), spacesOk]);
  const files = { ...opts.files };
  const written: Record<string, string> = {};
  const lines: string[] = [];
  const d = {
    prompter,
    out: (line: string) => {
      lines.push(line);
    },
    configPath: PATH,
    env: opts.env ?? { NORTHSTAR_ATLASSIAN_TOKEN: SECRET },
    fetch: m.fetch,
    readFile: (p: string) => files[p],
    writeFile: (p: string, data: string) => {
      written[p] = data;
    },
    written,
    lines,
    calls: m.calls as Call[],
  } satisfies InitDeps & Record<string, unknown>;
  return d;
}

async function runInitWith(opts: Opts) {
  const d = deps(opts);
  const code = await runInit(d);
  return { ...d, code };
}

function writtenSites(d: { written: Record<string, string> }): unknown {
  const raw = d.written[PATH];
  expect(raw).toBeDefined();
  return JSON.parse(raw!);
}

describe('runInit', () => {
  it('writes sites.json with an env reference, mode handled by writeFile, and verifies products', async () => {
    const d = deps({ env: { NORTHSTAR_ATLASSIAN_TOKEN: SECRET }, routes: [myselfOk('Alex Example'), spacesOk] });
    expect(await runInit(d)).toBe(0);
    expect(writtenSites(d)).toEqual({
      sites: [
        {
          name: 'northstar',
          baseUrl: 'https://northstar.atlassian.net',
          email: 'a@b.c',
          apiToken: '${NORTHSTAR_ATLASSIAN_TOKEN}',
          tokenType: 'classic',
          defaultJiraProject: 'DEMO',
          defaultConfluenceSpace: 'DOCS',
        },
      ],
    });
    expect(d.written[PATH]).toBe(
      JSON.stringify(
        {
          sites: [
            {
              name: 'northstar',
              baseUrl: 'https://northstar.atlassian.net',
              email: 'a@b.c',
              apiToken: '${NORTHSTAR_ATLASSIAN_TOKEN}',
              tokenType: 'classic',
              defaultJiraProject: 'DEMO',
              defaultConfluenceSpace: 'DOCS',
            },
          ],
        },
        null,
        2,
      ) + '\n',
    );
    expect(d.lines).toContain('northstar: Jira ok (Alex Example), Confluence ok');
    expect(d.lines.join('\n')).toContain('claude mcp add atlas -- npx -y atlas-lite-mcp');
    expect(d.lines.slice(-2)).toEqual([`Wrote ${PATH} (mode 600).`, 'Add to Claude Code: claude mcp add atlas -- npx -y atlas-lite-mcp']);
    expect(d.calls.map((c) => c.url)).toEqual([
      'https://northstar.atlassian.net/rest/api/3/myself',
      'https://northstar.atlassian.net/wiki/api/v2/spaces?limit=1',
    ]);
    expect(d.calls[0]!.headers.authorization).toBe(`Basic ${Buffer.from(`a@b.c:${SECRET}`).toString('base64')}`);
    expect(d.prompter.close).toHaveBeenCalled();
  });

  it('asks the questions in order with the token as a secret', async () => {
    const d = deps();
    await runInit(d);
    expect(d.prompter.ask.mock.calls).toEqual([
      ['Site name'],
      ['Site URL (e.g. https://acme.atlassian.net)'],
      ['Atlassian account email'],
      ['API token, or the name of an env variable that holds it', { secret: true }],
      ['Token type, classic or scoped', { default: 'classic' }],
      ['Default Jira project key (optional)'],
      ['Default Confluence space key (optional)'],
      ['Add another site? (y/N)'],
    ]);
  });

  it('asks for the token as a secret and never prints it', async () => {
    const d = deps({ answers: literalTokenAnswers(SECRET) });
    expect(await runInit(d)).toBe(0);
    expect(d.prompter.ask).toHaveBeenCalledWith(expect.stringMatching(/token/i), expect.objectContaining({ secret: true }));
    expect(d.lines.join('\n')).not.toContain(SECRET);
    expect(d.lines).toContain('northstar: Jira ok (Alex Example), Confluence ok');
    expect((writtenSites(d) as { sites: { apiToken: string }[] }).sites[0]!.apiToken).toBe(SECRET);
  });

  it('replaces a site with the same name and keeps others', async () => {
    const bluebird = { name: 'bluebird', baseUrl: 'https://bluebird.atlassian.net', email: 'q@b.c', apiToken: '${BLUEBIRD_TOKEN}' };
    const existing = { sites: [{ name: 'northstar', baseUrl: 'https://old.atlassian.net', email: 'old@b.c', apiToken: '${OLD_TOKEN}' }, bluebird] };
    const d = deps({ env: { NORTHSTAR_ATLASSIAN_TOKEN: SECRET }, routes: [myselfOk('Alex Example'), spacesOk], files: { [PATH]: JSON.stringify(existing) } });
    expect(await runInit(d)).toBe(0);
    const { sites } = writtenSites(d) as { sites: { name: string }[] };
    expect(sites.map((x) => x.name)).toEqual(['northstar', 'bluebird']);
    expect(sites[0]).toMatchObject({ baseUrl: 'https://northstar.atlassian.net', email: 'a@b.c', apiToken: '${NORTHSTAR_ATLASSIAN_TOKEN}' });
    expect(sites[1]).toEqual(bluebird);
  });

  it('matches an existing site name ignoring case and appends a new one', async () => {
    const existing = { sites: [{ name: 'Northstar', baseUrl: 'https://old.atlassian.net', email: 'old@b.c', apiToken: '${OLD_TOKEN}' }] };
    const answers = [...DEFAULT_ANSWERS.slice(0, 7), 'Y', 'bluebird', 'https://bluebird.atlassian.net/wiki/spaces/X', 'q@b.c', 'BLUEBIRD_TOKEN', 'scoped', '', '', 'no'];
    const d = deps({ answers, env: { NORTHSTAR_ATLASSIAN_TOKEN: SECRET }, files: { [PATH]: JSON.stringify(existing) } });
    expect(await runInit(d)).toBe(0);
    const { sites } = writtenSites(d) as { sites: Record<string, string>[] };
    expect(sites.map((x) => x.name)).toEqual(['northstar', 'bluebird']);
    expect(sites[1]).toEqual({ name: 'bluebird', baseUrl: 'https://bluebird.atlassian.net', email: 'q@b.c', apiToken: '${BLUEBIRD_TOKEN}', tokenType: 'scoped' });
    expect(d.lines).toContain('BLUEBIRD_TOKEN is not set in this shell; set it before starting the server. Skipping verification.');
  });

  it('reports unreachable products without failing the write', async () => {
    const d = deps({ routes: [myself401, spaces404] });
    expect(await runInit(d)).toBe(0);
    const line = d.lines.find((l) => l.startsWith('northstar: Jira failed (Token or email for site northstar rejected (401).'));
    expect(line).toBeDefined();
    expect(line).toContain('Confluence failed (Not found on site northstar');
    expect(Object.keys(d.written)).toEqual([PATH]);
    expect(d.lines.join('\n')).not.toContain(SECRET);
  });

  it('warns when the env variable named for the token is not set', async () => {
    const d = await runInitWith({ env: {} });
    expect(d.lines).toContain('NORTHSTAR_ATLASSIAN_TOKEN is not set in this shell; set it before starting the server. Skipping verification.');
    expect(d.code).toBe(0);
    expect(d.calls).toEqual([]);
    expect(Object.keys(d.written)).toEqual([PATH]);
  });

  it('refuses to overwrite a malformed existing file', async () => {
    const d = await runInitWith({ files: { [PATH]: `{ "sites": [ "${SECRET}" ` } });
    expect(d.code).toBe(1);
    expect(d.written).toEqual({});
    expect(d.lines).toHaveLength(1);
    expect(d.lines[0]).toContain(PATH);
    expect(d.lines[0]).not.toContain(SECRET);
    expect(d.prompter.ask).not.toHaveBeenCalled();
  });

  it('returns 1 without writing when input ends early', async () => {
    const d = await runInitWith({ answers: ['northstar'] });
    expect(d.code).toBe(1);
    expect(d.written).toEqual({});
    expect(d.lines).toEqual([`Setup stopped before it finished; ${PATH} was not changed.`]);
    expect(d.prompter.close).toHaveBeenCalled();
  });

  it('reports any other prompter fault with its own message', async () => {
    const d = deps();
    d.prompter.ask.mockRejectedValueOnce(new Error('terminal exploded'));
    expect(await runInit(d)).toBe(1);
    expect(d.written).toEqual({});
    expect(d.lines).toEqual(['init failed: terminal exploded']);
    expect(d.prompter.close).toHaveBeenCalled();
  });
});

describe('writePrivateFile', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('creates the parent with mode 700 and the file with mode 600', () => {
    dir = mkdtempSync(join(tmpdir(), 'atlas-init-'));
    const path = join(dir, 'conf', 'sites.json');
    writePrivateFile(path, '{}\n');
    expect(readFileSync(path, 'utf8')).toBe('{}\n');
    expect(statSync(join(dir, 'conf')).mode & 0o777).toBe(0o700);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('tightens an existing file to mode 600', () => {
    dir = mkdtempSync(join(tmpdir(), 'atlas-init-'));
    mkdirSync(join(dir, 'conf'));
    const path = join(dir, 'conf', 'sites.json');
    writeFileSync(path, 'old', { mode: 0o644 });
    writePrivateFile(path, 'new');
    expect(readFileSync(path, 'utf8')).toBe('new');
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});

describe('createPrompter', () => {
  it('constructs and closes', () => {
    const p = createPrompter();
    expect(typeof p.ask).toBe('function');
    p.close();
  });

  function tty() {
    const input = Object.assign(new PassThrough(), { isTTY: true });
    let captured = '';
    const output = new Writable({
      write(chunk, _encoding, done) {
        captured += String(chunk);
        done();
      },
    });
    return { input, output, captured: () => captured };
  }

  it('mutes the secret answer and never recalls it from history', async () => {
    const t = tty();
    const p = createPrompter(t.input, t.output);
    try {
      const secret = p.ask('API token', { secret: true });
      t.input.write('tok-SECRET-123\r');
      expect(await secret).toBe('tok-SECRET-123');
      expect(t.captured()).toContain('API token: ');
      expect(t.captured()).not.toContain('tok-SECRET-123');

      const name = p.ask('Site name');
      t.input.write('\x1b[A');
      t.input.write('northstar\r');
      expect(await name).toBe('northstar');
      expect(t.captured()).toContain('Site name: ');
      expect(t.captured()).toContain('northstar');
      expect(t.captured()).not.toContain('tok-SECRET-123');
    } finally {
      p.close();
    }
  });

  it('rejects with InputEndedError when input ends', async () => {
    const t = tty();
    const p = createPrompter(t.input, t.output);
    const answer = p.ask('Site name');
    t.input.end();
    await expect(answer).rejects.toBeInstanceOf(InputEndedError);
    p.close();
  });
});
