import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { registerModules, type ProductModule } from '../../src/core/tools.js';
import type { Runtime } from '../../src/core/runtime.js';
import type { Call } from './scenarios.js';

// Five serial HTTP requests at the production worst-case request budget of 300 s.
// This avoids the SDK's default 60 s timeout, but draining, not this value, is the safety boundary.
export const SMOKE_REQUEST_TIMEOUT = 1500000;

export function createSmokeSession(rt: Runtime, modules: ProductModule[], requestTimeout = SMOKE_REQUEST_TIMEOUT) {
  const active = new Set<Promise<unknown>>();
  async function tracked<T>(work: () => Promise<T>): Promise<T> {
    const pending = Promise.resolve().then(work);
    active.add(pending);
    try { return await pending; } finally { active.delete(pending); }
  }
  async function drain(): Promise<void> {
    while (active.size) await Promise.allSettled([...active]);
  }
  const server = new McpServer({ name: 'smoke-harness', version: '0.1.0' });
  // Track the entire handler, not individual fetches: a handler may await retry sleeps,
  // then issue more requests after an SDK cancellation. No production code is changed.
  registerModules(server, modules.map((module) => ({ ...module, tools: module.tools.map((tool) => ({
    ...tool,
    run: (args, runtime) => tracked(() => tool.run(args, runtime)),
  })) })), rt);
  const client = new Client({ name: 'smoke', version: '0.1.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  let calls: Promise<unknown> = Promise.resolve();
  const call: Call = (name, args) => {
    const pending = calls.then(async () => {
      try {
        return await client.callTool({ name, arguments: args }, CallToolResultSchema, { timeout: requestTimeout });
      } finally {
        // A rejected SDK promise does not establish handler settlement.
        await drain();
      }
    });
    calls = pending.catch(() => {});
    return pending;
  };
  let scenarios: Promise<unknown> = Promise.resolve();
  let poisoned = false;
  let closing = false;
  return {
    call,
    async connect() { await Promise.all([server.connect(b), client.connect(a)]); },
    run(work: () => Promise<void>, signal?: AbortSignal): Promise<void> {
      if (closing) return Promise.reject(new Error('Smoke session is closing'));
      const abort = () => { poisoned = true; };
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      const pending = scenarios.then(async () => {
        if (poisoned) throw new Error('Earlier smoke scenario deadline expired; manual inspection required');
        try {
          await work();
        } finally {
          await calls;
          await drain();
          signal?.removeEventListener('abort', abort);
        }
        if (signal?.aborted) throw new Error('Smoke scenario deadline expired; manual inspection required');
      });
      scenarios = pending.catch(() => {});
      return pending;
    },
    async close() {
      closing = true;
      // Even if Vitest already timed out a callback, its real promise remains in this queue.
      await scenarios;
      await calls;
      await drain();
      await client.close();
      await server.close();
    },
  };
}
