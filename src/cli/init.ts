import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import type { Site, TokenType } from '../core/config.js';
import { createHttpClient } from '../core/http.js';

export interface Prompter {
  ask(question: string, opts?: { default?: string; secret?: boolean }): Promise<string>;
  close(): void;
}

export interface InitDeps {
  prompter: Prompter;
  out(line: string): void;
  configPath: string;
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  /** File content, or undefined when the file does not exist. */
  readFile(path: string): string | undefined;
  writeFile(path: string, data: string): void;
}

/** One site as written to sites.json, keys in file order. */
interface SiteEntry {
  name: string;
  baseUrl: string;
  email: string;
  apiToken: string;
  tokenType: TokenType;
  defaultJiraProject?: string;
  defaultConfluenceSpace?: string;
}

const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;
const ADD_COMMAND = 'claude mcp add atlas -- npx -y atlas-lite-mcp';

/** Thrown by the prompter when input ends or the user interrupts before an answer arrives. */
export class InputEndedError extends Error {
  constructor() {
    super('input ended');
    this.name = 'InputEndedError';
  }
}

/** Reads answer lines from input, prompts on output; echo is dropped while a secret question is pending. */
export function createPrompter(input: NodeJS.ReadableStream = process.stdin, output: NodeJS.WritableStream = process.stderr): Prompter {
  let muted = false;
  const sink = new Writable({
    write(chunk, _encoding, done) {
      if (!muted) output.write(chunk);
      done();
    },
  });
  // historySize 0: a secret answer must never be recalled by the Up key at a later prompt.
  const rl = createInterface({ input, output: sink, terminal: (input as { isTTY?: boolean }).isTTY === true, historySize: 0 });
  // A queue instead of rl.question, so piped answers that arrive at once are not dropped.
  const queued: string[] = [];
  let pending: ((line: string | undefined) => void) | undefined;
  let closed = false;
  const settle = (line: string | undefined): void => {
    const resolve = pending;
    pending = undefined;
    resolve?.(line);
  };
  rl.on('line', (line) => (pending ? settle(line) : queued.push(line)));
  rl.on('close', () => {
    closed = true;
    settle(undefined);
  });
  rl.on('SIGINT', () => rl.close());

  return {
    async ask(question, opts = {}) {
      const prompt = `${question}${opts.default ? ` [${opts.default}]` : ''}: `;
      if (opts.secret) output.write(prompt);
      rl.setPrompt(opts.secret ? '' : prompt);
      muted = opts.secret === true;
      rl.prompt();
      const line = queued.length > 0 || closed ? queued.shift() : await new Promise<string | undefined>((r) => (pending = r));
      if (muted) {
        output.write('\n');
        const history = (rl as unknown as { history?: unknown }).history;
        if (line !== undefined && Array.isArray(history)) history.splice(0, history.length, ...history.filter((h) => h !== line));
      }
      muted = false;
      if (line === undefined) throw new InputEndedError();
      return line.trim() || opts.default || '';
    },
    close: () => rl.close(),
  };
}

/** Creates the parent directory with mode 700 and writes the file with mode 600, also when it existed. */
export function writePrivateFile(path: string, data: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, data, { mode: 0o600 });
  chmodSync(path, 0o600);
}

