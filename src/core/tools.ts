import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AtlasError } from './errors.js';
import type { Runtime } from './runtime.js';

export interface ToolDef<S extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  description: string;
  shape: S;
  run(args: z.infer<z.ZodObject<S>>, rt: Runtime): Promise<string>;
}

/** A product (confluence, jira, ...) registers its tools through this interface only. */
export interface ProductModule {
  name: string;
  tools: ToolDef<any>[];
}

/** Identity helper that infers the argument type of `run` from `shape`. */
export function defineTool<S extends z.ZodRawShape>(def: ToolDef<S>): ToolDef<S> {
  return def;
}

export const siteParam = z.string().optional().describe('Site name or host');

/**
 * Validates arguments and runs a tool. Every failure becomes a tool result with isError,
 * never a protocol error; unexpected errors never carry a configured token.
 */
export async function executeTool(def: ToolDef, args: unknown, rt: Runtime): Promise<{ text: string; isError: boolean }> {
  const input = args ?? {};
  const parsed = z.object(def.shape).safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => describeIssue(issue, input));
    return { text: `Invalid arguments: ${issues.join('; ')}.`, isError: true };
  }
  try {
    return { text: await def.run(parsed.data, rt), isError: false };
  } catch (e) {
    if (e instanceof AtlasError) return { text: redact(e.message, rt), isError: true };
    const message = e instanceof Error ? e.message : String(e);
    return { text: `Unexpected error: ${redact(message, rt)}`, isError: true };
  }
}

export function registerModules(server: McpServer, modules: ProductModule[], rt: Runtime): void {
  for (const module of modules) {
    for (const def of module.tools) {
      server.registerTool(def.name, { description: def.description, inputSchema: def.shape }, async (args: unknown) => {
        const { text, isError } = await executeTool(def, args, rt);
        return { content: [{ type: 'text' as const, text }], isError };
      });
    }
  }
}

function describeIssue(issue: z.core.$ZodIssue, input: unknown): string {
  const path = issue.path.map(String).join('.');
  const message = valueAt(input, issue.path) === undefined && issue.code === 'invalid_type' ? 'is required' : issue.message;
  return path ? `${path} ${message}` : message;
}

function valueAt(data: unknown, path: PropertyKey[]): unknown {
  let cur: unknown = data;
  for (const key of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<PropertyKey, unknown>)[key];
  }
  return cur;
}

/** Replaces every configured token, raw or inside Basic credentials, with `***`. */
function redact(text: string, rt: Runtime): string {
  let safe = text;
  for (const site of rt.sites()) {
    if (!site.apiToken) continue;
    const basic = Buffer.from(`${site.email}:${site.apiToken}`).toString('base64');
    for (const secret of [basic, site.apiToken]) safe = safe.split(secret).join('***');
  }
  return safe;
}
