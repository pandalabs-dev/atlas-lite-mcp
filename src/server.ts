import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { confluenceModule } from './confluence/module.js';
import type { Runtime } from './core/runtime.js';
import { coreModule } from './core/sitesTool.js';
import { registerModules } from './core/tools.js';
import { jiraModule } from './jira/module.js';

/** Version from package.json, one level above both src/ and dist/. */
export function packageVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: unknown };
  return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
}

/** The MCP server with every tool registered against one runtime. */
export function createServer(rt: Runtime): McpServer {
  const server = new McpServer({ name: 'atlas-lite-mcp', version: packageVersion() });
  registerModules(server, [coreModule, confluenceModule, jiraModule], rt);
  return server;
}