/** Interactive setup of sites.json. Returns the process exit code. */
export async function runInit(deps: InitDeps): Promise<number> {
  const path = deps.configPath;
  let sites: unknown[];
  try {
    sites = existingSites(deps.readFile(path), path);
  } catch (e) {
    deps.prompter.close();
    deps.out(e instanceof Error ? e.message : String(e));
    return 1;
  }

  try {
    do {
      const entry = await askSite(deps);
      const index = sites.findIndex((s) => nameOf(s)?.toLowerCase() === entry.name.toLowerCase());
      if (index >= 0) sites[index] = entry;
      else sites.push(entry);
      await verify(entry, deps);
    } while (/^y(es)?$/i.test(await deps.prompter.ask('Add another site? (y/N)')));
  } catch (e) {
    deps.out(e instanceof InputEndedError ? `Setup stopped before it finished; ${path} was not changed.` : `init failed: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  } finally {
    deps.prompter.close();
  }

  try {
    deps.writeFile(path, JSON.stringify({ sites }, null, 2) + '\n');
  } catch (e) {
    deps.out(`Could not write ${path} (${(e as NodeJS.ErrnoException).code ?? 'unknown error'}); check that the directory is writable.`);
    return 1;
  }
  deps.out(`Wrote ${path} (mode 600).`);
  deps.out(`Add to Claude Code: ${ADD_COMMAND}`);
  return 0;
}

function existingSites(raw: string | undefined, path: string): unknown[] {
  if (raw === undefined) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    // The parse message quotes file content, which may hold a token.
    throw new Error(`Could not parse ${path} as JSON; fix or remove it and run init again.`);
  }
  const sites = (data as { sites?: unknown } | null)?.sites;
  if (!Array.isArray(sites)) throw new Error(`${path} has no "sites" list; fix or remove it and run init again.`);
  return sites;
}

function nameOf(site: unknown): string | undefined {
  const name = (site as { name?: unknown } | null)?.name;
  return typeof name === 'string' ? name : undefined;
}

async function askSite({ prompter, out }: InitDeps): Promise<SiteEntry> {
  const required = async (question: string, opts?: { secret: true }): Promise<string> => {
    for (;;) {
      const answer = (await (opts ? prompter.ask(question, opts) : prompter.ask(question))).trim();
      if (answer) return answer;
      out('This answer is required.');
    }
  };

  const name = await required('Site name');
  let baseUrl: string | undefined;
  while (baseUrl === undefined) {
    baseUrl = normaliseUrl(await required('Site URL (e.g. https://acme.atlassian.net)'));
    if (baseUrl === undefined) out('Enter the site address, for example https://acme.atlassian.net.');
  }
  const email = await required('Atlassian account email');
  const token = await required('API token, or the name of an env variable that holds it', { secret: true });
  let tokenType: string | undefined;
  while (tokenType !== 'classic' && tokenType !== 'scoped') {
    if (tokenType !== undefined) out('Enter classic or scoped.');
    tokenType = (await prompter.ask('Token type, classic or scoped', { default: 'classic' })).trim().toLowerCase() || 'classic';
  }
  const project = (await prompter.ask('Default Jira project key (optional)')).trim();
  const space = (await prompter.ask('Default Confluence space key (optional)')).trim();

  const entry: SiteEntry = { name, baseUrl, email, apiToken: ENV_NAME.test(token) ? `\${${token}}` : token, tokenType };
  if (project) entry.defaultJiraProject = project;
  if (space) entry.defaultConfluenceSpace = space;
  return entry;
}

/** `acme.atlassian.net/wiki` -> `https://acme.atlassian.net`; undefined when no host can be read. */
function normaliseUrl(answer: string): string | undefined {
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(answer) ? answer : `https://${answer}`);
    return url.host ? `https://${url.host}` : undefined;
  } catch {
    return undefined;
  }
}

/** Prints one line per site; never throws and never changes the exit code. */
async function verify(entry: SiteEntry, deps: InitDeps): Promise<void> {
  const envName = /^\$\{(.+)\}$/.exec(entry.apiToken)?.[1];
  const token = envName === undefined ? entry.apiToken : deps.env[envName];
  if (!token) {
    deps.out(`${envName} is not set in this shell; set it before starting the server. Skipping verification.`);
    return;
  }
  const site: Site = { name: entry.name, baseUrl: entry.baseUrl, host: new URL(entry.baseUrl).host, email: entry.email, apiToken: token, tokenType: entry.tokenType };
  const client = createHttpClient(site, deps.fetch ? { fetch: deps.fetch } : {});
  // The HTTP client already redacts; this keeps the token out of any other error text too.
  const failure = (e: unknown): string => (e instanceof Error ? e.message : String(e)).split(token).join('[redacted]');
  const [jira, confluence] = await Promise.all([
    client.request<{ displayName?: string } | undefined>('jira', 'GET', '/rest/api/3/myself').then(
      (me) => `Jira ok (${me?.displayName ?? entry.email})`,
      (e: unknown) => `Jira failed (${failure(e)})`,
    ),
    client.request('confluence', 'GET', '/wiki/api/v2/spaces', { query: { limit: 1 } }).then(
      () => 'Confluence ok',
      (e: unknown) => `Confluence failed (${failure(e)})`,
    ),
  ]);
  deps.out(`${entry.name}: ${jira}, ${confluence}`);
}
