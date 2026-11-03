#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createPrompter, runInit, writePrivateFile } from './cli/init.js';
import { configPath, defaultConfigDeps, loadConfig } from './core/config.js';
import { log } from './core/log.js';
import { createRuntime, type Runtime } from './core/runtime.js';
import { createServer, packageVersion } from './server.js';

const USAGE = [
  'Usage: atlas-lite-mcp [command]',
  '',
  '  (no command)   start the MCP server over stdio',
  '  init           set up sites.json interactively',
  '  --version, -v  print the version',
  '  --help, -h     print this help',
].join('\n');

export async function main(argv: string[]): Promise<void> {
  const cmd = argv[0];
  if (cmd === 'init') {
    const code = await runInit({
      prompter: createPrompter(),
      out: log,
      configPath: configPath(process.env, homedir()),
      env: process.env,
      readFile: defaultConfigDeps().readFile,
      writeFile: writePrivateFile,
    });
    process.exit(code);
  }
  if (cmd === '--version' || cmd === '-v') {
    process.stdout.write(packageVersion() + '\n');
    return;
  }
  if (cmd === '--help' || cmd === '-h') {
    process.stdout.write(USAGE + '\n');
    return;
  }

  let rt: Runtime;
  try {
    rt = createRuntime(loadConfig(defaultConfigDeps()));
  } catch (e) {
    // A broken config never stops the server; every tool answers with this message instead.
    rt = createRuntime({ error: e instanceof Error ? e.message : String(e) });
  }
  const server = createServer(rt);
  let closing = false;
  const shutdown = (): void => {
    if (closing) return;
    closing = true;
    void server.close().finally(() => process.exit(0));
  };
  process.stdin.on('end', shutdown);
  process.stdin.on('close', shutdown);
  await server.connect(new StdioServerTransport());
}

function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    // npx and global installs start the bin through a symlink, so compare real paths.
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  main(process.argv.slice(2)).catch((e: unknown) => {
    log(`atlas-lite-mcp failed to start: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}
