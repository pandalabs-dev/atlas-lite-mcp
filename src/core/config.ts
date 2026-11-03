import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { AtlasError } from './errors.js';
import { log } from './log.js';

export type TokenType = 'classic' | 'scoped';

export interface Site {
  name: string;
  baseUrl: string;
  host: string;
  email: string;
  apiToken: string;
  tokenType: TokenType;
  defaultJiraProject?: string;
  defaultConfluenceSpace?: string;
  cloudId?: string;
  /** Why the site cannot be used, e.g. an unset env reference. */
  unavailable?: string;
}

export interface LoadedConfig {
  sites: Site[];
  source: 'file' | 'env' | 'none';
  path: string;
}

export interface ConfigDeps {
  env: Record<string, string | undefined>;
  home: string;
  /** File content, or undefined when the file does not exist. */
  readFile(path: string): string | undefined;
  /** Permission bits of the file, or undefined when it does not exist. */
  fileMode(path: string): number | undefined;
  warn(line: string): void;
}

const ENV_KEYS = ['ATLASSIAN_URL', 'ATLASSIAN_EMAIL', 'ATLASSIAN_TOKEN'] as const;
const ENV_REF = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/;

const required = z.string().min(1);
const siteSchema = z.object({
  name: required,
  baseUrl: z.url({ protocol: /^https?$/ }),
  email: required,
  apiToken: required,
  tokenType: z.enum(['classic', 'scoped']).default('classic'),
  defaultJiraProject: required.optional(),
  defaultConfluenceSpace: required.optional(),
  cloudId: required.optional(),
});
const fileSchema = z.object({ sites: z.array(siteSchema) });

/** The only config path rule: ATLAS_MCP_CONFIG when set, else ~/.config/atlas-lite-mcp/sites.json. */
export function configPath(env: NodeJS.ProcessEnv, home: string): string {
  return env.ATLAS_MCP_CONFIG || join(home, '.config', 'atlas-lite-mcp', 'sites.json');
}

export function loadConfig(deps: ConfigDeps): LoadedConfig {
  const path = configPath(deps.env, deps.home);
  const raw = deps.readFile(path);
  if (raw === undefined) return loadFromEnv(deps.env, path);

  const mode = deps.fileMode(path);
  if (mode !== undefined && (mode & 0o077) !== 0) {
    deps.warn(`${path} is readable by other users; run chmod 600 ${path}`);
  }
  if (ENV_KEYS.some((k) => deps.env[k])) {
    deps.warn(`Using ${path}; ATLASSIAN_URL, ATLASSIAN_EMAIL and ATLASSIAN_TOKEN are ignored.`);
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    // The JSON.parse message quotes file content, which may hold a token, so it is not included.
    throw new AtlasError(`Could not parse ${path} as JSON; fix the syntax and restart.`);
  }
  const parsed = fileSchema.safeParse(data);
  if (!parsed.success) {
    throw new AtlasError(`Invalid config ${path}: ${describeIssues(parsed.error.issues, data, fieldPath)}.`);
  }

  const seen = new Map<string, string>();
  for (const s of parsed.data.sites) {
    const first = seen.get(s.name.toLowerCase());
    if (first !== undefined) {
      throw new AtlasError(`Duplicate site name "${first}" in ${path}; site names must be unique, ignoring case.`);
    }
    seen.set(s.name.toLowerCase(), s.name);
  }

  return { sites: parsed.data.sites.map((s) => toSite(s, deps.env)), source: 'file', path };
}

export function defaultConfigDeps(): ConfigDeps {
  return {
    env: process.env,
    home: homedir(),
    readFile(path) {
      try {
        return readFileSync(path, 'utf8');
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') return undefined;
        throw new AtlasError(`Could not read ${path} (${code ?? 'unknown error'}); check that the file is readable.`);
      }
    },
    fileMode(path) {
      try {
        return statSync(path).mode & 0o777;
      } catch {
        return undefined;
      }
    },
    warn: log,
  };
}

type ParsedSite = z.infer<typeof siteSchema>;

function toSite(s: ParsedSite, env: Record<string, string | undefined>): Site {
  const url = new URL(s.baseUrl);
  const site: Site = { ...s, baseUrl: url.origin, host: url.host };
  const ref = ENV_REF.exec(s.apiToken)?.[1];
  if (ref !== undefined) {
    const value = env[ref];
    if (value) site.apiToken = value;
    else {
      site.apiToken = '';
      site.unavailable = `env ${ref} is not set`;
    }
  }
  return site;
}

function loadFromEnv(env: Record<string, string | undefined>, path: string): LoadedConfig {
  if (!ENV_KEYS.some((k) => env[k])) return { sites: [], source: 'none', path };
  const missing = ENV_KEYS.filter((k) => !env[k]);
  if (missing.length > 0) {
    throw new AtlasError(`${missing.join(' and ')} ${missing.length === 1 ? 'is' : 'are'} not set; set all of ${ENV_KEYS.join(', ')} or create ${path}.`);
  }

  const input = { baseUrl: env.ATLASSIAN_URL, email: env.ATLASSIAN_EMAIL, apiToken: env.ATLASSIAN_TOKEN, tokenType: env.ATLASSIAN_TOKEN_TYPE || undefined };
  const parsed = siteSchema.omit({ name: true }).safeParse(input);
  if (!parsed.success) {
    throw new AtlasError(`${describeIssues(parsed.error.issues, input, envVarName)}.`);
  }
  const url = new URL(parsed.data.baseUrl);
  const name = url.hostname.split('.')[0] ?? url.hostname;
  return { sites: [{ ...parsed.data, name, baseUrl: url.origin, host: url.host }], source: 'env', path };
}

const ENV_VAR_BY_FIELD: Record<string, string> = {
  baseUrl: 'ATLASSIAN_URL',
  email: 'ATLASSIAN_EMAIL',
  apiToken: 'ATLASSIAN_TOKEN',
  tokenType: 'ATLASSIAN_TOKEN_TYPE',
};

function envVarName(path: PropertyKey[]): string {
  const field = String(path[0]);
  return ENV_VAR_BY_FIELD[field] ?? field;
}

/** Formats a zod path as `sites[0].email`. */
function fieldPath(path: PropertyKey[]): string {
  if (path.length === 0) return 'the top level';
  return path.map((p, i) => (typeof p === 'number' ? `[${p}]` : i === 0 ? String(p) : `.${String(p)}`)).join('');
}

/** Describes issues by path and rule only; the offending value is never included. */
function describeIssues(issues: z.core.$ZodIssue[], data: unknown, label: (path: PropertyKey[]) => string): string {
  return issues.map((issue) => `${label(issue.path)} ${describeIssue(issue, valueAt(data, issue.path))}`).join('; ');
}

function describeIssue(issue: z.core.$ZodIssue, value: unknown): string {
  if (value === undefined) return 'is required';
  switch (issue.code) {
    case 'invalid_type':
      return `must be ${issue.expected === 'array' || issue.expected === 'object' ? 'an' : 'a'} ${issue.expected}`;
    case 'invalid_format':
      return issue.format === 'url' ? 'must be a URL such as https://example.atlassian.net' : `must be a valid ${issue.format}`;
    case 'invalid_value':
      return `must be ${issue.values.map(String).join(' or ')}`;
    case 'too_small':
      return 'must not be empty';
    default:
      return 'is invalid';
  }
}

function valueAt(data: unknown, path: PropertyKey[]): unknown {
  let cur: unknown = data;
  for (const key of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<PropertyKey, unknown>)[key];
  }
  return cur;
}
